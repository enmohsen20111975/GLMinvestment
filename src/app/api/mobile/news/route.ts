/**
 * GET /api/mobile/news
 * =====================
 * Mobile-optimized news feed for the Flutter Android app.
 *
 * Directive P1 (API Routes Decoupling): this route previously opened
 * `db/news.db` directly (`new Database`) and queried `market_news`. That
 * bypassed the canonical Python engine (Rule 4). Now it proxies to Python
 * `/api/mobile/news` (path-matching) with `/api/news` as a sibling
 * fallback. Honest empty state when Python is unreachable (Rule 27).
 *
 * Returns the latest 50 news rows in the lighter mobile shape:
 *   { id, source, title, url, published_at, summary, importance,
 *     sentiment, market, tickers }
 *
 * Auth: optional (public — news is taste content).
 *
 * Query params:
 *   ?limit=N   — default 50, clamped to 1..100
 *   ?market=EGX — optional filter
 *
 * Failure mode: never 500 / never HTML. On Python failure we return 200
 * with an empty `news: []` array so the mobile app shows an empty state
 * instead of a connection-error toast.
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

function toMobileShape(row: any) {
  if (!row) return null;
  const summary =
    safeStripHtml(row.summary_ar) ||
    safeStripHtml(row.summary_en) ||
    safeStripHtml(row.content).slice(0, 220);
  let tickers: string[] = [];
  try {
    const parsed = JSON.parse((row.tickers as string) || '[]');
    if (Array.isArray(parsed)) {
      tickers = parsed.filter((t) => typeof t === 'string').slice(0, 20);
    }
  } catch { // silent fallback (safe-by-design)
    /* ignore */
  }
  return {
    id: row.id,
    source: row.source || 'news_agent',
    title: safeStripHtml(row.title) || '',
    url: row.url || '',
    published_at: row.published_at || row.fetched_at || null,
    summary,
    importance: Number(row.importance) || 0,
    sentiment: row.sentiment || 'neutral',
    market: row.market || 'EGX',
    tickers,
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const market = searchParams.get('market');
    const reqLimit = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Number.isFinite(reqLimit) ? Math.min(Math.max(reqLimit, 1), 100) : 50;

    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    if (market) qs.set('market', market);

    // Primary: Python /api/mobile/news (path-matching). Fallback: /api/news.
    const targetUrls = [
      `${PYTHON_BACKEND_URL}/api/mobile/news?${qs.toString()}`,
      `http://127.0.0.1:8010/api/mobile/news?${qs.toString()}`,
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
        const payload: any[] = json?.news ?? json?.data?.news ?? [];
        if (Array.isArray(payload)) {
          const news = payload.map(toMobileShape).filter(Boolean);
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
      message: 'محرك الأخبار غير متاح',
    });
  } catch (err) {
    console.error('[mobile/news] fatal:', err);
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
