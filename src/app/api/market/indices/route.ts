import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import Database from 'better-sqlite3';
import path from 'path';

const MARKET_NAMES: Record<string, string> = {
  EGX: 'البورصة المصرية', TADAWUL: 'تداول السعودية', KSE: 'بورصة الكويت',
  QSE: 'بورصة قطر', US: 'البورصة الأمريكية', CRYPTO: 'العملات الرقمية',
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = (url.searchParams.get('market') || 'EGX').toUpperCase();
  // FIX-WAVE-3-HIGH / AUDIT-DEEP-4 #8: pagination params (Rule 56)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10), 1), 1000);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);

  // For EGX, try stored indices first
  if (market === 'EGX') {
    try {
      const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
      const db = new Database(dbPath, { readonly: true });
      const totalRow = db.prepare('SELECT COUNT(*) AS c FROM market_indices').get() as { c: number } | undefined;
      const total = totalRow?.c ?? 0;
      const rows = db.prepare('SELECT * FROM market_indices ORDER BY id ASC LIMIT ? OFFSET ?').all(limit, offset);
      db.close();
      if (rows.length > 0) {
        const indices = rows.map((idx: any) => ({
          symbol: idx.symbol || '',
          name: idx.name || '',
          name_ar: idx.name_ar || '',
          value: Number(idx.current_value) || 0,
          previous_close: Number(idx.previous_close) || 0,
          change: Number(idx.change) || 0,
          change_percent: Number(idx.change_percent) || 0,
          last_updated: idx.last_update || null,
        }));
        return NextResponse.json({ indices, total, pagination: { limit, offset, total }, market: 'EGX' });
      }
    } catch {}
  }

  // For non-EGX (or EGX with no stored indices): compute dynamically
  try {
    const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const db = new Database(dbPath, { readonly: true });
    const marketMap: Record<string, string> = {
      EGX: 'EGX', TADAWUL: 'TADAWUL', KSA: 'TADAWUL', KSE: 'KSE',
      QSE: 'QSE', US: 'US', CRYPTO: 'CRYPTO',
    };
    const dbMarket = marketMap[market] || market;

    const stocks = db.prepare(
      "SELECT current_price, volume, change_percent FROM stocks WHERE market = ? COLLATE NOCASE AND current_price > 0 AND volume > 0"
    ).all(dbMarket) as any[];

    db.close();

    if (stocks.length === 0) {
      return NextResponse.json({ indices: [], total: 0, market: dbMarket });
    }

    // Compute weighted composite index
    const totalWeight = stocks.reduce((s, st) => s + (Number(st.current_price) * Number(st.volume)), 0);
    const weightedChange = stocks.reduce((s, st) => s + (Number(st.change_percent || 0) * Number(st.current_price) * Number(st.volume)), 0);
    const indexChangePct = totalWeight > 0 ? weightedChange / totalWeight : 0;
    const avgPrice = stocks.reduce((s, st) => s + Number(st.current_price), 0) / stocks.length;

    const index = {
      symbol: `${dbMarket}_COMPOSITE`,
      name: `${dbMarket} Composite Index`,
      name_ar: `مؤشر ${MARKET_NAMES[dbMarket] || dbMarket} المركّب`,
      value: avgPrice,
      previous_close: avgPrice / (1 + indexChangePct / 100),
      change: avgPrice * indexChangePct / 100,
      change_percent: indexChangePct,
      last_updated: new Date().toISOString(),
    };

    return NextResponse.json({ indices: [index], total: 1, pagination: { limit, offset, total: 1 }, market: dbMarket, source: 'computed' });
  } catch (error) {
    console.error('[GET /api/market/indices] Error:', error);
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500 }
    );
  }
}
