import { NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import Database from 'better-sqlite3';
import path from 'path';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get('tab') || 'performance';
    const market = searchParams.get('market');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const validTabs = ['performance', 'valuation', 'dividends', 'profitability', 
                       'income_statement', 'balance_sheet', 'cash_flow', 'technical_analysis'];
    
    if (!validTabs.includes(tab)) {
      return NextResponse.json({ error: 'Invalid tab name' }, { status: 400 });
    }

    const tableName = `tab_${tab}`;
    const dbPath = path.join(process.cwd(), 'data-engine', 'data', 'data_engine.db');
    const db = new Database(dbPath, { readonly: true });

    // Get columns
    const columnsInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
    const columns = columnsInfo.map(c => c.name);

    // Get data
    let query = `SELECT * FROM ${tableName}`;
    const params: any[] = [];

    if (market) {
      query += ' WHERE market = ?';
      params.push(market);
    }

    query += ` ORDER BY id LIMIT ${limit} OFFSET ${offset}`;

    const data = db.prepare(query).all(...params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as count FROM ${tableName}`;
    if (market) {
      countQuery += ' WHERE market = ?';
    }
    const countParams = market ? [market] : [];
    const total = db.prepare(countQuery).get(...countParams) as { count: number };

    db.close();

    return NextResponse.json({
      tab,
      columns,
      data,
      total: total.count
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
