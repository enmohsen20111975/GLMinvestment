/**
 * Eid Predictions API - توقعات العيد
 *
 * Production version: reads REAL current prices from data_engine.db
 * (crypto_prices, gold_prices, stocks tables). No hardcoded fallbacks.
 *
 * If any required price cannot be obtained, that prediction is omitted
 * (or the entire response returns an honest error).
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import Database from 'better-sqlite3';
import path from 'path';
import { existsSync } from 'fs';
import { getUnifiedStockData } from '@/lib/unified-stock-data';

// Task FINALIZE-UNIFICATION (Rule 20 + Rule 27 + Rule 73):
// Previously this route FABRICATED target/stop/confidence using hardcoded
// multipliers (target = price * 1.05, stop = price * 0.95) and hardcoded
// confidence values (0.65/0.6/0.55/0.5). Per Rule 27 (NO-FAKE-DATA), these
// fields are now NULL unless a canonical source exists:
//   - For EGX stocks (e.g. COMI): delegate to getUnifiedStockData(ticker)
//     which returns canonical target_price/stop_loss/confidence from the
//     V40.2 prediction record (Rule 73 — SINGLE-DISPLAY-SOURCE).
//   - For BTC/ETH/GOLD: no canonical prediction source exists (V40.2 only
//     covers EGX/TADAWUL/KSE/QSE equities). target/stop/confidence = NULL.
//   - The `signal` field is preserved as an external-sentiment heuristic
//     derived from the Fear & Greed Index (alternative.me API) — this is
//     NOT a per-stock canonical signal, but a market-sentiment indicator.

export const revalidate = 30; // Cache for 30s

const DATA_ENGINE_DB = path.join(process.cwd(), 'db', 'data_engine.db');

// Fear & Greed Index (real external API)
async function getFearGreedIndex(): Promise<{ value: number; classification: string } | null> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const fng = data?.data?.[0];
    if (!fng || !fng.value) return null;
    // Translate alternative.me English classification to Arabic (Rule 30 — client-friendly)
    const classificationMap: Record<string, string> = {
      'Extreme Fear': 'خوف مفرط',
      'Fear': 'خوف',
      'Neutral': 'محايد',
      'Greed': 'طمع',
      'Extreme Greed': 'طمع مفرط',
    };
    const rawClassification: string = fng.value_classification || 'Neutral';
    return {
      value: parseInt(fng.value, 10),
      classification: classificationMap[rawClassification] || rawClassification,
    };
  } catch {
    return null;
  }
}

// Crypto price from data_engine.db crypto_prices table (real, fresh)
function getCryptoPriceFromDb(symbol: string): number | null {
  if (!existsSync(DATA_ENGINE_DB)) return null;
  let db: Database.Database | null = null;
  try {
    db = new Database(DATA_ENGINE_DB, { readonly: true, timeout: 5000 });
    db.pragma('busy_timeout = 5000');
    const row = db
      .prepare('SELECT price_usd FROM crypto_prices WHERE UPPER(symbol) = UPPER(?) ORDER BY timestamp DESC LIMIT 1')
      .get(symbol) as { price_usd: number } | undefined;
    return row && typeof row.price_usd === 'number' && row.price_usd > 0 ? row.price_usd : null;
  } catch {
    return null;
  } finally {
    if (db) try { db.close(); } catch { /* ignore */ }
  }
}

// Gold price from data_engine.db gold_prices table (real)
function getGoldPriceFromDb(): number | null {
  if (!existsSync(DATA_ENGINE_DB)) return null;
  let db: Database.Database | null = null;
  try {
    db = new Database(DATA_ENGINE_DB, { readonly: true, timeout: 5000 });
    db.pragma('busy_timeout = 5000');
    // price_per_ounce is the international spot price (USD)
    const row = db
      .prepare("SELECT price_per_ounce FROM gold_prices WHERE price_per_ounce IS NOT NULL AND price_per_ounce > 0 ORDER BY timestamp DESC LIMIT 1")
      .get() as { price_per_ounce: number } | undefined;
    return row && typeof row.price_per_ounce === 'number' && row.price_per_ounce > 0
      ? row.price_per_ounce
      : null;
  } catch {
    return null;
  } finally {
    if (db) try { db.close(); } catch { /* ignore */ }
  }
}

