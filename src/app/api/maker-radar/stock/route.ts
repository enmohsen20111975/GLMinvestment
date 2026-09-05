import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = process.cwd();
const PROD_DB = path.join(PROJECT_ROOT, 'db', 'production_snapshot.db');
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

function parseVolume(v: any): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim().toUpperCase().replace(/\u202f/g, '').replace(/\xa0/g, '').replace(/\s/g, '');
  let mult = 1;
  let num = s;
  if (s.endsWith('K')) { mult = 1e3; num = s.slice(0, -1); }
  else if (s.endsWith('M')) { mult = 1e6; num = s.slice(0, -1); }
  else if (s.endsWith('B')) { mult = 1e9; num = s.slice(0, -1); }
  const parsed = parseFloat(num);
  return isNaN(parsed) ? 0 : parsed * mult;
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

  if (!existsSync(PROD_DB)) {
    return NextResponse.json(
      { success: false, error: 'production_snapshot.db not found. Run fetch_production_data.py first.' },
      { status: 503 }
    );
  }

  try {
    const db = new Database(PROD_DB, { readonly: true, fileMustExist: true });

    // 1. بيانات السهم الأساسية من stocks table
    const stockInfo = db.prepare('SELECT * FROM stocks WHERE ticker = ?').get(ticker) as any;

    // 2. آخر N يوم أسعار
    const priceRows = db.prepare(`
      SELECT price_date, open, high, low, close, volume, turnover
      FROM stock_daily_prices
      WHERE ticker = ? AND close IS NOT NULL AND close > 0
      ORDER BY price_date DESC
      LIMIT ?
    `).all(ticker, days) as any[];

    const prices = priceRows.reverse().map((r) => ({
      date: r.price_date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: parseVolume(r.volume),
      turnover: r.turnover || (r.close * parseVolume(r.volume)),
    }));

    // 3. إحصائيات
    const closes = prices.map((p) => p.close).filter((c) => c > 0);
    const volumes = prices.map((p) => p.volume).filter((v) => v > 0);
    const turnovers = prices.map((p) => p.turnover).filter((t) => t > 0);

    const lastClose = closes.length > 0 ? closes[closes.length - 1] : 0;
    const firstClose = closes.length > 0 ? closes[0] : 0;
    const changePct = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;

    const avgVolume20 = volumes.length >= 20 ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : (volumes.reduce((a, b) => a + b, 0) / Math.max(volumes.length, 1));
    const avgTurnover20 = turnovers.length >= 20 ? turnovers.slice(-20).reduce((a, b) => a + b, 0) / 20 : (turnovers.reduce((a, b) => a + b, 0) / Math.max(turnovers.length, 1));

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
    });
  } catch (error: any) {
    console.error('[maker-radar/stock] error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
