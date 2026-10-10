/**
 * GET /api/explosive/hunt
 * ======================
 * Flutter compat endpoint — فرص explosive للأسهم.
 *
 * Query:
 *   ?market=EGX  (default)
 *   ?limit=20    (default, max 100)
 *
 * الفلتر:
 *   - الحجم >= 2× متوسط 20 يوم
 *   - change_percent >= 5% (أو <= -5% — انفجار هابط)
 *
 * المصدر: data_engine.db.stocks + data_engine.db.historical_data
 *   - stocks: symbol, name, price, change_percent, volume, market_cap, market
 *   - historical_data: symbol, date, open, high, low, close, volume, market
 *
 * الخوارزمية:
 *   1. اجلب كل الأسهم في السوق المحدد
 *   2. لكل سهم، احسب avg_volume_20 (آخر 20 يوم تاريخي)
 *   3. لو volume الحالي >= 2× avg_volume_20 و |change_percent| >= 5 → فرصة explosive
 *
 * لا يستخدم Python backend.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDataEngineDb, marketCodeToArabic } from '@/lib/data-engine-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface StockRow {
  symbol: string;
  name: string | null;
  price: number | null;
  change_percent: number | null;
  volume: number | null;
  market_cap: number | null;
  market: string;
}

interface HistRow {
  date: string;
  volume: number | null;
  close: number | null;
}

interface ExplosiveOpportunity {
  ticker: string;
  name: string | null;
  market: string;
  current_price: number;
  change_percent: number;
  current_volume: number;
  avg_volume_20: number;
  volume_ratio: number;
  market_cap: number | null;
  signal: 'explosive_up' | 'explosive_down';
  reason: string;
  last_close: number | null;
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function tableExists(db: ReturnType<typeof getDataEngineDb>, tableName: string): boolean {
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
      .get(tableName) as { name?: string } | undefined;
    return !!row?.name;
  } catch {
    return false;
  }
}

function getAverageVolume20(
  db: ReturnType<typeof getDataEngineDb>,
  symbol: string,
  marketArabic: string
): { avg: number; lastClose: number | null; sampleSize: number } {
  try {
    const rows = db.prepare(`
      SELECT date, volume, close
      FROM historical_data
      WHERE symbol = ? AND market = ?
        AND volume IS NOT NULL AND CAST(volume AS REAL) > 0
      ORDER BY date DESC
      LIMIT 20
    `).all(symbol, marketArabic) as HistRow[];

    if (rows.length === 0) return { avg: 0, lastClose: null, sampleSize: 0 };

    const volumes = rows.map(r => safeNum(r.volume)).filter(v => v > 0);
    if (volumes.length === 0) return { avg: 0, lastClose: null, sampleSize: 0 };
    const sum = volumes.reduce((a, b) => a + b, 0);
    return {
      avg: sum / volumes.length,
      lastClose: rows[0].close != null ? safeNum(rows[0].close) : null,
      sampleSize: volumes.length,
    };
  } catch {
    return { avg: 0, lastClose: null, sampleSize: 0 };
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const marketParam = (url.searchParams.get('market') || 'EGX').toUpperCase();
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
    const marketArabic = marketCodeToArabic(marketParam);

    let db: ReturnType<typeof getDataEngineDb>;
    try {
      db = getDataEngineDb();
    } catch (dbErr) {
      return NextResponse.json({
        success: false,
        error: 'data_engine.db unavailable',
        market: marketParam,
        opportunities: [],
        count: 0,
      }, { status: 503 });
    }

    if (!tableExists(db, 'stocks')) {
      return NextResponse.json({
        success: true,
        market: marketParam,
        opportunities: [],
        count: 0,
        note: 'stocks table not found in data_engine.db',
        generated_at: new Date().toISOString(),
      });
    }

    const hasHistorical = tableExists(db, 'historical_data');

    // اجلب كل الأسهم في السوق
    const stocks = db.prepare(`
      SELECT symbol, name, price, change_percent, volume, market_cap, market
      FROM stocks
      WHERE market = ?
        AND symbol IS NOT NULL
      ORDER BY CAST(volume AS REAL) DESC
      LIMIT 500
    `).all(marketArabic) as StockRow[];

    const opportunities: ExplosiveOpportunity[] = [];

    for (const s of stocks) {
      const change = safeNum(s.change_percent);
      const currentVol = safeNum(s.volume);
      const price = safeNum(s.price);

      // لازم فيه تغير ملحوظ (>= 5%) + حجم فعلي
      if (Math.abs(change) < 5) continue;
      if (currentVol <= 0) continue;

      let avgVol20 = 0;
      let lastClose: number | null = null;
      if (hasHistorical) {
        const info = getAverageVolume20(db, s.symbol, marketArabic);
        avgVol20 = info.avg;
        lastClose = info.lastClose;
      }

      // فلتر الـ explosive: الحجم >= 2× المتوسط
      // لو مفيش historical_data، نكتفي بـ change >= 5% + حجم > 0
      let volumeRatio = 0;
      let passesVolumeFilter = false;
      if (avgVol20 > 0) {
        volumeRatio = currentVol / avgVol20;
        passesVolumeFilter = volumeRatio >= 2;
      } else {
        // مفيش historical → نعتمد على التغير القوي + حجم معقول
        // نعتبري: الحجم > 10000 كحد أدنى للسيولة
        passesVolumeFilter = currentVol >= 10000;
        volumeRatio = 0;
      }

      if (!passesVolumeFilter) continue;

      opportunities.push({
        ticker: s.symbol,
        name: s.name,
        market: marketParam,
        current_price: Math.round(price * 100) / 100,
        change_percent: Math.round(change * 100) / 100,
        current_volume: Math.round(currentVol),
        avg_volume_20: avgVol20 > 0 ? Math.round(avgVol20) : 0,
        volume_ratio: volumeRatio > 0 ? Math.round(volumeRatio * 100) / 100 : null,
        market_cap: s.market_cap != null ? safeNum(s.market_cap) : null,
        signal: change >= 5 ? 'explosive_up' : 'explosive_down',
        reason: avgVol20 > 0
          ? `حجم ${volumeRatio.toFixed(1)}× المتوسط + تغير ${change.toFixed(1)}%`
          : `تغير ${change.toFixed(1)}% بحجم ${currentVol.toLocaleString()}`,
        last_close: lastClose,
      });
    }

    // رتّب حسب القوة (الأعلى |change × volume_ratio)
    opportunities.sort((a, b) => {
      const aScore = Math.abs(a.change_percent) * (a.volume_ratio ?? 1);
      const bScore = Math.abs(b.change_percent) * (b.volume_ratio ?? 1);
      return bScore - aScore;
    });

    const top = opportunities.slice(0, limit);

    return NextResponse.json({
      success: true,
      market: marketParam,
      market_arabic: marketArabic,
      source: 'data_engine.db',
      has_historical_data: hasHistorical,
      filter: {
        min_change_pct: 5,
        volume_multiple: 2,
        lookback_days: 20,
      },
      opportunities: top,
      count: top.length,
      total_candidates: stocks.length,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/explosive/hunt] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        opportunities: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}
