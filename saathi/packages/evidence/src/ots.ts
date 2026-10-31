import { ripemd160, sha1 } from '@noble/hashes/legacy.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, hexToBytes, randomBytes, sha256 } from './crypto';

// OpenTimestamps wire protocol (detached timestamp files, calendar submission and
// upgrade, Bitcoin block-header attestations), implemented to the format used by the
// official opentimestamps-client. See decisions D-009 / D-010.
//
// A calendar receipt is a PendingAttestation: it means "submitted", never "confirmed".

export const HEADER_MAGIC = hexToBytes('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294');
export const MAJOR_VERSION = 1;
const MAX_PAYLOAD = 8192;
const MAX_DEPTH = 256;

export const ATTESTATION_TAGS = {
  pending: '83dfe30d2ef90c8e',
  bitcoin: '0588960d73d71901',
  litecoin: '06869a0d73d71b45',
} as const;

const OP = { sha1: 0x02, ripemd160: 0x03, sha256: 0x08, keccak256: 0x67, append: 0xf0, prepend: 0xf1, reverse: 0xf2, hexlify: 0xf3 } as const;

export type Op = { tag: number; arg?: Uint8Array };
export type Attestation =
  | { kind: 'pending'; uri: string }
  | { kind: 'bitcoin'; height: number }
  | { kind: 'litecoin'; height: number }
  | { kind: 'unknown'; tagHex: string; payload: Uint8Array };

export type Timestamp = { msg: Uint8Array; attestations: Attestation[]; ops: { op: Op; stamp: Timestamp }[] };

export class OtsFormatError extends Error {}

// ---------------------------------------------------------------- byte I/O

class Reader {
  pos = 0;
  constructor(private buf: Uint8Array) {}
  bytes(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) throw new OtsFormatError('unexpected end of proof');
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  byte(): number {
    return this.bytes(1)[0];
  }
  varuint(): number {
    let value = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      value += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) break;
      shift += 7;
      if (shift > 49) throw new OtsFormatError('varuint too large');
    }
    return value;
  }
  varbytes(max = MAX_PAYLOAD): Uint8Array {
    const n = this.varuint();
    if (n > max) throw new OtsFormatError('varbytes exceeds limit');
    return this.bytes(n);
  }
  get done() {
    return this.pos >= this.buf.length;
  }
}

class Writer {
  parts: Uint8Array[] = [];
  bytes(b: Uint8Array) {
    this.parts.push(b);
  }
  byte(n: number) {
    this.parts.push(new Uint8Array([n]));
  }
  varuint(n: number) {
    const out: number[] = [];
    do {
      let b = n & 0x7f;
      n = Math.floor(n / 128);
      if (n > 0) b |= 0x80;
      out.push(b);
    } while (n > 0);
    this.bytes(new Uint8Array(out));
  }
  varbytes(b: Uint8Array) {
    this.varuint(b.length);
    this.bytes(b);
  }
  result() {
    return concatBytes(...this.parts);
  }
}

// ---------------------------------------------------------------- operations

export function applyOp(op: Op, msg: Uint8Array): Uint8Array {
  switch (op.tag) {
    case OP.sha256:
      return sha256(msg);
    case OP.sha1:
      return sha1(msg);
    case OP.ripemd160:
      return ripemd160(msg);
    case OP.keccak256:
      return keccak_256(msg);
    case OP.append:
      return concatBytes(msg, op.arg!);
    case OP.prepend:
      return concatBytes(op.arg!, msg);
    case OP.reverse:
      return msg.slice().reverse();
    case OP.hexlify:
      return new TextEncoder().encode(bytesToHex(msg));
    default:
      throw new OtsFormatError(`unknown op 0x${op.tag.toString(16)}`);
  }
}

function readOp(r: Reader, tag: number): Op {
  if (tag === OP.append || tag === OP.prepend) return { tag, arg: r.varbytes(4096) };
  if ([OP.sha1, OP.ripemd160, OP.sha256, OP.keccak256, OP.reverse, OP.hexlify].includes(tag as never)) return { tag };
  throw new OtsFormatError(`unknown op 0x${tag.toString(16)}`);
}

