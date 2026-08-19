import { NextRequest, NextResponse } from 'next/server';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const targetUrl = `${PY}/api/market-pulse${qs ? `?${qs}` : ''}`;

    const options: RequestInit = { signal: AbortSignal.timeout(30000) };
    if (req.method !== 'GET') {
      options.method = req.method;
      options.headers = { 'Content-Type': 'application/json' };
      options.body = await req.text();
    }

    const res = await fetch(targetUrl, options);
    const data = await res.json();

    if (!data.success || !data.data) {
      return NextResponse.json({
        success: true,
        data: {
          stock_signals: [],
          wealth_plan: { recommendations: [] },
          summary: {
            total_invested: 0,
            total_current_value: 0,
            total_pnl: 0,
            total_pnl_pct: 0,
            sell_count: 0,
            alerts: [],
          },
        },
      });
    }

    const pulseData = data.data;
    const signals = pulseData.signals || [];
    const gainers = pulseData.gainers || [];
    const losers = pulseData.losers || [];

    const stockSignals = signals.map((s: any) => ({
      ticker: s.ticker || '',
      name: s.name || s.ticker || '',
      pnl: s.change || 0,
      pnl_pct: s.change || 0,
      current_price: s.price || 0,
      action: s.action || 'HOLD',
      action_ar: s.action_ar || 'حيادي',
    }));

    const recommendations: string[] = [];
    const pulseScore = pulseData.pulse?.score || 0;
    if (pulseScore >= 2) {
      recommendations.push('السوق في صعود قوي — يمكنك زيادة المراكز بحذر');
    } else if (pulseScore >= 0.5) {
      recommendations.push('السوق صاعد — استمر في المراقبة والشراء التدريجي');
    } else if (pulseScore >= -0.5) {
      recommendations.push('السوق محايد — لا تتخذ قرارات كبيرة الآن');
    } else if (pulseScore >= -2) {
      recommendations.push('السوق هابط — قلل المراكز واحتفظ بالسيولة');
    } else {
      recommendations.push('السوق في هبوط قوي — الخروج الآمن هو الخيار الأفضل');
    }

    const divergence = pulseData.divergence || {};
    if (divergence.regime === 'DISTRIBUTION') {
      recommendations.push('تحذير: كبار المستثمرين ينسحبون — كن حذراً من الشراء');
    }

    const sellCount = signals.filter((s: any) => s.action === 'SELL').length;

    return NextResponse.json({
      success: true,
      data: {
        stock_signals: stockSignals,
        wealth_plan: { recommendations },
        summary: {
          total_invested: 0,
          total_current_value: 0,
          total_pnl: 0,
          total_pnl_pct: 0,
          sell_count: sellCount,
          alerts: recommendations.slice(0, 3),
        },
      },
    });
  } catch (e) {
    return NextResponse.json({
      success: true,
      data: {
        stock_signals: [],
        wealth_plan: { recommendations: [] },
        summary: {
          total_invested: 0,
          total_current_value: 0,
          total_pnl: 0,
          total_pnl_pct: 0,
          sell_count: 0,
          alerts: [],
        },
      },
    });
  }
}
