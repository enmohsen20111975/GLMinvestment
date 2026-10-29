/**
 * api-client.ts — Unified fetch layer for all API calls (RESTRUCT-A-DB-1).
 *
 * SINGLE ENTRY POINT: every fetch('/api/...') from client components should
 * go through this module. Enforces:
 *   - Canonical response shape { success, source, data, meta } (DATA-SOURCES.md §5.5)
 *   - Consistent error handling (no silent .catch(() => ({ stocks: [] })))
 *   - Auth header forwarding (session token)
 *   - Retry on transient failures (502/503/504)
 *   - RESTRUCT-A-P3: paywall event dispatch on 402/403 (per API-CONTRACT-PAYWALL.md)
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
  /** RESTRUCT-A-P3: HTTP status of the response (0 = network/abort). */
  status?: number;
  /** RESTRUCT-A-P3: parsed paywall error body (when status is 402/403). */
  errorBody?: { error?: string; required_tier?: string; current_tier?: string; [k: string]: unknown };
}

export interface ApiResult<T = unknown> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  retry: () => void;
}

/** Default timeout for API calls (30s — generous for Python proxy calls). */
const DEFAULT_TIMEOUT_MS = 60_000; // FIX: was 30s — /api/stocks with 500 stocks needs more time

/** Transient status codes that warrant a retry. */
const RETRYABLE_STATUS = new Set([502, 503, 504]);

/** Max retry attempts for transient failures. */
const MAX_RETRIES = 2;

// ============================================================================
// RESTRUCT-A-P3: Paywall event dispatch.
// ----------------------------------------------------------------------------
// لما الـ backend يرجّع 402 (trial_expired) أو 403 (insufficient_tier)،
// api-client بـ dispatch window event `paywall:blocked` بـ payload كامل.
// PaywallListener component بيسمع + بيـ trigger المودال الصح بناءً على user state.
// (api-client stateless — ميعرفش user state، فالـ routing بيتعمل في الـ listener.)
// ============================================================================

export interface PaywallBlockedPayload {
  status: number;
  url: string;
  error?: string;
  required_tier?: string;
  current_tier?: string;
  errorBody?: Record<string, unknown>;
}

/**
 * يـ dispatch window event `paywall:blocked` بـ payload.
 * safe في SSR (typeof window check).
 */
function dispatchPaywallBlocked(payload: PaywallBlockedPayload): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('paywall:blocked', { detail: payload }));
  } catch {
    // ignore dispatch errors (e.g. non-DOM env)
  }
}

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
  let lastStatus = 0;
  let lastErrorBody: Record<string, unknown> | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...fetchOpts,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      lastStatus = res.status;

      // Try to parse JSON (all canonical responses are JSON)
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        const errorMsg = body?.error || `HTTP ${res.status}`;
        lastErrorBody = body && typeof body === 'object' ? body : null;

        // RESTRUCT-A-P3: dispatch paywall event for 402/403 (non-retryable paywall codes).
        // Done BEFORE retry/return so the listener fires even if we retry transient 5xx.
        if (res.status === 402 || res.status === 403) {
          dispatchPaywallBlocked({
            status: res.status,
            url,
            error: body?.error,
            required_tier: body?.required_tier,
            current_tier: body?.current_tier,
            errorBody: lastErrorBody || undefined,
          });
        }

        // Retry on transient server errors
        if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
          lastError = errorMsg;
          await sleep(300 * Math.pow(2, attempt)); // 300ms, 600ms
          continue;
        }
        return {
          success: false,
          error: errorMsg,
          data: undefined as unknown as T,
          status: res.status,
          errorBody: lastErrorBody || undefined,
        } as ApiResponse<T>;
      }

      // Canonical response shape: { success, source, data, meta }
      if (body && typeof body.success === 'boolean') {
        const payload = body as Record<string, unknown>;
        if (payload.data === undefined) {
          payload.data = body;
        }
        return body as ApiResponse<T>;
      }

      // Non-canonical response (legacy routes) — wrap it
      return { success: true, data: body as T, source: 'legacy', status: res.status };
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error ? err.message : String(err);
      // Retry on network errors / abort
      if (attempt < MAX_RETRIES && (msg.includes('aborted') || msg.includes('network') || msg.includes('fetch'))) {
        lastError = msg;
        await sleep(300 * Math.pow(2, attempt));
        continue;
      }
      return { success: false, error: msg, data: undefined as unknown as T, status: 0 } as ApiResponse<T>;
    }
  }

  return { success: false, error: lastError || 'max retries exceeded', data: undefined as unknown as T, status: lastStatus } as ApiResponse<T>;
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

