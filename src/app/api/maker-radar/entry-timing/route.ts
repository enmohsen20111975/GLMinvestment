import { NextRequest, NextResponse } from 'next/server';
import { getRadarDb, getRadarDbConfig, parseVolume, computeTurnover } from '@/modules/radar/lib/radar-db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
  if (!ticker) return NextResponse.json({ success: false, error: 'ticker required' }, { status: 400 });

  const cfg = getRadarDbConfig();
  const db = getRadarDb();
  if (!cfg || !db) return NextResponse.json({ success: false, error: 'DB not available' }, { status: 503 });

  try {
    const cols = `${cfg.dateCol}, ${cfg.openCol} as open, ${cfg.highCol} as high, ${cfg.lowCol} as low, ${cfg.priceCol} as close, ${cfg.volumeCol} as volume`;
    const rows = db.prepare(`SELECT ${cols} FROM ${cfg.table} WHERE ${cfg.tickerCol} = ? AND ${cfg.priceCol} IS NOT NULL ORDER BY ${cfg.dateCol} DESC LIMIT 30`).all(ticker) as any[];
    db.close();

    if (rows.length < 15) return NextResponse.json({ success: false, error: 'بيانات غير كافية' }, { status: 400 });

    const closes = rows.map(r => r.close).filter(c => c > 0).reverse();
    const volumes = rows.map(r => parseVolume(r.volume)).reverse();

    const buyDays = closes.slice(-10).filter((c, i) => i > 0 && c > closes[i - 1]).length;
    const avgVol10 = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const volRatio = avgVol20 > 0 ? avgVol10 / avgVol20 : 0;
    const min20 = Math.min(...closes.slice(-20));
    const distFromMin = min20 > 0 ? ((closes[closes.length - 1] - min20) / min20) * 100 : 0;
    const roc10d = closes.length >= 11 && closes[closes.length - 11] > 0 ? ((closes[closes.length - 1] - closes[closes.length - 11]) / closes[closes.length - 11]) * 100 : 0;

    const accScore = buyDays >= 8 ? 30 : buyDays >= 6 ? 22 : buyDays >= 5 ? 15 : buyDays >= 3 ? 8 : 0;
    const volScore = volRatio >= 1.5 ? 25 : volRatio >= 1.2 ? 18 : volRatio >= 1.0 ? 10 : 0;
    const supScore = distFromMin <= 2 ? 25 : distFromMin <= 5 ? 18 : distFromMin <= 10 ? 10 : 0;
    const momScore = roc10d >= 5 && roc10d <= 15 ? 20 : roc10d >= 0 && roc10d < 5 ? 12 : roc10d > 15 && roc10d <= 25 ? 14 : roc10d < -5 ? 6 : 0;
    const total = accScore + volScore + supScore + momScore;

    const label = total >= 80 ? 'توقيت ممتاز' : total >= 60 ? 'توقيت جيد' : total >= 40 ? 'توقيت مقبول' : 'توقيت ضعيف';
    const color = total >= 80 ? 'emerald' : total >= 60 ? 'amber' : total >= 40 ? 'yellow' : 'rose';

    return NextResponse.json({
      success: true, ticker, score: total, label, label_color: color,
      breakdown: {
        accumulation: { score: accScore, max: 30, label: buyDays >= 6 ? 'تجميع قوي' : 'تجميع ضعيف', detail: `${buyDays} من 10 أيام شراء` },
        volume: { score: volScore, max: 25, label: volRatio >= 1.2 ? 'حجم مؤكد' : 'حجم متوسط', detail: `نسبة الحجم ${volRatio.toFixed(2)}` },
        support: { score: supScore, max: 25, label: distFromMin <= 5 ? 'قرب الدعم' : 'بعيد عن الدعم', detail: `${distFromMin.toFixed(1)}% من قاع 20 يوم` },
        momentum: { score: momScore, max: 20, label: roc10d > 0 ? 'زخم إيجابي' : 'زخم سلبي', detail: `ROC 10 أيام = ${roc10d.toFixed(1)}%` },
      },
      recommendation: total >= 60 ? 'مدخل مناسب' : total >= 40 ? 'انتظر تأكيد' : 'تجنّب حالياً',
      computed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[maker-radar:entry-timing]', error);
    return NextResponse.json({ success: false, error: 'internal_error' }, { status: 500 });
  }
}
