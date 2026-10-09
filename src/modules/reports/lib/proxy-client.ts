/**
 * Reports Proxy Client (Task 42 — Rule 67 fix)
 * =========================================================================
 *
 * A thin TypeScript wrapper around the unified Next.js proxy at
 *   /api/reports/proxy?type=daily|weekly|monthly&market=EGX
 *
 * Why this exists (Rule 67 — root cause = data source chaos):
 *   Before Task 42, the reports module fetched from 10+ different APIs:
 *   - /api/stored-analysis/results
 *   - /api/stored-analysis/live-tracking
 *   - apiClient.getAiInsights            → /api/market/recommendations/ai-insights
 *   - apiClient.getMarketOverview         → /api/market/overview
 *   - apiClient.getProfessionalAnalysis   → /api/stocks/[ticker]/professional-analysis
 *   - /api/predictions/honest-tracking/list
 *   - /api/predictions/honest-tracking/missed-opportunities
 *   - /api/market/recommendations/ai-insights
 *   - /api/market/overview
 *   - /api/stocks
 *   - /api/export
 *
 *   Same data (predictions / market overview) was fetched from 3-4 different
 *   APIs → data conflicts.
 *
 *   This client is the SINGLE entry point for report data on the
 *   frontend. It calls Python via the proxy and returns a typed shape.
 *   Node.js does ZERO processing — Rule 20 (Python=Brain).
 *
 * Public API:
 *   fetchDailyReport(market?)   → Python /api/reports/daily/summary
 *   fetchWeeklyReport(market?)  → Python /api/reports/weekly/summary
 *   fetchMonthlyReport(market?)→ Python /api/reports/monthly/summary
 *   exportReportToPng(el, filename) → html-to-image.toPng (2x retina)
 *   triggerPrint()              → window.print() with print CSS
 *
 * Note on resilience:
 *   Python may be down in sandbox/dev. When the proxy returns 502/504,
 *   we return a typed "empty" payload (skipped=true, reason=offline)
 *   so the UI can render its fallback state instead of crashing
 *   (Rule 67 — never fabricate; show "—" / "offline" honestly).
 */

import { toPng } from 'html-to-image';

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirror the Python reports_engine.generate_{daily,weekly,monthly}_summary
// output (see vps-service/analyzers/reports_engine.py).
// ─────────────────────────────────────────────────────────────────────────────

export type ReportType = 'daily' | 'weekly' | 'monthly';

/** A single gainer/loser row returned by Python. */
export interface ReportStockMini {
  symbol?: string;
  name?: string;
  name_ar?: string;
  change_percent?: number;
  current_price?: number;
  volume?: number;
  [k: string]: unknown;
}

export interface DailyReportSummary {
  total_stocks?: number;
  gainers?: number;
  losers?: number;
  unchanged?: number;
  market_breadth?: number;
  [k: string]: unknown;
}

export interface DailyReportPayload {
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  report_id?: string;
  type?: string;
  title?: string;
  content?: string;
  image_path?: string | null;
  summary?: DailyReportSummary;
  top_gainers?: ReportStockMini[];
  top_losers?: ReportStockMini[];
  gold?: { price_21?: number | string; [k: string]: unknown } | null;
  usd_rate?: number | null;
}

export interface WeeklyPerformer {
  symbol?: string;
  name?: string;
  change_percent?: number;
  [k: string]: unknown;
}

export interface WeeklyReportPayload {
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  report_id?: string;
  type?: string;
  title?: string;
  content?: string;
  image_path?: string | null;
  egx30_perf?: number;
  best_stock?: WeeklyPerformer | null;
  worst_stock?: WeeklyPerformer | null;
  gold_perf?: number;
  usd_perf?: number;
  lessons?: string[];
  watchlist?: string[];
  sparkline_egx?: number[];
  sparkline_gold?: number[];
  sparkline_usd?: number[];
  top_performers?: WeeklyPerformer[];
}

export interface MonthlyReportPayload {
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  report_id?: string;
  type?: string;
  title?: string;
  content?: string;
  image_path?: string | null;
  [k: string]: unknown;
}

export interface ProxyFetchOptions {
  market?: string;
  force?: boolean;
  signal?: AbortSignal;
}

