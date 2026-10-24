/**
 * GET  /api/backtesting/unified → reads query params (?strategy=&market=&ticker=&from=&to=)
 * POST /api/backtesting/unified → reads JSON body    {strategy, market, ticker, from, to}
 *
 * The Flutter Android client sends POST with a JSON body to this endpoint
 * (see client.dart ~line 1869). The Next.js server historically only exposed
 * GET. To avoid duplicating the deterministic backtest engine, both verbs
 * now route through the same `runBacktest` helper — single source of truth
 * (Rule 67).
 *
 * The actual V82 backtest engine lives in Python (`/api/backtesting/route.ts`
 * proxies to port 8010) and is sandbox-unavailable, so we generate a
 * deterministic, realistic-looking equity curve seeded by the ticker string.
 * The shape matches what the Flutter client expects so the chart renders
 * without a connection-error toast.
 *
 * Public (no auth) — taste/test content.
 *
 * Returns:
 *   {
 *     success, strategy, market, ticker,
 *     total_return_pct, trades_count, win_rate, max_drawdown, sharpe,
 *     equity_curve: [{ date, value }],
 *     generated_at, source: "deterministic_stub"
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Deterministic PRNG (mulberry32) seeded from a string so the same ticker
// always produces the same equity curve — the chart looks stable on refresh.
function strHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseDate(input: string | null | undefined, fallback: Date): Date {
  if (!input) return fallback;
  const d = new Date(input);
  return isNaN(d.getTime()) ? fallback : d;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface StrategyProfile {
  drift: number; // average daily return (per million trade-day steps)
  vol: number; // daily volatility multiplier
  tradeFreq: number; // trades per year
  winRate: number; // 0..1
  sharpeBase: number;
}

const STRATEGY_PROFILES: Record<string, StrategyProfile> = {
  mean_reversion: {
    drift: 0.00025,
    vol: 0.011,
    tradeFreq: 48,
    winRate: 0.62,
    sharpeBase: 1.45,
  },
  momentum: {
    drift: 0.00045,
    vol: 0.018,
    tradeFreq: 28,
    winRate: 0.54,
    sharpeBase: 1.12,
  },
  breakout: {
    drift: 0.00035,
    vol: 0.022,
    tradeFreq: 22,
    winRate: 0.49,
    sharpeBase: 0.95,
  },
  dca: {
    drift: 0.00018,
    vol: 0.006,
    tradeFreq: 12,
    winRate: 0.78,
    sharpeBase: 1.8,
  },
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    return await runBacktest(
      searchParams.get('strategy'),
      searchParams.get('market'),
      searchParams.get('ticker'),
      searchParams.get('from'),
      searchParams.get('to')
    );
  } catch (err) {
    console.error('[backtesting/unified] GET fatal:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_en: 'internal error',
      },
      { status: 500 }
    );
  }
}

// POST alias — Flutter client sends JSON body {strategy, market, ticker, from, to}.
// Delegates to the same runBacktest() helper so there's a single source of
// truth for the deterministic equity-curve math (Rule 67 — SSOT). Body
// fields fall back to query params so a mixed request shape also works.
export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    try {
      const text = await req.text();
      if (text && text.trim()) {
        body = JSON.parse(text) as Record<string, unknown>;
      }
    } catch {
      // ignore JSON parse errors and fall through to query params
    }
    const url = new URL(req.url);
    const pick = (key: string): string | null =>
      (body[key] as string | undefined) ?? url.searchParams.get(key);
    return await runBacktest(
      pick('strategy'),
      pick('market'),
      pick('ticker'),
      pick('from'),
      pick('to')
    );
  } catch (err) {
    console.error('[backtesting/unified] POST fatal:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        error_en: 'internal error',
      },
      { status: 500 }
    );
  }
}

// Shared backtest engine — single source of truth (Rule 67) for both GET
// (query params) and POST (JSON body). Returns a NextResponse so the verb
// handlers stay thin.
async function runBacktest(
  strategyInput: string | null | undefined,
  marketInput: string | null | undefined,
  tickerInput: string | null | undefined,
  fromInput: string | null | undefined,
  toInput: string | null | undefined
): Promise<Response> {
  const strategyRaw = (strategyInput || 'mean_reversion')
    .toLowerCase()
    .trim();
  const strategy =
    strategyRaw in STRATEGY_PROFILES ? strategyRaw : 'mean_reversion';
  const profile = STRATEGY_PROFILES[strategy];
  const market = (marketInput || 'EGX').toUpperCase();
  const ticker = (tickerInput || 'EGX30').toUpperCase();
  const today = new Date();
  const from = parseDate(fromInput, new Date(today.getTime() - 365 * 86400000));
  const to = parseDate(toInput, today);

  if (from >= to) {
    return NextResponse.json(
      {
        success: false,
        error: 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية',
        error_en: 'from date must be before to date',
      },
      { status: 400 }
    );
  }

  // Build the equity curve (deterministic, seeded by ticker+strategy).
  const seedStr = `${ticker}:${strategy}:${market}:${from.toISOString().slice(0, 10)}:${to.toISOString().slice(0, 10)}`;
  const rng = mulberry32(strHash(seedStr));

  const dayMs = 86400000;
  const totalDays = Math.max(1, Math.floor((to.getTime() - from.getTime()) / dayMs));
  const equityCurve: Array<{ date: string; value: number }> = [];
  let equity = 10000; // starting capital
  let peak = equity;
  let maxDrawdown = 0;
  const dailyReturns: number[] = [];

  for (let i = 0; i <= totalDays; i++) {
    // Skip weekends (Sat=6, Sun=0) — makes the curve look like a trading chart.
    const d = new Date(from.getTime() + i * dayMs);
    const dow = d.getUTCDay();
    if (dow === 6 || dow === 0) continue;

    // Box-Muller transform for normal-distributed daily returns.
    const u1 = Math.max(1e-12, rng());
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const dailyReturn = profile.drift + profile.vol * z;
    dailyReturns.push(dailyReturn);
    equity = equity * (1 + dailyReturn);
    if (equity > peak) peak = equity;
    const dd = (equity - peak) / peak;
    if (dd < maxDrawdown) maxDrawdown = dd;

    // Sample every ~7 trading days to keep the payload light.
    if (i % 7 === 0 || i === totalDays) {
      equityCurve.push({ date: fmtDate(d), value: Number(equity.toFixed(2)) });
    }
  }

  const totalReturnPct = ((equity - 10000) / 10000) * 100;

  // Sharpe ratio: mean(return) / std(return) * sqrt(252)
  const meanRet =
    dailyReturns.reduce((a, b) => a + b, 0) / Math.max(1, dailyReturns.length);
  const variance =
    dailyReturns.reduce((s, r) => s + (r - meanRet) ** 2, 0) /
    Math.max(1, dailyReturns.length - 1);
  const stdRet = Math.sqrt(variance);
  const sharpe =
    stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(252) : profile.sharpeBase;

  // Trade count: scale by date range + strategy frequency.
  const yearsCovered = totalDays / 365;
  const tradesCount = Math.max(
    1,
    Math.round(profile.tradeFreq * yearsCovered)
  );

  // Win rate: deterministic from rng + strategy base — small variance.
  const winRate = Math.max(
    0.3,
    Math.min(0.95, profile.winRate + (rng() - 0.5) * 0.06)
  );

  return NextResponse.json({
    success: true,
    strategy,
    market,
    ticker,
    period: {
      from: fmtDate(from),
      to: fmtDate(to),
      days: totalDays,
    },
    starting_capital: 10000,
    ending_capital: Number(equity.toFixed(2)),
    total_return_pct: Number(totalReturnPct.toFixed(2)),
    trades_count: tradesCount,
    win_rate: Number((winRate * 100).toFixed(1)),
    max_drawdown_pct: Number((maxDrawdown * 100).toFixed(2)),
    sharpe: Number(sharpe.toFixed(2)),
    equity_curve: equityCurve,
    generated_at: new Date().toISOString(),
    source: 'deterministic_stub',
    note:
      'ينتج هذا الـ endpoint بيانات backtest وهمية deterministic لتطوير الموبايل فقط. لتشغيل backtest حقيقي استخدم /api/backtesting.',
  });
}
