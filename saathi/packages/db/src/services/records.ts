import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { msg, SaathiError, type AnchorState, type CheckpointDTO, type CheckpointGraphDTO, type Msg, type ReportDTO } from '@saathi/contracts';
import { BUNDLE_FORMAT, bytesToB64, EVIDENCE_SCHEMA_VERSION, RETAINED_FORMAT, type EvidenceBundle, type RetainedCheckpoint } from '@saathi/evidence';
import type { Db } from '../client';
import { actionProbes, actions, anchorBatches, anchorMembers, anchorProofs, checkpoints, evidenceChainHeads, evidenceEntries, evidenceIntents, incidentFindings, incidents, recoveryCases, reportAccessLog, reports } from '../schema';
import { enqueue, recordIntent, requireMembership, type Actor } from './core';
import { anchorStatusForCheckpoint } from './anchor';
import { checkpointFromRow, orgRef, requestAnchor } from './evidence';
import { summarizeEntry } from './evidence-summary';

// ------------------------------------------------------------------ evidence views

export async function evidenceStatus(db: Db, orgId: string) {
  const [h] = await db.select().from(evidenceChainHeads).where(eq(evidenceChainHeads.orgId, orgId));
  const pending = h ? Number(h.nextIntentSeq) - 1 - Number(h.lastSignedSeq) : 0;
  return { pendingIntents: pending, lastSignedSeq: Number(h?.lastSignedSeq ?? 0), blockedReason: h?.blockedReason ?? null, lastCheckpointSeq: Number(h?.lastCheckpointSeq ?? 0) };
}

export async function listCheckpoints(db: Db, actor: Actor): Promise<{ items: CheckpointDTO[]; status: Awaited<ReturnType<typeof evidenceStatus>> }> {
  await requireMembership(db, actor, 'evidence.read');
  const rows = await db.select().from(checkpoints).where(eq(checkpoints.orgId, actor.orgId)).orderBy(desc(checkpoints.seq)).limit(50);
  const status = await evidenceStatus(db, actor.orgId);
  const items: CheckpointDTO[] = [];
  for (const r of rows) {
    const { memberId: _m, ...anchor } = await anchorStatusForCheckpoint(db, r.id, r.isSample);
    void _m;
    items.push({ id: r.id, seq: Number(r.seq), headHash: r.headHash, createdAt: r.createdAt, keyId: r.keyId, signatureState: 'signed', anchor, pendingIntents: status.pendingIntents });
  }
  return { items, status };
}

export async function getCheckpoint(db: Db, actor: Actor, id: string) {
  const { role } = await requireMembership(db, actor, 'evidence.read');
  const [r] = await db.select().from(checkpoints).where(and(eq(checkpoints.orgId, actor.orgId), eq(checkpoints.id, id)));
  if (!r) throw new SaathiError('NOT_FOUND', 'Checkpoint not found.');
  const anchor = await anchorStatusForCheckpoint(db, r.id, r.isSample);
  const [m] = await db.select().from(anchorMembers).where(eq(anchorMembers.checkpointId, r.id));
  const [batch] = m?.batchId ? await db.select().from(anchorBatches).where(eq(anchorBatches.id, m.batchId)) : [];
  const types = await db.select({ type: evidenceEntries.type, n: sql<number>`count(*)::int` }).from(evidenceEntries).where(and(eq(evidenceEntries.orgId, actor.orgId), lte(evidenceEntries.seq, r.seq))).groupBy(evidenceEntries.type);
  return {
    id: r.id,
    seq: Number(r.seq),
    createdAt: r.createdAt,
    headHash: r.headHash,
    keyId: r.keyId,
    hash: r.hash,
    signature: r.signature,
    isSample: r.isSample,
    retained: !!r.retainedRef,
    entryTypes: types,
    anchor: { ...anchor, commitmentHex: m?.commitmentHex ?? null, path: m?.path ?? null, rootHex: batch?.rootHex ?? null, merkleVersion: batch?.merkleVersion ?? null },
    canRequestAnchor: role === 'owner' && anchor.state === 'not_requested',
    canExport: role === 'owner' || role === 'auditor',
  };
}

/**
 * Chain, for people rather than tools: each signed entry up to this checkpoint as a node
 * with its hash and the previous node's hash (the real chain link), plus a plain-language
 * gloss on click. Never the raw payload or signature.
 */
