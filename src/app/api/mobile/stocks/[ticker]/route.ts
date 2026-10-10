import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { pythonFetch } from '@/lib/python-backend';
import { ensureInitialized, getLightDb } from '@/lib/egx-db';
import { getSessionUserId } from '@/lib/auth-helper';
import { checkTrialNotExpired } from '@/lib/subscription-gate';

/**
 * GET /api/mobile/stocks/[ticker]
 * بيانات سهم معين للجوال - يستخدم Python Backend أولاً ثم Local DB
 *
 * PHASE-4 (canonical_signal migration, API-AUDIT-2):
 * Mobile previously returned a 17-field subset of the desktop
 * /api/stocks/[ticker] record — this was a customer complaint source
 * (mobile users saw fewer fields than desktop, e.g. no change_percent,
 * no fair_value, no signal/trend, no technicals). We now restore the
 * full field set so mobile parity matches desktop.
 *
 * PAYWALL parity (Rule 50): mobile now applies the same fair_value
 * paywall gate as the desktop route — anonymous users see it as a
 * marketing teaser, authenticated free users past 14-day trial get
 * `fair_value = null` + `fair_value_locked: true`. This closes a
 * previous bypass where the mobile route returned fair_value
 * unconditionally to trial-expired users.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const tickerUpper = ticker.toUpperCase();

    // ── Resolve paywall state once (mirrors /api/stocks/[ticker]) ────
    const { userId } = await getSessionUserId();
    let fairValueLocked = false;
    if (userId) {
      const trial = await checkTrialNotExpired(userId);
      if (!trial.ok) {
        fairValueLocked = true;
      }
    }

    // 1. Try Python Backend first
    const pythonResult = await pythonFetch<{ success: boolean; data: any }>(`/api/stocks/${tickerUpper}`);

    if (pythonResult.success && pythonResult.data?.data) {
      const stock = pythonResult.data.data;
      const mobilePayload = buildMobilePayload(stock, tickerUpper, 'python_backend');
      return NextResponse.json(applyFairValueGate(mobilePayload, fairValueLocked));
    }

    // 2. Fallback to Local DB
    await ensureInitialized();
    const dbLite = getLightDb();

    const stock = dbLite.prepare(`
      SELECT * FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1
    `).get(tickerUpper) as Record<string, unknown> | undefined;

    if (!stock) {
      return NextResponse.json(
        { success: false, error: 'Stock not found', ticker: tickerUpper },
        { status: 404 }
      );
    }

    // Format response for mobile — full field parity with desktop
    const mobilePayload = buildMobilePayload(stock, tickerUpper, 'local_db');
    return NextResponse.json(applyFairValueGate(mobilePayload, fairValueLocked));
  } catch (error) {
    console.error('[Mobile Stocks] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load stock data' },
      { status: 500 }
    );
  }
}

/**
 * Build a mobile-shaped payload from either the Python response or the
 * SQLite row. Returns ALL fields the desktop /api/stocks/[ticker]
 * canonical route returns (no field dropping) so Flutter gets parity.
 *
 * Defensive: every field has a fallback (|| 0 / || null / || '') so the
 * response shape is stable regardless of source (Python vs SQLite).
 * Rule 27 (NO-FAKE-DATA): numeric defaults are 0/null, never fabricated
 * "look-real" values.
 */
