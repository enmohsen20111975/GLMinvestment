import { NextRequest, NextResponse } from 'next/server';
import { getPaywallUser, applyPaywallToChartAnalysis } from '@/lib/paywall';

/**
 * PROXY to Python Backend — NO calculations here!
 * Python = THE BRAIN, Node.js = DISPLAY ONLY
 *
 * Proxies to: GET /api/chart/full-analysis on Python backend (port 8010)
 * PAYWALL-043: يطبق الـ Paywall على النتيجة (إخفاء الفخاخ + Trailing للمجانيين)
 */

const PYTHON_PORT = process.env.PYTHON_PORT || '8010';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker') || 'PHDC';
  const timeframe = searchParams.get('timeframe') || '1D';
  const limit = searchParams.get('limit') || '120';
  const userId = searchParams.get('user_id') || '';
  const userState = searchParams.get('state') || 'buyer';

  try {
    let pythonUrl = `http://127.0.0.1:${PYTHON_PORT}/api/chart/full-analysis?ticker=${encodeURIComponent(ticker)}&timeframe=${encodeURIComponent(timeframe)}&limit=${encodeURIComponent(limit)}&state=${encodeURIComponent(userState)}`;
    if (userId) {
      pythonUrl += `&user_id=${encodeURIComponent(userId)}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let res = await fetch(pythonUrl, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
      },
    });

    // FALLBACK-FIX: إذا كانت البيانات غير كافية للفريم اللحظي (مثل 15M/5M)، جرب الفريم اليومي DAY تلقائياً
    if (!res.ok && timeframe !== 'DAY') {
      const fallbackUrl = `http://127.0.0.1:${PYTHON_PORT}/api/chart/full-analysis?ticker=${encodeURIComponent(ticker)}&timeframe=DAY&limit=365&state=${encodeURIComponent(userState)}${userId ? `&user_id=${encodeURIComponent(userId)}` : ''}`;
      res = await fetch(fallbackUrl, {
        signal: controller.signal,
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
      });
    }

    clearTimeout(timeout);

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      return NextResponse.json(
        {
          success: false,
          error: errorData.error || `Python backend error: ${res.status}`,
          ticker,
        },
        { status: res.status }
      );
    }

    const data = await res.json();

    // P35 CHART-FINAL-FIX: Normalize ALL chart times to UNIX int + drop null candles.
    // Python's chart_full_analysis() used to return time as 'yyyy-mm-dd' string for
    // daily timeframes (via _fmt_date). Even though Python now returns ints, we add
    // a defensive normalizer here so NO string time can ever reach lightweight-charts.
    // This is the Node-side LAST line of defense.
    function _toUnix(raw: unknown): number {
      if (typeof raw === 'number') {
        return raw > 1e12 ? Math.floor(raw / 1000) : Math.floor(raw);
      }
      if (typeof raw === 'string') {
        const s = raw.trim();
        const asNum = Number(s);
        if (!isNaN(asNum) && /^\d+(\.\d+)?$/.test(s)) {
          return asNum > 1e12 ? Math.floor(asNum / 1000) : Math.floor(asNum);
        }
        const parsed = Date.parse(s.replace(' ', 'T'));
        return isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
      }
      return 0;
    }

    if (data && data.ohlcv && Array.isArray(data.ohlcv)) {
      const validTimes = new Set<number>();
      data.ohlcv = data.ohlcv
        .map((c: Record<string, unknown>) => {
          const t = _toUnix(c?.time ?? c?.timestamp ?? c?.date);
          return { ...c, time: t, timestamp: t, date: t };
        })
        .filter((c: Record<string, unknown>) => {
          if (
            c.time <= 0 ||
            c.open == null || c.high == null || c.low == null || c.close == null ||
            (typeof c.open === 'number' && c.open !== c.open) ||
            (typeof c.high === 'number' && c.high !== c.high) ||
            (typeof c.low === 'number' && c.low !== c.low) ||
            (typeof c.close === 'number' && c.close !== c.close)
          ) {
            return false;
          }
          validTimes.add(c.time);
          return true;
        });
      // Filter indicator arrays to only keep points whose time survived
      if (data.indicators && typeof data.indicators === 'object') {
        for (const key of Object.keys(data.indicators)) {
          const arr = data.indicators[key];
          if (Array.isArray(arr)) {
            data.indicators[key] = arr
              .map((p: Record<string, unknown>) => ({ ...p, time: _toUnix(p?.time) }))
              .filter((p: Record<string, unknown>) => validTimes.has(p.time));
          }
        }
      }
      // cmf_data + vol_z_score_arr + macd_projection
      for (const k of ['cmf_data', 'vol_z_score_arr', 'macd_projection']) {
        if (Array.isArray(data[k])) {
          data[k] = data[k]
            .map((p: Record<string, unknown>) => ({ ...p, time: _toUnix(p?.time) }))
            .filter((p: Record<string, unknown>) => validTimes.has(p.time));
        }
      }
      // smart_markers: convert time + drop if not in validTimes
      if (Array.isArray(data.smart_markers)) {
        data.smart_markers = data.smart_markers
          .map((m: Record<string, unknown>) => ({ ...m, time: _toUnix(m?.time) }))
          .filter((m: Record<string, unknown>) => validTimes.has(m.time));
      }
      // bos_events + sweeps: convert time if present
      if (Array.isArray(data.bos_events)) {
        data.bos_events = data.bos_events.map((e: Record<string, unknown>) =>
          e?.time != null ? { ...e, time: _toUnix(e.time) } : e
        );
      }
    }

    // PAYWALL-043: إخفاء الفخاخ + Trailing Stop للمجانيين
    const user = await getPaywallUser(request);
    const paywalledData = applyPaywallToChartAnalysis(data, user.is_premium);
    paywalledData._paywall = { is_premium: user.is_premium };

    return NextResponse.json(paywalledData);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: `فشل الاتصال بالخادم: ${msg}`,
        ticker,
        hint: 'تأكد أن خادم Python يعمل على المنفذ 8010',
      },
      { status: 503 }
    );
  }
}