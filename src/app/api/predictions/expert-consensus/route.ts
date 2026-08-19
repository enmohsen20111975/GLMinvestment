/**
 * Expert Consensus Engine — READ-ONLY
 * =====================================
 * "نظرة المحلل الخبير" — بيجمع كل المصادر المتاحة لكل سهم
 * ويطلق قرار موحد مع confidence + reasons:
 *
 * 1. آخر prediction في DB (signal + master_score + persona)
 * 2. Current market state (change%, RSI من stocks.db)
 * 3. Sector context (relative strength = stock% - sector%)
 * 4. MA alignment (ma_50 vs ma_200 — golden/death cross)
 *
 * يحسب consensus verdict:
 *   STRONG_BUY / BUY / HOLD / SELL / STRONG_SELL
 *   + confidence % (نسبة الإشارات المؤيدة)
 *   + reasons[] (لماذا)
 *   + dissent[] (إشارات معاكسة لازم تعرفها)
 *
 * مصادر البيانات (read-only):
 *   - predictions.db → predictions table (latest signal per ticker)
 *   - stocks.db      → stocks table (current price, change%, RSI, MA, sector)
 *
 * No new engines, no new screens — uses existing data only.
 *
 * GET /api/predictions/expert-consensus
 *   ?ticker=COMI      // consensus لسهم واحد
 *   ?limit=20         // لو من غير ticker، رجّع أعلى consensus (top STRONG_BUY)
 *   ?min_score=50     // فلتر master_score (default 50)
 *   ?verdict=STRONG_BUY  // فلتر verdict معين
 */

import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

function openDb(dbPath: string): Database.Database {
  try {
    return new Database(dbPath, { readonly: true, timeout: 5000, fileMustExist: true });
  } catch {
    return new Database(`file:${dbPath}?immutable=1`, { readonly: true, timeout: 5000 });
  }
}

interface LatestPrediction {
  ticker: string;
  signal: string;
  master_score: number;
  prediction_date: string;
  entry_price: number;
  target_price: number | null;
  stop_loss: number | null;
  persona: string | null;
}

interface StockInfo {
  ticker: string;
  name: string | null;
  name_ar?: string | null;
  sector: string | null;
  current_price: number | null;
  change_percent: number | null;
  rsi: number | null;
  volume: number | null;
  ma_50: number | null;
  ma_200: number | null;
  is_egx30: number | null;
  is_egx100: number | null;
  last_updated: string | null; // ✅ ema آخر تحديث للسعر (5-min cycle)
}

interface ConsensusResult {
  ticker: string;
  name: string | null;
  sector: string | null;
  // Inputs
  latest_prediction: LatestPrediction | null;
  current_state: {
    price: number | null;
    change_pct: number | null;
    rsi: number | null;
    volume: number | null;
    ma_50: number | null;
    ma_200: number | null;
    ma_alignment: 'golden_cross' | 'death_cross' | 'unknown';
    last_updated: string | null; // ema آخر تحديث
    price_freshness_minutes: number | null; // عمر السعر بالدقائق
    price_is_stale: boolean; // true لو مش طازة
  };
  sector_context: {
    sector: string | null;
    sector_avg_change_pct: number | null;
    relative_strength: number | null; // stock% - sector%
  };
  // Output
  verdict: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  confidence_pct: number;
  bullish_signals: number;
  bearish_signals: number;
  reasons: string[];
  dissent: string[];
  is_egx30: boolean;
  is_egx100: boolean;
}

// حساب عمر آخر تحديث للسعر بالدقائق
function minutesSinceLastUpdate(lastUpdate: string | null): number | null {
  if (!lastUpdate) return null;
  try {
    const d = new Date(lastUpdate.includes('T') ? lastUpdate : lastUpdate.replace(' ', 'T'));
    if (isNaN(d.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60)));
  } catch {
    return null;
  }
}

// ✅ defensive: يتأكد إن العمود موجود قبل ما يطلبه في SELECT
function getColumnNames(db: Database.Database, table: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return new Set(rows.map(r => r.name));
  } catch {
    return new Set();
  }
}