function buildMobilePayload(
  stock: Record<string, any>,
  tickerUpper: string,
  source: string
): { success: true; source: string; data: Record<string, unknown> } {
  const curr = num(stock.current_price);
  const prev = num(stock.previous_close);
  const changePct =
    num(stock.change_percent) ||
    (prev > 0 ? ((curr - prev) / prev) * 100 : 0);

  return {
    success: true,
    source,
    data: {
      // Identity
      ticker: stock.ticker || stock.symbol || tickerUpper,
      name_ar: stock.name_ar || stock.name || tickerUpper,
      name: stock.name || stock.name_ar || tickerUpper,
      market: stock.market || 'EGX',
      sector: stock.sector || null,
      industry: stock.industry || null,
      currency: stock.currency || 'EGP',
      exchange: stock.exchange || 'EGX',

      // Price action (RESTORED — was previously dropped on mobile)
      current_price: curr,
      previous_close: prev,
      open_price: num(stock.open_price),
      open: num(stock.open_price),            // legacy alias
      high_price: num(stock.high_price),
      high: num(stock.high_price),            // legacy alias
      low_price: num(stock.low_price),
      low: num(stock.low_price),              // legacy alias
      change_percent: changePct,
      change_value: curr - prev,
      price_change: changePct,                 // legacy alias
      volume: num(stock.volume),
      avg_volume: num(stock.avg_volume),
      value_traded: num(stock.value_traded) || curr * num(stock.volume),
      market_cap: num(stock.market_cap),

      // 52-week / beta (RESTORED — was previously dropped on mobile)
      high_52w: num(stock.high_52w) || null,
      low_52w: num(stock.low_52w) || null,
      beta: num(stock.beta) || null,

      // Fundamentals (RESTORED — only pe/pb/dividend_yield/eps/roe were
      // returned before; now includes the full desktop set)
      pe_ratio: num(stock.pe_ratio) || null,
      pb_ratio: num(stock.pb_ratio) || null,
      ps_ratio: num(stock.ps_ratio) || null,
      eps: num(stock.eps) || null,
      roe: num(stock.roe) || null,
      roa: num(stock.roa) || null,
      debt_to_equity: num(stock.debt_to_equity) || null,
      current_ratio: num(stock.current_ratio) || null,
      book_value_per_share: num(stock.book_value_per_share) || null,
      profit_margin: num(stock.profit_margin) || null,
      dividend_yield: num(stock.dividend_yield) || null,
      dps_ttm: num(stock.dps_ttm) || null,

      // Paywall-gated insight fields (Rule 50):
      // fair_value is the killer feature per PAYWALL-STRATEGY-FINAL.md
      // §5.2 row 1 — server-side gated by applyFairValueGate() below.
      // upside_percent is the marketing teaser ("🔒 +29% فرصة") and
      // is NEVER locked (kept visible to drive subscription intent).
      fair_value: num(stock.fair_value) || null,
      upside_percent: num(stock.upside_percent) || null,

      // Technicals (RESTORED — was previously dropped on mobile)
      ma_50: num(stock.ma_50) || null,
      ma_200: num(stock.ma_200) || null,
      rsi: num(stock.rsi) || null,
      support: num(stock.support) || null,
      resistance: num(stock.resistance) || null,
      signal: stock.signal || 'HOLD',
      trend: stock.trend || 'NEUTRAL',

      // Index membership flags (RESTORED — was previously dropped)
      is_active: stock.is_active ?? true,
      is_egx30: Number(stock.is_egx30) || 0,
      is_egx70: Number(stock.is_egx70) || 0,
      is_egx100: Number(stock.is_egx100) || 0,
      egx30_member: Number(stock.is_egx30) === 1,
      egx70_member: Number(stock.is_egx70) === 1,
      egx100_member: Number(stock.is_egx100) === 1,

      last_update: stock.last_update || stock.last_updated || new Date().toISOString(),
    },
  };
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Apply the fair_value paywall gate (mirrors desktop /api/stocks/[ticker]).
 *
 * When `locked` is true, fair_value is stripped and `fair_value_locked: true`
 * is set so the Flutter client can render the paywall CTA. `upside_percent`
 * is kept as the marketing teaser.
 */
function applyFairValueGate<T extends { data?: Record<string, unknown> }>(
  payload: T,
  locked: boolean
): T {
  if (!locked) return payload;
  if (payload.data && typeof payload.data === 'object') {
    return {
      ...payload,
      data: {
        ...payload.data,
        fair_value: null,
        fair_value_locked: true,
      },
    };
  }
  return payload;
}
