import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';

/**
 * GET /api/risk/stock-types
 * Returns the risk classification of stock types (conservative, balanced, aggressive, speculative).
 * Proxies to Python backend's /api/risk/stock-types endpoint.
 */
export async function GET() {
  try {
    const res = await fetch(`${PY}/api/risk/stock-types`, {
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    // Fallback: return a static risk stock-types table
    return NextResponse.json({
      success: true,
      source: 'fallback',
      stock_types: [
        { type: 'conservative', risk_level: 1, description: 'أسهم محافظة - شركات راسخة بتوزيعات أرباح مستقرة', examples: ['COMI', 'ETEL', 'FWRY'] },
        { type: 'balanced', risk_level: 2, description: 'أسهم متوازنة - شركات نمو مستقرة', examples: ['SWDY', 'EFID', 'HRHO'] },
        { type: 'aggressive', risk_level: 3, description: 'أسهم عدوانية - شركات نمو سريع مع تقلب أعلى', examples: ['DSCV', 'ORWE'] },
        { type: 'speculative', risk_level: 4, description: 'أسهم مضاربة - تقلب عالي جداً، مناسبة للمضاربين فقط', examples: [] },
      ],
    });
  }
}
