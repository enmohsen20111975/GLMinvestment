/**
 * Missed Opportunities Tracker — READ-ONLY
 * =========================================
 * يعمل review على التوقعات السابقة ويقارنها بالأسعار الحالية،
 * ويطلع 4 قوائم:
 *
 * 1. missed_bulls  → قلنا SELL/STRONG_SELL والسهم طلع >10% (فرص ضاعت)
 * 2. false_positives → قلنا BUY/STRONG_BUY والسهم نزل >10% (توقعات غلط)
 * 3. correct_buys   → قلنا BUY والسهم طلع >10% (توقعات صحيحة)
 * 4. correct_sells  → قلنا SELL والسهم نزل >10% (توقعات صحيحة)
 *
 * مصادر البيانات (كلها read-only):
 *   - predictions.db  → predictions table (entry_price, signal, prediction_date)
 *   - data_engine.db  → stocks table (current price)
 *
 * No new engines, no new screens — uses existing data only.
 * Any existing UI can fetch this endpoint to display a "نظرة المحلل الخبير" card.
 *
 * GET /api/predictions/honest-tracking/missed-opportunities
 *   ?threshold=10        // minimum % change to count (default 10)
 *   ?limit=20            // max items per category (default 20)
 *   ?market=EGX          // optional market filter
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

interface PredictionRow {
  id: number;
  ticker: string;
  signal: string;
  entry_price: number;
  target_price: number | null;
  stop_loss: number | null;
  prediction_date: string;
  persona: string | null;
  master_score: number | null;
}

interface StockPriceRow {
  symbol: string;
  price: number;
  name: string | null;
  sector: string | null;
  last_update: string | null;
}

interface Opportunity {
  id: number;
  ticker: string;
  name: string | null;
  sector: string | null;
  signal: string;
  entry_price: number;
  current_price: number;
  pct_change: number;
  prediction_date: string;
  last_price_update: string | null;
  price_freshness_minutes: number | null; // كم دقيقة من آخر تحديث للسعر
  price_is_stale: boolean; // true لو السعر مش طازة (أكتر من 15 دقيقة)
  persona: string | null;
  master_score: number | null;
  days_since_prediction: number;
}

function daysBetween(from: string, to: string): number {
  try {
    const d1 = new Date(from.slice(0, 10));
    const d2 = new Date(to.slice(0, 10));
    return Math.max(0, Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
  } catch {
    return 0;
  }
}

// حساب عمر آخر تحديث للسعر بالدقائق — مهم عشان الـ data engine بيتحدث كل 5 دقايق
function minutesSinceLastUpdate(lastUpdate: string | null): number | null {
  if (!lastUpdate) return null;
  try {
    const d = new Date(lastUpdate.includes('T') ? lastUpdate : lastUpdate.replace(' ', 'T'));
    if (isNaN(d.getTime())) return null;
    const diffMs = Date.now() - d.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60)));
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const threshold = Math.max(1, Math.min(100, Number(searchParams.get('threshold') || '10')));
  const limit = Math.max(1, Math.min(100, Number(searchParams.get('limit') || '20')));
  const marketFilter = (searchParams.get('market') || '').trim().toUpperCase();
  // RL-FIX-15: فلترة الجودة + الفترة + إزالة التكرار حسب السهم
  const minScore = Math.max(0, Math.min(100, Number(searchParams.get('minScore') || '0')));
  // الفترة: نقبل إما `days` (عدد أيام) أو `since` (تاريخ ISO).
  const daysWindow = Math.max(0, Math.min(365, Number(searchParams.get('days') || '0')));
  const sinceIso = (searchParams.get('since') || '').trim();
  const dedupeByTicker = searchParams.get('dedupe') !== '0'; // افتراضي: شغّال

  const predPath = path.join(process.cwd(), 'db', 'predictions.db');
  // ✅ FIX: بنستخدم stocks.db (مش data_engine.db) لأن:
  //  - stocks.db فيها جدول `stocks` بأعمدة: ticker, current_price, change_percent, last_updated, sector, rsi, ma_50, ma_200
  //  - data_engine.db فيها `egksco_stocks` (مش `stocks`) — كان بيعمل silent failure
  //  - stocks.db بتتحدث كل 5 دقايق من الـ scraper (نفس دورة data_engine)
  const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');

  let predDb: Database.Database | null = null;
  let stocksDb: Database.Database | null = null;

  try {
    predDb = openDb(predPath);
    stocksDb = openDb(stocksDbPath);
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `Failed to open DBs: ${String(err)}` },
      { status: 503 }
    );
  }

  try {
    // ── 1) Load current prices from stocks.db (current_price > 0 only) ──
    //    بنجيب last_updated كمان عشان نحسب freshness السعر
    const priceStmt = stocksDb.prepare(`
      SELECT ticker AS symbol, current_price AS price, name, name_ar, sector,
             last_updated AS last_update
      FROM stocks
      WHERE current_price IS NOT NULL AND current_price > 0
        AND is_active = 1
    `);
    const priceRows = priceStmt.all() as StockPriceRow[];
    const priceMap = new Map<string, StockPriceRow>();
    for (const r of priceRows) {
      if (r.symbol) {
        // فضّل الاسم العربي لو موجود
        const r2 = r as StockPriceRow & { name_ar?: string | null };
        if (r2.name_ar && !r.name) r.name = r2.name_ar;
        priceMap.set(r.symbol, r);
      }
    }

    // ── 2) Load predictions ──
    // RL-FIX-15: أضفنا فلترة الجودة (minScore) + الفترة (days) + ترتيب حسب score
    // علشان الـ dedupe-by-ticker يفضل أحسن توقع لكل سهم.
    let query = `
      SELECT id, ticker, signal, entry_price, target_price, stop_loss,
             prediction_date, persona, master_score
      FROM predictions
      WHERE entry_price IS NOT NULL AND entry_price > 0
        AND prediction_date IS NOT NULL
        AND signal IS NOT NULL
        AND UPPER(signal) IN ('BUY','STRONG_BUY','SELL','STRONG_SELL')
    `;
    const params: unknown[] = [];
    if (marketFilter) {
      query += ` AND (UPPER(market) = ? OR market IS NULL)`;
      params.push(marketFilter);
    }
    // RL-FIX-15: فلترة الجودة
    if (minScore > 0) {
      query += ` AND master_score IS NOT NULL AND master_score >= ?`;
      params.push(minScore);
    }
    // RL-FIX-15: فلترة الفترة (أحدث أولاً علشان الـ dedupe يفضل أحدث توقع)
    // نقبل `days` (عدد أيام من دلوقتي) أو `since` (تاريخ ISO ثابت — لـ YTD).
    if (sinceIso) {
      query += ` AND prediction_date >= ?`;
      params.push(sinceIso);
    } else if (daysWindow > 0) {
      const cutoff = new Date(Date.now() - daysWindow * 86400000).toISOString();
      query += ` AND prediction_date >= ?`;
      params.push(cutoff);
    }
    query += ` ORDER BY ticker ASC, master_score DESC, prediction_date DESC`;
    const predRows = predDb.prepare(query).all(...params) as PredictionRow[];

    // ── 3) Classify each prediction against current price ──
    const missedBulls: Opportunity[] = [];
    const falsePositives: Opportunity[] = [];
    const correctBuys: Opportunity[] = [];
    const correctSells: Opportunity[] = [];
    let unmatched = 0;

    // RL-FIX-15: dedupe-by-ticker — نخلي توقع واحد لكل سهم (أعلى score/أحدث)
    // علشان نفس السهم ما يظهرش 3 مرات (3 شخصيات) ولا في أيام متعددة.
    const seenTickers = new Set<string>();

    for (const p of predRows) {
      // RL-FIX-15: dedupe حسب الـ ticker
      if (dedupeByTicker && seenTickers.has(p.ticker)) continue;

      const stock = priceMap.get(p.ticker);
      if (!stock) { unmatched++; continue; }
      const current = stock.price;
      if (!current || current <= 0) continue;

      const pctChange = ((current - p.entry_price) / p.entry_price) * 100;
      
      // Ignore absurd numbers caused by stock splits or bad data
      if (Math.abs(pctChange) > 200) continue;

      const signal = (p.signal || '').toUpperCase();

      const opportunity: Opportunity = {
        id: p.id,
        ticker: p.ticker,
        name: stock.name,
        sector: stock.sector,
        signal,
        entry_price: p.entry_price,
        current_price: current,
        pct_change: Math.round(pctChange * 100) / 100,
        prediction_date: p.prediction_date,
        last_price_update: stock.last_update,
        price_freshness_minutes: minutesSinceLastUpdate(stock.last_update),
        price_is_stale: (() => {
          const m = minutesSinceLastUpdate(stock.last_update);
          return m === null || m > 15; // أكتر من 15 دقيقة = مش طازة
        })(),
        persona: p.persona,
        master_score: p.master_score,
        days_since_prediction: daysBetween(p.prediction_date, stock.last_update || new Date().toISOString()),
      };

      const isBuy = signal === 'BUY' || signal === 'STRONG_BUY';
      const isSell = signal === 'SELL' || signal === 'STRONG_SELL';

      // RL-FIX-15: لو الـ dedupe شغّال، سجّل الـ ticker بعد ما نعرف إن فيه price match
      if (dedupeByTicker) seenTickers.add(p.ticker);

      if (isBuy && pctChange > threshold) correctBuys.push(opportunity);
      else if (isBuy && pctChange < -threshold) falsePositives.push(opportunity);
      else if (isSell && pctChange > threshold) missedBulls.push(opportunity);
      else if (isSell && pctChange < -threshold) correctSells.push(opportunity);
    }

    // Sort: missed bulls (highest gain first), false positives (biggest loss first),
    // correct (biggest gain/loss first)
    missedBulls.sort((a, b) => b.pct_change - a.pct_change);
    falsePositives.sort((a, b) => a.pct_change - b.pct_change);
    correctBuys.sort((a, b) => b.pct_change - a.pct_change);
    correctSells.sort((a, b) => a.pct_change - b.pct_change);

    // ── 4) Summary stats ──
    const total = missedBulls.length + falsePositives.length + correctBuys.length + correctSells.length;
    const accuracyRate = total > 0
      ? Math.round(((correctBuys.length + correctSells.length) / total) * 1000) / 10
      : 0;

    // Average missed gain (potential profit we left on the table)
    const avgMissedGain = missedBulls.length > 0
      ? Math.round((missedBulls.reduce((s, x) => s + x.pct_change, 0) / missedBulls.length) * 10) / 10
      : 0;

    const avgFalseLoss = falsePositives.length > 0
      ? Math.round((falsePositives.reduce((s, x) => s + x.pct_change, 0) / falsePositives.length) * 10) / 10
      : 0;

    return NextResponse.json({
      success: true,
      generated_at: new Date().toISOString(),
      params: { threshold_pct: threshold, limit, market: marketFilter || 'all' },
      data_source: {
        prices_db: 'stocks.db',
        predictions_db: 'predictions.db',
        price_refresh_interval: '5 min (data_engine scraper)',
        note: 'الأسعار بتيجي من stocks.db اللي بيتحدث كل 5 دقايق من الـ scraper',
      },
      summary: {
        total_predictions_evaluated: predRows.length,
        predictions_matched_with_current_price: predRows.length - unmatched,
        predictions_without_price_data: unmatched,
        missed_bulls: missedBulls.length,
        false_positives: falsePositives.length,
        correct_buys: correctBuys.length,
        correct_sells: correctSells.length,
        accuracy_rate_pct: accuracyRate,
        avg_missed_gain_pct: avgMissedGain,
        avg_false_loss_pct: avgFalseLoss,
        // إحصائيات الـ freshness — كم سعر طازة vs مش طازة
        prices_fresh: missedBulls.concat(falsePositives, correctBuys, correctSells)
          .filter(o => !o.price_is_stale).length,
        prices_stale: missedBulls.concat(falsePositives, correctBuys, correctSells)
          .filter(o => o.price_is_stale).length,
      },
      missed_bulls: missedBulls.slice(0, limit),
      false_positives: falsePositives.slice(0, limit),
      correct_buys: correctBuys.slice(0, limit),
      correct_sells: correctSells.slice(0, limit),
      note: '🔴 missed_bulls = فرص ضاعت (قلنا بيع والسهم طلع). false_positives = توقعات شراء غلط. ✅ correct = توقعات صحيحة. ⏱️ price_is_stale=true لو السعر مش طازة (أكتر من 15 دقيقة من آخر تحديث).',
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