class ReportsProxyError extends Error {
  readonly isTimeout: boolean;
  readonly isOffline: boolean;
  constructor(message: string, opts: { timeout?: boolean; offline?: boolean }) {
    super(message);
    this.name = 'ReportsProxyError';
    this.isTimeout = Boolean(opts.timeout);
    this.isOffline = Boolean(opts.offline);
  }
}

const PROXY_BASE = '/api/reports/proxy';

/**
 * Unwrap the Python reports envelope.
 *
 * reports_routes.py returns EVERY report inside an envelope:
 *   { success: true, timestamp: "...", data: { report_id, type, title,
 *     content, summary, top_gainers, top_losers, gold, usd_rate, ... } }
 *
 * The report components (ReportsView / DailyMarketReport) read those fields
 * at the TOP level of the payload. Without this unwrap every accessor resolves
 * to undefined and the whole screen renders empty.
 *
 * Also carries the envelope's `success` / `timestamp` down when the inner
 * report object does not define them itself.
 */
function unwrapReportEnvelope<T>(raw: unknown): T {
  if (!raw || typeof raw !== 'object') return raw as T;
  const envelope = raw as Record<string, unknown>;
  const inner = envelope.data;
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) {
    return raw as T;
  }
  const report = { ...(inner as Record<string, unknown>) };
  if (report.success === undefined && envelope.success !== undefined) {
    report.success = envelope.success;
  }
  if (report.timestamp === undefined && envelope.timestamp !== undefined) {
    report.timestamp = envelope.timestamp;
  }
  return report as T;
}

/**
 * Build the proxy URL. Exported for tests + the GET route sanity check.
 */
export function buildProxyUrl(
  type: ReportType,
  market = 'EGX',
  force = false,
): string {
  const sp = new URLSearchParams();
  sp.set('type', type);
  sp.set('market', market);
  if (force) sp.set('force', 'true');
  return `${PROXY_BASE}?${sp.toString()}`;
}

/**
 * Generic fetcher for the reports proxy. Handles Python-down and
 * timeout cases by returning a typed "skipped" payload rather than
 * throwing — Rule 67: never fabricate, show honest offline state.
 */
async function fetchProxy<T extends DailyReportPayload | WeeklyReportPayload | MonthlyReportPayload>(
  type: ReportType,
  opts: ProxyFetchOptions = {},
): Promise<T> {
  const url = buildProxyUrl(type, opts.market ?? 'EGX', Boolean(opts.force));
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: opts.signal,
    });

    if (!res.ok) {
      // 502 / 504 / 500 — Python backend unavailable.
      const isTimeout = res.status === 504;
      const text = await res.text().catch(() => '');
      throw new ReportsProxyError(
        text || `Proxy returned ${res.status}`,
        { timeout: isTimeout, offline: !isTimeout },
      );
    }

    const json = await res.json();
    return unwrapReportEnvelope<T>(json);
  } catch (err) {
    // Network error / abort / fetch failed entirely.
    if (err instanceof ReportsProxyError) throw err;
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new ReportsProxyError(
      aborted ? 'Request aborted (timeout)' : String(err),
      { timeout: aborted, offline: !aborted },
    );
  }
}

/**
 * Fetch the daily market summary from Python reports_routes.py.
 * On offline/timeout, returns a typed "skipped" payload so the UI
 * can render a fallback without crashing.
 */
export async function fetchDailyReport(
  opts: ProxyFetchOptions = {},
): Promise<DailyReportPayload> {
  try {
    return await fetchProxy<DailyReportPayload>('daily', opts);
  } catch (err) {
    return {
      success: false,
      skipped: true,
      reason:
        err instanceof ReportsProxyError
          ? err.isTimeout
            ? 'انتهت مهلة الاتصال بمحرك التقارير'
            : 'محرك التقارير غير متاح حالياً'
          : 'تعذّر تحميل التقرير',
    };
  }
}

/**
 * Fetch the weekly market summary from Python reports_routes.py.
 */
export async function fetchWeeklyReport(
  opts: ProxyFetchOptions = {},
): Promise<WeeklyReportPayload> {
  try {
    return await fetchProxy<WeeklyReportPayload>('weekly', opts);
  } catch (err) {
    return {
      success: false,
      skipped: true,
      reason:
        err instanceof ReportsProxyError
          ? err.isTimeout
            ? 'انتهت مهلة الاتصال بمحرك التقارير'
            : 'محرك التقارير غير متاح حالياً'
          : 'تعذّر تحميل التقرير',
    };
  }
}

