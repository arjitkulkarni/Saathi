import { redirect } from 'next/navigation';
import { landingPath, requireActorPage } from '@/server/actor';

// Role destinations (flow.md §2): owner/approver → overview, staff → ask, auditor → evidence.
export default async function AppIndex() {
  const ctx = await requireActorPage('/app');
  redirect(landingPath(ctx.actor.role, ctx.dto.setupComplete));
}
