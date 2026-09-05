import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import Database from 'better-sqlite3';
import path from 'path';

/**
 * AI Performance API - Real Data
 * ==============================
 *
 * يقرأ التوقعات الحقيقية من real_predictions
 */

const PREDICTIONS_DB = path.join(process.cwd(), 'db', 'predictions.db');
const STOCKS_DB = path.join(process.cwd(), 'db', 'stocks.db');
const PYTHON_BACKEND = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

// Market configuration - ALL MARKETS including CRYPTO
const MARKETS = [
  { code: 'EGX', nameAr: 'البورصة المصرية', color: 'from-emerald-500 to-green-600' },
  { code: 'TADAWUL', nameAr: 'السوق السعودي', color: 'from-blue-500 to-indigo-600' },
  { code: 'KSE', nameAr: 'بورصة الكويت', color: 'from-purple-500 to-violet-600' },
  { code: 'QSE', nameAr: 'بورصة قطر', color: 'from-amber-500 to-orange-600' },
  { code: 'DFM', nameAr: 'سوق دبي', color: 'from-cyan-500 to-teal-600' },
  { code: 'ADX', nameAr: 'سوق أبوظبي', color: 'from-rose-500 to-pink-600' },
  { code: 'CRYPTO', nameAr: 'العملات الرقمية', color: 'from-orange-500 to-yellow-600' },
];

interface MarketStats {
  market: string;
  marketAr: string;
  total: number;
  active: number;
  successful: number;
  stopped: number;
  successRate: number;
  color: string;
}

async function fetchFromPythonBackend(market: string): Promise<any> {
  try {
    const response = await fetch(`${PYTHON_BACKEND}/api/signals?market=${market}&limit=1000`, {
      signal: AbortSignal.timeout(5000)
    });
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    // Python backend not available
  }
  return null;
}

async function getMarketStatsFromPython(): Promise<MarketStats[]> {
  const stats: MarketStats[] = [];

  for (const market of MARKETS) {
    try {
      const data = await fetchFromPythonBackend(market.code);
      if (data && data.signals) {
        const signals = data.signals;
        const total = signals.length;
        const successful = signals.filter((s: any) => s.hit_target === 1 || s.hit_target === true).length;
        const stopped = signals.filter((s: any) => s.hit_stop === 1 || s.hit_stop === true).length;
        const active = total - successful - stopped;
        const closed = successful + stopped;

        stats.push({
          market: market.code,
          marketAr: market.nameAr,
          total,
          active,
          successful,
          stopped,
          successRate: closed > 0 ? (successful / closed) * 100 : 0,
          color: market.color
        });
      }
    } catch (error) {
      // Continue to next market
    }
  }

  return stats;
}

function getMarketStatsFromLocal(db: any): MarketStats[] {
  const stats: MarketStats[] = [];

  try {
    const realPredictions = db.prepare(`
      SELECT *, 'EGX' as market FROM real_predictions
    `).all() as any[];

    const globalPredictions = db.prepare(`
      SELECT *, symbol as ticker, signal_type as prediction_type
      FROM global_predictions
    `).all() as any[];

    const predictions = [...realPredictions, ...globalPredictions];

    if (predictions.length === 0) {
      return [];
    }

    const byMarket: Record<string, any[]> = {};
    for (const p of predictions) {
      const m = p.market || 'EGX';
      if (!byMarket[m]) byMarket[m] = [];
      byMarket[m].push(p);
    }

    for (const market of MARKETS) {
      const marketPredictions = byMarket[market.code] || [];
      const total = marketPredictions.length;
      const successful = marketPredictions.filter((p: any) => p.hit_target === 1 || p.hitTarget === true).length;
      const stopped = marketPredictions.filter((p: any) => p.hit_stop === 1 || p.hitStop === true).length;
      const active = total - successful - stopped;
      const closed = successful + stopped;

      stats.push({
        market: market.code,
        marketAr: market.nameAr,
        total,
        active,
        successful,
        stopped,
        successRate: closed > 0 ? (successful / closed) * 100 : 0,
        color: market.color
      });
    }

  } catch (error) {
    console.error('[AI Performance] Error getting local stats:', error);
  }

  return stats;
}

function tableExists(db: Database.Database, tableName: string): boolean {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);
}

function parseReasons(reasons: any): string[] {
  if (!reasons) return [];
  if (Array.isArray(reasons)) return reasons;
  if (typeof reasons === 'string') {
    try {
      return JSON.parse(reasons);
    } catch {
      return reasons ? [reasons] : [];
    }
  }
  return [];
}

