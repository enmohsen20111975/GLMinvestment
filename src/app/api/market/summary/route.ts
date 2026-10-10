/**
 * GET /api/market/summary
 * =======================
 * Flutter compat endpoint — ملخص السوق للموبايل.
 *
 * Query:
 *   ?market=EGX  (default: EGX) — مصر | السعودية | الكويت | قطر
 *
 * يحسب من data_engine.db.stocks (المصدر الأساسي):
 *   - advancing   = COUNT(change_percent > 0)
 *   - declining   = COUNT(change_percent < 0)
 *   - unchanged   = COUNT(change_percent = 0 OR NULL)
 *   - total_turnover = SUM(price * volume)
 *   - total_volume   = SUM(volume)
 *   - market_cap     = SUM(market_cap)
 *
 * المصدر: data_engine.db (مصر / السعودية / الكويت / قطر بالأسماء العربية).
 * لا يستخدم Python backend إطلاقاً.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDataEngineDb } from '@/lib/data-engine-db';
import { marketCodeToArabic, arabicToMarketCode } from '@/lib/data-engine-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface StockSummaryRow {
  advancing: number;
  declining: number;
  unchanged: number;
  total_turnover: number | null;
  total_volume: number | null;
  market_cap: number | null;
  total_stocks: number;
}

function safeNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const marketParam = (url.searchParams.get('market') || 'EGX').toUpperCase();
    const marketArabic = marketCodeToArabic(marketParam);

    let db: ReturnType<typeof getDataEngineDb>;
    try {
      db = getDataEngineDb();
    } catch (dbErr) {
      return NextResponse.json({
        success: false,
        error: 'data_engine.db unavailable',
        market: marketParam,
        advancing: 0,
        declining: 0,
        unchanged: 0,
        total_turnover: 0,
        total_volume: 0,
        market_cap: 0,
        total_stocks: 0,
        generated_at: new Date().toISOString(),
      }, { status: 503 });
    }

    // تحقق إن جدول stocks موجود
    let tableExists = false;
    try {
      const row = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='stocks' LIMIT 1"
      ).get() as { name?: string } | undefined;
      tableExists = !!row?.name;
    } catch { // silent fallback (safe-by-design)
      tableExists = false;
    }

    if (!tableExists) {
      return NextResponse.json({
        success: true,
        market: marketParam,
        market_arabic: marketArabic,
        source: 'data_engine.db',
        advancing: 0,
        declining: 0,
        unchanged: 0,
        total_turnover: 0,
        total_volume: 0,
        market_cap: 0,
        total_stocks: 0,
        note: 'stocks table not found in data_engine.db',
        generated_at: new Date().toISOString(),
      });
    }

    // احسب الإحصائيات بـ query واحدة — أسرع وأأمن من قراءة كل الصفوف
    let summary: StockSummaryRow;
    try {
      const row = db.prepare(`
        SELECT
          COUNT(*) AS total_stocks,
          SUM(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) AS advancing,
          SUM(CASE WHEN change_percent < 0 THEN 1 ELSE 0 END) AS declining,
          SUM(CASE WHEN change_percent = 0 OR change_percent IS NULL THEN 1 ELSE 0 END) AS unchanged,
          SUM(CASE WHEN price IS NOT NULL AND volume IS NOT NULL THEN CAST(price AS REAL) * CAST(volume AS REAL) ELSE 0 END) AS total_turnover,
          SUM(CASE WHEN volume IS NOT NULL THEN CAST(volume AS REAL) ELSE 0 END) AS total_volume,
          SUM(CASE WHEN market_cap IS NOT NULL THEN CAST(market_cap AS REAL) ELSE 0 END) AS market_cap
        FROM stocks
        WHERE market = ?
      `).get(marketArabic) as StockSummaryRow | undefined;

      summary = row ?? {
        advancing: 0,
        declining: 0,
        unchanged: 0,
        total_turnover: 0,
        total_volume: 0,
        market_cap: 0,
        total_stocks: 0,
      };
    } catch { // silent fallback (safe-by-design)
      // fallback: لو فيه مشكلة في الـ query (مثلاً volume نص)، نعملها بـ row-by-row
      try {
        const rows = db.prepare(
          'SELECT change_percent, price, volume, market_cap FROM stocks WHERE market = ?'
        ).all(marketArabic) as Array<Record<string, unknown>>;
        let advancing = 0, declining = 0, unchanged = 0;
        let totalTurnover = 0, totalVolume = 0, totalCap = 0;
        for (const r of rows) {
          const chg = Number(r.change_percent);
          if (Number.isFinite(chg) && chg > 0) advancing++;
          else if (Number.isFinite(chg) && chg < 0) declining++;
          else unchanged++;
          const price = Number(r.price);
          const vol = Number(r.volume);
          const cap = Number(r.market_cap);
          if (Number.isFinite(price) && Number.isFinite(vol)) totalTurnover += price * vol;
          if (Number.isFinite(vol)) totalVolume += vol;
          if (Number.isFinite(cap)) totalCap += cap;
        }
        summary = {
          advancing,
          declining,
          unchanged,
          total_turnover: totalTurnover,
          total_volume: totalVolume,
          market_cap: totalCap,
          total_stocks: rows.length,
        };
      } catch (fallbackErr) {
        return NextResponse.json({
          success: false,
          error: 'Failed to query stocks table: ' + String(fallbackErr),
          market: marketParam,
        }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      market: marketParam,
      market_arabic: marketArabic,
      source: 'data_engine.db',
      advancing: safeNumber(summary.advancing),
      declining: safeNumber(summary.declining),
      unchanged: safeNumber(summary.unchanged),
      total_turnover: Math.round(safeNumber(summary.total_turnover) * 100) / 100,
      total_volume: Math.round(safeNumber(summary.total_volume) * 100) / 100,
      market_cap: Math.round(safeNumber(summary.market_cap) * 100) / 100,
      total_stocks: safeNumber(summary.total_stocks),
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/market/summary] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        advancing: 0,
        declining: 0,
        unchanged: 0,
        total_turnover: 0,
        total_volume: 0,
        market_cap: 0,
        generated_at: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

// keep arabicToMarketCode referenced to satisfy bundler tree-shaking (used internally)
void arabicToMarketCode;
