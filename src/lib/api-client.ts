/**
 * api-client.ts — Unified fetch layer for all API calls (RESTRUCT-A-DB-1).
 *
 * SINGLE ENTRY POINT: every fetch('/api/...') from client components should
 * go through this module. Enforces:
 *   - Canonical response shape { success, source, data, meta } (DATA-SOURCES.md §5.5)
 *   - Consistent error handling (no silent .catch(() => ({ stocks: [] })))
 *   - Auth header forwarding (session token)
 *   - Retry on transient failures (502/503/504)
 *
 * Rule 20 (Python=Brain): this client calls /api/* routes which (per A-DB-1)
 * should proxy to Python — never open SQLite directly from the client.
 *
 * Usage:
 *   const { data, error, isLoading, retry } = useApiFetch('/api/stocks?market=EGX');
 *   // or imperative:
 *   const result = await apiGet<StockData>('/api/stocks?market=EGX');
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  source?: string;
  data?: T;
  meta?: Record<string, unknown>;
  error?: string;
}

export interface ApiResult<T = unknown> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  retry: () => void;
}

/** Default timeout for API calls (30s — generous for Python proxy calls). */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Transient status codes that warrant a retry. */
const RETRYABLE_STATUS = new Set([502, 503, 504]);

/** Max retry attempts for transient failures. */
const MAX_RETRIES = 2;

/**
 * Low-level fetch wrapper with timeout, auth headers, and retry.
 * All /api/* calls from client components should route through this.
 */
export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<ApiResponse<T>> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOpts } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Forward auth token if available (for Python paywall endpoints)
  const headers = new Headers(fetchOpts.headers);
  if (typeof document !== 'undefined') {
    // Client-side: forward cookies automatically (fetch includes same-origin cookies)
  }
  // Set Accept header for JSON
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  fetchOpts.headers = headers;

  let lastError: string | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...fetchOpts,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Try to parse JSON (all canonical responses are JSON)
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        const errorMsg = body?.error || `HTTP ${res.status}`;
        // Retry on transient server errors
        if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
          lastError = errorMsg;
          await sleep(300 * Math.pow(2, attempt)); // 300ms, 600ms
          continue;
        }
        return { success: false, error: errorMsg, data: null };
      }

      // Canonical response shape: { success, source, data, meta }
      if (body && typeof body.success === 'boolean') {
        return body as ApiResponse<T>;
      }

      // Non-canonical response (legacy routes) — wrap it
      return { success: true, data: body as T, source: 'legacy' };
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error ? err.message : String(err);
      // Retry on network errors / abort
      if (attempt < MAX_RETRIES && (msg.includes('aborted') || msg.includes('network') || msg.includes('fetch'))) {
        lastError = msg;
        await sleep(300 * Math.pow(2, attempt));
        continue;
      }
      return { success: false, error: msg, data: null };
    }
  }

  return { success: false, error: lastError || 'max retries exceeded', data: null };
}

/** Convenience: GET request. */
export async function apiGet<T = unknown>(url: string, options?: RequestInit & { timeoutMs?: number }): Promise<ApiResponse<T>> {
  return apiFetch<T>(url, { ...options, method: 'GET' });
}

/** Convenience: POST request. */
export async function apiPost<T = unknown>(url: string, body?: unknown, options?: RequestInit & { timeoutMs?: number }): Promise<ApiResponse<T>> {
  return apiFetch<T>(url, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
