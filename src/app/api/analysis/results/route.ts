/**
 * Stored Analysis Results API - Proxy to vps-service
 * ====================================================
 * هذا مجرد proxy للـ Python backend على port 8010
 * كل المنطق في vps-service
 */

import { NextRequest, NextResponse } from 'next/server';

const VPS_SERVICE_URL = process.env.PYTHON_BACKEND_URL || process.env.VPS_SERVICE_URL || 'http://localhost:8010';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const market = searchParams.get('market') || 'EGX';
    const recommendation = searchParams.get('recommendation') || '';
    const minScore = searchParams.get('minScore') || '0';
    const limit = searchParams.get('limit') || '100';
    const offset = searchParams.get('offset') || '0';
    
    const params = new URLSearchParams({
      market,
      limit,
      offset,
      ...(recommendation && { recommendation }),
      ...(minScore !== '0' && { minScore })
    });
    
    const response = await fetch(
      `${VPS_SERVICE_URL}/api/stored-analysis/results?${params}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[AnalysisResultsAPI] Proxy error:', error);
    return NextResponse.json(
      { success: false, error: 'vps-service غير متاح' },
      { status: 503 }
    );
  }
}
