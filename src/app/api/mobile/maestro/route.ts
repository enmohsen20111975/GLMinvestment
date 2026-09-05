/**
 * Mobile Maestro API - Maestro Orchestration System
 * نظام المايسترو - التنسيق والتحليل المتقدم
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'status'; // status | signals | config | personas

    // Try Python backend first
    try {
      const response = await fetch(`${PYTHON_BACKEND_URL}/api/maestro/${action}`, {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json({
          success: true,
          timestamp: new Date().toISOString(),
          ...data,
          source: 'python_backend',
        });
      }
    } catch (e) {
      console.warn('[Mobile Maestro] Python backend error:', e);
    }

    // Fallback: Provide default maestro data
    const defaultResponse: any = {
      status: 'active',
      mode: 'balanced',
      personas: [
        { id: 'conservative', name: 'محافظ', name_en: 'Conservative', risk_level: 1 },
        { id: 'balanced', name: 'متوازن', name_en: 'Balanced', risk_level: 2 },
        { id: 'aggressive', name: 'عدواني', name_en: 'Aggressive', risk_level: 3 },
      ],
      signals: [],
      config: {
        max_signals_per_day: 10,
        min_confidence: 60,
        risk_per_trade: 5,
        max_open_positions: 5,
      },
      last_run: new Date().toISOString(),
    };

    if (action === 'signals') {
      // Get REAL signals from stored_analyses table (predictions.db) — no fabrication
      try {
        const Database = (await import('better-sqlite3')).default;
        const path = (await import('path')).default;
        const { existsSync } = await import('fs');
        const predictionsDbPath = path.join(process.cwd(), 'db', 'predictions.db');
        if (existsSync(predictionsDbPath)) {
          const predDb = new Database(predictionsDbPath, { readonly: true, timeout: 5000 });
          predDb.pragma('busy_timeout = 5000');
          // Pull the most recent real analyses — confidence comes from the analysis engine
          const rows = predDb.prepare(`
            SELECT ticker, market, maestro_score, confidence, recommendation,
                   recommendation_ar, entry_price, target_price, stop_loss,
                   regime, created_at
            FROM stored_analyses
            WHERE confidence IS NOT NULL AND confidence > 0
            ORDER BY created_at DESC
            LIMIT 20
          `).all() as any[];
          predDb.close();

          // Map stored analysis → signal (no Math.random)
          const signals = rows.map((r) => {
            const rec = String(r.recommendation || '').toLowerCase();
            let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
            if (rec.includes('buy') || rec.includes('شراء') || rec.includes('accum')) signal = 'BUY';
            else if (rec.includes('sell') || rec.includes('بيع') || rec.includes('reduce')) signal = 'SELL';
            return {
              ticker: r.ticker,
              name_ar: r.recommendation_ar || r.ticker,
              signal,
              // Use the REAL confidence stored by the analysis engine (clamp 0-100)
              confidence: Math.max(0, Math.min(100, Math.round(Number(r.confidence) || 0))),
              price: r.entry_price || 0,
              change_percent: 0, // not stored per-signal — caller can fetch from price API
              market: r.market,
              maestro_score: r.maestro_score,
              target_price: r.target_price,
              stop_loss: r.stop_loss,
              created_at: r.created_at,
            };
          }).filter((s: any) => s.signal !== 'HOLD');

          defaultResponse.signals = signals;
        }
      } catch (e) {
        console.warn('[Mobile Maestro] Local signals error:', e);
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...defaultResponse,
      source: 'fallback',
    });
  } catch (error: any) {
    console.error('[Mobile Maestro API] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'خطأ في نظام المايسترو',
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Forward to Python backend
    const response = await fetch(`${PYTHON_BACKEND_URL}/api/maestro/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({
      success: false,
      error: 'فشل في تشغيل المايسترو',
    }, { status: 500 });
  } catch (error: any) {
    console.error('[Mobile Maestro API] POST error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'خطأ في تشغيل المايسترو',
    }, { status: 500 });
  }
}