/**
 * Fetch the monthly market summary from Python reports_routes.py.
 */
export async function fetchMonthlyReport(
  opts: ProxyFetchOptions = {},
): Promise<MonthlyReportPayload> {
  try {
    return await fetchProxy<MonthlyReportPayload>('monthly', opts);
  } catch (err) {
    return {
      success: false,
      skipped: true,
      reason:
        err instanceof ReportsProxyError
          ? err.isTimeout
            ? 'انتهت مهلة الاتصال بمحرك التقارير'
            : 'محرك التقارير غير متاح حالياً'
          : 'تعذّر تحميل التقرير',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export helpers — PNG (html-to-image) + Print (window.print).
// Phase 3 of Task 42:
//   - Replace the fragile patch-html2pdf with html-to-image (already installed).
//   - For PDF: use the browser-native window.print() with a print stylesheet.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExportPngOptions {
  /** Multiplier for retina-quality export. Default 2 (2x retina). */
  pixelRatio?: number;
  /** Background color for the exported PNG (defaults to dark navy #0a0e1a). */
  backgroundColor?: string;
  /** Output filename (without extension). */
  filename: string;
  /** Skip elements with these CSS class names (e.g. 'no-export'). */
  filter?: (node: HTMLElement) => boolean;
}

/**
 * Export an HTMLElement to a high-resolution PNG using html-to-image.
 *
 * Phase 3 of Task 42 — replaces the fragile patch-html2pdf approach
 * (html2canvas + jsPDF) with html-to-image's toPng, which is already
 * installed and supports Tailwind v4 oklch colors out-of-the-box.
 *
 * Default pixelRatio=2 → retina-quality export.
 */
export async function exportReportToPng(
  element: HTMLElement,
  opts: ExportPngOptions,
): Promise<void> {
  const dataUrl = await toPng(element, {
    pixelRatio: opts.pixelRatio ?? 2,
    backgroundColor: opts.backgroundColor ?? '#0a0e1a',
    cacheBust: true,
    filter: opts.filter,
    style: {
      // Ensure consistent export regardless of theme:
      color: '#e5e7eb',
    },
  });

  // Trigger browser download.
  const link = document.createElement('a');
  link.download = `${opts.filename.endsWith('.png') ? opts.filename : `${opts.filename}.png`}`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Trigger the browser print dialog. Used for PDF export via
 * "Save as PDF" in the print preview. Phase 3 of Task 42 — no
 * library needed, browser-native, A4 print stylesheet is already
 * applied via the `print:` Tailwind variant.
 */
export function triggerPrint(): void {
  if (typeof window !== 'undefined') {
    window.print();
  }
}

/**
 * Combined export helper: PNG first (default), then optionally
 * print for PDF. Used by every report tab's toolbar.
 */
export async function exportReport(
  element: HTMLElement | null,
  kind: 'png' | 'print',
  filename: string,
): Promise<void> {
  if (!element) {
    throw new Error('Report container not found');
  }
  if (kind === 'png') {
    await exportReportToPng(element, { filename });
  } else {
    triggerPrint();
  }
}

/**
 * Format a number defensively — Rule 67: never fabricate, show "—"
 * when the value is missing / NaN.
 */
export function safeFmtNum(
  v: unknown,
  digits = 2,
  suffix = '',
): string {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string'
        ? parseFloat(v.replace(/[^0-9.+-]/g, ''))
        : NaN;
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${suffix}`;
}

/**
 * Format a percent value with sign + "٪" Arabic-localized.
 */
export function safeFmtPct(v: unknown, digits = 2): string {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string'
        ? parseFloat(v.replace(/[^0-9.+-]/g, ''))
        : NaN;
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

/**
 * Format an Arabic date string from a Python ISO timestamp.
 */
export function safeFmtArDate(iso: string | null | undefined): string {
  if (!iso) return new Date().toLocaleDateString('ar-EG');
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch { // silent fallback (safe-by-design)
    return new Date().toLocaleDateString('ar-EG');
  }
}
