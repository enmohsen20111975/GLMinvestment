// Analytics event emitter — wraps /api/track endpoint.
// Used to track user behavior: feature_use, stock_view, api_error.
//
// USER-ANALYTICS-EMITTERS (2026-10-XX):
//   The audit (USER-ANALYTICS-AUDIT-1) found only `page_view` events were
//   being emitted. This module adds the missing event types so we can answer:
//     • What tools each user is using        → feature_use
//     • What stocks each user views          → stock_view
//     • What problems each user encounters   → api_error
//
// Design rules (Rule 55 — analytics must NOT break UX):
//   • Fire-and-forget — never `await` an analytics call.
//   • Always wrapped in try/catch — a tracking failure must be silent.
//   • Client-only — guarded with `typeof window` so SSR is a no-op.

export type AnalyticsEventType =
  | 'page_view'
  | 'feature_use'
  | 'stock_view'
  | 'api_error'
  | 'session_start';

export interface AnalyticsEvent {
  type: AnalyticsEventType;
  view?: string;
  action?: string;
  detail?: string;
  duration_sec?: number;
}

// Fire-and-forget — never blocks UI.
export function trackEvent(event: AnalyticsEvent): void {
  try {
    if (typeof window === 'undefined') return;
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      // `keepalive: true` lets the request survive page navigations / closes
      // without forcing the caller to await it. Critical for fire-and-forget.
      keepalive: true,
    }).catch(() => {
      // Non-fatal — analytics must not break UX.
    });
  } catch {
    // ignore
  }
}

// Convenience helpers — these are the primary entry points other modules use.

export function trackFeature(feature: string, detail?: string): void {
  trackEvent({ type: 'feature_use', action: feature, detail });
}

export function trackStockView(ticker: string): void {
  trackEvent({ type: 'stock_view', detail: ticker });
}

export function trackApiError(view: string, error: string): void {
  trackEvent({ type: 'api_error', view, detail: error });
}
