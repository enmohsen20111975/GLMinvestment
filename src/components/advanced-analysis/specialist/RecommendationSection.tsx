/**
 * specialist/RecommendationSection.tsx — §9 Recommendation (signal + R:R + trend).
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 1319–1431).
 * Entry zone + target (resistance) + stop (support) + R:R + signal interp + trend.
 *
 * ALPHA-FAB-FIX-SPECIALIST-001: removed current*0.99/1.01 fabrication (Rule 27).
 * Entry zone MUST come from API (predictions.db entry_price_min/max). None → null.
 *
 * UNIFY-FIX (Rule 73): canonical thresholds 78/65/55/40/25 (unified with unified API).
 */
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Target } from 'lucide-react';
import type { StockInfo } from './types';
import { fmtNum, safeNum, safeStr } from './helpers';
import { SectionCard } from './primitives';

export function RecommendationSection({ info }: { info: StockInfo }) {
  const current = safeNum(info.current_price);
  const support = safeNum(info.support);
  const resistance = safeNum(info.resistance);
  const signal = safeNum(info.signal);
  const trend = safeStr(info.trend);

  // Hide if literally nothing to show
  if (current == null && support == null && resistance == null && signal == null) {
    return null;
  }

  // ALPHA-FAB-FIX-SPECIALIST-001: removed current*0.99/1.01 fabrication (Rule 27).
  // entry zone لازم من API (predictions.db entry_price_min/max). لو مفيش → null.
  const entryLow: number | null = null;
  const entryHigh: number | null = null;

  // R:R = (resistance - current) / (current - support) — only if all values available
  const rr = current != null && resistance != null && support != null && current > support
    ? (resistance - current) / (current - support)
    : null;

  // UNIFY-FIX (Rule 73): توحيد thresholds مع canonical 78/65/55/40/25
  const sigInt = signal == null ? null
    : signal >= 78 ? { txt: 'شراء قوي', cls: 'text-profit', bg: 'bg-profit/10' }
    : signal >= 65 ? { txt: 'شراء', cls: 'text-profit', bg: 'bg-profit/10' }
    : signal >= 55 ? { txt: 'تجميع', cls: 'text-whale', bg: 'bg-whale/10' }
    : signal >= 40 ? { txt: 'انتظار', cls: 'text-warning', bg: 'bg-warning/10' }
    : signal >= 25 ? { txt: 'تقليل', cls: 'text-warning', bg: 'bg-warning/10' }
    : { txt: 'بيع', cls: 'text-loss', bg: 'bg-loss/10' };

  const trendAr = trend == null ? null
    : trend === 'صاعد' || trend.toLowerCase().includes('up') || trend.toLowerCase().includes('bull')
    ? { txt: 'صاعد', cls: 'text-profit' }
    : trend === 'هابط' || trend.toLowerCase().includes('down') || trend.toLowerCase().includes('bear')
    ? { txt: 'هابط', cls: 'text-loss' }
    : { txt: trend, cls: 'text-muted-foreground dark:text-muted-foreground' };

  return (
    <SectionCard
      icon={<Target className="w-4 h-4" />}
      title="التوقع الفني والأسعار المستهدفة"
      description="من stock_info: signal + support + resistance + trend (Rule 67 — أرقام حقيقية فقط)"
      accent="amber"
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {/* Entry zone */}
        <div className="p-3 bg-profit/10 rounded-lg text-center">
          <p className="text-xs text-muted-foreground">منطقة الدخول</p>
          <p className="text-lg font-bold text-profit mt-1">
            {entryLow != null && entryHigh != null
              ? `${(entryLow as any as number).toFixed(2)} — ${(entryHigh as any as number).toFixed(2)}`
              : '—'}
          </p>
        </div>
        {/* Target = resistance */}
        <div className="p-3 bg-profit/10 rounded-lg text-center">
          <p className="text-xs text-muted-foreground">الهدف (مقاومة)</p>
          <p className="text-lg font-bold text-profit mt-1">{fmtNum(resistance)}</p>
        </div>
        {/* Stop = support */}
        <div className="p-3 bg-loss/10 rounded-lg text-center">
          <p className="text-xs text-muted-foreground">وقف الخسارة (دعم)</p>
          <p className="text-lg font-bold text-loss mt-1">{fmtNum(support)}</p>
        </div>
        {/* R:R */}
        <div className="p-3 bg-warning/10 rounded-lg text-center">
          <p className="text-xs text-muted-foreground">مخاطرة/عائد</p>
          <p className={`text-lg font-bold mt-1 ${rr == null ? 'text-muted-foreground dark:text-muted-foreground' : rr >= 2 ? 'text-profit' : rr >= 1 ? 'text-warning' : 'text-loss'}`}>
            {rr != null ? `${rr.toFixed(2)}:1` : '—'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Signal interpretation */}
        <div className={`p-3 rounded-lg ${sigInt?.bg ?? 'bg-slate-50/60'}`}>
          <p className="text-xs text-muted-foreground mb-1">الإشارة</p>
          <p className="text-sm font-semibold flex items-center gap-2">
            <span className={`text-lg ${sigInt?.cls ?? 'text-muted-foreground'}`}>
              {sigInt?.txt ?? '—'}
            </span>
            {signal != null && (
              <Badge variant="outline" className="text-xs">
                {typeof info.signal === 'number' ? (info.signal as number).toFixed(0) : (info.signal as string) ?? '—'}/100
              </Badge>
            )}
          </p>
          {signal != null && <Progress value={signal} className="h-1.5 mt-2" />}
        </div>
        {/* Trend */}
        <div className="p-3 bg-slate-50/60 rounded-lg">
          <p className="text-xs text-muted-foreground mb-1">الاتجاه العام</p>
          <p className={`text-sm font-semibold ${trendAr?.cls ?? 'text-muted-foreground'}`}>
            {trendAr?.txt ?? '—'}
          </p>
        </div>
      </div>

      {rr != null && (
        <p className="text-xs text-muted-foreground mt-3 text-center">
          المعادلة: (المقاومة {fmtNum(resistance)} − السعر {fmtNum(current)}) ÷ (السعر {fmtNum(current)} − الدعم {fmtNum(support)}) = {(rr ?? 0).toFixed(2)}:1
          {' '}
          {rr >= 2 ? '✓ ممتازة' : rr >= 1.5 ? '✓ جيدة' : '⚠ راجع قاعدة 18 (1.8:1)'}
        </p>
      )}
    </SectionCard>
  );
}
