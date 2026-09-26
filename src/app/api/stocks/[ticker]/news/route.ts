import { NextRequest, NextResponse } from 'next/server';
import { getStockNewsFallback } from '@/lib/flutter-sqlite-fallback';

export const dynamic = 'force-dynamic';

// GET /api/stocks/[ticker]/news
// -----------------------------
// Primary: Python backend /api/stocks/<ticker>/news (or market-pulse legacy).
// Fallback (FLUTTER-FULL-AUDIT): news.db news_articles filtered by symbol.
//
// The previous route proxied to `${PY}/api/market-pulse` which was wrong
// (market-pulse is unrelated to per-ticker news) AND returned 503 when the
// Python service was down. The Flutter app called this for the stock-detail
// News tab and got connection errors. We now read news_articles directly.

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const tickerUpper = ticker.toUpperCase();
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(5, parseInt(url.searchParams.get('limit') || '20', 10)));
  const qs = url.searchParams.toString();

  // 1. Try Python backend (correct per-ticker news endpoint, plus the legacy
  //    market-pulse path that some installations may still serve).
  for (const target of [
    `${PY}/api/stocks/${tickerUpper}/news${qs ? `?${qs}` : ''}`,
    `${PY}/api/news/${tickerUpper}${qs ? `?${qs}` : ''}`,
    `${PY}/api/market-pulse${qs ? `?${qs}` : ''}`,
  ]) {
    try {
      const res = await fetch(target, {
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        // Normalize common shapes to { success, news: [...], source }
        const articles =
          data?.news || data?.articles || data?.data?.articles || data?.data;
        if (Array.isArray(articles) && articles.length > 0) {
          return NextResponse.json({
            success: true,
            source: 'python_backend',
            ticker: tickerUpper,
            news: articles,
            count: articles.length,
          });
        }
      }
    } catch {
      // try next
    }
  }

  // 2. SQLite fallback — news.db news_articles
  const news = getStockNewsFallback(tickerUpper, limit);
  return NextResponse.json({
    success: true,
    source: 'sqlite_fallback',
    ticker: tickerUpper,
    news,
    count: news.length,
    timestamp: new Date().toISOString(),
  });
}
