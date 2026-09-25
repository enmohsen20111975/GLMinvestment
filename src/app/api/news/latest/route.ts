/**
 * GET /api/news/latest
 * =====================
 * Flutter compat endpoint — آخر الأخبار.
 *
 * Query:
 *   ?limit=20   (default, max 100)
 *   ?market=EGX (optional)
 *
 * المصادر بالترتيب:
 *   1. news.db.market_news                (المصدر الأساسي — NEWS-DB-SOT)
 *   2. stocks.db.news / news_items / telegram_news (fallback)
 *
 * Returns: قائمة الأخبار مع title, content, image_url, tickers, published_at.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const fs = require('fs');
const path = require('path');

function dbExists(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

function tableExists(db: any, tableName: string): boolean {
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
      .get(tableName) as { name?: string } | undefined;
    return !!row?.name;
  } catch {
    return false;
  }
}

function safeStringArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(s => String(s)).filter(Boolean);
  const s = String(v);
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map(x => String(x)).filter(Boolean);
  } catch {
    /* not JSON */
  }
  // split على فواصل لو نص
  return s.split(/[,;|]/).map(x => x.trim()).filter(Boolean);
}

interface NewsItem {
  id: number | string;
  title: string;
  content: string | null;
  summary: string | null;
  summary_ar: string | null;
  source: string | null;
  source_type: string | null;
  url: string | null;
  tickers: string[];
  importance: number;
  sentiment: string | null;
  impact_type: string | null;
  market: string | null;
  image_url: string | null;
  image_paths: string[];
  published_at: string | null;
  fetched_at: string | null;
}

function normalizeNewsRow(r: Record<string, unknown>): NewsItem {
  // image_paths ممكن يكون JSON array
  let imagePaths: string[] = [];
  const ip = r.image_paths;
  if (ip != null) {
    if (Array.isArray(ip)) {
      imagePaths = ip.map(s => String(s)).filter(Boolean);
    } else {
      const s = String(ip);
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) imagePaths = parsed.map(x => String(x)).filter(Boolean);
        else imagePaths = [s];
      } catch {
        imagePaths = s ? [s] : [];
      }
    }
  }

  return {
    id: r.id != null ? (r.id as number | string) : 0,
    title: String(r.title ?? r.headline ?? ''),
    content: r.content != null ? String(r.content) : null,
    summary: r.summary != null ? String(r.summary) : null,
    summary_ar: r.summary_ar != null ? String(r.summary_ar) : null,
    source: r.source != null ? String(r.source) : null,
    source_type: r.source_type != null ? String(r.source_type) : null,
    url: r.url != null ? String(r.url) : null,
    tickers: safeStringArray(r.tickers),
    importance: Number(r.importance ?? 0) || 0,
    sentiment: r.sentiment != null ? String(r.sentiment) : null,
    impact_type: r.impact_type != null ? String(r.impact_type) : null,
    market: r.market != null ? String(r.market) : null,
    image_url: imagePaths.length > 0 ? imagePaths[0] : null,
    image_paths: imagePaths,
    published_at: r.published_at != null ? String(r.published_at) : null,
    fetched_at: r.fetched_at != null ? String(r.fetched_at) : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '20', 10) || 20));
    const market = url.searchParams.get('market');

    // 1) news.db.market_news (المصدر الأساسي)
    const newsDbPath = path.join(process.cwd(), 'db', 'news.db');
    if (dbExists(newsDbPath)) {
      try {
        const Database = require('better-sqlite3');
        const db = new Database(newsDbPath, { readonly: true });
        // تأكد إن الجدول موجود
        const hasTable = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='market_news' LIMIT 1"
        ).get();
        if (hasTable) {
          let rows: Record<string, unknown>[];
          if (market) {
            rows = db.prepare(`
              SELECT * FROM market_news
              WHERE market = ? OR market IS NULL OR market = ''
              ORDER BY COALESCE(published_at, fetched_at) DESC
              LIMIT ?
            `).all(market, limit) as Record<string, unknown>[];
          } else {
            rows = db.prepare(`
              SELECT * FROM market_news
              ORDER BY COALESCE(published_at, fetched_at) DESC
              LIMIT ?
            `).all(limit) as Record<string, unknown>[];
          }
          db.close();
          const items = rows.map(normalizeNewsRow);
          return NextResponse.json({
            success: true,
            source: 'news.db.market_news',
            market: market || 'all',
            items,
            count: items.length,
            generated_at: new Date().toISOString(),
          });
        }
        db.close();
      } catch (e) {
        console.warn('[news/latest] news.db query failed:', e);
      }
    }

    // 2) stocks.db fallback: news / news_items / telegram_news
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (dbExists(stocksDbPath)) {
      try {
        const db = await getFinanceDb();
        for (const table of ['news', 'news_items', 'telegram_news', 'market_news']) {
          if (!tableExists(db, table)) continue;
          try {
            const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
            const colNames = cols.map(c => c.name);

            // بناء SELECT بأعمدة آمنة
            const selectCols = [
              'id',
              colNames.includes('title') ? 'title' : (colNames.includes('headline') ? 'headline AS title' : 'NULL AS title'),
              colNames.includes('content') ? 'content' : 'NULL AS content',
              colNames.includes('summary') ? 'summary' : 'NULL AS summary',
              colNames.includes('summary_ar') ? 'summary_ar' : 'NULL AS summary_ar',
              colNames.includes('source') ? 'source' : 'NULL AS source',
              colNames.includes('source_type') ? 'source_type' : 'NULL AS source_type',
              colNames.includes('url') ? 'url' : 'NULL AS url',
              colNames.includes('tickers') ? 'tickers' : (colNames.includes('symbols') ? 'symbols AS tickers' : 'NULL AS tickers'),
              colNames.includes('importance') ? 'importance' : '0 AS importance',
              colNames.includes('sentiment') ? 'sentiment' : 'NULL AS sentiment',
              colNames.includes('impact_type') ? 'impact_type' : 'NULL AS impact_type',
              colNames.includes('market') ? 'market' : 'NULL AS market',
              colNames.includes('image_url') ? 'image_url' : (colNames.includes('image') ? 'image AS image_url' : 'NULL AS image_url'),
              colNames.includes('image_paths') ? 'image_paths' : 'NULL AS image_paths',
              colNames.includes('published_at') ? 'published_at' : (colNames.includes('date') ? 'date AS published_at' : 'NULL AS published_at'),
              colNames.includes('fetched_at') ? 'fetched_at' : 'NULL AS fetched_at',
            ].join(', ');

            let sql: string;
            const params: (string | number)[] = [];
            if (market && colNames.includes('market')) {
              sql = `SELECT ${selectCols} FROM ${table} WHERE market = ? ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT ?`;
              params.push(market, limit);
            } else {
              sql = `SELECT ${selectCols} FROM ${table} ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT ?`;
              params.push(limit);
            }
            const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
            if (rows.length > 0) {
              const items = rows.map(normalizeNewsRow);
              return NextResponse.json({
                success: true,
                source: `stocks.db.${table}`,
                market: market || 'all',
                items,
                count: items.length,
                generated_at: new Date().toISOString(),
              });
            }
          } catch (tableErr) {
            console.warn(`[news/latest] ${table} query failed:`, tableErr);
            continue;
          }
        }
      } catch (e) {
        console.warn('[news/latest] stocks.db query failed:', e);
      }
    }

    // مفيش بيانات إطلاقاً → empty
    return NextResponse.json({
      success: true,
      source: 'none',
      market: market || 'all',
      items: [],
      count: 0,
      note: 'No news tables found in news.db or stocks.db',
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/news/latest] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        items: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}
