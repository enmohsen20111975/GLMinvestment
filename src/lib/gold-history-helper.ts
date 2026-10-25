/**
 * Shared gold-history helper used by both
 *   /api/metals/gold/history
 *   /api/mobile/gold/history
 *
 * The Flutter app (lib/api/client.dart:1425) calls both endpoints with
 *   ?karat=24&days=30
 * and expects:
 *   response.data is List ? response.data : (response.data['history'] ?? [])
 *
 * Each history point is parsed by GoldHistoryPoint.fromJson which reads:
 *   date, price, change?, currency?
 *
 * Strategy:
 *   1. Try data_engine.db gold_prices table — pull distinct timestamps and
 *      pick the requested karat at each timestamp.
 *   2. If the table is missing or empty, synthesize a flat history using the
 *      current gold price (or a sensible fallback) so the Flutter chart
 *      renders something instead of crashing.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 30;

// Fallback base prices (EGP per gram) — matches /api/metals/gold placeholder.
const PLACEHOLDER_KARAT_PRICES: Record<string, number> = {
  '24': 4850,
  '22': 4445,
  '21': 4243,
  '18': 3637,
  '14': 2830,
};

interface HistoryPoint {
  date: string;
  price: number;
  change: number | null;
  currency: string;
}

/**
 * Build history from data_engine.db if rows exist, otherwise return a
 * synthetic flat history based on the current price (with ±2% jitter so the
 * chart looks plausible).
 */
export async function buildGoldHistory(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const karat = (url.searchParams.get('karat') || '24').trim();
    const days = Math.min(
      Math.max(parseInt(url.searchParams.get('days') || '30', 10) || 30, 1),
      365
    );

    // ----- Try DB first -----
    try {
      const { getDataEngineDb } = await import('@/lib/data-engine-db');
      const db = getDataEngineDb();
      // Check whether the table exists and has any rows.
      const tableExists = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='gold_prices'"
        )
        .get() as { name: string } | undefined;

      if (tableExists) {
        // Pull up to `days` most recent distinct timestamps that contain the requested karat.
        const karatLike = `%${karat}%`;
        const rows = db
          .prepare(
            `SELECT timestamp, price_per_gram, currency
             FROM gold_prices
             WHERE karat LIKE ?
               AND country = 'مصر'
             ORDER BY timestamp DESC
             LIMIT ?`
          )
          .all(karatLike, days) as Array<{
            timestamp: string;
            price_per_gram: number | null;
            currency: string | null;
          }>;

        if (rows.length > 0) {
          // Order ascending so the chart reads left-to-right.
          rows.reverse();
          let prev: number | null = null;
          const history: HistoryPoint[] = rows.map((r) => {
            const price = r.price_per_gram ?? 0;
            const change = prev === null ? null : price - prev;
            prev = price;
            return {
              date: (r.timestamp || '').slice(0, 10),
              price,
              change,
              currency: r.currency || 'EGP',
            };
          });

          return NextResponse.json({
            success: true,
            karat,
            days,
            count: history.length,
            source: 'data_engine.db',
            history,
          });
        }
      }
    } catch (dbErr) {
      console.warn('[gold/history] DB read failed, falling back to synthetic:', dbErr);
    }

    // ----- Synthetic fallback -----
    const basePrice =
      PLACEHOLDER_KARAT_PRICES[karat] ?? PLACEHOLDER_KARAT_PRICES['24'];
    const today = new Date();
    const history: HistoryPoint[] = [];
    let prev: number | null = null;
    // Deterministic pseudo-random so consecutive requests look stable.
    let seed = karat.length * 13 + days;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      // ±2% jitter around base price
      const jitter = (rand() - 0.5) * 0.04;
      const price = Math.round(basePrice * (1 + jitter));
      history.push({
        date: d.toISOString().slice(0, 10),
        price,
        change: prev === null ? null : price - prev,
        currency: 'EGP',
      });
      prev = price;
    }

    return NextResponse.json({
      success: true,
      karat,
      days,
      count: history.length,
      source: 'synthetic',
      history,
      message: 'لا توجد بيانات تاريخية متاحة — قيم تجريبية',
      message_en: 'No historical data available — showing synthetic values',
    });
  } catch (error: any) {
    console.error('[gold/history] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'خطأ في جلب سجل أسعار الذهب',
        error_en: 'Failed to fetch gold price history',
        history: [],
      },
      { status: 500 }
    );
  }
}
