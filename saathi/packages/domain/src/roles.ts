import type { Role } from '@saathi/contracts';

// Role permissions (build.md §1, flow.md §2). Navigation uses this for visibility only;
// every API and server loader re-checks it against the current membership.

export const PERMISSIONS = {
  'org.manage': ['owner'],
  'members.manage': ['owner'],
  'policy.manage': ['owner'],
  'integrations.manage': ['owner'],
  'devices.enroll': ['owner'],
  'devices.retire': ['owner'],
  'devices.read': ['owner', 'approver'],
  'incidents.read': ['owner', 'approver', 'auditor'],
  'incidents.preview': ['owner', 'approver'],
  'actions.approve': ['owner', 'approver'],
  'actions.read': ['owner', 'approver', 'auditor'],
  'incidents.dismiss': ['owner', 'approver'],
  'recovery.manage': ['owner'],
  'people.read': ['owner', 'approver'],
  'people.preview': ['owner', 'approver'],
  'health.read': ['owner', 'approver'],
  'scam.submit': ['owner', 'approver', 'staff'],
  'scam.review': ['owner', 'approver'],
  'campaign.warn': ['owner', 'approver'],
  'evidence.read': ['owner', 'auditor'],
  'evidence.export': ['owner', 'auditor'],
  'anchor.request': ['owner'],
  'reports.read': ['owner', 'auditor'],
  'reports.create': ['owner', 'auditor'],
  'overview.read': ['owner', 'approver'],
  'telegram.link': ['owner', 'approver', 'staff'],
  'demo.control': ['owner'],
  'ops.read': ['owner'],
  'explain.request': ['owner', 'approver', 'auditor'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function landingPath(role: Role, setupComplete: boolean): string {
  if (role === 'owner' && !setupComplete) return '/onboarding';
  if (role === 'staff') return '/app/ask';
  if (role === 'auditor') return '/app/evidence';
  return '/app/overview';
}
