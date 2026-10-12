import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { getStockByTickerFallback } from '@/lib/flutter-sqlite-fallback';
import { getSessionUserId } from '@/lib/auth-helper';
import { checkTrialNotExpired } from '@/lib/subscription-gate';
// ─── UNIFIED-DATA-CONTRACT (Task UNIFIED-API-V3, Rule 72) ────────────────
// قبل كده: /api/stocks/[ticker] بـ يجيب RSI/signal من Python backend فقط.
// النتيجة: CANA بـ يطلع RSI=56.8 هنا لكن RSI=79.6 في شاشة comprehensive.
// الحل: نـ inject canonical values من getUnifiedStockData() في الـ response.
import { getUnifiedStockData } from '@/lib/unified-stock-data';
// ─── PKG3-ROUND2 (Rule 67: SSOT — canonical-price) ─────────────────────
// Before: route emitted `current_price` straight from the Python response
//         OR the SQLite-fallback lib row (which reads stocks.db directly).
//         Both paths bypassed the canonical resolution chain.
// After: a final `applyCanonicalPriceOverride()` post-step overrides the
//        response's `current_price` + `previous_close` with values from
//        `getCanonicalPrice()` (Rule 67 SSOT) wrapped in
//        `cache.getOrCompute()` (TTL=60s, LRU=512). Resolution chain:
//          1. stocks.db.stocks.current_price  (canonical primary)
//          2. data_engine.egksco_price_history (historical clean close)
//          3. vps_api.live                     (live, opt-in)
//        Rule 27 (NO-FAKE-DATA): if canonical adapter returns null → keep
//        the existing value (already a real Python or stocks.db number,
//        never fabricated). If BOTH paths return null → null → UI "—".
import { getCanonicalPrice, type CanonicalPrice } from '@/lib/canonical-price';
import { cache } from '@/lib/cache-manager';

export const dynamic = 'force-dynamic';

// GET /api/stocks/[ticker]
// ------------------------
// Primary: Python backend (rich data — fair_value, change_1w/1m, etc.)
// Fallback (FLUTTER-FULL-AUDIT): stocks.db via better-sqlite3 (readonly).
//   Without this fallback the Flutter app's stock-detail screen shows
//   "connection error" whenever the Python service is down — but the
//   underlying stock record IS available in stocks.db. We return it with
//   `source: 'sqlite_fallback'` so the Flutter client can degrade cleanly.
//
// PAYWALL Phase 2 — Gate 1 (P0-4, killer feature):
//   `fair_value` (القيمة العادلة) is the killer feature per
//   PAYWALL-STRATEGY-FINAL.md §5.2 row 1. Server-side enforcement here
//   means the client-side paywall can no longer be bypassed with `curl`.
//   - Anonymous users (no session) → full data (taste hook per §4).
//   - Authenticated + paid OR within 14-day trial → full data.
//   - Authenticated + free + trial expired → `fair_value = null` +
//     `fair_value_locked: true` (we keep `upside_percent` as the
//     marketing teaser "🔒 +29% فرصة — اشترك").
//   Per Rule 50 — NEVER lock safety fields. fair_value is an insight,
//   not safety (stop loss / portfolio risk remain untouched).

export async function GET(req: NextRequest, { params }: { params: { ticker: string } }) {
  const { ticker } = params;
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  // MARKET-FILTER-COMPLETE (Task MARKET-FILTER-COMPLETE):
  // قبل كده: route كان بـ يمرر ticker بس لـ flutter-sqlite-fallback من غير ما
  // يفلتر بـ market → لو فيه ticker متكرر بين EGX و US (15 حالة بسبب migration
  // قديم) كان بـ يرجع السهم الخطأ. الحل: نقرأ `?market=` param ونمرره.
  // Default: 'EGX' (matching maker-radar default).
  // DEEP-MARKET-FIX (Task MULTI-MARKET-DIAGNOSE): قبل كده default='EGX'
  // كان بـ يرفض أي سهم مش EGX (AAPL, BTC, etc.) → 404 "غير موجود".
  // الحل: default='' (no filter) لو ?market= مش متحدد.
  const marketParam = (url.searchParams.get('market') || '').trim();

  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/stocks/${ticker.toUpperCase()}${qs ? `?${qs}` : ''}`,
    `http://127.0.0.1:8010/api/stocks/${ticker.toUpperCase()}${qs ? `?${qs}` : ''}`,
  ];

  // ── Resolve paywall state once, before proxying ─────────────────────
  // Anonymous (no session) → not locked (marketing taste hook).
  // Authenticated → check trial expiry via canonical server-side helper.
  const { userId } = await getSessionUserId();
  let fairValueLocked = false;
  if (userId) {
    const trial = await checkTrialNotExpired(userId);
    if (!trial.ok) {
      // Trial expired AND user is on a non-paid tier → gate applies.
      fairValueLocked = true;
    }
  }

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        // UNIFIED-DATA-CONTRACT: inject canonical values BEFORE paywall gate
        const unifiedData = injectUnifiedData(data, ticker);
        // PKG3-ROUND2 (Rule 67 SSOT): override current_price + previous_close
        // with values from the canonical adapter (stocks.db → data_engine →
        // vps_api). Falls back to the injected value if the canonical adapter
        // returns null (Rule 27 NO-FAKE-DATA — keep real data, never fabricate).
        const canonicalData = await applyCanonicalPriceOverride(unifiedData, ticker);
        return NextResponse.json(applyFairValueGate(canonicalData, fairValueLocked));
      }
    } catch (_err) {
      // Try next fallback
    }
  }

  // ── FLUTTER-FULL-AUDIT: stocks.db fallback (Python unreachable) ──
  const fallback = getStockByTickerFallback(ticker, marketParam);
  if (fallback) {
    // UNIFIED-DATA-CONTRACT: inject canonical values into fallback too
    const unifiedFallback = injectUnifiedData(fallback, ticker);
    // PKG3-ROUND2 (Rule 67 SSOT): same canonical-price override applied to the
    // SQLite-fallback response.
    const canonicalFallback = await applyCanonicalPriceOverride(unifiedFallback, ticker);
    return NextResponse.json(applyFairValueGate(canonicalFallback, fairValueLocked));
  }

  return NextResponse.json({
    success: false,
    error: `Failed to fetch ticker ${ticker}`,
    ticker: ticker.toUpperCase(),
    source: 'sqlite_fallback_empty',
  }, { status: 200 });
}

