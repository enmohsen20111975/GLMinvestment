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
  } catch {
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
      } catch {
        /* ignore */
      }
    }

    // 2. Crypto prices from data_engine.db.crypto_prices (RESTRUCT-CLEANUP-1: was crypto.db).
    const dataEnginePath = path.join(cwd, 'db', 'data_engine.db');
    const dedb = openRo(dataEnginePath);
    let cryptoPredictions: Array<Record<string, unknown>> = [];
    let cryptoLastDate: string | null = null;
    if (dedb) {
      try {
        // RESTRUCT-CLEANUP-1: read latest crypto prices as "crypto state" (price + 24h change as signal).
        const rows = dedb
          .prepare(
            `SELECT symbol, name, price_usd, price_change_24h, market_cap, timestamp
             FROM crypto_prices
             WHERE timestamp = (SELECT MAX(timestamp) FROM crypto_prices)
             ORDER BY market_cap DESC NULLS LAST
             LIMIT 50`
          )
          .all() as Array<Record<string, unknown>>;
        cryptoPredictions = rows.map((r) => {
          const change = num(r.price_change_24h, 0);
          const signal = change > 1 ? 'BULLISH' : change < -1 ? 'BEARISH' : 'NEUTRAL';
          return {
            symbol: r.symbol,
            name: r.name || null,
            signal,
            entry_price: r.price_usd != null ? num(r.price_usd) : null,
            change_percent: r.price_change_24h != null ? num(r.price_change_24h) : null,
            market_cap: r.market_cap != null ? num(r.market_cap) : null,
            created_at: r.timestamp || null,
          };
        });
        if (rows.length > 0) {
          cryptoLastDate = (rows[0].timestamp as string) || null;
        }
      } catch (e) {
        console.error('[global-predictions] data_engine.db crypto_prices query:', e);
      }
      try {
        dedb.close();
      } catch {
        /* ignore */
      }
    }

    // 3. Gold signal (latest gold price row from data_engine.db.gold_prices).
    // RESTRUCT-CLEANUP-1: was gold_prices.db → now data_engine.db.gold_prices.
    const dedb2 = openRo(dataEnginePath);
    let goldSignal: Record<string, unknown> | null = null;
    if (dedb2) {
      try {
        const row = dedb2
          .prepare(
            `SELECT karat, price_per_gram, price_per_ounce, currency, country, timestamp
             FROM gold_prices
             WHERE karat = '24' OR karat = '24K' OR karat LIKE '%24%'
             ORDER BY timestamp DESC
             LIMIT 1`
          )
          .get() as Record<string, unknown> | undefined;
        if (row) {
          const pricePerGram = num(row.price_per_gram, 0);
          goldSignal = {
            date: row.timestamp,
            karat: row.karat,
            price_per_gram: pricePerGram,
            price_per_ounce: row.price_per_ounce != null ? num(row.price_per_ounce) : null,
            change: 0,
            currency: row.currency || 'EGP',
            country: row.country || null,
            signal: 'NEUTRAL',
          };
        }
      } catch (e) {
        console.error('[global-predictions] data_engine.db gold_prices query:', e);
      }
      try {
        dedb2.close();
      } catch {
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
