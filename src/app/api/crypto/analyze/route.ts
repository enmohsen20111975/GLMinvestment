import { NextRequest, NextResponse } from 'next/server';

/**
 * Crypto Analysis API - Python Backend = THE BRAIN
 * 
 * This endpoint proxies all analysis requests to Python backend
 * Python handles: RSI, MACD, Bollinger Bands, SMA, EMA, etc.
 * Node.js = DISPLAY ONLY
 */

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const coinId = searchParams.get('coin_id');
    
    if (!coinId) {
      return NextResponse.json({
        success: false,
        error: 'coin_id parameter is required'
      }, { status: 400 });
    }

    // Call Python backend for analysis - THE BRAIN
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    try {
      const response = await fetch(`${PYTHON_API_URL}/api/crypto/analyze/${coinId}`, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json({
          success: true,
          source: 'python_backend',
          analysis: data.analysis
        });
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.log('[Crypto Analyze] Python backend not available');
    }

    // ❌ NO FAKE DATA - Return error if Python backend unavailable
    return NextResponse.json({
      success: false,
      error: 'Python backend unavailable. Cannot perform analysis.',
      timestamp: new Date().toISOString(),
    }, { status: 503 });

  } catch (error) {
    console.error('[Crypto Analyze] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Analysis failed'
    }, { status: 500 });
  }
}
