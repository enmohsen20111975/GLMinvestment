import { NextRequest, NextResponse } from 'next/server';
import { pythonFetch } from '@/lib/python-backend';

export const revalidate = 30; // Cache for 30s

/**
 * Smart Confluence Tab Data API
 * Fetches TradingView tab data (dividends, performance, valuation, etc.) from data_engine.db
 * via Python backend or local fallback
 */
export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol');
  if (!symbol) {
    return NextResponse.json({ success: false, error: 'symbol parameter required' }, { status: 400 });
  }

  // 1) Try Python backend
  try {
    const result = await pythonFetch<any>(
      `/api/smart-confluence/tabs/${encodeURIComponent(symbol)}`,
      { timeout: 15000 }
    );
    if (result.success && result.data) {
      return NextResponse.json({ success: true, source: 'python-backend', data: result.data });
    }
  } catch (err) {
    console.warn(`[smart-confluence/tabs] Python backend unavailable for ${symbol}:`, err);
  }

  // 2) Fallback: try local data_engine.db
  try {
    const Database = (await import('better-sqlite3')).default;
    const path = await import('path');
    const dbPath = path.join(process.cwd(), 'db', 'data_engine.db');
    const db = new Database(dbPath, { readonly: true, timeout: 5000 });

    const tabs: Record<string, any> = {};
    const tabNames = [
      'tab_technical_analysis', 'tab_valuation', 'tab_profitability',
      'tab_dividends', 'tab_performance', 'tab_ownership',
      'tab_balance_sheet', 'tab_income_statement'
    ];

    for (const tab of tabNames) {
      try {
        const row = db.prepare(`SELECT * FROM ${tab} WHERE symbol = ?`).get(symbol);
        tabs[tab] = row || null;
      } catch {
        tabs[tab] = null;
      }
    }

    db.close();
    return NextResponse.json({ success: true, source: 'local-sqlite', data: tabs });
  } catch (err) {
    console.warn(`[smart-confluence/tabs] Local DB failed for ${symbol}:`, err);
  }

  // 3) No data available
  return NextResponse.json({
    success: false,
    source: 'none',
    error: 'No data source available',
    data: null
  });
}
