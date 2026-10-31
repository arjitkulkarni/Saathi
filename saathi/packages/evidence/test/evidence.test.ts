import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  buildTree,
  bytesToB64,
  bytesToHex,
  canonicalString,
  CanonicalizationError,
  commitment,
  generateSeed,
  GENESIS_HASH,
  hexToBytes,
  keyPairFromSeed,
  parseDetached,
  randomBytes,
  rootFileBytes,
  rootFromPath,
  serializeDetached,
  sha256,
  signCheckpoint,
  signedCheckpointBytes,
  signEntry,
  verifyBitcoinAttestation,
  verifyBundle,
  BUNDLE_FORMAT,
  RETAINED_FORMAT,
  type EvidenceBundle,
  type SignedEntry,
  type Timestamp,
} from '../src';

const key = keyPairFromSeed(generateSeed());
const trusted = [{ keyId: 'evd-test', publicKeyHex: key.publicKeyHex }];

function chain(n: number): SignedEntry[] {
  const out: SignedEntry[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const e = signEntry({ schemaVersion: 1, seq: i, orgRef: 'org:test', type: i % 2 ? 'incident.opened' : 'action.approved', occurredAt: `2026-10-31T10:0${i % 10}:00.000Z`, recordedAt: '2026-10-31T10:30:00.000Z', payload: { n: i, note: 'ಕನ್ನಡ हिन्दी' }, prevHash: prev }, key.secretKey, 'evd-test');
    out.push(e);
    prev = e.hash;
  }
  return out;
}

function bundle(entries: SignedEntry[], withAnchor = true): { bundle: EvidenceBundle; retained: unknown } {
  const last = entries[entries.length - 1];
  const cp = signCheckpoint({ orgRef: 'org:test', seq: last.seq, headHash: last.hash, createdAt: '2026-10-31T10:31:00.000Z', keyId: 'evd-test' }, key.secretKey);
  let anchor: EvidenceBundle['anchor'] = null;
  if (withAnchor) {
    const nonce = randomBytes(32);
    const c = commitment(nonce, signedCheckpointBytes(cp));
    const others = [randomBytes(32), randomBytes(32), randomBytes(32)];
    const tree = buildTree([c, ...others]);
    const leaf = tree.leaves.find((l) => l.commitmentHex === bytesToHex(c))!;
    const file = rootFileBytes(tree.rootHex);
    const ts: Timestamp = { msg: sha256(file), attestations: [{ kind: 'pending', uri: 'https://alice.btc.calendar.opentimestamps.org' }], ops: [] };
    anchor = { nonceHex: bytesToHex(nonce), commitmentHex: leaf.commitmentHex, merkleVersion: 1, path: leaf.path, rootHex: tree.rootHex, rootFileB64: bytesToB64(file), otsB64: bytesToB64(serializeDetached(ts)), serverStatus: 'submitted', serverVerification: null };
  }
  return { bundle: { format: BUNDLE_FORMAT, version: 1, orgRef: 'org:test', exportedAt: '2026-10-31T10:32:00.000Z', scopeNote: 't', entries, checkpoint: cp, anchor }, retained: { format: RETAINED_FORMAT, checkpoint: cp } };
}
const row = (r: ReturnType<typeof verifyBundle>, id: string) => r.rows.find((x) => x.id === id)!;

describe('canonical serialization v1', () => {
  it('is deterministic regardless of key order and rejects floats/undefined', () => {
    expect(canonicalString({ b: 1, a: [true, null, 'x'] })).toBe(canonicalString({ a: [true, null, 'x'], b: 1 }));
    expect(() => canonicalString({ a: 1.5 })).toThrow(CanonicalizationError);
    expect(() => canonicalString({ a: undefined })).toThrow(CanonicalizationError);
  });
  it('normalizes Unicode to NFC', () => {
    expect(canonicalString('é')).toBe(canonicalString('é'));
  });
});

describe('Merkle v1', () => {
  it('every leaf path reconstructs the root for 1..17 leaves (odd carry-up)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 17 }), (n) => {
        const leaves = Array.from({ length: n }, () => randomBytes(32));
        const t = buildTree(leaves);
        for (const l of t.leaves) expect(rootFromPath(l.commitmentHex, l.path)).toBe(t.rootHex);
      }),
      { numRuns: 60 },
    );
  });
  it('is independent of input order', () => {
    const leaves = Array.from({ length: 5 }, () => randomBytes(32));
    expect(buildTree(leaves).rootHex).toBe(buildTree([...leaves].reverse()).rootHex);
  });
});

describe('OpenTimestamps format', () => {
  it('round-trips a detached proof with ops and multiple attestations', () => {
    const digest = sha256(new TextEncoder().encode('x'));
    const appended: Timestamp = { msg: new Uint8Array([...digest, 1, 2, 3]), attestations: [], ops: [] };
    const root: Timestamp = { msg: digest, attestations: [], ops: [{ op: { tag: 0xf0, arg: new Uint8Array([1, 2, 3]) }, stamp: appended }] };
    const final: Timestamp = { msg: sha256(appended.msg), attestations: [{ kind: 'pending', uri: 'https://a.example' }, { kind: 'bitcoin', height: 123456 }], ops: [] };
    appended.ops.push({ op: { tag: 0x08 }, stamp: final });
    const bytes = serializeDetached(root);
    const back = parseDetached(bytes);
    expect(bytesToHex(serializeDetached(back.timestamp))).toBe(bytesToHex(bytes));
  });
  it('verifies a Bitcoin attestation only against the matching block merkle root', () => {
    const msg = randomBytes(32);
    const ts: Timestamp = { msg, attestations: [{ kind: 'bitcoin', height: 900000 }], ops: [] };
    const goodRoot = bytesToHex(msg.slice().reverse());
    expect(verifyBitcoinAttestation(ts, { height: 900000, blockHash: 'h', merkleRootHex: goodRoot, time: 0 }).ok).toBe(true);
    expect(verifyBitcoinAttestation(ts, { height: 900000, blockHash: 'h', merkleRootHex: '00'.repeat(32), time: 0 }).ok).toBe(false);
    expect(verifyBitcoinAttestation(ts, { height: 1, blockHash: 'h', merkleRootHex: goodRoot, time: 0 }).ok).toBe(false);
  });
});

