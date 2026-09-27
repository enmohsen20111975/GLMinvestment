export const dynamic = 'force-dynamic';
export const revalidate = 0;
/**
 * Market Pulse API - Proxy to Python Backend
 * نبض السوق اللحظي
 *
 * P19-HOTFIX: لو الـ Python backend مش متاح → نرجّع آخر cache طازجة (حتى لو
 * منتهية) بدل ما نرجع 503. ده بيخلي الـ frontend يفضل شغال بدل ما يقع خالص.
 */

import { NextResponse } from 'next/server';

const PYTHON_BACKEND = process.env.EGX_VPS_API_URL || process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

let cache: { timestamp: number; data: unknown } | null = null;
const CACHE_TTL = 10_000;
const STALE_CACHE_TTL = 5 * 60_000; // P19-HOTFIX: نقبل cache قديم لحد 5 دقايق

// P19-HOTFIX: fallback response لو الـ Python backend مش متاح ومفيش cache خالص
const FALLBACK_RESPONSE = {
  success: false,
  error: 'market_pulse_unavailable',
  data: {
    cairo_time: new Date().toISOString(),
    is_trading_hours: false,
    market_status: 'UNKNOWN',
    sectors: [],
    gainers: [],
    losers: [],
    most_active: [],
    signals: [],
    breadth: { gainers: 0, losers: 0, unchanged: 0, adv_dec_ratio: 0, total_turnover: 0, total_turnover_bn: 0 },
    pulse: { score: 0, label: 'محايد', label_en: 'NEUTRAL', color: 'amber' },
    divergence: { value: 0, regime: 'UNKNOWN', regime_ar: 'غير معروف', action: 'HOLD', action_ar: 'انتظر' },
  },
};

export async function GET() {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(`${PYTHON_BACKEND}/api/market-pulse`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'Accept': 'application/json', 'Cache-Control': 'no-store' },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      // P19-HOTFIX: لو الـ Python رجع error → نرجّع stale cache لو موجود،
      // بدل ما نرجع 502 للـ frontend.
      if (cache && Date.now() - cache.timestamp < STALE_CACHE_TTL) {
        return NextResponse.json(cache.data);
      }
    
    // P0-FIX: SQLite fallback — read market pulse from stocks.db
    try {
      const path = require('path');
      const fs = require('fs');
      const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
      if (fs.existsSync(stocksDbPath)) {
        const Database = require('better-sqlite3');
        const db = new Database(stocksDbPath, { readonly: true });
        const stocks = db.prepare("SELECT change_percent FROM stocks WHERE market = 'EGX'").all();
        const advancing = stocks.filter((s: any) => Number(s.change_percent) > 0).length;
        const declining = stocks.filter((s: any) => Number(s.change_percent) < 0).length;
        const total = stocks.length;
        const unchanged = total - advancing - declining;
        const breadth = total > 0 ? ((advancing - declining) / total * 100) : 0;
        db.close();
        let egx30Data: any = null;
        let egx70Data: any = null;
        try {
          const idxRows = db.prepare("SELECT symbol, current_value, previous_close, change_percent FROM market_indices WHERE symbol IN ('EGX30','EGX70')").all() as any[];
          const r30 = idxRows.find((r: any) => r.symbol === 'EGX30');
          const r70 = idxRows.find((r: any) => r.symbol === 'EGX70');
          if (r30) egx30Data = { value: Number(r30.current_value), previous_close: Number(r30.previous_close), change_percent: Number(r30.change_percent) };
          if (r70) egx70Data = { value: Number(r70.current_value), previous_close: Number(r70.previous_close), change_percent: Number(r70.change_percent) };
        } catch {}

        return NextResponse.json({
          success: true,
          source: 'sqlite_fallback',
          data: {
            cairo_time: new Date().toISOString(),
            is_trading_hours: false,
            market_status: 'CLOSED',
            egx30: egx30Data,
            egx70: egx70Data,
            breadth: Math.round(breadth * 10) / 10,
            advancing,
            declining,
            unchanged,
            total,
            pulse_value: Math.max(-5, Math.min(5, Math.round(breadth / 10))),
            sentiment: breadth > 10 ? 'GREED' : breadth < -10 ? 'FEAR' : 'NEUTRAL',
          }
        }, {
          headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
        });
      }
    } catch (e) {
      console.error('[market-pulse] SQLite fallback error:', e);
    }
    
  return NextResponse.json(FALLBACK_RESPONSE);
    }

    const data = await response.json();
    cache = { timestamp: Date.now(), data };
    return NextResponse.json(data);
  } catch (error) {
    console.error('[market-pulse] Error:', error);
    // P19-HOTFIX: لو الـ Python مش متاح خالص → نرجّع stale cache لو موجود
    // (حتى لو منتهية) بدل ما نرجع 503. لو مفيش cache → نرجّع fallback آمن.
    if (cache) {
      return NextResponse.json(cache.data);
    }
  
    // P0-FIX: SQLite fallback — read market pulse from stocks.db
    try {
      const path = require('path');
      const fs = require('fs');
      const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
      if (fs.existsSync(stocksDbPath)) {
        const Database = require('better-sqlite3');
        const db = new Database(stocksDbPath, { readonly: true });
        const stocks = db.prepare("SELECT change_percent FROM stocks WHERE market = 'EGX'").all();
        const advancing = stocks.filter((s: any) => Number(s.change_percent) > 0).length;
        const declining = stocks.filter((s: any) => Number(s.change_percent) < 0).length;
        const total = stocks.length;
        const unchanged = total - advancing - declining;
        const breadth = total > 0 ? ((advancing - declining) / total * 100) : 0;
        db.close();
        let egx30Data: any = null;
        let egx70Data: any = null;
        try {
          const idxRows = db.prepare("SELECT symbol, current_value, previous_close, change_percent FROM market_indices WHERE symbol IN ('EGX30','EGX70')").all() as any[];
          const r30 = idxRows.find((r: any) => r.symbol === 'EGX30');
          const r70 = idxRows.find((r: any) => r.symbol === 'EGX70');
          if (r30) egx30Data = { value: Number(r30.current_value), previous_close: Number(r30.previous_close), change_percent: Number(r30.change_percent) };
          if (r70) egx70Data = { value: Number(r70.current_value), previous_close: Number(r70.previous_close), change_percent: Number(r70.change_percent) };
        } catch {}

        return NextResponse.json({
          success: true,
          source: 'sqlite_fallback',
          data: {
            cairo_time: new Date().toISOString(),
            is_trading_hours: false,
            market_status: 'CLOSED',
            egx30: egx30Data,
            egx70: egx70Data,
            breadth: Math.round(breadth * 10) / 10,
            advancing,
            declining,
            unchanged,
            total,
            pulse_value: Math.max(-5, Math.min(5, Math.round(breadth / 10))),
            sentiment: breadth > 10 ? 'GREED' : breadth < -10 ? 'FEAR' : 'NEUTRAL',
          }
        }, {
          headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
        });
      }
    } catch (e) {
      console.error('[market-pulse] SQLite fallback error:', e);
    }
    
  return NextResponse.json(FALLBACK_RESPONSE);
  }
}
