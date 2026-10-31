import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Records-app PIN hashing for the reference integration (scrypt, per-PIN salt).
export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('base64url');
  return `scrypt$${salt}$${scryptSync(pin, salt, 32).toString('base64url')}`;
}

export function verifyPin(pin: string, stored: string | null): boolean {
  if (!stored) return false;
  const [alg, salt, h] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !h) return false;
  const a = scryptSync(pin, salt, 32);
  const b = Buffer.from(h, 'base64url');
  return a.length === b.length && timingSafeEqual(a, b);
}
