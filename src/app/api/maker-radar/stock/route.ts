import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { getRadarDb, getRadarDbConfig, parseVolume, computeTurnover } from '@/lib/radar-db';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = process.cwd();
const TRACKING_FILE = path.join(PROJECT_ROOT, 'db', 'maker_radar_tracking.json');

interface TrackedStock {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  addedAt: string;
  notes?: string;
}

function loadTracking(): Record<string, TrackedStock> {
  try {
    if (existsSync(TRACKING_FILE)) {
      const data = readFileSync(TRACKING_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('[maker-radar/stock] load tracking error:', e);
  }
  return {};
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
  const days = parseInt(url.searchParams.get('days') || '30', 10);

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'ticker query param is required' },
      { status: 400 }
    );
  }

  const cfg = getRadarDbConfig();
  const db = getRadarDb();
  if (!cfg || !db) {
    return NextResponse.json(
      {
        success: false,
        error: 'No radar DB available. Run scripts/fetch_production_data.py on sandbox, or ensure db/stocks.db exists on production.',
      },
      { status: 503 }
    );
  }

  try {
    // 1. بيانات السهم الأساسية من stocks table (لو موجود)
    let stockInfo: any = null;
    try {
      stockInfo = db.prepare('SELECT * FROM stocks WHERE ticker = ?').get(ticker);
    } catch (e) {
      // مفيش stocks table — نكمل من غيره
    }

    // 2. آخر N يوم أسعار — portable query
    const cols = `${cfg.dateCol}, ${cfg.openCol} as open, ${cfg.highCol} as high, ${cfg.lowCol} as low, ${cfg.priceCol} as close, ${cfg.volumeCol} as volume`;
    const turnoverSelect = cfg.turnoverCol ? `, ${cfg.turnoverCol} as turnover` : ', NULL as turnover';
    const priceRows = db.prepare(`
      SELECT ${cols}${turnoverSelect}
      FROM ${cfg.table}
      WHERE ${cfg.tickerCol} = ? AND ${cfg.priceCol} IS NOT NULL AND ${cfg.priceCol} > 0
      ORDER BY ${cfg.dateCol} DESC
      LIMIT ?
    `).all(ticker, days) as any[];

    const prices = priceRows.reverse().map((r) => ({
      date: r[cfg.dateCol],
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: parseVolume(r.volume),
      turnover: computeTurnover(r, cfg),
    }));

    // 3. إحصائيات
    const closes = prices.map((p) => p.close).filter((c) => c > 0);
    const volumes = prices.map((p) => p.volume).filter((v) => v > 0);
    const turnovers = prices.map((p) => p.turnover).filter((t) => t > 0);

    const lastClose = closes.length > 0 ? closes[closes.length - 1] : 0;
    const firstClose = closes.length > 0 ? closes[0] : 0;
    const changePct = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;

    const avgVolume20 = volumes.length >= 20
      ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20
      : (volumes.reduce((a, b) => a + b, 0) / Math.max(volumes.length, 1));
    const avgTurnover20 = turnovers.length >= 20
      ? turnovers.slice(-20).reduce((a, b) => a + b, 0) / 20
      : (turnovers.reduce((a, b) => a + b, 0) / Math.max(turnovers.length, 1));

    // ROC 10d
    const roc10d = closes.length >= 11 && closes[closes.length - 11] > 0
      ? ((closes[closes.length - 1] - closes[closes.length - 11]) / closes[closes.length - 11]) * 100
      : 0;

    // max/min 20d
    const last20 = closes.slice(-20);
    const max20 = last20.length > 0 ? Math.max(...last20) : 0;
    const min20 = last20.length > 0 ? Math.min(...last20) : 0;
    const range20Pct = min20 > 0 ? ((max20 - min20) / min20) * 100 : 0;

    // 4. tracking info
    const tracking = loadTracking();
    const tracked = tracking[ticker];
    let trackingInfo = null;
    if (tracked) {
      const changeSinceTracking = tracked.entryPrice > 0
        ? ((lastClose - tracked.entryPrice) / tracked.entryPrice) * 100
        : 0;
      trackingInfo = {
        isTracked: true,
        entryDate: tracked.entryDate,
        entryPrice: tracked.entryPrice,
        currentPrice: lastClose,
        changeSinceTracking: Math.round(changeSinceTracking * 100) / 100,
        daysTracked: Math.floor((Date.now() - new Date(tracked.entryDate).getTime()) / (1000 * 60 * 60 * 24)),
      };
    }

    db.close();

    return NextResponse.json({
      success: true,
      ticker,
      stock_info: stockInfo || null,
      prices,
      stats: {
        lastClose: Math.round(lastClose * 100) / 100,
        changePct: Math.round(changePct * 100) / 100,
        roc10d: Math.round(roc10d * 100) / 100,
        avgVolume20: Math.round(avgVolume20),
        avgTurnover20: Math.round(avgTurnover20),
        max20: Math.round(max20 * 100) / 100,
        min20: Math.round(min20 * 100) / 100,
        range20Pct: Math.round(range20Pct * 100) / 100,
        dataPoints: prices.length,
      },
      tracking: trackingInfo,
      db_source: cfg.dbPath.split('/').pop(), // اسم الـ DB المستخدم
    });
  } catch (error: any) {
    console.error('[maker-radar/stock] error:', error);
    try { db.close(); } catch {}
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
