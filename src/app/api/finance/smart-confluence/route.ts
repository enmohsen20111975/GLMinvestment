/**
 * GET /api/finance/smart-confluence
 * =================================
 * P0-FIX (API-FALLBACKS-WAVE-2): improve SQLite fallback.
 * Reads from predictions.db.predictions (and tries stored_analyses table if present).
 *
 * Tries Python backend /api/smart-confluence/predictions first (5s timeout).
 * On failure, falls back to SQLite (predictions table — latest BUY / STRONG_BUY).
 *
 * For each prediction computes a confluence_score from:
 *   master_score + technical_score + (risk_reward * 10)
 *
 * risk_reward is computed dynamically from (entry/target/stop) — see
 * src/lib/risk-reward.ts. The DB column risk_reward is often 0/null so we
 * always override it with the calculated value when inputs are valid.
 *
 * Returns top-20:
 *   { ticker, signal, entry_price, target_price, stop_loss,
 *     risk_reward, master_score, confluence_score, prediction_date, market }
 *
 * Shape: { success, source: 'sqlite_fallback', data: [...], count }
 *
 * Also supports POST with { markets: [...], totalLimit: N } — preserved from
 * legacy signature so the PicksManagementView mobile client keeps working.
 */

import { NextRequest, NextResponse } from 'next/server';
import { computeRiskReward, preferComputedRiskReward } from '@/lib/risk-reward';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

interface ConfluencePick {
  ticker: string;
  market: string;
  signal: string;
  recommendation: string;
  recommendation_ar: string;
  score: number;
  confidence: number;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  risk_reward: number;
  master_score: number;
  confluence_score: number;
  prediction_date: string;
  sector: string;
  name_ar: string;
}

export async function GET(req: NextRequest) {
  return handleRequest(req, 'GET');
}

export async function POST(req: NextRequest) {
  return handleRequest(req, 'POST');
}

