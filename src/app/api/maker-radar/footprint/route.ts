import { NextRequest, NextResponse } from 'next/server';
import { getRadarDb, getRadarDbConfig, parseVolume } from '@/modules/radar/lib/radar-db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
  const days = parseInt(url.searchParams.get('days') || '30', 10);
  if (!ticker) return NextResponse.json({ success: false, error: 'ticker required' }, { status: 400 });

  const cfg = getRadarDbConfig();
  const db = getRadarDb();
  if (!cfg || !db) return NextResponse.json({ success: false, error: 'DB not available' }, { status: 503 });

  try {
    const rows = db.prepare(`SELECT ${cfg.highCol} as high, ${cfg.lowCol} as low, ${cfg.priceCol} as close, ${cfg.openCol} as open, ${cfg.volumeCol} as volume FROM ${cfg.table} WHERE ${cfg.tickerCol} = ? AND ${cfg.priceCol} IS NOT NULL ORDER BY ${cfg.dateCol} DESC LIMIT ?`).all(ticker, days) as any[];
    db.close();

    if (rows.length < 5) return NextResponse.json({ success: false, error: 'بيانات غير كافية' }, { status: 400 });

    const prices = rows.reverse();
    const minLow = Math.min(...prices.map(p => p.low));
    const maxHigh = Math.max(...prices.map(p => p.high));
    const binCount = 18;
    const binSize = (maxHigh - minLow) / binCount || 1;
    const levels: any[] = [];

    for (let i = 0; i < binCount; i++) {
      const low = minLow + i * binSize;
      const high = low + binSize;
      const mid = (low + high) / 2;
      let volume = 0, buyVol = 0, sellVol = 0;

      for (const p of prices) {
        const barRange = p.high - p.low || 1;
        if (p.high >= low && p.low <= high) {
          const overlap = Math.min(p.high, high) - Math.max(p.low, low);
          if (overlap > 0) {
            const v = parseVolume(p.volume) * (overlap / barRange);
            volume += v;
            if (p.close > p.open) { buyVol += v * 0.7; sellVol += v * 0.3; }
            else if (p.close < p.open) { buyVol += v * 0.3; sellVol += v * 0.7; }
            else { buyVol += v * 0.5; sellVol += v * 0.5; }
          }
        }
      }
      levels.push({ price_low: low, price_high: high, price_mid: mid, volume: Math.round(volume), buy_volume: Math.round(buyVol), sell_volume: Math.round(sellVol), delta: Math.round(buyVol - sellVol), volume_pct: 0, is_poc: false, is_value_area: false });
    }

    // Find POC + VAH/VAL
    const pocIdx = levels.reduce((max, l, i, arr) => l.volume > arr[max].volume ? i : max, 0);
    levels[pocIdx].is_poc = true;
    const totalVol = levels.reduce((s, l) => s + l.volume, 0);
    levels.forEach(l => l.volume_pct = totalVol > 0 ? (l.volume / totalVol * 100) : 0);

    let vaVol = 0, vahIdx = pocIdx, valIdx = pocIdx;
    while (vaVol < totalVol * 0.7 && (vahIdx < levels.length - 1 || valIdx > 0)) {
      const upVol = vahIdx < levels.length - 1 ? levels[vahIdx + 1].volume : 0;
      const dnVol = valIdx > 0 ? levels[valIdx - 1].volume : 0;
      if (upVol >= dnVol && vahIdx < levels.length - 1) { vahIdx++; vaVol += levels[vahIdx].volume; }
      else if (valIdx > 0) { valIdx--; vaVol += levels[valIdx].volume; }
      else break;
    }
    for (let i = valIdx; i <= vahIdx; i++) levels[i].is_value_area = true;

    const sortedLevels = [...levels].sort((a, b) => b.price_mid - a.price_mid);
    const buyTotal = sortedLevels.reduce((s, l) => s + l.buy_volume, 0);
    const sellTotal = sortedLevels.reduce((s, l) => s + l.sell_volume, 0);

    return NextResponse.json({
      success: true, ticker, days, bin_count: binCount,
      price_min: minLow, price_max: maxHigh,
      poc_price: levels[pocIdx].price_mid, poc_volume: levels[pocIdx].volume,
      vah_price: levels[vahIdx].price_mid, val_price: levels[valIdx].price_mid,
      value_area_volume_pct: totalVol > 0 ? (vaVol / totalVol * 100) : 0,
      total_volume: totalVol, buy_volume: buyTotal, sell_volume: sellTotal,
      delta_volume: buyTotal - sellTotal, buy_sell_ratio: sellTotal > 0 ? buyTotal / sellTotal : 0,
      levels: sortedLevels, computed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
