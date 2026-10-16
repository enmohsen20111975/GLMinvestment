/**
 * unified/route.ts — CANONICAL unified stock API (SINGLE SOURCE OF TRUTH)
 * ===============================================================================
 *
 * Route:  GET /api/stocks/[ticker]/unified
 *
 * Problem it solves:
 *   5 different UI screens showed 5 different signals for ETEL/CANA because each
 *   screen read from a different DB / API / calculation. This route is the
 *   ONE place that merges every data source and returns a canonical signal.
 *
 * Implementation:
 *   The actual computation logic lives in `src/lib/unified-stock-data.ts`.
 *   This route is a thin wrapper — same logic shared by all stock API routes.
 *
 * TASK-BACKEND-BRAVO (2026-10-15):
 *   In addition to the local `getUnifiedStockData` shape, we now ALSO fetch
 *   `http://127.0.0.1:8010/api/stocks/<ticker>/unified` (Python FastAPI/Flask
 *   mounted via a2wsgi) with a 2s AbortController timeout. If Python responds,
 *   we merge `has_active_trade`, `observation_status`, `observation_reason`,
 *   `trade_setup`, `stock_info` into the Next.js response. These new fields
 *   take precedence over any local equivalent.
 *   If Python is unreachable, we compute `has_active_trade` locally from the
 *   prediction fields using the SAME conditions as the Python side, and we set
 *   the Arabic observation_* fallbacks. NEVER crash if Python is down — the
 *   local path must always return.
 *
 * Rule 67 (CALCULATION-CANONICAL) + Rule 72 (UNIFIED-DATA-CONTRACT).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUnifiedStockData } from '@/lib/unified-stock-data';
// PHASE3-MARKET-SEGREGATION: validate the optional `market` query param so the
// canonical unified data is consistent with the user's selected market. The
// param is NOT used to filter — `getUnifiedStockData` reads `stock.market`
// directly from stocks.db (single source of truth). We only validate that
// the supplied alias is recognised, so the frontend can pass either 'TADAWUL'
// or 'KSA' without breaking the route.
import { normalizeMarket } from '@/lib/market-utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ─── TASK-BACKEND-BRAVO: local computation helpers ─────────────────────────

type TradeSetup = {
  entry_price: number;
  stop_loss: number;
  target_1: number;
  target_2: number | null;
  rr_ratio: number;
  signal: string;
} | null;

type PredictionLike = {
  entry_price?: number | null;
  stop_loss?: number | null;
  target_price?: number | null;
  target_price_2?: number | null;
  risk_reward?: number | null;
  signal_type?: string | null;
  signal_raw?: string | null;
} | null;

const ACTIVE_SIGNALS = new Set(['BUY', 'STRONG_BUY', 'ACCUMULATE']);
const MIN_RR_RATIO = 1.5;
const PYTHON_TIMEOUT_MS = 2000;
const PYTHON_BASE_URL = 'http://127.0.0.1:8010';

const OBSERVATION_STATUS_FALLBACK_AR =
  'وضع المراقبة: كاش وانتظار — لا توجد نقطة دخول آمنة بشروط المنصة حالياً';

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function computeLocalRR(
  entry: number | null,
  stop: number | null,
  target: number | null
): number | null {
  if (entry === null || stop === null || target === null) return null;
  const risk = entry - stop;
  const reward = target - entry;
  if (risk <= 0 || reward <= 0) return null;
  return Math.round((reward / risk) * 100) / 100;
}

/**
 * Compute has_active_trade + trade_setup from the LOCAL prediction object
 * (used only when Python is unreachable). Mirrors the Python conditions:
 *   entry_price > 0 AND stop_loss > 0 AND stop_loss < entry_price
 *   AND target_price > entry_price AND rr_ratio >= 1.5
 *   AND signal in {BUY, STRONG_BUY, ACCUMULATE}
 *   AND current_price > low_52w (Rule 78 IRON).
 */
function computeLocalActiveTrade(
  pred: PredictionLike,
  currentPrice: number | null,
  low52w: number | null
): { has_active_trade: boolean; trade_setup: TradeSetup } {
  const entry = num(pred?.entry_price);
  const stop = num(pred?.stop_loss);
  const target = num(pred?.target_price);
  const target2 = num(pred?.target_price_2) ?? null;
  const signalRaw = (pred?.signal_type || pred?.signal_raw || '').toString().trim().toUpperCase();

  // Rule 78 (IRON): breaking 52-week low → no trade, no exceptions.
  if (currentPrice !== null && low52w !== null && currentPrice <= low52w) {
    return { has_active_trade: false, trade_setup: null };
  }
  if (
    !entry || entry <= 0 ||
    !stop || stop <= 0 ||
    stop >= entry ||
    !target || target <= entry ||
    !signalRaw || !ACTIVE_SIGNALS.has(signalRaw)
  ) {
    return { has_active_trade: false, trade_setup: null };
  }
  const rr = pred?.risk_reward != null ? num(pred.risk_reward) : computeLocalRR(entry, stop, target);
  if (rr === null || rr < MIN_RR_RATIO) {
    return { has_active_trade: false, trade_setup: null };
  }
  return {
    has_active_trade: true,
    trade_setup: {
      entry_price: Math.round(entry * 10000) / 10000,
      stop_loss: Math.round(stop * 10000) / 10000,
      target_1: Math.round(target * 10000) / 10000,
      target_2: target2 !== null ? Math.round(target2 * 10000) / 10000 : null,
      rr_ratio: rr,
      signal: signalRaw,
    },
  };
}

