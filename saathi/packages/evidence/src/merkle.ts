import { bytesToHex, concatBytes, hexToBytes, randomBytes, sha256, utf8ToBytes } from './crypto';

// Anchor commitment and Merkle construction, version 1 (build.md Ph16.1–16.3).
//
// commitment = SHA256("saathi-checkpoint-v1" || nonce(32) || signedCheckpointBytes)
// leaf       = SHA256(0x00 || commitment)
// node       = SHA256(0x01 || left || right)
// Leaves are ordered by ascending commitment bytes. At each level an odd final node is
// carried up unchanged (never duplicated). A single-leaf tree's root is that leaf hash.
// Root file bytes = UTF-8 "saathi-anchor-batch-v1 " + lowercase hex root + "\n".
// The OpenTimestamps proof stamps SHA256(root file bytes).

export const COMMITMENT_DOMAIN = 'saathi-checkpoint-v1';
export const MERKLE_VERSION = 1;
export const ROOT_FILE_PREFIX = 'saathi-anchor-batch-v1 ';

export function newNonce(): Uint8Array {
  return randomBytes(32);
}

export function commitment(nonce: Uint8Array, signedCheckpointBytes: Uint8Array): Uint8Array {
  if (nonce.length !== 32) throw new Error('nonce must be 32 bytes');
  return sha256(concatBytes(utf8ToBytes(COMMITMENT_DOMAIN), nonce, signedCheckpointBytes));
}

export function leafHash(c: Uint8Array): Uint8Array {
  return sha256(concatBytes(new Uint8Array([0x00]), c));
}
export function nodeHash(l: Uint8Array, r: Uint8Array): Uint8Array {
  return sha256(concatBytes(new Uint8Array([0x01]), l, r));
}

export type PathStep = { side: 'L' | 'R'; hash: string };

function cmp(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

export function buildTree(commitments: Uint8Array[]): { rootHex: string; leaves: { commitmentHex: string; index: number; path: PathStep[] }[] } {
  if (commitments.length === 0) throw new Error('cannot build an empty tree');
  const sorted = [...commitments].sort(cmp);
  for (let i = 1; i < sorted.length; i++) if (cmp(sorted[i - 1], sorted[i]) === 0) throw new Error('duplicate commitment');
  let level = sorted.map(leafHash);
  // positions[i] = index of leaf i's ancestor in the current level
  const paths: PathStep[][] = sorted.map(() => []);
  let positions = sorted.map((_, i) => i);
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) next.push(nodeHash(level[i], level[i + 1]));
      else next.push(level[i]);
    }
    positions = positions.map((pos, leaf) => {
      const sibling = pos % 2 === 0 ? pos + 1 : pos - 1;
      if (sibling < level.length) paths[leaf].push({ side: pos % 2 === 0 ? 'R' : 'L', hash: bytesToHex(level[sibling]) });
      return Math.floor(pos / 2);
    });
    level = next;
  }
  return { rootHex: bytesToHex(level[0]), leaves: sorted.map((c, i) => ({ commitmentHex: bytesToHex(c), index: i, path: paths[i] })) };
}

export function rootFromPath(commitmentHex: string, path: PathStep[]): string {
  let h = leafHash(hexToBytes(commitmentHex));
  for (const step of path) {
    const s = hexToBytes(step.hash);
    h = step.side === 'R' ? nodeHash(h, s) : nodeHash(s, h);
  }
  return bytesToHex(h);
}

export function rootFileBytes(rootHex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(rootHex)) throw new Error('root must be 64 lowercase hex characters');
  return utf8ToBytes(`${ROOT_FILE_PREFIX}${rootHex}\n`);
}
