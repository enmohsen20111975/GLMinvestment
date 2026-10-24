/**
 * specialist/ShariaSection.tsx — §16 Sharia Compliance.
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 1998–2062).
 * Verdict (halal/haram) + compliant sources count + purification rate (S&P).
 *
 * Source: /api/sharia — consensus from S&P + Musaffa + Kashif + Osoul + ...
 * consensus_min=6 (needs at least 6 sources for halal verdict).
 */
import { BookOpen } from 'lucide-react';
import type { ShariaResponse } from './types';
import { safeNum, safeStr } from './helpers';
import { SectionCard } from './primitives';

export function ShariaSection({ data }: { data: ShariaResponse | null }) {
  if (!data || !data.success) return null;

  const metric = data.metric;
  const isHalal = safeNum(metric?.is_halal_consensus) === 1 || metric?.is_halal_consensus === true;
  const compliantCount = safeNum(metric?.compliant_sources_count);
  const activeCount = safeNum(metric?.active_sources_count);
  const category = safeStr(metric?.category_ar) ?? safeStr(metric?.category);
  const nameAr = safeStr(metric?.name_ar);
  const needsReview = safeNum(metric?.needs_review) === 1 || metric?.needs_review === true;
  const purificationRate = (data.purification_rates ?? []).find((r) => safeNum(r.is_primary) === 1 || r.is_primary === true);
  const purRatePct = safeNum(purificationRate?.rate_pct);

  return (
    <SectionCard
      icon={<BookOpen className="w-4 h-4" />}
      title="التوافق الشرعي"
      description="من /api/sharia — مصادر: S&P + Musaffa + Kashif + Osoul + ... (consensus_min=6)"
      accent={isHalal ? 'emerald' : 'red'}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={`p-3 rounded-lg text-center ${isHalal ? 'bg-profit/10' : 'bg-loss/10'}`}>
          <p className="text-xs text-muted-foreground">الحكم</p>
          <p className={`text-lg font-bold mt-1 ${isHalal ? 'text-profit' : 'text-loss'}`}>
            {isHalal ? '✓ متوافق' : '✗ غير متوافق'}
          </p>
        </div>
        <div className="p-3 bg-slate-50/60 rounded-lg text-center">
          <p className="text-xs text-muted-foreground">المصادر المتوافقة</p>
          <p className="text-lg font-bold text-muted-foreground dark:text-slate-200 mt-1">
            {compliantCount != null && activeCount != null ? `${compliantCount}/${activeCount}` : '—'}
          </p>
        </div>
        <div className="p-3 bg-warning/10 rounded-lg text-center">
          <p className="text-xs text-muted-foreground">نسبة التطهير (S&P)</p>
          <p className="text-lg font-bold text-warning mt-1">
            {purRatePct != null ? `${purRatePct.toFixed(2)}%` : '—'}
          </p>
        </div>
      </div>

      {nameAr && (
        <p className="text-sm mt-3">
          <span className="text-muted-foreground">الاسم: </span>
          <span className="font-medium">{nameAr}</span>
        </p>
      )}
      {category && (
        <p className="text-xs mt-1">
          <span className="text-muted-foreground">التصنيف: </span>
          {category}
        </p>
      )}
      {needsReview && (
        <div className="mt-3 p-2 bg-warning/20 border border-warning/20 rounded text-xs text-warning">
          ⚠️ يحتاج مراجعة يدوية — رمز مختلف أو تعارض بين المصادر
        </div>
      )}
    </SectionCard>
  );
}