function writeOp(w: Writer, op: Op) {
  w.byte(op.tag);
  if (op.arg) w.varbytes(op.arg);
}

function readAttestation(r: Reader): Attestation {
  const tagHex = bytesToHex(r.bytes(8));
  const payload = r.varbytes();
  const pr = new Reader(payload);
  if (tagHex === ATTESTATION_TAGS.pending) {
    const uri = new TextDecoder().decode(pr.varbytes(1000));
    if (!/^[A-Za-z0-9._\-/:]+$/.test(uri)) throw new OtsFormatError('invalid calendar URI in pending attestation');
    return { kind: 'pending', uri };
  }
  if (tagHex === ATTESTATION_TAGS.bitcoin) return { kind: 'bitcoin', height: pr.varuint() };
  if (tagHex === ATTESTATION_TAGS.litecoin) return { kind: 'litecoin', height: pr.varuint() };
  return { kind: 'unknown', tagHex, payload };
}

function attestationBytes(a: Attestation): Uint8Array {
  const w = new Writer();
  const pw = new Writer();
  if (a.kind === 'pending') {
    w.bytes(hexToBytes(ATTESTATION_TAGS.pending));
    pw.varbytes(new TextEncoder().encode(a.uri));
  } else if (a.kind === 'bitcoin' || a.kind === 'litecoin') {
    w.bytes(hexToBytes(ATTESTATION_TAGS[a.kind]));
    pw.varuint(a.height);
  } else {
    w.bytes(hexToBytes(a.tagHex));
    pw.bytes(a.payload);
  }
  w.varbytes(pw.result());
  return w.result();
}

function cmpBytes(a: Uint8Array, b: Uint8Array) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
function opKey(op: Op) {
  return concatBytes(new Uint8Array([op.tag]), op.arg ?? new Uint8Array());
}

// ---------------------------------------------------------------- timestamps

function readTimestamp(r: Reader, msg: Uint8Array, depth = 0): Timestamp {
  if (depth > MAX_DEPTH) throw new OtsFormatError('proof too deep');
  const ts: Timestamp = { msg, attestations: [], ops: [] };
  const handle = (tag: number) => {
    if (tag === 0x00) ts.attestations.push(readAttestation(r));
    else {
      const op = readOp(r, tag);
      ts.ops.push({ op, stamp: readTimestamp(r, applyOp(op, msg), depth + 1) });
    }
  };
  let tag = r.byte();
  while (tag === 0xff) {
    handle(r.byte());
    tag = r.byte();
  }
  handle(tag);
  return ts;
}

function writeTimestamp(w: Writer, ts: Timestamp) {
  const atts = [...ts.attestations].map(attestationBytes).sort(cmpBytes);
  const ops = [...ts.ops].sort((a, b) => cmpBytes(opKey(a.op), opKey(b.op)));
  if (atts.length === 0 && ops.length === 0) throw new OtsFormatError("an empty timestamp can't be serialized");
  for (let i = 0; i < atts.length - 1; i++) {
    w.bytes(new Uint8Array([0xff, 0x00]));
    w.bytes(atts[i]);
  }
  if (ops.length === 0) {
    w.byte(0x00);
    w.bytes(atts[atts.length - 1]);
    return;
  }
  if (atts.length > 0) {
    w.bytes(new Uint8Array([0xff, 0x00]));
    w.bytes(atts[atts.length - 1]);
  }
  for (let i = 0; i < ops.length - 1; i++) {
    w.byte(0xff);
    writeOp(w, ops[i].op);
    writeTimestamp(w, ops[i].stamp);
  }
  writeOp(w, ops[ops.length - 1].op);
  writeTimestamp(w, ops[ops.length - 1].stamp);
}

export function parseTimestampBytes(bytes: Uint8Array, msg: Uint8Array): Timestamp {
  const r = new Reader(bytes);
  const ts = readTimestamp(r, msg);
  if (!r.done) throw new OtsFormatError('trailing bytes after timestamp');
  return ts;
}

