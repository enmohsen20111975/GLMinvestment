/**
 * Eid Predictions API - توقعات العيد
 *
 * Task BRAVO-PULSE-FIX (Owner Directive 2026-10-13):
 * - يقرأ الأسعار الحقيقية من stocks.db (stock_daily_prices + stocks table).
 * - يقرأ التوقعات الكنسية من predictions.db (predictions table).
 * - منع إرجاع أهداف فارغة أو ثقة 0%: إذا لم تكتمل شروط الأصل → "حياد / ترقب"
 *   مع مستويات الدعم والمقاومة الحرجة.
 *
 * Rule 27 (NO-FAKE-DATA): كل الأرقام من DBs حقيقية.
 * Rule 20 (PYTHON = BRAIN): لا حساب مالي في الـ API (قراءة فقط).
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import Database from 'better-sqlite3';
import path from 'path';
import { existsSync } from 'fs';

export const revalidate = 30;

const STOCKS_DB = path.join(process.cwd(), 'db', 'stocks.db');
const PREDICTIONS_DB = path.join(process.cwd(), 'db', 'predictions.db');

interface EidPrediction {
  id: string;
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD' | 'NEUTRAL';
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  confidence: number;
  reasoning: string;
  support: number | null;
  resistance: number | null;
  created_at: string;
}

// ── اقرأ آخر سعر إغلاق من stocks.db.stock_daily_prices ──
function getLastClose(ticker: string): number | null {
  if (!existsSync(STOCKS_DB)) return null;
  let db: Database.Database | null = null;
  try {
    db = new Database(STOCKS_DB, { readonly: true, timeout: 5000 });
    const row = db
      .prepare(`SELECT COALESCE(close, close_price) as close
                FROM stock_daily_prices
                WHERE ticker = ? AND COALESCE(close, close_price) IS NOT NULL
                      AND COALESCE(close, close_price) > 0
                ORDER BY price_date DESC LIMIT 1`)
      .get(ticker.toUpperCase()) as { close: number } | undefined;
    return row && typeof row.close === 'number' && row.close > 0 ? row.close : null;
  } catch {
    return null;
  } finally {
    if (db) try { db.close(); } catch { /* ignore */ }
  }
}

// ── اقرأ الدعم والمقاومة من stocks.db.stocks ──
function getSupportResistance(ticker: string): { support: number | null; resistance: number | null } {
  if (!existsSync(STOCKS_DB)) return { support: null, resistance: null };
  let db: Database.Database | null = null;
  try {
    db = new Database(STOCKS_DB, { readonly: true, timeout: 5000 });
    const row = db
      .prepare('SELECT support, resistance FROM stocks WHERE ticker = ?')
      .get(ticker.toUpperCase()) as { support: number | null; resistance: number | null } | undefined;
    return {
      support: row?.support && row.support > 0 ? row.support : null,
      resistance: row?.resistance && row.resistance > 0 ? row.resistance : null,
    };
  } catch {
    return { support: null, resistance: null };
  } finally {
    if (db) try { db.close(); } catch { /* ignore */ }
  }
}

// ── اقرأ أحدث توقع من predictions.db ──
function getCanonicalPrediction(ticker: string): {
  signal: string | null;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  confidence: number | null;
  prediction_date: string | null;
} | null {
  if (!existsSync(PREDICTIONS_DB)) return null;
  let db: Database.Database | null = null;
  try {
    db = new Database(PREDICTIONS_DB, { readonly: true, timeout: 5000 });
    const row = db
      .prepare(`SELECT signal, entry_price, target_price, stop_loss, confidence, prediction_date
                FROM predictions
                WHERE ticker = ? AND entry_price IS NOT NULL AND entry_price > 0
                ORDER BY prediction_date DESC, id DESC LIMIT 1`)
      .get(ticker.toUpperCase()) as any | undefined;
    if (!row) return null;
    return {
      signal: row.signal || null,
      entry_price: row.entry_price || null,
      target_price: row.target_price || null,
      stop_loss: row.stop_loss || null,
      confidence: row.confidence != null ? Number(row.confidence) : null,
      prediction_date: row.prediction_date || null,
    };
  } catch {
    return null;
  } finally {
    if (db) try { db.close(); } catch { /* ignore */ }
  }
}

