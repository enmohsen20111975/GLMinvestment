/**
 * POST /api/kimi/backtest/run
 *
 * تشغيل Backtest لاستراتيجية معينة باستخدام Kimi.
 *
 * - لو Python backend شغّال، يحوّل الطلب لـ `/api/kimi/backtest/run`
 * - fallback: رجّع stub بـ total_return: 0, win_rate: 0, trades_count: 0
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

interface KimiBacktestBody {
  strategy?: string;
  start_date?: string;
  end_date?: string;
  initial_capital?: number;
  tickers?: string[];
  [key: string]: unknown;
}

function buildStubEquityCurve(initialCapital: number): { date: string; equity: number }[] {
  const curve: { date: string; equity: number }[] = [];
  const today = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - (29 - i));
    curve.push({
      date: d.toISOString().slice(0, 10),
      equity: Number(initialCapital.toFixed(2)),
    });
  }
  return curve;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as KimiBacktestBody;
    const initialCapital = Number(body?.initial_capital ?? 100000);

    // محاولة الاتصال بالـ Python backend
    try {
      const pythonResponse = await fetch(`${PYTHON_BACKEND_URL}/api/kimi/backtest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: body.strategy ?? 'default',
          start_date: body.start_date,
          end_date: body.end_date,
          initial_capital: initialCapital,
          tickers: body.tickers ?? [],
          ...(body as Record<string, unknown>),
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (pythonResponse.ok) {
        const contentType = pythonResponse.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await pythonResponse.json();
          const results = data?.results ?? data ?? {};
          return NextResponse.json({
            success: true,
            results: {
              total_return: Number(results.total_return ?? results.totalReturn ?? 0),
              win_rate: Number(results.win_rate ?? results.winRate ?? 0),
              trades_count: Number(results.trades_count ?? results.tradesCount ?? 0),
              equity_curve: Array.isArray(results.equity_curve ?? results.equityCurve)
                ? results.equity_curve ?? results.equityCurve
                : buildStubEquityCurve(initialCapital),
              strategy: String(body.strategy ?? results.strategy ?? 'default'),
              start_date: body.start_date ?? results.start_date ?? null,
              end_date: body.end_date ?? results.end_date ?? null,
            },
            source: 'python',
          });
        }
      }
    } catch (err) {
      console.warn('[kimi/backtest/run] Python backend unavailable, using stub:', err);
    }

    // FIX (BRAVO-DISASTER 2026-10-28): was returning success:true with fabricated
    // stub backtest results (total_return:0, win_rate:0, fake equity_curve of 30
    // days) — Rule 27 NO-FAKE-DATA. Now honestly reports the outage.
    return NextResponse.json({
      success: false,
      error: 'python_backend_unavailable',
      results: null,
      strategy: String(body.strategy ?? 'default'),
      source: 'unavailable',
      message: 'خدمة Kimi backtest غير متاحة حالياً — لا يمكن تشغيل الـ backtest',
    }, { status: 503 });
  } catch (err) {
    console.error('[kimi/backtest/run] Error:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        message: 'حدث خطأ غير متوقع في endpoint Kimi backtest',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: false,
    error: 'method_not_allowed',
    message: 'هذا endpoint يستقبل POST فقط. الرجاء تمرير body يحتوي strategy, start_date, end_date, initial_capital, tickers',
  }, { status: 405 });
}
