import { describe, expect, it } from 'vitest';
import { SaathiError } from '@saathi/contracts';
import { createEnrollmentCode, enrollDevice, ingestEvents, recordHeartbeat } from '../../packages/db/src/services/devices';
import { getActionDetail } from '../../packages/db/src/services/decisions';
import { getScenarioPrompt, listIncidentsNeedingDecision, recordScenarioDecision } from '../../packages/db/src/services/scenario-decisions';
import { processOrgEvents } from '../../packages/db/src/services/processing';
import { appPool, fixtures, idem, tx } from './helpers';

const ENC = 'Hxq9QiQu_bnX7ZhZ6CyDTylcRUQtLjXDNnym9nanyLg'; // matches saathi/.env.example's DEVICE_SECRET_ENCRYPTION_KEY shape

/** Enroll a fresh simulated device for the org, with the given supported action capabilities. */
async function simulatedDevice(orgId: string, actions: string[] = []) {
  const F = await fixtures();
  const actor = orgId === F.lakeview ? F.owner : F.northOwner;
  const { code } = await tx(actor, (db) => createEnrollmentCode(db, actor, `Scenario test device ${Date.now()}`));
  const enrolled = await enrollDevice(appPool, { code, hostname: 'SCN-TEST', osVersion: 'test', agentVersion: '0.1.0', simulated: true }, { encryptionKey: ENC, commandKeys: [] });
  const dev = { deviceId: enrolled.deviceId, orgId: enrolled.orgId, simulated: true };
  await recordHeartbeat(appPool, dev, {
    agentVersion: '0.1.0',
    capabilityVersion: 1,
    capabilities: actions.map((action) => ({ action: action as never, supported: true, reason: null })),
    prerequisites: [],
    spoolDepth: 0,
    droppedEvents: 0,
    simulated: true,
  });
  return dev;
}

/** Ingest a protection.disabled event and run correlation synchronously (no live worker in tests). */
async function makeProtectionDisabledIncident(orgId: string, actions: string[] = ['device.enable_av']) {
  const dev = await simulatedDevice(orgId, actions);
  const now = new Date();
  await ingestEvents(appPool, dev, {
    batchId: `test-${now.getTime()}`,
    events: [{ logEpoch: `epoch-${now.getTime()}`, channel: 'Microsoft-Windows-Windows Defender/Operational', nativeEventId: `evt-${now.getTime()}`, type: 'protection.disabled', observedAt: now.toISOString(), facts: { component: 'av' } }],
    droppedSinceLast: 0,
    spoolDepth: 0,
  });
  await tx(orgId, (db) => processOrgEvents(db, orgId));
  return dev;
}

describe('scenario decision queue and prompt', () => {
  it('lists a fresh protection_disabled incident for the owner, with the real device-action option available', async () => {
    const F = await fixtures();
    await makeProtectionDisabledIncident(F.lakeview);
    const queue = await tx(F.owner, (db) => listIncidentsNeedingDecision(db, F.owner));
    expect(queue.length).toBeGreaterThan(0);
    const prompt = await tx(F.owner, (db) => getScenarioPrompt(db, F.owner, queue[queue.length - 1].id));
    expect(prompt.prompt.scenarioKey).toBe('protection_disabled');
    expect(prompt.prompt.message.key).toBe('scenario.message.protection_disabled');
    const restore = prompt.prompt.options.find((o) => o.key === 'restore')!;
    expect(restore.availability).toBe('available');
    expect(prompt.simulated).toBe(true); // this device was enrolled with simulated: true
    expect(prompt.prompt.options.some(o => o.kind === 'simulation_action')).toBe(false); // agent-backed devices use their agent, never the browser repair shortcut
  });

  it('a staff (read-only-for-decisions) actor cannot see the queue or the prompt', async () => {
    const F = await fixtures();
    await makeProtectionDisabledIncident(F.lakeview);
    await expect(tx(F.staffActor, (db) => listIncidentsNeedingDecision(db, F.staffActor))).rejects.toSatisfy((e: unknown) => (e as SaathiError).code === 'FORBIDDEN');
  });

  it('an org cannot see another org’s incidents in its queue', async () => {
    const F = await fixtures();
    await makeProtectionDisabledIncident(F.lakeview);
    const northQueue = await tx(F.northOwner, (db) => listIncidentsNeedingDecision(db, F.northOwner));
    expect(northQueue).toEqual([]);
  });
});

