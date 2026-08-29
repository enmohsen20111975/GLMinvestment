import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/stocks/screener
 *
 * Proxy to Python backend screener endpoints.
 *
 * ⚠️ Rule 20 (Python = brain, Node = display only): ALL screener logic lives
 * in Python (vps-service/analyzers/screener.py — preset_day_trader,
 * preset_value, preset_momentum, preset_thermometer, preset_daily_speculator).
 * This Node route is a pure proxy — no logic here.
 *
 * Mapping:
 *  - preset=<preset_name> → Python /api/screener/scan?preset=<preset_name>
 *  - (no preset) → Python /api/screener/presets (returns preset list)
 *
 * Available presets (in Python screener.py):
 *  - day_trader: رادار المضارب (high volatility + technical buy)
 *  - daily_speculator: المضارب اليومي (52w discount + EPS + P/E + dividends + volume)
 *  - value: صائد القيمة (below book value + high dividend yield)
 *  - momentum: صواريخ الزخم (strong uptrend + MACD positive + near 52w high)
 *  - thermometer: ميزان حرارة السوق (advancing vs declining ratio)
 *
 * Query params (passed through to Python):
 *  - preset: day_trader | value | momentum | thermometer | daily_speculator
 *  - market: EGX | KSA | Kuwait | Qatar
 *  - limit: max 200 (default: 50)
 */
export const dynamic = 'force-dynamic';

const PY = process.env.EGXPY_SERVICE_URL || process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8010';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const preset = url.searchParams.get('preset') || '';
    const qs = url.searchParams.toString();

    // Route to Python: /api/screener/scan if preset specified, else /api/screener/presets
    const pyPath = preset ? '/api/screener/scan' : '/api/screener/presets';
    const targetUrl = `${PY}${pyPath}${qs ? `?${qs}` : ''}`;

    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json();

    // If Python returned an error, surface it with a clear hint
    if (!res.ok || data.success === false) {
      return NextResponse.json({
        ...data,
        hint: preset
          ? `تأكد أن Python backend يعمل وأن preset "${preset}" موجود في /api/screener/presets`
          : 'تأكد أن Python backend يعمل على port 8010 (محتاج: /api/screener/presets)',
      }, { status: res.status || 502 });
    }

    return NextResponse.json(data);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Unknown error';
    const isTimeout = e instanceof Error && e.name === 'AbortError';
    return NextResponse.json({
      success: false,
      error: isTimeout ? 'انتهت مهلة الطلب' : 'فشل في الاتصال بـ Python Backend',
      details: errMsg,
      hint: 'تأكد أن Python backend يعمل على ' + PY + '/api/screener/presets',
    }, { status: isTimeout ? 504 : 502 });
  }
}
