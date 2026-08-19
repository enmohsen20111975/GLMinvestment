import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const market = searchParams.get('market');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    const dbPath = path.join(process.cwd(), 'data-engine', 'data', 'data_engine.db');
    const db = new Database(dbPath, { readonly: true });

    let query = 'SELECT * FROM market_news';
    const params: any[] = [];

    if (market) {
      query += ' WHERE market = ?';
      params.push(market);
    }

    query += ` ORDER BY fetched_at DESC LIMIT ${limit} OFFSET ${offset}`;

    const news = db.prepare(query).all(...params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM market_news';
    if (market) {
      countQuery += ' WHERE market = ?';
    }
    const countParams = market ? [market] : [];
    const total = db.prepare(countQuery).get(...countParams) as { count: number };

    // Get markets list
    const markets = db.prepare('SELECT DISTINCT market FROM market_news').all() as { market: string }[];

    db.close();

    return NextResponse.json({
      news,
      total: total.count,
      markets: markets.map(m => m.market)
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
