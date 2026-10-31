import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, concatBytes, utf8ToBytes, randomBytes } from '@noble/hashes/utils.js';

export { bytesToHex, hexToBytes, concatBytes, utf8ToBytes, randomBytes, sha256 };

export function sha256Hex(data: Uint8Array | string): string {
  return bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));
}

export function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function bytesToB64url(b: Uint8Array): string {
  let s: string;
  if (typeof btoa === 'function') {
    let bin = '';
    for (const x of b) bin += String.fromCharCode(x);
    s = btoa(bin);
  } else s = Buffer.from(b).toString('base64');
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function bytesToB64(b: Uint8Array): string {
  return bytesToB64url(b).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (bytesToB64url(b).length % 4)) % 4);
}
export function b64ToBytes(s: string): Uint8Array {
  return b64urlToBytes(s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
}

/** Ed25519 key pair from a 32-byte base64url seed (never exposed to browsers). */
export function keyPairFromSeed(seedB64url: string) {
  const secretKey = b64urlToBytes(seedB64url);
  if (secretKey.length !== 32) throw new Error('Ed25519 seed must be 32 bytes');
  return { secretKey, publicKeyHex: bytesToHex(ed25519.getPublicKey(secretKey)) };
}

export function generateSeed(): string {
  return bytesToB64url(randomBytes(32));
}

export function signHash(hashHex: string, secretKey: Uint8Array): string {
  return bytesToHex(ed25519.sign(hexToBytes(hashHex), secretKey));
}

export function verifyHashSignature(hashHex: string, signatureHex: string, publicKeyHex: string): boolean {
  try {
    return ed25519.verify(hexToBytes(signatureHex), hexToBytes(hashHex), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

export function publicKeyFromSeed(seedB64url: string): string {
  return keyPairFromSeed(seedB64url).publicKeyHex;
}
