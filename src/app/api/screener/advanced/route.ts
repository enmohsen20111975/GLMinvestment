/**
 * GET /api/screener/advanced
 * =========================
 * P0-FIX (API-FALLBACKS-WAVE-2): fallback to SQLite when Python backend is down.
 * Reads from stocks.db.stocks directly — no mock data (Rule 27).
 *
 * Supports the same query params the Python screener accepts (best-effort):
 *   - sector: exact match on stocks.sector (case-insensitive)
 *   - min_volume: minimum stocks.volume
 *   - min_turnover: minimum computed turnover (current_price * volume)
 *   - min_market_cap: minimum market_cap
 *   - signal: numeric threshold on stocks.signal (>=value)
 *   - sort: 'change_percent' (default) | 'volume' | 'market_cap'
 *   - limit: max 50 (default 50)
 *   - market: EGX (default) | TADAWUL | KSE | QSE | US | CRYPTO
 *
 * Returns:
 *   { success, source: 'sqlite_fallback', stocks: [...], count, filters_applied: {...} }
 *
 * PAYWALL Phase 2 — Gate 6 (P0-4):
 *   Per PAYWALL-STRATEGY-FINAL.md §5.2 row 7 + §1 "أول 5 نتائج فلتر"
 *   (revised from 10 → 5 after competitor analysis) — free users whose
 *   trial has expired get ONLY the first 5 screener results. The full
 *   list is returned with `{ locked: true, total: N }` so the UI can
 *   render a '🔒 +N فرص إضافية — اشترك' lock card. Anonymous + paid +
 *   trial-active users get all results.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { checkTrialNotExpired } from '@/lib/subscription-gate';
// (ALPHA-DAL-WAVE3 — owner directive 2026-10-27):
// «إزالة new Database(path) اليدوي. استبداله بـ: import { DbManager } from '@/lib/db-manager';
//     const db = DbManager.openDb('stocks.db');»
import { DbManager } from '@/lib/db-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

const FREE_TIER_SCREENER_LIMIT = 5;

const MARKET_MAP: Record<string, string> = {
  EGX: 'EGX',
  TADAWUL: 'TADAWUL',
  KSA: 'TADAWUL',
  KSE: 'KSE',
  QSE: 'QSE',
  US: 'US',
  CRYPTO: 'CRYPTO',
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // ── PAYWALL Phase 2 — Gate 6: resolve paywall state ────────────────
  //   Anonymous (no session) → not locked (taste hook per §4 — 5 free
  //   results are the marketing teaser).
  //   Authenticated + paid OR within 14-day trial → not locked.
  //   Authenticated + free + trial expired → locked (only first 5
  //   results returned; total + locked: true signal added).
  const { userId } = await getSessionUserId();
  let screenerLocked = false;
  if (userId) {
    const trial = await checkTrialNotExpired(userId);
    if (!trial.ok) screenerLocked = true;
  }

  // 1) Try Python first (5s timeout)
  try {
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/screener/advanced${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(applyScreenerGate(data, screenerLocked));
    }
  } catch {}

  // 2) Fallback — read from stocks.db (via DbManager DAL gatekeeper)
  try {
    // (ALPHA-DAL-WAVE3): استخدم DbManager.openDb — ممنوع new Database().
    const db = DbManager.openDb('stocks.db');
    if (!db) {
      return NextResponse.json(
        { success: false, error: 'stocks.db not found' },
        { status: 200 }
      );
    }

    // اكتشف الأعمدة المتاحة (الـ schema يختلف بين الإنتاج والـ init)
    const tableInfo = db.prepare('PRAGMA table_info(stocks)').all() as Array<{ name: string }>;
    const colNames = new Set(tableInfo.map(c => c.name));
    const has = (col: string) => colNames.has(col);

    // اكتشف عمود العضوية المتاح
    const egx30Col = has('is_egx30') ? 'is_egx30' : has('egx30_member') ? 'egx30_member' : null;

    const marketRaw = (url.searchParams.get('market') || 'EGX').toUpperCase();
    const market = MARKET_MAP[marketRaw] || 'EGX';

    const sector = url.searchParams.get('sector')?.trim();
    const minVolume = url.searchParams.get('min_volume');
    const minTurnover = url.searchParams.get('min_turnover');
    const minMarketCap = url.searchParams.get('min_market_cap');
    const minSignal = url.searchParams.get('signal');
    const sortRaw = (url.searchParams.get('sort') || 'change_percent').toLowerCase();
    const sort = ['change_percent', 'volume', 'market_cap'].includes(sortRaw)
      ? sortRaw
      : 'change_percent';
    const limitRaw = Number(url.searchParams.get('limit') || 50);
    const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 50));

    const filtersApplied: Record<string, unknown> = { market, sort, limit };
    const where: string[] = ['market = ?'];
    const params: unknown[] = [market];

    if (sector) {
      where.push('sector = ? COLLATE NOCASE');
      params.push(sector);
      filtersApplied.sector = sector;
    }
    if (minVolume && !Number.isNaN(Number(minVolume))) {
      where.push('volume >= ?');
      params.push(Number(minVolume));
      filtersApplied.min_volume = Number(minVolume);
    }
    if (minMarketCap && !Number.isNaN(Number(minMarketCap))) {
      where.push('market_cap >= ?');
      params.push(Number(minMarketCap));
      filtersApplied.min_market_cap = Number(minMarketCap);
    }
    if (minSignal && !Number.isNaN(Number(minSignal))) {
      where.push('signal >= ?');
      params.push(Number(minSignal));
      filtersApplied.min_signal = Number(minSignal);
    }
    if (minTurnover && !Number.isNaN(Number(minTurnover))) {
      // turnover_egp often NULL — compute via current_price * volume
      where.push('(COALESCE(turnover_egp, current_price * volume) >= ?)');
      params.push(Number(minTurnover));
      filtersApplied.min_turnover = Number(minTurnover);
    }

    // Build ORDER BY: NULLs last for sort column
    // ملاحظة: الـ schema الجديد ممكن ما يكون فيه change_percent — نحسبه في SELECT
    const orderBy = sort === 'volume'
      ? 'volume DESC NULLS LAST'
      : sort === 'market_cap'
        ? 'market_cap DESC NULLS LAST'
        : 'chg_pct DESC NULLS LAST';

    // ابني SELECT حسب الأعمدة المتاحة فقط
    const selectParts: string[] = ['ticker', 'name_ar', 'name', 'sector', 'current_price', 'previous_close', 'volume'];
    // chg_pct: احسب change_percent (لو column موجود استخدمه، غير كده احسبه)
    selectParts.push(`CASE
      WHEN ${has('change_percent') ? 'change_percent IS NOT NULL' : '0'} THEN ${has('change_percent') ? 'change_percent' : '0'}
      WHEN previous_close > 0 THEN ((current_price - previous_close) / previous_close) * 100
      ELSE 0
    END AS chg_pct`);
    if (has('change_percent')) selectParts.push('change_percent AS change_percent_raw');
    if (has('turnover_egp')) selectParts.push('turnover_egp');
    else selectParts.push('(current_price * volume) AS turnover_egp');
    // (ALPHA-SCANNER-LIVE, Task 4): value_traded — الكاش المنفّذ فعليًا من
    // TradingView Scanner (يملأه برافو في stocks.db). لو العمود موجود نستخدمه،
    // وإلا نعتمد على turnover_egp المحسوب.
    if (has('value_traded')) selectParts.push('value_traded');
    else selectParts.push('(current_price * volume) AS value_traded');
    // (ALPHA-SCANNER-LIVE, Task 5): relative_volume_10d — الحجم النسبي الرسمي.
    // optional: لو العمود مش موجود (pre-merge) نرجع NULL والـ UI بـ يخفي الشارة.
    if (has('relative_volume_10d')) selectParts.push('relative_volume_10d');
    else selectParts.push('NULL AS relative_volume_10d');
    if (has('market_cap')) selectParts.push('market_cap');
    else selectParts.push('0 AS market_cap');
    if (has('signal')) selectParts.push('signal');
    else selectParts.push('0 AS signal');
    if (has('rsi')) selectParts.push('rsi');
    else selectParts.push('NULL AS rsi');
    if (has('ma_50')) selectParts.push('ma_50');
    else selectParts.push('NULL AS ma_50');
    if (has('ma_200')) selectParts.push('ma_200');
    else selectParts.push('NULL AS ma_200');
    if (has('support')) selectParts.push('support');
    else if (has('support_level')) selectParts.push('support_level AS support');
    else selectParts.push('NULL AS support');
    if (has('resistance')) selectParts.push('resistance');
    else if (has('resistance_level')) selectParts.push('resistance_level AS resistance');
    else selectParts.push('NULL AS resistance');
    if (has('trend')) selectParts.push('trend');
    else selectParts.push('NULL AS trend');
    // البيانات المالية (fundamentals) — مهمة جداً لشاشة الفلاتر
    if (has('pe_ratio')) selectParts.push('pe_ratio');
    else selectParts.push('NULL AS pe_ratio');
    if (has('pb_ratio')) selectParts.push('pb_ratio');
    else selectParts.push('NULL AS pb_ratio');
    if (has('eps')) selectParts.push('eps');
    else selectParts.push('NULL AS eps');
    if (has('roe')) selectParts.push('roe');
    else selectParts.push('NULL AS roe');
    if (has('roa')) selectParts.push('roa');
    else selectParts.push('NULL AS roa');
    if (has('dividend_yield')) selectParts.push('dividend_yield');
    else selectParts.push('NULL AS dividend_yield');
    if (has('debt_to_equity')) selectParts.push('debt_to_equity');
    else selectParts.push('NULL AS debt_to_equity');
    if (has('beta')) selectParts.push('beta');
    else selectParts.push('NULL AS beta');
    if (has('high_52w')) selectParts.push('high_52w');
    else selectParts.push('NULL AS high_52w');
    if (has('low_52w')) selectParts.push('low_52w');
    else selectParts.push('NULL AS low_52w');
    if (has('open_price')) selectParts.push('open_price');
    else selectParts.push('NULL AS open_price');
    if (has('high_price')) selectParts.push('high_price');
    else selectParts.push('NULL AS high_price');
    if (has('low_price')) selectParts.push('low_price');
    else selectParts.push('NULL AS low_price');

    const sql = `
      SELECT ${selectParts.join(', ')}
      FROM stocks
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT ?
    `;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    const stocks = rows.map((r) => ({
      ticker: r.ticker,
      name_ar: r.name_ar || r.name || r.ticker,
      sector: r.sector || '',
      current_price: Number(r.current_price || 0),
      change_percent: Number(r.chg_pct ?? r.change_percent_raw ?? 0),
      volume: Number(r.volume || 0),
      turnover_egp: Number(r.turnover_egp || 0),
      value_traded: Number(r.value_traded || 0),
      relative_volume_10d: r.relative_volume_10d === null || r.relative_volume_10d === undefined ? null : Number(r.relative_volume_10d),
      market_cap: Number(r.market_cap || 0),
      signal: Number(r.signal || 0),
      rsi: r.rsi === null ? null : Number(r.rsi),
      ma_50: r.ma_50 === null ? null : Number(r.ma_50),
      ma_200: r.ma_200 === null ? null : Number(r.ma_200),
      support: r.support === null ? null : Number(r.support),
      resistance: r.resistance === null ? null : Number(r.resistance),
      trend: r.trend || null,
      // fundamentals
      pe_ratio: r.pe_ratio === null || r.pe_ratio === undefined ? null : Number(r.pe_ratio),
      pb_ratio: r.pb_ratio === null || r.pb_ratio === undefined ? null : Number(r.pb_ratio),
      eps: r.eps === null || r.eps === undefined ? null : Number(r.eps),
      roe: r.roe === null || r.roe === undefined ? null : Number(r.roe),
      roa: r.roa === null || r.roa === undefined ? null : Number(r.roa),
      dividend_yield: r.dividend_yield === null || r.dividend_yield === undefined ? null : Number(r.dividend_yield),
      debt_to_equity: r.debt_to_equity === null || r.debt_to_equity === undefined ? null : Number(r.debt_to_equity),
      beta: r.beta === null || r.beta === undefined ? null : Number(r.beta),
      high_52w: r.high_52w === null || r.high_52w === undefined ? null : Number(r.high_52w),
      low_52w: r.low_52w === null || r.low_52w === undefined ? null : Number(r.low_52w),
      open_price: r.open_price === null || r.open_price === undefined ? null : Number(r.open_price),
      high_price: r.high_price === null || r.high_price === undefined ? null : Number(r.high_price),
      low_price: r.low_price === null || r.low_price === undefined ? null : Number(r.low_price),
    }));

    db.close();

    return NextResponse.json(applyScreenerGate({
      success: true,
      source: 'sqlite_fallback',
      stocks,
      count: stocks.length,
      filters_applied: filtersApplied,
      generated_at: new Date().toISOString(),
    }, screenerLocked));
  } catch (e) {
    console.error('[screener:advanced]', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}

/**
 * Apply the screener paywall gate.
 *
 * When `locked` is true, the caller is an authenticated free user whose
 * 14-day trial has expired. Per PAYWALL-STRATEGY-FINAL.md §5.2 row 7 +
 * §1 (revised from 10 → 5 after competitor analysis), they see ONLY the
 * first 5 results. We preserve the original total so the UI can render
 * the '🔒 +N فرص إضافية — اشترك' lock card with the correct count.
 *
 * Works for both the Python proxy response (which uses `stocks` as the
 * results array) and the SQLite fallback response (same shape).
 */
function applyScreenerGate<T extends Record<string, unknown>>(
  payload: T,
  locked: boolean,
): T {
  if (!locked) return payload;
  const stocksArr = Array.isArray(payload.stocks) ? payload.stocks as unknown[] : [];
  const total = stocksArr.length;
  const visible = stocksArr.slice(0, FREE_TIER_SCREENER_LIMIT);
  return {
    ...payload,
    stocks: visible,
    count: visible.length,
    total,
    locked: true,
    locked_count: Math.max(0, total - visible.length),
    free_preview_count: FREE_TIER_SCREENER_LIMIT,
    upgradeUrl: '/pricing',
  };
}
