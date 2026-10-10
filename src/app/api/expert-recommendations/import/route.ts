/**
 * API لاستيراد التحليلات المحترفية
 * POST /api/expert-recommendations/import
 * 
 * يستورد التحليلات من النص المنسق (مثل رسائل الواتساب)
 * يخزن البيانات في stocks.db (نفس مكان قراءة البيانات)
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

// P0-11-AUTH fix (2026-09-27): added admin auth guard — bulk import of
// expert recommendations writes to stocks.db (shared DB). Was open to anyone.
import { requireAdminAsync } from '@/lib/admin-guard';
import { randomUUID } from 'crypto';
import { ensureInitialized, getWritableStocksDb, ensureExpertRecommendationSchema } from '@/lib/egx-db';

interface ParsedRecommendation {
  stock_symbol: string;
  stock_name_ar?: string;
  entry_price: number;
  entry_price_from?: number;
  entry_price_to?: number;
  entry_condition?: string;
  target_price?: number;
  target_price_2?: number;
  investment_target?: number;
  support_level?: number;
  resistance_level?: number;
  expected_profit_min?: number;
  expected_profit_max?: number;
  expected_profit_investment?: number;
  stop_loss?: number;
  stop_loss_condition?: string;
  technical_analysis?: string;
  fundamental_analysis?: string;
  recommendation_reason?: string;
  action?: string;
  recommendation_type?: string;
  expected_duration?: string;
  expected_duration_days?: number;
}

interface ImportRequest {
  session_date: string;        // مثال: "13-5-2026"
  session_type?: string;       // "صباحية" أو "مسائية"
  expert_name: string;         // مثال: "أ/ ريمون رؤوف"
  expert_source?: string;      // مثال: "مباشر للأوراق المالية"
  recommendations: ParsedRecommendation[];
}

export async function POST(request: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): admin auth guard
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  let egxDb: ReturnType<typeof getWritableStocksDb> | null = null;
  
  try {
    await ensureInitialized();
    egxDb = getWritableStocksDb();
    
    const body: ImportRequest = await request.json();

    if (!body.recommendations || body.recommendations.length === 0) {
      return NextResponse.json(
        { success: false, error: 'لا توجد تحليلات للاستيراد' },
        { status: 400 }
      );
    }

    if (!body.session_date) {
      return NextResponse.json(
        { success: false, error: 'session_date مطلوب' },
        { status: 400 }
      );
    }

    // Ensure ExpertRecommendation table exists with ALL expected columns
    // (idempotent migration — adds missing columns to pre-existing tables)
    ensureExpertRecommendationSchema(egxDb);

    const results = {
      imported: 0,
      errors: [] as string[],
      recommendations: [] as Record<string, unknown>[]
    };

    const insert = egxDb.prepare(`
      INSERT INTO ExpertRecommendation (
        id, stock_symbol, stock_name_ar, expert_name, expert_source, action, recommendation_type,
        entry_price, entry_price_from, entry_price_to, entry_condition,
        target_price, target_price_2, investment_target,
        support_level, resistance_level,
        expected_profit_min, expected_profit_max, expected_profit_investment,
        stop_loss, stop_loss_condition,
        technical_analysis, fundamental_analysis, recommendation_reason,
        session_date, session_type, expected_duration, expected_duration_days,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);

    for (const rec of body.recommendations) {
      try {
        if (!rec.stock_symbol || !rec.entry_price) {
          results.errors.push(`تحليل غير مكتملة: ${rec.stock_symbol || 'غير محدد'}`);
          continue;
        }

        const id = randomUUID();
        
        insert.run(
          id,
          rec.stock_symbol.toUpperCase(),
          rec.stock_name_ar || null,
          body.expert_name || 'غير محدد',
          body.expert_source || 'manual',
          rec.action || 'BUY',
          rec.recommendation_type || 'detailed',
          rec.entry_price,
          rec.entry_price_from || null,
          rec.entry_price_to || null,
          rec.entry_condition || null,
          rec.target_price || null,
          rec.target_price_2 || null,
          rec.investment_target || null,
          rec.support_level || null,
          rec.resistance_level || null,
          rec.expected_profit_min || null,
          rec.expected_profit_max || null,
          rec.expected_profit_investment || null,
          rec.stop_loss || null,
          rec.stop_loss_condition || null,
          rec.technical_analysis || null,
          rec.fundamental_analysis || null,
          rec.recommendation_reason || null,
          body.session_date,
          body.session_type || 'صباحية',
          rec.expected_duration || null,
          rec.expected_duration_days || null,
          'PENDING'
        );

        results.recommendations.push({ id, ...rec });
        results.imported++;
      } catch (err) {
        results.errors.push(`${rec.stock_symbol}: ${String(err)}`);
      }
    }

    console.log(`[Expert Recommendations Import] Imported ${results.imported} recommendations for ${body.expert_name}`);

    return NextResponse.json({
      success: true,
      message: `تم استيراد ${results.imported} تحليل بنجاح`,
      ...results
    });
  } catch (error) {
    console.error('[Expert Recommendations Import] Error:', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  } finally {
    if (egxDb) egxDb.close();
  }
}
