import { NextResponse } from 'next/server';
import { withTx } from '@saathi/db';
import { pool } from '@/server/db';

// Liveness: distinguishes web availability from database access. No tenant data.
export async function GET() {
  let db: 'ok' | 'unavailable' = 'ok';
  try {
    await withTx(pool(), {}, (_d, c) => c.query('SELECT 1'));
  } catch {
    db = 'unavailable';
  }
  return NextResponse.json({ web: 'ok', db, time: new Date().toISOString() }, { status: db === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