// ============================================================================
// RESTRUCT-A-P3 (prerequisite): apiClient object
// ----------------------------------------------------------------------------
// الـ store.ts + components بتـ import { apiClient } من هنا وبتـ call methods
// زي apiClient.getMarketOverview(market). الـ methods دي كانت موجودة قبل كده
// واتشالت في A-DB-1 (regression). ده بيرجّعها بـ unwrap من ApiResponse<T>.
//
// الـ endpoints مبنية على API routes الموجودة:
//   /api/market/overview, /api/ai/models, /api/stocks, /api/stocks/[ticker]/*,
//   /api/egxpilot/news.
//
// كل method بترجع Promise<T> (data مباشرة). لو الـ call فشل → throw (الـ caller
// بيتعامل بـ .catch + null).
// ============================================================================

/**
 * بيـ unwrap ApiResponse<T> لـ data مباشرة. لو فشل → throw Error.
 */
async function unwrap<T>(p: Promise<ApiResponse<T>>): Promise<T> {
  const res = await p;
  if (!res.success) {
    throw new Error(res.error || 'API call failed');
  }
  if (res.data !== undefined && res.data !== null) {
    return res.data as T;
  }
  const { success: _s, error: _e, status: _st, ...rest } = (res as unknown) as Record<string, unknown>;
  return rest as unknown as T;
}

/**
 * بيـ build query string من params object (safe).
 */
function qs(params: Record<string, unknown> | undefined | null): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/**
 * apiClient — unified client object بـ method shorthands.
 * بيـ delegate لـ apiGet + unwrap. الـ store + components بيستوردوه.
 */
export const apiClient = {
  /** GET /api/market/overview?market=... */
  getMarketOverview: (market?: string): Promise<unknown> =>
    unwrap(apiGet<unknown>(`/api/market/overview${qs(market ? { market } : undefined)}`)),

  /** GET /api/ai/models?market=... (insights endpoint) */
  getAiInsights: (market?: string): Promise<unknown> =>
    unwrap(apiGet<unknown>(`/api/ai/models${qs(market ? { market } : undefined)}`)),

  /** GET /api/stocks?... */
  getStocks: (params: Record<string, unknown>): Promise<{ stocks: unknown[]; total?: number }> =>
    unwrap(apiGet<{ stocks: unknown[]; total?: number }>(`/api/stocks${qs(params)}`)),

  /** GET /api/stocks/[ticker] */
  getStock: (ticker: string): Promise<unknown> =>
    unwrap(apiGet<unknown>(`/api/stocks/${encodeURIComponent(ticker)}`)),

  /** GET /api/stocks/[ticker]/history?days=... */
  getStockHistory: (ticker: string, days: number): Promise<unknown> =>
    unwrap(apiGet<unknown>(`/api/stocks/${encodeURIComponent(ticker)}/history${qs({ days })}`)),

  /** GET /api/stocks/[ticker]/recommendation */
  getStockRecommendation: (ticker: string): Promise<unknown> =>
    unwrap(apiGet<unknown>(`/api/stocks/${encodeURIComponent(ticker)}/recommendation`)),

  /** GET /api/stocks/[ticker]/news?limit=... */
  getStockNews: (ticker: string, limit: number): Promise<unknown> =>
    unwrap(apiGet<unknown>(`/api/stocks/${encodeURIComponent(ticker)}/news${qs({ limit })}`)),

  /** GET /api/egxpilot/news?limit=... */
  getEgxPilotNews: (limit: number): Promise<unknown> =>
    unwrap(apiGet<unknown>(`/api/egxpilot/news${qs({ limit })}`)),

  /** GET /api/stocks/[ticker]/professional-analysis */
  getProfessionalAnalysis: (ticker: string): Promise<unknown> =>
    unwrap(apiGet<unknown>(`/api/stocks/${encodeURIComponent(ticker)}/professional-analysis`)),
};
