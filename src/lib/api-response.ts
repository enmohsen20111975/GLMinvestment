/**
 * api-response.ts — Unified API Response Schema (PKG2 — Strict Engineering)
 * ====================================================================
 * Goal: ONE response shape across all 453+ API routes.
 *
 *   {
 *     success: boolean,          // required — always present
 *     data?:    T,               // present on success
 *     error?:   { code, message, details? },  // present on failure
 *     timestamp: string (ISO),   // always present — for sync/debug (Rule 67 SSOT)
 *   }
 *
 * Rule 67 (SSOT): every screen reads the same `timestamp` so stale-data
 * drift is impossible to hide.
 *
 * Usage:
 *   import { apiOk, apiErr, wrapHandler } from '@/lib/api-response';
 *
 *   export async function GET() {
 *     try {
 *       const rows = await db.getAll();
 *       return apiOk(rows);
 *     } catch (e) {
 *       return apiErr('internal_error', 'فشل في جلب البيانات', 500, e);
 *     }
 *   }
 *
 * Or wrap an entire handler for automatic try/catch:
 *   export const GET = wrapHandler(async (req) => { ... });
 */

import { NextResponse } from 'next/server';

// ============================================================
// Types
// ============================================================

export interface ApiErrorBody {
  code: string;          // machine-readable, e.g. 'not_found', 'validation_error'
  message: string;       // human-readable (localized)
  details?: unknown;     // optional context (field errors, etc.)
}

export interface ApiSuccessEnvelope<T = unknown> {
  success: true;
  data: T;
  timestamp: string;     // ISO 8601 UTC
}

export interface ApiErrorEnvelope {
  success: false;
  error: ApiErrorBody;
  timestamp: string;
}

export type ApiResponseEnvelope<T = unknown> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

// ============================================================
// Builders
// ============================================================

/** Build a success response: `{ success: true, data, timestamp }`. */
export function apiOk<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccessEnvelope<T>> {
  return NextResponse.json<ApiSuccessEnvelope<T>>(
    { success: true, data, timestamp: nowIso() },
    { status: 200, ...init }
  );
}

/** Build an error response: `{ success: false, error: { code, message, details? }, timestamp }`. */
export function apiErr(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
  init?: ResponseInit
): NextResponse<ApiErrorEnvelope> {
  return NextResponse.json<ApiErrorEnvelope>(
    {
      success: false,
      error: { code, message, ...(details !== undefined ? { details } : {}) },
      timestamp: nowIso(),
    },
    { status, ...init }
  );
}

// ---- common error shortcuts -----------------------------------------------

export const apiBadRequest = (message: string, details?: unknown) =>
  apiErr('bad_request', message, 400, details);

export const apiUnauthorized = (message = 'غير مصرح') =>
  apiErr('unauthorized', message, 401);

export const apiForbidden = (message = 'ممنوع الوصول') =>
  apiErr('forbidden', message, 403);

export const apiNotFound = (message = 'غير موجود') =>
  apiErr('not_found', message, 404);

export const apiConflict = (message: string, details?: unknown) =>
  apiErr('conflict', message, 409, details);

export const apiInternal = (message = 'خطأ داخلي', details?: unknown) =>
  apiErr('internal_error', message, 500, details);

// ============================================================
// wrapHandler — auto try/catch for route handlers
// ============================================================

type Handler = (req: Request, ctx: any) => unknown | Promise<unknown>;

/**
 * Wrap a route handler with automatic error handling.
 * Any thrown error becomes a unified `apiErr` response.
 *
 *   export const GET = wrapHandler(async (req) => {
 *     const rows = await db.all();
 *     return apiOk(rows);
 *   });
 */
export function wrapHandler(handler: Handler) {
  return async (req: Request, ctx: any): Promise<Response> => {
    try {
      const result = await handler(req, ctx);
      // If the handler already returned a NextResponse (e.g. apiOk), pass through.
      if (result instanceof Response) return result;
      // Otherwise wrap the raw value.
      return apiOk(result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return apiErr('internal_error', msg, 500);
    }
  };
}

// ============================================================
// Helpers
// ============================================================

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Type guard: was a fetch response a unified success envelope?
 * Useful on the client to narrow the response safely.
 */
export function isApiSuccess<T>(body: ApiResponseEnvelope<T>): body is ApiSuccessEnvelope<T> {
  return body.success === true;
}

export function isApiError<T>(body: ApiResponseEnvelope<T>): body is ApiErrorEnvelope {
  return body.success === false;
}
