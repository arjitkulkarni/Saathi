import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { msg, SaathiError, type CampaignDTO, type Msg, type ScamCheckDTO, type ScamVerdict } from '@saathi/contracts';
import { assessMessage, can, PRESETS, RULE_VERSIONS } from '@saathi/domain';
import type { Db } from '../client';
import { authUser, campaignReports, memberships, scamChecks } from '../schema';
import { enqueue, hmacHex, recordIntent, requireMembership, type Actor } from './core';
import { upsertFinding } from './incidents';
import { createNotifications } from './processing';

export const MAX_MESSAGE_CHARS = 5000;

export type ScamInput = { text: string; inputKind: 'text' | 'image'; attachmentRef?: string | null; attachmentExpiresAt?: Date | null; externalProcessingConsent: boolean; channel?: 'web' | 'telegram' };

/**
 * Run deterministic checks on reviewed text (build.md Ph13). The fingerprint and campaign
 * key are HMACs keyed per tenant, not plain hashes of a predictable private message.
 */
export async function createScamCheck(db: Db, actor: Actor, input: ScamInput, cfg: { fingerprintSecret: string; aiConfigured: boolean; textRetentionHours: number }) {
  await requireMembership(db, actor, 'scam.submit');
  const text = input.text.slice(0, MAX_MESSAGE_CHARS);
  const a = assessMessage(text, { reputationAvailable: false });
  const fingerprint = hmacHex(`${cfg.fingerprintSecret}:${actor.orgId}`, text.trim().toLowerCase().replace(/\s+/g, ' '));
  const campaignKey = hmacHex(`${cfg.fingerprintSecret}:${actor.orgId}:campaign`, a.campaignBasis);
  const wantsAi = input.externalProcessingConsent && cfg.aiConfigured && a.verdict !== 'insufficient_information';
  const [row] = await db
    .insert(scamChecks)
    .values({
      orgId: actor.orgId,
      reporterUserId: actor.userId,
      inputKind: input.inputKind,
      channel: input.channel ?? 'web',
      reviewedText: text,
      fingerprint,
      campaignKey,
      domains: a.domains,
      findings: { reasons: a.reasons, uncertainty: a.uncertainty, nextSteps: a.nextSteps, signals: a.signals, missingChecks: a.missingChecks, rulesVersion: a.rulesVersion },
      verdict: a.verdict,
      aiStatus: wantsAi ? 'pending' : input.externalProcessingConsent && !cfg.aiConfigured ? 'unavailable' : 'not_requested',
      externalProcessingConsent: input.externalProcessingConsent,
      attachmentRef: input.attachmentRef ?? null,
      attachmentExpiresAt: input.attachmentExpiresAt ?? null,
      textExpiresAt: new Date(Date.now() + cfg.textRetentionHours * 3600 * 1000),
    })
    .returning({ id: scamChecks.id });
  if (wantsAi) await enqueue(db, { orgId: actor.orgId, type: 'scam.explain', payload: { scamCheckId: row.id }, dedupeKey: `scam.explain:${row.id}` });
  if (input.attachmentRef && input.attachmentExpiresAt) await enqueue(db, { orgId: actor.orgId, type: 'attachment.delete', payload: { scamCheckId: row.id }, dedupeKey: `attachment.delete:${row.id}`, runAt: input.attachmentExpiresAt });
  await recordIntent(db, actor.orgId, 'scam_check.assessed', { scamCheckId: row.id, verdict: a.verdict, rulesVersion: a.rulesVersion, signals: a.signals, by: actor.userId });
  return { id: row.id, verdict: a.verdict };
}

