/**
 * API Route: Analyst Predictions
 * ==============================
 * إدارة توقعات المحللين
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/analyst/predictions - جلب التوقعات
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    const analystId = searchParams.get('analyst_id');
    const status = searchParams.get('status') || 'active';
    const limit = parseInt(searchParams.get('limit') || '50');

    let query = `SELECT * FROM analyst_predictions WHERE 1=1`;
    const params: unknown[] = [];

    if (ticker) {
      query += ` AND ticker = ?`;
      params.push(ticker);
    }
    if (analystId) {
      query += ` AND analyst_id = ?`;
      params.push(analystId);
    }
    if (status !== 'all') {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY prediction_date DESC LIMIT ?`;
    params.push(limit);

    const predictions = await db.$queryRawUnsafe(query, ...params);

    // حساب الإحصائيات
    const stats = await db.$queryRaw`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN actual_result = prediction THEN 1 ELSE 0 END) as correct,
        SUM(CASE WHEN actual_result != prediction AND actual_result IS NOT NULL THEN 1 ELSE 0 END) as wrong
      FROM analyst_predictions
      WHERE status = 'reviewed'
    `;

    return NextResponse.json({
      success: true,
      predictions,
      stats: (stats as Record<string, number>[])[0] || { total: 0, correct: 0, wrong: 0 }
    });
  } catch (error) {
    console.error('Error fetching predictions:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch predictions' },
      { status: 500 }
    );
  }
}

// POST /api/analyst/predictions - إنشاء توقع جديد
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      analyst_id,
      analyst_name,
      ticker,
      prediction,
      target_price,
      stop_loss,
      confidence,
      notes,
      rsi_at_prediction,
      sma20_at_prediction,
      sma50_at_prediction,
      price_at_prediction
    } = body;

    if (!analyst_id || !ticker || !prediction) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: analyst_id, ticker, prediction' },
        { status: 400 }
      );
    }

    if (!['up', 'down', 'neutral'].includes(prediction)) {
      return NextResponse.json(
        { success: false, error: 'Invalid prediction. Must be: up, down, or neutral' },
        { status: 400 }
      );
    }

    // إنشاء التوقع
    const id = crypto.randomUUID();
    
    await db.$executeRaw`
      INSERT INTO analyst_predictions (
        id, analyst_id, analyst_name, ticker, prediction_date,
        prediction, target_price, stop_loss, confidence, notes,
        rsi_at_prediction, sma20_at_prediction, sma50_at_prediction, price_at_prediction,
        status, created_at, updated_at
      ) VALUES (
        ${id},
        ${analyst_id},
        ${analyst_name || null},
        ${ticker},
        datetime('now'),
        ${prediction},
        ${target_price || null},
        ${stop_loss || null},
        ${confidence || 5},
        ${notes || null},
        ${rsi_at_prediction || null},
        ${sma20_at_prediction || null},
        ${sma50_at_prediction || null},
        ${price_at_prediction || null},
        'active',
        datetime('now'),
        datetime('now')
      )
    `;

    // تحديث أداء المحلل
    await updateAnalystPerformance(analyst_id);

    return NextResponse.json({
      success: true,
      message: 'تم حفظ التوقع بنجاح',
      prediction_id: id
    });
  } catch (error) {
    console.error('Error creating prediction:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create prediction' },
      { status: 500 }
    );
  }
}

// PUT /api/analyst/predictions - مراجعة توقع
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { prediction_id, actual_result, actual_price, pnl_pct } = body;

    if (!prediction_id || !actual_result) {
      return NextResponse.json(
        { success: false, error: 'Missing prediction_id or actual_result' },
        { status: 400 }
      );
    }

    await db.$executeRaw`
      UPDATE analyst_predictions
      SET 
        status = 'reviewed',
        review_date = datetime('now'),
        actual_result = ${actual_result},
        actual_price = ${actual_price || null},
        pnl_pct = ${pnl_pct || null},
        updated_at = datetime('now')
      WHERE id = ${prediction_id}
    `;

    // جلب analyst_id لتحديث الأداء
    const prediction = await db.$queryRaw`
      SELECT analyst_id FROM analyst_predictions WHERE id = ${prediction_id}
    `;

    const p = prediction as Record<string, unknown>[];
    if (p[0]?.analyst_id) {
      await updateAnalystPerformance(p[0].analyst_id as string);
    }

    return NextResponse.json({
      success: true,
      message: 'تم مراجعة التوقع بنجاح'
    });
  } catch (error) {
    console.error('Error reviewing prediction:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to review prediction' },
      { status: 500 }
    );
  }
}

// تحديث أداء المحلل
async function updateAnalystPerformance(analystId: string) {
  try {
    const stats = await db.$queryRaw`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN actual_result = prediction THEN 1 ELSE 0 END) as correct,
        SUM(CASE WHEN actual_result != prediction THEN 1 ELSE 0 END) as wrong,
        AVG(pnl_pct) as avg_return,
        SUM(pnl_pct) as total_return,
        MAX(pnl_pct) as best_return,
        MIN(pnl_pct) as worst_return
      FROM analyst_predictions
      WHERE analyst_id = ${analystId} AND status = 'reviewed'
    `;

    const s = (stats as Record<string, number | null>[])[0] || {};
    const total = Number(s?.total || 0);
    const correct = Number(s?.correct || 0);
    const winRate = total > 0 ? (correct / total) * 100 : 0;

    const existing = await db.$queryRaw`
      SELECT id FROM analyst_performance WHERE analyst_id = ${analystId}
    `;

    if ((existing as Record<string, unknown>[]).length > 0) {
      await db.$executeRaw`
        UPDATE analyst_performance
        SET 
          total_predictions = ${total},
          correct_predictions = ${correct},
          wrong_predictions = ${Number(s?.wrong || 0)},
          win_rate = ${winRate},
          total_return_pct = ${Number(s?.total_return || 0)},
          avg_return_per_trade = ${Number(s?.avg_return || 0)},
          best_return = ${s?.best_return || null},
          worst_return = ${s?.worst_return || null},
          updated_at = datetime('now')
        WHERE analyst_id = ${analystId}
      `;
    } else {
      const id = crypto.randomUUID();
      const level = winRate >= 70 ? 'expert' : winRate >= 50 ? 'intermediate' : 'beginner';
      
      await db.$executeRaw`
        INSERT INTO analyst_performance (
          id, analyst_id, total_predictions, correct_predictions, wrong_predictions,
          win_rate, total_return_pct, avg_return_per_trade, best_return, worst_return,
          level, created_at, updated_at
        ) VALUES (
          ${id},
          ${analystId},
          ${total},
          ${correct},
          ${Number(s?.wrong || 0)},
          ${winRate},
          ${Number(s?.total_return || 0)},
          ${Number(s?.avg_return || 0)},
          ${s?.best_return || null},
          ${s?.worst_return || null},
          ${level},
          datetime('now'),
          datetime('now')
        )
      `;
    }
  } catch (error) {
    console.error('Error updating analyst performance:', error);
  }
}
