/**
 * Day Trading Scanner API Route
 * ================================
 * POST - Triggers the scanner via the Python backend (port 8010)
 * GET  - Returns the latest scan results from the database
 *
 * The scanner runs every 15 minutes via PM2 cron but can also be
 * triggered manually via the POST endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { PYTHON_BACKEND_URL, pythonFetch } from '@/lib/python-backend';

/**
 * GET /api/scanner/run
 * Get the latest day trading scan results
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const market = searchParams.get('market') || '';
    const limit = searchParams.get('limit') || '50';

    // Try to get results from Python backend first
    const result = await pythonFetch('/api/day-trading-scanner/results', {
      method: 'GET',
      params: { market, limit },
      timeout: 15000,
    });

    if (result.success && result.data) {
      return NextResponse.json(result.data);
    }

    // Fallback: query the predictions.db directly via the Python proxy
    try {
      const proxyResult = await pythonFetch('/api/scanner/quick', {
        method: 'GET',
        params: { limit },
        timeout: 15000,
      });

      if (proxyResult.success && proxyResult.data) {
        return NextResponse.json({
          success: true,
          source: 'scanner_proxy',
          timestamp: new Date().toISOString(),
          results: proxyResult.data.results || [],
        });
      }
    } catch {
      // Proxy also failed
    }

    return NextResponse.json({
      success: false,
      error: 'Could not retrieve scanner results',
      hint: 'Python backend may not be running on port 8010',
    }, { status: 502 });

  } catch (error) {
    console.error('[Scanner API] GET error:', error);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 500 });
  }
}

/**
 * POST /api/scanner/run
 * Trigger the day trading scanner to run now
 */
export async function POST(request: NextRequest) {
  try {
    let body: { markets?: string[] } = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is OK
    }

    const markets = body.markets || ['TADAWUL', 'EGX', 'KSE', 'QSE', 'US', 'CRYPTO'];

    // Trigger the scanner via Python backend
    const result = await pythonFetch('/api/day-trading-scanner/run', {
      method: 'POST',
      body: { markets },
      timeout: 120000, // 2 minutes for full scan
    });

    if (result.success && result.data) {
      return NextResponse.json({
        success: true,
        message: 'Day trading scan completed',
        stats: result.data.stats || result.data,
        timestamp: new Date().toISOString(),
      });
    }

    // Try alternative endpoint
    const altResult = await pythonFetch('/api/advanced-scanner/run', {
      method: 'POST',
      body: { min_volume: 1000 },
      timeout: 120000,
    });

    if (altResult.success && altResult.data) {
      return NextResponse.json({
        success: true,
        message: 'Advanced scan completed',
        source: 'advanced_scanner',
        stats: altResult.data,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Could not trigger scanner',
      hint: 'Python backend may not be running on port 8010',
      python_backend_url: PYTHON_BACKEND_URL,
    }, { status: 502 });

  } catch (error) {
    console.error('[Scanner API] POST error:', error);
    return NextResponse.json({
      success: false,
      error: 'internal_error',
    }, { status: 500 });
  }
}
