/**
 * GET /api/maker-radar/live-watch
 * ===============================
 * Flutter compat endpoint — مراقبة السيولة الحية.
 *
 * Query:
 *   ?market=EGX  (default)
 *   ?limit=50    (default, max 200)
 *
 * المصدر: intraday.db.stock_intraday (لو موجود)
 *
 * الفلتر:
 *   - timestamp في آخر 5 دقايق
 *   - volume > avg_volume (للرمز ده خلال آخر ساعة)
 *   - delta_volume > 0
 *
 * يرجع: قائمة الأسهم اللي فيها نشاط مؤسسي حديث.
 *
 * Fallback: لو intraday.db مفقود → جرّب data_engine.db.stocks وفلتر بـ
 * change_percent + volume (مؤشر غير مباشر على النشاط المؤسسي).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDataEngineDb, marketCodeToArabic } from '@/lib/data-engine-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const fs = require('fs');
const path = require('path');

const INTRADAY_DB_PATH = path.join(process.cwd(), 'db', 'intraday.db');

function dbExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

function tableExists(db: any, tableName: string): boolean {
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
      .get(tableName) as { name?: string } | undefined;
    return !!row?.name;
  } catch {
    return false;
  }
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

interface IntradayRow {
  ticker: string;
  market: string | null;
  timestamp: string;
  volume: number;
  price: number;
  delta_volume?: number | null;
  bid_volume?: number | null;
  ask_volume?: number | null;
  trades_count?: number | null;
}

interface LiveWatchItem {
  ticker: string;
  market: string;
  current_price: number;
  current_volume: number;
  avg_volume_1h: number;
  volume_ratio: number;
  delta_volume: number;
  bid_volume: number | null;
  ask_volume: number | null;
  trades_count: number | null;
  last_timestamp: string;
  signal: 'institutional_buy' | 'institutional_sell' | 'high_activity';
  reason: string;
}

function fetchFromIntraday(market: string, limit: number): { items: LiveWatchItem[]; source: string } {
  if (!dbExists(INTRADAY_DB_PATH)) return { items: [], source: 'intraday.db missing' };

  try {
    const Database = require('better-sqlite3');
    const db = new Database(INTRADAY_DB_PATH, { readonly: true });

    if (!tableExists(db, 'stock_intraday')) {
      db.close();
      return { items: [], source: 'stock_intraday table missing' };
    }

    const marketArabic = marketCodeToArabic(market);

    // 1) آخر 5 دقايق
    const recentRows = db.prepare(`
      SELECT ticker, market, timestamp, volume, price,
             delta_volume, bid_volume, ask_volume, trades_count
      FROM stock_intraday
      WHERE market = ?
        AND timestamp >= datetime('now', '-5 minutes')
      ORDER BY timestamp DESC
      LIMIT 500
    `).all(marketArabic) as IntradayRow[];

    if (recentRows.length === 0) {
      db.close();
      return { items: [], source: 'no recent intraday data (last 5 min)' };
    }

    // 2) احسب avg_volume لكل ticker في آخر ساعة
    const avgMap = new Map<string, number>();
    const tickers = Array.from(new Set(recentRows.map(r => r.ticker))).slice(0, 100);
    for (const t of tickers) {
      try {
        const row = db.prepare(`
          SELECT AVG(volume) AS avg_vol
          FROM stock_intraday
          WHERE ticker = ? AND market = ?
            AND timestamp >= datetime('now', '-1 hour')
        `).get(t, marketArabic) as { avg_vol: number | null } | undefined;
        avgMap.set(t, safeNum(row?.avg_vol));
      } catch {
        avgMap.set(t, 0);
      }
    }
    db.close();

    // 3) فلتر + normalize
    const items: LiveWatchItem[] = [];
    for (const r of recentRows) {
      const currentVol = safeNum(r.volume);
      const avg = avgMap.get(r.ticker) ?? 0;
      const deltaVol = r.delta_volume != null ? safeNum(r.delta_volume) : currentVol - avg;

      // الفلتر: volume > avg AND delta_volume > 0
      if (avg > 0 && currentVol <= avg) continue;
      if (deltaVol <= 0) continue;

      const volumeRatio = avg > 0 ? currentVol / avg : 0;
      const bidVol = r.bid_volume != null ? safeNum(r.bid_volume) : null;
      const askVol = r.ask_volume != null ? safeNum(r.ask_volume) : null;
      const tradesCount = r.trades_count != null ? safeNum(r.trades_count) : null;

      // signal classification
      let signal: LiveWatchItem['signal'] = 'high_activity';
      let reason = `حجم ${volumeRatio.toFixed(1)}× المتوسط`;
      if (bidVol != null && askVol != null) {
        if (bidVol > askVol * 1.5) {
          signal = 'institutional_buy';
          reason = `شراء مؤسسي: bid_vol ${bidVol} > ask_vol ${askVol}`;
        } else if (askVol > bidVol * 1.5) {
          signal = 'institutional_sell';
          reason = `بيع مؤسسي: ask_vol ${askVol} > bid_vol ${bidVol}`;
        }
      }

      items.push({
        ticker: r.ticker,
        market,
        current_price: safeNum(r.price),
        current_volume: Math.round(currentVol),
        avg_volume_1h: Math.round(avg),
        volume_ratio: Math.round(volumeRatio * 100) / 100,
        delta_volume: Math.round(deltaVol),
        bid_volume: bidVol,
        ask_volume: askVol,
        trades_count: tradesCount,
        last_timestamp: r.timestamp,
        signal,
        reason,
      });
    }

    // رتّب حسب القوة (volume_ratio × delta_volume)
    items.sort((a, b) =>
      (b.volume_ratio * b.delta_volume) - (a.volume_ratio * a.delta_volume)
    );

    return { items: items.slice(0, limit), source: 'intraday.db.stock_intraday' };
  } catch (e) {
    console.warn('[maker-radar/live-watch] intraday query failed:', e);
    return { items: [], source: 'intraday error: ' + String(e) };
  }
}

function fetchFromDataEngine(market: string, limit: number): { items: LiveWatchItem[]; source: string } {
  try {
    const db = getDataEngineDb();
    if (!tableExists(db, 'stocks')) return { items: [], source: 'stocks table missing' };

    const marketArabic = marketCodeToArabic(market);
    // فلتر بسيط: top volume + change >= 3% (مؤشر على نشاط قوي)
    const rows = db.prepare(`
      SELECT symbol, name, price, change_percent, volume, market_cap
      FROM stocks
      WHERE market = ?
        AND volume IS NOT NULL AND CAST(volume AS REAL) > 0
        AND (change_percent IS NOT NULL AND ABS(CAST(change_percent AS REAL)) >= 3)
      ORDER BY CAST(volume AS REAL) DESC
      LIMIT ?
    `).all(marketArabic, limit) as Array<{
      symbol: string;
      name: string | null;
      price: number | null;
      change_percent: number | null;
      volume: string | number | null;
    }>;

    const items: LiveWatchItem[] = rows.map(r => {
      const vol = safeNum(r.volume);
      const chg = safeNum(r.change_percent);
      return {
        ticker: r.symbol,
        market,
        current_price: safeNum(r.price),
        current_volume: Math.round(vol),
        avg_volume_1h: 0,
        volume_ratio: 0,
        delta_volume: 0,
        bid_volume: null,
        ask_volume: null,
        trades_count: null,
        last_timestamp: new Date().toISOString(),
        signal: chg > 0 ? 'institutional_buy' : 'institutional_sell',
        reason: `نشاط قوي: تغير ${chg.toFixed(1)}% بحجم ${vol.toLocaleString()}`,
      };
    });

    return {
      items,
      source: 'data_engine.db.stocks (indirect — no intraday data)',
    };
  } catch (e) {
    return { items: [], source: 'data_engine error: ' + String(e) };
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const market = (url.searchParams.get('market') || 'EGX').toUpperCase();
    const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10) || 50));

    // 1) جرّب intraday.db أولاً
    let result = fetchFromIntraday(market, limit);

    // 2) fallback لـ data_engine.db لو intraday مفيش
    if (result.items.length === 0) {
      result = fetchFromDataEngine(market, limit);
    }

    return NextResponse.json({
      success: true,
      market,
      source: result.source,
      filter: {
        window_minutes: 5,
        avg_window_minutes: 60,
        require_volume_above_avg: true,
        require_delta_positive: true,
      },
      items: result.items,
      count: result.items.length,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/maker-radar/live-watch] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        items: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}
