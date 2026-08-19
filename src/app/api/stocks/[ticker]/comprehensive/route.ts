/**
 * GET /api/stocks/[ticker]/comprehensive
 * ========================================
 * الشاشة الشاملة لتحليل سهم واحد — تجمع كل المحركات في response واحد.
 *
 * بينادي على:
 * 1. Python /api/stock/deep-analysis (basic + technical + price_history + news + predictions + hunter + board)
 * 2. Next.js /api/maestro/stock/[ticker] (Maestro phases + persona)
 * 3. Next.js /api/stocks/[ticker]/professional-analysis (professional)
 *
 * يرجع schema موحد للـ frontend.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSelfBaseUrl } from '@/lib/server-url';

export const dynamic = 'force-dynamic';

const PYTHON_BACKEND = process.env.PYTHON_BACKEND_URL || process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

interface ComprehensiveResponse {
  success: boolean;
  ticker: string;
  market: string;
  timestamp: string;
  // Section 1: Basic Info + Price
  basic?: any;
  price?: any;
  keyMetrics?: any;
  // Section 2: Technical
  technical?: any;
  priceHistory?: any[];
  // Section 3: Maestro
  maestro?: any;
  // Section 4: Hunter / Board
  hunter?: any;
  board?: any;
  // Section 5: News
  news?: any[];
  // Section 6: Predictions
  predictions?: any[];
  // Section 7: Professional
  professional?: any;
  // Meta
  errors: string[];
  elapsed_ms: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const startTime = Date.now();
  const { ticker } = await params;
  const tickerUpper = ticker.toUpperCase();
  const { searchParams } = new URL(request.url);
  const market = searchParams.get('market') || 'EGX';

  const response: ComprehensiveResponse = {
    success: true,
    ticker: tickerUpper,
    market,
    timestamp: new Date().toISOString(),
    errors: [],
    elapsed_ms: 0,
  };

  // Launch all API calls in parallel
  const promises: Promise<void>[] = [];

  // 1. Deep Analysis (Python) — basic, price, technical, history, news, predictions, hunter, board
  promises.push(
    fetch(`${PYTHON_BACKEND}/api/stock/deep-analysis?ticker=${encodeURIComponent(tickerUpper)}&market=${encodeURIComponent(market)}`, {
      signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) {
          response.errors.push(`deep-analysis: HTTP ${res.status}`);
          return;
        }
        const data = await res.json();
        if (data.success === false) {
          response.errors.push(`deep-analysis: ${data.error || 'failed'}`);
          return;
        }
        response.basic = data.basic_info;
        response.price = data.price;
        response.keyMetrics = data.key_metrics;
        response.technical = data.technical;
        response.priceHistory = data.price_history;
        response.news = data.news;
        response.predictions = data.predictions;
        response.hunter = data.hunter_assessment;
        response.board = data.board_analysis;
      })
      .catch((e) => {
        response.errors.push(`deep-analysis: ${e instanceof Error ? e.message : 'fetch failed'}`);
      })
  );

  // 2. Maestro Analysis (Next.js — runs locally)
  // Use getSelfBaseUrl() to respect x-forwarded-host behind Caddy/Nginx.
  const selfBase = getSelfBaseUrl(request);
  promises.push(
    fetch(`${selfBase}/api/maestro/stock/${encodeURIComponent(tickerUpper)}?persona=balanced&market=${market}`, {
      signal: AbortSignal.timeout(45000),
      headers: { Accept: 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) {
          response.errors.push(`maestro: HTTP ${res.status}`);
          return;
        }
        const data = await res.json();
        if (data.success) {
          response.maestro = data.data;
        } else {
          response.errors.push(`maestro: ${data.error || 'failed'}`);
        }
      })
      .catch((e) => {
        response.errors.push(`maestro: ${e instanceof Error ? e.message : 'fetch failed'}`);
      })
  );

  // 3. Professional Analysis (Python)
  promises.push(
    fetch(`${PYTHON_BACKEND}/api/professional-analysis/${encodeURIComponent(tickerUpper)}`, {
      signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) {
          response.errors.push(`professional: HTTP ${res.status}`);
          return;
        }
        const data = await res.json();
        if (data.success !== false) {
          response.professional = data.data || data;
        } else {
          response.errors.push(`professional: ${data.error || 'failed'}`);
        }
      })
      .catch((e) => {
        response.errors.push(`professional: ${e instanceof Error ? e.message : 'fetch failed'}`);
      })
  );

  // Wait for all (don't fail if some error)
  await Promise.allSettled(promises);

  response.elapsed_ms = Date.now() - startTime;

  // If basic info is missing, try to get it from the database directly
  if (!response.basic) {
    try {
      const stock = await db.stocks.findFirst({
        where: { ticker: tickerUpper },
      });
      if (stock) {
        response.basic = {
          ticker: stock.ticker,
          name: stock.name,
          name_ar: stock.name_ar,
          market: stock.market || market,
          sector: stock.sector || '',
          industry: '',
          is_active: true,
          is_egx30: false,
          is_egx70: false,
          is_egx100: false,
          last_update: null,
        };
      }
    } catch {
      // db might not have stocks table — ignore
    }
  }

  return NextResponse.json(response);
}
