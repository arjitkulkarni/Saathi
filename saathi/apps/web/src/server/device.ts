import 'server-only';
import { DEVICE_HEADERS, MAX_DEVICE_BODY_BYTES, SaathiError } from '@saathi/contracts';
import { verifyDeviceRequest, type DeviceAuth } from '@saathi/db';
import { pool } from './db';
import { env } from './env';

/** Authenticate a device request; returns the verified device and its raw body bytes. */
export async function authenticateDevice(req: Request): Promise<{ device: DeviceAuth; body: Uint8Array }> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_DEVICE_BODY_BYTES) throw new SaathiError('VALIDATION_FAILED', 'Device request too large.');
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.length > MAX_DEVICE_BODY_BYTES) throw new SaathiError('VALIDATION_FAILED', 'Device request too large.');
  const h = (k: string) => req.headers.get(k);
  const device = await verifyDeviceRequest(
    pool(),
    { deviceId: h(DEVICE_HEADERS.deviceId), keyVersion: h(DEVICE_HEADERS.keyVersion), timestamp: h(DEVICE_HEADERS.timestamp), nonce: h(DEVICE_HEADERS.nonce), signature: h(DEVICE_HEADERS.signature) },
    req.method,
    new URL(req.url).pathname,
    body,
    env().DEVICE_SECRET_ENCRYPTION_KEY,
  );
  return { device, body };
}

export function parseBody<T>(body: Uint8Array, schema: { parse: (v: unknown) => T }): T {
  try {
    return schema.parse(JSON.parse(new TextDecoder().decode(body)));
  } catch (e) {
    if (e instanceof SyntaxError) throw new SaathiError('VALIDATION_FAILED', 'Body must be JSON.');
    throw e;
  }
}
