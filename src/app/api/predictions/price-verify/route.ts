/**
 * Price-Based Verification Cron Endpoint
 * ========================================
 * يتحقق من كل التوقعات PENDING باستخدام الأسعار الحالية.
 * مصمم ليُستدعى كل 15 دقيقة من cron job.
 *
 * المبدأ: "السعر هو الحكم" — لا EXPIRED أبداً
 * فقط TARGET_HIT أو STOPPED يغلق التوقع
 * إذا انقطعت بيانات السعر 60+ يوم → STALE (تنبيه، لا إغلاق)
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import Database from 'better-sqlite3';
import path from 'path';
import { getPriceHistory } from '@/lib/market-data-access';

export const revalidate = 30; // Cache for 30s
export const maxDuration = 120;

function openDb(): Database.Database {
  const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return db;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const db = openDb();

  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(parseInt(body.limit || '200'), 500);
    const market = body.market || null; // optional market filter

    // Build query for PENDING predictions
    let query = `
      SELECT id, ticker, market, signal, entry_price, target_price, stop_loss,
             prediction_date
      FROM predictions
      WHERE status IN ('PENDING', 'STALE')
    `;
    const params: any[] = [];

    if (market) {
      query += ` AND market = ?`;
      params.push(market);
    }

    query += ` ORDER BY prediction_date ASC LIMIT ?`;
    params.push(limit);

    const pending = db.prepare(query).all(...params) as any[];

    if (pending.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'لا توجد توقعات PENDING/STALE للتحقق منها',
        results: { checked: 0, target_hits: 0, stopped: 0, stale: 0, still_pending: 0, recovered: 0 },
        duration_ms: Date.now() - startTime,
      });
    }

    let checked = 0;
    let targetHits = 0;
    let stopped = 0;
    let stale = 0;
    let stillPending = 0;
    let recovered = 0; // STALE predictions that got new price data
    const details: any[] = [];

    // Statement for closing a prediction (TARGET_HIT or STOPPED)
    const updateClosedStmt = db.prepare(`
      UPDATE predictions
      SET status = ?, exit_price = ?, actual_return = ?,
          hit_target = ?, hit_stop = ?, holding_days = ?,
          outcome_date = ?, notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    // Statement for updating a still-PENDING prediction (price tracking)
    const updatePendingStmt = db.prepare(`
      UPDATE predictions
      SET notes = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    // Statement for marking a prediction as STALE
    const updateStaleStmt = db.prepare(`
      UPDATE predictions
      SET status = 'STALE', notes = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    // Statement for recovering a STALE prediction back to PENDING
    const recoverStaleStmt = db.prepare(`
      UPDATE predictions
      SET status = 'PENDING', notes = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    for (const pred of pending) {
      checked++;
      const isBuy = pred.signal === 'BUY';
      const wasStale = pred.status === 'STALE';

      // Get prices from prediction_date to now
      const predDate = pred.prediction_date?.split(' ')[0] || pred.prediction_date;
      const daysSince = Math.ceil((Date.now() - new Date(predDate).getTime()) / 86400000);
      const prices = getPriceHistory(pred.ticker, pred.market, Math.min(daysSince + 5, 365));

      // Filter to only prices AFTER prediction date
      const futurePrices = prices.filter(p => p.date > predDate);

      if (futurePrices.length === 0) {
        // No price data available — check if STALE (60+ days with no data)
        if (daysSince >= 60 && !wasStale) {
          stale++;
          updateStaleStmt.run(
            `STALE: لا بيانات سعر منذ ${daysSince} يوم — يحتاج مراجعة`,
            pred.id
          );
          details.push({
            id: pred.id,
            ticker: pred.ticker,
            market: pred.market,
            result: 'STALE',
            days_since: daysSince,
            note: 'لا بيانات سعر — يحتاج مراجعة يدوية',
          });
        } else {
          stillPending++;
          details.push({
            id: pred.id,
            ticker: pred.ticker,
            market: pred.market,
            result: wasStale ? 'still_stale' : 'no_data',
            days_since: daysSince,
          });
        }
        continue;
      }

      let status = 'PENDING';
      let outcomeDate: string | null = null;
      let maxProfit = 0;
      let maxLoss = 0;

      for (const p of futurePrices) {
        const high = Number(p.high_price) || 0;
        const low = Number(p.low_price) || 0;
        const entry = Number(pred.entry_price);
        const target = Number(pred.target_price);
        const stop = Number(pred.stop_loss);

        if (!high || !low || !entry) continue;

        // Track max profit/loss
        if (isBuy) {
          const profit = ((high - entry) / entry) * 100;
          const loss = ((low - entry) / entry) * 100;
          if (profit > maxProfit) maxProfit = profit;
          if (loss < maxLoss) maxLoss = loss;

          if (status === 'PENDING') {
            if (target && high >= target) {
              status = 'TARGET_HIT';
              outcomeDate = p.date;
            } else if (stop && low <= stop) {
              status = 'STOPPED';
              outcomeDate = p.date;
            }
          }
        } else {
          // SELL signal
          const profit = ((entry - low) / entry) * 100;
          const loss = ((entry - high) / entry) * 100;
          if (profit > maxProfit) maxProfit = profit;
          if (loss < maxLoss) maxLoss = loss;

          if (status === 'PENDING') {
            if (target && low <= target) {
              status = 'TARGET_HIT';
              outcomeDate = p.date;
            } else if (stop && high >= stop) {
              status = 'STOPPED';
              outcomeDate = p.date;
            }
          }
        }
      }

      // If price hit target or stop — CLOSE the prediction
      if (status === 'TARGET_HIT' || status === 'STOPPED') {
        let pnl: number | null = null;
        let finalPriceUsed: number | null = null;

        if (status === 'TARGET_HIT') {
          pnl = isBuy
            ? ((pred.target_price - pred.entry_price) / pred.entry_price) * 100
            : ((pred.entry_price - pred.target_price) / pred.entry_price) * 100;
          finalPriceUsed = pred.target_price;
          targetHits++;
        } else {
          pnl = isBuy
            ? ((pred.stop_loss - pred.entry_price) / pred.entry_price) * 100
            : ((pred.entry_price - pred.stop_loss) / pred.entry_price) * 100;
          finalPriceUsed = pred.stop_loss;
          stopped++;
        }

        const daysToTarget = outcomeDate
          ? Math.round((new Date(outcomeDate).getTime() - new Date(predDate).getTime()) / 86400000)
          : null;

        updateClosedStmt.run(
          status,
          finalPriceUsed,
          pnl !== null ? Math.round(pnl * 100) / 100 : null,
          status === 'TARGET_HIT' ? 1 : 0,
          status === 'STOPPED' ? 1 : 0,
          daysToTarget,
          outcomeDate,
          `${status} بعد ${daysToTarget} يوم — max P/L: ${Math.round(maxProfit * 100) / 100}%/${Math.round(maxLoss * 100) / 100}% — السعر هو الحكم`,
          pred.id
        );

        details.push({
          id: pred.id,
          ticker: pred.ticker,
          market: pred.market,
          signal: pred.signal,
          result: status,
          entry: pred.entry_price,
          final: finalPriceUsed,
          pnl: pnl !== null ? Math.round(pnl * 100) / 100 : null,
          days: daysToTarget,
          max_profit: Math.round(maxProfit * 100) / 100,
          max_loss: Math.round(maxLoss * 100) / 100,
          was_stale: wasStale,
        });
        continue;
      }

      // Still PENDING after checking all prices — keep PENDING (السعر هو الحكم)
      const latestPrice = futurePrices[futurePrices.length - 1].close_price;

      // Check if STALE: last price data is 60+ days old
      const lastDataDate = futurePrices[futurePrices.length - 1].date;
      const dataAgeDays = Math.ceil((Date.now() - new Date(lastDataDate).getTime()) / 86400000);

      if (dataAgeDays >= 60 && !wasStale) {
        // Mark as STALE — needs attention but NOT closed
        stale++;
        updateStaleStmt.run(
          `STALE: آخر بيانات سعر منذ ${dataAgeDays} يوم — مفتوح ${daysSince} يوم — السعر الحالي: ${latestPrice} — max P/L: ${Math.round(maxProfit * 100) / 100}%/${Math.round(maxLoss * 100) / 100}%`,
          pred.id
        );
        details.push({
          id: pred.id,
          ticker: pred.ticker,
          market: pred.market,
          result: 'STALE',
          current_price: latestPrice,
          days_elapsed: daysSince,
          data_age_days: dataAgeDays,
          max_profit: Math.round(maxProfit * 100) / 100,
          max_loss: Math.round(maxLoss * 100) / 100,
        });
      } else if (wasStale && dataAgeDays < 60) {
        // STALE prediction got new data — recover to PENDING
        recovered++;
        recoverStaleStmt.run(
          `تم التعافي من STALE — مفتوح ${daysSince} يوم — السعر الحالي: ${latestPrice} — max P/L: ${Math.round(maxProfit * 100) / 100}%/${Math.round(maxLoss * 100) / 100}%`,
          pred.id
        );
        details.push({
          id: pred.id,
          ticker: pred.ticker,
          market: pred.market,
          result: 'RECOVERED',
          current_price: latestPrice,
          days_elapsed: daysSince,
          max_profit: Math.round(maxProfit * 100) / 100,
          max_loss: Math.round(maxLoss * 100) / 100,
        });
      } else {
        // Still actively PENDING — update price tracking data
        stillPending++;
        updatePendingStmt.run(
          `PENDING: مفتوح ${daysSince} يوم — السعر الحالي: ${latestPrice} — max P/L: ${Math.round(maxProfit * 100) / 100}%/${Math.round(maxLoss * 100) / 100}%`,
          pred.id
        );
        details.push({
          id: pred.id,
          ticker: pred.ticker,
          market: pred.market,
          result: 'still_pending',
          current_price: latestPrice,
          days_elapsed: daysSince,
          max_profit: Math.round(maxProfit * 100) / 100,
          max_loss: Math.round(maxLoss * 100) / 100,
        });
      }
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      message: `تم التحقق من ${checked} توقع — السعر هو الحكم`,
      results: {
        checked,
        target_hits: targetHits,
        stopped,
        stale,
        recovered,
        still_pending: stillPending,
      },
      duration_ms: duration,
      details,
    });
  } catch (error) {
    console.error('[Price Verify] Error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  } finally {
    db.close();
  }
}

// GET: Quick status of predictions
export async function GET() {
  const db = openDb();
  try {
    const pending = db.prepare("SELECT COUNT(*) as c FROM predictions WHERE status = 'PENDING'").get() as any;
    const stale = db.prepare("SELECT COUNT(*) as c FROM predictions WHERE status = 'STALE'").get() as any;
    const targetHit = db.prepare("SELECT COUNT(*) as c FROM predictions WHERE status = 'TARGET_HIT'").get() as any;
    const stopped = db.prepare("SELECT COUNT(*) as c FROM predictions WHERE status = 'STOPPED'").get() as any;
    const total = db.prepare("SELECT COUNT(*) as c FROM predictions").get() as any;

    return NextResponse.json({
      success: true,
      status: {
        total: total?.c || 0,
        pending: pending?.c || 0,
        stale: stale?.c || 0,
        target_hit: targetHit?.c || 0,
        stopped: stopped?.c || 0,
      },
      principle: 'السعر هو الحكم — لا EXPIRED أبداً، فقط سعر يغلق التوقع',
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  } finally {
    db.close();
  }
}
