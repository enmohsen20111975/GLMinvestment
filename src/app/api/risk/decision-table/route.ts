/**
 * GET /api/risk/decision-table
 * Proxies to the Python backend's /api/risk/decision-table.
 *
 * The Flutter app (lib/api/client.dart:1774) reads `response.data` as a Map.
 * Python returns: { success, decision_table: [{action, confidence, scenario}, ...] }
 *
 * Mirrors the proxy pattern used by /api/risk/stop-loss, /api/risk/position-size
 * and /api/risk/targets — direct passthrough of the Python JSON response.
 */

import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const targetUrl = `${PY}${url.pathname}${url.search}`;

    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
    });

    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { success: false, raw: text };
    }

    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          status: res.status,
          error: 'فشل باك-إند بايثون',
          error_en: 'Python backend error',
          ...data,
        },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (e: any) {
    console.error('[/api/risk/decision-table] proxy error:', e);
    return NextResponse.json(
      {
        success: false,
        error: e?.message || 'تعذر الوصول لخدمة المخاطر',
        error_en: 'Risk service unavailable',
        decision_table: [],
      },
      { status: 503 }
    );
  }
}