function buildLocalObservationReason(pred: PredictionLike, rr: number | null): string {
  if (!pred || pred.entry_price == null) {
    return 'لا يوجد توقع طازج في قاعدة البيانات — وضع المراقبة حتى ظهور إشارة موثقة.';
  }
  if (rr !== null && rr < MIN_RR_RATIO) {
    return `نسبة العائد للمخاطرة R/R غير مجزية (${rr.toFixed(2)} < ${MIN_RR_RATIO}) والسهم في مسار عرضي ضعيف السيولة`;
  }
  const signalRaw = (pred?.signal_type || pred?.signal_raw || '').toString().trim().toUpperCase();
  if (signalRaw && !ACTIVE_SIGNALS.has(signalRaw)) {
    return `الإشارة الحالية (${signalRaw || 'محايدة'}) ليست من إشارات الشراء المعتمدة — انتظار تأكيد.`;
  }
  return 'لا توجد نقطة دخول آمنة بشروط المنصة حالياً.';
}

/**
 * Fetch the Python unified route with a 2s AbortController timeout.
 * Returns null if Python is unreachable or returns non-JSON / non-200.
 * NEVER throws.
 */
async function fetchPythonUnified(ticker: string): Promise<Record<string, unknown> | null> {
  const url = `${PYTHON_BASE_URL}/api/stocks/${encodeURIComponent(ticker)}/unified`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PYTHON_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    if (json && typeof json === 'object' && json.success === true) {
      return json;
    }
    return null;
  } catch {
    // Python down or timeout — silent fallback (Rule 27: never crash).
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Main handler ──────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const resolvedParams = await params;
  const ticker = (resolvedParams?.ticker ?? '').toString().toUpperCase().trim();
  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'missing_ticker' },
      { status: 400 }
    );
  }

  // PHASE3-MARKET-SEGREGATION: read & validate the market query param.
  const url = new URL(req.url);
  const marketParam = url.searchParams.get('market');
  if (marketParam) {
    const canonical = normalizeMarket(marketParam);
    if (canonical === null && marketParam.toLowerCase() !== 'all') {
      console.warn(`[unified] unknown market alias "${marketParam}" for ticker ${ticker} — ignoring`);
    }
  }

  // Step 1: ALWAYS compute local data first (this MUST always succeed).
  const data = getUnifiedStockData(ticker);
  if (!data) {
    return NextResponse.json(
      { success: false, error: 'stock_not_found', ticker },
      { status: 404 }
    );
  }

  // Step 2: Try to enrich with Python :8010 unified route. Never throws.
  const pythonData = await fetchPythonUnified(ticker);

  if (pythonData) {
    // Merge the new fields — they take precedence over any local equivalent.
    return NextResponse.json({
      ...data,
      has_active_trade: pythonData.has_active_trade ?? false,
      observation_status: pythonData.observation_status ?? null,
      observation_reason: pythonData.observation_reason ?? null,
      trade_setup: pythonData.trade_setup ?? null,
      stock_info: pythonData.stock_info ?? null,
    });
  }

  // Step 3: Python unreachable — compute has_active_trade locally.
  const pred = (data as { prediction?: PredictionLike }).prediction ?? null;
  const currentPrice = num((data as { stock?: { current_price?: number | null } }).stock?.current_price);
  const low52w = num((data as { technical?: { low_52w?: number | null } }).technical?.low_52w);
  const { has_active_trade, trade_setup } = computeLocalActiveTrade(pred, currentPrice, low52w);

  const localRR =
    pred?.risk_reward != null ? num(pred.risk_reward) : computeLocalRR(
      num(pred?.entry_price),
      num(pred?.stop_loss),
      num(pred?.target_price)
    );

  const observation_status = has_active_trade ? null : OBSERVATION_STATUS_FALLBACK_AR;
  const observation_reason = has_active_trade ? null : buildLocalObservationReason(pred, localRR);

  return NextResponse.json({
    ...data,
    has_active_trade,
    observation_status,
    observation_reason,
    trade_setup,
    // Local fallback: stock_info not available — keep existing fields only.
    stock_info: null,
  });
}