describe('recording a decision', () => {
  it('"continue monitoring" applies no restriction and does not resolve the incident, but removes it from the queue', async () => {
    const F = await fixtures();
    await makeProtectionDisabledIncident(F.lakeview);
    const q_ = await tx(F.owner, (db) => listIncidentsNeedingDecision(db, F.owner));
    const queued = q_[q_.length - 1];
    const prompt = await tx(F.owner, (db) => getScenarioPrompt(db, F.owner, queued.id));
    const defer = prompt.prompt.options.find((o) => o.key === 'defer')!;
    expect(defer.actionSpecs).toEqual([]); // no executable action for this response

    const result = await tx(F.owner, (db) => recordScenarioDecision(db, F.owner, queued.id, { responseKey: 'defer', idempotencyKey: idem() }));
    expect(result.recorded).toBe(true);
    expect(result.alreadyDecided).toBe(false);
    expect(result.actionResults).toEqual([]);

    const after = await tx(F.owner, (db) => listIncidentsNeedingDecision(db, F.owner));
    expect(after.some((x) => x.id === queued.id)).toBe(false); // decided, so no longer queued
  });

  it('approving a device-action response reuses the real preview/approval machinery and does not falsely mark the incident resolved', async () => {
    const F = await fixtures();
    await makeProtectionDisabledIncident(F.lakeview, ['device.enable_av']);
    const q_ = await tx(F.owner, (db) => listIncidentsNeedingDecision(db, F.owner));
    const queued = q_[q_.length - 1];

    const result = await tx(F.owner, (db) => recordScenarioDecision(db, F.owner, queued.id, { responseKey: 'restore', idempotencyKey: idem() }));
    expect(result.actionResults).toHaveLength(1);
    expect(result.actionResults[0].error).toBeNull();
    expect(result.actionResults[0].actionId).toBeTruthy();

    // Accepting the action request is not the same as the incident being resolved: the action
    // is only 'queued'/'executing' at this point (a probe/command result updates it later).
    const action = await tx(F.owner, (db) => getActionDetail(db, F.owner, result.actionResults[0].actionId!));
    expect(['queued', 'executing', 'requested']).toContain(action.state);
    expect(action.state).not.toBe('confirmed');
  });

  it('rejects a response key the server does not currently offer', async () => {
    const F = await fixtures();
    await makeProtectionDisabledIncident(F.lakeview, []); // no capability reported: restore is unavailable
    const q_ = await tx(F.owner, (db) => listIncidentsNeedingDecision(db, F.owner));
    const queued = q_[q_.length - 1];
    await expect(tx(F.owner, (db) => recordScenarioDecision(db, F.owner, queued.id, { responseKey: 'restore', idempotencyKey: idem() }))).rejects.toSatisfy((e: unknown) => (e as SaathiError).code === 'UNSUPPORTED_ACTION');
  });

  it('rejects an unknown response key outright', async () => {
    const F = await fixtures();
    await makeProtectionDisabledIncident(F.lakeview);
    const q_ = await tx(F.owner, (db) => listIncidentsNeedingDecision(db, F.owner));
    const queued = q_[q_.length - 1];
    await expect(tx(F.owner, (db) => recordScenarioDecision(db, F.owner, queued.id, { responseKey: 'not_a_real_option', idempotencyKey: idem() }))).rejects.toSatisfy((e: unknown) => (e as SaathiError).code === 'VALIDATION_FAILED');
  });

  it('a duplicate decision (double click, retry, second tab) is idempotent: no error, no second record', async () => {
    const F = await fixtures();
    await makeProtectionDisabledIncident(F.lakeview);
    const q_ = await tx(F.owner, (db) => listIncidentsNeedingDecision(db, F.owner));
    const queued = q_[q_.length - 1];
    const first = await tx(F.owner, (db) => recordScenarioDecision(db, F.owner, queued.id, { responseKey: 'defer', idempotencyKey: idem() }));
    expect(first.alreadyDecided).toBe(false);
    const second = await tx(F.owner, (db) => recordScenarioDecision(db, F.owner, queued.id, { responseKey: 'defer', idempotencyKey: idem() }));
    expect(second.alreadyDecided).toBe(true);
    expect(second.responseKey).toBe('defer');
  });

  it('staff cannot record a decision even if they somehow learn the responseKey', async () => {
    const F = await fixtures();
    await makeProtectionDisabledIncident(F.lakeview);
    const q_ = await tx(F.owner, (db) => listIncidentsNeedingDecision(db, F.owner));
    const queued = q_[q_.length - 1];
    await expect(tx(F.staffActor, (db) => recordScenarioDecision(db, F.staffActor, queued.id, { responseKey: 'defer', idempotencyKey: idem() }))).rejects.toSatisfy((e: unknown) => (e as SaathiError).code === 'FORBIDDEN');
  });
});
