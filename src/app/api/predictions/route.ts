/**
 * Predictions API
 * ===============
 * يجلب التوقعات من Python Backend مع fallback لـ data_engine.db
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getSessionUserId } from '@/lib/auth-helper';
import Database from 'better-sqlite3';
import path from 'path';

export const revalidate = 30; // Cache for 30s

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get('type') || 'all';
  const requestedLimit = searchParams.get('limit') || '50';
  const market = searchParams.get('market') || '';

  // Task 13: limit unauthenticated visitors to 3 predictions.
  const { userId } = await getSessionUserId();
  const isAuthenticated = !!userId;
  const limit = isAuthenticated ? requestedLimit : String(Math.min(parseInt(requestedLimit, 10) || 50, 3));

  // 1. Try Python Backend
  try {
    const qs = new URLSearchParams({ limit });
    if (type && type !== 'all') qs.set('signal', type);
    if (market) qs.set('market', market);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(
      `${PYTHON_BACKEND_URL}/api/v2/predictions?${qs.toString()}`,
      {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      const predictions = data.predictions || data.data || [];
      return NextResponse.json({
        success: true,
        authenticated: isAuthenticated,
        limited: !isAuthenticated,
        data: predictions,
        stats: {
          total: predictions.length,
          avgScore: data.stats?.avg_score || 0,
        },
        source: 'python_backend',
      });
    }
  } catch (e) {
    console.warn('[/api/predictions] Python backend error:', e);
  }

  // 2. Fallback: query predictions.db directly
  try {
    const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
    let db: Database.Database;
    try {
      db = new Database(dbPath, { readonly: true, timeout: 3000 });
    } catch (e) {
      db = new Database(`file:${dbPath}?immutable=1`, { timeout: 3000 });
    }

    // FIX (Aug 2026): aiPrediction table فاضي (0 صفوف) — استخدم predictions table
    // الـ schema: ticker, signal, prediction_date, entry_price, target_price, stop_loss,
    // master_score, confidence, market, outcome_date, exit_price, actual_return
    let query = `
      SELECT
        id,
        ticker,
        signal,
        signal_type,
        prediction_date,
        entry_price,
        target_price,
        stop_loss,
        master_score,
        confidence,
        market,
        outcome_date,
        exit_price,
        actual_return,
        hit_target,
        hit_stop,
        is_correct,
        holding_days,
        created_at
      FROM predictions
      ORDER BY prediction_date DESC, master_score DESC
      LIMIT ?`;
    const predictions = db.prepare(query).all(parseInt(limit)) as any[];
    db.close();

    return NextResponse.json({
      success: true,
      authenticated: isAuthenticated,
      limited: !isAuthenticated,
      data: predictions,
      stats: {
        total: predictions.length,
        avgScore: predictions.length > 0
          ? Math.round(predictions.reduce((s, p) => s + (p.confidence || p.master_score || 0), 0) / predictions.length)
          : 0,
      },
      source: 'local_db',
    });
  } catch (e) {
    console.warn('[/api/predictions] Local DB error:', e);
  }

  // 3. Final fallback: empty but success
  return NextResponse.json({
    success: true,
    data: [],
    stats: { total: 0, avgScore: 0 },
    source: 'empty',
    note: 'لا توجد توقعات متاحة حالياً',
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Forward to Python backend
    const response = await fetch(`${PYTHON_BACKEND_URL}/api/v2/predictions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      return NextResponse.json(await response.json());
    }
  } catch (e) {
    console.warn('[/api/predictions] POST error:', e);
  }

  return NextResponse.json({
    success: false,
    error: 'فشل في توليد التوقعات. حاول مرة أخرى لاحقاً.',
  }, { status: 500 });
}
