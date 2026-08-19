import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import * as path from 'path';
import { existsSync } from 'fs';

export async function GET() {
  try {
    const newDbPath = path.join(process.cwd(), 'db', 'data_engine_new.db');
    
    if (!existsSync(newDbPath)) {
      return NextResponse.json({ error: 'New database not found' }, { status: 404 });
    }
    
    const db = new Database(newDbPath, { readonly: true });
    
    // Market breakdown
    const marketBreakdown = db.prepare(`
      SELECT 
        market,
        COUNT(*) as count,
        SUM(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) as rising,
        SUM(CASE WHEN change_percent < 0 THEN 1 ELSE 0 END) as falling
      FROM stocks
      GROUP BY market
      ORDER BY count DESC
    `).all() as { market: string; count: number; rising: number; falling: number }[];
    
    // Sample stock with all tabs data
    const sampleStock = db.prepare(`
      SELECT s.*, 
        ta.technical_rating, ta.rsi, ta.macd,
        tp.roe, tp.roa, tp.net_margin,
        tv.pe_ratio, tv.pb_ratio, tv.market_cap,
        td.dps_ttm, td.div_yield
      FROM stocks s
      LEFT JOIN tab_technical_analysis ta ON s.symbol = ta.symbol
      LEFT JOIN tab_profitability tp ON s.symbol = tp.symbol
      LEFT JOIN tab_valuation tv ON s.symbol = tv.symbol
      LEFT JOIN tab_dividends td ON s.symbol = td.symbol
      LIMIT 3
    `).all();
    
    // Count records in each tab table
    const tabCounts: Record<string, number> = {};
    const tabTables = [
      'tab_balance_sheet', 'tab_cash_flow', 'tab_dividends',
      'tab_income_statement', 'tab_performance', 'tab_profitability',
      'tab_technical_analysis', 'tab_valuation'
    ];
    
    for (const table of tabTables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
        tabCounts[table] = row.count;
      } catch {
        tabCounts[table] = 0;
      }
    }
    
    // Check stocks.db
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    let stocksDbStats = null;
    
    if (existsSync(stocksDbPath)) {
      const stocksDb = new Database(stocksDbPath, { readonly: true });
      try {
        const stocksCount = stocksDb.prepare('SELECT COUNT(*) as count FROM stocks').get() as { count: number };
        const stocksCols = stocksDb.prepare('PRAGMA table_info(stocks)').all() as { name: string }[];
        stocksDbStats = {
          count: stocksCount.count,
          columns: stocksCols.map(c => c.name)
        };
      } catch {
        stocksDbStats = { error: 'Could not read stocks table' };
      }
      stocksDb.close();
    }
    
    db.close();
    
    return NextResponse.json({
      new_db: {
        market_breakdown: marketBreakdown,
        tab_counts: tabCounts,
        sample_stocks: sampleStock
      },
      stocks_db: stocksDbStats
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
