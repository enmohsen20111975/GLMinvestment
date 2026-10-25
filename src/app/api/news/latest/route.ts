/**
 * GET /api/news/latest
 * =====================
 * Lightweight latest-news endpoint (no summary field — client renders title
 * + source + URL only). Mirrors the same `market_news` table used by
 * /api/news and /api/mobile/news.
 *
 * Public (no auth). Designed for landing-page news tickers / push-preview
 * lists on mobile.
 *
 * Query params:
 *   ?limit=N   — default 20, clamped to 1..100
 *   ?market=EGX — optional market filter
 *
 * Returns:
 *   { success, news: [{id, title, source, url, published_at, importance,
 *                       sentiment, market}], total, source, generated_at }
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';

function safeStripHtml(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  if (!raw.includes('<') && !raw.includes('&')) return raw.trim();
  return raw
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const market = searchParams.get('market');
    const reqLimit = parseInt(searchParams.get('limit') || '20', 10);
    const limit =
      Number.isFinite(reqLimit) ? Math.min(Math.max(reqLimit, 1), 100) : 20;

    const dbPath = path.join(process.cwd(), 'db', 'news.db');
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({
        success: true,
        news: [],
        total: 0,
        source: 'sqlite_fallback_empty',
      });
    }

    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
    } catch {
      return NextResponse.json({
        success: true,
        news: [],
        total: 0,
        source: 'sqlite_fallback_empty',
      });
    }

    try {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (market) {
        conditions.push('market = ?');
        params.push(market);
      }
      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

      const rows = db
        .prepare(
          `SELECT id, title, source, url, published_at, fetched_at,
                  importance, sentiment, market
           FROM market_news
           ${where}
           ORDER BY fetched_at DESC
           LIMIT ?`
        )
        .all(...params, limit) as Array<Record<string, unknown>>;

      const totalRow = db
        .prepare(`SELECT COUNT(*) AS c FROM market_news ${where}`)
        .get(...params) as { c: number };

      db.close();

      const news = rows.map((r) => ({
        id: r.id,
        title: safeStripHtml(r.title) || '',
        source: r.source || 'news_agent',
        url: r.url || '',
        published_at:
          (r.published_at as string) || (r.fetched_at as string) || null,
        importance: Number(r.importance) || 0,
        sentiment: r.sentiment || 'neutral',
        market: r.market || 'EGX',
      }));

      return NextResponse.json({
        success: true,
        news,
        total: totalRow.c,
        returned: news.length,
        source: 'news.db',
        generated_at: new Date().toISOString(),
      });
    } catch (queryErr) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      console.error('[news/latest] query error:', queryErr);
      return NextResponse.json({
        success: true,
        news: [],
        total: 0,
        source: 'sqlite_fallback_empty',
      });
    }
  } catch (err) {
    console.error('[news/latest] fatal:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_en: 'internal error',
        news: [],
      },
      { status: 500 }
    );
  }
}