function computeConsensus(
  pred: LatestPrediction | null,
  stock: StockInfo | null,
  sectorAvg: number | null
): ConsensusResult {
  let bullish = 0;
  let bearish = 0;
  const reasons: string[] = [];
  const dissent: string[] = [];

  const ticker = stock?.ticker || pred?.ticker || '';
  const name = stock?.name || null;
  const sector = stock?.sector || null;

  // ── 1) Latest prediction signal ──
  if (pred) {
    const signal = (pred.signal || '').toUpperCase();
    const score = pred.master_score ?? 0;
    if (signal === 'STRONG_BUY') {
      bullish += 2;
      reasons.push(`تحليل سابق: STRONG_BUY (score ${score})`);
    } else if (signal === 'BUY') {
      bullish += 1;
      reasons.push(`تحليل سابق: BUY (score ${score})`);
    } else if (signal === 'SELL') {
      bearish += 1;
      reasons.push(`تحليل سابق: SELL (score ${score})`);
    } else if (signal === 'STRONG_SELL') {
      bearish += 2;
      reasons.push(`تحليل سابق: STRONG_SELL (score ${score})`);
    }
    if (score >= 65) {
      bullish += 1;
      reasons.push(`master_score قوي (${score})`);
    } else if (score < 40) {
      bearish += 1;
      reasons.push(`master_score ضعيف (${score})`);
    }
  }

  // ── 2) Current price action ──
  if (stock) {
    const change = stock.change_percent ?? 0;
    if (change > 1) {
      bullish += 1;
      reasons.push(`السهم طالع اليوم (+${change.toFixed(2)}%)`);
    } else if (change < -1) {
      bearish += 1;
      reasons.push(`السهم نازل اليوم (${change.toFixed(2)}%)`);
    }

    // ── 3) RSI ──
    const rsi = stock.rsi ?? 0;
    if (rsi > 0) {
      if (rsi < 30) {
        bullish += 1;
        reasons.push(`RSI oversold (${rsi.toFixed(1)}) — فرصة ارتداد`);
      } else if (rsi > 70) {
        bearish += 1;
        reasons.push(`RSI overbought (${rsi.toFixed(1)}) — حذر من تصحيح`);
      }
    }

    // ── 4) MA alignment ──
    const ma50 = stock.ma_50 ?? 0;
    const ma200 = stock.ma_200 ?? 0;
    let maAlignment: 'golden_cross' | 'death_cross' | 'unknown' = 'unknown';
    if (ma50 > 0 && ma200 > 0) {
      if (ma50 > ma200) {
        maAlignment = 'golden_cross';
        bullish += 1;
        reasons.push(`MA50 > MA200 (Golden Cross) — اتجاه صاعد`);
      } else {
        maAlignment = 'death_cross';
        bearish += 1;
        reasons.push(`MA50 < MA200 (Death Cross) — اتجاه هابط`);
      }
    }

    // ── 5) Sector relative strength ──
    if (sectorAvg != null) {
      const rs = change - sectorAvg;
      if (rs > 1) {
        bullish += 1;
        reasons.push(`أقوى من قطاعه بـ +${rs.toFixed(2)}% (Relative Strength)`);
      } else if (rs < -1) {
        bearish += 1;
        reasons.push(`أضعف من قطاعه بـ ${rs.toFixed(2)}% (Relative Weakness)`);
      }
    }
  }

  // ── Verdict ──
  let verdict: ConsensusResult['verdict'];
  if (bullish > bearish + 2) verdict = 'STRONG_BUY';
  else if (bullish > bearish) verdict = 'BUY';
  else if (bearish > bullish + 2) verdict = 'STRONG_SELL';
  else if (bearish > bullish) verdict = 'SELL';
  else verdict = 'HOLD';

  const total = bullish + bearish;
  const confidence = total > 0
    ? Math.round((Math.max(bullish, bearish) / total) * 100)
    : 0;

  // ── Dissent (signals against the verdict) ──
  if (verdict.includes('BUY')) {
    if (stock && (stock.change_percent ?? 0) < -1)
      dissent.push(`السهم نازل اليوم رغم توصية الشراء`);
    if (stock && stock.rsi != null && stock.rsi > 70)
      dissent.push(`RSI overbought — ممكن تصحيح قريب`);
    if (pred && pred.master_score < 50)
      dissent.push(`master_score ضعيف (${pred.master_score})`);
  } else if (verdict.includes('SELL')) {
    if (stock && (stock.change_percent ?? 0) > 1)
      dissent.push(`السهم طالع اليوم رغم توصية البيع`);
    if (stock && stock.rsi != null && stock.rsi < 30)
      dissent.push(`RSI oversold — ممكن ارتداد قريب`);
  }

  return {
    ticker,
    name: name || (stock?.name_ar as string | null),
    sector,
    latest_prediction: pred,
    current_state: {
      price: stock?.current_price ?? null,
      change_pct: stock?.change_percent ?? null,
      rsi: stock?.rsi ?? null,
      volume: stock?.volume ?? null,
      ma_50: stock?.ma_50 ?? null,
      ma_200: stock?.ma_200 ?? null,
      ma_alignment: stock ? (stock.ma_50 && stock.ma_200
        ? (stock.ma_50 > stock.ma_200 ? 'golden_cross' : 'death_cross')
        : 'unknown') : 'unknown',
      last_updated: stock?.last_updated ?? null,
      price_freshness_minutes: minutesSinceLastUpdate(stock?.last_updated ?? null),
      price_is_stale: (() => {
        const m = minutesSinceLastUpdate(stock?.last_updated ?? null);
        return m === null || m > 15;
      })(),
    },
    sector_context: {
      sector,
      sector_avg_change_pct: sectorAvg != null ? Math.round(sectorAvg * 100) / 100 : null,
      relative_strength: (stock && sectorAvg != null && stock.change_percent != null)
        ? Math.round((stock.change_percent - sectorAvg) * 100) / 100
        : null,
    },
    verdict,
    confidence_pct: confidence,
    bullish_signals: bullish,
    bearish_signals: bearish,
    reasons,
    dissent,
    is_egx30: (stock?.is_egx30 ?? 0) === 1,
    is_egx100: (stock?.is_egx100 ?? 0) === 1,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') || '').trim().toUpperCase();
  const limit = Math.max(1, Math.min(100, Number(searchParams.get('limit') || '20')));
  const minScore = Math.max(0, Math.min(100, Number(searchParams.get('min_score') || '0')));
  const verdictFilter = (searchParams.get('verdict') || '').trim().toUpperCase();

  const predPath = path.join(process.cwd(), 'db', 'predictions.db');
  const stocksPath = path.join(process.cwd(), 'db', 'stocks.db');

  let predDb: Database.Database | null = null;
  let stocksDb: Database.Database | null = null;
  try {
    predDb = openDb(predPath);
    stocksDb = openDb(stocksPath);
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `Failed to open DBs: ${String(err)}` },
      { status: 503 }
    );
  }

  try {
    // ✅ defensive: نتأكد من الأعمدة الموجودة في stocks قبل ما نطلبها
    const stockCols = getColumnNames(stocksDb, 'stocks');
    const optionalCols = ['name_ar', 'change_percent', 'rsi', 'volume', 'ma_50', 'ma_200', 'is_egx30', 'is_egx100', 'last_updated'];
    const selectCols = ['ticker', 'name', 'sector', 'current_price']
      .concat(optionalCols.filter(c => stockCols.has(c)))
      .join(', ');

    // ── Mode A: single ticker ──
    if (ticker) {
      // Latest prediction for this ticker
      const pred = predDb.prepare(`
        SELECT ticker, signal, master_score, prediction_date, entry_price,
               target_price, stop_loss, persona
        FROM predictions
        WHERE ticker = ?
        ORDER BY prediction_date DESC
        LIMIT 1
      `).get(ticker) as LatestPrediction | undefined;

      // Stock info (defensive)
      const stock = stocksDb.prepare(`
        SELECT ${selectCols}
        FROM stocks
        WHERE ticker = ? AND is_active = 1
      `).get(ticker) as StockInfo | undefined;

      if (!pred && !stock) {
        return NextResponse.json({
          success: false,
          error: `No data found for ticker ${ticker}`,
        }, { status: 404 });
      }

      // Sector avg
      let sectorAvg: number | null = null;
      if (stock?.sector) {
        const sec = stocksDb.prepare(`
          SELECT AVG(change_percent) as avg
          FROM stocks
          WHERE sector = ? AND is_active = 1 AND change_percent IS NOT NULL
        `).get(stock.sector) as { avg: number | null } | undefined;
        sectorAvg = sec?.avg ?? null;
      }

      const result = computeConsensus(pred || null, stock || null, sectorAvg);

      return NextResponse.json({
        success: true,
        generated_at: new Date().toISOString(),
        mode: 'single_ticker',
        consensus: result,
      });
    }

    // ── Mode B: list of top consensus (no ticker) ──
    // Get latest prediction per ticker (only those with master_score)
    const preds = predDb.prepare(`
      SELECT p.ticker, p.signal, p.master_score, p.prediction_date, p.entry_price,
             p.target_price, p.stop_loss, p.persona
      FROM predictions p
      INNER JOIN (
        SELECT ticker, MAX(prediction_date) as max_date
        FROM predictions
        WHERE master_score IS NOT NULL AND master_score >= ?
        GROUP BY ticker
      ) latest ON p.ticker = latest.ticker AND p.prediction_date = latest.max_date
      WHERE p.master_score IS NOT NULL AND p.master_score >= ?
      ORDER BY p.master_score DESC
      LIMIT 500
    `).all(minScore, minScore) as LatestPrediction[];

    // Pre-compute sector averages (one query)
    const sectorAvgs = new Map<string, number>();
    const secRows = stocksDb.prepare(`
      SELECT sector, AVG(change_percent) as avg
      FROM stocks
      WHERE is_active = 1 AND change_percent IS NOT NULL AND sector IS NOT NULL AND sector != ''
      GROUP BY sector
    `).all() as { sector: string; avg: number }[];
    for (const r of secRows) sectorAvgs.set(r.sector, r.avg);

    // Pre-load all stocks into a map for fast lookup (defensive — نتجاهل الأعمدة الناقصة)
    const stockMap = new Map<string, StockInfo>();
    const allStocks = stocksDb.prepare(`
      SELECT ${selectCols}
      FROM stocks
      WHERE is_active = 1
    `).all() as StockInfo[];
    for (const s of allStocks) stockMap.set(s.ticker, s);

    const results: ConsensusResult[] = [];
    for (const p of preds) {
      const stock = stockMap.get(p.ticker);
      const secAvg = stock?.sector ? (sectorAvgs.get(stock.sector) ?? null) : null;
      const r = computeConsensus(p, stock || null, secAvg);
      if (verdictFilter && r.verdict !== verdictFilter) continue;
      results.push(r);
    }

    // Sort: STRONG_BUY first (by confidence desc), then BUY, HOLD, SELL, STRONG_SELL
    const verdictOrder: Record<string, number> = {
      STRONG_BUY: 0, BUY: 1, HOLD: 2, SELL: 3, STRONG_SELL: 4,
    };
    results.sort((a, b) => {
      const va = verdictOrder[a.verdict] ?? 9;
      const vb = verdictOrder[b.verdict] ?? 9;
      if (va !== vb) return va - vb;
      return b.confidence_pct - a.confidence_pct;
    });

    return NextResponse.json({
      success: true,
      generated_at: new Date().toISOString(),
      mode: 'list',
      params: { limit, min_score: minScore, verdict: verdictFilter || 'all' },
      summary: {
        total_predictions_scanned: preds.length,
        total_with_stock_data: results.filter(r => r.current_state.price != null).length,
        by_verdict: {
          STRONG_BUY: results.filter(r => r.verdict === 'STRONG_BUY').length,
          BUY: results.filter(r => r.verdict === 'BUY').length,
          HOLD: results.filter(r => r.verdict === 'HOLD').length,
          SELL: results.filter(r => r.verdict === 'SELL').length,
          STRONG_SELL: results.filter(r => r.verdict === 'STRONG_SELL').length,
        },
      },
      consensus_list: results.slice(0, limit),
      note: '🎯 verdict بيجمع: آخر prediction + أداء السهم الحالي + RSI + MA alignment + relative strength vs القطاع.',
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  } finally {
    try { predDb?.close(); } catch { /* ignore */ }
    try { stocksDb?.close(); } catch { /* ignore */ }
  }
}
