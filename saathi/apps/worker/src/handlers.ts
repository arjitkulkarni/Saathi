import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type pg from 'pg';
import { msg, type Locale, type UnsignedCommand, type Vocabulary } from '@saathi/contracts';
import type { WorkerEnv } from '@saathi/contracts/env';
import {
  aiAvailable,
  buildBatch,
  createCheckpoint,
  deliverNotification,
  enqueue,
  explainScam,
  expireRestriction,
  malwareCheck,
  notifyIncident,
  probeRecordsAction,
  processOrgEvents,
  reassessIncident,
  recordIntent,
  schema as s,
  signPendingIntents,
  staleDevices,
  submitBatch,
  upgradeDueProofs,
  warnRestriction,
  withTx,
  type AnchorConfig,
  type ObjectStore,
  type SigningKey,
} from '@saathi/db';
import { canonicalBytes, sha256Hex, signHash } from '@saathi/evidence';
import { renderMsg } from '@saathi/i18n';
import { PermanentError, type Handler } from './runtime';
import { generateReport, generateWeeklyDigest } from './reports';

export type WorkerDeps = {
  pool: pg.Pool;
  env: WorkerEnv;
  evidenceKey: SigningKey;
  commandKey: SigningKey;
  store: ObjectStore;
  anchor: AnchorConfig;
  log: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void;
};

const need = (orgId: string | null) => {
  if (!orgId) throw new PermanentError('tenant job without org_id');
  return orgId;
};

async function orgInfo(pool: pg.Pool, orgId: string) {
  return withTx(pool, { orgId }, async (db) => (await db.select().from(s.organizations).where(eq(s.organizations.id, orgId)))[0]);
}

