/**
 * /api/news/ingest — يستقبل الأخبار المحللة من News Agent المحلي
 * ويحقنها في قاعدة بيانات الأخبار ليستخدمها محرك التوقعات V40.2
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import path from 'path';
import Database from 'better-sqlite3';
import fs from 'fs';

const AGENT_API_KEY = process.env.NEWS_AGENT_API_KEY || 'news_agent_secret_key_2026';

// تأكد من وجود جدول الأخبار في predictions.db
function ensureNewsTable(db: InstanceType<typeof Database>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS news_signals (
      id           TEXT PRIMARY KEY,
      title        TEXT,
      body         TEXT,
      source       TEXT,
      source_type  TEXT DEFAULT 'web',
      url          TEXT,
      published_at TEXT,
      received_at  TEXT DEFAULT (datetime('now')),
      tickers      TEXT DEFAULT '[]',
      importance   INTEGER DEFAULT 0,
      sentiment    TEXT DEFAULT 'neutral',
      impact_type  TEXT DEFAULT 'general',
      summary_ar   TEXT,
      summary_en   TEXT,
      reasoning    TEXT,
      applied      INTEGER DEFAULT 0,
      applied_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ns_tickers    ON news_signals(tickers);
    CREATE INDEX IF NOT EXISTS idx_ns_importance ON news_signals(importance);
    CREATE INDEX IF NOT EXISTS idx_ns_received   ON news_signals(received_at);
    CREATE INDEX IF NOT EXISTS idx_ns_applied    ON news_signals(applied);
  `);
}

export async function POST(request: NextRequest) {
  // ── التحقق من الهوية ──────────────────────────────────────
  // PHASE-FIX: السماح بـ local requests بدون مفتاح صارم
  const agentKey = request.headers.get('x-agent-key') || '';
  if (agentKey !== AGENT_API_KEY) {
    const host = request.headers.get('host') || '';
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1') || host.includes('invist.m2y.net');
    if (!isLocal) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const body = await request.json();
    const { news = [], source = 'unknown' } = body;

    if (!Array.isArray(news) || news.length === 0) {
      return NextResponse.json({ success: false, error: 'No news items' }, { status: 400 });
    }

    // ── فتح predictions.db ────────────────────────────────────
    const predDbPath = path.join(process.cwd(), 'db', 'predictions.db');
    if (!fs.existsSync(predDbPath)) {
      return NextResponse.json({ success: false, error: 'predictions.db not found' }, { status: 500 });
    }

    const db = new Database(predDbPath, { timeout: 5000 });
    db.pragma('busy_timeout = 5000');
    ensureNewsTable(db);

    // ── إدخال الأخبار ─────────────────────────────────────────
    const insert = db.prepare(`
      INSERT INTO news_signals (
        id, title, body, source, source_type, url, published_at,
        tickers, importance, sentiment, impact_type, summary_ar, summary_en, reasoning
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        importance   = MAX(importance, excluded.importance),
        applied      = 0
    `);

    const insertMany = db.transaction((items: any[]) => {
      let accepted = 0;
      for (const item of items) {
        try {
          const result = insert.run(
            item.id || `${Date.now()}_${Math.random().toString(36).slice(2)}`,
            item.title || '',
            (item.body || '').substring(0, 1000),
            item.source || source,
            item.source_type || 'web',
            item.url || '',
            item.published_at || new Date().toISOString(),
            JSON.stringify(item.tickers || []),
            Math.min(100, Math.max(0, item.importance || 0)),
            item.sentiment || 'neutral',
            item.impact_type || 'general',
            item.summary_ar || '',
            item.summary_en || '',
            item.reasoning || ''
          );
          if (result.changes) accepted++;
        } catch (e) {
          // skip duplicate
        }
      }
      return accepted;
    });

    const accepted = insertMany(news);

    // ── إحصائيات سريعة ────────────────────────────────────────
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN applied=0 THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN importance >= 70 THEN 1 ELSE 0 END) as high_importance
      FROM news_signals
      WHERE received_at >= datetime('now', '-24 hours')
    `).get() as any;

    db.close();

    console.log(`[NewsIngest] Received ${news.length} news, accepted ${accepted} from ${source}`);

    return NextResponse.json({
      success:  true,
      accepted,
      rejected: news.length - accepted,
      stats_24h: stats,
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('[NewsIngest] Error:', error?.message);
    return NextResponse.json(
      { success: false, error: error?.message },
      { status: 500 }
    );
  }
}

// ── GET: جلب آخر الأخبار المستقبلة (للـ admin dashboard) ──
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit  = parseInt(searchParams.get('limit') || '20');
    const ticker = searchParams.get('ticker') || '';

    const predDbPath = path.join(process.cwd(), 'db', 'predictions.db');
    if (!fs.existsSync(predDbPath)) {
      return NextResponse.json({ success: true, news: [] });
    }

    const db = new Database(predDbPath, { readonly: true, timeout: 3000 });

    let query = `
      SELECT id, title, source, tickers, importance, sentiment, impact_type,
             summary_ar, received_at, applied
      FROM news_signals
    `;
    const params: any[] = [];

    if (ticker) {
      query += ` WHERE tickers LIKE ?`;
      params.push(`%${ticker}%`);
    }

    query += ` ORDER BY importance DESC, received_at DESC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(query).all(...params);
    db.close();

    return NextResponse.json({
      success: true,
      count:   rows.length,
      news:    rows,
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message }, { status: 500 });
  }
}
