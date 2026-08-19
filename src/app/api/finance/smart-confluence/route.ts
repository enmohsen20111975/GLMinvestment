/**
 * GET/POST /api/finance/smart-confluence
 * =======================================
 * Reads stored_analyses from local predictions.db first.
 * Falls back to Python backend /api/smart-confluence/predictions if local data is empty.
 *
 * Returns: { success, data: [{ ticker, recommendation, score, entry, target, stop }] }
 */

import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

interface ConfluencePick {
  ticker: string;
  market: string;
  recommendation: string;
  recommendation_ar: string;
  score: number;
  confidence: number;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  risk_reward: number;
  sector: string;
  name_ar: string;
}

export async function GET(req: NextRequest) {
  return handleRequest(req);
}

export async function POST(req: NextRequest) {
  return handleRequest(req);
}

async function handleRequest(req: NextRequest) {
  try {
    let markets: string[] = ['EGX'];
    let totalLimit = 20;

    if (req.method === 'POST') {
      try {
        const body = await req.json();
        if (Array.isArray(body.markets)) markets = body.markets.map((m: string) => m.toUpperCase());
        if (typeof body.totalLimit === 'number') totalLimit = body.totalLimit;
      } catch {}
    } else {
      const url = new URL(req.url);
      const m = url.searchParams.get('markets');
      if (m) markets = m.split(',').map(s => s.trim().toUpperCase());
    }

    const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
    let localPicks: ConfluencePick[] = [];

    try {
      const db = new Database(dbPath, { readonly: true, timeout: 3000 });
      const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stored_analyses'").get() as any;
      if (tableCheck) {
        const rows = db.prepare(`
          SELECT ticker, market, maestro_score, recommendation, recommendation_ar,
                 confidence, entry_price, target_price, stop_loss, risk_reward,
                 sector, name_ar
          FROM stored_analyses
          WHERE recommendation IN ('buy', 'strong_buy', 'swing_buy', 't1_buy', 'hold', 'sell', 'strong_sell')
            AND market IN (${markets.map(() => '?').join(',')})
          ORDER BY maestro_score DESC
          LIMIT ?
        `).all(...markets, totalLimit) as any[];

        localPicks = rows.map((r: any) => ({
          ticker: r.ticker,
          market: r.market || 'EGX',
          recommendation: r.recommendation,
          recommendation_ar: r.recommendation_ar || '',
          score: Number(r.maestro_score || 0),
          confidence: Number(r.confidence || 0),
          entry_price: Number(r.entry_price || 0),
          target_price: Number(r.target_price || 0),
          stop_loss: Number(r.stop_loss || 0),
          risk_reward: Number(r.risk_reward || 0),
          sector: r.sector || '',
          name_ar: r.name_ar || r.ticker,
        }));
      }
      db.close();
    } catch (e) {
      console.warn('[smart-confluence] Local DB error:', e);
    }

    if (localPicks.length > 0) {
      return NextResponse.json({ success: true, data: localPicks, count: localPicks.length });
    }

    try {
      const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
      const res = await fetch(`${PY}/api/smart-confluence/predictions?limit=${totalLimit}`, {
        signal: AbortSignal.timeout(20000),
      });
      const pyData = await res.json();
      if (pyData.success && Array.isArray(pyData.predictions)) {
        let mapped = pyData.predictions.map((p: any) => ({
          ticker: p.symbol || p.ticker || '',
          market: p.market || 'EGX',
          recommendation: p.signal || p.recommendation || 'HOLD',
          recommendation_ar: p.signal_ar || p.recommendation_ar || '',
          score: Number(p.confidence || p.confluence_score || p.score || 0),
          confidence: Number(p.confidence || 0),
          entry_price: Number(p.entry_price || p.price || 0),
          target_price: Number(p.target_price || 0),
          stop_loss: Number(p.stop_loss || 0),
          risk_reward: Number(p.risk_reward || 0),
          sector: p.sector || '',
          name_ar: p.name_ar || p.name || p.ticker || '',
        }));
        if (markets.length > 0 && !markets.includes('ALL')) {
          mapped = mapped.filter((p: ConfluencePick) => markets.some(m => p.market?.toUpperCase().includes(m) || p.ticker?.toUpperCase().includes(m)));
        }
        return NextResponse.json({ success: true, data: mapped.slice(0, totalLimit), count: mapped.length });
      }
    } catch (e) {
      console.warn('[smart-confluence] Python backend fallback error:', e);
    }

    return NextResponse.json({ success: true, data: [], count: 0 });
  } catch (error) {
    console.error('[/api/finance/smart-confluence] Error:', error);
    return NextResponse.json({ success: false, error: 'فشل في جلب التوصيات', data: [] }, { status: 500 });
  }
}