export function buildHandlers(d: WorkerDeps): Record<string, Handler> {
  const tx = <T>(orgId: string | null, fn: Parameters<typeof withTx<T>>[2]) => withTx<T>(d.pool, { orgId }, fn);

  return {
    'events.process': async (job) => {
      const orgId = need(job.orgId);
      await tx(orgId, (db) => processOrgEvents(db, orgId));
    },

    'malware.check': async (job) => {
      const orgId = need(job.orgId);
      await tx(orgId, (db) => malwareCheck(db, orgId, job.payload as { eventId: string; deviceId: string }));
    },

    'evidence.sign': async (job) => {
      const orgId = need(job.orgId);
      const r = await tx(orgId, (db) => signPendingIntents(db, orgId, d.evidenceKey));
      if (r.blocked) throw new PermanentError(`evidence signing blocked: ${r.blocked}`);
      // Checkpoint at most every two minutes; the maintenance sweep creates the trailing one.
      if (r.signed > 0 && (!r.lastCheckpointAt || Date.now() - r.lastCheckpointAt.getTime() > 120_000)) {
        await tx(orgId, (db) => createCheckpoint(db, orgId, d.evidenceKey, d.store, { requestedBy: 'policy-worker', anchor: true }));
      }
    },

    'evidence.checkpoint': async (job) => {
      const orgId = need(job.orgId);
      await tx(orgId, (db) => signPendingIntents(db, orgId, d.evidenceKey));
      await tx(orgId, (db) => createCheckpoint(db, orgId, d.evidenceKey, d.store, { requestedBy: 'policy-worker', anchor: true }));
    },

    'action.probe': async (job) => {
      const orgId = need(job.orgId);
      await tx(orgId, (db) => probeRecordsAction(db, orgId, String(job.payload.actionId)));
    },

    // Sign a bounded command with the dedicated command key (build.md Ph09).
    'command.sign': async (job) => {
      const orgId = need(job.orgId);
      await tx(orgId, async (db) => {
        const [c] = await db.select().from(s.agentCommands).where(and(eq(s.agentCommands.orgId, orgId), eq(s.agentCommands.actionId, String(job.payload.actionId)))).for('update');
        if (!c || c.status !== 'pending_signature') return;
        const [a] = await db.select().from(s.actions).where(eq(s.actions.id, c.actionId));
        if (!a || a.state !== 'queued') return;
        const now = new Date();
        const unsigned: UnsignedCommand = {
          schemaVersion: 1,
          id: c.id,
          orgId,
          deviceId: c.deviceId,
          actionId: c.actionId,
          type: c.type as UnsignedCommand['type'],
          params: c.params as UnsignedCommand['params'],
          expectedStateHash: c.expectedStateHash,
          issuedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + d.env.COMMAND_TTL_SECONDS * 1000).toISOString(),
          nonce: c.nonce,
          keyId: d.commandKey.keyId,
        };
        const signature = signHash(sha256Hex(canonicalBytes(unsigned)), d.commandKey.secretKey);
        await db
          .update(s.agentCommands)
          .set({ status: 'signed', envelope: { ...unsigned, signature }, keyId: d.commandKey.keyId, issuedAt: now, expiresAt: new Date(unsigned.expiresAt) })
          .where(eq(s.agentCommands.id, c.id));
        await enqueue(db, { orgId, type: 'command.expire', payload: { actionId: c.actionId }, dedupeKey: `command.expire:${c.actionId}:signed`, runAt: new Date(new Date(unsigned.expiresAt).getTime() + 15_000) });
        await recordIntent(db, orgId, 'command.queued', { commandId: c.id, actionId: c.actionId, type: c.type, expiresAt: unsigned.expiresAt, keyId: d.commandKey.keyId }, { incidentId: a.incidentId });
      });
    },

    // Expired commands never execute later; delivered-but-silent ones become unknown.
    'command.expire': async (job) => {
      const orgId = need(job.orgId);
      await tx(orgId, async (db) => {
        const [c] = await db.select().from(s.agentCommands).where(and(eq(s.agentCommands.orgId, orgId), eq(s.agentCommands.actionId, String(job.payload.actionId)))).for('update');
        if (!c || c.result) return;
        const [a] = await db.select().from(s.actions).where(eq(s.actions.id, c.actionId)).for('update');
        if (!a) return;
        const now = new Date();
        if (c.status === 'pending_signature' && now.getTime() - c.createdAt.getTime() < 5 * 60 * 1000) return;
        if (c.expiresAt && c.expiresAt.getTime() > now.getTime()) return;
        let state: 'expired' | 'unknown';
        if (c.status === 'delivered') state = 'unknown';
        else state = 'expired';
        await db.update(s.agentCommands).set({ status: state === 'expired' ? 'expired' : 'delivered' }).where(eq(s.agentCommands.id, c.id));
        if (['queued', 'executing'].includes(a.state)) {
          await db.update(s.actions).set({ state, updatedAt: now, completedAt: state === 'expired' ? now : null }).where(eq(s.actions.id, a.id));
          if (a.incidentId) {
            await db.insert(s.incidentHistory).values({ orgId, incidentId: a.incidentId, kind: 'action_outcome', text: msg('history.action_outcome', { action: a.actionType, state }), actionId: a.id });
            await reassessIncident(db, orgId, a.incidentId);
          }
          await recordIntent(db, orgId, state === 'expired' ? 'command.expired' : 'command.result_missing', { commandId: c.id, actionId: a.id }, { incidentId: a.incidentId });
        }
      });
    },

    'restriction.warn': async (job) => {
      const orgId = need(job.orgId);
      await tx(orgId, (db) => warnRestriction(db, orgId, String(job.payload.restrictionId)));
    },
    'restriction.expire': async (job) => {
      const orgId = need(job.orgId);
      await tx(orgId, (db) => expireRestriction(db, orgId, String(job.payload.restrictionId)));
    },

    'notify.incident': async (job) => {
      const orgId = need(job.orgId);
      await tx(orgId, (db) => notifyIncident(db, orgId, String(job.payload.incidentId)));
    },

    'notify.deliver': async (job) => {
      const orgId = need(job.orgId);
      const org = await orgInfo(d.pool, orgId);
      const result = await tx(orgId, (db) =>
        deliverNotification(db, orgId, String(job.payload.notificationId), {
          token: d.env.TELEGRAM_BOT_TOKEN,
          appOrigin: d.env.APP_ORIGIN,
          render: (key, params) => renderMsg({ key, params: params as Record<string, string> }, { locale: (org?.locale as Locale) ?? 'en', vocabulary: (org?.vocabulary as Vocabulary) ?? 'generic', timezone: org?.timezone ?? 'UTC' }),
        }),
      );
      // Failure was recorded and committed; now ask the runtime to retry with backoff.
      if (result === 'failed') throw new Error('Telegram delivery failed; will retry');
    },

    'scam.explain': async (job) => {
      const orgId = need(job.orgId);
      const cfg = { apiKey: d.env.ANTHROPIC_API_KEY, model: d.env.AI_MODEL };
      const org = await orgInfo(d.pool, orgId);
      const ro = { locale: (org?.locale as Locale) ?? 'en', vocabulary: (org?.vocabulary as Vocabulary) ?? 'generic', timezone: org?.timezone ?? 'UTC' };
      const row = await tx(orgId, async (db) => (await db.select().from(s.scamChecks).where(and(eq(s.scamChecks.orgId, orgId), eq(s.scamChecks.id, String(job.payload.scamCheckId)))))[0]);
      if (!row || row.aiStatus !== 'pending' || !row.externalProcessingConsent || !row.reviewedText) return;
      const f = row.findings as { reasons: { key: string; params: Record<string, string> }[]; uncertainty: { key: string; params: Record<string, string> }[] };
      const out = aiAvailable(cfg)
        ? await explainScam(cfg, {
            language: ro.locale === 'kn' ? 'Kannada' : ro.locale === 'hi' ? 'Hindi' : 'English',
            text: row.reviewedText,
            verdictLabel: renderMsg({ key: `status.verdict.${row.verdict}`, params: {} }, ro),
            reasons: f.reasons.map((m) => renderMsg(m, ro)),
            uncertainty: f.uncertainty.map((m) => renderMsg(m, ro)),
          })
        : null;
      await tx(orgId, (db) => db.update(s.scamChecks).set({ aiStatus: out ? 'used' : aiAvailable(cfg) ? 'failed' : 'unavailable', aiExplanation: out?.explanation ?? null }).where(eq(s.scamChecks.id, row.id)));
    },

    'attachment.delete': async (job) => {
      const orgId = need(job.orgId);
      const row = await tx(orgId, async (db) => (await db.select().from(s.scamChecks).where(and(eq(s.scamChecks.orgId, orgId), eq(s.scamChecks.id, String(job.payload.scamCheckId)))))[0]);
      if (!row?.attachmentRef) return;
      await d.store.delete(row.attachmentRef);
      await tx(orgId, (db) => db.update(s.scamChecks).set({ attachmentRef: null }).where(eq(s.scamChecks.id, row.id)));
    },

    'anchor.batch': async () => {
      const orgIds = await withTx(d.pool, {}, async (_db, c) => (await c.query('SELECT saathi_worker_org_ids() AS id')).rows.map((r) => r.id as string));
      const r = await buildBatch(d.pool, orgIds);
      if (r) d.log('info', 'anchor batch created', r);
    },
    'anchor.submit': async (job) => {
      await submitBatch(d.pool, String(job.payload.batchId), d.anchor);
    },
    'anchor.upgrade': async () => {
      const r = await upgradeDueProofs(d.pool, d.anchor);
      if (r.length) d.log('info', 'anchor upgrade pass', { results: r });
    },

    'report.generate': async (job) => {
      const orgId = need(job.orgId);
      await generateReport(d, orgId, String(job.payload.reportId));
    },
    'digest.weekly': async (job) => {
      const orgId = need(job.orgId);
      await generateWeeklyDigest(d, orgId);
    },

    // Retention proposals (build.md Ph17.6): raw telemetry, message text, report artifacts.
    retention: async (job) => {
      const orgId = need(job.orgId);
      const org = await orgInfo(d.pool, orgId);
      const r = org?.retention ?? { telemetryDays: d.env.RETENTION_TELEMETRY_DAYS, messageImageHours: d.env.RETENTION_MESSAGE_IMAGE_HOURS, reportDays: d.env.RETENTION_REPORT_DAYS };
      await tx(orgId, async (db) => {
        const cutoff = new Date(Date.now() - r.telemetryDays * 86400_000);
        await db.delete(s.rawEvents).where(and(eq(s.rawEvents.orgId, orgId), lt(s.rawEvents.observedAt, cutoff), sql`${s.rawEvents.processedAt} IS NOT NULL`));
        await db.delete(s.signals).where(and(eq(s.signals.orgId, orgId), lt(s.signals.lastAt, cutoff)));
        await db.delete(s.deviceNonces).where(and(eq(s.deviceNonces.orgId, orgId), lt(s.deviceNonces.seenAt, new Date(Date.now() - 86400_000))));
        await db.update(s.scamChecks).set({ reviewedText: null }).where(and(eq(s.scamChecks.orgId, orgId), lt(s.scamChecks.textExpiresAt, new Date())));
      });
      const expired = await tx(orgId, (db) => db.select().from(s.reports).where(and(eq(s.reports.orgId, orgId), lt(s.reports.expiresAt, new Date()), sql`${s.reports.artifactRef} IS NOT NULL`)));
      for (const rep of expired) {
        for (const ref of [rep.artifactRef, rep.bundleRef, rep.artifactRef?.replace(/report\.pdf$/, 'export-manifest.json')]) if (ref) await d.store.delete(ref);
        await tx(orgId, (db) => db.update(s.reports).set({ artifactRef: null, bundleRef: null }).where(eq(s.reports.id, rep.id)));
      }
    },

    // Per-organization sweep: stale agents, overdue expiries, trailing checkpoint.
    'org.maintenance': async (job) => {
      const orgId = need(job.orgId);
      await tx(orgId, async (db) => {
        for (const dev of await staleDevices(db, orgId)) {
          await enqueue(db, { orgId, type: 'notify.device_stale', payload: { deviceId: dev.id }, dedupeKey: `device_stale:${dev.id}:${dev.lastSeenAt?.getTime() ?? 0}` });
        }
        const overdue = await db.select({ id: s.restrictions.id }).from(s.restrictions).where(and(eq(s.restrictions.orgId, orgId), isNull(s.restrictions.liftedAt), eq(s.restrictions.kind, 'throttle'), lt(s.restrictions.expiresAt, new Date())));
        for (const r of overdue) await expireRestriction(db, orgId, r.id);
        const silent = await db.select({ actionId: s.agentCommands.actionId }).from(s.agentCommands).where(and(eq(s.agentCommands.orgId, orgId), inArray(s.agentCommands.status, ['signed', 'delivered']), lt(s.agentCommands.expiresAt, new Date(Date.now() - 15_000)), isNull(s.agentCommands.resultReceivedAt)));
        for (const c of silent) await enqueue(db, { orgId, type: 'command.expire', payload: { actionId: c.actionId }, dedupeKey: `command.expire:${c.actionId}:sweep:${Math.floor(Date.now() / 60000)}` });
      });
      await tx(orgId, (db) => signPendingIntents(db, orgId, d.evidenceKey));
      await tx(orgId, async (db) => {
        const [h] = await db.select().from(s.evidenceChainHeads).where(eq(s.evidenceChainHeads.orgId, orgId));
        if (h && Number(h.lastSignedSeq) > Number(h.lastCheckpointSeq) && (!h.lastCheckpointAt || Date.now() - h.lastCheckpointAt.getTime() > 120_000)) {
          await createCheckpoint(db, orgId, d.evidenceKey, d.store, { requestedBy: 'policy-worker', anchor: true });
        }
      });
    },

    'notify.device_stale': async (job) => {
      const orgId = need(job.orgId);
      await tx(orgId, async (db) => {
        const { createNotifications } = await import('@saathi/db');
        await createNotifications(db, orgId, { kind: 'device_stale', incidentId: null, text: msg('notify.device_needs_review'), dedupe: `device_stale:${job.payload.deviceId}:${job.id}` });
      });
    },
  };
}
