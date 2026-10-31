import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { msg, SaathiError, type Finding, type Msg, type Urgency } from '@saathi/contracts';
import { buildScenarioPrompt, decisionNeedsReopen, recommendOptions, withBrowserPreviewRepair, type ScenarioDeviceActionSpec, type ScenarioPrompt } from '@saathi/domain';
import type { Db } from '../client';
import { incidentFindings, incidentHistory, incidents } from '../schema';
import { recordIntent, requireMembership, type Actor } from './core';
import { approvePreview, createPreview } from './decisions';
import { findingFromRow } from './incidents';
import { loadSnapshot } from './snapshot';
import { browserPreviewDevice, repairBrowserPreview, type SimulationRepairResult } from './preview-repairs';

async function availablePrompt(db: Db, orgId: string, findings: Finding[], now: Date) {
  const snapshot = await loadSnapshot(db, orgId, now);
  const { options } = recommendOptions(snapshot, findings, now.toISOString());
  const prompt = buildScenarioPrompt(representativeRuleId(findings), options);
  return await browserPreviewDevice(db, orgId, findings) ? withBrowserPreviewRepair(prompt) : prompt;
}

const ACTIONABLE_STATES = ['open', 'investigating'];
const URGENCY_RANK: Record<Urgency, number> = { needs_attention: 3, review_today: 2, weekly: 1 };

export type QueuedIncidentDTO = { id: string; title: Msg; urgency: Urgency; openedAt: string };

async function openFindings(db: Db, incidentId: string): Promise<Finding[]> {
  return (await db.select().from(incidentFindings).where(eq(incidentFindings.incidentId, incidentId))).map(findingFromRow).filter((f) => f.status === 'open');
}

/** Representative rule for the scenario mapping: the most recently relevant open finding. */
function representativeRuleId(findings: Finding[]): string {
  return findings[findings.length - 1]?.ruleId ?? 'generic';
}

/**
 * Incidents an owner/approver has not yet made a deliberate decision on, prioritized by
 * urgency then age (oldest first). An incident drops off this list once decided, and returns
 * only if a finding exists that was not part of the decided set (decisionNeedsReopen).
 */
export async function listIncidentsNeedingDecision(db: Db, actor: Actor, now = new Date()): Promise<QueuedIncidentDTO[]> {
  await requireMembership(db, actor, 'incidents.preview');
  const rows = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.orgId, actor.orgId), inArray(incidents.state, ACTIONABLE_STATES), eq(incidents.urgency, 'needs_attention')))
    .orderBy(asc(incidents.openedAt));
  if (rows.length === 0) return [];
  const findingsByIncident = await db
    .select()
    .from(incidentFindings)
    .where(inArray(incidentFindings.incidentId, rows.map((r) => r.id)));
  const out: QueuedIncidentDTO[] = [];
  for (const r of rows) {
    const open = findingsByIncident.filter((f) => f.incidentId === r.id && f.status === 'open').map((f) => f.id);
    if (open.length === 0) continue; // nothing open to decide on (already resolved/restricted)
    if (!decisionNeedsReopen(open, (r.decidedFindingIds as string[] | null) ?? null)) {
      // Older browser previews could only save a promise to get help. Offer the
      // newly supported fix for those still-open practice issues, once. Respect
      // an explicit monitoring choice and never treat it as approval to repair.
      if (!['review', 'disconnect'].includes(r.decidedResponse ?? '')) continue;
      const current = findingsByIncident.filter(f => f.incidentId === r.id && f.status === 'open').map(findingFromRow);
      const prompt = await availablePrompt(db, actor.orgId, current, now);
      if (!prompt.options.some(o => o.kind === 'simulation_action')) continue;
    }
    out.push({ id: r.id, title: r.title as Msg, urgency: r.urgency as Urgency, openedAt: r.openedAt.toISOString() });
  }
  return out.sort((a, b) => URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency] || new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime());
}

export async function getScenarioPrompt(
  db: Db,
  actor: Actor,
  incidentId: string,
  now = new Date(),
): Promise<{ incidentId: string; title: Msg; urgency: Urgency; observedAt: string; facts: Msg[]; uncertain: Msg[]; simulated: boolean; prompt: ScenarioPrompt }> {
  await requireMembership(db, actor, 'incidents.preview');
  const [inc] = await db.select().from(incidents).where(and(eq(incidents.orgId, actor.orgId), eq(incidents.id, incidentId)));
  if (!inc) throw new SaathiError('NOT_FOUND', 'Incident not found.');
  const findings = await openFindings(db, incidentId);
  const scope = inc.scope as { sources?: Msg[] } | null;
  // Keep the SIMULATION/REPLAY label visible on the decision modal too, not just elsewhere.
  const simulated = (scope?.sources ?? []).some((s) => s.key === 'scope.device_simulated') || inc.isReplay;
  return {
    incidentId: inc.id,
    title: inc.title as Msg,
    urgency: inc.urgency as Urgency,
    observedAt: inc.openedAt.toISOString(),
    facts: inc.facts as Msg[],
    uncertain: inc.uncertain as Msg[],
    simulated,
    prompt: await availablePrompt(db, actor.orgId, findings, now),
  };
}

