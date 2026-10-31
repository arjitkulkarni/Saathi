import { NextResponse } from 'next/server';
import { evidenceKeys } from '@/server/env';

// Public evidence verification keys (safe to distribute). The verifier pins these; it never
// trusts a key supplied inside a bundle.
export async function GET() {
  return NextResponse.json({ keys: evidenceKeys().map(({ keyId, publicKeyHex, validFrom, retiredAt }) => ({ keyId, publicKeyHex, validFrom, retiredAt })) }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
