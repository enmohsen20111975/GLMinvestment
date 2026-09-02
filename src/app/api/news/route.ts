import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// DB_PATH: news.db is the SINGLE SOURCE OF TRUTH for news (CONSTITUTION Rule: NEWS-DB-SOT).
// news.db → market_news table holds all news (from News Agent + legacy news_articles merged 2026-09-02).
const DB_PATH = path.join(process.cwd(), 'db', 'news.db');
const BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';
const AGENT_API_KEY = process.env.NEWS_AGENT_API_KEY || process.env.PRODUCTION_API_KEY;

function isAuthorized(request: Request) {
  if (!AGENT_API_KEY) return true; // Optional in dev if not set
  const agentKey = request.headers.get('x-agent-key') || request.headers.get('X-News-Agent-Key') || '';
  return agentKey === AGENT_API_KEY;
}

function ensureNewsTable(db: InstanceType<typeof Database>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      summary_ar TEXT,
      summary_en TEXT,
      source TEXT DEFAULT 'news_agent',
      source_type TEXT DEFAULT 'telegram',
      url TEXT,
      tickers TEXT DEFAULT '[]',
      importance INTEGER DEFAULT 0,
      sentiment TEXT DEFAULT 'neutral',
      impact_type TEXT DEFAULT 'general',
      market TEXT DEFAULT 'EGX',
      image_paths TEXT DEFAULT '[]',
      ocr_text TEXT DEFAULT '',
      raw_analysis TEXT DEFAULT '{}',
      published_at TEXT,
      fetched_at TEXT DEFAULT (datetime('now')),
      sent_at TEXT,
      is_sent INTEGER DEFAULT 0,
      UNIQUE(title, source)
    )
  `);
}

/**
 * GET /api/news — reads market_news from news.db (single source of truth)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const market = searchParams.get('market');
    const requestedLimit = Number.parseInt(searchParams.get('limit') || '20', 10);
    const requestedOffset = Number.parseInt(searchParams.get('offset') || '0', 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20;
    const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;

    const db = new Database(DB_PATH, { readonly: true });

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
      markets: markets.map(m => m.market),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/news — receives news from local News Agent (telegram/rss/web)
 * Stores in news.db (immediate display) and forwards to Python backend (for V40.2 impact scoring)
 */
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      title,
      content,
      summary_ar,
      summary_en,
      source,
      source_type,
      url,
      tickers,
      importance,
      sentiment,
      impact_type,
      market,
      image_paths,
      ocr_text,
      raw_analysis,
      published_at,
    } = body;

    if (!title) {
      return NextResponse.json({ ok: false, error: 'title is required' }, { status: 400 });
    }

    // 1. Direct persistent save to news.db
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH);
    ensureNewsTable(db);

    const result = db.prepare(`
      INSERT OR IGNORE INTO market_news
      (title, content, summary_ar, summary_en, source, source_type, url, tickers, importance, sentiment, impact_type, market, image_paths, ocr_text, raw_analysis, published_at, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      title,
      content || '',
      summary_ar || '',
      summary_en || '',
      source || 'news_agent',
      source_type || 'telegram',
      url || '',
      JSON.stringify(tickers || []),
      importance || 0,
      sentiment || 'neutral',
      impact_type || 'general',
      market || 'EGX',
      JSON.stringify(image_paths || []),
      ocr_text || '',
      JSON.stringify(raw_analysis || {}),
      published_at || new Date().toISOString(),
    );

    db.close();

    // 2. Non-blocking forward to Python backend if reachable (for V40.2 scoring)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const agentKey = request.headers.get('x-agent-key') || request.headers.get('X-News-Agent-Key');
      if (agentKey) headers['X-News-Agent-Key'] = agentKey;

      fetch(`${BACKEND_URL}/api/news/agent`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }).catch(() => {});
    } catch {}

    if (result.changes === 0) {
      return NextResponse.json({ ok: true, success: true, message: 'خبر مكرر - تم تجاهله', duplicate: true });
    }

    return NextResponse.json({
      ok: true,
      success: true,
      message: 'تم إضافة الخبر للموقع بنجاح',
      id: result.lastInsertRowid,
    }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ ok: false, success: false, error: error.message }, { status: 500 });
  }
}
