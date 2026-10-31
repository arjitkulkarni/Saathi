import { and, desc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { actions, agentCommands, devicePosture, incidentFindings, incidents, rawEvents } from '../../packages/db/src/schema';
import { createEnrollmentCode, enrollDevice, runAttackPreview, type PreviewScenario } from '../../packages/db/src/services/devices';
import { getScenarioPrompt, listIncidentsNeedingDecision, recordScenarioDecision } from '../../packages/db/src/services/scenario-decisions';
import { malwareCheck, processOrgEvents } from '../../packages/db/src/services/processing';
import { appPool, fixtures, idem, tx } from './helpers';

async function fixture(scenario: PreviewScenario) {
  const F = await fixtures();
  const { code } = await tx(F.owner, db => createEnrollmentCode(db, F.owner, `Browser repair ${scenario}`));
  const { deviceId } = await runAttackPreview(appPool, code, scenario);
  await tx(F.owner, async db => {
    await processOrgEvents(db, F.lakeview);
    if (scenario === 'malware_detected') {
      const [event] = await db.select().from(rawEvents).where(and(eq(rawEvents.deviceId, deviceId), eq(rawEvents.type, 'malware.detected'))).orderBy(desc(rawEvents.observedAt)).limit(1);
      await malwareCheck(db, F.lakeview, { eventId: event.id, deviceId });
    }
  });
  const [incident] = await tx(F.owner, db => db.select().from(incidents).where(eq(incidents.subjectDeviceId, deviceId)));
  expect(incident).toBeTruthy();
  return { ...F, code, deviceId, incidentId: incident.id };
}

describe('browser practice repair, isolated from device execution', () => {
  for (const scenario of ['protection_disabled', 'malware_detected', 'password_guessing'] as const) {
    it(`repairs and verifies ${scenario} without sending an agent command`, async () => {
      const F = await fixture(scenario);
      const prompt = await tx(F.owner, db => getScenarioPrompt(db, F.owner, F.incidentId));
      expect(prompt.simulated).toBe(true);
      expect(prompt.prompt.options[0]).toMatchObject({ key: 'simulate_repair', kind: 'simulation_action', recommended: true, actionSpecs: [] });
      const result = await tx(F.owner, db => recordScenarioDecision(db, F.owner, F.incidentId, { responseKey: 'simulate_repair', idempotencyKey: idem() }));
      expect(result.simulationResult?.state).toBe('confirmed');
      expect(result.actionResults).toEqual([]);
      await tx(F.owner, async db => {
        expect(await db.select().from(agentCommands).where(eq(agentCommands.deviceId, F.deviceId))).toHaveLength(0);
        expect(await db.select().from(actions).where(eq(actions.deviceId, F.deviceId))).toHaveLength(0);
        const findings = await db.select().from(incidentFindings).where(eq(incidentFindings.incidentId, F.incidentId));
        expect(findings.every(f => f.status === 'resolved' || f.status === 'restricted')).toBe(true);
        const [posture] = await db.select().from(devicePosture).where(eq(devicePosture.deviceId, F.deviceId)).orderBy(desc(devicePosture.revision)).limit(1);
        const key = scenario === 'protection_disabled' ? 'av' : scenario === 'malware_detected' ? 'preview_threat' : 'preview_blocked_source';
        expect(posture.checks[key]).toMatchObject({ result: 'pass', source: 'browser_simulation' });
        expect((await listIncidentsNeedingDecision(db, F.owner)).some(i => i.id === F.incidentId)).toBe(false);
      });
      const duplicate = await tx(F.owner, db => recordScenarioDecision(db, F.owner, F.incidentId, { responseKey: 'simulate_repair', idempotencyKey: idem() }));
      expect(duplicate.alreadyDecided).toBe(true);
      expect(duplicate.simulationResult).toEqual(result.simulationResult);
      if (scenario === 'password_guessing') {
        const successes = await tx(F.owner, db => db.select().from(rawEvents).where(and(eq(rawEvents.deviceId, F.deviceId), eq(rawEvents.type, 'auth.succeeded'))));
        expect(successes).toHaveLength(0);
      }
      if (scenario === 'malware_detected') {
        await tx(F.owner, async db => {
          const [event] = await db.select().from(rawEvents).where(and(eq(rawEvents.deviceId, F.deviceId), eq(rawEvents.type, 'malware.detected'))).limit(1);
          await malwareCheck(db, F.lakeview, { eventId: event.id, deviceId: F.deviceId });
          expect((await db.select().from(incidentFindings).where(eq(incidentFindings.incidentId, F.incidentId))).every(f => f.status === 'resolved')).toBe(true);
        });
      }
    });
  }
  it('a new practice run reopens a previously repaired scenario', async () => {
    const F = await fixture('protection_disabled');
    await tx(F.owner, db => recordScenarioDecision(db, F.owner, F.incidentId, { responseKey: 'simulate_repair', idempotencyKey: idem() }));
    await runAttackPreview(appPool, F.code, 'protection_disabled');
    await tx(F.owner, async db => {
      await processOrgEvents(db, F.lakeview);
      expect((await listIncidentsNeedingDecision(db, F.owner)).some(i => i.id === F.incidentId)).toBe(true);
      const [posture] = await db.select().from(devicePosture).where(eq(devicePosture.deviceId, F.deviceId)).orderBy(desc(devicePosture.revision)).limit(1);
      expect(posture.checks.av.value).toBe('off');
    });
  });
  it('replaces an old promise to get help with an explicitly approved practice fix', async () => {
    const F = await fixture('protection_disabled');
    await tx(F.owner, db => recordScenarioDecision(db, F.owner, F.incidentId, { responseKey: 'review', idempotencyKey: idem() }));
    expect((await tx(F.owner, db => listIncidentsNeedingDecision(db, F.owner))).some(i => i.id === F.incidentId)).toBe(true);
    const repaired = await tx(F.owner, db => recordScenarioDecision(db, F.owner, F.incidentId, { responseKey: 'simulate_repair', idempotencyKey: idem() }));
    expect(repaired.simulationResult?.state).toBe('confirmed');
    expect((await tx(F.owner, db => listIncidentsNeedingDecision(db, F.owner))).some(i => i.id === F.incidentId)).toBe(false);
  });
  it('denies staff and cross-tenant attempts without changing the fixture', async () => {
    const F = await fixture('protection_disabled');
    for (const actor of [F.staffActor, F.northOwner]) {
      await expect(tx(actor, db => recordScenarioDecision(db, actor, F.incidentId, { responseKey: 'simulate_repair', idempotencyKey: idem() }))).rejects.toMatchObject({ code: actor === F.staffActor ? 'FORBIDDEN' : 'NOT_FOUND' });
    }
    const [posture] = await tx(F.owner, db => db.select().from(devicePosture).where(eq(devicePosture.deviceId, F.deviceId)).orderBy(desc(devicePosture.revision)).limit(1));
    expect(posture.checks.av.value).toBe('off');
  });
  it('does not repurpose an enrolled real device as a browser simulator', async () => {
    const F = await fixtures();
    const { code } = await tx(F.owner, db => createEnrollmentCode(db, F.owner, 'Real device boundary test'));
    await enrollDevice(appPool, { code, hostname: 'real-device', osVersion: 'preview', agentVersion: 'preview', simulated: false }, { encryptionKey: 'Hxq9QiQu_bnX7ZhZ6CyDTylcRUQtLjXDNnym9nanyLg', commandKeys: [] });
    await expect(runAttackPreview(appPool, code, 'protection_disabled')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
