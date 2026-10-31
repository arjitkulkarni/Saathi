import 'server-only';
import { SaathiError } from '@saathi/contracts';
import { can } from '@saathi/domain';
import type { ActorContext } from './actor';
import { env } from './env';

/** Demo controls: DEMO_MODE on, synthetic demo organization, demo owner only. */
export function assertDemo(ctx: ActorContext) {
  if (env().DEMO_MODE !== 'on') throw new SaathiError('FORBIDDEN', 'Demonstration controls are disabled on this server.');
  if (!ctx.dto.isDemo) throw new SaathiError('FORBIDDEN', 'Demonstration controls only work on synthetic demonstration organizations.');
  if (!can(ctx.actor.role, 'demo.control')) throw new SaathiError('FORBIDDEN', 'Only the demo owner can use these controls.');
}