// EGX index / COMI stock price from data_engine.db stocks table (real)
function getEgxPriceFromDb(symbol: string): number | null {
  if (!existsSync(DATA_ENGINE_DB)) return null;
  let db: Database.Database | null = null;
  try {
    db = new Database(DATA_ENGINE_DB, { readonly: true, timeout: 5000 });
    db.pragma('busy_timeout = 5000');
    const row = db
      .prepare("SELECT price FROM stocks WHERE UPPER(symbol) = UPPER(?) AND market = 'السعودية' OR UPPER(symbol) = UPPER(?) ORDER BY created_at DESC LIMIT 1")
      .get(symbol, symbol) as { price: number } | undefined;
    if (row && typeof row.price === 'number' && row.price > 0) return row.price;
    // Try price_history.db as fallback for EGX stocks (Egyptian market not in data_engine.stocks)
    return null;
  } catch {
    return null;
  } finally {
    if (db) try { db.close(); } catch { /* ignore */ }
  }
}

// EGX stock price from price_history.db (most recent close, real data)
function getEgxStockPriceFromHistory(ticker: string): number | null {
  const phPath = path.join(process.cwd(), 'db', 'stocks.db');  // WAVE-1: stocks.db (live)
  if (!existsSync(phPath)) return null;
  let db: Database.Database | null = null;
  try {
    db = new Database(phPath, { readonly: true, timeout: 5000 });
    db.pragma('busy_timeout = 5000');
    const row = db
      .prepare('SELECT close_price FROM stock_daily_prices WHERE ticker = ? ORDER BY price_date DESC LIMIT 1')
      .get(ticker) as { close_price: number } | undefined;
    return row && typeof row.close_price === 'number' && row.close_price > 0 ? row.close_price : null;
  } catch {
    return null;
  } finally {
    if (db) try { db.close(); } catch { /* ignore */ }
  }
}

interface EidPrediction {
  id: string;
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  entryPrice: number;
  // Rule 27 (NO-FAKE-DATA): targetPrice/stopLoss/confidence are NULL unless
  // a canonical source (getUnifiedStockData → V40.2 prediction record)
  // provides them. Previously fabricated as entryPrice * 1.05 / * 0.95.
  targetPrice: number | null;
  stopLoss: number | null;
  confidence: number | null;
  reasoning: string;
  created_at: string;
}

function buildPrediction(
  symbol: string,
  currentPrice: number,
  signal: 'BUY' | 'SELL' | 'HOLD',
  confidence: number | null,
  reasoning: string,
  canonical?: { targetPrice: number | null; stopLoss: number | null; confidence: number | null }
): EidPrediction {
  // Task FINALIZE-UNIFICATION: removed hardcoded multipliers (1.05/0.95).
  // Rule 27: NULL when no canonical source. Rule 73: getUnifiedStockData
  // is the single display source for EGX stocks.
  return {
    id: `pred_${symbol}_${Date.now()}`,
    symbol,
    signal,
    entryPrice: currentPrice,
    targetPrice: canonical?.targetPrice ?? null,
    stopLoss: canonical?.stopLoss ?? null,
    confidence: canonical?.confidence ?? confidence ?? null,
    created_at: new Date().toISOString(),
    reasoning,
  };
}

