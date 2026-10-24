/**
 * GET /api/mobile/crypto
 * =====================
 * Mobile crypto prices list + analysis.
 *
 * Phase-2 verify-existing endpoint (Task 35-D). Coordinator's claim that
 * this file existed was a Rule 68 false-positive — only the [id] dynamic
 * segment existed. We restore the GET handler here, factored through the
 * shared `getCryptoListFallback` helper from `flutter-sqlite-fallback.ts`
 * so there is a single source of truth for the data_engine.db crypto_prices
 * read (Rule 67).
 *
 * Strategy:
 *   1. Try Python backend `/api/crypto/bulk-analysis` first (real signals).
 *   2. Fall back to Python `/api/crypto/prices` (basic prices).
 *   3. Fall back to `data_engine.db.crypto_prices` latest snapshot (sandbox-safe).
 *
 * Public (no auth) — taste/test content. Returns 200 with `crypto: []` if no
 * source is available, never 5xx.
 */

import { NextResponse } from 'next/server';
import { pythonFetch } from '@/lib/python-backend';
import { getCryptoListFallback } from '@/lib/flutter-sqlite-fallback';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PythonCoin {
  symbol?: string;
  name?: string;
  price?: number;
  change_24h?: number | null;
  market_cap?: number | null;
  volume_24h?: number | null;
  ath?: number | null;
  atl?: number | null;
  ath_distance_pct?: number | null;
  score?: number;
  signal?: string;
  signal_ar?: string;
  confidence?: number;
  strength?: string;
  opportunity_type?: string;
  reasons?: string[];
  warnings?: string[];
  [k: string]: unknown;
}

export async function GET() {
  const timestamp = new Date().toISOString();

  // 1. Try Python Backend bulk-analysis for REAL signals
  try {
    const pythonResult = await pythonFetch<{
      data?: PythonCoin[];
      market_regime?: unknown;
      summary?: unknown;
      categories?: unknown;
    }>('/api/crypto/bulk-analysis?limit=50');

    if (pythonResult.success && pythonResult.data?.data) {
      const coins = pythonResult.data.data as PythonCoin[];
      const cryptoData = coins.map((coin) => ({
        symbol: coin.symbol,
        name: coin.name,
        name_ar: coin.name,
        price: coin.price,
        change_24h: coin.change_24h,
        market_cap: coin.market_cap,
        volume_24h: coin.volume_24h,
        ath: coin.ath,
        atl: coin.atl,
        ath_distance_pct: coin.ath_distance_pct,
        score: coin.score,
        signal: coin.signal,
        signal_ar: coin.signal_ar,
        confidence: coin.confidence,
        strength: coin.strength,
        opportunity_type: coin.opportunity_type,
        reasons: coin.reasons,
        warnings: coin.warnings,
      }));

      return NextResponse.json({
        success: true,
        source: 'python_backend',
        crypto: cryptoData,
        market_regime: pythonResult.data.market_regime,
        summary: pythonResult.data.summary,
        categories: pythonResult.data.categories,
        timestamp,
      });
    }
  } catch {
    // fall through
  }

  // 2. Fallback to basic prices endpoint (still Python)
  try {
    const pricesResult = await pythonFetch<{
      data?: PythonCoin[];
    }>('/api/crypto/prices?limit=50');
    if (pricesResult.success && pricesResult.data?.data) {
      const coins = pricesResult.data.data as PythonCoin[];
      const cryptoData = coins.map((coin) => ({
        symbol: coin.symbol,
        name: coin.name,
        price: coin.price,
        change_24h: coin.change_24h,
        market_cap: coin.market_cap,
        volume_24h: coin.volume_24h,
        ath: coin.ath,
        atl: coin.atl,
        score: 50,
        signal: 'HOLD',
        signal_ar: 'احتفاظ',
        confidence: 40,
      }));

      return NextResponse.json({
        success: true,
        source: 'python_backend_basic',
        crypto: cryptoData,
        timestamp,
        warning: 'تحليل أساسي - بعض البيانات غير متاحة',
      });
    }
  } catch {
    // fall through
  }

  // 3. SQLite fallback — data_engine.db crypto_prices latest snapshot.
  //    Uses the shared getCryptoListFallback() helper from
  //    flutter-sqlite-fallback.ts so the read is SSOT (Rule 67). Returns []
  //    gracefully when data_engine.db is absent (sandbox).
  try {
    const rows = getCryptoListFallback(50);
    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback',
        crypto: [],
        message_ar:
          'لا توجد بيانات كريبتو مخزّنة — قاعدة البيانات غير متوفرة أو فارغة',
        timestamp,
      });
    }

    const cryptos = rows.map((c) => {
      const change24h =
        c.price_change_24h != null ? Number(c.price_change_24h) : null;
      return {
        symbol: String(c.symbol ?? ''),
        name: String(c.name ?? ''),
        name_ar: String(c.name ?? ''),
        price: Number(c.price_usd ?? 0),
        change_24h: change24h,
        change_7d:
          c.price_change_7d != null ? Number(c.price_change_7d) : null,
        market_cap:
          c.market_cap != null ? Number(c.market_cap) : null,
        volume_24h:
          c.total_volume != null ? Number(c.total_volume) : null,
        ath: null,
        atl: null,
        ath_distance_pct: null,
        rank: c.market_cap_rank ?? c.rank,
        circulating_supply:
          c.circulating_supply != null
            ? Number(c.circulating_supply)
            : null,
        // Explicit placeholder signal — analytical signals need the Python
        // backend. We never invent prices or percentages (Rule 67 — no
        // synthetic approximation ban violation).
        score: 50,
        signal: 'HOLD',
        signal_ar: 'احتفاظ',
        confidence: 0,
        strength: 'NEUTRAL',
        opportunity_type: 'WATCH',
        reasons: [],
        warnings: [
          'الإشارات التحليلية متاحة فقط عند تشغيل Python Backend',
        ],
      };
    });

    const advancing = cryptos.filter(
      (c) => c.change_24h != null && Number(c.change_24h) > 0
    ).length;
    const declining = cryptos.filter(
      (c) => c.change_24h != null && Number(c.change_24h) < 0
    ).length;

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      timestamp,
      crypto: cryptos,
      count: cryptos.length,
      market_regime: {
        sentiment: 'NEUTRAL',
        source: 'sqlite_fallback',
      },
      summary: {
        total_coins: cryptos.length,
        advancing,
        declining,
      },
      warning: 'البيانات من أحدث لقطة SQLite — التحليل التفصيلي يحتاج Python',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'خطأ في الاتصال بالخادم',
        error_en: 'Connection error',
        details: error instanceof Error ? error.message : 'Unknown error',
        crypto: [],
        timestamp,
      },
      { status: 500 }
    );
  }
}
