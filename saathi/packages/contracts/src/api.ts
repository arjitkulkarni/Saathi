import { z } from 'zod';

export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'STALE_PREVIEW',
  'COVERAGE_UNKNOWN',
  'DEVICE_OFFLINE',
  'UNSUPPORTED_ACTION',
  'RATE_LIMITED',
  'DEPENDENCY_UNAVAILABLE',
  'VALIDATION_FAILED',
  'CONFLICT',
  'INTERNAL',
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ERROR_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  STALE_PREVIEW: 409,
  COVERAGE_UNKNOWN: 409,
  DEVICE_OFFLINE: 409,
  UNSUPPORTED_ACTION: 422,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  INTERNAL: 500,
};

export const RETRYABLE: Record<ErrorCode, boolean> = {
  UNAUTHENTICATED: false,
  FORBIDDEN: false,
  NOT_FOUND: false,
  STALE_PREVIEW: false,
  COVERAGE_UNKNOWN: false,
  DEVICE_OFFLINE: true,
  UNSUPPORTED_ACTION: false,
  RATE_LIMITED: true,
  DEPENDENCY_UNAVAILABLE: true,
  VALIDATION_FAILED: false,
  CONFLICT: true,
  INTERNAL: true,
};

/** Domain error carrying a canonical code. Thrown by services, mapped by API handlers. */
export class SaathiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SaathiError';
  }
  get status() {
    return ERROR_STATUS[this.code];
  }
}

export const ApiErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
  requestId: z.string(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export type ApiSuccess<T> = { data: T; requestId: string; serverTime: string };

export const Uuid = z.string().uuid();
export const IdempotencyKey = z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/);
