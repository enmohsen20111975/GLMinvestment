import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

/**
 * GET /api/news — reads market_news from data_engine.db (existing behavior)
 */
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

    let countQuery = 'SELECT COUNT(*) as count FROM market_news';
    if (market) {
      countQuery += ' WHERE market = ?';
    }
    const countParams = market ? [market] : [];
    const total = db.prepare(countQuery).get(...countParams) as { count: number };

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

/**
 * POST /api/news — receives news from local News Agent (telegram/rss/web)
 *
 * Forwards to Python backend: POST http://localhost:8010/api/news/agent
 *
 * Expected payload (from local News Agent):
 *   title: string (required)
 *   content: string
 *   summary_ar: string
 *   summary_en: string
 *   source: string
 *   source_type: "telegram" | "rss" | "web"
 *   url: string
 *   tickers: string[]  e.g. ["COMI", "TMGH"]
 *   importance: number 0-100
 *   sentiment: "bullish" | "bearish" | "neutral"
 *   impact_type: "earnings" | "macro" | "market"
 *   market: "EGX" | "NASDAQ" | "global"
 *   image_paths: string[]
 *   ocr_text: string
 *   raw_analysis: object
 *   published_at: ISO date string
 *
 * Auth: X-News-Agent-Key header (optional in dev, required if NEWS_AGENT_API_KEY set in Python)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required field
    if (!body.title) {
      return NextResponse.json(
        { success: false, error: 'title is required' },
        { status: 400 }
      );
    }

    // Forward to Python backend
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Forward auth key if present
    const agentKey = request.headers.get('X-News-Agent-Key');
    if (agentKey) {
      headers['X-News-Agent-Key'] = agentKey;
    }

    const pythonResponse = await fetch(`${BACKEND_URL}/api/news/agent`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const result = await pythonResponse.json();

    if (!pythonResponse.ok) {
      return NextResponse.json(result, { status: pythonResponse.status });
    }

    return NextResponse.json(result, { status: 201 });

  } catch (error: any) {
    // If Python backend is not running, return helpful error
    if (error.cause?.code === 'ECONNREFUSED') {
      return NextResponse.json(
        {
          success: false,
          error: 'Python backend not running on ' + BACKEND_URL,
          hint: 'Start it: cd vps-service && python3 lightweight_server.py',
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