/** Serialize a detached `.ots` proof for a file whose SHA-256 digest is `ts.msg`. */
export function serializeDetached(ts: Timestamp): Uint8Array {
  const w = new Writer();
  w.bytes(HEADER_MAGIC);
  w.varuint(MAJOR_VERSION);
  w.byte(OP.sha256);
  w.bytes(ts.msg);
  writeTimestamp(w, ts);
  return w.result();
}

export function parseDetached(bytes: Uint8Array): { fileDigest: Uint8Array; timestamp: Timestamp } {
  const r = new Reader(bytes);
  const magic = r.bytes(HEADER_MAGIC.length);
  if (cmpBytes(magic, HEADER_MAGIC) !== 0) throw new OtsFormatError('not an OpenTimestamps proof (bad magic)');
  const major = r.varuint();
  if (major !== MAJOR_VERSION) throw new OtsFormatError(`unsupported proof version ${major}`);
  const hashTag = r.byte();
  if (hashTag !== OP.sha256) throw new OtsFormatError('only SHA-256 file digests are supported');
  const fileDigest = r.bytes(32);
  const timestamp = readTimestamp(r, fileDigest);
  if (!r.done) throw new OtsFormatError('trailing bytes after proof');
  return { fileDigest, timestamp };
}

export function walkAttestations(ts: Timestamp, out: { msg: Uint8Array; attestation: Attestation }[] = []) {
  for (const a of ts.attestations) out.push({ msg: ts.msg, attestation: a });
  for (const { stamp } of ts.ops) walkAttestations(stamp, out);
  return out;
}

/** Merge `other` (a timestamp for the same msg) into `target`. */
export function mergeTimestamp(target: Timestamp, other: Timestamp) {
  if (cmpBytes(target.msg, other.msg) !== 0) throw new OtsFormatError('cannot merge timestamps for different messages');
  for (const a of other.attestations) {
    const ab = attestationBytes(a);
    if (!target.attestations.some((x) => cmpBytes(attestationBytes(x), ab) === 0)) target.attestations.push(a);
  }
  for (const { op, stamp } of other.ops) {
    const existing = target.ops.find((x) => cmpBytes(opKey(x.op), opKey(op)) === 0);
    if (existing) mergeTimestamp(existing.stamp, stamp);
    else target.ops.push({ op, stamp });
  }
}

// ---------------------------------------------------------------- calendars

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: Uint8Array; signal?: AbortSignal }) => Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

const OTS_HEADERS = { Accept: 'application/vnd.opentimestamps.v1', 'User-Agent': 'saathi-anchor/1' };

function normalizeCalendar(url: string) {
  return url.replace(/\/+$/, '');
}

export type StampOutcome = { calendar: string; ok: boolean; error?: string };

/**
 * Create a detached timestamp for a file digest and submit it to calendars, mirroring
 * the official client: append a 16-byte random nonce, SHA-256, then submit.
 */
