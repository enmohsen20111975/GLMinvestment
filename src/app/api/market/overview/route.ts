/**
 * GET /api/market/overview
 * =========================
 * P0-FIX: fallback to SQLite when Python backend is down.
 * Reads from stocks.db directly — no mock data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMarketIndices } from '@/lib/egx-db';
import type Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = url.searchParams.get('market') || 'EGX';

  // 1) Try Python first
  try {
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/market/overview${qs ? `?${qs}` : ''}`;
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-store' },
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {}

  // 2) Fallback — read from stocks.db
  try {
    const path = require('path');
    const fs = require('fs');
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (!fs.existsSync(stocksDbPath)) {
      return NextResponse.json({ success: false, error: 'stocks.db not found' }, { status: 500 });
    }
    const Database = require('better-sqlite3');
    const db: Database.Database = new Database(stocksDbPath, { readonly: true });

    const marketMap: Record<string, string> = {
      EGX: 'EGX', TADAWUL: 'TADAWUL', KSA: 'TADAWUL',
      KSE: 'KSE', QSE: 'QSE', US: 'US', CRYPTO: 'CRYPTO',
    };
    const dbMarket = marketMap[market.toUpperCase()] || 'EGX';

    // اكتشف الأعمدة المتاحة في stocks table (الـ schema ممكن يختلف بين الإنتاج والـ init)
    const tableInfo = db.prepare('PRAGMA table_info(stocks)').all() as Array<{ name: string }>;
    const colNames = new Set(tableInfo.map(c => c.name));
    const hasChangePercent = colNames.has('change_percent');
    const hasValueTraded = colNames.has('value_traded') || colNames.has('turnover_egp');

    // ابني الـ SELECT حسب الأعمدة المتاحة
    const selectCols = [
      'ticker', 'name_ar', 'name', 'current_price', 'previous_close', 'volume', 'sector',
      ...(hasChangePercent ? ['change_percent'] : []),
      ...(hasValueTraded ? (colNames.has('value_traded') ? ['value_traded'] : ['turnover_egp']) : []),
    ].filter(c => colNames.has(c));

    const stocks = db.prepare(`
      SELECT ${selectCols.join(', ')} FROM stocks WHERE market = ? COLLATE NOCASE
      ORDER BY volume DESC LIMIT 50
    `).all(dbMarket);

    // احسب change_percent لكل سهم لو مفيش column
    type StockRow = {
      ticker?: string;
      name_ar?: string;
      name?: string;
      current_price?: number | string | null;
      previous_close?: number | string | null;
      volume?: number | string | null;
      sector?: string | null;
      change_percent?: number | string | null;
      value_traded?: number | string | null;
      turnover_egp?: number | string | null;
    };
    const stocksWithChange = (stocks as StockRow[]).map((s) => {
      if (hasChangePercent && s.change_percent != null) return s;
      const curr = Number(s.current_price) || 0;
      const prev = Number(s.previous_close) || 0;
      s.change_percent = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
      return s;
    });

    const advancing = stocksWithChange.filter((s) => Number(s.change_percent) > 0).length;
    const declining = stocksWithChange.filter((s) => Number(s.change_percent) < 0).length;
    const unchanged = stocksWithChange.length - advancing - declining;
    const totalVolume = stocksWithChange.reduce((sum, s) => sum + Number(s.volume || 0), 0);
    const totalTurnover = stocksWithChange.reduce((sum, s) => sum + (Number(s.current_price || 0) * Number(s.volume || 0)), 0);

    // Market indices — استخدم getMarketIndices() المصحّحة (تعيد حساب change/change_percent
    // من الأسهم المكوّنة بشكل صحيح ومتّسق، بدل القيم الخاطئة المخزّنة في الجدول)
    let indices: Array<{ symbol?: string; name_ar?: string; value?: number | null; previous_close?: number | null; change?: number | null; change_percent?: number | null }> = [];
    try {
      const allIndices = getMarketIndices();
      const marketPrefix = dbMarket; // e.g. 'EGX'
      indices = allIndices
        .filter((idx) => String(idx.symbol || '').toUpperCase().includes(marketPrefix))
        .slice(0, 5)
        .map((idx) => ({
          symbol: idx.symbol,
          name_ar: idx.name_ar,
          value: idx.current_value, // المتجر يتوقع `value` (موافق لـ market/indices)
          previous_close: idx.previous_close,
          change: idx.change,
          change_percent: idx.change_percent,
        }));
    } catch {}

    db.close();

    return NextResponse.json({
      success: true,
      market,
      summary: {
        total_stocks: stocksWithChange.length,
        advancing,
        declining,
        unchanged,
        total_volume: totalVolume,
        total_turnover: totalTurnover,
      },
      indices,
      top_stocks: stocksWithChange.slice(0, 10),
      source: 'sqlite_fallback',
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 500 });
  }
}