async function handleRequest(req: NextRequest, method: 'GET' | 'POST') {
  try {
    // افتراضياً نجيب من كل الأسواق (EGX + CRYPTO + غيرها) عشان مفيش بيانات تضيع.
    // المستخدم يقدر يفلتر بـ ?markets=EGX لو حابب.
    let markets: string[] = ['EGX', 'CRYPTO', 'TADAWUL', 'KSE', 'QSE'];
    let totalLimit = 20;

    if (method === 'POST') {
      try {
        const body = await req.json();
        if (Array.isArray(body.markets)) {
          markets = body.markets.map((m: string) => String(m).toUpperCase());
        }
        if (typeof body.totalLimit === 'number') {
          totalLimit = Math.max(1, Math.min(100, body.totalLimit));
        }
      } catch {}
    } else {
      const url = new URL(req.url);
      const m = url.searchParams.get('markets');
      if (m) markets = m.split(',').map((s) => s.trim().toUpperCase());
      const lim = url.searchParams.get('limit');
      if (lim && !Number.isNaN(Number(lim))) {
        totalLimit = Math.max(1, Math.min(100, Number(lim)));
      }
    }

    // 1) Try Python first (5s timeout — keep parity with other fallbacks)
    try {
      const qs = new URLSearchParams({
        markets: markets.join(','),
        limit: String(totalLimit),
      }).toString();
      const targetUrl = `${PY}/api/smart-confluence/predictions?${qs}`;
      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const pyData = await res.json();
        if (pyData.success && Array.isArray(pyData.predictions)) {
          let mapped: ConfluencePick[] = pyData.predictions.map((p: any) => {
            const entryPrice = Number(p.entry_price || p.price || 0);
            const targetPrice = Number(p.target_price || 0);
            const stopLoss = Number(p.stop_loss || 0);
            const storedRr = Number(p.risk_reward || 0);
            return {
              ticker: String(p.symbol || p.ticker || ''),
              market: String(p.market || 'EGX'),
              signal: String(p.signal || p.recommendation || 'HOLD'),
              recommendation: String(p.recommendation || p.signal || 'HOLD'),
              recommendation_ar: String(p.signal_ar || p.recommendation_ar || ''),
              score: Number(p.confidence || p.confluence_score || p.score || 0),
              confidence: Number(p.confidence || 0),
              entry_price: entryPrice,
              target_price: targetPrice,
              stop_loss: stopLoss,
              // P0-FIX (PHASE1-CRITICAL-FIXES): prefer stored R:R if it's > 0,
              // otherwise compute from entry/target/stop.
              risk_reward: preferComputedRiskReward(entryPrice, targetPrice, stopLoss, storedRr),
              master_score: Number(p.master_score || p.maestro_score || 0),
              confluence_score: Number(p.confluence_score || p.score || 0),
              prediction_date: String(p.prediction_date || p.date || ''),
              sector: String(p.sector || ''),
              name_ar: String(p.name_ar || p.name || p.ticker || ''),
            };
          });
          if (markets.length > 0 && !markets.includes('ALL')) {
            mapped = mapped.filter((p) =>
              markets.some(
                (m) =>
                  p.market.toUpperCase().includes(m) ||
                  p.ticker.toUpperCase().includes(m)
              )
            );
          }
          return NextResponse.json({
            success: true,
            data: mapped.slice(0, totalLimit),
            count: mapped.length,
            source: 'python',
          });
        }
      }
    } catch {}

    // 2) Fallback — read from predictions.db
    try {
      const path = require('path');
      const fs = require('fs');
      const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
      if (!fs.existsSync(dbPath)) {
        return NextResponse.json(
          { success: false, error: 'تعذّر الوصول إلى قاعدة بيانات التوقعات', data: [], count: 0 },
          { status: 500 }
        );
      }
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });

      const placeH = markets.map(() => '?').join(',');
      // FIX: الـ status في الـ DB ممكن يكون lowercase ('active') أو uppercase ('ACTIVE').
      // بنستخدم UPPER() للمقارنة case-insensitive.
      const rows = db.prepare(`
        SELECT
          ticker, signal, market,
          entry_price, target_price, stop_loss, risk_reward,
          master_score, technical_score, confidence, maestro_score,
          prediction_date, persona, status
        FROM predictions
        WHERE signal IN ('BUY','STRONG_BUY')
          AND UPPER(status) = 'ACTIVE'
          AND market IN (${placeH})
        ORDER BY
          (COALESCE(master_score, 0) + COALESCE(technical_score, 0) + COALESCE(risk_reward, 0) * 10) DESC,
          prediction_date DESC
        LIMIT ?
      `).all(...markets, totalLimit) as Array<Record<string, unknown>>;

      // Optional: pull sector + name_ar from stocks.db so the UI shows readable rows
      let stocksLookup: Map<string, { sector: string; name_ar: string }> = new Map();
      try {
        const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
        if (fs.existsSync(stocksDbPath)) {
          const stocksDb = new Database(stocksDbPath, { readonly: true });
          const stockRows = stocksDb
            .prepare(`SELECT ticker, sector, name_ar FROM stocks`)
            .all() as Array<Record<string, unknown>>;
          for (const r of stockRows) {
            stocksLookup.set(String(r.ticker), {
              sector: String(r.sector || ''),
              name_ar: String(r.name_ar || r.ticker || ''),
            });
          }
          stocksDb.close();
        }
      } catch {}

      const data: ConfluencePick[] = rows.map((r) => {
        const masterScore = Number(r.master_score ?? r.maestro_score ?? 0);
        const technicalScore = Number(r.technical_score ?? 0);
        // P0-FIX (PHASE1-CRITICAL-FIXES): compute risk_reward dynamically.
        // The DB column is frequently 0/null — compute from entry/target/stop
        // so the client never sees R:R = 0 when the pick actually has a valid
        // entry/target/stop.
        const entryPrice = Number(r.entry_price ?? 0);
        const targetPrice = Number(r.target_price ?? 0);
        const stopLoss = Number(r.stop_loss ?? 0);
        const riskReward = computeRiskReward(entryPrice, targetPrice, stopLoss, Number(r.risk_reward ?? 0));
        const confluence = masterScore + technicalScore + riskReward * 10;
        const lookup = stocksLookup.get(String(r.ticker));
        return {
          ticker: String(r.ticker || ''),
          market: String(r.market || 'EGX'),
          signal: String(r.signal || ''),
          recommendation: String(r.signal || ''),
          recommendation_ar: '',
          score: masterScore,
          confidence: Number(r.confidence ?? 0),
          entry_price: entryPrice,
          target_price: targetPrice,
          stop_loss: stopLoss,
          risk_reward: riskReward,
          master_score: masterScore,
          confluence_score: Math.round(confluence * 100) / 100,
          prediction_date: String(r.prediction_date || ''),
          sector: lookup?.sector || '',
          name_ar: lookup?.name_ar || String(r.ticker || ''),
        };
      });

      db.close();

      return NextResponse.json({
        success: true,
        source: 'sqlite_fallback',
        data,
        count: data.length,
        generated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error('[smart-confluence] SQLite fallback error:', e);
      return NextResponse.json(
        {
          success: false,
          error: 'تعذّر جلب التوصيات. يرجى المحاولة مرة أخرى.',
          data: [],
          count: 0,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[/api/finance/smart-confluence] Error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل في جلب التوصيات', data: [], count: 0 },
      { status: 500 }
    );
  }
}
