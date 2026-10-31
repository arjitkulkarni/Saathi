// Canonical serialization version 1 (build.md Ph15.2).
//
// Rules:
//  - Objects: keys sorted by JavaScript default string order (UTF-16 code units);
//    `undefined` values are rejected rather than silently omitted.
//  - Numbers: only safe integers. Floating point values are rejected (no ambiguity).
//  - Strings: Unicode NFC normalized, then JSON-escaped exactly as JSON.stringify does.
//  - Arrays keep their order. Booleans and null are literal.
//  - Timestamps must be normalized by the caller with `normTime` (ISO-8601 UTC, ms, `Z`).
//  - Output is the UTF-8 encoding of the resulting text, with no whitespace.

export const CANONICAL_VERSION = 1;

export type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [k: string]: CanonicalValue };

export class CanonicalizationError extends Error {}

export function canonicalString(value: unknown, path = '$'): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value)) throw new CanonicalizationError(`${path}: only safe integers are allowed (got ${value})`);
      return String(value);
    case 'string':
      return JSON.stringify(value.normalize('NFC'));
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v, i) => canonicalString(v, `${path}[${i}]`)).join(',')}]`;
      if (value instanceof Date) throw new CanonicalizationError(`${path}: convert dates with normTime() first`);
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const parts: string[] = [];
      for (const k of keys) {
        const v = obj[k];
        if (v === undefined) throw new CanonicalizationError(`${path}.${k}: undefined is not allowed`);
        parts.push(`${JSON.stringify(k.normalize('NFC'))}:${canonicalString(v, `${path}.${k}`)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new CanonicalizationError(`${path}: unsupported type ${typeof value}`);
  }
}

const encoder = new TextEncoder();
export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalString(value));
}

/** Normalize a timestamp to ISO-8601 UTC with millisecond precision. */
export function normTime(t: Date | string): string {
  const d = typeof t === 'string' ? new Date(t) : t;
  if (Number.isNaN(d.getTime())) throw new CanonicalizationError(`invalid timestamp: ${String(t)}`);
  return d.toISOString();
}