describe('bundle verifier (Ph15/16 gates)', () => {
  it('a genuine bundle passes integrity; pending timestamp stays pending, never confirmed', () => {
    const { bundle: b, retained } = bundle(chain(6));
    const r = verifyBundle({ bundle: b, retained, trustedKeys: trusted });
    expect(r.integrityOk).toBe(true);
    for (const id of ['hashes', 'links', 'signatures', 'bundle_checkpoint', 'retained_checkpoint', 'membership']) expect(row(r, id).status).toBe('pass');
    expect(row(r, 'blockchain').status).toBe('pending');
  });
  it('edited payload fails hashes', () => {
    const { bundle: b, retained } = bundle(chain(5));
    (b.entries[2].payload as { n: number }).n = 99;
    expect(row(verifyBundle({ bundle: b, retained, trustedKeys: trusted }), 'hashes').status).toBe('fail');
  });
  it('reordered entries fail links', () => {
    const { bundle: b, retained } = bundle(chain(5));
    [b.entries[1], b.entries[2]] = [b.entries[2], b.entries[1]];
    expect(row(verifyBundle({ bundle: b, retained, trustedKeys: trusted }), 'links').status).toBe('fail');
  });
  it('middle deletion fails links', () => {
    const { bundle: b, retained } = bundle(chain(5));
    b.entries.splice(2, 1);
    expect(row(verifyBundle({ bundle: b, retained, trustedKeys: trusted }), 'links').status).toBe('fail');
  });
  it('tail truncation to an earlier valid chain is caught only by the retained checkpoint', () => {
    const full = bundle(chain(6));
    const short = bundle(chain(6).slice(0, 4)); // internally consistent, newly signed checkpoint
    const r = verifyBundle({ bundle: short.bundle, retained: full.retained, trustedKeys: trusted });
    expect(row(r, 'hashes').status).toBe('pass');
    expect(row(r, 'bundle_checkpoint').status).toBe('pass');
    expect(row(r, 'retained_checkpoint').status).toBe('fail');
    const noRetained = verifyBundle({ bundle: short.bundle, trustedKeys: trusted });
    expect(row(noRetained, 'retained_checkpoint').status).toBe('not_checked');
  });
  it('wrong or untrusted key fails signatures, even if the bundle names a key', () => {
    const { bundle: b, retained } = bundle(chain(3));
    const other = keyPairFromSeed(generateSeed());
    expect(row(verifyBundle({ bundle: b, retained, trustedKeys: [{ keyId: 'evd-test', publicKeyHex: other.publicKeyHex }] }), 'signatures').status).toBe('fail');
    expect(row(verifyBundle({ bundle: b, retained, trustedKeys: [] }), 'signatures').status).toBe('fail');
  });
  it('tampered nonce or Merkle path fails membership', () => {
    const a = bundle(chain(3));
    a.bundle.anchor!.nonceHex = bytesToHex(randomBytes(32));
    expect(row(verifyBundle({ bundle: a.bundle, retained: a.retained, trustedKeys: trusted }), 'membership').status).toBe('fail');
    const b = bundle(chain(3));
    if (b.bundle.anchor!.path.length) b.bundle.anchor!.path[0] = { ...b.bundle.anchor!.path[0], hash: '00'.repeat(32) };
    else b.bundle.anchor!.rootHex = '11'.repeat(32);
    expect(row(verifyBundle({ bundle: b.bundle, retained: b.retained, trustedKeys: trusted }), 'membership').status).toBe('fail');
  });
  it('a proof for another file is rejected', () => {
    const a = bundle(chain(3));
    const ts: Timestamp = { msg: sha256(new TextEncoder().encode('other file')), attestations: [{ kind: 'pending', uri: 'https://x.example' }], ops: [] };
    a.bundle.anchor!.otsB64 = bytesToB64(serializeDetached(ts));
    expect(row(verifyBundle({ bundle: a.bundle, retained: a.retained, trustedKeys: trusted }), 'membership').status).toBe('fail');
  });
  it('a claimed Bitcoin attestation without chain context is "not checked offline"', () => {
    const a = bundle(chain(2));
    const file = Uint8Array.from(Buffer.from(a.bundle.anchor!.rootFileB64, 'base64'));
    const ts: Timestamp = { msg: sha256(file), attestations: [{ kind: 'bitcoin', height: 900001 }], ops: [] };
    a.bundle.anchor!.otsB64 = bytesToB64(serializeDetached(ts));
    const r = verifyBundle({ bundle: a.bundle, retained: a.retained, trustedKeys: trusted });
    expect(row(r, 'blockchain').status).toBe('not_checked');
    const withCtx = verifyBundle({ bundle: a.bundle, retained: a.retained, trustedKeys: trusted, chainContext: { height: 900001, blockHash: 'x', merkleRootHex: bytesToHex(sha256(file).slice().reverse()), time: 0 } });
    expect(row(withCtx, 'blockchain').status).toBe('pass');
  });
  it('rejects non-bundles', () => {
    expect(verifyBundle({ bundle: { hello: 1 }, trustedKeys: trusted }).integrityOk).toBe(false);
    void hexToBytes;
  });
});
