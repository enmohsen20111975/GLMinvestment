export const dynamic = 'force-dynamic';
/**
 * GET /api/mobile/crypto
 *
 * Mobile-specific endpoint for crypto prices with REAL analysis
 * Uses Python Backend bulk-analysis for signals
 * 
 * ⚠️ لا بيانات وهمية - في حالة فشل Python Backend نرجع خطأ
 */

import { NextResponse } from 'next/server';
import { pythonFetch } from '@/lib/python-backend';

export async function GET() {
  try {
    // 1. Try Python Backend bulk-analysis for REAL signals
    const pythonResult = await pythonFetch<any>('/api/crypto/bulk-analysis?limit=50');

    if (pythonResult.success && pythonResult.data?.data) {
      const cryptoData = pythonResult.data.data.map((coin: any) => ({
        symbol: coin.symbol,
        name: coin.name,
        name_ar: coin.name, // Could add Arabic names
        price: coin.price,
        change_24h: coin.change_24h,
        market_cap: coin.market_cap,
        volume_24h: coin.volume_24h,
        ath: coin.ath,
        atl: coin.atl,
        ath_distance_pct: coin.ath_distance_pct,
        // REAL analysis
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

    // 2. Fallback to basic prices endpoint
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
        // Basic analysis
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

    // ❌ NO FAKE DATA - Return error instead of mock data
    return NextResponse.json({
      success: false,
      error: 'Python Backend غير متاح',
      error_en: 'Python Backend is unavailable',
      hint: 'تأكد من تشغيل Python Backend على المنفذ 8010',
      crypto: [],
      timestamp: new Date().toISOString(),
    }, { status: 503 });

  } catch (error) {
    console.error('[/api/mobile/crypto] Error:', error);
    
    // ❌ NO FAKE DATA - Return error instead of mock data
    return NextResponse.json({
      success: false,
      error: 'خطأ في الاتصال بالخادم',
      error_en: 'Connection error to Python Backend',
      details: error instanceof Error ? error.message : 'Unknown error',
      crypto: [],
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}
