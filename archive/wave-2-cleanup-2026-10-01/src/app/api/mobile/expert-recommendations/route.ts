/**
 * Mobile Expert Recommendations API
 *
 * GET /api/mobile/expert-recommendations
 *
 * Returns expert recommendations from stocks.db
 * Compatible with mobile app
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { ensureInitialized, getWritableStocksDb } from '@/lib/egx-db';

export async function GET(request: NextRequest) {
  let egxDb: ReturnType<typeof getWritableStocksDb> | null = null;
  
  try {
    await ensureInitialized();
    egxDb = getWritableStocksDb();
    
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const expert = searchParams.get('expert');
    const symbol = searchParams.get('symbol');
    const session_date = searchParams.get('session_date');
    const limit = parseInt(searchParams.get('limit') || '100');

    // Check if ExpertRecommendation table exists
    const tables = egxDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ExpertRecommendation'").all() as any[];
    if (tables.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        groupedByDate: {},
        experts: [],
        detailed: [],
        quick: [],
        recommendations: [],
        source: 'stocks.db',
        total: 0,
        message: 'لا توجد تحليلات خبراء متاحة حالياً'
      });
    }

    // Build query
    let query = `SELECT * FROM ExpertRecommendation WHERE 1=1`;
    const params: any[] = [];
    
    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }
    if (expert) {
      query += ` AND expert_name LIKE ?`;
      params.push(`%${expert}%`);
    }
    if (symbol) {
      query += ` AND stock_symbol = ?`;
      params.push(symbol.toUpperCase());
    }
    if (session_date) {
      query += ` AND session_date = ?`;
      params.push(session_date);
    }
    
    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const recommendations = egxDb.prepare(query).all(...params) as any[];
    
    // Get all for stats
    const allRecs = egxDb.prepare(`SELECT * FROM ExpertRecommendation`).all() as any[];

    // Group by session_date
    const groupedByDate: Record<string, any[]> = {};
    for (const rec of allRecs) {
      const date = rec.session_date || 'بدون تاريخ';
      if (!groupedByDate[date]) groupedByDate[date] = [];
      groupedByDate[date].push(rec);
    }

    // Group by type
    const detailed = recommendations.filter((r: any) => r.recommendation_type === 'detailed');
    const quick = recommendations.filter((r: any) => r.recommendation_type === 'quick' || r.recommendation_type === 'trade');

    // Get unique experts
    const expertsMap = new Map();
    for (const rec of allRecs) {
      if (!expertsMap.has(rec.expert_name)) {
        expertsMap.set(rec.expert_name, {
          name: rec.expert_name,
          source: rec.expert_source,
          total: 0,
          pending: 0,
          target_hit: 0,
          closed: 0
        });
      }
      const expertData = expertsMap.get(rec.expert_name);
      expertData.total++;
      if (rec.status === 'PENDING') expertData.pending++;
      if (rec.status === 'TARGET_HIT') expertData.target_hit++;
      if (rec.status === 'CLOSED') expertData.closed++;
    }
    const experts = Array.from(expertsMap.values());

    return NextResponse.json({
      success: true,
      data: recommendations,
      groupedByDate,
      experts,
      detailed,
      quick,
      recommendations,
      source: 'stocks.db',
      total: recommendations.length,
      all_total: allRecs.length,
    });

  } catch (error) {
    console.error('[Mobile Expert API] Error:', error);
    return NextResponse.json({
      success: true,
      data: [],
      groupedByDate: {},
      experts: [],
      detailed: [],
      quick: [],
      recommendations: [],
      source: 'stocks.db',
      total: 0,
      message: 'لا توجد تحليلات خبراء متاحة حالياً'
    });
  } finally {
    if (egxDb) egxDb.close();
  }
}
