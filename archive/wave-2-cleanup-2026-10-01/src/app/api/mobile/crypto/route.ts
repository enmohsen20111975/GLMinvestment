/**
 * GET /api/mobile/crypto
 * =====================
 * Mobile crypto prices + analysis.
 * Tries Python `/api/crypto/bulk-analysis` first; on failure falls back to
 * the latest snapshot from data_engine.db `crypto_prices` table.
 */

import { NextResponse } from 'next/server';
import { pythonFetch } from '@/lib/python-backend';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  // 1. Try Python Backend bulk-analysis for REAL signals
  try {
    const pythonResult = await pythonFetch<any>(
      '/api/crypto/bulk-analysis?limit=50'
    );

    if (pythonResult.success && pythonResult.data?.data) {
      const cryptoData = pythonResult.data.data.map((coin: any) => ({
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
        timestamp: new Date().toISOString(),
      });
    }
  } catch {}

  // 2. Fallback to basic prices endpoint (still Python)
  try {
    const pricesResult = await pythonFetch<any>('/api/crypto/prices?limit=50');
    if (pricesResult.success && pricesResult.data?.data) {
      const cryptoData = pricesResult.data.data.map((coin: any) => ({
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
        timestamp: new Date().toISOString(),
        warning: 'تحليل أساسي - بعض البيانات غير متاحة',
      });
    }
  } catch {}

  // 3. Fallback — data_engine.db crypto_prices (latest snapshot)
  try {
    const path = require('path');
    const fs = require('fs');
    const Database = require('better-sqlite3');
    const deDbPath = path.join(process.cwd(), 'db', 'data_engine.db');
    if (!fs.existsSync(deDbPath)) {
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback',
        crypto: [],
        message_ar: 'قاعدة بيانات الكريبتو غير متوفرة',
        timestamp: new Date().toISOString(),
      });
    }
    const db = new Database(deDbPath, { readonly: true });

    // Latest snapshot timestamp
    const latest: any = db
      .prepare(
        `SELECT timestamp FROM crypto_prices
         WHERE timestamp IS NOT NULL
         ORDER BY timestamp DESC LIMIT 1`
      )
      .get();

    if (!latest) {
      db.close();
      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback',
        crypto: [],
        message_ar: 'لا توجد بيانات كريبتو مخزّنة',
        timestamp: new Date().toISOString(),
      });
    }

    const cryptos: any[] = db
      .prepare(
        `SELECT symbol, name, rank, price_usd, price_change_24h,
                price_change_7d, market_cap, market_cap_rank, total_volume,
                circulating_supply
         FROM crypto_prices
         WHERE timestamp = ?
         ORDER BY market_cap_rank ASC
         LIMIT 50`
      )
      .all(latest.timestamp)
      .map((c: any) => ({
        symbol: c.symbol,
        name: c.name,
        name_ar: c.name,
        price: Number(c.price_usd || 0),
        change_24h:
          c.price_change_24h != null ? Number(c.price_change_24h) : null,
        change_7d:
          c.price_change_7d != null ? Number(c.price_change_7d) : null,
        market_cap: c.market_cap != null ? Number(c.market_cap) : null,
        volume_24h: c.total_volume != null ? Number(c.total_volume) : null,
        ath: null,
        atl: null,
        ath_distance_pct: null,
        rank: c.market_cap_rank || c.rank,
        circulating_supply:
          c.circulating_supply != null ? Number(c.circulating_supply) : null,
        // Simple derived signal — no mock
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
      }));

    db.close();

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      timestamp: latest.timestamp,
      crypto: cryptos,
      count: cryptos.length,
      market_regime: {
        sentiment: 'NEUTRAL',
        source: 'sqlite_fallback',
      },
      summary: {
        total_coins: cryptos.length,
        advancing: cryptos.filter((c) => Number(c.change_24h) > 0).length,
        declining: cryptos.filter((c) => Number(c.change_24h) < 0).length,
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
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
