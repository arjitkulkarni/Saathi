import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Locale, Msg, Vocabulary } from '@saathi/contracts';
import { anchorStatusForCheckpoint, buildIncidentManifest, bundleForCheckpoint, coverageSummary, recordIntent, schema as s, withTx } from '@saathi/db';
import { canonicalBytes, sha256Hex, signHash } from '@saathi/evidence';
import { renderMsg } from '@saathi/i18n';
import type { WorkerDeps } from './handlers';

// Readable report (PDF) + canonical proof bundle + separately signed export manifest that
// carries the exact PDF digest (build.md Ph15.7). The PDF never contains its own hash.

const enc = new TextEncoder();

/** Standard PDF fonts cover WinAnsi only; regional text is kept in the JSON artifacts. */
function winAnsi(t: string) {
  return t.normalize('NFKD').replace(/[^\x20-\x7E -ÿ]/g, '?');
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([595, 842]);
    this.y = 790;
  }
  text(t: string, o: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number } = {}) {
    const size = o.size ?? 10.5;
    const font = o.bold ? this.bold : this.font;
    const words = winAnsi(t).split(/\s+/);
    let line = '';
    const lines: string[] = [];
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > 495) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    for (const l of lines) {
      if (this.y < 60) this.newPage();
      this.page.drawText(l, { x: 50, y: this.y, size, font, color: rgb(...(o.color ?? [0.14, 0.14, 0.13])) });
      this.y -= size * 1.5;
    }
    this.y -= o.gap ?? 4;
  }
  heading(t: string) {
    this.y -= 6;
    this.text(t, { size: 13, bold: true, gap: 2 });
  }
}

async function renderPdf(title: string, sections: { heading: string; lines: string[] }[], footer: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer('Saathi');
  doc.setCreationDate(new Date());
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
  w.text(title, { size: 18, bold: true, gap: 10 });
  for (const sec of sections) {
    w.heading(sec.heading);
    if (sec.lines.length === 0) w.text('None recorded.', { color: [0.38, 0.38, 0.35] });
    for (const l of sec.lines) w.text(`- ${l}`);
  }
  w.y -= 10;
  w.text(footer, { size: 9, color: [0.38, 0.38, 0.35] });
  return doc.save();
}

async function storeArtifacts(d: WorkerDeps, orgId: string, reportId: string, kind: string, pdf: Uint8Array, bundle: unknown | null, checkpoint: { id: string; seq: number; hash: string } | null) {
  const base = `reports/${orgId}/${reportId}`;
  await d.store.put(`${base}/report.pdf`, pdf, 'application/pdf');
  const artifacts = [{ name: 'report.pdf', sha256: sha256Hex(pdf), bytes: pdf.length }];
  let bundleRef: string | null = null;
  if (bundle) {
    const bytes = enc.encode(JSON.stringify(bundle, null, 2));
    bundleRef = `${base}/bundle.json`;
    await d.store.put(bundleRef, bytes, 'application/json');
    artifacts.push({ name: 'bundle.json', sha256: sha256Hex(bytes), bytes: bytes.length });
  }
  const manifest = { format: 'saathi-export-manifest', version: 1, reportId, kind, createdAt: new Date().toISOString(), artifacts, checkpoint, keyId: d.evidenceKey.keyId };
  const signature = signHash(sha256Hex(canonicalBytes(manifest)), d.evidenceKey.secretKey);
  await d.store.put(`${base}/export-manifest.json`, enc.encode(JSON.stringify({ ...manifest, signature }, null, 2)), 'application/json');
  return { artifactRef: `${base}/report.pdf`, bundleRef, pdfSha: artifacts[0].sha256, artifacts };
}

async function latestCheckpoint(d: WorkerDeps, orgId: string) {
  return withTx(d.pool, { orgId }, async (db) => (await db.select().from(s.checkpoints).where(eq(s.checkpoints.orgId, orgId)).orderBy(desc(s.checkpoints.seq)).limit(1))[0] ?? null);
}