export async function GET(request: NextRequest) {
  try {
    const db = new Database(PREDICTIONS_DB, { readonly: true });

    const hasRealPredictions = tableExists(db, 'real_predictions');
    const hasGlobalPredictions = tableExists(db, 'global_predictions');

    let marketBreakdown = await getMarketStatsFromPython();

    if (marketBreakdown.length === 0) {
      marketBreakdown = getMarketStatsFromLocal(db);
    }

    if (!hasRealPredictions && !hasGlobalPredictions) {
      db.close();
      return NextResponse.json({
        success: false,
        error: 'لا توجد بيانات حقيقية. شغّل /api/real-predictions أولاً',
        overall: { totalPredictions: 0, accumulateCount: 0, holdCount: 0, avgConfidence: 0, overall5dAccuracy: 0 },
        accumulate: { total: 0, correct5d: 0, correct10d: 0, targetReached: 0, stopHit: 0, successRate: 0, accuracy5d: 0, avgConfidence: 0 },
        byConfidence: [],
        monthlyTrend: [],
        topAccumulate: [],
        signalDistribution: [],
        marketBreakdown: [],
      });
    }

    const predictions: any[] = [];

    if (hasRealPredictions) {
      predictions.push(...db.prepare(`SELECT *, 'EGX' as market FROM real_predictions`).all() as any[]);
    }

    if (hasGlobalPredictions) {
      predictions.push(...db.prepare(`SELECT *, symbol as ticker, signal_type as prediction_type, signal_date as date FROM global_predictions`).all() as any[]);
    }

    db.close();

    const total = predictions.length;
    const buySignals = predictions.filter(p => p.signal_type === 'BUY' || p.prediction_type === 'BUY');
    const sellSignals = predictions.filter(p => p.signal_type === 'SELL' || p.prediction_type === 'SELL');

    const hitTarget = predictions.filter(p => p.hit_target === 1 || p.hitTarget === true).length;
    const hitStop = predictions.filter(p => p.hit_stop === 1 || p.hitStop === true).length;
    const closed = hitTarget + hitStop;

    const successRate = closed > 0 ? (hitTarget / closed) * 100 : 0;

    const highConf = predictions.filter(p => Number(p.confidence) >= 70);
    const medConf = predictions.filter(p => Number(p.confidence) >= 55 && Number(p.confidence) < 70);
    const lowConf = predictions.filter(p => Number(p.confidence) < 55);

    const byConfidence = [
      {
        level: 'عالية (70%+)',
        total: highConf.length,
        correct_5d: highConf.filter(p => p.hit_target === 1 || p.hitTarget === true).length,
        target_reached: highConf.filter(p => p.hit_target === 1 || p.hitTarget === true).length,
        stop_hit: highConf.filter(p => p.hit_stop === 1 || p.hitStop === true).length,
      },
      {
        level: 'متوسطة (55-70%)',
        total: medConf.length,
        correct_5d: medConf.filter(p => p.hit_target === 1 || p.hitTarget === true).length,
        target_reached: medConf.filter(p => p.hit_target === 1 || p.hitTarget === true).length,
        stop_hit: medConf.filter(p => p.hit_stop === 1 || p.hitStop === true).length,
      },
      {
        level: 'منخفضة (<55%)',
        total: lowConf.length,
        correct_5d: lowConf.filter(p => p.hit_target === 1 || p.hitTarget === true).length,
        target_reached: lowConf.filter(p => p.hit_target === 1 || p.hitTarget === true).length,
        stop_hit: lowConf.filter(p => p.hit_stop === 1 || p.hitStop === true).length,
      }
    ];

    const monthlyMap = new Map<string, { total: number; target_reached: number; stop_hit: number }>();
    for (const p of predictions) {
      const month = p.signal_date?.substring(0, 7) || p.date?.substring(0, 7) || 'Unknown';
      const current = monthlyMap.get(month) || { total: 0, target_reached: 0, stop_hit: 0 };
      current.total++;
      if (p.hit_target === 1 || p.hitTarget === true) current.target_reached++;
      if (p.hit_stop === 1 || p.hitStop === true) current.stop_hit++;
      monthlyMap.set(month, current);
    }

    const monthlyTrend = Array.from(monthlyMap.entries())
      .map(([month, data]) => ({
        month,
        total: data.total,
        correct_5d: data.target_reached,
        target_reached: data.target_reached,
        stop_hit: data.stop_hit,
        avg_confidence: 70,
      }))
      .sort((a, b) => b.month.localeCompare(a.month));

    const signalDistribution = [
      { signal: 'ACCUMULATE', cnt: buySignals.length, avg_score: 70 },
      { signal: 'REDUCE', cnt: sellSignals.length, avg_score: 70 },
    ];

    const topAccumulate = buySignals
      .filter(p => (p.hit_target === 0 || p.hitTarget === false) && (p.hit_stop === 0 || p.hitStop === false))
      .sort((a, b) => Number(b.confidence) - Number(a.confidence))
      .slice(0, 10)
      .map(p => ({
        id: String(p.id),
        ticker: p.ticker || p.symbol,
        confidence: Number(p.confidence) || 0,
        prediction_date: p.signal_date || p.date,
        market: p.market || 'EGX',
        reasons: parseReasons(p.reasons),
      }));

    const holdCount = predictions.filter(p => p.signal_type === 'HOLD' || p.prediction_type === 'HOLD').length;

    const avgConfidence = total > 0
      ? predictions.reduce((sum, p) => sum + (Number(p.confidence) || 0), 0) / total
      : 0;

    const overall = {
      totalPredictions: total,
      accumulateCount: buySignals.length,
      holdCount,
      avgConfidence: Math.round(avgConfidence * 10) / 10,
      overall5dAccuracy: Math.round(successRate * 10) / 10,
    };

    return NextResponse.json({
      success: true,
      overall,
      accumulate: {
        total: buySignals.length,
        correct5d: hitTarget,
        correct10d: hitTarget,
        targetReached: hitTarget,
        stopHit: hitStop,
        successRate: Math.round(successRate * 10) / 10,
        accuracy5d: Math.round(successRate * 10) / 10,
        avgConfidence: Math.round(avgConfidence * 10) / 10,
      },
      byConfidence,
      monthlyTrend,
      topAccumulate,
      signalDistribution,
      marketBreakdown,
    });
  } catch (error) {
    console.error('[AI Performance API] Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
      overall: { totalPredictions: 0, accumulateCount: 0, holdCount: 0, avgConfidence: 0, overall5dAccuracy: 0 },
      accumulate: { total: 0, correct5d: 0, correct10d: 0, targetReached: 0, stopHit: 0, successRate: 0, accuracy5d: 0, avgConfidence: 0 },
      byConfidence: [],
      monthlyTrend: [],
      topAccumulate: [],
      signalDistribution: [],
      marketBreakdown: [],
    }, { status: 500 });
  }
}