export async function stampDigest(fileDigest: Uint8Array, calendars: string[], fetchImpl: FetchLike, timeoutMs = 10_000): Promise<{ timestamp: Timestamp; outcomes: StampOutcome[] }> {
  const root: Timestamp = { msg: fileDigest, attestations: [], ops: [] };
  const appendOp: Op = { tag: OP.append, arg: randomBytes(16) };
  const appended: Timestamp = { msg: applyOp(appendOp, fileDigest), attestations: [], ops: [] };
  const shaOp: Op = { tag: OP.sha256 };
  const submitted: Timestamp = { msg: applyOp(shaOp, appended.msg), attestations: [], ops: [] };
  appended.ops.push({ op: shaOp, stamp: submitted });
  root.ops.push({ op: appendOp, stamp: appended });
  const outcomes: StampOutcome[] = [];
  for (const cal of calendars.map(normalizeCalendar)) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetchImpl(`${cal}/digest`, { method: 'POST', headers: { ...OTS_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' }, body: submitted.msg, signal: ctrl.signal }).finally(() => clearTimeout(t));
      if (res.status !== 200) throw new Error(`calendar returned HTTP ${res.status}`);
      const body = new Uint8Array(await res.arrayBuffer());
      if (body.length > MAX_PAYLOAD * 4) throw new Error('calendar response too large');
      mergeTimestamp(submitted, parseTimestampBytes(body, submitted.msg));
      outcomes.push({ calendar: cal, ok: true });
    } catch (e) {
      outcomes.push({ calendar: cal, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { timestamp: root, outcomes };
}

/**
 * Ask calendars for upgraded proofs of pending attestations. Only calendars in the
 * allowlist are contacted (the URI inside a proof is untrusted input).
 */
export async function upgradeTimestamp(ts: Timestamp, allowlist: string[], fetchImpl: FetchLike, timeoutMs = 10_000): Promise<{ changed: boolean; results: { calendar: string; status: 'upgraded' | 'pending' | 'error' | 'not_allowed'; error?: string }[] }> {
  const allowed = new Set(allowlist.map(normalizeCalendar));
  const results: { calendar: string; status: 'upgraded' | 'pending' | 'error' | 'not_allowed'; error?: string }[] = [];
  let changed = false;
  const visit = async (node: Timestamp) => {
    for (const a of [...node.attestations]) {
      if (a.kind !== 'pending') continue;
      const cal = normalizeCalendar(a.uri);
      if (!allowed.has(cal)) {
        results.push({ calendar: cal, status: 'not_allowed' });
        continue;
      }
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        const res = await fetchImpl(`${cal}/timestamp/${bytesToHex(node.msg)}`, { headers: OTS_HEADERS, signal: ctrl.signal }).finally(() => clearTimeout(t));
        if (res.status === 404) {
          results.push({ calendar: cal, status: 'pending' });
          continue;
        }
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const upgraded = parseTimestampBytes(new Uint8Array(await res.arrayBuffer()), node.msg);
        mergeTimestamp(node, upgraded);
        changed = true;
        results.push({ calendar: cal, status: 'upgraded' });
      } catch (e) {
        results.push({ calendar: cal, status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }
    for (const { stamp } of node.ops) await visit(stamp);
  };
  await visit(ts);
  return { changed, results };
}

// ---------------------------------------------------------------- Bitcoin

export type BlockHeaderInfo = { height: number; blockHash: string; merkleRootHex: string; time: number };

/** Bitcoin attestations in a proof, with the message that must equal the block merkle root. */
export function bitcoinAttestations(ts: Timestamp): { height: number; expectedMerkleRootHex: string }[] {
  return walkAttestations(ts)
    .filter((x) => x.attestation.kind === 'bitcoin')
    .map((x) => ({ height: (x.attestation as { height: number }).height, expectedMerkleRootHex: bytesToHex(x.msg.slice().reverse()) }));
}

/**
 * Verify a Bitcoin attestation against a block header supplied by a trusted source.
 * `header.merkleRootHex` uses the conventional display byte order (as in RPC output).
 */
export function verifyBitcoinAttestation(ts: Timestamp, header: BlockHeaderInfo): { ok: boolean; reason: string } {
  const atts = bitcoinAttestations(ts).filter((a) => a.height === header.height);
  if (atts.length === 0) return { ok: false, reason: `proof has no Bitcoin attestation at height ${header.height}` };
  const match = atts.some((a) => a.expectedMerkleRootHex === header.merkleRootHex.toLowerCase());
  return match ? { ok: true, reason: 'Proof commitment equals the block merkle root' } : { ok: false, reason: 'Proof commitment does not match the block merkle root' };
}

export function summarizeProof(ts: Timestamp) {
  const all = walkAttestations(ts);
  return {
    pendingCalendars: all.filter((a) => a.attestation.kind === 'pending').map((a) => (a.attestation as { uri: string }).uri),
    bitcoinHeights: all.filter((a) => a.attestation.kind === 'bitcoin').map((a) => (a.attestation as { height: number }).height),
    otherAttestations: all.filter((a) => a.attestation.kind === 'litecoin' || a.attestation.kind === 'unknown').length,
  };
}
