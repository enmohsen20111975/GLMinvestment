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

const fs = require('fs');
const path = require('path');

function dbExists(p: string): boolean {
  try { return fs.existsSync(p) && fs.statSync(p).size > 0; } catch { return false; }
}

function openDb(p: string, readonly = true): any {
  const Database = require('better-sqlite3');
  return new Database(p, { readonly });
}

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
    const predictionsDbPath = path.join(process.cwd(), 'db', 'predictions.db');
    if (dbExists(predictionsDbPath)) {
      try {
        const db = openDb(predictionsDbPath);
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
        db.close();
      } catch { /* ignore */ }
    }

    // 2) Try stocks.db.news_items (filter by ticker, type='disclosure')
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    if (dbExists(stocksDbPath)) {
      try {
        const db = openDb(stocksDbPath);
        // Check if news_items table has ticker column
        const cols = (db.prepare("PRAGMA table_info(news_items)").all() as any[]).map(c => c.name);
        if (cols.includes('ticker')) {
          const rows = db.prepare(`
            SELECT title, content, ticker, published_at, url, image_url, source
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
              image_url: r.image_url,
              source: r.source || 'news_items',
            });
          }
        }
        db.close();
      } catch { /* ignore */ }
    }

    // 3) Try news.db.market_news (filter by tickers LIKE %symbol%)
    const newsDbPath = path.join(process.cwd(), 'db', 'news.db');
    if (dbExists(newsDbPath)) {
      try {
        const db = openDb(newsDbPath);
        const rows = db.prepare(`
          SELECT title, content, summary_ar, tickers, published_at, url, image_url, source
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
            image_url: r.image_url,
            source: r.source || 'market_news',
            tickers: r.tickers,
          });
        }
        db.close();
      } catch { /* ignore */ }
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
        error: e instanceof Error ? e.message : 'Unknown error',
        disclosures: [],
      },
      { status: 500 }
    );
  }
}
