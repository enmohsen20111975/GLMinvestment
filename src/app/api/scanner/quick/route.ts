/**
 * GET /api/scanner/quick
 * ======================
 * Flutter compat endpoint — scan سريع للأسهم.
 *
 * Query:
 *   ?market=EGX  (default)
 *   ?limit=10    (default, max 50)
 *
 * المصادر:
 *   1. db/screener_lists.json (لو موجود) — قوائم most_active / top_gainers
 *   2. data_engine.db.stocks (fallback) — top gainers + volume spike
 *
 * يرجع: قائمة أسهم مع signal + reason.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDataEngineDb, marketCodeToArabic } from '@/lib/data-engine-db';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SCREENER_LISTS_PATH = path.join(process.cwd(), 'db', 'screener_lists.json');

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

interface ScreenerListEntry {
  rank: number;
  symbol: string;
  name: string;
}

interface ScreenerLists {
  [market: string]: {
    most_active?: ScreenerListEntry[];
    top_gainers?: ScreenerListEntry[];
    top_losers?: ScreenerListEntry[];
    [key: string]: unknown;
  };
}

interface ScanItem {
  ticker: string;
  name: string | null;
  market: string;
  current_price: number;
  change_percent: number;
  volume: number;
  market_cap: number | null;
  signal: 'top_gainer' | 'volume_spike' | 'most_active' | 'momentum';
  reason: string;
  rank?: number;
}

function readScreenerLists(): ScreenerLists | null {
  try {
    if (!existsSync(SCREENER_LISTS_PATH)) return null;
    const raw = readFileSync(SCREENER_LISTS_PATH, 'utf-8');
    return JSON.parse(raw) as ScreenerLists;
  } catch (e) {
    console.warn('[scanner/quick] failed to read screener_lists.json:', e);
    return null;
  }
}

function tryScreenerJson(market: string, limit: number): { items: ScanItem[]; source: string } {
  const lists = readScreenerLists();
  if (!lists) return { items: [], source: 'screener_lists.json not found' };

  // الـ keys ممكن تكون بالعربي (مصر / السعودية / ...)
  const arabicMarket = marketCodeToArabic(market);
  const marketLists = lists[market] || lists[arabicMarket] || lists[market.toUpperCase()];
  if (!marketLists) return { items: [], source: `no screener lists for ${market}` };

  const items: ScanItem[] = [];

  // top_gainers أولاً
  if (Array.isArray(marketLists.top_gainers)) {
    for (const entry of marketLists.top_gainers.slice(0, limit)) {
      items.push({
        ticker: entry.symbol,
        name: entry.name || null,
        market,
        current_price: 0,
        change_percent: 0,
        volume: 0,
        market_cap: null,
        signal: 'top_gainer',
        reason: `Top gainer #${entry.rank}`,
        rank: entry.rank,
      });
    }
  }

  // most_active (لو فيه مساحات متبقية)
  if (Array.isArray(marketLists.most_active) && items.length < limit) {
    const existingTickers = new Set(items.map(i => i.ticker));
    for (const entry of marketLists.most_active.slice(0, limit * 2)) {
      if (existingTickers.has(entry.symbol)) continue;
      items.push({
        ticker: entry.symbol,
        name: entry.name || null,
        market,
        current_price: 0,
        change_percent: 0,
        volume: 0,
        market_cap: null,
        signal: 'most_active',
        reason: `Most active #${entry.rank}`,
        rank: entry.rank,
      });
      if (items.length >= limit) break;
    }
  }

  return {
    items: items.slice(0, limit),
    source: 'screener_lists.json',
  };
}

function tryDataEngineScan(market: string, limit: number): { items: ScanItem[]; source: string } {
  try {
    const db = getDataEngineDb();
    if (!tableExists(db, 'stocks')) {
      return { items: [], source: 'stocks table not found in data_engine.db' };
    }

    const marketArabic = marketCodeToArabic(market);

    // اجمع: top gainers + top volume
    // نقرأ أعلى 200 سهم بالحجم، بعدين نصنفهم
    const rows = db.prepare(`
      SELECT symbol, name, price, change_percent, volume, market_cap
      FROM stocks
      WHERE market = ?
        AND symbol IS NOT NULL
      ORDER BY CAST(volume AS REAL) DESC
      LIMIT 200
    `).all(marketArabic) as Array<{
      symbol: string;
      name: string | null;
      price: number | string | null;
      change_percent: number | string | null;
      volume: number | string | null;
      market_cap: number | string | null;
    }>;

    const items: ScanItem[] = [];
    for (const r of rows) {
      const change = safeNum(r.change_percent);
      const volume = safeNum(r.volume);
      const price = safeNum(r.price);
      const cap = r.market_cap != null ? safeNum(r.market_cap) : null;

      // فلتر: لازم فيه إشارة واضحة
      let signal: ScanItem['signal'] | null = null;
      let reason = '';

      if (change >= 5) {
        signal = 'top_gainer';
        reason = `تغير +${change.toFixed(1)}%`;
      } else if (change <= -5) {
        signal = 'most_active';
        reason = `تغير ${change.toFixed(1)}% (نشاط بيعي قوي)`;
      } else if (volume >= 1_000_000 && change >= 2) {
        signal = 'volume_spike';
        reason = `حجم قوي ${volume.toLocaleString()} + ${change.toFixed(1)}%`;
      } else if (change >= 3) {
        signal = 'momentum';
        reason = `momentum +${change.toFixed(1)}%`;
      }

      if (!signal) continue;

      items.push({
        ticker: r.symbol,
        name: r.name,
        market,
        current_price: Math.round(price * 100) / 100,
        change_percent: Math.round(change * 100) / 100,
        volume: Math.round(volume),
        market_cap: cap,
        signal,
        reason,
      });

      if (items.length >= limit) break;
    }

    // رتّب: top_gainer أولاً، بعدين volume_spike، بعدين most_active، بعدين momentum
    const priority: Record<string, number> = { top_gainer: 1, volume_spike: 2, most_active: 3, momentum: 4 };
    items.sort((a, b) => {
      const pa = priority[a.signal] || 99;
      const pb = priority[b.signal] || 99;
      if (pa !== pb) return pa - pb;
      return Math.abs(b.change_percent) - Math.abs(a.change_percent);
    });

    return {
      items: items.slice(0, limit),
      source: 'data_engine.db.stocks',
    };
  } catch (e) {
    console.warn('[scanner/quick] data_engine scan failed:', e);
    return { items: [], source: 'data_engine error: ' + String(e) };
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const market = (url.searchParams.get('market') || 'EGX').toUpperCase();
    const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get('limit') || '10', 10) || 10));

    // 1) جرّب screener_lists.json أولاً (أسرع)
    let result = tryScreenerJson(market, limit);

    // 2) fallback لـ data_engine.db
    if (result.items.length === 0) {
      result = tryDataEngineScan(market, limit);
    }

    // enrich بالأسعار من data_engine.db (لو items جاية من screener_lists.json)
    if (result.source.startsWith('screener_lists') && result.items.length > 0) {
      try {
        const db = getDataEngineDb();
        if (tableExists(db, 'stocks')) {
          const marketArabic = marketCodeToArabic(market);
          for (const item of result.items) {
            try {
              const row = db.prepare(`
                SELECT price, change_percent, volume, market_cap
                FROM stocks
                WHERE symbol = ? AND market = ?
                LIMIT 1
              `).get(item.ticker, marketArabic) as {
                price: number | string | null;
                change_percent: number | string | null;
                volume: number | string | null;
                market_cap: number | string | null;
              } | undefined;
              if (row) {
                item.current_price = Math.round(safeNum(row.price) * 100) / 100;
                item.change_percent = Math.round(safeNum(row.change_percent) * 100) / 100;
                item.volume = Math.round(safeNum(row.volume));
                item.market_cap = row.market_cap != null ? safeNum(row.market_cap) : null;
              }
            } catch { /* skip */ }
          }
        }
      } catch (e) {
        console.warn('[scanner/quick] enrich failed:', e);
      }
    }

    return NextResponse.json({
      success: true,
      market,
      source: result.source,
      items: result.items,
      count: result.items.length,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/scanner/quick] Error:', e);
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
