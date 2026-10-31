import { and, desc, eq, inArray } from 'drizzle-orm';
import { msg, SaathiError, type Finding, type Msg } from '@saathi/contracts';
import type { Db } from '../client';
import { deviceKeys, devicePosture, devices, incidentFindings, incidentHistory, rawEvents } from '../schema';
import { recordIntent, requireMembership, type Actor } from './core';
import { reassessIncident } from './incidents';

export type SimulationRepairResult = { state: 'confirmed'; outcome: Msg };

/** Browser previews have no signing identity and cannot receive commands. Never opt in
 * a real or agent-backed device merely because an incident carries a replay label. */
export async function browserPreviewDevice(db: Db, orgId: string, findings: Finding[]) {
  const ids = [...new Set(findings.filter(f => f.target.type === 'device').map(f => f.target.id))];
  if (ids.length !== 1 || findings.some(f => f.target.type !== 'device')) return null;
  const [device] = await db.select().from(devices).where(and(eq(devices.orgId, orgId), eq(devices.id, ids[0])));
  if (!device?.simulated || device.agentVersion !== 'preview' || device.osVersion !== 'preview' || device.status !== 'connected') return null;
  const [key] = await db.select({ id: deviceKeys.id }).from(deviceKeys).where(eq(deviceKeys.deviceId, device.id)).limit(1);
  return key ? null : device;
}

/** A bounded simulator, not a live remediation adapter. Persist and read back the
 * simulated state, retain its before/after evidence, and never create an agent command. */
export async function repairBrowserPreview(db: Db, actor: Actor, incidentId: string, findings: Finding[], rule: string, now: Date): Promise<SimulationRepairResult> {
  await requireMembership(db, actor, 'actions.approve');
  const candidate = await browserPreviewDevice(db, actor.orgId, findings);
  if (!candidate) throw new SaathiError('UNSUPPORTED_ACTION', 'This repair is only available for browser practice devices.');
  await db.select({ id: devices.id }).from(devices).where(eq(devices.id, candidate.id)).for('update');
  if (!await browserPreviewDevice(db, actor.orgId, findings)) throw new SaathiError('STALE_PREVIEW', 'This computer changed. Review the available choices again.');
  const matching = findings.filter(f => f.ruleId === rule && f.target.id === candidate.id && f.status === 'open');
  if (!matching.length) throw new SaathiError('STALE_PREVIEW', 'This practice issue is no longer open.');
  const facts = Object.fromEntries(matching.flatMap(f => f.facts.flatMap(m => Object.entries(m.params))));
  const [prior] = await db.select().from(devicePosture).where(eq(devicePosture.deviceId, candidate.id)).orderBy(desc(devicePosture.revision)).limit(1);
  let key: string;
  let expected: string;
  if (rule === 'protection_disabled') {
    key = facts.component === 'firewall' ? 'firewall' : 'av';
    expected = 'on';
  } else if (rule === 'unresolved_malware') {
    key = 'preview_threat';
    expected = 'quarantined';
  } else if (rule === 'password_guessing' && typeof facts.sourceAddress === 'string' && facts.sourceAddress) {
    key = 'preview_blocked_source';
    expected = facts.sourceAddress;
  } else {
    throw new SaathiError('UNSUPPORTED_ACTION', 'This practice issue has no supported repair.');
  }
  const checks = { ...(prior?.checks ?? {}), [key]: { result: 'pass', value: expected, source: 'browser_simulation', observedAt: now.toISOString() } };
  const [saved] = await db.insert(devicePosture).values({ orgId: actor.orgId, deviceId: candidate.id, revision: (prior?.revision ?? 0) + 1, checks, observedAt: now }).returning({ id: devicePosture.id });
  const [observed] = await db.select().from(devicePosture).where(eq(devicePosture.id, saved.id));
  if (observed?.checks[key]?.value !== expected || observed.checks[key]?.result !== 'pass') throw new SaathiError('CONFLICT', 'The practice repair could not be verified.');

  if (rule === 'unresolved_malware') {
    // Match the synthetic threat identifiers so later malware checks do not reopen
    // the same practice detection after its simulated quarantine.
    const detections = await db.select().from(rawEvents).where(and(eq(rawEvents.orgId, actor.orgId), eq(rawEvents.deviceId, candidate.id), eq(rawEvents.type, 'malware.detected')));
    for (const detection of detections) {
      if (detection.observedAt > now) continue;
      const threatId = (detection.facts as Record<string, unknown>).threatId;
      if (typeof threatId !== 'string') continue;
      await db.insert(rawEvents).values({ orgId: actor.orgId, deviceId: candidate.id, sourceType: 'device', type: 'malware.remediated', observedAt: now, dedupeKey: `preview-repair:${detection.id}`, isReplay: true, facts: { threatId, simulated: true, treatment: 'quarantined' } }).onConflictDoNothing();
    }
  }
  await db.update(incidentFindings).set({ status: rule === 'password_guessing' ? 'restricted' : 'resolved', updatedAt: now }).where(and(eq(incidentFindings.orgId, actor.orgId), eq(incidentFindings.incidentId, incidentId), inArray(incidentFindings.id, matching.map(f => f.id))));
  await db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, candidate.id));
  const outcome = msg(`decisionModal.repair.${rule}.outcome`);
  await db.insert(incidentHistory).values({ orgId: actor.orgId, incidentId, kind: 'simulation_repair', text: outcome, actorUserId: actor.userId, at: now });
  await reassessIncident(db, actor.orgId, incidentId, { at: now });
  await recordIntent(db, actor.orgId, 'demo.repair_verified', { incidentId, deviceId: candidate.id, rule, simulated: true, previous: prior?.checks[key] ?? null, observed: observed.checks[key], postureRevision: observed.revision, by: actor.userId }, { incidentId });
  return { state: 'confirmed', outcome };
}
