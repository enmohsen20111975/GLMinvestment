/**
 * GET /api/tab-data?tab=performance&market=EGX&limit=50&offset=0
 * =================================================================
 * CANONICAL tab-data route — pure proxy to Python /api/tab-data.
 *
 *Directive P1 (API Routes Decoupling): NO direct SQLite access. This route
 * proxies to Python ONLY. If Python is unreachable → honest empty payload
 * (Rule 27 NO-FAKE-DATA).
 *
 * P0-12-SQLI fix preserved: `tab` query param is whitelisted on TS side too
 * (defence-in-depth — Python is expected to re-validate, but we never reach
 * Python with an unknown tab name).
 *
 * Rule 4 (Python = brain, Frontend = mirror only).
 * Rule 27 (NO-FAKE-DATA): empty arrays when Python unreachable.
 */
import { NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';

// P0-12-SQLI fix: whitelist table names to prevent SQL injection. The `tab`
// query parameter is validated against this Set before being forwarded to
// Python. Any request with a tab not in the whitelist returns 400.
const ALLOWED_TABS = new Set([
  'performance', 'valuation', 'dividends', 'profitability',
  'income_statement', 'balance_sheet', 'cash_flow', 'technical_analysis',
]);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get('tab') || 'performance';
    const market = searchParams.get('market');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 1000);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    if (!ALLOWED_TABS.has(tab)) {
      return NextResponse.json(
        { error: `Invalid tab name '${tab}'. Allowed: ${Array.from(ALLOWED_TABS).join(', ')}` },
        { status: 400 }
      );
    }

    // Python canonical endpoint (path mirrors this route).
    const targetUrl = new URL(`${PYTHON_BACKEND_URL}/api/tab-data`);
    targetUrl.searchParams.set('tab', tab);
    targetUrl.searchParams.set('limit', String(limit));
    targetUrl.searchParams.set('offset', String(offset));
    if (market) targetUrl.searchParams.set('market', market);

    try {
      const res = await fetch(targetUrl.toString(), {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        // Forward canonical Python response shape.
        if (
          data &&
          typeof data === 'object' &&
          ('data' in data || 'columns' in data || 'total' in data)
        ) {
          return NextResponse.json(data);
        }
      }
    } catch {
      // Python unreachable — honest empty (Rule 27).
    }

    // Rule 27: honest empty payload (shape preserved for tab-data consumers).
    return NextResponse.json({
      tab,
      columns: [],
      data: [],
      total: 0,
    });
  } catch (error) {
    console.error('[tab-data]', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