export async function getScamCheck(db: Db, actor: Actor, id: string): Promise<ScamCheckDTO> {
  const { role } = await requireMembership(db, actor, 'scam.submit');
  const [r] = await db.select().from(scamChecks).where(and(eq(scamChecks.orgId, actor.orgId), eq(scamChecks.id, id)));
  const isOwn = r?.reporterUserId === actor.userId;
  // Staff see only their own checks; reviewers see reported checks in minimized form.
  if (!r || (!isOwn && !(can(role, 'scam.review') && r.reported))) throw new SaathiError('NOT_FOUND', 'Assessment not found.');
  const f = r.findings as { reasons: Msg[]; uncertainty: Msg[]; nextSteps: Msg[]; missingChecks: Msg[] };
  const textAvailable = isOwn && r.reviewedText && (!r.textExpiresAt || r.textExpiresAt.getTime() > Date.now());
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    verdict: r.verdict as ScamVerdict,
    reasons: f.reasons,
    uncertainty: f.uncertainty,
    nextSteps: f.nextSteps,
    domains: (r.domains as { display: string; ascii: string; flags: string[] }[]).map((d) => ({ display: d.display, ascii: d.ascii, flags: d.flags })),
    missingChecks: f.missingChecks,
    aiExplanation: r.aiExplanation,
    aiStatus: r.aiStatus as ScamCheckDTO['aiStatus'],
    inputKind: r.inputKind as 'text' | 'image',
    textPreview: textAvailable ? r.reviewedText : null,
    reported: r.reported,
    campaignId: r.campaignId,
    isOwn,
  };
}

