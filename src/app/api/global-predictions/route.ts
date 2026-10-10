/**
 * GET /api/global-predictions
 * =============================
 * Global market predictions for the Flutter Android app.
 *
 * Reads from `db/predictions.db` (market='US' or any non-EGX) + `db/crypto.db`
 * → crypto_prediction_logs. Public (no auth — taste content, like news).
 *
 * Returns:
 *   {
 *     success, generated_at,
 *     us_predictions: [{ ticker, signal, entry_price, target_price, stop_loss, ... }],
 *     crypto_predictions: [{ symbol, signal, entry_price, target_price, ... }],
 *     gold_signal: { price_per_gram, change, signal },
 *     summary: { us_count, crypto_count, last_updated }
 *   }
 *
 * Failure mode: never 500. If a DB is unavailable, the matching section is
 * returned as an empty array.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

function openRo(p: string): Database.Database | null {
  try {
    if (!fs.existsSync(p)) return null;
    return new Database(p, { readonly: true });
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(_req: NextRequest) {
  try {
    const cwd = process.cwd();

    // 1. US / global market predictions from predictions.db.
    const predictionsDbPath = path.join(cwd, 'db', 'predictions.db');
    const pdb = openRo(predictionsDbPath);
    let usPredictions: Array<Record<string, unknown>> = [];
    let usLastDate: string | null = null;
    if (pdb) {
      try {
        const rows = pdb
          .prepare(
            `SELECT id, ticker, signal, signal_type, prediction_date,
                    entry_price, target_price, stop_loss, master_score,
                    confidence, market, created_at
             FROM predictions
             WHERE UPPER(IFNULL(market,'EGX')) IN ('US','GLOBAL')
             ORDER BY prediction_date DESC, created_at DESC
             LIMIT 50`
          )
          .all() as Array<Record<string, unknown>>;
        usPredictions = rows.map((r) => ({
          ticker: r.ticker,
          signal: r.signal,
          signal_type: r.signal_type || null,
          prediction_date: r.prediction_date,
          entry_price: r.entry_price != null ? num(r.entry_price) : null,
          target_price:
            r.target_price != null ? num(r.target_price) : null,
          stop_loss: r.stop_loss != null ? num(r.stop_loss) : null,
          master_score:
            r.master_score != null ? num(r.master_score) : null,
          confidence: r.confidence != null ? num(r.confidence) : null,
          market: r.market || 'US',
          created_at: r.created_at || null,
        }));
        if (rows.length > 0) {
          usLastDate = (rows[0].prediction_date as string) || null;
        }
      } catch (e) {
        console.error('[global-predictions] predictions.db query:', e);
      }
      try {
        pdb.close();
      } catch { // silent fallback (safe-by-design)
        /* ignore */
      }
    }

    // 2. Crypto predictions from crypto.db.
    const cryptoDbPath = path.join(cwd, 'db', 'crypto.db');
    const cdb = openRo(cryptoDbPath);
    let cryptoPredictions: Array<Record<string, unknown>> = [];
    let cryptoLastDate: string | null = null;
    if (cdb) {
      try {
        const rows = cdb
          .prepare(
            `SELECT id, coin_id, symbol, signal, score, confidence,
                    entry_price, target_price, stop_loss, rationale, created_at
             FROM crypto_prediction_logs
             ORDER BY created_at DESC
             LIMIT 50`
          )
          .all() as Array<Record<string, unknown>>;
        cryptoPredictions = rows.map((r) => ({
          symbol: r.symbol || r.coin_id,
          signal: r.signal,
          score: r.score != null ? num(r.score) : null,
          confidence: r.confidence != null ? num(r.confidence) : null,
          entry_price: r.entry_price != null ? num(r.entry_price) : null,
          target_price:
            r.target_price != null ? num(r.target_price) : null,
          stop_loss: r.stop_loss != null ? num(r.stop_loss) : null,
          rationale: r.rationale || null,
          created_at: r.created_at || null,
        }));
        if (rows.length > 0) {
          cryptoLastDate = (rows[0].created_at as string) || null;
        }
      } catch (e) {
        console.error('[global-predictions] crypto.db query:', e);
      }
      try {
        cdb.close();
      } catch { // silent fallback (safe-by-design)
        /* ignore */
      }
    }

    // 3. Gold signal (latest gold price row).
    const goldDbPath = path.join(cwd, 'db', 'gold_prices.db');
    const gdb = openRo(goldDbPath);
    let goldSignal: Record<string, unknown> | null = null;
    if (gdb) {
      try {
        const row = gdb
          .prepare(
            `SELECT date, karat, price_per_gram, change, currency, name_ar
             FROM gold_prices
             ORDER BY date DESC
             LIMIT 1`
          )
          .get() as Record<string, unknown> | undefined;
        if (row) {
          const change = num(row.change, 0);
          const signal =
            change > 0.5 ? 'BULLISH' : change < -0.5 ? 'BEARISH' : 'NEUTRAL';
          goldSignal = {
            date: row.date,
            karat: row.karat,
            price_per_gram: num(row.price_per_gram, 0),
            change,
            currency: row.currency || 'EGP',
            name_ar: row.name_ar || null,
            signal,
          };
        }
      } catch (e) {
        console.error('[global-predictions] gold_prices.db query:', e);
      }
      try {
        gdb.close();
      } catch { // silent fallback (safe-by-design)
        /* ignore */
      }
    }

    return NextResponse.json({
      success: true,
      source: 'multi_db',
      generated_at: new Date().toISOString(),
      us_predictions: usPredictions,
      crypto_predictions: cryptoPredictions,
      gold_signal: goldSignal,
      summary: {
        us_count: usPredictions.length,
        crypto_count: cryptoPredictions.length,
        us_last_date: usLastDate,
        crypto_last_date: cryptoLastDate,
        gold_signal_present: !!goldSignal,
      },
    });
  } catch (err) {
    console.error('[global-predictions] fatal:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_en: 'internal error',
      },
      { status: 500 }
    );
  }
}
