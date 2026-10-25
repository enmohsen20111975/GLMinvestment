/**
 * specialist/FundamentalsSection.tsx — §6 Fundamentals (60-field stock_info).
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 961–1116).
 * P/E + P/B + P/S + EPS + ROE + ROA + Debt/Equity + DivYield + Margin + Float + Cap.
 *
 * Interpretation thresholds follow standard finance ranges:
 * - P/E: <8 cheap, 8-15 fair, 15-25 high, >25 very high
 * - ROE: <5 weak, 5-12 average, 12-20 good, >20 excellent
 */
import { Banknote } from 'lucide-react';
import type { StockInfo } from './types';
import { fmtCompact, fmtNum, safeNum } from './helpers';
import { SectionCard } from './primitives';

export function FundamentalsSection({ info }: { info: StockInfo }) {
  const pe = safeNum(info.pe_ratio);
  const pb = safeNum(info.pb_ratio);
  const ps = safeNum(info.ps_ratio);
  const eps = safeNum(info.eps);
  const roe = safeNum(info.roe);
  const roa = safeNum(info.roa);
  const debtToEquity = safeNum(info.debt_to_equity);
  const divYield = safeNum(info.dividend_yield);
  const profitMargin = safeNum(info.profit_margin);
  const freeFloat = safeNum(info.free_float_percentage);
  const marketCap = safeNum(info.market_cap);
  const currentRatio = safeNum(info.current_ratio);
  const bookValue = safeNum(info.book_value_per_share);
  const dpsTtm = safeNum(info.dps_ttm);

  // Hide section if literally nothing.
  if (pe == null && pb == null && eps == null && roe == null && marketCap == null && debtToEquity == null) {
    return null;
  }

  // Interpretation helpers — high/low/normal based on standard thresholds.
  const peInterp = pe == null ? null
    : pe < 0 ? { txt: 'خسارة (تعادل سالب)', cls: 'text-loss' }
    : pe < 8 ? { txt: 'رخيص جداً', cls: 'text-profit' }
    : pe < 15 ? { txt: 'تقييم عادل', cls: 'text-profit' }
    : pe < 25 ? { txt: 'مرتفع نسبياً', cls: 'text-warning' }
    : { txt: 'مرتفع جداً', cls: 'text-loss' };

  const pbInterp = pb == null ? null
    : pb < 0 ? { txt: 'قيمة دفترية سالبة', cls: 'text-loss' }
    : pb < 1 ? { txt: 'أقل من القيمة الدفترية', cls: 'text-profit' }
    : pb < 3 ? { txt: 'تقييم عادل', cls: 'text-profit' }
    : pb < 6 ? { txt: 'مرتفع نسبياً', cls: 'text-warning' }
    : { txt: 'مرتفع جداً', cls: 'text-loss' };

  const roeInterp = roe == null ? null
    : roe < 0 ? { txt: 'خسارة', cls: 'text-loss' }
    : roe >= 20 ? { txt: 'ممتاز', cls: 'text-profit' }
    : roe >= 12 ? { txt: 'جيد', cls: 'text-profit' }
    : roe >= 5 ? { txt: 'متوسط', cls: 'text-warning' }
    : { txt: 'ضعيف', cls: 'text-loss' };

  const debtInterp = debtToEquity == null ? null
    : debtToEquity < 0.3 ? { txt: 'ديون منخفضة', cls: 'text-profit' }
    : debtToEquity < 1 ? { txt: 'ديون معتدلة', cls: 'text-profit' }
    : debtToEquity < 2 ? { txt: 'ديون مرتفعة', cls: 'text-warning' }
    : { txt: 'ديون عالية جداً', cls: 'text-loss' };

  const marginInterp = profitMargin == null ? null
    : profitMargin >= 15 ? { txt: 'ممتاز', cls: 'text-profit' }
    : profitMargin >= 5 ? { txt: 'جيد', cls: 'text-profit' }
    : profitMargin >= 0 ? { txt: 'منخفض', cls: 'text-warning' }
    : { txt: 'خسارة', cls: 'text-loss' };

  const divInterp = divYield == null ? null
    : divYield >= 5 ? { txt: 'عائد مرتفع', cls: 'text-profit' }
    : divYield > 0 ? { txt: 'عائد معتدل', cls: 'text-warning' }
    : { txt: 'لا يوزع', cls: 'text-muted-foreground' };

  return (
    <SectionCard
      icon={<Banknote className="w-4 h-4" />}
      title="البيانات المالية (Fundamentals)"
      description="من stock_info: P/E + P/B + EPS + ROE + ROA + Debt/Equity + Dividend Yield + Profit Margin + Free Float + Market Cap"
      accent="emerald"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* P/E */}
        <FundamentalCard label="P/E (مكرر الربحية)" value={pe != null ? pe.toFixed(2) : '—'} interp={peInterp} />
        {/* P/B */}
        <FundamentalCard label="P/B (مكرر القيمة الدفترية)" value={pb != null ? pb.toFixed(2) : '—'} interp={pbInterp} />
        {/* P/S */}
        <FundamentalCard
          label="P/S (مكرر المبيعات)"
          value={ps != null ? ps.toFixed(2) : '—'}
          interp={null}
        />
        {/* EPS */}
        <FundamentalCard
          label="EPS (ربحية السهم) ج.م"
          value={eps != null ? eps.toFixed(3) : '—'}
          interp={eps == null ? null : { txt: eps > 0 ? 'موجب' : 'سالب', cls: eps > 0 ? 'text-profit' : 'text-loss' }}
        />
        {/* ROE */}
        <FundamentalCard label="ROE (العائد على حقوق الملكية)" value={roe != null ? `${roe.toFixed(2)}%` : '—'} interp={roeInterp} />
        {/* ROA */}
        <FundamentalCard
          label="ROA (العائد على الأصول)"
          value={roa != null ? `${roa.toFixed(2)}%` : '—'}
          interp={roa == null ? null : { txt: roa >= 5 ? 'جيد' : 'ضعيف', cls: roa >= 5 ? 'text-profit' : 'text-warning' }}
        />
        {/* Debt/Equity */}
        <FundamentalCard label="ديون / حقوق ملكية" value={debtToEquity != null ? debtToEquity.toFixed(2) : '—'} interp={debtInterp} />
        {/* Dividend Yield */}
        <FundamentalCard label="عائد التوزيعات" value={divYield != null ? `${divYield.toFixed(2)}%` : '—'} interp={divInterp} />
        {/* Profit Margin */}
        <FundamentalCard label="هامش الربح" value={profitMargin != null ? `${profitMargin.toFixed(2)}%` : '—'} interp={marginInterp} />
        {/* Free Float */}
        <FundamentalCard
          label="Free Float (تداول حر)"
          value={freeFloat != null ? `${freeFloat.toFixed(1)}%` : '—'}
          interp={freeFloat == null ? null : { txt: freeFloat >= 25 ? 'سيولة جيدة' : 'سيولة محدودة', cls: freeFloat >= 25 ? 'text-profit' : 'text-warning' }}
        />
        {/* Market Cap */}
        <FundamentalCard
          label="القيمة السوقية"
          value={marketCap != null && marketCap > 0 ? fmtCompact(marketCap, ' ج.م') : '—'}
          interp={null}
        />
        {/* DPS TTM */}
        <FundamentalCard
          label="توزيعات السهم (TTM)"
          value={dpsTtm != null ? `${dpsTtm.toFixed(3)} ج.م` : '—'}
          interp={null}
        />
        {/* Current Ratio */}
        <FundamentalCard
          label="نسبة السيولة (Current Ratio)"
          value={currentRatio != null ? currentRatio.toFixed(2) : '—'}
          interp={currentRatio == null ? null : { txt: currentRatio >= 1.5 ? 'سائلة' : currentRatio >= 1 ? 'مقبولة' : 'ضعيفة', cls: currentRatio >= 1 ? 'text-profit' : 'text-loss' }}
        />
        {/* Book Value */}
        <FundamentalCard
          label="القيمة الدفترية للسهم"
          value={fmtNum(bookValue)}
          interp={null}
        />
      </div>
    </SectionCard>
  );
}

function FundamentalCard({
  label,
  value,
  interp,
}: {
  label: string;
  value: string;
  interp: { txt: string; cls: string } | null;
}) {
  return (
    <div className="flex items-center justify-between p-2.5 bg-slate-50/60 rounded-lg border border-border">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        {interp && <p className={`text-xs ${interp.cls}`}>{interp.txt}</p>}
      </div>
      <p className="text-base font-bold text-muted-foreground dark:text-slate-200 ml-2">{value}</p>
    </div>
  );
}
