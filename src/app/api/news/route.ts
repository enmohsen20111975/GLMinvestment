/**
 * /api/news — GET (list) + POST (ingest from News Agent)
 * ======================================================
 * CANONICAL news route — pure proxy to the Python engine.
 *
 * Directive P1 (API Routes Decoupling): NO direct SQLite access in Next.js
 * routes. This route previously opened `db/news.db` directly (`new Database`)
 * and queried `market_news` / `news_articles`. That bypassed the canonical
 * Python engine (CONSTITUTION Rule: NEWS-DB-SOT — Python is the single
 * source of truth for news). Now it proxies to Python `/api/news` ONLY.
 * If Python is unreachable → honest empty response (Rule 27 NO-FAKE-DATA).
 *
 * Response shape is preserved 1:1 with the legacy SQLite version so that
 * existing consumers (MyStocksBriefing, NewsFeedView, dashboard widgets,
 * Flutter app) keep working without changes.
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA).
 */
import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

const AGENT_API_KEY = process.env.NEWS_AGENT_API_KEY || process.env.PRODUCTION_API_KEY;

function isAuthorized(request: Request) {
  if (!AGENT_API_KEY) return true; // Optional in dev if not set
  const agentKey = request.headers.get('x-agent-key') || request.headers.get('X-News-Agent-Key') || '';
  return agentKey === AGENT_API_KEY;
}

/**
 * GET /api/news — proxies to Python `/api/news` (single source of truth).
 *
 * Query params (forwarded verbatim to Python):
 *   ?market=EGX        — optional market filter
 *   ?tickers=COMI,EGBE — filter news mentioning any of these tickers
 *   ?catalyst=true     — only catalyst-flagged news
 *   ?limit=N           — default 20, clamped 1..100
 *   ?offset=N          — default 0
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const qs = searchParams.toString();

    const targetUrls = [
      `${PYTHON_BACKEND_URL}/api/news${qs ? `?${qs}` : ''}`,
      `http://127.0.0.1:8010/api/news${qs ? `?${qs}` : ''}`,
    ];

    for (const targetUrl of targetUrls) {
      try {
        const res = await fetch(targetUrl, {
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (res.ok) {
          const data = await res.json();
          // Python returns either {news, total, markets} or {data: {news, total, markets}}
          // — accept both shapes and normalize to the legacy contract.
          const news = data?.news ?? data?.data?.news ?? [];
          const total = data?.total ?? data?.data?.total ?? 0;
          const markets = data?.markets ?? data?.data?.markets ?? [];
          if (Array.isArray(news)) {
            return NextResponse.json({
              news,
              total,
              markets,
              filter: {
                market: searchParams.get('market') || null,
                catalyst: searchParams.get('catalyst') === 'true' || searchParams.get('catalyst') === '1',
                tickers: (searchParams.get('tickers') || '')
                  .split(',')
                  .map((t) => t.trim().toUpperCase())
                  .filter(Boolean),
                tickers_count: (searchParams.get('tickers') || '')
                  .split(',')
                  .filter((t) => t.trim().length > 0).length,
              },
              source: 'python',
            });
          }
        }
      } catch {
        // Try next fallback URL (safe-by-design).
      }
    }

    // Rule 27: honest empty — Python unreachable or returned no valid payload.
    return NextResponse.json({
      news: [],
      total: 0,
      markets: [],
      filter: {
        market: searchParams.get('market') || null,
        catalyst: searchParams.get('catalyst') === 'true' || searchParams.get('catalyst') === '1',
        tickers: (searchParams.get('tickers') || '')
          .split(',')
          .map((t) => t.trim().toUpperCase())
          .filter(Boolean),
        tickers_count: 0,
      },
      source: 'python_empty',
    });
  } catch (error: any) {
    console.error('[news]', error);
    return NextResponse.json({ error: 'internal_error', news: [], total: 0 }, { status: 500 });
  }
}

/**
 * POST /api/news — receives news from local News Agent (telegram/rss/web)
 * and forwards to Python `/api/news` (or `/api/news/agent`) for canonical
 * storage + V40.2 impact scoring. NO direct DB writes in this route.
 *
 * The News Agent sends `x-agent-key` for auth — we forward it to Python.
 */
export async function POST(request: NextRequest) {
  // Auth: same as legacy — allow if no AGENT_API_KEY set in env, otherwise
  // require either the correct key or a local host header (dev convenience).
  const agentKey = request.headers.get('x-agent-key') || request.headers.get('X-News-Agent-Key') || '';
  if (AGENT_API_KEY && agentKey !== AGENT_API_KEY) {
    const host = request.headers.get('host') || '';
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1') || host.includes('invist.m2y.net');
    if (!isLocal) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const body = await request.json();
    const { title, url } = body;

    if (!title) {
      return NextResponse.json({ ok: false, error: 'title is required' }, { status: 400 });
    }

    // Prevent self-channel re-ingest loops (legacy guard kept — cheap & correct).
    if (url && (url.includes('Arabian_investment_guide') || url.includes('invist.m2y.net'))) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'self_channel_loop_prevented' });
    }

    // Forward to Python canonical endpoint. Try `/api/news/agent` first
    // (News-Agent ingest path with auth header) then fall back to `/api/news`.
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (agentKey) headers['X-News-Agent-Key'] = agentKey;

    const targetUrls = [
      `${PYTHON_BACKEND_URL}/api/news/agent`,
      `http://127.0.0.1:8010/api/news/agent`,
      `${PYTHON_BACKEND_URL}/api/news`,
      `http://127.0.0.1:8010/api/news`,
    ];

    for (const targetUrl of targetUrls) {
      try {
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(8000),
          cache: 'no-store',
        });
        if (res.ok || res.status === 201) {
          const data = await res.json();
          // Forward Python's response verbatim if it includes an `ok`/`success`
          // flag; otherwise wrap it in the legacy contract.
          if (data && (data.ok !== undefined || data.success !== undefined)) {
            return NextResponse.json(
              {
                ok: data.ok ?? data.success ?? true,
                success: data.success ?? data.ok ?? true,
                message: data.message || 'تم إضافة الخبر للموقع بنجاح',
                id: data.id ?? data.lastInsertRowid ?? null,
                duplicate: Boolean(data.duplicate),
              },
              { status: 201 },
            );
          }
          return NextResponse.json(
            {
              ok: true,
              success: true,
              message: 'تم إضافة الخبر للموقع بنجاح',
              id: data?.id ?? null,
            },
            { status: 201 },
          );
        }
      } catch {
        // Try next fallback URL (safe-by-design).
      }
    }

    // Rule 27: honest empty — Python unreachable. We DO NOT fabricate a
    // success response; tell the caller the brain is offline.
    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: 'محرك الأخبار غير متاح — تعذّر تخزين الخبر',
        source: 'python_empty',
      },
      { status: 502 },
    );
  } catch (error: any) {
    console.error('[news]', error);
    return NextResponse.json(
      { ok: false, success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}
