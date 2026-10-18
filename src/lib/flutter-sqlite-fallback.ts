/**
 * Flutter SQLite Fallback Helpers
 * ================================
 * Readers used by Next.js API routes that proxy to the Python backend.
 *
 * When the Python backend (port 8010) is unreachable or returns non-2xx,
 * these helpers read directly from the local SQLite databases in readonly
 * mode — guaranteeing that the Flutter app (in production) always receives
 * a 200 response with real data instead of a 503 error.
 *
 * Pattern (per task FLUTTER-FULL-AUDIT):
 *   1. Route tries Python backend first (5-10s timeout).
 *   2. On failure, route calls one of these helpers.
 *   3. Helper returns real data from SQLite (NO mock data — Rule 27).
 *   4. Response JSON includes `source: 'sqlite_fallback'` so callers can
 *      distinguish Python vs SQLite provenance.
 *
 * DBs:
 *   - db/stocks.db         → 956 stocks (live prices, fundamentals, indices)
 *   - db/predictions.db    → 651 AI/expert predictions
 *   - db/data_engine.db    → 1585 stocks + crypto_prices + gold_prices + forex
 *   - db/news.db           → market_news (FIX-WAVE-2-DATA: renamed from news_articles per Rule 44)
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync } from 'fs';

const STOCKS_DB_PATH = join(process.cwd(), 'db', 'stocks.db');
const PREDICTIONS_DB_PATH = join(process.cwd(), 'db', 'predictions.db');
const DATA_ENGINE_DB_PATH = join(process.cwd(), 'db', 'data_engine.db');
const NEWS_DB_PATH = join(process.cwd(), 'db', 'news.db');

function openReadonly(dbPath: string): Database.Database | null {
  if (!existsSync(dbPath)) return null;
  try {
    return new Database(dbPath, { readonly: true, timeout: 3000 });
  } catch {
    return null;
  }
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Stocks (stocks.db)
// ---------------------------------------------------------------------------

export function getStockByTickerFallback(
  ticker: string,
  market?: string
): Record<string, unknown> | null {
  const db = openReadonly(STOCKS_DB_PATH);
  if (!db) return null;
  try {
    // MARKET-FILTER-COMPLETE (Task MARKET-FILTER-COMPLETE):
    // قبل كده: `WHERE ticker = ? COLLATE NOCASE` بس → كان بـ يرجع أي سهم بالـ ticker
    // ده بغض النظر عن السوق. لو فيه ticker متكرر بين EGX و US (15 حالة بسبب migration
    // قديم) بـ يرجع الأول في الترتيب. الحل: لو market متحدد نضيف filter.
    // EGX → IN ('EGX','مصر'). غير كده → market بس. لو مش متحدد بنـ skip (backward compat).
    const marketVariants: string[] = [];
    if (market) {
      if (market.toUpperCase() === 'EGX') {
        marketVariants.push('EGX', 'مصر');
      } else {
        marketVariants.push(market);
      }
    }
    const placeholders = marketVariants.map(() => '?').join(',');
    const marketClause = marketVariants.length > 0
      ? `AND market IN (${placeholders})`
      : '';
    const row = db
      .prepare(
        `SELECT ticker, name, name_ar, market, sector, industry,
                current_price, close AS close_price, previous_close, open_price, high_price, low_price,
                change_percent, volume, market_cap, pe_ratio, pb_ratio, ps_ratio,
                eps, roe, roa, debt_to_equity, current_ratio, book_value_per_share,
                ma_50, ma_200, rsi, support, resistance, signal, trend,
                dividend_yield, profit_margin, avg_volume, beta, high_52w, low_52w,
                is_active, is_egx30, is_egx70, is_egx100,
                last_update, currency, exchange, dps_ttm, turnover_egp, value_traded
         FROM stocks
         WHERE ticker = ? COLLATE NOCASE ${marketClause}
         LIMIT 1`
      )
      .get(ticker.toUpperCase(), ...marketVariants) as Record<string, unknown> | undefined;

    if (!row) return null;

    const prev = safeNum(row.previous_close);
    const curr = safeNum(row.current_price);
    const changePct = safeNum(row.change_percent);
    const rawHigh = safeNum(row.high_price);
    const rawLow = safeNum(row.low_price);
    const rawOpen = safeNum(row.open_price);

    const validHigh = (rawHigh >= curr && rawHigh > 0) ? rawHigh : Math.max(curr, prev);
    const validLow = (rawLow <= curr && rawLow > 0 && rawLow >= curr * 0.35) ? rawLow : Math.min(curr, prev);
    const validOpen = (rawOpen >= validLow * 0.9 && rawOpen <= validHigh * 1.1 && rawOpen > 0) ? rawOpen : prev;

    // FIX: derivedChange كان مش معرّف — سبب exception في catch فبيرجع null
    const derivedChange = (prev > 0) ? ((curr - prev) / prev) * 100 : changePct;

    return {
      success: true,
      source: 'sqlite_fallback',
      ticker: row.ticker,
      name: row.name,
      name_ar: row.name_ar || row.name,
      market: row.market,
      sector: row.sector || '',
      industry: row.industry || '',
      current_price: curr,
      previous_close: prev,
      open_price: validOpen,
      high_price: validHigh,
      low_price: validLow,
      change_percent: derivedChange,
      price_change: derivedChange,
      change_value: curr - prev,
      volume: safeNum(row.volume),
      market_cap: safeNum(row.market_cap),
      pe_ratio: safeNum(row.pe_ratio),
      pb_ratio: safeNum(row.pb_ratio),
      ps_ratio: safeNum(row.ps_ratio),
      eps: safeNum(row.eps),
      roe: safeNum(row.roe),
      roa: safeNum(row.roa),
      debt_to_equity: safeNum(row.debt_to_equity),
      current_ratio: safeNum(row.current_ratio),
      book_value_per_share: safeNum(row.book_value_per_share),
      ma_50: safeNum(row.ma_50),
      ma_200: safeNum(row.ma_200),
      rsi: safeNum(row.rsi) || 50,
      support: safeNum(row.support),
      resistance: safeNum(row.resistance),
      signal: row.signal || 'HOLD',
      trend: row.trend || 'NEUTRAL',
      dividend_yield: safeNum(row.dividend_yield),
      profit_margin: safeNum(row.profit_margin),
      avg_volume: safeNum(row.avg_volume),
      beta: safeNum(row.beta) || 1,
      high_52w: safeNum(row.high_52w),
      low_52w: safeNum(row.low_52w),
      is_active: Number(row.is_active) || 0,
      is_egx30: Number(row.is_egx30) || 0,
      is_egx70: Number(row.is_egx70) || 0,
      is_egx100: Number(row.is_egx100) || 0,
      egx30_member: Number(row.is_egx30) === 1,
      egx70_member: Number(row.is_egx70) === 1,
      egx100_member: Number(row.is_egx100) === 1,
      last_update: row.last_update,
      currency: row.currency || 'EGP',
      exchange: row.exchange || 'EGX',
      dps_ttm: safeNum(row.dps_ttm),
      value_traded: safeNum(row.value_traded) || curr * safeNum(row.volume),
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function getTopMoversFallback(
  limit = 10,
  market?: string
): {
  gainers: Record<string, unknown>[];
  losers: Record<string, unknown>[];
  most_active: Record<string, unknown>[];
} {
  const db = openReadonly(STOCKS_DB_PATH);
  if (!db) return { gainers: [], losers: [], most_active: [] };
  try {
    // FIX-P3-P5-P6 (Group P5 — Fix 4): accept a `market` parameter so the
    // caller (e.g. /api/market/top-movers?market=TADAWUL) only sees movers
    // from THAT market. Default: omit the filter (returns all markets) —
    // the route layer is responsible for defaulting to 'EGX' when no
    // market is specified.
    const whereClause = market
      ? `WHERE is_active = 1 AND change_percent IS NOT NULL AND UPPER(market) = UPPER(?)`
      : `WHERE is_active = 1 AND change_percent IS NOT NULL`;
    const stmtArgs = market ? [market] : [];
    const rows = db
      .prepare(
        `SELECT ticker, name, name_ar, current_price, close AS close_price, previous_close,
                change_percent, volume, market_cap, sector, market
         FROM stocks
         ${whereClause}
         ORDER BY volume DESC
         LIMIT 500`
      )
      .all(...stmtArgs) as Record<string, unknown>[];

    const withDerived = rows.map((r) => {
      const prev = safeNum(r.previous_close);
      const curr = safeNum(r.current_price);
      const changePct = safeNum(r.change_percent);
      return {
        ...r,
        current_price: curr,
        price_change:
          changePct !== 0 ? changePct : prev > 0 ? ((curr - prev) / prev) * 100 : 0,
      };
    });

    const gainers = withDerived
      .filter((s) => Number(s.price_change) > 0)
      .sort((a, b) => Number(b.price_change) - Number(a.price_change))
      .slice(0, limit)
      .map((s) => ({ ...s, change_type: 'gainer' as const }));

    const losers = withDerived
      .filter((s) => Number(s.price_change) < 0)
      .sort((a, b) => Number(a.price_change) - Number(b.price_change))
      .slice(0, limit)
      .map((s) => ({ ...s, change_type: 'loser' as const }));

    const most_active = withDerived
      .filter((s) => Number(s.volume) > 0)
      .sort((a, b) => Number(b.volume) - Number(a.volume))
      .slice(0, limit);

    return { gainers, losers, most_active };
  } catch {
    return { gainers: [], losers: [], most_active: [] };
  } finally {
    db.close();
  }
}

export function getMovementClassificationFallback(
  limit = 50
): Record<string, unknown>[] {
  const db = openReadonly(STOCKS_DB_PATH);
  if (!db) return [];
  try {
    return db
      .prepare(
        `SELECT ticker, name_ar, current_price, close AS close_price, change_percent, volume, sector, market
         FROM stocks
         WHERE is_active = 1 AND change_percent IS NOT NULL
         ORDER BY ABS(change_percent) DESC
         LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// News (news.db)
// ---------------------------------------------------------------------------

export function getStockNewsFallback(
  ticker: string,
  limit = 20
): Record<string, unknown>[] {
  const db = openReadonly(NEWS_DB_PATH);
  if (!db) return [];
  try {
    const upper = ticker.toUpperCase();
    // FIX-WAVE-2-DATA (AUDIT-DEEP-5 #4): table renamed news_articles → market_news per Rule 44.
    // Enhanced (2026-10-04): includes sentiment normalization, is_catalyst, and DeepSeek summary_ar.
    return db
      .prepare(
        `SELECT id, title, content, summary_ar AS summary, summary_ar, source, url AS source_url,
                image_paths AS image_url, market, market AS market_code,
                tickers AS symbol, tickers, impact_type AS category, impact_type,
                CASE 
                  WHEN sentiment = 'bullish' THEN 'positive'
                  WHEN sentiment = 'bearish' THEN 'negative'
                  ELSE COALESCE(sentiment, 'neutral')
                END AS sentiment,
                COALESCE(is_catalyst, 0) AS is_catalyst,
                COALESCE(importance, 50) AS importance,
                NULL AS language,
                published_at, fetched_at
         FROM market_news
         WHERE tickers LIKE ?
            OR title LIKE ?
         ORDER BY published_at DESC
         LIMIT ?`
      )
      .all(`%"${upper}%`, `%${upper}%`, limit) as Record<string, unknown>[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export function getLatestNewsFallback(
  limit = 20
): Record<string, unknown>[] {
  const db = openReadonly(NEWS_DB_PATH);
  if (!db) return [];
  try {
    // FIX-WAVE-2-DATA (AUDIT-DEEP-5 #4): table renamed news_articles → market_news per Rule 44.
    return db
      .prepare(
        `SELECT id, title, content, summary_ar AS summary, summary_ar, source, url AS source_url,
                image_paths AS image_url, market, market AS market_code,
                tickers AS symbol, tickers, impact_type AS category, impact_type,
                CASE 
                  WHEN sentiment = 'bullish' THEN 'positive'
                  WHEN sentiment = 'bearish' THEN 'negative'
                  ELSE COALESCE(sentiment, 'neutral')
                END AS sentiment,
                COALESCE(is_catalyst, 0) AS is_catalyst,
                COALESCE(importance, 50) AS importance,
                NULL AS language,
                published_at, fetched_at
         FROM market_news
         ORDER BY published_at DESC
         LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Predictions (predictions.db)
// ---------------------------------------------------------------------------

export function getStockRecommendationFallback(
  ticker: string
): Record<string, unknown> | null {
  const db = openReadonly(PREDICTIONS_DB_PATH);
  if (!db) return null;
  try {
    const row = db
      .prepare(
        `SELECT ticker, signal, signal_type, signal_ar, prediction_date,
                entry_price, target_price, stop_loss, master_score,
                technical_score, fundamental_score, ai_pattern_score,
                sentiment_score, risk_reward, persona, status, market,
                horizon, direction, confidence, score, pnl_percent,
                closed_at, actual_exit_price
         FROM predictions
         WHERE ticker = ? COLLATE NOCASE
         ORDER BY prediction_date DESC, created_at DESC
         LIMIT 1`
      )
      .get(ticker.toUpperCase()) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { success: true, source: 'sqlite_fallback', recommendation: row, ...row };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function getPredictionsFallback(
  limit = 50,
  status?: string
): Record<string, unknown>[] {
  const db = openReadonly(PREDICTIONS_DB_PATH);
  if (!db) return [];
  try {
    if (status) {
      return db
        .prepare(
          `SELECT ticker, signal, signal_ar, signal_type, prediction_date,
                  entry_price, target_price, stop_loss, master_score,
                  technical_score, fundamental_score, ai_pattern_score,
                  sentiment_score, risk_reward, persona, status, market,
                  horizon, direction, confidence, score, pnl_percent,
                  closed_at, actual_exit_price
           FROM predictions
           WHERE status = ?
           ORDER BY prediction_date DESC
           LIMIT ?`
        )
        .all(status, limit) as Record<string, unknown>[];
    }
    return db
      .prepare(
        `SELECT ticker, signal, signal_ar, signal_type, prediction_date,
                entry_price, target_price, stop_loss, master_score,
                technical_score, fundamental_score, ai_pattern_score,
                sentiment_score, risk_reward, persona, status, market,
                horizon, direction, confidence, score, pnl_percent,
                closed_at, actual_exit_price
         FROM predictions
         ORDER BY prediction_date DESC
         LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export function getPerformanceFallback(): Record<string, unknown> {
  const db = openReadonly(PREDICTIONS_DB_PATH);
  if (!db) return { success: true, source: 'sqlite_fallback', total: 0, hit_rate: 0 };
  try {
    const totals = db
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as hits,
           SUM(CASE WHEN hit_target = 1 THEN 1 ELSE 0 END) as target_hits,
           SUM(CASE WHEN hit_stop = 1 THEN 1 ELSE 0 END) as stop_hits,
           AVG(CASE WHEN pnl_percent IS NOT NULL THEN CAST(pnl_percent AS REAL) END) as avg_pnl,
           SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count
         FROM predictions`
      )
      .get() as Record<string, unknown> | undefined;

    const total = Number(totals?.total) || 0;
    const hits = Number(totals?.hits) || 0;
    const closedCount = Number(totals?.closed_count) || 0;
    const avgPnl = Number(totals?.avg_pnl) || 0;

    return {
      success: true,
      source: 'sqlite_fallback',
      total_predictions: total,
      total: total,
      closed: closedCount,
      active: Number(totals?.active_count) || 0,
      hits,
      hit_rate: closedCount > 0 ? Math.round((hits / closedCount) * 10000) / 100 : 0,
      target_hits: Number(totals?.target_hits) || 0,
      stop_hits: Number(totals?.stop_hits) || 0,
      avg_pnl_percent: Math.round(avgPnl * 100) / 100,
      win_rate: closedCount > 0 ? Math.round((hits / closedCount) * 10000) / 100 : 0,
    };
  } catch {
    return { success: true, source: 'sqlite_fallback', total: 0, hit_rate: 0 };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Crypto (data_engine.db.crypto_prices)
// ---------------------------------------------------------------------------

export function getCryptoListFallback(
  limit = 50
): Record<string, unknown>[] {
  const db = openReadonly(DATA_ENGINE_DB_PATH);
  if (!db) return [];
  try {
    const latest = db
      .prepare(
        `SELECT timestamp FROM crypto_prices
         WHERE timestamp IS NOT NULL
         ORDER BY timestamp DESC LIMIT 1`
      )
      .get() as { timestamp: string } | undefined;
    if (!latest) return [];
    return db
      .prepare(
        `SELECT symbol, name, rank, price_usd, price_change_24h, price_change_7d,
                market_cap, market_cap_rank, total_volume, circulating_supply
         FROM crypto_prices
         WHERE timestamp = ?
         ORDER BY market_cap_rank ASC
         LIMIT ?`
      )
      .all(latest.timestamp, limit) as Record<string, unknown>[];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export function getCryptoBySymbolFallback(
  symbol: string
): Record<string, unknown> | null {
  const db = openReadonly(DATA_ENGINE_DB_PATH);
  if (!db) return null;
  try {
    const latest = db
      .prepare(
        `SELECT timestamp FROM crypto_prices
         WHERE timestamp IS NOT NULL
         ORDER BY timestamp DESC LIMIT 1`
      )
      .get() as { timestamp: string } | undefined;
    if (!latest) return null;
    const row = db
      .prepare(
        `SELECT symbol, name, rank, price_usd, price_change_24h, price_change_7d,
                market_cap, market_cap_rank, total_volume, circulating_supply, timestamp
         FROM crypto_prices
         WHERE timestamp = ? AND symbol = ? COLLATE NOCASE
         LIMIT 1`
      )
      .get(latest.timestamp, symbol.toUpperCase()) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      success: true,
      source: 'sqlite_fallback',
      ...row,
      price: safeNum(row.price_usd),
      price_usd: safeNum(row.price_usd),
      change_24h: row.price_change_24h != null ? safeNum(row.price_change_24h) : null,
      change_7d: row.price_change_7d != null ? safeNum(row.price_change_7d) : null,
      market_cap: row.market_cap != null ? safeNum(row.market_cap) : null,
      volume_24h: row.total_volume != null ? safeNum(row.total_volume) : null,
      circulating_supply:
        row.circulating_supply != null ? safeNum(row.circulating_supply) : null,
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Market status (static based on EGX hours)
// ---------------------------------------------------------------------------

export function getMarketStatusFallback(): Record<string, unknown> {
  // EGX trading hours: Sunday–Thursday, 10:00–14:00 Cairo time (UTC+2 / +3 in DST).
  const now = new Date();
  // Approximate Cairo time (no DST handling — close enough for status flag).
  const cairoOffsetMs = 2 * 60 * 60 * 1000;
  const cairo = new Date(now.getTime() + cairoOffsetMs);
  const cairoHour = cairo.getUTCHours();
  const cairoDay = cairo.getUTCDay(); // 0=Sun ... 6=Sat
  const isWorkday = cairoDay >= 0 && cairoDay <= 4; // Sun-Thu
  const isMarketHours = isWorkday && cairoHour >= 10 && cairoHour < 14;
  const dayName = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ][cairoDay];

  return {
    success: true,
    source: 'sqlite_fallback',
    market: 'EGX',
    is_open: isMarketHours,
    status: isMarketHours ? 'open' : 'closed',
    day: dayName,
    server_time: now.toISOString(),
    cairo_hour: cairoHour,
    next_session: isMarketHours
      ? 'closes at 14:00 Cairo'
      : isWorkday && cairoHour < 10
        ? `opens in ${10 - cairoHour}h`
        : 'next trading day 10:00 Cairo',
    note: 'Python backend unreachable — using static EGX market-hours calculation',
  };
}

// ---------------------------------------------------------------------------
// Stock profile (fundamentals snapshot from stocks.db)
// ---------------------------------------------------------------------------

export function getStockProfileFallback(
  ticker: string
): Record<string, unknown> | null {
  const db = openReadonly(STOCKS_DB_PATH);
  if (!db) return null;
  try {
    const row = db
      .prepare(
        `SELECT ticker, name, name_ar, sector, industry, market, currency,
                current_price, previous_close, market_cap, pe_ratio, pb_ratio,
                ps_ratio, eps, roe, roa, dividend_yield, dps_ttm, book_value_per_share,
                debt_to_equity, current_ratio, profit_margin, beta, high_52w, low_52w,
                avg_volume, is_egx30, is_egx70, is_egx100, free_float_percentage,
                free_float_shares, last_update, logo_url
         FROM stocks
         WHERE ticker = ? COLLATE NOCASE
         LIMIT 1`
      )
      .get(ticker.toUpperCase()) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      success: true,
      source: 'sqlite_fallback',
      ticker: row.ticker,
      name: row.name,
      name_ar: row.name_ar,
      sector: row.sector,
      industry: row.industry,
      market: row.market,
      currency: row.currency || 'EGP',
      fundamentals: {
        market_cap: safeNum(row.market_cap),
        pe_ratio: safeNum(row.pe_ratio),
        pb_ratio: safeNum(row.pb_ratio),
        ps_ratio: safeNum(row.ps_ratio),
        eps: safeNum(row.eps),
        roe: safeNum(row.roe),
        roa: safeNum(row.roa),
        dividend_yield: safeNum(row.dividend_yield),
        dps_ttm: safeNum(row.dps_ttm),
        book_value_per_share: safeNum(row.book_value_per_share),
        debt_to_equity: safeNum(row.debt_to_equity),
        current_ratio: safeNum(row.current_ratio),
        profit_margin: safeNum(row.profit_margin),
        beta: safeNum(row.beta) || 1,
      },
      price_range: {
        high_52w: safeNum(row.high_52w),
        low_52w: safeNum(row.low_52w),
        current: safeNum(row.current_price),
        previous_close: safeNum(row.previous_close),
      },
      index_membership: {
        egx30: Number(row.is_egx30) === 1,
        egx70: Number(row.is_egx70) === 1,
        egx100: Number(row.is_egx100) === 1,
      },
      free_float_percentage: safeNum(row.free_float_percentage),
      free_float_shares: safeNum(row.free_float_shares),
      avg_volume: safeNum(row.avg_volume),
      last_update: row.last_update,
      logo_url: row.logo_url || '',
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}
