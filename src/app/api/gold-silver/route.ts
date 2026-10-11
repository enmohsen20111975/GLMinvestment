/**
 * GET /api/gold-silver
 * ====================
 * GOLD-SILVER-ROUTE (2026-10-11): ZakatView كان بيfetch /api/gold-silver
 * اللي مكنش موجود (404) — الورقة بتتعطل تحميل أسعار الذهب والفضة.
 *
 * Rule 20 (Python = brain): الأسعار canonical من data_engine.db
 * (gold_prices + silver_prices) عبر lib/data-engine-db — نفس المصدر
 * اللي الـ smart-analysis بيقرأ منه.
 *
 * Shape (ZakatView contract):
 *   { success, data: { gold: { price, price_24k, price_21k, price_18k },
 *                     silver: { price, price_per_ounce } } }
 */

import { NextResponse } from 'next/server';
import {
  getLiveEgyptGoldPrices,
  getLatestSilverPrices,
} from '@/lib/data-engine-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EGYPT_ALIASES = new Set(['EG', 'Egypt', 'EGY', 'مصر']);

export async function GET() {
  try {
    const gold = getLiveEgyptGoldPrices();
    const silverRows = getLatestSilverPrices();
    const egSilver = silverRows.find((r) =>
      EGYPT_ALIASES.has(String(r.country || '').trim()),
    );

    return NextResponse.json({
      success: true,
      data: {
        gold: {
          price: gold ? gold['24k'] : null,
          price_24k: gold ? gold['24k'] : null,
          price_21k: gold ? gold['21k'] : null,
          price_18k: gold ? gold['18k'] : null,
          timestamp: gold?.timestamp ?? null,
          source: gold?.source ?? null,
        },
        silver: {
          price: egSilver?.price_per_gram ?? null,
          price_per_gram: egSilver?.price_per_gram ?? null,
          price_per_ounce: egSilver?.price_per_ounce ?? null,
          timestamp: egSilver?.timestamp ?? null,
          source: 'data_engine.db',
        },
      },
    });
  } catch (error) {
    console.error('[/api/gold-silver] Error:', error);
    return NextResponse.json(
      { success: false, error: 'gold-silver-unavailable' },
      { status: 503 },
    );
  }
}