export async function GET(_request: NextRequest) {
  try {
    // Fetch all real market data in parallel
    const [fng, btcPrice, ethPrice, goldPrice, comiPrice] = await Promise.all([
      getFearGreedIndex(),
      Promise.resolve(getCryptoPriceFromDb('BTC')),
      Promise.resolve(getCryptoPriceFromDb('ETH')),
      Promise.resolve(getGoldPriceFromDb()),
      Promise.resolve(getEgxStockPriceFromHistory('COMI')),
    ]);

    const predictions: EidPrediction[] = [];

    // BTC prediction (real price + real Fear & Greed)
    // Rule 27: target/stop/confidence = NULL for BTC (no canonical V40.2
    // source for crypto — V40.2 covers EGX/TADAWUL/KSE/QSE equities only).
    // The `signal` field is a Fear & Greed sentiment heuristic, NOT a
    // canonical per-stock signal.
    if (btcPrice !== null) {
      if (fng !== null) {
        predictions.push(
          buildPrediction(
            'BTC',
            btcPrice,
            fng.value < 30 ? 'BUY' : fng.value > 70 ? 'SELL' : 'HOLD',
            null,
            `Fear & Greed Index: ${fng.value} (${fng.classification}) — ${fng.value < 30 ? 'خوف مفرط = فرصة شراء' : fng.value > 70 ? 'جشع مفرط = حذر' : 'محايد'}`
          )
        );
      } else {
        // No Fear & Greed → neutral HOLD on real price
        predictions.push(
          buildPrediction('BTC', btcPrice, 'HOLD', null, 'مؤشر الخوف والجشع غير متاح — مراقبة فقط')
        );
      }
    }

    // ETH prediction — Rule 27: NULL target/stop/confidence (no canonical
    // source for crypto).
    if (ethPrice !== null) {
      const ethSignal = fng !== null && fng.value < 35 ? 'BUY' : 'HOLD';
      predictions.push(
        buildPrediction(
          'ETH',
          ethPrice,
          ethSignal,
          null,
          ethSignal === 'BUY'
            ? 'ETH تتبع BTC — مؤشر الخوف والجشع منخفض = فرصة شراء'
            : 'ETH تتبع BTC عموماً — انتظار تأكيد الاتجاه'
        )
      );
    }

    // COMI (real price from price_history.db) — delegate to canonical
    // getUnifiedStockData('COMI') for target/stop/confidence (Rule 73).
    if (comiPrice !== null) {
      const canonical = getUnifiedStockData('COMI');
      predictions.push(
        buildPrediction(
          'COMI',
          comiPrice,
          'HOLD',
          null,
          'سهم بنكي — انتظار مستويات أفضل للدخول',
          {
            targetPrice: canonical?.prediction?.target_price ?? null,
            stopLoss: canonical?.prediction?.stop_loss ?? null,
            confidence: canonical?.prediction?.confidence ?? null,
          }
        )
      );
    }

    // Gold (real spot price) — Rule 27: NULL target/stop/confidence
    // (no canonical V40.2 source for commodities).
    if (goldPrice !== null) {
      predictions.push(
        buildPrediction('GOLD', goldPrice, 'HOLD', null, 'الذهب في نطاق تداول — انتظار كسر واضح')
      );
    }

    // If we got NO real prices at all, return honest error
    if (predictions.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'لا توجد بيانات أسعار كافية في قواعد البيانات (data_engine.db / price_history.db)',
        generated_at: new Date().toISOString(),
        predictions: [],
      }, { status: 503 });
    }

    return NextResponse.json({
      success: true,
      cached: false,
      generated_at: new Date().toISOString(),
      predictions,
      data_sources: {
        btc: btcPrice !== null ? 'data_engine.db:crypto_prices' : 'missing',
        eth: ethPrice !== null ? 'data_engine.db:crypto_prices' : 'missing',
        gold: goldPrice !== null ? 'data_engine.db:gold_prices' : 'missing',
        comi: comiPrice !== null ? 'price_history.db:price_history' : 'missing',
        fear_greed: fng !== null ? 'alternative.me API' : 'unavailable',
      },
    });
  } catch (error: any) {
    console.error('Eid predictions error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'تعذّر توليد التوقعات: ' + String(error?.message || error),
        generated_at: new Date().toISOString(),
        predictions: [],
      },
      { status: 500 }
    );
  }
}

// Force regenerate
export async function POST(request: NextRequest) {
  return GET(request);
}
