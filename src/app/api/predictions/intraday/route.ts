/**
 * Intraday Realtime Predictions API (كل 5 دقائق)
 * ==============================================
 * يجلب التوقعات اللحظية المكتشفة من بيانات الـ 5 دقائق (V40.2 + V76 + Maker Flow)
 * يدعم الفحص الفوري عبر ?scan=true
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import Database from 'better-sqlite3';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const PREDICTIONS_DB = path.join(process.cwd(), 'db', 'predictions.db');

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const shouldScan = searchParams.get('scan') === 'true';
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  try {
    // 1. إذا طلب فحص فوري
    if (shouldScan) {
      try {
        const scannerScript = path.join(process.cwd(), 'vps-service', 'jobs', 'v40_2_intraday_scanner.py');
        await execAsync(`python3 "${scannerScript}" --limit ${limit}`, { timeout: 30000 });
      } catch (scanErr: any) {
        console.error('[API/intraday] Scan error:', scanErr.message);
      }
    }

    // 2. قراءة التوقعات اللحظية من predictions.db
    const db = new Database(PREDICTIONS_DB, { readonly: true });
    
    // البحث عن التوقعات اللحظية
    const rows = db.prepare(`
      SELECT 
        id, ticker, signal, entry_price, target_price, stop_loss,
        master_score, technical_score, prediction_date,
        target_price_2, kill_filter_result, created_at, status
      FROM predictions
      WHERE kill_filter_result LIKE '%INTRADAY%'
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as any[];

    db.close();

    const formatted = rows.map(r => {
      const risk = Math.max(0.01, (r.entry_price || 0) - (r.stop_loss || 0));
      const target = r.target_price || 0;
      const rr = risk > 0 ? ((target - (r.entry_price || 0)) / risk).toFixed(2) : '0';
      return {
        id: r.id,
        ticker: r.ticker,
        signal: r.signal,
        entryPrice: r.entry_price,
        targetPrice: r.target_price,
        targetPrice2: r.target_price_2,
        stopLoss: r.stop_loss,
        riskReward: parseFloat(rr),
        score: r.master_score || r.technical_score || 0,
        predictionDate: r.prediction_date,
        createdAt: r.created_at,
        status: r.status || 'PENDING',
        details: r.kill_filter_result || ''
      };
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: formatted.length,
      data: formatted
    });

  } catch (err: any) {
    console.error('[API/intraday] Error:', err);
    return NextResponse.json({
      success: false,
      error: err.message || 'Failed to fetch intraday predictions'
    }, { status: 500 });
  }
}
