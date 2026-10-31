import { msg, type ActionType, type CheckResult, type HealthDTO, type Msg, type PostureKey } from '@saathi/contracts';

// Transparent posture score (build.md Ph14). Weights are versioned; unknown points are
// shown separately; a stale or disconnected device contributes unknown, never a pass.

export const HEALTH_WEIGHTS_VERSION = 1;
export const HEALTH_WEIGHTS: Record<PostureKey, number> = { av: 25, firewall: 25, updates: 20, lockout: 10, admin_exposure: 10, remote_access: 10 };

export const FIX_ACTIONS: Partial<Record<PostureKey, ActionType>> = {
  av: 'device.enable_av',
  firewall: 'device.enable_firewall',
  lockout: 'device.set_lockout_policy',
};
export const GUIDANCE: Partial<Record<PostureKey, string>> = {
  updates: 'health.guidance.updates',
  admin_exposure: 'health.guidance.admin_exposure',
  remote_access: 'health.guidance.remote_access',
};

export type DevicePostureInput = {
  deviceId: string;
  name: string;
  status: string;
  stale: boolean;
  simulated: boolean;
  supportedActions: string[];
  checks: Partial<Record<PostureKey, { result: string; value: string | null; source: string; observedAt: string }>> | null;
};

export function computeHealth(devices: DevicePostureInput[], at: string): HealthDTO {
  const counted = devices.filter((d) => d.status === 'connected');
  const excluded = devices
    .filter((d) => d.status !== 'connected')
    .map((d) => ({ deviceId: d.deviceId, name: d.name, reason: msg(d.status === 'waiting' ? 'health.excluded.waiting' : 'health.excluded.retired') as Msg }));
  const keys = Object.keys(HEALTH_WEIGHTS) as PostureKey[];
  if (counted.length === 0) {
    return {
      weightsVersion: HEALTH_WEIGHTS_VERSION,
      earned: null,
      unknownPoints: 0,
      devicesCounted: 0,
      devicesExcluded: excluded,
      computedAt: at,
      checks: keys.map((k) => ({ key: k, weight: HEALTH_WEIGHTS[k], earned: 0, unknownPoints: 0, result: 'unknown' as CheckResult, devices: [] })),
    };
  }
  let earnedTotal = 0;
  let unknownTotal = 0;
  const checks = keys.map((k) => {
    const w = HEALTH_WEIGHTS[k];
    let pass = 0;
    let unknown = 0;
    const rows = counted.map((d) => {
      const c = d.checks?.[k];
      // Stale data keeps its last value for display, but scores as unknown.
      const effective: CheckResult = !c || d.stale ? 'unknown' : (c.result as CheckResult);
      if (effective === 'pass') pass++;
      if (effective === 'unknown') unknown++;
      const fix = FIX_ACTIONS[k];
      return {
        deviceId: d.deviceId,
        deviceName: d.name,
        result: effective,
        value: c?.value ?? null,
        observedAt: c?.observedAt ?? null,
        stale: d.stale,
        fixAction: effective === 'fail' && fix && d.supportedActions.includes(fix) ? fix : null,
        guidance: effective === 'fail' && (!fix || !d.supportedActions.includes(fix)) ? msg(GUIDANCE[k] ?? 'health.guidance.generic', { check: k }) : null,
      };
    });
    const earned = (w * pass) / counted.length;
    const unknownPoints = (w * unknown) / counted.length;
    earnedTotal += earned;
    unknownTotal += unknownPoints;
    const result: CheckResult = pass === counted.length ? 'pass' : unknown === counted.length ? 'unknown' : rows.some((r) => r.result === 'fail') ? 'fail' : 'unknown';
    return { key: k, weight: w, earned: Math.round(earned * 10) / 10, unknownPoints: Math.round(unknownPoints * 10) / 10, result, devices: rows };
  });
  return {
    weightsVersion: HEALTH_WEIGHTS_VERSION,
    earned: Math.round(earnedTotal),
    unknownPoints: Math.round(unknownTotal),
    checks,
    devicesCounted: counted.length,
    devicesExcluded: excluded,
    computedAt: at,
  };
}
