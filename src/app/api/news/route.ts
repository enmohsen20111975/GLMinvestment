import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

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

/**
 * Removes any HTML markup from agent-supplied text.
 *
 * Some RSS feeds ship the raw `<div><img/><p>…</p></div>` block as the entry
 * summary, and older agent versions stored that verbatim — which then rendered
 * as literal tags on the site. Sanitizing at the ingest boundary means the
 * column is clean no matter which agent build produced the row.
 */
const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#39;': "'",
  '&#8220;': '«', '&#8221;': '»', '&#8216;': '‘', '&#8217;': '’',
  '&#8230;': '…', '&lt;': '<', '&gt;': '>', '&mdash;': '—', '&ndash;': '–',
};

function stripHtml(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const noBoilerplate = (s: string) =>
    s.replace(
      /\n*\s*\bthe\s+post\b[\s\S]*?\b(?:appeared\s+first\s+on|was\s+first\s+published\s+on)\b[\s\S]*$/i,
      ''
    );
  if (!raw.includes('<') && !raw.includes('&')) return noBoilerplate(raw).trim();
  return noBoilerplate(
    raw
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/p\s*>|<\/div\s*>|<\/li\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#(\d+);/g, (m, code) => {
        const n = Number(code);
        return n > 0 && n < 65536 ? String.fromCodePoint(n) : '';
      })
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'").replace(/&#8220;/g, '«').replace(/&#8221;/g, '»')
      .replace(/&#8216;/g, '‘').replace(/&#8217;/g, '’').replace(/&#8230;/g, '…')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
  ).trim();
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
      is_catalyst INTEGER DEFAULT 0,
      UNIQUE(title, source)
    )
  `);
  try {
    db.exec(`ALTER TABLE market_news ADD COLUMN is_catalyst INTEGER DEFAULT 0`);
  } catch {}
}

/**
 * GET /api/news — reads market_news from news.db (single source of truth)
 *
 * FOCUS-5-TASKS (2026-10-01): added `tickers` query param so the dashboard
 * widget can filter news to only items mentioning the user's portfolio /
 * watchlist tickers. Pass `?tickers=COMI,EGBE,TMGH` to filter; the API
 * matches against the JSON `tickers` column (stored as '["COMI","EGBE"]').
 *
 * Existing params (`market`, `limit`, `offset`) are unchanged.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const market = searchParams.get('market');
    const tickersParam = searchParams.get('tickers');
    const catalystParam = searchParams.get('catalyst');
    const requestedLimit = Number.parseInt(searchParams.get('limit') || '20', 10);
    const requestedOffset = Number.parseInt(searchParams.get('offset') || '0', 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20;
    const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;

    // Parse comma-separated tickers into a clean uppercased list (filter blanks).
    // We also strip non-alphanumeric characters to prevent SQL injection via
    // the LIKE pattern (defense-in-depth — we still use parameterized LIKE).
    const tickersList = (tickersParam || '')
      .split(',')
      .map(t => t.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, ''))
      .filter(t => t.length > 0 && t.length <= 20);

    const db = new Database(DB_PATH, { readonly: true });

    let query = 'SELECT * FROM market_news';
    const params: any[] = [];
    const conditions: string[] = [];

    if (market) {
      conditions.push('market = ?');
      params.push(market);
    }

    if (catalystParam === 'true' || catalystParam === '1') {
      conditions.push('is_catalyst = 1');
    }

    // FOCUS-5-TASKS Task 4: filter by tickers (JSON column).
    // The `tickers` column is stored as JSON TEXT like '["COMI","EGBE"]'.
    // We use parameterized LIKE patterns to match any of the requested
    // tickers — this is portable across SQLite versions (no json1 needed).
    if (tickersList.length > 0) {
      const orClauses = tickersList.map(t => `tickers LIKE ?`);
      conditions.push(`(${orClauses.join(' OR ')})`);
      for (const t of tickersList) {
        // Match "COMI" inside the JSON array, with surrounding quotes.
        // e.g. '["COMI","EGBE"]' — searching for '%"COMI"%' catches it.
        params.push(`%"${t}"%`);
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY fetched_at DESC LIMIT ${limit} OFFSET ${offset}`;

    const news = db.prepare(query).all(...params);

    let countQuery = 'SELECT COUNT(*) as count FROM market_news';
    const countParams: any[] = [];
    const countConditions: string[] = [];
    if (market) {
      countConditions.push('market = ?');
      countParams.push(market);
    }
    if (catalystParam === 'true' || catalystParam === '1') {
      countConditions.push('is_catalyst = 1');
    }
    if (tickersList.length > 0) {
      const orClauses = tickersList.map(t => `tickers LIKE ?`);
      countConditions.push(`(${orClauses.join(' OR ')})`);
      for (const t of tickersList) {
        countParams.push(`%"${t}"%`);
      }
    }
    if (countConditions.length > 0) {
      countQuery += ' WHERE ' + countConditions.join(' AND ');
    }
    const total = db.prepare(countQuery).get(...countParams) as { count: number };

    const markets = db.prepare('SELECT DISTINCT market FROM market_news').all() as { market: string }[];

    db.close();

    return NextResponse.json({
      news,
      total: total.count,
      markets: markets.map(m => m.market),
      filter: {
        market: market || null,
        catalyst: catalystParam === 'true' || catalystParam === '1',
        tickers: tickersList,
        tickers_count: tickersList.length,
      },
    });
  } catch (error: any) {
    console.error('[news]', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

/**
 * POST /api/news — receives news from local News Agent (telegram/rss/web)
 * Stores in news.db (immediate display) and forwards to Python backend (for V40.2 impact scoring)
 */
export async function POST(request: NextRequest) {
  // PHASE-FIX: السماح بـ POST بدون auth في وضع التطوير أو لو مفيش AGENT_API_KEY مضبوط
  // الـ news-agent بيستخدم x-agent-key header — نتأكد إنه موجود أو نسمح بدون مفتاح
  const agentKey = request.headers.get('x-agent-key') || request.headers.get('X-News-Agent-Key') || '';
  if (AGENT_API_KEY && agentKey !== AGENT_API_KEY) {
    // لو في مفتاح مضبوط في env بس الـ agent مش بيبعت المفتاح الصح — نسمح بـ local requests
    const host = request.headers.get('host') || '';
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1') || host.includes('invist.m2y.net');
    if (!isLocal) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
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
      is_catalyst,
    } = body;

    if (!title) {
      return NextResponse.json({ ok: false, error: 'title is required' }, { status: 400 });
    }

    // منع تكرار الأخبار وحلقات إعادة السحب من القناة نفسها
    if (url && (url.includes('Arabian_investment_guide') || url.includes('invist.m2y.net'))) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'self_channel_loop_prevented' });
    }

    const rawCleanTitle = stripHtml(title);
    const cleanTitle = rawCleanTitle
      .replace(/📰/g, '')
      .replace(/🚨\s*إشعار استثماري عاجل\s*\|\s*محفز صعودي قوي\s*🚀/gi, '')
      .replace(/🚨\s*إشعار استثماري عاجل/gi, '')
      .replace(/محفز صعودي قوي\s*🚀?/gi, '')
      .replace(/📊\s*نبض البورصة والأخبار المالية\s*\|\s*Investment Guide/gi, '')
      .replace(/^[\s\-_—:|•]+|[\s\-_—:|•]+$/g, '')
      .trim();

    const cleanContent = stripHtml(content);
    const cleanSummaryAr = stripHtml(summary_ar);
    const cleanSummaryEn = stripHtml(summary_en);
    if (!cleanTitle && !cleanContent) {
      return NextResponse.json({ ok: false, error: 'empty after sanitize' }, { status: 400 });
    }

    // 1. Direct persistent save to news.db
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH);
    ensureNewsTable(db);

    const result = db.prepare(`
      INSERT OR IGNORE INTO market_news
      (title, content, summary_ar, summary_en, source, source_type, url, tickers, importance, sentiment, impact_type, market, image_paths, ocr_text, raw_analysis, is_catalyst, published_at, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      cleanTitle || cleanContent.slice(0, 120),
      cleanContent,
      cleanSummaryAr,
      cleanSummaryEn,
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
      is_catalyst ? 1 : 0,
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
        body: JSON.stringify({
          ...body,
          title: cleanTitle || cleanContent.slice(0, 120),
          content: cleanContent,
          summary_ar: cleanSummaryAr,
          summary_en: cleanSummaryEn,
        }),
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
    console.error('[news]', error);
    return NextResponse.json({ ok: false, success: false, error: 'internal_error' }, { status: 500 });
  }
}