export async function getCheckpointGraph(db: Db, actor: Actor, id: string): Promise<CheckpointGraphDTO> {
  await requireMembership(db, actor, 'evidence.read');
  const [r] = await db.select().from(checkpoints).where(and(eq(checkpoints.orgId, actor.orgId), eq(checkpoints.id, id)));
  if (!r) throw new SaathiError('NOT_FOUND', 'Checkpoint not found.');
  const [prior] = await db
    .select({ seq: checkpoints.seq })
    .from(checkpoints)
    .where(and(eq(checkpoints.orgId, actor.orgId), lte(checkpoints.seq, r.seq), sql`${checkpoints.seq} <> ${r.seq}`))
    .orderBy(desc(checkpoints.seq))
    .limit(1);
  const from = prior ? Number(prior.seq) + 1 : 1;
  const rows = await db
    .select({ seq: evidenceEntries.seq, type: evidenceEntries.type, occurredAt: evidenceEntries.occurredAt, payload: evidenceEntries.payload, hash: evidenceEntries.hash, prevHash: evidenceEntries.prevHash })
    .from(evidenceEntries)
    .where(and(eq(evidenceEntries.orgId, actor.orgId), gt(evidenceEntries.seq, from - 1), lte(evidenceEntries.seq, r.seq)))
    .orderBy(asc(evidenceEntries.seq))
    .limit(500);
  const anchor = await anchorStatusForCheckpoint(db, r.id, r.isSample);
  return {
    checkpoint: { id: r.id, seq: Number(r.seq), createdAt: r.createdAt, anchor },
    entries: rows.map((e) => ({ id: `${actor.orgId}:${e.seq}`, seq: Number(e.seq), occurredAt: e.occurredAt, summary: summarizeEntry(e.type, e.payload), hash: e.hash, prevHash: e.prevHash })),
  };
}

/**
 * Evidence bundle export (build.md Ph15.4). Prototype scope: the complete minimized chain
 * up to the checkpoint, for owners/auditors of (synthetic) organizations.
 */
export async function buildEvidenceBundle(db: Db, actor: Actor, checkpointId: string): Promise<EvidenceBundle> {
  await requireMembership(db, actor, 'evidence.export');
  const bundle = await bundleForCheckpoint(db, actor.orgId, checkpointId);
  await recordIntent(db, actor.orgId, 'evidence.exported', { checkpointId, seq: bundle.checkpoint.seq, by: actor.userId });
  return bundle;
}

/** Internal (worker/report) bundle builder; callers must already be authorized for orgId. */
export async function bundleForCheckpoint(db: Db, orgId: string, checkpointId: string): Promise<EvidenceBundle> {
  const actor = { orgId };
  const [r] = await db.select().from(checkpoints).where(and(eq(checkpoints.orgId, actor.orgId), eq(checkpoints.id, checkpointId)));
  if (!r) throw new SaathiError('NOT_FOUND', 'Checkpoint not found.');
  const entries = await db.select().from(evidenceEntries).where(and(eq(evidenceEntries.orgId, actor.orgId), lte(evidenceEntries.seq, r.seq))).orderBy(asc(evidenceEntries.seq));
  const [m] = await db.select().from(anchorMembers).where(eq(anchorMembers.checkpointId, r.id));
  const [batch] = m?.batchId ? await db.select().from(anchorBatches).where(eq(anchorBatches.id, m.batchId)) : [];
  const [proof] = m?.batchId ? await db.select().from(anchorProofs).where(eq(anchorProofs.batchId, m.batchId)) : [];
  return {
    format: BUNDLE_FORMAT,
    version: 1,
    orgRef: orgRef(actor.orgId),
    exportedAt: new Date().toISOString(),
    scopeNote: 'Prototype export: complete minimized organization chain up to this checkpoint. Synthetic data only.',
    entries: entries.map((e) => ({ schemaVersion: e.schemaVersion ?? EVIDENCE_SCHEMA_VERSION, seq: Number(e.seq), orgRef: orgRef(actor.orgId), type: e.type, occurredAt: e.occurredAt, recordedAt: e.recordedAt, payload: e.payload, prevHash: e.prevHash, hash: e.hash, signature: e.signature, keyId: e.keyId })),
    checkpoint: checkpointFromRow(r),
    anchor:
      m && batch && m.path
        ? {
            nonceHex: m.nonceHex,
            commitmentHex: m.commitmentHex,
            merkleVersion: batch.merkleVersion,
            path: m.path,
            rootHex: batch.rootHex,
            rootFileB64: bytesToB64(new Uint8Array(batch.rootFile)),
            otsB64: proof?.otsBytes ? bytesToB64(new Uint8Array(proof.otsBytes)) : null,
            serverStatus: proof?.status ?? 'pending',
            serverVerification:
              proof?.status === 'confirmed' && proof.verificationMethod && proof.bitcoinHeight && proof.blockHash && proof.merkleRootHex
                ? { method: proof.verificationMethod, height: proof.bitcoinHeight, blockHash: proof.blockHash, merkleRootHex: proof.merkleRootHex, verifiedAt: proof.verifiedAt!.toISOString() }
                : null,
            isSample: r.isSample,
          }
        : null,
  };
}

