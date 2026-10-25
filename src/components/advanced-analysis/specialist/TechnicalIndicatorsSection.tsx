/**
 * specialist/TechnicalIndicatorsSection.tsx — §5 Technical Indicators Panel.
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 809–959).
 * Renders RSI gauge + MA50 + MA200 + Support + Resistance + Signal tiles.
 *
 * UNIFY-FIX (Rule 73): canonical thresholds 78/65/55/40/25 (unified with unified API)
 * replaced local 70/50/30 thresholds to avoid contradictory labels.
 */
import { Progress } from '@/components/ui/progress';
import { Activity, Gauge, Shield, Target } from 'lucide-react';
import type { StockInfo } from './types';
import { fmtNum, safeNum } from './helpers';
import { SectionCard } from './primitives';

export function TechnicalIndicatorsSection({ info }: { info: StockInfo }) {
  const rsi = safeNum(info.rsi);
  const ma50 = safeNum(info.ma_50);
  const ma200 = safeNum(info.ma_200);
  const support = safeNum(info.support);
  const resistance = safeNum(info.resistance);
  const signal = safeNum(info.signal);
  const current = safeNum(info.current_price);

  // Hide section if literally nothing.
  if (rsi == null && ma50 == null && ma200 == null && support == null && resistance == null) {
    return null;
  }

  // RSI interpretation: <30 oversold (emerald), >70 overbought (red), 30-70 neutral.
  const rsiInterp = rsi == null ? { txt: '—', cls: 'text-muted-foreground' }
    : rsi < 30 ? { txt: 'تشبع بيعي — فرصة شراء محتملة', cls: 'text-profit' }
    : rsi > 70 ? { txt: 'تشبع شرائي — فرصة بيع محتملة', cls: 'text-loss' }
    : rsi >= 45 && rsi <= 55 ? { txt: 'محايد', cls: 'text-muted-foreground dark:text-muted-foreground' }
    : rsi < 45 ? { txt: 'ضعيف نسبياً', cls: 'text-warning' }
    : { txt: 'قوي نسبياً', cls: 'text-warning' };

  // MA position interpretation
  const ma50Interp = current != null && ma50 != null
    ? current > ma50
      ? { txt: 'السعر فوق MA50 — زخم صاعد', cls: 'text-profit' }
      : { txt: 'السعر تحت MA50 — زخم هابط', cls: 'text-loss' }
    : { txt: '—', cls: 'text-muted-foreground' };

  const ma200Interp = current != null && ma200 != null
    ? current > ma200
      ? { txt: 'السعر فوق MA200 — اتجاه صاعد طويل الأمد', cls: 'text-profit' }
      : { txt: 'السعر تحت MA200 — اتجاه هابط طويل الأمد', cls: 'text-loss' }
    : { txt: '—', cls: 'text-muted-foreground' };

  // Distance from support / resistance
  const distFromSupport = current != null && support != null && support > 0
    ? ((current - support) / support) * 100 : null;
  const distFromResistance = current != null && resistance != null && resistance > 0
    ? ((resistance - current) / current) * 100 : null;

  // UNIFY-FIX (Rule 73): استخدم canonical thresholds 78/65/55/40/25 (موحدة مع unified API)
  // بدل thresholds 70/50/30 المحلية المتضاربة.
  const sigNum = safeNum(info.signal);
  const sigInterp = sigNum == null ? { txt: '—', cls: 'text-muted-foreground' }
    : sigNum >= 78 ? { txt: 'شراء قوي', cls: 'text-profit' }
    : sigNum >= 65 ? { txt: 'شراء', cls: 'text-profit' }
    : sigNum >= 55 ? { txt: 'تجميع', cls: 'text-whale' }
    : sigNum >= 40 ? { txt: 'انتظار', cls: 'text-warning' }
    : sigNum >= 25 ? { txt: 'تقليل', cls: 'text-warning' }
    : { txt: 'بيع', cls: 'text-loss' };

  return (
    <SectionCard
      icon={<Gauge className="w-4 h-4" />}
      title="المؤشرات الفنية — لوحة شاملة"
      description="من stock_info: RSI + MA50 + MA200 + Support + Resistance + Signal"
      accent="emerald"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* RSI gauge */}
        <div className="p-3 bg-white rounded-lg border border-border">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
            <Gauge className="w-4 h-4 text-profit" /> RSI
          </h4>
          <p className="text-3xl font-bold">{fmtNum(rsi, 1)}</p>
          {/* RSI bar 0-100 with marker */}
          <div className="h-2 from-profit via-warning to-loss rounded-full relative mt-3">
            {rsi != null && (
              <div
                className="absolute w-3 h-4 bg-slate-900 dark:bg-white rounded-sm -top-1 border border-white shadow"
                style={{
                  right: `${Math.min(Math.max(rsi, 0), 100)}%`,
                  transform: 'translateX(50%)',
                }}
              />
            )}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>0 تشبع بيعي</span>
            <span>50 محايد</span>
            <span>100 تشبع شرائي</span>
          </div>
          <p className={`text-xs mt-2 ${rsiInterp.cls}`}>{rsiInterp.txt}</p>
        </div>

        {/* MA50 */}
        <div className="p-3 bg-white rounded-lg border border-border">
          <h4 className="font-semibold text-sm mb-2">MA50 (متوسط 50 يوم)</h4>
          <p className="text-3xl font-bold text-warning">{fmtNum(ma50)}</p>
          <p className={`text-xs mt-2 ${ma50Interp.cls}`}>{ma50Interp.txt}</p>
          {current != null && ma50 != null && (
            <p className="text-xs text-muted-foreground mt-1">
              المسافة: {((current - ma50) / ma50 * 100).toFixed(2)}%
            </p>
          )}
        </div>

        {/* MA200 */}
        <div className="p-3 bg-white rounded-lg border border-border">
          <h4 className="font-semibold text-sm mb-2">MA200 (متوسط 200 يوم)</h4>
          <p className="text-3xl font-bold text-muted-foreground dark:text-muted-foreground">{fmtNum(ma200)}</p>
          <p className={`text-xs mt-2 ${ma200Interp.cls}`}>{ma200Interp.txt}</p>
          {current != null && ma200 != null && (
            <p className="text-xs text-muted-foreground mt-1">
              المسافة: {((current - ma200) / ma200 * 100).toFixed(2)}%
            </p>
          )}
        </div>

        {/* Support */}
        <div className="p-3 bg-profit/10 rounded-lg border border-profit/20">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
            <Shield className="w-4 h-4 text-profit" /> الدعم
          </h4>
          <p className="text-3xl font-bold text-profit">{fmtNum(support)}</p>
          <p className="text-xs text-muted-foreground mt-2">
            المسافة من السعر الحالي: {distFromSupport != null ? `${distFromSupport.toFixed(2)}%` : '—'}
          </p>
        </div>

        {/* Resistance */}
        <div className="p-3 bg-loss/10 rounded-lg border border-loss/20">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
            <Target className="w-4 h-4 text-loss" /> المقاومة
          </h4>
          <p className="text-3xl font-bold text-loss">{fmtNum(resistance)}</p>
          <p className="text-xs text-muted-foreground mt-2">
            المسافة من السعر الحالي: {distFromResistance != null ? `${distFromResistance.toFixed(2)}%` : '—'}
          </p>
        </div>

        {/* Signal */}
        <div className="p-3 bg-warning/10 rounded-lg border border-warning/20">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-warning" /> الإشارة
          </h4>
          <p className="text-3xl font-bold text-warning">
            {signal != null ? (typeof signal === 'number' ? signal.toFixed(0) : signal) : '—'}
          </p>
          <p className={`text-xs mt-2 ${sigInterp.cls}`}>{sigInterp.txt}</p>
          {sigNum != null && <Progress value={sigNum} className="h-1.5 mt-2" />}
        </div>
      </div>
    </SectionCard>
  );
}