export async function generateReport(d: WorkerDeps, orgId: string, reportId: string) {
  const [rep] = await withTx(d.pool, { orgId }, (db) => db.select().from(s.reports).where(and(eq(s.reports.orgId, orgId), eq(s.reports.id, reportId))));
  if (!rep || rep.status === 'ready' || !rep.incidentId) return;
  const [org] = await withTx(d.pool, { orgId }, (db) => db.select().from(s.organizations).where(eq(s.organizations.id, orgId)));
  const ro = { locale: 'en' as Locale, vocabulary: org.vocabulary as Vocabulary, timezone: org.timezone };
  const r = (m: Msg) => renderMsg(m, ro);
  const manifest = await withTx(d.pool, { orgId }, (db) => buildIncidentManifest(db, orgId, rep.incidentId!));
  const cp = await latestCheckpoint(d, orgId);
  const anchor = cp ? await withTx(d.pool, { orgId }, (db) => anchorStatusForCheckpoint(db, cp.id, cp.isSample)) : null;
  const bundle = cp ? await withTx(d.pool, { orgId }, (db) => bundleForCheckpoint(db, orgId, cp.id)) : null;
  const scope = manifest.scope as { sources: Msg[]; excluded: Msg[]; observedAt: string };
  const pdf = await renderPdf(
    `Saathi incident report: ${r(manifest.incident.title)}`,
    [
      { heading: 'Organization and status', lines: [`${org.name}${org.isDemo ? ' (synthetic demonstration organization)' : ''}`, `Incident status: ${manifest.incident.state}`, `Opened: ${manifest.incident.openedAt}`, ...(manifest.incident.isReplay ? ['REPLAY data'] : [])] },
      { heading: 'Scope', lines: [...(scope.sources ?? []).map((m) => `Observed in: ${r(m)}`), ...(scope.excluded ?? []).map((m) => `Outside this view: ${r(m)}`)] },
      { heading: 'Observed facts', lines: (manifest.observedFacts as Msg[]).map(r) },
      { heading: 'Uncertainty', lines: (manifest.uncertainty as Msg[]).map(r) },
      { heading: 'Limits', lines: (manifest.boundaries as Msg[]).map(r) },
      { heading: 'Containment assessment', lines: [String((manifest.containment as { status: string }).status), ...((manifest.containment as { reasons: Msg[] }).reasons ?? []).map(r)] },
      {
        heading: 'Actions and observed results',
        lines: manifest.actions.flatMap((a) => [`${a.actionType}: ${a.state}${a.simulated ? ' (simulated test adapter)' : ''} at ${a.createdAt}`, ...a.probes.map((p) => `   check ${p.kind}: expected ${p.expected}, observed ${p.observed} -> ${p.result} (${p.checkedAt})`)]),
      },
      { heading: 'Recovery', lines: manifest.recovery ? [`Status: ${manifest.recovery.status}`, ...manifest.recovery.steps.map((x) => `${x.key} (${x.kind === 'attested' ? 'confirmed by owner' : 'checked by Saathi'}): ${x.status}`)] : ['No recovery case.'] },
      { heading: 'Evidence integrity (separate claim)', lines: [`Evidence records for this incident: ${manifest.evidence.intents}, status ${manifest.evidence.integrity}.`, cp ? `Latest signed checkpoint: entry ${cp.seq}, hash ${cp.hash}` : 'No signed checkpoint yet.'] },
      { heading: 'Independent timestamp (separate claim)', lines: [anchor ? `${anchor.state}${anchor.method ? ` via ${anchor.method}` : ''}${anchor.bitcoinHeight ? `, Bitcoin block ${anchor.bitcoinHeight}` : ''}` : 'Not requested.'] },
    ],
    manifest.disclaimer,
  );
  const stored = await storeArtifacts(d, orgId, reportId, 'incident', pdf, bundle, cp ? { id: cp.id, seq: Number(cp.seq), hash: cp.hash } : null);
  await withTx(d.pool, { orgId }, async (db) => {
    await db
      .update(s.reports)
      .set({ status: 'ready', manifest: { ...manifest, independentTimestamp: anchor?.state ?? 'not_requested', artifacts: stored.artifacts }, artifactRef: stored.artifactRef, artifactSha256: stored.pdfSha, bundleRef: stored.bundleRef, checkpointId: cp?.id ?? null })
      .where(eq(s.reports.id, reportId));
    await recordIntent(db, orgId, 'report.generated', { reportId, artifacts: stored.artifacts.map((a) => ({ name: a.name, sha256: a.sha256 })) }, { incidentId: rep.incidentId });
  });
}