export async function retainedCheckpoint(db: Db, actor: Actor, checkpointId: string): Promise<RetainedCheckpoint> {
  await requireMembership(db, actor, 'evidence.export');
  const [r] = await db.select().from(checkpoints).where(and(eq(checkpoints.orgId, actor.orgId), eq(checkpoints.id, checkpointId)));
  if (!r) throw new SaathiError('NOT_FOUND', 'Checkpoint not found.');
  return { format: RETAINED_FORMAT, checkpoint: checkpointFromRow(r) };
}

export async function requestCheckpointAnchor(db: Db, actor: Actor, checkpointId: string) {
  await requireMembership(db, actor, 'anchor.request');
  const [r] = await db.select().from(checkpoints).where(and(eq(checkpoints.orgId, actor.orgId), eq(checkpoints.id, checkpointId)));
  if (!r) throw new SaathiError('NOT_FOUND', 'Checkpoint not found.');
  await requestAnchor(db, actor.orgId, r.id, checkpointFromRow(r), actor.userId);
  return anchorStatusForCheckpoint(db, r.id, r.isSample);
}

// ------------------------------------------------------------------ reports

export async function createIncidentReport(db: Db, actor: Actor, incidentId: string) {
  await requireMembership(db, actor, 'reports.create');
  const [inc] = await db.select({ id: incidents.id }).from(incidents).where(and(eq(incidents.orgId, actor.orgId), eq(incidents.id, incidentId)));
  if (!inc) throw new SaathiError('NOT_FOUND', 'Incident not found.');
  const [r] = await db.insert(reports).values({ orgId: actor.orgId, kind: 'incident', incidentId, createdBy: actor.userId, expiresAt: new Date(Date.now() + 30 * 86400_000) }).returning({ id: reports.id });
  await enqueue(db, { orgId: actor.orgId, type: 'report.generate', payload: { reportId: r.id }, dedupeKey: `report.generate:${r.id}` });
  // A fresh checkpoint lets the report reference the most recent signed history.
  await enqueue(db, { orgId: actor.orgId, type: 'evidence.checkpoint', payload: { force: true }, dedupeKey: `evidence.checkpoint:${actor.orgId}:report:${r.id}` });
  await recordIntent(db, actor.orgId, 'report.requested', { reportId: r.id, incidentId, by: actor.userId }, { incidentId });
  return { reportId: r.id };
}

async function reportAnchorState(db: Db, checkpointId: string | null): Promise<AnchorState> {
  if (!checkpointId) return 'not_requested';
  const [c] = await db.select({ isSample: checkpoints.isSample }).from(checkpoints).where(eq(checkpoints.id, checkpointId));
  return (await anchorStatusForCheckpoint(db, checkpointId, c?.isSample ?? false)).state;
}

export async function listReports(db: Db, actor: Actor): Promise<ReportDTO[]> {
  await requireMembership(db, actor, 'reports.read');
  const rows = await db.select().from(reports).where(eq(reports.orgId, actor.orgId)).orderBy(desc(reports.createdAt)).limit(50);
  const out: ReportDTO[] = [];
  for (const r of rows) {
    const manifest = r.manifest as { evidence?: { integrity: string } } | null;
    out.push({
      id: r.id,
      kind: r.kind as ReportDTO['kind'],
      title: msg(r.kind === 'weekly' ? 'report.title.weekly' : 'report.title.incident'),
      status: r.status as ReportDTO['status'],
      createdAt: r.createdAt.toISOString(),
      incidentId: r.incidentId,
      periodStart: r.periodStart?.toISOString() ?? null,
      periodEnd: r.periodEnd?.toISOString() ?? null,
      integrityState: (manifest?.evidence?.integrity as ReportDTO['integrityState']) ?? 'none',
      anchorState: await reportAnchorState(db, r.checkpointId),
    });
  }
  return out;
}

