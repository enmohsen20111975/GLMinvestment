/**
 * GET /api/news/latest
 * =====================
 * Lightweight latest-news endpoint (no summary field — client renders title
 * + source + URL only). Pure proxy to the Python canonical engine.
 *
 * Directive P1 (API Routes Decoupling): this route previously opened
 * `db/news.db` directly (`new Database`) and queried `market_news`. That
 * bypassed the canonical Python engine (Rule 4). Now it proxies to Python
 * `/api/news/latest` (with `/api/news` as a sibling fallback that we trim
 * down to the lightweight mobile shape). Honest empty when Python is down.
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
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

function toLightweight(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    title: safeStripHtml(row.title) || '',
    source: row.source || 'news_agent',
    url: row.url || '',
    published_at: row.published_at || row.fetched_at || null,
    importance: Number(row.importance) || 0,
    sentiment: row.sentiment || 'neutral',
    market: row.market || 'EGX',
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const market = searchParams.get('market');
    const reqLimit = parseInt(searchParams.get('limit') || '20', 10);
    const limit = Number.isFinite(reqLimit) ? Math.min(Math.max(reqLimit, 1), 100) : 20;

    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    if (market) qs.set('market', market);

    // Primary path: Python /api/news/latest (canonical lightweight endpoint).
    // Fallback: Python /api/news (full shape — we trim to the lightweight form).
    const targetUrls = [
      `${PYTHON_BACKEND_URL}/api/news/latest?${qs.toString()}`,
      `http://127.0.0.1:8010/api/news/latest?${qs.toString()}`,
      `${PYTHON_BACKEND_URL}/api/news?${qs.toString()}`,
      `http://127.0.0.1:8010/api/news?${qs.toString()}`,
    ];

    for (const targetUrl of targetUrls) {
      try {
        const res = await fetch(targetUrl, {
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) continue;
        const json = await res.json();
        const rawNews: any[] = json?.news ?? json?.data?.news ?? [];
        if (Array.isArray(rawNews)) {
          const news = rawNews.map(toLightweight).filter(Boolean);
          const total = json?.total ?? json?.data?.total ?? news.length;
          return NextResponse.json({
            success: true,
            news,
            total,
            returned: news.length,
            source: 'python',
            generated_at: new Date().toISOString(),
          });
        }
      } catch {
        // Try next fallback URL (safe-by-design).
      }
    }

    // Rule 27: honest empty — Python unreachable.
    return NextResponse.json({
      success: true,
      news: [],
      total: 0,
      returned: 0,
      source: 'python_empty',
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[news/latest] fatal:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_en: 'internal error',
        news: [],
      },
      { status: 500 },
    );
  }
}
