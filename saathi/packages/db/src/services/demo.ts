import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { SaathiError } from '@saathi/contracts';
import type { Db } from '../client';
import { appSessions, devices, rawEvents, staff } from '../schema';
import { enqueue, recordIntent, type Actor } from './core';

// Labelled replay scenarios (build.md Ph06 gate, Ph18). Events are synthetic, marked
// is_replay, and processed by the same correlation pipeline as live observations.

export type ReplayKind = 'normal_day' | 'device_warning' | 'slow_extraction';

type Ev = { type: string; observedAt: Date; facts: Record<string, unknown>; deviceId?: string | null; sourceType: string };

export async function runReplay(db: Db, actor: Actor, kind: ReplayKind, now = new Date()) {
  const runId = randomUUID().slice(0, 8);
  const evs: Ev[] = [];
  const [person] = await db.select().from(staff).where(and(eq(staff.orgId, actor.orgId), eq(staff.status, 'active'), eq(staff.sharedAccount, false))).limit(1);
  const [sess] = person ? await db.select().from(appSessions).where(and(eq(appSessions.orgId, actor.orgId), eq(appSessions.staffId, person.id), eq(appSessions.status, 'active'))).limit(1) : [];
  const [device] = await db.select().from(devices).where(and(eq(devices.orgId, actor.orgId), eq(devices.status, 'connected'))).limit(1);
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000);
  const download = (minutesAgo: number, attemptsInWindow: number, attemptsToday: number) => ({
    type: 'records.download',
    sourceType: 'gateway',
    observedAt: at(minutesAgo),
    facts: { sessionId: sess?.id ?? null, staffId: person?.id ?? null, sessionLabel: sess?.label ?? 'Replay session', staffLabel: person?.displayName ?? '', familiar: true, decision: 'allow', admitted: true, reason: 'granted', attemptsInWindow, windowSeconds: 120, attemptsToday, burstTriggered: false, throttleApplied: false, autoThrottleEnabled: true, replay: true },
  });

  if (kind === 'normal_day') {
    // A working day: ordinary downloads, sign-ins and a storage device during working hours.
    for (let i = 0; i < 40; i++) evs.push(download(400 - i * 9, 1 + (i % 3), i + 1));
    if (device) {
      for (let i = 0; i < 6; i++) evs.push({ type: 'auth.succeeded', sourceType: 'device', deviceId: device.id, observedAt: at(420 - i * 60), facts: { username: 'frontdesk', replay: true } });
      evs.push({ type: 'auth.failed', sourceType: 'device', deviceId: device.id, observedAt: at(300), facts: { username: 'frontdesk', reason: 'bad_password', replay: true } });
      evs.push({ type: 'malware.detected', sourceType: 'device', deviceId: device.id, observedAt: at(200), facts: { threatId: 'replay-1', threatName: 'EICAR test file (replay)', replay: true } });
      evs.push({ type: 'malware.remediated', sourceType: 'device', deviceId: device.id, observedAt: at(199), facts: { threatId: 'replay-1', replay: true } });
    }
  } else if (kind === 'slow_extraction') {
    // Below thresholds: 15 per 2-minute window, under 100 per day. Expected to be MISSED.
    for (let i = 0; i < 90; i++) evs.push(download(500 - i * 5, 1 + (i % 15), i + 1));
  } else {
    if (!device) throw new SaathiError('NOT_FOUND', 'Enrol a device (a simulated test device is fine) before replaying device warning signs.');
    for (let i = 0; i < 7; i++) evs.push({ type: 'auth.failed', sourceType: 'device', deviceId: device.id, observedAt: at(6 - i * 0.5), facts: { username: 'admin', sid: 'S-1-5-21-1000-1000-1000-500', reason: 'bad_password', sourceAddress: '203.0.113.7', logonType: 3, replay: true } });
    evs.push({ type: 'storage.attached', sourceType: 'device', deviceId: device.id, observedAt: at(2), facts: { label: 'USB DISK (replay)', replay: true } });
    evs.push({ type: 'malware.detected', sourceType: 'device', deviceId: device.id, observedAt: at(1), facts: { threatId: 'replay-2', threatName: 'Test threat (replay)', replay: true } });
  }
  let n = 0;
  for (const e of evs) {
    await db.insert(rawEvents).values({ orgId: actor.orgId, sourceType: e.sourceType, deviceId: e.deviceId ?? null, integrationId: null, dedupeKey: `replay:${runId}:${n}`, type: e.type, observedAt: e.observedAt, facts: e.facts, isReplay: true });
    n++;
  }
  await enqueue(db, { orgId: actor.orgId, type: 'events.process', payload: {}, dedupeKey: `events.process:${actor.orgId}:replay:${runId}` });
  await recordIntent(db, actor.orgId, 'demo.replay_started', { kind, runId, events: n, by: actor.userId });
  return { runId, events: n, kind };
}