export async function getReport(db: Db, actor: Actor, id: string) {
  await requireMembership(db, actor, 'reports.read');
  const [r] = await db.select().from(reports).where(and(eq(reports.orgId, actor.orgId), eq(reports.id, id)));
  if (!r) throw new SaathiError('NOT_FOUND', 'Report not found.');
  return { id: r.id, kind: r.kind, status: r.status, incidentId: r.incidentId, createdAt: r.createdAt.toISOString(), manifest: r.manifest, error: r.error, anchorState: await reportAnchorState(db, r.checkpointId), checkpointId: r.checkpointId, hasPdf: !!r.artifactRef, hasBundle: !!r.bundleRef, expiresAt: r.expiresAt?.toISOString() ?? null };
}

export async function reportArtifactRef(db: Db, actor: Actor, id: string, artifact: 'pdf' | 'bundle' | 'manifest') {
  await requireMembership(db, actor, 'reports.read');
  const [r] = await db.select().from(reports).where(and(eq(reports.orgId, actor.orgId), eq(reports.id, id)));
  if (!r || r.status !== 'ready') throw new SaathiError('NOT_FOUND', 'Report is not available.');
  if (r.expiresAt && r.expiresAt.getTime() < Date.now()) throw new SaathiError('NOT_FOUND', 'This report has passed its retention period.');
  const ref = artifact === 'pdf' ? r.artifactRef : artifact === 'bundle' ? r.bundleRef : r.artifactRef?.replace(/report\.pdf$/, 'export-manifest.json');
  if (!ref) throw new SaathiError('NOT_FOUND', 'Artifact not available.');
  // Track access without logging document content.
  await db.insert(reportAccessLog).values({ orgId: actor.orgId, reportId: r.id, userId: actor.userId, artifact });
  return { ref, filename: `saathi-${r.kind}-report-${r.id.slice(0, 8)}.${artifact === 'pdf' ? 'pdf' : 'json'}`, contentType: artifact === 'pdf' ? 'application/pdf' : 'application/json' };
}

/** Manifest from persisted facts only; each proof claim is a separate field (Ph17.1). */
export async function buildIncidentManifest(db: Db, orgId: string, incidentId: string) {
  const [inc] = await db.select().from(incidents).where(and(eq(incidents.orgId, orgId), eq(incidents.id, incidentId)));
  if (!inc) throw new Error('incident missing');
  const findings = await db.select().from(incidentFindings).where(eq(incidentFindings.incidentId, incidentId));
  const acts = await db.select().from(actions).where(and(eq(actions.orgId, orgId), eq(actions.incidentId, incidentId))).orderBy(asc(actions.createdAt));
  const probes = acts.length ? await db.select().from(actionProbes).where(inArray(actionProbes.actionId, acts.map((a) => a.id))) : [];
  const [rc] = await db.select().from(recoveryCases).where(eq(recoveryCases.incidentId, incidentId));
  const intents = await db.select({ status: evidenceIntents.status }).from(evidenceIntents).where(and(eq(evidenceIntents.orgId, orgId), eq(evidenceIntents.incidentId, incidentId)));
  const integrity = intents.length === 0 ? 'none' : intents.some((i) => i.status === 'signing_failed') ? 'signing_failed' : intents.some((i) => i.status === 'pending_signature') ? 'pending_signature' : 'signed';
  return {
    manifestVersion: 1,
    incident: { id: inc.id, title: inc.title as Msg, state: inc.state, urgency: inc.urgency, openedAt: inc.openedAt.toISOString(), isReplay: inc.isReplay },
    scope: inc.scope,
    observedFacts: inc.facts,
    uncertainty: inc.uncertain,
    boundaries: inc.boundaries,
    containment: inc.containment,
    findings: findings.map((f) => ({ ruleId: f.ruleId, ruleVersion: f.ruleVersion, status: f.status, target: { type: f.targetType } })),
    actions: acts.map((a) => ({ id: a.id, actionType: a.actionType, state: a.state, simulated: a.simulated, createdAt: a.createdAt.toISOString(), probes: probes.filter((p) => p.actionId === a.id).map((p) => ({ kind: p.kind, expected: p.expected, observed: p.observed, result: p.result, checkedAt: p.checkedAt.toISOString(), source: p.source })) })),
    recovery: rc ? { status: rc.status, steps: (rc.steps as { key: string; kind: string; status: string }[]).map((s) => ({ key: s.key, kind: s.kind, status: s.status })) } : null,
    evidence: { integrity, intents: intents.length },
    disclaimer: 'This report states what Saathi observed and did within connected sources. It does not prove that observations were complete or truthful, and it is not a compliance certification.',
  };
}
