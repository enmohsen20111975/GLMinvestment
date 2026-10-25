/**
 * Live Predictions API
 * ====================
 * يجلب التوقعات من قاعدة البيانات مباشرة
 * تتولد التوقعات من vps-service (port 8010) — Python THE BRAIN
 * 
 * المعمارية:
 * VPS-Service (8010) → يولّد التوقعات ويحفظها في predictions.db
 * Data-Engine (5000) → يجلب البيانات ويحضّرها
 * Next.js (3000)     → يعرض فقط (DISPLAY ONLY)
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import Database from 'better-sqlite3';
import path from 'path';
import { applyValidatedTargets } from '@/lib/targets-validator';

const PREDICTIONS_DB = path.join(process.cwd(), 'db', 'predictions.db');
// VPS Python Backend — THE BRAIN (توليد التوقعات والمنطق كله)
const VPS_URL = process.env.PYTHON_BACKEND_URL || process.env.VPS_SERVICE_URL || 'http://localhost:8010';

interface Prediction {
  id: string;
  stock_symbol: string;
  stock_name_ar: string;
  maestro_score: number;
  confidence: number;
  signal_type: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  prediction_date: string;
  status: string;
  market: string;
  notes: string;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const market = searchParams.get('market') || 'all';
  const signal = searchParams.get('signal') || 'all';
  const limit = parseInt(searchParams.get('limit') || '100');
  const refresh = searchParams.get('refresh') === 'true';

  try {
    // إذا طلب تحديث، نطلب من vps-service توليد توقعات جديدة
    if (refresh) {
      try {
        await fetch(`${VPS_URL}/api/ai-predictions/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ market })
        });
      } catch (e) {
        console.log('VPS service not available for refresh — reading from DB cache');
      }
    }

    // فتح قاعدة البيانات
    const db = new Database(PREDICTIONS_DB, { readonly: true });

    // التاريخ الحالي
    const today = new Date().toISOString().split('T')[0];

    // FIX (Aug 2026): aiPrediction table فاضي (0 صفوف) — استخدم predictions table
    // predictions table فيها 91 صف، والـ schema فيها: prediction_date, signal, signal_type,
    // market, master_score, confidence, entry_price, target_price, stop_loss, etc.
    // بناء الاستعلام
    let query = `
      SELECT ticker, signal, signal_type, prediction_date, entry_price,
             target_price, stop_loss, master_score, technical_score,
             fundamental_score, ai_pattern_score, sentiment_score,
             market, confidence, outcome_date, exit_price, actual_return,
             hit_target, hit_stop, is_correct, holding_days
      FROM predictions
      WHERE prediction_date = ?
    `;
    const params: (string | number)[] = [today];

    if (market !== 'all') {
      query += ` AND market = ?`;
      params.push(market);
    }

    if (signal !== 'all') {
      query += ` AND signal = ?`;
      params.push(signal.toUpperCase());
    }

    query += ` ORDER BY master_score DESC LIMIT ?`;
    params.push(limit);

    const predictions = db.prepare(query).all(...params) as Prediction[];

    // FIX-P4-TARGETS: signal-aware validation قبل ما نرجّع الـ response.
    // الـ predictions اللي بتيجي من DB ممكن يكون فيها targets مكسورة (stop فوق entry،
    // target تحت entry، إلخ). الـ validator بـ يصلّحها أو بـ يرجّع null لو مفيش entry.
    // signal بـ يحدد اتجاه الـ validation: BUY → stop<entry, target>entry
    //                                  SELL → stop>entry, target<entry
    const validatedPredictions = predictions.map((p: any) => {
      const v = applyValidatedTargets({
        signal: p.signal || 'BUY',
        entry_price: p.entry_price,
        target1: p.target_price,
        stop_loss: p.stop_loss,
      });
      return {
        ...p,
        signal: v.signal,
        entry_price: v.entry_price,
        target_price: v.target1,
        stop_loss: v.stop_loss,
        risk_reward_ratio: v.risk_reward_ratio,
      };
    });

    // إحصائيات
    const statsQuery = `
      SELECT
        COUNT(*) as total,
        AVG(master_score) as avg_score,
        AVG(confidence) as avg_confidence,
        SUM(CASE WHEN signal IN ('BUY', 'STRONG_BUY') THEN 1 ELSE 0 END) as buy_signals,
        SUM(CASE WHEN signal IN ('SELL', 'STRONG_SELL') THEN 1 ELSE 0 END) as sell_signals,
        SUM(CASE WHEN signal = 'HOLD' THEN 1 ELSE 0 END) as hold_signals
      FROM predictions
      WHERE prediction_date = ?
    `;
    const stats = db.prepare(statsQuery).get(today) as any;

    // توزيع الأسواق
    const marketStats = db.prepare(`
      SELECT market, COUNT(*) as count
      FROM predictions
      WHERE prediction_date = ?
      GROUP BY market
    `).all(today) as any[];

    db.close();

    // التحقق من حالة VPS-Service
    let engineStatus = 'unknown';
    try {
      const vpsRes = await fetch(`${VPS_URL}/health`, { signal: AbortSignal.timeout(2000) });
      engineStatus = vpsRes.ok ? 'running' : 'degraded';
    } catch {
      engineStatus = 'offline';
    }

    return NextResponse.json({
      success: true,
      date: today,
      predictions: validatedPredictions,
      stats: {
        total: stats?.total || 0,
        avg_score: Math.round(stats?.avg_score || 0),
        avg_confidence: Math.round(stats?.avg_confidence || 0),
        buy_signals: stats?.buy_signals || 0,
        sell_signals: stats?.sell_signals || 0,
        hold_signals: stats?.hold_signals || 0,
        by_market: marketStats.reduce((acc, m) => {
          acc[m.market] = m.count;
          return acc;
        }, {} as Record<string, number>)
      },
      engine: {
        status: engineStatus,
        url: VPS_URL
      }
    });

  } catch (error) {
    console.error('Live Predictions API Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch live predictions',
      details: String(error)
    }, { status: 500 });
  }
}

// تحديث التوقعات يدوياً — يستدعي vps-service (THE BRAIN)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const market = body.market || 'all';

    // طلب من vps-service (Python) توليد توقعات جديدة
    const response = await fetch(`${VPS_URL}/api/ai-predictions/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market }),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`VPS service error (${response.status}): ${errText}`);
    }

    const result = await response.json();

    return NextResponse.json({
      success: true,
      message: `تم توليد توقعات جديدة`,
      source: 'vps-service',
      ...result
    });

  } catch (error) {
    console.error('Trigger Predictions Error:', error);
    return NextResponse.json({
      success: false,
      error: 'فشل في طلب توليد التوقعات من vps-service',
      details: String(error)
    }, { status: 500 });
  }
}
