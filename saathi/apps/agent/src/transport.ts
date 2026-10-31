import { createHash, createHmac, randomBytes } from 'node:crypto';
import { DEVICE_HEADERS, deviceSigningString } from '@saathi/contracts';

// Authenticated outbound HTTPS to the Saathi API (build.md Ph05.3). Every request is signed
// over method, path, timestamp, nonce and body hash with the per-device HMAC secret.

export type DeviceIdentity = { deviceId: string; orgId: string; deviceSecret: string; keyVersion: number; server: string };

export class TransportError extends Error {
  constructor(
    message: string,
    public status: number,
    public offline = false,
  ) {
    super(message);
  }
}

export function signHeaders(id: Pick<DeviceIdentity, 'deviceId' | 'deviceSecret' | 'keyVersion'>, method: string, path: string, body: Uint8Array, now = new Date()) {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const nonce = randomBytes(18).toString('base64url');
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const signature = createHmac('sha256', id.deviceSecret).update(deviceSigningString(method, path, timestamp, nonce, bodyHash)).digest('hex');
  return {
    [DEVICE_HEADERS.deviceId]: id.deviceId,
    [DEVICE_HEADERS.keyVersion]: String(id.keyVersion),
    [DEVICE_HEADERS.timestamp]: timestamp,
    [DEVICE_HEADERS.nonce]: nonce,
    [DEVICE_HEADERS.signature]: signature,
  };
}

export async function deviceRequest<T>(id: DeviceIdentity, method: 'GET' | 'POST', path: string, payload?: unknown): Promise<T> {
  const body = payload === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(payload));
  let res: Response;
  try {
    res = await fetch(new URL(path, id.server), {
      method,
      headers: { ...signHeaders(id, method, path, body), ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: payload === undefined ? undefined : body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new TransportError(`server unreachable: ${(e as Error).message}`, 0, true);
  }
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { code: string; message: string } };
  if (!res.ok) throw new TransportError(json.error ? `${json.error.code}: ${json.error.message}` : `HTTP ${res.status}`, res.status, res.status >= 500);
  return json.data as T;
}

export async function publicRequest<T>(server: string, path: string, payload: unknown): Promise<T> {
  const res = await fetch(new URL(path, server), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { code: string; message: string } };
  if (!res.ok) throw new TransportError(json.error ? `${json.error.code}: ${json.error.message}` : `HTTP ${res.status}`, res.status);
  return json.data as T;
}