/** Weekly digest from stored facts only (build.md Ph14.4). */
export async function generateWeeklyDigest(d: WorkerDeps, orgId: string) {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 86400_000);
  const [org] = await withTx(d.pool, { orgId }, (db) => db.select().from(s.organizations).where(eq(s.organizations.id, orgId)));
  const existing = await withTx(d.pool, { orgId }, (db) => db.select({ id: s.reports.id }).from(s.reports).where(and(eq(s.reports.orgId, orgId), eq(s.reports.kind, 'weekly'), gte(s.reports.createdAt, new Date(end.getTime() - 6 * 86400_000)))));
  if (existing.length) return;
  const ro = { locale: 'en' as Locale, vocabulary: org.vocabulary as Vocabulary, timezone: org.timezone };
  const data = await withTx(d.pool, { orgId }, async (db) => {
    const incs = await db.select().from(s.incidents).where(and(eq(s.incidents.orgId, orgId), gte(s.incidents.openedAt, start)));
    const acts = await db.select({ state: s.actions.state, n: sql<number>`count(*)::int` }).from(s.actions).where(and(eq(s.actions.orgId, orgId), gte(s.actions.createdAt, start))).groupBy(s.actions.state);
    const remediated = await db.select({ n: sql<number>`count(*)::int` }).from(s.eventDispositions).where(and(eq(s.eventDispositions.orgId, orgId), eq(s.eventDispositions.reason, 'remediated_detection'), gte(s.eventDispositions.createdAt, start)));
    const openRecovery = await db.select({ n: sql<number>`count(*)::int` }).from(s.recoveryCases).where(and(eq(s.recoveryCases.orgId, orgId), inArray(s.recoveryCases.status, ['in_progress', 'blocked'])));
    const [policy] = await db.select().from(s.orgPolicy).where(eq(s.orgPolicy.orgId, orgId));
    const coverage = await coverageSummary(db, orgId);
    return { incs, acts, remediated: remediated[0]?.n ?? 0, openRecovery: openRecovery[0]?.n ?? 0, policy, coverage };
  });
  const manifest = {
    manifestVersion: 1,
    period: { start: start.toISOString(), end: end.toISOString() },
    incidents: data.incs.map((i) => ({ id: i.id, title: i.title, state: i.state, urgency: i.urgency, isReplay: i.isReplay })),
    actionsByState: Object.fromEntries(data.acts.map((a) => [a.state, a.n])),
    remediatedDetections: data.remediated,
    outstandingRecovery: data.openRecovery,
    coverage: data.coverage,
    automation: { enabled: data.policy?.autoThrottleEnabled ?? false, version: data.policy?.version ?? 0 },
    evidence: { integrity: 'see bundle' },
    sourceNote: 'All counts are computed from stored records for the period.',
  };
  const [rep] = await withTx(d.pool, { orgId }, (db) => db.insert(s.reports).values({ orgId, kind: 'weekly', periodStart: start, periodEnd: end, createdBy: 'policy-worker', manifest, status: 'queued', expiresAt: new Date(end.getTime() + d.env.RETENTION_REPORT_DAYS * 86400_000) }).returning({ id: s.reports.id }));
  const c = data.coverage;
  const pdf = await renderPdf(
    `Saathi weekly summary: ${org.name}`,
    [
      { heading: 'Period', lines: [`${start.toISOString()} to ${end.toISOString()}`] },
      { heading: 'Incidents opened', lines: data.incs.map((i) => `${renderMsg(i.title as Msg, ro)} - ${i.state}${i.isReplay ? ' (REPLAY)' : ''}`) },
      { heading: 'Responses', lines: data.acts.map((a) => `${a.state}: ${a.n}`) },
      { heading: 'Already-remediated detections', lines: [`${data.remediated}`] },
      { heading: 'Outstanding recovery', lines: [`${data.openRecovery}`] },
      { heading: 'Coverage gaps', lines: [`Devices: ${c.devices.fresh} current, ${c.devices.stale} stale, ${c.devices.offline} offline of ${c.devices.total}`, `Applications: ${c.applications.enforceable} enforceable, ${c.applications.readOnly} read-only, ${c.applications.unconnected} unconnected`, `Uncertain dependencies: ${c.unknownDependencies}`] },
      { heading: 'Automation policy', lines: [data.policy?.autoThrottleEnabled ? `Temporary limiting allowed (policy version ${data.policy.version}).` : 'Temporary limiting not allowed.'] },
    ],
    'Counts come from stored records. No incidents in connected sources is not a guarantee of safety.',
  );
  const cp = await latestCheckpoint(d, orgId);
  const stored = await storeArtifacts(d, orgId, rep.id, 'weekly', pdf, null, cp ? { id: cp.id, seq: Number(cp.seq), hash: cp.hash } : null);
  await withTx(d.pool, { orgId }, async (db) => {
    await db.update(s.reports).set({ status: 'ready', artifactRef: stored.artifactRef, artifactSha256: stored.pdfSha, checkpointId: cp?.id ?? null }).where(eq(s.reports.id, rep.id));
    await recordIntent(db, orgId, 'report.generated', { reportId: rep.id, kind: 'weekly', artifacts: stored.artifacts.map((a) => ({ name: a.name, sha256: a.sha256 })) });
  });
}
