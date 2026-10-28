/**
 * GET /api/disclosures/company/[symbol]
 * ========================================
 * Flutter compatibility endpoint — company disclosures.
 *
 * يقرأ من:
 *   - predictions.db.corporate_actions (لو موجود)
 *   - stocks.db.news_items (filter by ticker, type='disclosure')
 *   - news.db.market_news (filter by tickers)
 *
 * لو مفيش DBs → رجع empty array (لا mock).
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { openDb as openDbDal } from '@/lib/db-manager';

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = (params?.symbol || '').toUpperCase();
    if (!symbol) {
      return NextResponse.json(
        { success: false, error: 'symbol parameter required' },
        { status: 400 }
      );
    }

    const disclosures: any[] = [];

    // 1) Try predictions.db.corporate_actions
    {
      const db = openDbDal('predictions.db');
      if (db) {
        try {
          const rows = db.prepare(`
            SELECT ticker, action_type, action_date, details, source, created_at
            FROM corporate_actions
            WHERE UPPER(ticker) = ?
            ORDER BY action_date DESC
            LIMIT 50
          `).all(symbol) as any[];
          for (const r of rows) {
            disclosures.push({
              type: r.action_type,
              date: r.action_date,
              details: r.details,
              source: r.source || 'corporate_actions',
              created_at: r.created_at,
            });
          }
        } catch { /* ignore */ }
        db.close();
      }
    }

    // 2) Try stocks.db.news_items (filter by ticker, type='disclosure')
    // DATA-ENGINE-UNIFY-1 / News Stage 2: read from news.db.market_news (canonical)
    // Column renamed to image_paths (canonical market_news column; news_items is legacy/empty).
    {
      const db = openDbDal('stocks.db');
      if (db) {
        try {
          // Check if news_items table has ticker column
          const cols = (db.prepare("PRAGMA table_info(news_items)").all() as any[]).map(c => c.name);
          if (cols.includes('ticker')) {
            const rows = db.prepare(`
              SELECT title, content, ticker, published_at, url, image_paths, source
              FROM news_items
              WHERE UPPER(ticker) = ?
              ORDER BY published_at DESC
              LIMIT 30
            `).all(symbol) as any[];
            for (const r of rows) {
              disclosures.push({
                type: 'news',
                date: r.published_at,
                title: r.title,
                details: r.content,
                url: r.url,
                image_paths: r.image_paths,
                source: r.source || 'news_items',
              });
            }
          }
        } catch { /* ignore */ }
        db.close();
      }
    }

    // 3) Try news.db.market_news (filter by tickers LIKE %symbol%)
    {
      const db = openDbDal('news.db');
      if (db) {
        try {
          const rows = db.prepare(`
            SELECT title, content, summary_ar, tickers, published_at, url, image_paths, source
            FROM market_news
            WHERE tickers LIKE ?
            ORDER BY published_at DESC
            LIMIT 30
          `).all(`%${symbol}%`) as any[];
          for (const r of rows) {
            disclosures.push({
              type: 'market_news',
              date: r.published_at,
              title: r.title,
              details: r.content || r.summary_ar,
              url: r.url,
              image_paths: r.image_paths,
              source: r.source || 'market_news',
              tickers: r.tickers,
            });
          }
        } catch { /* ignore */ }
        db.close();
      }
    }

    return NextResponse.json({
      success: true,
      symbol,
      disclosures,
      total: disclosures.length,
      source: 'sqlite_multi_db',
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[/api/disclosures/company/[symbol]] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        disclosures: [],
      },
      { status: 500 }
    );
  }
}
