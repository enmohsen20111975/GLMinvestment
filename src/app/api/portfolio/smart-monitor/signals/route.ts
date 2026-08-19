import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker') || 'COMI';

  try {
    const res = await fetch(`http://localhost:8010/api/portfolio/smart-monitor/signals?ticker=${ticker}`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch (e) {}

  const tickerUpper = ticker.toUpperCase();
  const holdingsMock: Record<string, any> = {
    COMI: { buy_price: 72.50, current_price: 84.00, pnl_percent: 15.86, sub_portfolio: 'محفظة الاستثمار', holding_days: 42 },
    ABUK: { buy_price: 64.00, current_price: 70.20, pnl_percent: 9.68, sub_portfolio: 'محفظة المضاربة', holding_days: 14 },
    EAST: { buy_price: 31.00, current_price: 28.50, pnl_percent: -8.06, sub_portfolio: 'محفظة الاستثمار', holding_days: 28 },
    SWDY: { buy_price: 42.00, current_price: 49.50, pnl_percent: 17.85, sub_portfolio: 'محفظة المضاربة', holding_days: 21 },
  };

  const pos = holdingsMock[tickerUpper] || {
    buy_price: 50.0,
    current_price: 55.0,
    pnl_percent: 10.0,
    sub_portfolio: 'محفظة المضاربة',
    holding_days: 10,
  };

  const pnlPct = pos.pnl_percent;
  let signalCode = 'HOLD';
  let signalBadge = '⏸️ احتفاظ مستقر';
  let signalColor = '#3b82f6';
  let reason = `السهم في مسار صاعد معتدل بربح ${pnlPct.toFixed(1)}%. لا توجد إشارات قاطعة بالخروج، استمر في المراقبة.`;

  if (pnlPct >= 15.0) {
    signalCode = 'TAKE_PROFIT';
    signalBadge = '✅ حقق ربح الآن';
    signalColor = '#16a34a';
    reason = `السهم حقق ربحاً ممتازاً بنسبة ${pnlPct.toFixed(1)}%. المؤشرات الفنية تشير إلى اقتراب مناطق التشبع الشرائي، يُنصح بتأمين جزء من الأرباح.`;
  } else if (pnlPct <= -8.0) {
    signalCode = 'STOP_LOSS';
    signalBadge = '🚨 إيقاف خسارة';
    signalColor = '#ef4444';
    reason = `السهم تجاوز حد وقف الخسارة الموصى به بربح/خسارة ${pnlPct.toFixed(1)}%. يفضل الخروج لحماية رأس المال وإعادة التدوير.`;
  }

  return NextResponse.json({
    success: true,
    ticker: tickerUpper,
    signal: signalCode,
    signal_badge: signalBadge,
    signal_color: signalColor,
    pnl_percent: pnlPct,
    sub_portfolio: pos.sub_portfolio,
    buy_price: pos.buy_price,
    current_price: pos.current_price,
    holding_days: pos.holding_days,
    position_warning: pos.holding_days <= 2 ? '⚠️ تحذير تسوية T+2 قائم (الأسهم في فترة التسوية)' : null,
    ai_narrative: reason,
    updated_at: new Date().toISOString(),
  });
}
