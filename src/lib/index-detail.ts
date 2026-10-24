/**
 * index-detail.ts — Shared server helpers for index history + constituent breakdown.
 *
 * Single source of truth for:
 *  - readIndexHistory(symbol, period) → OHLCV + stats from index_daily_prices
 *  - computeConstituentBreakdown(symbol) → per-stock contribution to today's index move
 *  - Period→days mapping, symbol→canonical-key mapping, weight renormalization
 *
 * No copy-paste: both API routes + the sparkline route can delegate here.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { readFile } from 'fs/promises';

const PROJECT_ROOT = process.cwd();
const STOCKS_DB = path.join(PROJECT_ROOT, 'db', 'stocks.db');
const CANONICAL_FILE = path.join(PROJECT_ROOT, 'vps-service', 'data', 'canonical_indices.json');

export const PERIOD_DAYS: Record<string, number> = {
  '1W': 7, '1M': 30, '3M': 90, '6M': 126, '1Y': 252, 'ALL': 9999,
};

/** Map DB symbol (EGX70) → canonical_indices.json key (EGX70_EWI). */
export function mapSymbolToCanonicalKey(symbol: string): string {
  const map: Record<string, string> = {
    'EGX30': 'EGX30',
    'EGX33': 'EGX33_SHARIAH',
    'EGX70': 'EGX70_EWI',
    'EGX100': 'EGX100_EWI',
  };
  return map[symbol] || symbol;
}

export interface IndexBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  change_pct: number;
}

export interface IndexStats {
  open: number;
  high: number;
  low: number;
  last: number;
  period_change_pct: number;
  ytd_change_pct: number;
}

export interface ConstituentContribution {
  code: string;
  name_ar: string;
  sector: string;
  weight: number;
  change_pct: number;
  contribution: number; // weight * change_pct / 100 → index points dragged
  direction: 'up' | 'down' | 'flat';
}

let _canonicalCache: any = null;
async function loadCanonical(): Promise<any> {
  if (_canonicalCache) return _canonicalCache;
  try {
    const raw = await readFile(CANONICAL_FILE, 'utf-8');
    _canonicalCache = JSON.parse(raw);
    return _canonicalCache;
  } catch {
    return {};
  }
}

/** Read index OHLCV history for a given period. */
export function readIndexHistory(symbol: string, period: string = '1M'): { series: IndexBar[]; stats: IndexStats | null } {
  const days = PERIOD_DAYS[period] || 30;
  let db: Database.Database;
  try {
    db = new Database(STOCKS_DB, { readonly: true, timeout: 3000 });
  } catch {
    return { series: [], stats: null };
  }

  try {
    const rows = db.prepare(`
      SELECT price_date, open, high, low, close, change_percent
      FROM index_daily_prices
      WHERE symbol = ? AND close > 0
      ORDER BY price_date DESC LIMIT ?
    `).all(symbol, days) as any[];

    if (!rows || rows.length === 0) {
      db.close();
      return { series: [], stats: null };
    }

    // Reverse to chronological order
    const series: IndexBar[] = rows.reverse().map((r) => ({
      date: r.price_date,
      open: r.open || r.close,
      high: r.high || r.close,
      low: r.low || r.close,
      close: r.close,
      change_pct: r.change_percent || 0,
    }));

    const first = series[0];
    const last = series[series.length - 1];
    const periodChange = first.close > 0 ? ((last.close - first.close) / first.close) * 100 : 0;

    // YTD: find first row of the year
    const year = last.date.substring(0, 4);
    const ytdRow = db.prepare(`
      SELECT close FROM index_daily_prices
      WHERE symbol = ? AND close > 0 AND price_date >= ? || '-01-01'
      ORDER BY price_date ASC LIMIT 1
    `).get(symbol, year) as any;

    const ytdChange = ytdRow && ytdRow.close > 0
      ? ((last.close - ytdRow.close) / ytdRow.close) * 100
      : periodChange;

    db.close();

    return {
      series,
      stats: {
        open: first.close,
        high: Math.max(...series.map(s => s.high)),
        low: Math.min(...series.map(s => s.low)),
        last: last.close,
        period_change_pct: periodChange,
        ytd_change_pct: ytdChange,
      },
    };
  } catch {
    db.close();
    return { series: [], stats: null };
  }
}

/** Compute per-constituent contribution to today's index movement. */
export async function computeConstituentBreakdown(symbol: string): Promise<{
  constituents: ConstituentContribution[];
  summary: { total_positive: number; total_negative: number; net: number; gainers: number; losers: number };
  index_value: number;
  index_change_pct: number;
} | null> {
  const canonical = await loadCanonical();
  const key = mapSymbolToCanonicalKey(symbol);
  const idxData = canonical[key];
  if (!idxData || !idxData.constituents) return null;

  const constituents = idxData.constituents as Array<{ code: string; weight: number; sector?: string; name_ar?: string }>;

  let db: Database.Database;
  try {
    db = new Database(STOCKS_DB, { readonly: true, timeout: 3000 });
  } catch {
    return null;
  }

  try {
    // Get live value + change from market_indices
    const liveRow = db.prepare(`
      SELECT current_value, change_percent FROM market_indices WHERE symbol = ?
    `).get(symbol) as any;
    const indexValue = liveRow?.current_value || 0;
    const indexChangePct = liveRow?.change_percent || 0;

    const result: ConstituentContribution[] = [];
    let totalPositive = 0, totalNegative = 0, gainers = 0, losers = 0;

    // Calculate weight per stock (for EWI, weight = 100/N)
    const isEWI = key.includes('EWI');
    const ewiWeight = isEWI && constituents.length > 0 ? 100 / constituents.length : 0;

    for (const c of constituents) {
      const ticker = c.code;
      const weight = isEWI ? ewiWeight : (c.weight || 0);

      // Get stock price + change
      const stockRow = db.prepare(`
        SELECT current_price, previous_close, change_percent, name, name_ar
        FROM stocks WHERE ticker = ?
      `).get(ticker) as any;

      if (!stockRow) continue;

      let changePct = stockRow.change_percent;
      if (changePct == null && stockRow.previous_close && stockRow.previous_close > 0 && stockRow.current_price) {
        changePct = ((stockRow.current_price - stockRow.previous_close) / stockRow.previous_close) * 100;
      }
      if (changePct == null) changePct = 0;

      const contribution = (weight * changePct) / 100;
      const direction = changePct > 0.01 ? 'up' : changePct < -0.01 ? 'down' : 'flat';

      if (contribution > 0) { totalPositive += contribution; gainers++; }
      else if (contribution < 0) { totalNegative += contribution; losers++; }

      result.push({
        code: ticker,
        name_ar: stockRow.name_ar || stockRow.name || ticker,
        sector: c.sector || '',
        weight,
        change_pct: changePct,
        contribution,
        direction,
      });
    }

    db.close();

    // Sort by abs(contribution) desc
    result.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    return {
      constituents: result,
      summary: {
        total_positive: totalPositive,
        total_negative: totalNegative,
        net: totalPositive + totalNegative,
        gainers,
        losers,
      },
      index_value: indexValue,
      index_change_pct: indexChangePct,
    };
  } catch (e) {
    db.close();
    return null;
  }
}