export async function listOwnScamChecks(db: Db, actor: Actor) {
  await requireMembership(db, actor, 'scam.submit');
  const rows = await db.select({ id: scamChecks.id, verdict: scamChecks.verdict, createdAt: scamChecks.createdAt, reported: scamChecks.reported, inputKind: scamChecks.inputKind }).from(scamChecks).where(and(eq(scamChecks.orgId, actor.orgId), eq(scamChecks.reporterUserId, actor.userId))).orderBy(desc(scamChecks.createdAt)).limit(20);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/**
 * Report a check to approvers. Three distinct staff reporting a matching campaign within
 * 24 hours groups it into a campaign for review (build.md Ph06 preset).
 */
export async function reportScamCheck(db: Db, actor: Actor, id: string) {
  await requireMembership(db, actor, 'scam.submit');
  const [r] = await db.select().from(scamChecks).where(and(eq(scamChecks.orgId, actor.orgId), eq(scamChecks.id, id), eq(scamChecks.reporterUserId, actor.userId))).for('update');
  if (!r) throw new SaathiError('NOT_FOUND', 'Assessment not found.');
  if (r.reported) return { campaignId: r.campaignId };
  await db.update(scamChecks).set({ reported: true }).where(eq(scamChecks.id, r.id));
  const since = new Date(Date.now() - PRESETS.repeatedScam.windowHours * 3600 * 1000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(DISTINCT ${scamChecks.reporterUserId})::int` })
    .from(scamChecks)
    .where(and(eq(scamChecks.orgId, actor.orgId), eq(scamChecks.campaignKey, r.campaignKey!), eq(scamChecks.reported, true), gte(scamChecks.createdAt, since)));
  let campaignId: string | null = null;
  await recordIntent(db, actor.orgId, 'scam_check.reported', { scamCheckId: r.id, by: actor.userId });
  if (n >= PRESETS.repeatedScam.reporters) {
    const domains = [...new Set((r.domains as { registrable: string }[]).map((d) => d.registrable))];
    const [existing] = await db.select().from(campaignReports).where(and(eq(campaignReports.orgId, actor.orgId), eq(campaignReports.campaignKey, r.campaignKey!), eq(campaignReports.status, 'open')));
    if (existing) {
      campaignId = existing.id;
      await db.update(campaignReports).set({ reporterCount: n, lastAt: new Date() }).where(eq(campaignReports.id, existing.id));
    } else {
      const [c] = await db
        .insert(campaignReports)
        .values({ orgId: actor.orgId, campaignKey: r.campaignKey!, reporterCount: n, verdict: r.verdict, summary: { domains, signals: (r.findings as { signals: string[] }).signals }, firstAt: since, lastAt: new Date() })
        .returning({ id: campaignReports.id });
      campaignId = c.id;
      const res = await upsertFinding(db, actor.orgId, {
        ruleId: 'repeated_scam',
        ruleVersion: RULE_VERSIONS.repeated_scam,
        family: 'scam_campaign',
        correlationKey: `campaign:${c.id}`,
        urgency: 'review_today',
        harmfulCapability: 'message.delivery',
        target: { type: 'org', id: actor.orgId },
        title: msg('incident.title.scam_campaign'),
        facts: [msg('fact.campaign_reports', { count: n, hours: PRESETS.repeatedScam.windowHours, domains: domains.join(', ') })],
        uncertain: [msg('uncertain.campaign_heuristic')],
        boundaries: [msg('boundary.cannot_block_external_messages')],
        initialStatus: 'open',
        subject: {},
      }, {});
      await db.update(campaignReports).set({ incidentId: res.incidentId }).where(eq(campaignReports.id, c.id));
    }
    await db.update(scamChecks).set({ campaignId }).where(and(eq(scamChecks.orgId, actor.orgId), eq(scamChecks.campaignKey, r.campaignKey!)));
  }
  return { campaignId };
}

export async function getCampaign(db: Db, actor: Actor, id: string): Promise<CampaignDTO> {
  await requireMembership(db, actor, 'scam.review');
  const [c] = await db.select().from(campaignReports).where(and(eq(campaignReports.orgId, actor.orgId), eq(campaignReports.id, id)));
  if (!c) throw new SaathiError('NOT_FOUND', 'Campaign not found.');
  const users = c.recipients.length ? await db.select({ id: authUser.id, name: authUser.name }).from(authUser).where(inArray(authUser.id, c.recipients.map((r) => r.userId))) : [];
  return {
    id: c.id,
    status: c.status as CampaignDTO['status'],
    reporterCount: c.reporterCount,
    firstAt: c.firstAt.toISOString(),
    lastAt: c.lastAt.toISOString(),
    domains: (c.summary as { domains: string[] }).domains,
    verdict: c.verdict as ScamVerdict,
    warnedAt: c.warnedAt?.toISOString() ?? null,
    recipients: c.recipients.map((r) => ({ userId: r.userId, name: users.find((u) => u.id === r.userId)?.name ?? '', status: r.status })),
    // Minimal scoped list of current members who may receive an internal warning.
    candidates: (await db.select({ userId: memberships.userId, role: memberships.role, name: authUser.name }).from(memberships).innerJoin(authUser, eq(authUser.id, memberships.userId)).where(and(eq(memberships.orgId, actor.orgId), eq(memberships.status, 'active')))).map((m) => ({ userId: m.userId, name: m.name, role: m.role })),
  };
}

/** Explicitly approved internal warning to scoped, deduplicated recipients (Ph12.4). */
export async function warnCampaign(db: Db, actor: Actor, campaignId: string, recipientUserIds: string[]) {
  await requireMembership(db, actor, 'campaign.warn');
  const [c] = await db.select().from(campaignReports).where(and(eq(campaignReports.orgId, actor.orgId), eq(campaignReports.id, campaignId))).for('update');
  if (!c) throw new SaathiError('NOT_FOUND', 'Campaign not found.');
  const unique = [...new Set(recipientUserIds)].slice(0, 200);
  const members = await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, actor.orgId), eq(memberships.status, 'active'), inArray(memberships.userId, unique.length ? unique : ['-'])));
  if (members.length === 0) throw new SaathiError('VALIDATION_FAILED', 'Choose at least one current member of this organization.');
  const ids = members.map((m) => m.userId);
  await createNotifications(db, actor.orgId, { kind: 'campaign_warning', incidentId: c.incidentId, text: msg('notify.campaign_warning'), dedupe: `campaign:${c.id}`, userIds: ids });
  const recipients = [...c.recipients.filter((r) => !ids.includes(r.userId)), ...ids.map((userId) => ({ userId, status: 'queued' }))];
  await db.update(campaignReports).set({ status: 'warned', warnedAt: new Date(), warnedBy: actor.userId, recipients }).where(eq(campaignReports.id, c.id));
  await recordIntent(db, actor.orgId, 'campaign.warning_sent', { campaignId: c.id, recipients: ids.length, by: actor.userId }, { incidentId: c.incidentId });
  return { recipients: ids.length };
}

export async function scamStats(db: Db, orgId: string) {
  const [r] = await db.select({ n: count() }).from(scamChecks).where(eq(scamChecks.orgId, orgId));
  return Number(r.n);
}
