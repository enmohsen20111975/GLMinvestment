/**
 * Admin News Management API
 * =========================
 * GET: Fetch news with pagination, search, source filtering & summary counts
 * POST: Add manual news article
 * DELETE: Delete single news, batch delete, delete by source, or purge all news
 */

import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { requireAdminAsync } from '@/lib/admin-auth-server';

export const dynamic = 'force-dynamic';

function getDataEngineDbPath() {
  return path.join(process.cwd(), 'data-engine', 'data', 'data_engine.db');
}

function getPredictionsDbPath() {
  return path.join(process.cwd(), 'db', 'predictions.db');
}

function safeParseJson<T>(val: any, fallback: T): T {
  if (!val) return fallback;
  if (typeof val !== 'string') return val as T;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

/**
 * Invalidate external/internal news-feed cache
 */
async function triggerCachePurge() {
  try {
    // Calling POST /api/news-feed clears the memory cache in route.ts
    const localUrl = process.env.NEXTAUTH_URL || 'http://127.0.0.1:3000';
    await fetch(`${localUrl}/api/news-feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    }).catch(() => {});
  } catch {}
}

/**
 * GET /api/admin/news
 */
export async function GET(request: NextRequest) {
  try {
    const authErr = await requireAdminAsync(request);
    if (authErr) return authErr;

    const { searchParams } = new URL(request.url);
    const search = (searchParams.get('q') || '').trim().toLowerCase();
    const sourceFilter = (searchParams.get('source') || '').trim();
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10), 1), 200);
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10), 1);
    const offset = (page - 1) * limit;

    const dePath = getDataEngineDbPath();
    if (!fs.existsSync(dePath)) {
      return NextResponse.json({ success: true, news: [], total: 0, sources: [] });
    }

    const db = new Database(dePath, { timeout: 4000 });

    // Ensure table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS market_news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        summary_ar TEXT,
        summary_en TEXT,
        source TEXT,
        source_type TEXT,
        url TEXT,
        tickers TEXT,
        importance INTEGER DEFAULT 50,
        sentiment TEXT DEFAULT 'neutral',
        impact_type TEXT,
        market TEXT DEFAULT 'EGX',
        image_paths TEXT,
        ocr_text TEXT,
        raw_analysis TEXT,
        published_at TEXT,
        fetched_at TEXT,
        sent_at TEXT,
        is_sent INTEGER DEFAULT 0
      )
    `);

    // Get source counts
    const sourceRows = db.prepare(`
      SELECT source, count(1) as count
      FROM market_news
      GROUP BY source
      ORDER BY count DESC
    `).all() as { source: string; count: number }[];

    // Build filter query
    let whereClauses: string[] = [];
    let params: any[] = [];

    if (search) {
      whereClauses.push('(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tickers) LIKE ?)');
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern);
    }

    if (sourceFilter && sourceFilter !== 'all') {
      whereClauses.push('source = ?');
      params.push(sourceFilter);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRow = db.prepare(`SELECT count(1) as total FROM market_news ${whereSql}`).get(...params) as { total: number };
    const total = countRow ? countRow.total : 0;

    const rows = db.prepare(`
      SELECT id, title, content, summary_ar, source, url, tickers, importance, sentiment,
             image_paths, published_at, fetched_at
      FROM market_news
      ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    db.close();

    const news = rows.map((r) => ({
      id: r.id,
      global_id: `mn-${r.id}`,
      title: r.title || 'بدون عنوان',
      content: r.content || r.summary_ar || '',
      source: r.source || 'غير محدد',
      url: r.url || '',
      tickers: safeParseJson<string[]>(r.tickers, []),
      importance: Number(r.importance || 50),
      sentiment: r.sentiment || 'neutral',
      image_paths: safeParseJson<string[]>(r.image_paths, []),
      published_at: r.published_at || r.fetched_at || '',
    }));

    return NextResponse.json({
      success: true,
      news,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      sources: sourceRows,
    });
  } catch (err: any) {
    console.error('[Admin News GET] error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/admin/news
 * Add manual news article
 */
export async function POST(request: NextRequest) {
  try {
    const authErr = await requireAdminAsync(request);
    if (authErr) return authErr;

    const body = await request.json();
    const title = (body.title || '').trim();
    const content = (body.content || '').trim();
    const source = (body.source || 'أدمن المنصة').trim();
    const url = (body.url || '').trim();
    const importance = Math.min(Math.max(Number(body.importance || 70), 10), 100);
    const sentiment = ['positive', 'negative', 'neutral'].includes(body.sentiment) ? body.sentiment : 'neutral';
    
    // Parse tickers
    let tickers: string[] = [];
    if (Array.isArray(body.tickers)) {
      tickers = body.tickers.map((t: any) => String(t).toUpperCase().trim()).filter(Boolean);
    } else if (typeof body.tickers === 'string') {
      tickers = body.tickers
        .split(/[,،\s]+/)
        .map((t) => t.toUpperCase().trim())
        .filter(Boolean);
    }

    if (!title) {
      return NextResponse.json({ success: false, error: 'عنوان الخبر مطلوب' }, { status: 400 });
    }

    const dePath = getDataEngineDbPath();
    const db = new Database(dePath, { timeout: 5000 });
    const now = new Date().toISOString();

    const analysisObj = {
      recommended_action: body.recommended_action || (sentiment === 'positive' ? 'buy_opportunity' : sentiment === 'negative' ? 'sell_signal' : 'monitor'),
      reasoning: body.reasoning || `تم نشر الخبر بواسطة إدارة المنصة بتاريخ ${new Date().toLocaleDateString('ar-EG')}`,
      importance,
      sentiment,
    };

    const stmt = db.prepare(`
      INSERT INTO market_news (
        title, content, summary_ar, source, source_type, url, tickers,
        importance, sentiment, impact_type, market, raw_analysis, published_at, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      title,
      content || title,
      content ? content.slice(0, 200) : title,
      source,
      'admin_manual',
      url || null,
      JSON.stringify(tickers),
      importance,
      sentiment,
      sentiment === 'positive' ? 'bullish' : sentiment === 'negative' ? 'bearish' : 'neutral',
      'EGX',
      JSON.stringify(analysisObj),
      body.published_at || now,
      now
    );

    db.close();
    await triggerCachePurge();

    return NextResponse.json({
      success: true,
      insertedId: result.lastInsertRowid,
      message: 'تمت إضافة الخبر بنجاح',
    });
  } catch (err: any) {
    console.error('[Admin News POST] error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

/**
 * PUT /api/admin/news
 * Update existing news article
 */
export async function PUT(request: NextRequest) {
  try {
    const authErr = await requireAdminAsync(request);
    if (authErr) return authErr;

    const body = await request.json();
    const rawId = String(body.id || '');
    const numId = parseInt(rawId.replace('mn-', ''), 10);

    if (isNaN(numId)) {
      return NextResponse.json({ success: false, error: 'معرّف الخبر غير صالح' }, { status: 400 });
    }

    const title = (body.title || '').trim();
    const content = (body.content || '').trim();
    const source = (body.source || 'أدمن المنصة').trim();
    const url = (body.url || '').trim();
    const importance = Math.min(Math.max(Number(body.importance || 70), 10), 100);
    const sentiment = ['positive', 'negative', 'neutral'].includes(body.sentiment) ? body.sentiment : 'neutral';

    let tickers: string[] = [];
    if (Array.isArray(body.tickers)) {
      tickers = body.tickers.map((t: any) => String(t).toUpperCase().trim()).filter(Boolean);
    } else if (typeof body.tickers === 'string') {
      tickers = body.tickers
        .split(/[,،\s]+/)
        .map((t) => t.toUpperCase().trim())
        .filter(Boolean);
    }

    if (!title) {
      return NextResponse.json({ success: false, error: 'عنوان الخبر مطلوب' }, { status: 400 });
    }

    const dePath = getDataEngineDbPath();
    const db = new Database(dePath, { timeout: 5000 });

    const analysisObj = {
      recommended_action: sentiment === 'positive' ? 'buy_opportunity' : sentiment === 'negative' ? 'sell_signal' : 'monitor',
      reasoning: body.reasoning || `تم تعديل الخبر بواسطة إدارة المنصة بتاريخ ${new Date().toLocaleDateString('ar-EG')}`,
      importance,
      sentiment,
    };

    const stmt = db.prepare(`
      UPDATE market_news
      SET title = ?,
          content = ?,
          summary_ar = ?,
          source = ?,
          url = ?,
          tickers = ?,
          importance = ?,
          sentiment = ?,
          impact_type = ?,
          raw_analysis = ?
      WHERE id = ?
    `);

    const result = stmt.run(
      title,
      content || title,
      content ? content.slice(0, 200) : title,
      source,
      url || null,
      JSON.stringify(tickers),
      importance,
      sentiment,
      sentiment === 'positive' ? 'bullish' : sentiment === 'negative' ? 'bearish' : 'neutral',
      JSON.stringify(analysisObj),
      numId
    );

    db.close();
    await triggerCachePurge();

    return NextResponse.json({
      success: true,
      updated: result.changes > 0,
      message: 'تم تعديل وتحديث الخبر بنجاح',
    });
  } catch (err: any) {
    console.error('[Admin News PUT] error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/news
 * Actions:
 * - delete_one: { action: 'delete_one', id: 24 } or { id: 'mn-24' }
 * - delete_batch: { action: 'delete_batch', ids: [24, 25, 'mn-26'] }
 * - delete_by_source: { action: 'delete_by_source', source: 'DuckDuckGo' }
 * - purge_all: { action: 'purge_all' }
 */
export async function DELETE(request: NextRequest) {
  try {
    const authErr = await requireAdminAsync(request);
    if (authErr) return authErr;

    const body = await request.json();
    const action = body.action || 'delete_one';

    const dePath = getDataEngineDbPath();
    const predPath = getPredictionsDbPath();

    const deDb = fs.existsSync(dePath) ? new Database(dePath, { timeout: 5000 }) : null;
    const predDb = fs.existsSync(predPath) ? new Database(predPath, { timeout: 5000 }) : null;

    let deletedCount = 0;

    if (action === 'delete_one') {
      const rawId = String(body.id || '');
      const numId = parseInt(rawId.replace('mn-', ''), 10);

      if (deDb && !isNaN(numId)) {
        const res = deDb.prepare('DELETE FROM market_news WHERE id = ?').run(numId);
        deletedCount += res.changes;
      }
      if (predDb) {
        const res = predDb.prepare('DELETE FROM news_signals WHERE id = ?').run(rawId);
        deletedCount += res.changes;
      }
    } else if (action === 'delete_batch') {
      const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
      if (ids.length > 0) {
        const numericIds = ids.map((id) => parseInt(String(id).replace('mn-', ''), 10)).filter((n) => !isNaN(n));
        if (deDb && numericIds.length > 0) {
          const placeholders = numericIds.map(() => '?').join(',');
          const res = deDb.prepare(`DELETE FROM market_news WHERE id IN (${placeholders})`).run(...numericIds);
          deletedCount += res.changes;
        }
        if (predDb) {
          const placeholders = ids.map(() => '?').join(',');
          const res = predDb.prepare(`DELETE FROM news_signals WHERE id IN (${placeholders})`).run(...ids);
          deletedCount += res.changes;
        }
      }
    } else if (action === 'delete_by_source') {
      const source = (body.source || '').trim();
      if (!source) {
        return NextResponse.json({ success: false, error: 'المصدر مطلوب للحذف' }, { status: 400 });
      }
      if (deDb) {
        const res = deDb.prepare('DELETE FROM market_news WHERE source = ?').run(source);
        deletedCount += res.changes;
      }
      if (predDb) {
        const res = predDb.prepare('DELETE FROM news_signals WHERE source = ?').run(source);
        deletedCount += res.changes;
      }
    } else if (action === 'purge_all') {
      if (deDb) {
        const res = deDb.prepare('DELETE FROM market_news').run();
        deletedCount += res.changes;
      }
      if (predDb) {
        const res = predDb.prepare('DELETE FROM news_signals').run();
        deletedCount += res.changes;
      }
    } else {
      if (deDb) deDb.close();
      if (predDb) predDb.close();
      return NextResponse.json({ success: false, error: 'إجراء غير معروف' }, { status: 400 });
    }

    if (deDb) deDb.close();
    if (predDb) predDb.close();

    await triggerCachePurge();

    return NextResponse.json({
      success: true,
      deletedCount,
      message: `تم حذف ${deletedCount} خبر بنجاح`,
    });
  } catch (err: any) {
    console.error('[Admin News DELETE] error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
