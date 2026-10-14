/**
 * News Feed API — Unified Multi-Source
 * ===================================
 * يجمع الأخبار من مصادر متعددة عبر محرك Python الكنسي فقط.
 *
 * Directive P1 (API Routes Decoupling): this route previously opened
 * `db/news.db` (news_articles) AND `db/predictions.db` (news_signals)
 * directly via `new Database`, and ALSO made direct external HTTP calls
 * to EGXPilot / CoinGecko / Alternative.me from inside the route. All
 * of those bypassed the Python brain (Rule 4: Python = brain).
 *
 * The aggregation logic (dedup, market filtering, sorting by category
 * and importance, EGXPilot/CoinGecko/Alternative.me fetching) lives in
 * the Python engine. This route is now a pure proxy to Python
 * `/api/news-feed` (path-matching) with `/api/news` as a sibling
 * fallback. Honest empty state when Python is unreachable (Rule 27).
 *
 * Response shape is preserved 1:1 with the legacy version so consumers
 * (NewsFeedView.tsx) keep working without changes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

const CACHE_DURATION = 300; // seconds
const cacheStore: Record<string, { timestamp: number; data: any }> = {};

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  body?: string;
  source: string;
  timestamp: string;
  category: 'egx' | 'crypto' | 'sentiment' | 'market' | 'news_agent';
  importance: 'high' | 'medium' | 'low';
  url?: string;
  tickers?: string[];
  sentiment?: string;
  recommended_action?: string;
  reasoning?: string;
  image_paths?: string[];
  published_at?: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketFilter = (searchParams.get('market') || 'all').toLowerCase();
    const now = Date.now();

    // In-memory cache (5 min) — same TTL as the legacy route.
    const cached = cacheStore[marketFilter];
    if (cached && now - cached.timestamp < CACHE_DURATION * 1000) {
      return NextResponse.json({
        success: true,
        cached: true,
        timestamp: new Date(cached.timestamp).toISOString(),
        news: cached.data,
        cache_duration: CACHE_DURATION,
        market_filter: marketFilter,
      });
    }

    const qs = searchParams.toString();
    const targetUrls = [
      `${PYTHON_BACKEND_URL}/api/news-feed${qs ? `?${qs}` : ''}`,
      `http://127.0.0.1:8010/api/news-feed${qs ? `?${qs}` : ''}`,
      `${PYTHON_BACKEND_URL}/api/news${qs ? `?${qs}` : ''}`,
      `http://127.0.0.1:8010/api/news${qs ? `?${qs}` : ''}`,
    ];

    let news: NewsItem[] = [];
    let usedFallback = false;

    for (const targetUrl of targetUrls) {
      try {
        const res = await fetch(targetUrl, {
          signal: AbortSignal.timeout(10000),
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) continue;
        const json = await res.json();
        const payload: any[] = json?.news ?? json?.data?.news ?? [];
        if (Array.isArray(payload) && payload.length > 0) {
          news = payload as NewsItem[];
          usedFallback = targetUrl.includes('/api/news') && !targetUrl.includes('/api/news-feed');
          break;
        }
        // Empty list is still a valid response (no news right now) — accept it.
        if (Array.isArray(payload) && json?.success !== false) {
          news = [];
          usedFallback = targetUrl.includes('/api/news') && !targetUrl.includes('/api/news-feed');
          break;
        }
      } catch {
        // Try next fallback URL (safe-by-design).
      }
    }

    if (news.length === 0) {
      // Rule 27: honest empty — no fabrication, no external API calls from TS.
      return NextResponse.json({
        success: true,
        cached: false,
        timestamp: new Date().toISOString(),
        news: [],
        summary: {
          total: 0,
          agent: 0,
          egx: 0,
          crypto: 0,
          sentiment: 0,
          market_filter: marketFilter,
        },
        cache_duration: CACHE_DURATION,
        source: 'python_empty',
      });
    }

    // Cache the successful payload.
    cacheStore[marketFilter] = { timestamp: now, data: news };

    // Compose a summary that mirrors the legacy shape — counting by category.
    const count = (cat: string) => news.filter((n) => n.category === cat).length;
    return NextResponse.json({
      success: true,
      cached: false,
      timestamp: new Date().toISOString(),
      news,
      summary: {
        total: news.length,
        agent: count('news_agent'),
        egx: count('egx'),
        crypto: count('crypto'),
        sentiment: count('sentiment'),
        market_filter: marketFilter,
      },
      cache_duration: CACHE_DURATION,
      source: usedFallback ? 'python_news_fallback' : 'python',
    });
  } catch (error: any) {
    console.error('[News] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'خطأ في جلب الأخبار',
        news: [],
        source: 'python_empty',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  // POST busts the cache and re-runs GET (legacy behaviour).
  for (const key of Object.keys(cacheStore)) {
    delete cacheStore[key];
  }
  return GET(request);
}
