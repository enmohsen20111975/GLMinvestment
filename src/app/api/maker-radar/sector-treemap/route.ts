import { NextRequest, NextResponse } from 'next/server';
import { readRadarCache } from '@/modules/radar/lib/radar-cache';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const cache = readRadarCache();
    if (!cache || !cache.data) return NextResponse.json({ success: false, error: 'الرادار بيتسخن' }, { status: 503 });

    const data = cache.data;
    const allStocks = [...(data.quiet_list || []), ...(data.pre_surge_list || []), ...(data.explosive_list || []), ...(data.early_break_list || [])];

    const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
    let sectorMap: Record<string, any[]> = {};
    try {
      const db = new Database(dbPath, { readonly: true });
      for (const s of allStocks) {
        const stock = db.prepare("SELECT sector, name_ar FROM stocks WHERE ticker = ?").get(s.ticker) as any;
        const sector = stock?.sector || 'غير مُصنّف';
        if (!sectorMap[sector]) sectorMap[sector] = [];
        sectorMap[sector].push({ ...s, name_ar: stock?.name_ar, sector });
      }
      db.close();
    } catch { // silent fallback (safe-by-design)
      sectorMap = { 'غير مُصنّف': allStocks };
    }

    const sectors = Object.entries(sectorMap).map(([sector, stocks]) => {
      const totalTurnover = stocks.reduce((s, st) => s + (st.avg_turnover_20d || 0), 0);
      const avgChange = stocks.length > 0 ? stocks.reduce((s, st) => s + (st.roc_10d || 0), 0) / stocks.length : 0;
      const direction = avgChange > 0.5 ? 'inflow' : avgChange < -0.5 ? 'outflow' : 'neutral';
      return {
        sector, stocks_count: stocks.length, total_turnover: totalTurnover,
        avg_change_pct: avgChange, direction,
        color: direction === 'inflow' ? 'emerald' : direction === 'outflow' ? 'rose' : 'amber',
        top_tickers: stocks.sort((a, b) => (b.avg_turnover_20d || 0) - (a.avg_turnover_20d || 0)).slice(0, 3).map(s => ({
          ticker: s.ticker, name_ar: s.name_ar, avg_turnover_20d: s.avg_turnover_20d, change_pct: s.roc_10d || 0, roc_10d: s.roc_10d || 0,
        })),
      };
    }).sort((a, b) => b.total_turnover - a.total_turnover);

    return NextResponse.json({
      success: true, days: 30, total_sectors: sectors.length,
      total_turnover: sectors.reduce((s, sec) => s + sec.total_turnover, 0),
      sectors, generated_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[maker-radar:sector-treemap]', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
