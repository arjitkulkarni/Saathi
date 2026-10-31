'use client';

import useSWR, { type SWRConfiguration } from 'swr';
import type { ErrorCode } from '@saathi/contracts';

export class ApiError extends Error {
  constructor(
    public code: ErrorCode | 'NETWORK',
    message: string,
    public status: number,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  let body: { data?: T; error?: { code: ErrorCode; message: string; details?: Record<string, unknown> } } = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok || body.error) throw new ApiError(body.error?.code ?? 'INTERNAL', body.error?.message ?? `Request failed (${res.status})`, res.status, body.error?.details);
  return body.data as T;
}

export async function apiGet<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError('NETWORK', 'Network unavailable', 0);
  }
  return parse<T>(res);
}

export async function apiSend<T>(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method, credentials: 'same-origin', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('NETWORK', 'Network unavailable', 0);
  }
  return parse<T>(res);
}

/** Stable idempotency key per approval attempt; a retry reuses it (frontend.md §12). */
export function newIdempotencyKey() {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Poll a resource while `active(data)` holds, starting at ~2 s and backing off to 15 s.
 * Polling pauses when the tab is hidden and revalidates on focus.
 */
export function usePolling<T>(url: string | null, fallbackData: T | undefined, active: (d: T | undefined) => boolean, opts: SWRConfiguration = {}) {
  let ticks = 0;
  return useSWR<T>(url, apiGet, {
    fallbackData,
    revalidateOnFocus: true,
    refreshWhenHidden: false,
    keepPreviousData: true,
    refreshInterval: (d) => {
      if (!active(d)) return 0;
      ticks++;
      return Math.min(2000 * Math.pow(1.25, Math.max(0, ticks - 5)), 15000);
    },
    ...opts,
  });
}
