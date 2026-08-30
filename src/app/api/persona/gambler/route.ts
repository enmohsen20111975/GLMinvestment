/**
 * Persona Gambler API
 * ===================
 * Returns stocks filtered for the GAMBLER persona.
 * Hard filters: RSI < 30, Volume spike ≥ 1.5x, Above SMA20, R/R > 1.5
 * Proxies to Python backend /api/persona/gambler with fallback.
 */

import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 30; // Cache for 30s

const PYTHON_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get('limit') || '15';
  const sector = searchParams.get('sector') || '';
  const market = searchParams.get('market') || '';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let url = `${PYTHON_URL}/api/persona/gambler?limit=${limit}`;
    if (sector) url += `&sector=${encodeURIComponent(sector)}`;
    if (market) url += `&market=${encodeURIComponent(market)}`;

    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
    } as any);
    clearTimeout(timeoutId);

    if (!res.ok) {
      return NextResponse.json({
        success: false,
        error: `Python backend returned ${res.status}`,
        stocks: [],
        source: 'python-backend-error',
      }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json({
      ...data,
      source: 'python-backend',
    });
  } catch (err: any) {
    return NextResponse.json({
      success: true,
      persona: 'gambler',
      count: 0,
      stocks: [],
      timestamp: new Date().toISOString(),
      source: 'fallback',
      disclaimer: 'تعذّر تحميل الأسهم، حاول مرة أخرى',
    });
  }
}
