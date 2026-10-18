/**
 * GET /api/stored-analysis/results
 * =================================
 * P0-FIX (API-FALLBACKS-WAVE-2): fallback to SQLite when Python backend is down.
 * Reads from predictions.db.predictions — no mock data (Rule 27).
 *
 * Tries Python /api/stored-analysis/results first (20s timeout — preserves
 * paywall logic on success). On failure, returns latest 100 analyses WHERE
 * market=? ORDER BY prediction_date DESC.
 *
 * Shape: { success, source: 'sqlite_fallback', analyses: [...], count, market }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPaywallUser, applyPaywallToResults } from '@/lib/paywall';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PYTHON_BACKEND =
  process.env.PYTHON_BACKEND_URL ||
  process.env.VPS_API_URL ||
  process.env.EGXPY_SERVICE_URL ||
  'http://localhost:8010';

const MARKET_MAP: Record<string, string> = {
  EGX: 'EGX',
  TADAWUL: 'TADAWUL',
  KSA: 'TADAWUL',
  KSE: 'KSE',
  QSE: 'QSE',
  US: 'US',
  CRYPTO: 'CRYPTO',
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const marketRaw = (searchParams.get('market') || 'EGX').toUpperCase();
  const market = MARKET_MAP[marketRaw] || 'EGX';
  const limitRaw = Number(searchParams.get('limit') || 100);
  const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 100));
  const minScore = searchParams.get('min_score');
  const persona = searchParams.get('persona')?.trim().toLowerCase();
  const recommendation = searchParams.get('recommendation')?.trim().toUpperCase();

  const params = new URLSearchParams({
    market,
    limit: String(limit),
    min_score: minScore || '0',
  });
  if (persona) params.set('persona', persona);
  if (recommendation) params.set('recommendation', recommendation);

  const backendUrl = `${PYTHON_BACKEND.replace(/\/$/, '')}/api/stored-analysis/results?${params.toString()}`;

  // 1) Try Python first (preserve legacy 20s timeout)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      const user = await getPaywallUser(request);
      if (data.results && Array.isArray(data.results)) {
        data.results = applyPaywallToResults(data.results, user.is_premium);
      }
      if (data.data && Array.isArray(data.data)) {
        data.data = applyPaywallToResults(data.data, user.is_premium);
      }
      data._paywall = { is_premium: user.is_premium };
      return NextResponse.json(data);
    }
  } catch (err) {
    console.error(
      '[/api/stored-analysis/results] proxy error:',
      err instanceof Error ? err.message : String(err)
    );
  }

  // 2) Fallback — read from predictions.db
  try {
    const path = require('path');
    const fs = require('fs');
    const predictionsDbPath = path.join(process.cwd(), 'db', 'predictions.db');
    if (!fs.existsSync(predictionsDbPath)) {
      return NextResponse.json(
        { success: false, error: 'predictions.db not found', results: [] },
        { status: 500 }
      );
    }
    const Database = require('better-sqlite3');
    const db = new Database(predictionsDbPath, { readonly: true });

    // Prefer stored_analyses table if it exists (mirrors Python schema)
    const tableCheck = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='stored_analyses'"
      )
      .get() as { name: string } | undefined;

    let rows: Array<Record<string, unknown>> = [];
    if (tableCheck) {
      // stored_analyses has a subset of the predictions columns — only SELECT
      // columns that actually exist to avoid "no such column" errors.
      const availableCols = new Set(
        (db.prepare('PRAGMA table_info(stored_analyses)').all() as Array<{ name: string }>).map(
          (c) => c.name
        )
      );
      const want: Array<string> = [
        'ticker', 'market', 'sector', 'name_ar',
        'recommendation', 'recommendation_ar', 'signal', 'signal_ar',
        'maestro_score', 'master_score', 'confidence',
        'entry_price', 'target_price', 'target_price_2', 'stop_loss',
        'risk_reward', 'persona', 'prediction_date', 'status',
        'exit_type', 'horizon', 'evidence_count', 'kill_filter_result',
        'technical_score', 'explosive_score',
      ];
      const cols = want.filter((c) => availableCols.has(c)).join(', ');

      const where: string[] = ['market = ?'];
      const sqlParams: unknown[] = [market];
      // RESTRUCT-TEST-FIX-1: guard minScore/persona queries against missing columns.
      // stored_analyses schema varies (some columns absent) → only apply filter if column exists.
      const hasMasterScore = availableCols.has('master_score');
      if (minScore && !Number.isNaN(Number(minScore))) {
        if (hasMasterScore) {
          where.push('COALESCE(maestro_score, master_score, 0) >= ?');
        } else {
          where.push('COALESCE(maestro_score, 0) >= ?');
        }
        sqlParams.push(Number(minScore));
      }
      if (persona && persona !== 'all' && availableCols.has('persona')) {
        where.push("LOWER(COALESCE(persona, '')) = ?");
        sqlParams.push(persona);
      }
      if (recommendation) {
        where.push('(UPPER(recommendation) = ? OR UPPER(signal) = ?)');
        sqlParams.push(recommendation, recommendation);
      }
      const orderByCol = hasMasterScore ? 'master_score' : 'maestro_score';
      const sql = `
        SELECT ${cols}
        FROM stored_analyses
        WHERE ${where.join(' AND ')}
        ORDER BY prediction_date DESC, ${orderByCol} DESC
        LIMIT ?
      `;
      // FRESHNESS-CHECK (Task PHASE-3, Rule 72)
      // TODO: Append `AND updated_at >= datetime('now', '-2 days')` to where[]
      //       so stale analyses (older than 2 days) are filtered out from results.
      sqlParams.push(limit);
      rows = db.prepare(sql).all(...sqlParams) as Array<Record<string, unknown>>;
    } else {
      // Use predictions table as the source of stored analyses
      // RESTRUCT-TEST-FIX-1: guard against missing columns in predictions table (schema varies).
      const predCols = new Set(
        (db.prepare('PRAGMA table_info(predictions)').all() as Array<{ name: string }>).map(
          (c) => c.name
        )
      );
      const where: string[] = ['market = ?'];
      const sqlParams: unknown[] = [market];
      if (minScore && !Number.isNaN(Number(minScore))) {
        where.push('COALESCE(master_score, 0) >= ?');
        sqlParams.push(Number(minScore));
      }
      if (persona && persona !== 'all' && predCols.has('persona')) {
        where.push("LOWER(COALESCE(persona, '')) = ?");
        sqlParams.push(persona);
      }
      if (recommendation) {
        where.push('(UPPER(signal) = ? OR UPPER(signal_type) = ?)');
        sqlParams.push(recommendation, recommendation);
      }
      // RESTRUCT-TEST-FIX-1: build SELECT list dynamically from available columns.
      const predWant: Array<string> = [
        'ticker', 'market', 'signal', 'signal_type', 'signal_ar',
        'master_score', 'maestro_score', 'technical_score', 'confidence',
        'entry_price', 'target_price', 'target_price_2', 'stop_loss',
        'risk_reward', 'persona', 'prediction_date', 'status',
        'exit_type', 'horizon', 'evidence_count', 'kill_filter_result',
        'explosive_score',
      ];
      const predSelect = predWant.filter((c) => predCols.has(c)).join(', ');
      const orderByPred = predCols.has('master_score') ? 'master_score' : 'prediction_date';
      const sql = `
        SELECT ${predSelect || 'ticker, market'}
        FROM predictions
        WHERE ${where.join(' AND ')}
        ORDER BY prediction_date DESC, ${orderByPred} DESC
        LIMIT ?
      `;
      sqlParams.push(limit);
      rows = db.prepare(sql).all(...sqlParams) as Array<Record<string, unknown>>;
    }
    db.close();

    // Join sector + name_ar from stocks.db if missing
    let stocksLookup: Map<string, { sector: string; name_ar: string }> = new Map();
    try {
      const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
      if (fs.existsSync(stocksDbPath)) {
        const stocksDb = new Database(stocksDbPath, { readonly: true });
        const stockRows = stocksDb
          .prepare(`SELECT ticker, sector, name_ar, logo_url FROM stocks`)
          .all() as Array<Record<string, unknown>>;
        for (const r of stockRows) {
          stocksLookup.set(String(r.ticker), {
            sector: String(r.sector || ''),
            name_ar: String(r.name_ar || r.ticker || ''),
            logo_url: r.logo_url ? String(r.logo_url) : null,
          });
        }
        stocksDb.close();
      }
    } catch {}

    const analyses = rows.map((r) => {
      const lookup = stocksLookup.get(String(r.ticker));
      return {
        ticker: String(r.ticker || ''),
        market: String(r.market || market),
        sector: r.sector ?? lookup?.sector ?? null,
        name_ar: r.name_ar ?? lookup?.name_ar ?? String(r.ticker || ''),
        logo_url: lookup?.logo_url ?? (r.logo_url ? String(r.logo_url) : null),
        recommendation:
          r.recommendation ?? (r.signal ? String(r.signal).toLowerCase() : null),
        recommendation_ar: r.recommendation_ar ?? r.signal_ar ?? null,
        signal: r.signal ?? null,
        maestro_score:
          r.maestro_score !== undefined
            ? Number(r.maestro_score)
            : r.master_score !== undefined
              ? Number(r.master_score)
              : 0,
        master_score: r.master_score !== undefined ? Number(r.master_score) : 0,
        confidence: r.confidence === null || r.confidence === undefined
          ? null
          : Number(r.confidence),
        entry_price: Number(r.entry_price ?? 0),
        target_price: Number(r.target_price ?? 0),
        target_price_2:
          r.target_price_2 === null || r.target_price_2 === undefined
            ? null
            : Number(r.target_price_2),
        stop_loss: Number(r.stop_loss ?? 0),
        risk_reward: Number(r.risk_reward ?? 0),
        persona: r.persona === null || r.persona === undefined ? null : String(r.persona),
        prediction_date: String(r.prediction_date || ''),
        status: r.status === null || r.status === undefined ? null : String(r.status),
        exit_type: r.exit_type === null || r.exit_type === undefined ? null : String(r.exit_type),
        horizon: r.horizon === null || r.horizon === undefined ? null : String(r.horizon),
        evidence_count:
          r.evidence_count === null || r.evidence_count === undefined
            ? null
            : Number(r.evidence_count),
        kill_filter_result:
          r.kill_filter_result === null || r.kill_filter_result === undefined
            ? null
            : String(r.kill_filter_result),
        technical_score:
          r.technical_score === null || r.technical_score === undefined
            ? null
            : Number(r.technical_score),
        explosive_score:
          r.explosive_score === null || r.explosive_score === undefined
            ? null
            : Number(r.explosive_score),
      };
    });

    // Apply paywall to results too (parity with Python path)
    const user = await getPaywallUser(request);
    const paywalled = applyPaywallToResults(analyses, user.is_premium);

    return NextResponse.json({
      success: true,
      source: 'sqlite_fallback',
      analyses: paywalled,
      results: paywalled, // alias — some callers use `results`, others use `analyses`
      data: paywalled, // alias for smart-confluence consumers
      count: paywalled.length,
      market,
      _paywall: { is_premium: user.is_premium },
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[stored-analysis:results]', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        results: [],
        analyses: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}
