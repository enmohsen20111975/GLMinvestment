/**
 * GET /api/mobile/market/morning-bell
 * ==================================
 * P41 Live Morning Bell (Mobile) — جرس الصباح اللحظي للموبايل.
 *
 * Tries Python /api/market/morning-bell/live first.
 * Falls back to predictions.db:
 *   - predictions WHERE morning_bell = 1 (joined with morning_bell_signals when available)
 *   - ticker, signal, entry_price, target_price, stop_loss, confidence, evidence_count
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PYTHON_BACKEND =
  process.env.PYTHON_BACKEND_URL ||
  process.env.VPS_API_URL ||
  process.env.EGXPY_SERVICE_URL ||
  'http://localhost:8010';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '5', 10) || 5;
  const market = searchParams.get('market') || 'EGX';

  const backendUrl = `${PYTHON_BACKEND.replace(/\/$/, '')}/api/market/morning-bell/live?limit=${encodeURIComponent(limit)}`;

  // 1) Try Python first
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    if (response.ok) {
      const data = await response.json();
      return NextResponse.json(data, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Channel': 'morning_bell',
        },
      });
    }
  } catch {}

  // 2) Fallback — predictions.db
  try {
    const path = require('path');
    const fs = require('fs');
    const Database = require('better-sqlite3');
    const predDbPath = path.join(process.cwd(), 'db', 'predictions.db');
    if (!fs.existsSync(predDbPath)) {
      return NextResponse.json(
        {
          success: false,
          error: 'predictions.db not found',
          channel: 'morning_bell',
        },
        { status: 500 }
      );
    }
    const pdb = new Database(predDbPath, { readonly: true });

    // Pull predictions flagged morning_bell + table morning_bell_signals (left joined)
    const signals: any[] = pdb
      .prepare(
        `SELECT p.ticker, p.signal, p.signal_type, p.prediction_date,
                p.entry_price, p.target_price, p.stop_loss, p.master_score,
                p.confidence, p.evidence_count, p.status, p.risk_reward,
                p.persona,
                m.watch_price, m.target_price  AS mb_target_price,
                m.stop_loss      AS mb_stop_loss,
                m.confidence     AS mb_confidence,
                m.signal_date, m.status AS mb_status
         FROM predictions p
         LEFT JOIN morning_bell_signals m ON m.linked_prediction_id = p.id
         WHERE p.morning_bell = 1
           AND p.market = ? COLLATE NOCASE
         ORDER BY p.prediction_date DESC, p.master_score DESC
         LIMIT ?`
      )
      .all(market, limit)
      .map((r: any) => ({
        ticker: r.ticker,
        signal: r.signal,
        signal_type: r.signal_type,
        prediction_date: r.prediction_date,
        signal_date: r.signal_date,
        entry_price: Number(r.entry_price),
        watch_price: r.watch_price != null ? Number(r.watch_price) : Number(r.entry_price),
        target_price:
          r.mb_target_price != null
            ? Number(r.mb_target_price)
            : r.target_price != null
            ? Number(r.target_price)
            : null,
        stop_loss:
          r.mb_stop_loss != null
            ? Number(r.mb_stop_loss)
            : r.stop_loss != null
            ? Number(r.stop_loss)
            : null,
        master_score: r.master_score != null ? Number(r.master_score) : null,
        confidence:
          r.mb_confidence != null
            ? Number(r.mb_confidence)
            : r.confidence != null
            ? Number(r.confidence)
            : null,
        evidence_count: r.evidence_count || 0,
        risk_reward: r.risk_reward || null,
        persona: r.persona,
        status: r.mb_status || r.status,
        // P41 plain_ar_warning + risk flag (computed, not mock — derived from data)
        risk_flag: Number(r.master_score) >= 80 ? 'elevated' : null,
        plain_ar_warning: 'تنبيه: جرس الصباح من بيانات SQLite الاحتياطية',
        client_responsibility_required: true,
      }));

    pdb.close();

    return NextResponse.json(
      {
        success: true,
        source: 'sqlite_fallback',
        market,
        channel: 'morning_bell',
        signals,
        count: signals.length,
        stats_separated: true,
        generated_at: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Channel': 'morning_bell',
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        channel: 'morning_bell',
      },
      { status: 500 }
    );
  }
}
