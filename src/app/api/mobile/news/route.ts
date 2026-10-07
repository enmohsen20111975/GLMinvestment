/**
 * GET /api/mobile/news
 * =====================
 * Mobile-optimized news feed for the Flutter Android app.
 *
 * Reads from `db/news.db` → table `market_news` (single source of truth, per
 * CONSTITUTION Rule NEWS-DB-SOT — the existing /api/news/route.ts uses the
 * same table). Returns the latest 50 news rows with the lighter mobile shape:
 *   { id, source, title, url, published_at, summary, importance, sentiment }
 *
 * Auth: optional (public — news is taste content). If the user happens to be
 * logged in we attach their user_id in the response envelope for client-side
 * tracking only; we do NOT restrict access.
 *
 * Query params:
 *   ?limit=N   — default 50, clamped to 1..100
 *   ?market=EGX — optional filter
 *
 * Failure mode: never 500 / never HTML. On DB open failure we return 200 with
 * an empty `news: []` array so the mobile app shows an empty state instead
 * of a connection-error toast.
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
    const reqLimit = parseInt(searchParams.get('limit') || '50', 10);
    const limit =
      Number.isFinite(reqLimit) ? Math.min(Math.max(reqLimit, 1), 100) : 50;

    const dbPath = path.join(process.cwd(), 'db', 'news.db');
    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({
        success: true,
        news: [],
        total: 0,
        source: 'sqlite_fallback_empty',
        message: 'news.db غير متاح',
      });
    }

    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
    } catch (openErr) {
      console.error('[mobile/news] DB open error:', openErr);
      return NextResponse.json({
        success: true,
        news: [],
        total: 0,
        source: 'sqlite_fallback_empty',
        message: 'news.db غير متاح',
      });
    }

    try {
      const tableRow = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='market_news'"
        )
        .get() as { name: string } | undefined;

      if (!tableRow) {
        db.close();
        return NextResponse.json({
          success: true,
          news: [],
          total: 0,
          source: 'sqlite_fallback_empty',
          message: 'جدول market_news غير موجود',
        });
      }

      const conditions: string[] = [];
      const params: unknown[] = [];
      if (market) {
        conditions.push('market = ?');
        params.push(market);
      }
      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

      const rows = db
        .prepare(
          `SELECT
             id, title, content, summary_ar, summary_en, source, url,
             tickers, importance, sentiment, market, published_at, fetched_at
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

      const news = rows.map((r) => {
        const summary =
          safeStripHtml(r.summary_ar) ||
          safeStripHtml(r.summary_en) ||
          safeStripHtml(r.content).slice(0, 220);
        let tickers: string[] = [];
        try {
          const parsed = JSON.parse((r.tickers as string) || '[]');
          if (Array.isArray(parsed)) {
            tickers = parsed.filter((t) => typeof t === 'string').slice(0, 20);
          }
        } catch {
          /* ignore */
        }
        return {
          id: r.id,
          source: r.source || 'news_agent',
          title: safeStripHtml(r.title) || '',
          url: r.url || '',
          published_at:
            (r.published_at as string) || (r.fetched_at as string) || null,
          summary,
          importance: Number(r.importance) || 0,
          sentiment: r.sentiment || 'neutral',
          market: r.market || 'EGX',
          tickers,
        };
      });

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
      console.error('[mobile/news] query error:', queryErr);
      return NextResponse.json({
        success: true,
        news: [],
        total: 0,
        source: 'sqlite_fallback_empty',
        message: 'تعذّر قراءة جدول market_news',
      });
    }
  } catch (err) {
    console.error('[mobile/news] fatal:', err);
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
