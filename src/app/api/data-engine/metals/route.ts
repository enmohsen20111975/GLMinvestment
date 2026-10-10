/**
 * GET /api/data-engine/metals
 * Returns gold + silver prices from the data engine as a single list.
 *
 * Flutter app (lib/api/client.dart:1817) reads:
 *   response.data is List ? response.data : (response.data['metals'] ?? [])
 * so we return `{ success, metals: [...] }` (object form) AND the array form
 * is reachable via `response.data['metals']`.
 *
 * Each metal row: { type, country, currency, karat?, price_per_gram,
 *                    price_per_ounce, timestamp }
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 30;

interface MetalRow {
  type: 'gold' | 'silver';
  country: string;
  currency: string;
  karat?: string;
  price_per_gram: number | null;
  price_per_ounce: number | null;
  timestamp: string;
}

export async function GET() {
  try {
    const { getLatestGoldPrices, getLatestSilverPrices } = await import(
      '@/lib/data-engine-db'
    );

    const goldRows = getLatestGoldPrices() || [];
    const silverRows = getLatestSilverPrices() || [];

    const metals: MetalRow[] = [];

    for (const g of goldRows) {
      metals.push({
        type: 'gold',
        country: g.country,
        currency: g.currency || 'EGP',
        karat: g.karat,
        price_per_gram: g.price_per_gram,
        price_per_ounce: g.price_per_ounce,
        timestamp: g.timestamp,
      });
    }
    for (const s of silverRows) {
      metals.push({
        type: 'silver',
        country: s.country,
        currency: s.currency || 'EGP',
        price_per_gram: s.price_per_gram,
        price_per_ounce: s.price_per_ounce,
        timestamp: s.timestamp,
      });
    }

    // Summary view (handy for clients that just want the latest Egypt price).
    const egGold = goldRows.filter((g: any) => g.country === 'مصر');
    const egSilver = silverRows.filter((s: any) => s.country === 'مصر');
    const summary = {
      gold: {
        karat_24:
          egGold.find((g: any) => (g.karat || '').includes('24'))
            ?.price_per_gram ?? null,
        karat_22:
          egGold.find((g: any) => (g.karat || '').includes('22'))
            ?.price_per_gram ?? null,
        karat_21:
          egGold.find((g: any) => (g.karat || '').includes('21'))
            ?.price_per_gram ?? null,
        karat_18:
          egGold.find((g: any) => (g.karat || '').includes('18'))
            ?.price_per_gram ?? null,
        ounce:
          egGold.find((g: any) =>
            (g.karat || '').toLowerCase().includes('ounce')
          )?.price_per_ounce ?? null,
      },
      silver: {
        price_per_gram: egSilver[0]?.price_per_gram ?? null,
        price_per_ounce: egSilver[0]?.price_per_ounce ?? null,
      },
      last_updated: goldRows[0]?.timestamp || silverRows[0]?.timestamp || null,
    };

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: metals.length,
      source: 'data_engine.db',
      metals,
      summary,
    });
  } catch (error: any) {
    console.error('[/api/data-engine/metals] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'فشل في جلب بيانات المعادن',
        error_en: 'Failed to fetch metals data',
        metals: [],
      },
      { status: 500 }
    );
  }
}
