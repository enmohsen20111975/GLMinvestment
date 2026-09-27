import { NextResponse, NextRequest } from 'next/server';
export const dynamic = "force-dynamic";

// P0-11-AUTH fix (2026-09-27): added admin auth guard — test-sources
// triggers external API calls (EODHD/FCSAPI/MARKETSTACK/VPS) which can
// burn API quota. Was open to anyone.
import { requireAdminAsync } from '@/lib/admin-guard';


/**
 * Test endpoint for the multi-source data adapter.
 * GET /api/market/test-sources - Get status
 * POST /api/market/test-sources - Test fetching data
 */
export const revalidate = 30; // Cache for 30s

export async function GET(req: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): admin auth guard
  const authError = await requireAdminAsync(req);
  if (authError) return authError;
  try {
    const apiKeys = {
      EODHD: !!process.env.EODHD_API_KEY,
      FCSAPI: !!process.env.FCSAPI_API_KEY,
      MARKETSTACK: !!process.env.MARKETSTACK_API_KEY,
      VPS: !!(process.env.EGX_VPS_API_URL || process.env.PYTHON_API_URL),
    };

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      api_keys: Object.entries(apiKeys).map(([source, configured]) => ({ source, configured })),
      source_health: [
        { source: 'VPS', available: true },
        { source: 'EODHD', available: true },
        { source: 'FCSAPI', available: true },
        { source: 'MARKETSTACK', available: true },
      ],
      message: 'Use POST to test data fetching with body: { "action": "test_stock"|"test_gold"|"test_currency", "ticker": "COMI" }',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): admin auth guard
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'status';
    const ticker = body.ticker || 'COMI';

    // Lazy import to avoid compilation issues
    const { fetchStockQuote, fetchGoldPrices, fetchCurrencyRates, getSourceHealth } = await import('@/lib/multi-source-adapter');

    switch (action) {
      case 'test_stock': {
        const quote = await fetchStockQuote(ticker);
        return NextResponse.json({
          success: true,
          action: 'test_stock',
          ticker,
          quote,
          health: getSourceHealth(),
        });
      }

      case 'test_gold': {
        const prices = await fetchGoldPrices();
        return NextResponse.json({
          success: true,
          action: 'test_gold',
          prices,
          health: getSourceHealth(),
        });
      }

      case 'test_currency': {
        const rates = await fetchCurrencyRates(body.pairs);
        return NextResponse.json({
          success: true,
          action: 'test_currency',
          rates,
          health: getSourceHealth(),
        });
      }

      case 'status':
      default: {
        return NextResponse.json({
          success: true,
          action: 'status',
          health: getSourceHealth(),
        });
      }
    }
  } catch (error) {
    console.error('[Test Sources] Error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