function buildPrediction(
  symbol: string,
  currentPrice: number | null,
  canonical: ReturnType<typeof getCanonicalPrediction>,
  sr: { support: number | null; resistance: number | null },
): EidPrediction {
  const hasCanonical = canonical && canonical.entry_price && canonical.entry_price > 0;
  const target = hasCanonical ? canonical!.target_price : null;
  const stop = hasCanonical ? canonical!.stop_loss : null;
  const confidence = hasCanonical && canonical!.confidence != null
    ? Math.round(canonical!.confidence * 100) / 100
    : 0; // Rule 27: 0 = لا توجد ثقة كنسية

  // Task BRAVO-PULSE-FIX: منع إرجاع أهداف فارغة أو ثقة 0%
  // إذا لم تكتمل شروط الأصل → "حياد / ترقب" مع الدعم/المقاومة
  let signal: 'BUY' | 'SELL' | 'HOLD' | 'NEUTRAL';
  let reasoning: string;

  if (hasCanonical && target && target > 0 && stop && stop > 0 && confidence > 0) {
    // توقع كنسي مكتمل
    const sig = (canonical!.signal || '').toUpperCase();
    if (sig.includes('BUY') || sig.includes('STRONG_BUY')) {
      signal = 'BUY';
      reasoning = `توقع كنسي: دخول عند ${canonical!.entry_price?.toFixed(2)} — هدف ${target.toFixed(2)} — وقف ${stop.toFixed(2)}.`;
    } else if (sig.includes('SELL') || sig.includes('STRONG_SELL')) {
      signal = 'SELL';
      reasoning = `توقع كنسي: تصريف عند ${canonical!.entry_price?.toFixed(2)}.`;
    } else {
      signal = 'HOLD';
      reasoning = `توقع كنسي: مراقبة عند ${canonical!.entry_price?.toFixed(2)}.`;
    }
  } else {
    // لا توقع كنسي مكتمل → حياد / ترقب مع الدعم/المقاومة
    signal = 'NEUTRAL';
    const supportStr = sr.support ? sr.support.toFixed(2) : 'غير محدد';
    const resistanceStr = sr.resistance ? sr.resistance.toFixed(2) : 'غير محدد';
    reasoning = `حياد / ترقب — لا توجد إشارة شراء/بيع مكتملة. الدعم الحرج: ${supportStr} | المقاومة الحرجة: ${resistanceStr}. انتظار تأكيد الاختراق أو الارتداد.`;
  }

  return {
    id: `pred_${symbol}_${Date.now()}`,
    symbol,
    signal,
    entryPrice: currentPrice ?? hasCanonical ? canonical!.entry_price : null,
    targetPrice: target,
    stopLoss: stop,
    confidence,
    reasoning,
    support: sr.support,
    resistance: sr.resistance,
    created_at: new Date().toISOString(),
  };
}

export async function GET(_request: NextRequest) {
  try {
    // قائمة الأصول المطلوبة (تقرأ من stocks.db)
    const tickers = ['COMI', 'ABUK', 'ETEL', 'SWDY', 'EGREF'];

    const predictions: EidPrediction[] = [];

    for (const ticker of tickers) {
      const currentPrice = getLastClose(ticker);
      const sr = getSupportResistance(ticker);
      const canonical = getCanonicalPrediction(ticker);

      // لو لا يوجد سعر حالي ولا توقع → تخطّى (Rule 27)
      if (currentPrice === null && !canonical) continue;

      predictions.push(buildPrediction(ticker, currentPrice, canonical, sr));
    }

    // إذا لم نحصل على أي بيانات → خطأ صادق
    if (predictions.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'لا توجد بيانات أسعار كافية في stocks.db',
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
        stocks_db: existsSync(STOCKS_DB) ? 'stocks.db' : 'missing',
        predictions_db: existsSync(PREDICTIONS_DB) ? 'predictions.db' : 'missing',
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

export async function POST(request: NextRequest) {
  return GET(request);
}
