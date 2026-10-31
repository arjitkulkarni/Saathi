import { z } from 'zod';
import { Role } from '@saathi/contracts';
import { createInvitation } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { readJson, userRoute } from '@/server/api';
import { env } from '@/server/env';

// No email provider is configured (D-017): the one-use link is returned once to the owner.
export const POST = userRoute(
  async ({ req, ctx }) => {
    const { email, role } = await readJson(req, z.object({ email: z.string().email().max(200), role: Role }));
    const r = await actorTx(ctx, (db) => createInvitation(db, ctx.actor, email, role));
    return { link: `${env().APP_ORIGIN}/login?invite=${r.token}`, expiresAt: r.expiresAt };
  },
  { status: 201 },
);
