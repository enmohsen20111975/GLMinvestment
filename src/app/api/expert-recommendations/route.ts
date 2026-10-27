/**
 * API for Expert Recommendations
 * تحليلات الخبراء المحترفين
 * 
 * يقرأ البيانات من stocks.db فقط
 * 
 * GET: جلب التحليلات
 * POST: إضافة تحليل جديد
 * PUT: تحديث تحليل
 * DELETE: حذف تحليل
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { randomUUID } from 'crypto';
import { ensureInitialized, getWritableStocksDb, ensureExpertRecommendationSchema } from '@/lib/egx-db';
import { requireAdminAsync } from '@/lib/admin-guard'; // FIX-WAVE-1-SECURITY (AUDIT-DEEP-4 #1)
import { openDb } from '@/lib/db-manager';

// GET /api/expert-recommendations - جلب تحليلات الخبراء
export async function GET(request: NextRequest) {
  try {
    // Use DAL for faster access
    const db = openDb('stocks.db');
    if (!db) {
      console.error('[Expert Recommendations] stocks.db unavailable');
      return NextResponse.json({
        success: true,
        data: [],
        recommendations: [],
        source: 'stocks.db',
        total: 0,
        message: 'قاعدة البيانات غير متاحة'
      });
    }
    
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const expert = searchParams.get('expert');
    const symbol = searchParams.get('symbol');
    const session_date = searchParams.get('session_date');
    const limit = parseInt(searchParams.get('limit') || '100');
    const market = searchParams.get('market');

    // Map frontend market codes to database codes
    const MARKET_MAP: Record<string, string> = {
      'EGX': 'EGX',
      'KSA': 'TADAWUL',
      'TADAWUL': 'TADAWUL',
      'KSE': 'KSE',
      'QSE': 'QSE',
    };

    // Check if ExpertRecommendation table exists
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ExpertRecommendation'").all();
    if (tables.length === 0) {
      db.close();
      return NextResponse.json({
        success: true,
        data: [],
        recommendations: [],
        source: 'stocks.db',
        total: 0,
        message: 'لا توجد تحليلات خبراء متاحة حالياً'
      });
    }

    // If market filter is provided, get stock symbols for that market
    let marketStocks: string[] = [];
    if (market) {
      const dbMarket = MARKET_MAP[market.toUpperCase()] || market;
      const stocksResult = db.prepare(`SELECT ticker FROM stocks WHERE market = ?`).all(dbMarket) as { ticker: string }[];
      marketStocks = stocksResult.map(s => s.ticker.toUpperCase());
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
    
    // Filter by market if provided
    if (market && marketStocks.length > 0) {
      const placeholders = marketStocks.map(() => '?').join(',');
      query += ` AND stock_symbol IN (${placeholders})`;
      params.push(...marketStocks);
    }
    
    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const recommendations = db.prepare(query).all(...params) as any[];
    console.log(`[Expert Recommendations] Found ${recommendations.length} recommendations`);

    // Close DB immediately
    db.close();

    return NextResponse.json({
      success: true,
      data: recommendations,
      recommendations: recommendations,
      source: 'stocks.db',
      total: recommendations.length,
    });
  } catch (error) {
    console.error('[Expert Recommendations API] Error:', error);
    return NextResponse.json({
      success: true,
      data: [],
      recommendations: [],
      total: 0,
      message: 'لا توجد تحليلات خبراء متاحة حالياً'
    });
  }
}

// POST - Create new expert recommendation
export async function POST(request: NextRequest) {
  // FIX-WAVE-1-SECURITY (AUDIT-DEEP-4 #1): admin-only — was previously unauthenticated.
  const adminError = await requireAdminAsync(request);
  if (adminError) return adminError;

  let egxDb: ReturnType<typeof getWritableStocksDb> | null = null;
  
  try {
    await ensureInitialized();
    egxDb = getWritableStocksDb();
    
    const body = await request.json();

    // Minimum required: stock_symbol
    if (!body.stock_symbol) {
      return NextResponse.json(
        { success: false, error: 'stock_symbol is required' },
        { status: 400 }
      );
    }

    // Generate ID if not provided
    const id = body.id || randomUUID();

    // Ensure ExpertRecommendation table has ALL expected columns (idempotent migration)
    ensureExpertRecommendationSchema(egxDb);

    // Parse entry price (required)
    const entryPrice = parseFloat(body.entry_price) || 0;
    if (entryPrice <= 0) {
      return NextResponse.json(
        { success: false, error: 'entry_price must be a positive number' },
        { status: 400 }
      );
    }

    // Insert the recommendation
    egxDb.prepare(`
      INSERT INTO ExpertRecommendation (
        id, stock_symbol, stock_name_ar, expert_name, expert_source, action, recommendation_type,
        entry_price, entry_price_from, entry_price_to, entry_condition,
        target_price, target_price_2, investment_target,
        support_level, resistance_level,
        expected_profit_min, expected_profit_max, expected_profit_investment,
        stop_loss, stop_loss_condition,
        technical_analysis, fundamental_analysis, recommendation_reason,
        session_date, session_type, expected_duration, expected_duration_days,
        notes, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      id,
      body.stock_symbol?.toUpperCase(),
      body.stock_name_ar || null,
      body.expert_name || 'غير محدد',
      body.expert_source || 'manual',
      body.action || 'BUY',
      body.recommendation_type || 'detailed',
      entryPrice,
      body.entry_price_from ? parseFloat(body.entry_price_from) : null,
      body.entry_price_to ? parseFloat(body.entry_price_to) : null,
      body.entry_condition || null,
      body.target_price ? parseFloat(body.target_price) : null,
      body.target_price_2 ? parseFloat(body.target_price_2) : null,
      body.investment_target ? parseFloat(body.investment_target) : null,
      body.support_level ? parseFloat(body.support_level) : null,
      body.resistance_level ? parseFloat(body.resistance_level) : null,
      body.expected_profit_min ? parseFloat(body.expected_profit_min) : null,
      body.expected_profit_max ? parseFloat(body.expected_profit_max) : null,
      body.expected_profit_investment ? parseFloat(body.expected_profit_investment) : null,
      body.stop_loss ? parseFloat(body.stop_loss) : null,
      body.stop_loss_condition || null,
      body.technical_analysis || null,
      body.fundamental_analysis || null,
      body.recommendation_reason || null,
      body.session_date || null,
      body.session_type || 'صباحية',
      body.expected_duration || null,
      body.expected_duration_days ? parseInt(body.expected_duration_days) : null,
      body.notes || null,
      body.status || 'PENDING'
    );

    return NextResponse.json({ 
      success: true, 
      data: { id, ...body }, 
      message: 'تم إضافة التحليل بنجاح' 
    });
  } catch (error) {
    console.error('[Expert Recommendations API] Create Error:', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  } finally {
    if (egxDb) egxDb.close();
  }
}

// PUT - Update recommendation (for verification/results)
export async function PUT(request: NextRequest) {
  // FIX-WAVE-1-SECURITY (AUDIT-DEEP-4 #1): admin-only — was previously unauthenticated.
  const adminError = await requireAdminAsync(request);
  if (adminError) return adminError;

  let egxDb: ReturnType<typeof getWritableStocksDb> | null = null;
  
  try {
    await ensureInitialized();
    egxDb = getWritableStocksDb();
    
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
    }

    const existing = egxDb.prepare(`SELECT id FROM ExpertRecommendation WHERE id = ?`).get(id);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    // Build update query dynamically
    const updateFields: string[] = ['updated_at = datetime("now")'];
    const values: any[] = [];
    
    const allowedFields = [
      'status', 'final_price', 'profit_loss_percent', 'hit_target', 'hit_stop_loss',
      'notes', 'target_price', 'stop_loss', 'closed_at'
    ];
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        values.push(updates[field]);
      }
    }
    
    values.push(id);
    
    egxDb.prepare(`UPDATE ExpertRecommendation SET ${updateFields.join(', ')} WHERE id = ?`).run(...values);

    return NextResponse.json({ success: true, message: 'تم التحديث' });
  } catch (error) {
    console.error('[Expert Recommendations API] Update Error:', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  } finally {
    if (egxDb) egxDb.close();
  }
}

// DELETE - Remove a recommendation
export async function DELETE(request: NextRequest) {
  // FIX-WAVE-1-SECURITY (AUDIT-DEEP-4 #1): admin-only — was previously unauthenticated.
  const adminError = await requireAdminAsync(request);
  if (adminError) return adminError;

  let egxDb: ReturnType<typeof getWritableStocksDb> | null = null;
  
  try {
    await ensureInitialized();
    egxDb = getWritableStocksDb();
    
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
    }

    egxDb.prepare(`DELETE FROM ExpertRecommendation WHERE id = ?`).run(id);
    return NextResponse.json({ success: true, message: 'تم حذف التحليل' });
  } catch (error) {
    console.error('[Expert Recommendations API] Delete Error:', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  } finally {
    if (egxDb) egxDb.close();
  }
}