/**
 * Inject canonical unified values into the stock response.
 * (UNIFIED-DATA-CONTRACT, Task UNIFIED-API-V3, Rule 72)
 *
 * This guarantees that EVERY field that varies across screens (RSI, signal,
 * support, resistance, accumulation, money_flow, master_score) is sourced from
 * the SAME canonical computation, regardless of which backend produced the
 * rest of the response.
 *
 * This is the ROOT-CAUSE fix for: "CANA shows RSI=79.6 in one screen,
 * RSI=56.8 in another, RSI=50.0 in a third".
 */
function injectUnifiedData(data: unknown, ticker: string): unknown {
  const unified = getUnifiedStockData(ticker);
  if (!unified) return data;

  const inject = (rec: Record<string, unknown>): Record<string, unknown> => {
    const next = { ...rec };

    // Override technical fields with canonical values
    next.rsi = unified.technical.rsi ?? next.rsi;
    next.rsi_source = unified.technical.rsi_source;
    next.ma_50 = unified.technical.ma_50 ?? next.ma_50;
    next.ma_200 = unified.technical.ma_200 ?? next.ma_200;
    next.support = unified.technical.support ?? next.support;
    next.resistance = unified.technical.resistance ?? next.resistance;
    next.high_52w = unified.technical.high_52w ?? next.high_52w;
    next.low_52w = unified.technical.low_52w ?? next.low_52w;
    next.trend = unified.technical.trend ?? next.trend;
    next.atr = unified.technical.atr ?? next.atr;

    // Override signal with canonical classification
    next.signal = unified.canonical.signal;
    next.signal_ar = unified.canonical.signal_ar;
    next.master_score = unified.canonical.master_score;
    next.accumulation = unified.canonical.accumulation;
    next.money_flow_state = unified.canonical.money_flow;
    next.phase = unified.canonical.phase;

    // Override current_price with fresh value
    if (unified.stock.current_price != null) {
      next.current_price = unified.stock.current_price;
    }
    if (unified.stock.change_percent != null) {
      next.change_percent = unified.stock.change_percent;
    }
    if (unified.stock.last_update != null) {
      next.last_update = unified.stock.last_update;
    }

    // Inject prediction if available (entry/target/stop)
    if (unified.prediction) {
      next.entry_price = unified.prediction.entry_price;
      next.target_price = unified.prediction.target_price;
      next.target_price_2 = unified.prediction.target_price_2;
      next.stop_loss = unified.prediction.stop_loss;
      next.prediction_date = unified.prediction.prediction_date;
      next.analysis_reason = unified.prediction.analysis_reason;
      next.who_is_buying = unified.prediction.who_is_buying;
      next.hmm_regime = unified.prediction.hmm_regime;
    }

    // Inject radar buy_pct if available
    if (unified.radar) {
      next.buy_pct = unified.radar.buy_pct;
      next.sell_pct = unified.radar.sell_pct;
      next.radar_path = unified.radar.path;
      next.under_microscope = unified.radar.under_microscope;
      next.data_quality = unified.radar.data_quality;
      next.staleness_days = unified.radar.staleness_days;
    }

    // Tag the response so frontend knows it's been unified
    next.unified = true;
    next.unified_source = unified.canonical.master_score_source;
    return next;
  };

  if (Array.isArray(data)) {
    return data.map((r) => (r && typeof r === 'object' ? inject(r as Record<string, unknown>) : r));
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (obj.stock && typeof obj.stock === 'object') {
      return { ...obj, stock: inject(obj.stock as Record<string, unknown>) };
    }
    return inject(obj);
  }
  return data;
}

