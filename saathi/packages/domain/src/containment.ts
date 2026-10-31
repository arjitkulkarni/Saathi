import { msg, type ContainmentAssessment, type Finding, type IncidentState, type Msg } from '@saathi/contracts';

// Containment assessment (build.md §3, Ph08.6). `contained` means every currently
// identified in-scope harmful capability has a verified restriction or remediation.
// A throttle is reduced exposure, never containment. Unknown coverage prevents it.

export type VerifiedRestriction = {
  actionId: string;
  actionType: string;
  /** Targets whose harmful capability the confirmed action's probes showed restricted. */
  coversTargets: { type: 'session' | 'subject' | 'device'; id: string; capability: string }[];
  state: 'confirmed' | 'partial' | 'failed' | 'unknown';
};

export function findingStatusAfter(f: Finding, verified: VerifiedRestriction[], sessionOwner: (sessionId: string) => string | null): Finding['status'] {
  if (f.status === 'resolved') return 'resolved';
  if (f.status === 'restricted') return 'restricted';
  for (const v of verified) {
    if (v.state !== 'confirmed') continue;
    for (const t of v.coversTargets) {
      if (t.capability !== f.harmfulCapability && !(t.capability === 'records.*' && f.harmfulCapability.startsWith('records.'))) continue;
      if (t.type === f.target.type && t.id === f.target.id) return 'restricted';
      if (t.type === 'subject' && f.target.type === 'session' && sessionOwner(f.target.id) === t.id) return 'restricted';
    }
  }
  return 'open';
}

export function assessContainment(findings: Finding[], verified: VerifiedRestriction[], coverageComplete: boolean, at: string): ContainmentAssessment {
  const reasons: Msg[] = [];
  const open = findings.filter((f) => f.status === 'open');
  const unknownActions = verified.filter((v) => v.state === 'unknown');
  if (findings.length === 0) return { status: 'unknown', reasons: [msg('containment.no_findings')], assessedAt: at };
  if (unknownActions.length > 0) reasons.push(msg('containment.action_outcome_unknown', { count: unknownActions.length }));
  for (const f of open) reasons.push(msg('containment.finding_open', { rule: f.ruleId }));
  if (!coverageComplete) reasons.push(msg('containment.coverage_incomplete'));
  let status: ContainmentAssessment['status'];
  if (open.length === 0 && coverageComplete && unknownActions.length === 0) {
    status = 'contained';
    reasons.push(msg('containment.all_findings_restricted', { count: findings.length }));
  } else if (open.length === 0 && unknownActions.length === 0) {
    // All known findings restricted but scope coverage incomplete.
    status = 'partially_contained';
  } else if (open.length < findings.length) status = 'partially_contained';
  else if (unknownActions.length > 0) status = 'unknown';
  else status = 'not_contained';
  return { status, reasons, assessedAt: at };
}

/** Incident state after re-assessment. Never moves backwards except to investigating. */
export function nextIncidentState(current: IncidentState, assessment: ContainmentAssessment, opts: { newRelevantEvidence?: boolean; previewCreated?: boolean } = {}): IncidentState {
  if (current === 'dismissed') return current;
  if (opts.newRelevantEvidence && ['contained', 'recovering', 'recovered'].includes(current)) return 'investigating';
  if (assessment.status === 'contained' && (current === 'open' || current === 'investigating')) return 'contained';
  if (current === 'contained' && assessment.status !== 'contained') return 'investigating';
  if (opts.previewCreated && current === 'open') return 'investigating';
  return current;
}
