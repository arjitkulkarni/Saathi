import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEVICE_HEADERS, deviceSigningString, type AgentEvent } from '@saathi/contracts';
import { normalize } from '../src/collector';
import { lockoutThreshold, evaluatePosture } from '../src/posture';
import { Spool } from '../src/spool';
import { signHeaders } from '../src/transport';
import { parseArgs } from '../src/index';

const ev = (i: number): AgentEvent => ({ logEpoch: 'e-1', channel: 'Security', nativeEventId: String(i), type: 'auth.failed', observedAt: new Date().toISOString(), facts: { username: 'x'.repeat(50) } });

describe('bounded spool', () => {
  it('keeps events across instances, caps size and counts drops', () => {
    const dir = mkdtempSync(join(tmpdir(), 'saathi-spool-'));
    const s = new Spool(join(dir, 'spool.jsonl'), join(dir, 'dropped.txt'), 2000);
    const r = s.push(Array.from({ length: 40 }, (_, i) => ev(i)));
    expect(r.added).toBeGreaterThan(0);
    expect(r.dropped).toBe(40 - r.added);
    const reopened = new Spool(join(dir, 'spool.jsonl'), join(dir, 'dropped.txt'), 2000);
    expect(reopened.depth()).toBe(r.added);
    expect(reopened.dropped).toBe(r.dropped);
    const batch = reopened.peek(5);
    expect(batch.map((e) => e.nativeEventId)).toEqual(['0', '1', '2', '3', '4']);
    reopened.ack(5);
    expect(reopened.peek(1)[0].nativeEventId).toBe('5');
    expect(reopened.consumeDropped()).toBe(r.dropped);
    expect(reopened.dropped).toBe(0);
  });
});

describe('device request signing matches the server contract', () => {
  it('signs method, path, timestamp, nonce and body hash', () => {
    const body = new TextEncoder().encode('{"a":1}');
    const h = signHeaders({ deviceId: 'd', deviceSecret: 'secret', keyVersion: 1 }, 'POST', '/api/v1/agent/events', body);
    const expected = createHmac('sha256', 'secret')
      .update(deviceSigningString('POST', '/api/v1/agent/events', h[DEVICE_HEADERS.timestamp], h[DEVICE_HEADERS.nonce], createHash('sha256').update(body).digest('hex')))
      .digest('hex');
    expect(h[DEVICE_HEADERS.signature]).toBe(expected);
    expect(h[DEVICE_HEADERS.nonce]).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });
});

describe('normalization and posture', () => {
  it('maps Windows events to the versioned vocabulary with minimized facts', () => {
    const f = normalize('Security', { id: 4625, recordId: 9, time: '2026-10-31T07:00:00.1234567Z', data: { TargetUserName: 'admin', TargetUserSid: 'S-1-5-21-1-2-3-500', IpAddress: '203.0.113.7', LogonType: '3', SubStatus: '0xc000006a' } });
    expect(f).toMatchObject({ type: 'auth.failed', facts: { username: 'admin', sourceAddress: '203.0.113.7', logonType: 3 } });
    expect(normalize('Security', { id: 4624, recordId: 1, time: '2026-10-31T07:00:00Z', data: { LogonType: '5', TargetUserSid: 'S-1-5-18' } })).toBeNull();
    expect(normalize('Security', { id: 4732, recordId: 2, time: '2026-10-31T07:00:00Z', data: { TargetSid: 'S-1-5-32-545' } })).toBeNull();
  });

  it('never turns an unreadable check into a pass', () => {
    const p = evaluatePosture({}, { accounts: [], self: null, elevated: false, adminsKnown: false });
    expect(Object.values(p).every((c) => c?.result === 'unknown')).toBe(true);
    expect(lockoutThreshold('Lockout threshold:                                    Never')).toBe(0);
    expect(lockoutThreshold('Lockout threshold:                                    5')).toBe(5);
  });

  it('refuses plain HTTP to remote servers and accepts the pnpm separator', () => {
    expect(() => parseArgs(['--server', 'http://example.com'])).toThrow(/HTTPS/);
    expect(parseArgs(['--', '--simulate', '--server', 'http://localhost:3000']).mode).toBe('simulate');
  });
});
