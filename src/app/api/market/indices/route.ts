import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized, getMarketIndices } from '@/lib/egx-db';

export async function GET(_request: NextRequest) {
  try {
    await ensureInitialized();
    const rawIndices = getMarketIndices();

    // Map DB fields to frontend expected format
    const indices = rawIndices.map((idx: Record<string, unknown>) => ({
      symbol: idx.symbol || '',
      name: idx.name || '',
      name_ar: idx.name_ar || '',
      value: Number(idx.current_value) || 0,
      previous_close: Number(idx.previous_close) || 0,
      change: Number(idx.change) || 0,
      change_percent: Number(idx.change_percent) || 0,
      last_updated: idx.last_update || null,
    }));

    return NextResponse.json({
      indices,
      total: indices.length,
    });
  } catch (error) {
    console.error('[GET /api/market/indices] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch market indices', detail: String(error) },
      { status: 500 }
    );
  }
}