/**
 * Apply the fair_value paywall to the stock response.
 *
 * When `locked` is true, we strip `fair_value` (and any derived fair-value
 * carrier fields that would let a curious user reverse-compute it from
 * sibling fields). We KEEP `upside_percent` as the marketing teaser
 * ("🔒 +29% فرصة — اشترك") per PAYWALL-STRATEGY-FINAL.md §1 row 1.
 *
 * The function is defensive: it handles both object and array responses
 * (the Python backend sometimes returns `{ stock: {...} }`, sometimes a
 * bare object, sometimes a list).
 */
function applyFairValueGate(data: unknown, locked: boolean): unknown {
  if (!locked) return data;

  // Helper to gate a single stock-shaped record.
  const gateRecord = (rec: Record<string, unknown>): Record<string, unknown> => {
    const next = { ...rec };
    next.fair_value = null;
    next.fair_value_locked = true;
    // Some Python responses nest fair_value under `fundamentals` or
    // `analysis` — gate those too. Keep `upside_percent` for the teaser.
    if (next.fundamentals && typeof next.fundamentals === 'object') {
      next.fundamentals = {
        ...(next.fundamentals as Record<string, unknown>),
        fair_value: null,
      };
    }
    if (next.analysis && typeof next.analysis === 'object') {
      next.analysis = {
        ...(next.analysis as Record<string, unknown>),
        fair_value: null,
      };
    }
    return next;
  };

  if (Array.isArray(data)) {
    return data.map((r) => (r && typeof r === 'object' ? gateRecord(r as Record<string, unknown>) : r));
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    // Common Python shapes: { stock: {...} } or bare { ticker, fair_value, ... }
    if (obj.stock && typeof obj.stock === 'object') {
      return { ...obj, stock: gateRecord(obj.stock as Record<string, unknown>) };
    }
    return gateRecord(obj);
  }
  return data;
}

/**
 * PKG3-ROUND2 (Rule 67 SSOT): override `current_price` + `previous_close`
 * in the response with values from the canonical-price adapter
 * (stocks.db → data_engine → vps_api), wrapped in `cache.getOrCompute()`.
 *
 * Why: this route has TWO price-read paths —
 *   1. The Python response (which itself reads prices from somewhere)
 *   2. The SQLite-fallback lib row (which opens stocks.db directly)
 * Both bypass the canonical resolution chain. After this override, the
 * `current_price` field in the FINAL response always reflects the canonical
 * SSOT — same value seen by /api/explosive, /api/flow, /api/stocks/[ticker]/depth,
 * and /api/stocks/[ticker]/publish-data.
 *
 * Rule 27 (NO-FAKE-DATA): if the canonical adapter returns null (ticker not
 * in stocks.db AND not in data_engine AND vps_api unreachable), the existing
 * value is preserved (still a real Python or stocks.db number — never
 * fabricated). If the existing value is also null → null → UI renders "—".
 *
 * Shape-aware: walks `{stock: {...}}`, bare `{...}`, and array shapes the
 * same way `injectUnifiedData` and `applyFairValueGate` do — keeping the
 * response contract intact.
 */
async function applyCanonicalPriceOverride(
  data: unknown,
  ticker: string
): Promise<unknown> {
  let canonical: CanonicalPrice | null = null;
  try {
    canonical = await cache.getOrCompute(
      `canonical_price:${ticker.toUpperCase()}`,
      () => getCanonicalPrice(ticker, { allowLive: false }),
      60_000,
    );
  } catch {
    // adapter failure → preserve existing value
    return data;
  }
  if (!canonical || !Number.isFinite(canonical.value) || canonical.value <= 0) {
    return data;
  }

  const override = (rec: Record<string, unknown>): Record<string, unknown> => {
    const next = { ...rec };
    next.current_price = canonical!.value;
    next.current_price_source = canonical!.source;
    next.current_price_as_of = canonical!.asOf;
    if (
      canonical!.previousClose != null &&
      Number.isFinite(canonical!.previousClose) &&
      canonical!.previousClose > 0
    ) {
      next.previous_close = canonical!.previousClose;
    }
    return next;
  };

  if (Array.isArray(data)) {
    return data.map((r) => (r && typeof r === 'object' ? override(r as Record<string, unknown>) : r));
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (obj.stock && typeof obj.stock === 'object') {
      return { ...obj, stock: override(obj.stock as Record<string, unknown>) };
    }
    return override(obj);
  }
  return data;
}