export type DecisionActionResult = { specIndex: number; actionType: string; actionId: string | null; duplicate: boolean; error: string | null };
export type DecisionResultDTO = { recorded: boolean; alreadyDecided: boolean; responseKey: string; actionResults: DecisionActionResult[]; simulationResult?: SimulationRepairResult };

/**
 * Record a deliberate response to an actionable incident. Only the responseKey is trusted
 * from the client; the option's availability, benefit/consequence text and action
 * specification are always re-derived from the server's own current scenario prompt, so a
 * stale or tampered client payload cannot select something no longer offered.
 */
export async function recordScenarioDecision(db: Db, actor: Actor, incidentId: string, input: { responseKey: string; idempotencyKey: string }, now = new Date()): Promise<DecisionResultDTO> {
  await requireMembership(db, actor, 'incidents.preview');
  const [inc] = await db.select().from(incidents).where(and(eq(incidents.orgId, actor.orgId), eq(incidents.id, incidentId))).for('update');
  if (!inc) throw new SaathiError('NOT_FOUND', 'Incident not found.');
  if (['dismissed', 'recovered'].includes(inc.state)) throw new SaathiError('CONFLICT', 'This incident is closed.');

  const findings = await openFindings(db, incidentId);
  const openIds = findings.map((f) => f.id);
  const alreadyDecided = !decisionNeedsReopen(openIds, (inc.decidedFindingIds as string[] | null) ?? null);
  const upgradeToRepair = alreadyDecided && openIds.length > 0 && ['review', 'disconnect', 'monitor', 'defer', 'verify_owner'].includes(inc.decidedResponse ?? '') && input.responseKey !== inc.decidedResponse;
  if (alreadyDecided && !upgradeToRepair) {
    // Already decided for the current set of open findings: duplicate submission (double
    // click, retry, a second tab) — report the existing decision rather than erroring or
    // recording a second time.
    const [repair] = inc.decidedResponse === 'simulate_repair' ? await db.select().from(incidentHistory).where(and(eq(incidentHistory.incidentId, incidentId), eq(incidentHistory.kind, 'simulation_repair'))).orderBy(desc(incidentHistory.at)).limit(1) : [];
    return { recorded: true, alreadyDecided: true, responseKey: inc.decidedResponse ?? input.responseKey, actionResults: [], ...(repair ? { simulationResult: { state: 'confirmed' as const, outcome: repair.text as Msg } } : {}) };
  }

  const prompt = await availablePrompt(db, actor.orgId, findings, now);
  const option = prompt.options.find((o) => o.key === input.responseKey);
  if (!option) throw new SaathiError('VALIDATION_FAILED', 'That response is not currently offered for this incident.');
  if (option.availability === 'unavailable') throw new SaathiError('UNSUPPORTED_ACTION', 'That response is not available for this incident.');
  if (upgradeToRepair && !['simulation_action', 'device_action', 'device_action_combo'].includes(option.kind)) throw new SaathiError('CONFLICT', 'A choice has already been saved. Select a supported fix to change it.');

  const actionResults: DecisionActionResult[] = [];
  const simulationResult = option.kind === 'simulation_action' ? await repairBrowserPreview(db, actor, incidentId, findings, prompt.scenarioKey, now) : undefined;
  if (option.actionSpecs.length > 0) {
    for (const [i, spec] of option.actionSpecs.entries()) {
      try {
        const { previewId } = await createPreview(db, actor, spec as ScenarioDeviceActionSpec, incidentId, now);
        const approved = await approvePreview(db, actor, previewId, `${input.idempotencyKey}:${i}`, now);
        actionResults.push({ specIndex: i, actionType: spec.actionType, actionId: approved.actionId, duplicate: approved.duplicate, error: null });
      } catch (e) {
        actionResults.push({ specIndex: i, actionType: spec.actionType, actionId: null, duplicate: false, error: e instanceof SaathiError ? e.message : 'This step failed.' });
        // The first step failing means nothing was durably accepted yet for this response:
        // surface it so the modal stays open with a retryable error, without recording a
        // decision (per spec: close only after the backend durably accepts the request).
        if (i === 0) throw e;
        break; // later step failed after an earlier one succeeded: stop, but keep what happened
      }
    }
  }

  await db
    .update(incidents)
    .set({ decidedAt: now, decidedVersion: inc.version, decidedFindingIds: openIds, decidedResponse: input.responseKey, decidedByUserId: actor.userId })
    .where(eq(incidents.id, incidentId));
  await db.insert(incidentHistory).values({ orgId: actor.orgId, incidentId, kind: 'decision_recorded', text: msg('history.decision_recorded', { response: input.responseKey }), actorUserId: actor.userId, at: now });
  await recordIntent(db, actor.orgId, 'incident.decision_recorded', { incidentId, responseKey: input.responseKey, kind: option.kind, actionResults, by: actor.userId }, { incidentId });
  return { recorded: true, alreadyDecided: false, responseKey: input.responseKey, actionResults, ...(simulationResult ? { simulationResult } : {}) };
}
