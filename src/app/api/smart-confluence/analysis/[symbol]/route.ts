import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { pythonFetch } from '@/lib/python-backend';

export const revalidate = 30; // Cache for 30s

/**
 * Smart Confluence Analysis API
 * Proxies to Python backend /api/smart-confluence/analysis/<symbol>
 * Falls back to local analysis if backend is unavailable
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const date = request.nextUrl.searchParams.get('date') || undefined;
  const market = request.nextUrl.searchParams.get('market') || undefined;

  // 1) Try Python backend Smart Confluence Engine
  try {
    const queryParams: Record<string, string> = {};
    if (date) queryParams.date = date;
    if (market) queryParams.market = market;

    const result = await pythonFetch<any>(
      `/api/smart-confluence/analysis/${encodeURIComponent(symbol)}`,
      { params: queryParams, timeout: 20000 }
    );

    if (result.success && result.data) {
      return NextResponse.json({
        success: true,
        source: 'python-backend',
        data: result.data,
      });
    }
  } catch (err) {
    console.warn(`[smart-confluence] Python backend unavailable for ${symbol}:`, err);
  }

  // 2) FIX (BRAVO-DISASTER 2026-10-28): was returning a fabricated analysis
  // with entry_price=0, target_price=0, stop_loss=0 — Rule 27 NO-FAKE-DATA
  // violation. Now we honestly report the outage so the frontend can show
  // "backend unavailable" instead of rendering fake trading levels.
  return NextResponse.json({
    success: false,
    error: 'python_backend_unavailable',
    message: 'Smart Confluence analysis unavailable — Python backend is down',
    data: null,
    source: 'fallback',
  }, { status: 503 });
}
