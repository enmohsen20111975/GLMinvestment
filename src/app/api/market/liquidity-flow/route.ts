/**
 * GET /api/market/liquidity-flow
 * =================================
 * حركة السيولة القطاعية + اتجاهات تدفّق الأموال داخل السوق.
 *
 * Query:
 *   ?market=EGX     (default; EGX | TADAWUL | KSE | QSE)
 *   ?days=30        (default; window على آخر N يوم تداول)
 *
 * Reads from db/stocks.db (better-sqlite3, readonly):
 *   - stocks                  (sector, current_price, volume)
 *   - stock_daily_prices      (price_date, close, close_price, volume, change_percent)
 *
 * Output:
 *   - sector_flow: top 12 sectors by total turnover
 *   - top_inflow_stocks: top 10 stocks (positive change + high turnover)
 *   - top_outflow_stocks: top 10 stocks (negative change + high turnover)
 *   - investor_type_estimate: institutional vs retail + block trades
 *   - summary: total turnover/volume, net direction, advancing/declining sectors
 *
 * NO mock data — كل رقم من SQLite فعلي.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const fs = require('fs');
const path = require('path');

const STOCKS_DB_PATH = path.join(process.cwd(), 'db', 'stocks.db');

function dbExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

function openDb(p: string): any {
  const Database = require('better-sqlite3');
  return new Database(p, { readonly: true });
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** يحوّل قيمة حجم/قيمة التداول لرقم صافي (التقرير المباشر أحياناً بيرجّع نصوص مثل '317.39 K'). */
function parseVolume(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (!s) return 0;
  const m = s.match(/^([\d.,]+)\s*([KMBT]?)$/i);
  if (!m) {
    const n = Number(s.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  const num = parseFloat(m[1].replace(/,/g, ''));
  const mult = (m[2] || '').toUpperCase();
  const factor =
    mult === 'K' ? 1e3 :
    mult === 'M' ? 1e6 :
    mult === 'B' ? 1e9 :
    mult === 'T' ? 1e12 : 1;
  return num * factor;
}

/** يرجّع سعر اليوم: close → close_price → fallback لـ current_price من جدول stocks. */
function dayPrice(row: { close?: number | null; close_price?: number | null }, fallback: number): number {
  if (row.close != null && Number.isFinite(Number(row.close)) && Number(row.close) > 0) return Number(row.close);
  if (row.close_price != null && Number.isFinite(Number(row.close_price)) && Number(row.close_price) > 0) return Number(row.close_price);
  return fallback;
}

interface DailyRow {
  ticker: string;
  price_date: string;
  close: number | null;
  close_price: number | null;
  volume: number | string | null;
  change_percent: number | null;
}

interface StockMeta {
  ticker: string;
  name_ar: string | null;
  name: string | null;
  sector: string | null;
  current_price: number | null;
}

interface SectorAgg {
  sector: string;
  total_turnover: number;
  total_volume: number;
  stocks_count: number;
  change_sum: number;
  change_count: number;
  prev_turnover: number;
}

interface StockFlow {
  ticker: string;
  name_ar: string;
  sector: string;
  total_turnover: number;
  total_volume: number;
  avg_change_pct: number;
  latest_change_pct: number;
  latest_price: number;
}

export async function GET(req: NextRequest) {
  if (!dbExists(STOCKS_DB_PATH)) {
    return NextResponse.json(
      {
        success: false,
        error: 'stocks.db not found',
        path: STOCKS_DB_PATH,
        sector_flow: [],
        top_inflow_stocks: [],
        top_outflow_stocks: [],
        investor_type_estimate: null,
        summary: null,
      },
      { status: 500 }
    );
  }

  try {
    const url = new URL(req.url);
    const marketParam = (url.searchParams.get('market') || 'EGX').toUpperCase();
    const market = ['EGX', 'TADAWUL', 'KSE', 'QSE'].includes(marketParam) ? marketParam : 'EGX';
    const days = Math.max(1, Math.min(180, parseInt(url.searchParams.get('days') || '30', 10) || 30));

    const db = openDb(STOCKS_DB_PATH);

    // 1) tickers + metadata للسوق ده
    const stockRows = db.prepare(`
      SELECT ticker, name_ar, name, sector, current_price
      FROM stocks
      WHERE market = ? AND is_active = 1
    `).all(market) as StockMeta[];
    if (stockRows.length === 0) {
      db.close();
      return NextResponse.json({
        success: true,
        market,
        days,
        sector_flow: [],
        top_inflow_stocks: [],
        top_outflow_stocks: [],
        investor_type_estimate: null,
        summary: { total_turnover: 0, total_volume: 0, net_flow_direction: 'neutral', advancing_sectors: 0, declining_sectors: 0 },
        note: 'no stocks for this market',
      });
    }

    const tickerToMeta = new Map<string, StockMeta>();
    for (const s of stockRows) tickerToMeta.set(s.ticker, s);
    const tickers = stockRows.map((s) => s.ticker);

    // 2) cutoff date: نثبّت النافذة على آخر يوم تداول فعلي في القاعدة (وليس اليوم الحالي)
    //    لأن السيرفر ممكن يكون له آخر تحديث أقدم من النهارده، والنافذة لازم تشمل البيانات الحقيقية.
    const latestDateRow = db
      .prepare(`
        SELECT MAX(price_date) AS latest_date
        FROM stock_daily_prices
        WHERE ticker IN (${tickers.map(() => '?').join(',')})
      `)
      .get(...tickers) as { latest_date: string | null } | undefined;
    const latestDateStr = latestDateRow?.latest_date;
    if (!latestDateStr) {
      db.close();
      return NextResponse.json({
        success: true,
        market,
        days,
        sector_flow: [],
        top_inflow_stocks: [],
        top_outflow_stocks: [],
        investor_type_estimate: null,
        summary: { total_turnover: 0, total_volume: 0, net_flow_direction: 'neutral', advancing_sectors: 0, declining_sectors: 0 },
        note: 'no price history available for this market',
      });
    }

    // نقسم العيّنة لـ current window + previous window عشان نحسب change_in_turnover_pct
    // current: [latestDate - days, latestDate]
    // previous: [latestDate - 2*days, latestDate - days)
    const latestDate = new Date(latestDateStr + 'T00:00:00Z');
    const cutoff = new Date(latestDate);
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const prevCutoff = new Date(cutoff);
    prevCutoff.setDate(prevCutoff.getDate() - days);
    const prevCutoffStr = prevCutoff.toISOString().slice(0, 10);

    // 3) اسحب كل صفوف الأسعار للسوق في النافذتين دفعة واحدة
    const placeholders = tickers.map(() => '?').join(',');
    const allRows = db.prepare(`
      SELECT ticker, price_date, close, close_price, volume, change_percent
      FROM stock_daily_prices
      WHERE ticker IN (${placeholders})
        AND price_date IS NOT NULL
        AND price_date >= ?
      ORDER BY ticker, price_date DESC
    `).all(...tickers, prevCutoffStr) as DailyRow[];

    // 4) رتّب الصفوف per ticker + افصل بين current/previous window
    const byTicker = new Map<string, { current: DailyRow[]; previous: DailyRow[] }>();
    for (const r of allRows) {
      const meta = tickerToMeta.get(r.ticker);
      if (!meta) continue;
      const entry = byTicker.get(r.ticker) || { current: [], previous: [] };
      if (r.price_date >= cutoffStr) entry.current.push(r);
      else entry.previous.push(r);
      byTicker.set(r.ticker, entry);
    }

    // 5) اجمع per-stock و per-sector
    const stockFlowList: StockFlow[] = [];
    const sectorMap = new Map<string, SectorAgg>();
    let grandTurnover = 0;
    let grandVolume = 0;
    const avgTradeValues: number[] = [];
    const largeBlocks: { ticker: string; name_ar: string; estimated_value: number; sector: string }[] = [];

    for (const meta of stockRows) {
      const entry = byTicker.get(meta.ticker);
      if (!entry || entry.current.length === 0) continue;
      const fallbackPrice = safeNum(meta.current_price);

      let stockTurnover = 0;
      let stockVolume = 0;
      let changeSum = 0;
      let changeCount = 0;
      let latestChange = 0;
      let latestPrice = fallbackPrice;
      for (const r of entry.current) {
        const price = dayPrice(r, fallbackPrice);
        const vol = parseVolume(r.volume);
        const dayTurnover = price * vol;
        stockTurnover += dayTurnover;
        stockVolume += vol;
        if (r.change_percent != null && Number.isFinite(Number(r.change_percent))) {
          changeSum += Number(r.change_percent);
          changeCount++;
          latestChange = Number(r.change_percent);
          latestPrice = price > 0 ? price : latestPrice;
        }
      }
      if (stockTurnover <= 0) continue;

      const avgChangePct = changeCount > 0 ? changeSum / changeCount : 0;
      const stockFlow: StockFlow = {
        ticker: meta.ticker,
        name_ar: meta.name_ar || meta.name || meta.ticker,
        sector: meta.sector && meta.sector.trim() ? meta.sector.trim() : 'متفرقات',
        total_turnover: stockTurnover,
        total_volume: stockVolume,
        avg_change_pct: avgChangePct,
        latest_change_pct: latestChange,
        latest_price: latestPrice,
      };
      stockFlowList.push(stockFlow);

      // aggregate per sector
      const sec = stockFlow.sector;
      const secAgg = sectorMap.get(sec) || {
        sector: sec,
        total_turnover: 0,
        total_volume: 0,
        stocks_count: 0,
        change_sum: 0,
        change_count: 0,
        prev_turnover: 0,
      };
      secAgg.total_turnover += stockTurnover;
      secAgg.total_volume += stockVolume;
      secAgg.stocks_count += 1;
      secAgg.change_sum += avgChangePct;
      secAgg.change_count += 1;
      sectorMap.set(sec, secAgg);

      // aggregate investor-type estimate signals
      const avgTradeValue = stockVolume > 0 ? stockTurnover / stockVolume : 0;
      avgTradeValues.push(avgTradeValue);
      if (stockTurnover >= 1_000_000) {
        largeBlocks.push({
          ticker: meta.ticker,
          name_ar: stockFlow.name_ar,
          estimated_value: stockTurnover,
          sector: sec,
        });
      }

      // previous window per-sector turnover (للحساب change_in_turnover_pct)
      if (entry.previous.length > 0) {
        let prevTurn = 0;
        for (const r of entry.previous) {
          const price = dayPrice(r, fallbackPrice);
          prevTurn += price * parseVolume(r.volume);
        }
        secAgg.prev_turnover += prevTurn;
      }

      grandTurnover += stockTurnover;
      grandVolume += stockVolume;
    }

    db.close();

    if (stockFlowList.length === 0) {
      return NextResponse.json({
        success: true,
        market,
        days,
        sector_flow: [],
        top_inflow_stocks: [],
        top_outflow_stocks: [],
        investor_type_estimate: {
          institutional_pct: 0,
          retail_pct: 0,
          block_trades_count: 0,
          avg_trade_value: 0,
          large_blocks: [],
        },
        summary: {
          total_turnover: 0,
          total_volume: 0,
          net_flow_direction: 'neutral',
          advancing_sectors: 0,
          declining_sectors: 0,
        },
        note: 'no liquidity data for this market in the selected window',
      });
    }

    // 6) sector_flow — أعلى 12 قطاع
    const sectorFlow = Array.from(sectorMap.values())
      .map((s) => {
        const avgChangePct = s.change_count > 0 ? s.change_sum / s.change_count : 0;
        const flowDirection: 'inflow' | 'outflow' | 'neutral' =
          avgChangePct > 0.5 ? 'inflow' : avgChangePct < -0.5 ? 'outflow' : 'neutral';
        const changeInTurnoverPct =
          s.prev_turnover > 0
            ? ((s.total_turnover - s.prev_turnover) / s.prev_turnover) * 100
            : 0;
        return {
          sector: s.sector,
          total_turnover: Math.round(s.total_turnover * 100) / 100,
          total_volume: Math.round(s.total_volume),
          stocks_count: s.stocks_count,
          avg_change_pct: Math.round(avgChangePct * 100) / 100,
          flow_direction: flowDirection,
          change_in_turnover_pct: Math.round(changeInTurnoverPct * 100) / 100,
        };
      })
      .sort((a, b) => b.total_turnover - a.total_turnover)
      .slice(0, 12);

    // 7) top_inflow / top_outflow stocks — أعلى 10 سيولة داخلة وهاربة
    const topInflow = stockFlowList
      .filter((s) => s.latest_change_pct > 0)
      .sort((a, b) => b.total_turnover - a.total_turnover)
      .slice(0, 10)
      .map((s) => ({
        ticker: s.ticker,
        name_ar: s.name_ar,
        sector: s.sector,
        total_turnover: Math.round(s.total_turnover * 100) / 100,
        total_volume: Math.round(s.total_volume),
        latest_change_pct: Math.round(s.latest_change_pct * 100) / 100,
        latest_price: Math.round(s.latest_price * 100) / 100,
      }));

    const topOutflow = stockFlowList
      .filter((s) => s.latest_change_pct < 0)
      .sort((a, b) => b.total_turnover - a.total_turnover)
      .slice(0, 10)
      .map((s) => ({
        ticker: s.ticker,
        name_ar: s.name_ar,
        sector: s.sector,
        total_turnover: Math.round(s.total_turnover * 100) / 100,
        total_volume: Math.round(s.total_volume),
        latest_change_pct: Math.round(s.latest_change_pct * 100) / 100,
        latest_price: Math.round(s.latest_price * 100) / 100,
      }));

    // 8) investor_type_estimate — تقدير سيولة مؤسسية vs أفراد بناءً على حجم الصفقة المتوسط
    // القاعدة: متوسط قيمة الصفقة > 1M EGP → مؤسسي، أقل → أفراد.
    // النسبة المؤسسية = عدد الأسهم اللي متوسط صفقتها > الحد المؤسسي / إجمالي الأسهم.
    const institutionalThreshold = 1_000_000;
    const institutionalStocks = stockFlowList.filter((s) => {
      const avgTradeVal = s.total_volume > 0 ? s.total_turnover / s.total_volume : 0;
      return avgTradeVal * s.latest_price >= institutionalThreshold || s.total_turnover >= institutionalThreshold;
    });
    const institutionalPct =
      stockFlowList.length > 0
        ? Math.round((institutionalStocks.length / stockFlowList.length) * 10000) / 100
        : 0;
    const retailPct = Math.round((100 - institutionalPct) * 100) / 100;
    const overallAvgTradeValue =
      avgTradeValues.length > 0
        ? Math.round((avgTradeValues.reduce((a, b) => a + b, 0) / avgTradeValues.length) * 100) / 100
        : 0;
    const largeBlocksSorted = largeBlocks
      .sort((a, b) => b.estimated_value - a.estimated_value)
      .slice(0, 8)
      .map((b) => ({
        ticker: b.ticker,
        name_ar: b.name_ar,
        sector: b.sector,
        estimated_value: Math.round(b.estimated_value * 100) / 100,
      }));

    // 9) summary
    const advancingSectors = sectorFlow.filter((s) => s.flow_direction === 'inflow').length;
    const decliningSectors = sectorFlow.filter((s) => s.flow_direction === 'outflow').length;
    const netFlowDirection: 'inflow' | 'outflow' | 'neutral' =
      advancingSectors > decliningSectors + 1
        ? 'inflow'
        : decliningSectors > advancingSectors + 1
        ? 'outflow'
        : 'neutral';

    return NextResponse.json({
      success: true,
      market,
      days,
      generated_at: new Date().toISOString(),
      sector_flow: sectorFlow,
      top_inflow_stocks: topInflow,
      top_outflow_stocks: topOutflow,
      investor_type_estimate: {
        institutional_pct: institutionalPct,
        retail_pct: retailPct,
        block_trades_count: largeBlocks.length,
        avg_trade_value: overallAvgTradeValue,
        large_blocks: largeBlocksSorted,
      },
      summary: {
        total_turnover: Math.round(grandTurnover * 100) / 100,
        total_volume: Math.round(grandVolume),
        net_flow_direction: netFlowDirection,
        advancing_sectors: advancingSectors,
        declining_sectors: decliningSectors,
      },
    });
  } catch (e) {
    console.error('[GET /api/market/liquidity-flow] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        sector_flow: [],
        top_inflow_stocks: [],
        top_outflow_stocks: [],
        investor_type_estimate: null,
        summary: null,
      },
      { status: 500 }
    );
  }
}
