/**
 * specialist/ComprehensiveAnalysisSection.tsx — §12 Comprehensive Analysis.
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 1634–1776).
 * Maestro phase + Hunter assessment + Board institutional activity + News.
 *
 * MAESTRO-CANCER-1: maestro data removed (contradictory recommendations).
 * Canonical = V40.2. Only hunter + board + news are rendered.
 *
 * Graceful degrade: shows EmptyState if Python 8010 is down (no data).
 */
import { Activity, Building2, Crosshair, Newspaper } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ComprehensiveData } from './types';
import { fmtCompact, safeNum, safeStr } from './helpers';
import { EmptyState, SectionCard } from './primitives';

export function ComprehensiveAnalysisSection({ data }: { data: ComprehensiveData | null }) {
  if (!data || !data.success) {
    return (
      <SectionCard
        icon={<Activity className="w-4 h-4" />}
        title="التحليل الشامل (Maestro + Hunter + Board + News)"
        description="من /api/stocks/X/comprehensive — قد تكون فارغة إذا كان Python مطفي"
        accent="emerald"
      >
        <EmptyState msg="التحليل الشامل متاح عند تشغيل محرك البيانات (Python 8010)" />
      </SectionCard>
    );
  }

  // MAESTRO-CANCER-1: maestro data removed (contradictory recs). Canonical = V40.2.
  const maestro = null;
  const hunter = data.hunter;
  const board = data.board;
  const news = data.news ?? [];

  const hasAnything = !!maestro || !!hunter || !!board || news.length > 0;

  if (!hasAnything) {
    return (
      <SectionCard
        icon={<Activity className="w-4 h-4" />}
        title="التحليل الشامل (Maestro + Hunter + Board + News)"
        description="من /api/stocks/X/comprehensive — قد تكون فارغة إذا كان Python مطفي"
        accent="emerald"
      >
        <EmptyState msg="التحليل الشامل متاح عند تشغيل محرك البيانات (Python 8010)" />
      </SectionCard>
    );
  }

  const phase = safeStr(maestro?.phase) ?? safeStr(maestro?.regime_phase);
  const phaseMeta: Record<string, { ar: string; cls: string }> = {
    accumulation: { ar: 'تراكم', cls: 'bg-profit/10 text-profit border border-profit/20 ' },
    markup: { ar: 'تصعيد', cls: 'bg-profit/10 text-profit border border-profit/20 ' },
    distribution: { ar: 'توزيع', cls: 'bg-warning/10 text-warning dark:text-warning border border-warning/20 ' },
    decline: { ar: 'انخفاض', cls: 'bg-loss/10 text-loss border border-loss/20 ' },
  };
  const meta = phase ? phaseMeta[phase.toLowerCase()] ?? { ar: phase, cls: 'bg-muted text-muted-foreground dark:text-muted-foreground' } : null;

  const hunterScore = safeNum(hunter?.opportunity_score) ?? safeNum(hunter?.score);
  const hunterAssessment = safeStr(hunter?.assessment) ?? safeStr(hunter?.recommendation);

  const institutionalBuy = safeNum(board?.institutional_buy_volume) ?? safeNum(board?.institutional_buy);
  const institutionalSell = safeNum(board?.institutional_sell_volume) ?? safeNum(board?.institutional_sell);
  const netInstitutional = safeNum(board?.net_institutional_volume) ?? safeNum(board?.net_institutional);

  return (
    <SectionCard
      icon={<Activity className="w-4 h-4" />}
      title="التحليل الشامل (Hunter + Board + News)"
      description="من /api/stocks/X/comprehensive — 10 أقسام (graceful degrade عند توقف Python)"
      accent="emerald"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Maestro Phase */}
        {meta && (
          <div className="p-3 bg-white rounded-lg border border-border">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-profit" /> مرحلة المايسترو
            </p>
            <Badge className={`text-sm ${meta.cls}`}>{meta.ar}</Badge>
          </div>
        )}

        {/* Hunter Assessment */}
        {hunterScore != null && (
          <div className="p-3 bg-white rounded-lg border border-border">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Crosshair className="w-3.5 h-3.5 text-warning" /> تقييم الـ Hunter
            </p>
            <p className="text-2xl font-bold text-warning">{(hunterScore ?? 0).toFixed(0)}</p>
            {hunterAssessment && <p className="text-xs mt-1 text-muted-foreground dark:text-slate-200">{hunterAssessment}</p>}
          </div>
        )}

        {/* Board / Institutional Activity */}
        {(institutionalBuy != null || institutionalSell != null) && (
          <div className="p-3 bg-white rounded-lg border border-border">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-profit" /> نشاط المؤسسات
            </p>
            <div className="grid grid-cols-3 gap-2 text-xs mt-1">
              <div>
                <p className="text-muted-foreground text-xs">شراء</p>
                <p className="font-bold text-profit">{fmtCompact(institutionalBuy)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">بيع</p>
                <p className="font-bold text-loss">{fmtCompact(institutionalSell)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">صافي</p>
                <p className={`font-bold ${netInstitutional == null ? 'text-muted-foreground dark:text-muted-foreground' : netInstitutional >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {fmtCompact(netInstitutional)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* News */}
        {news.length > 0 && (
          <div className="p-3 bg-white rounded-lg border border-border">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
              <Newspaper className="w-3.5 h-3.5 text-muted-foreground" /> آخر الأخبار
            </p>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {news.slice(0, 3).map((n, i) => {
                const title = safeStr(n.title) ?? safeStr(n.headline) ?? '—';
                const sentiment = safeStr(n.sentiment);
                return (
                  <div key={i} className="text-xs">
                    <p className="line-clamp-1">{title}</p>
                    {sentiment && (
                      <span className={`text-xs ${sentiment === 'positive' || sentiment === 'POSITIVE' ? 'text-profit' : sentiment === 'negative' || sentiment === 'NEGATIVE' ? 'text-loss' : 'text-muted-foreground'}`}>
                        {sentiment}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {data.errors.length > 0 && (
        <p className="text-xs text-muted-foreground mt-3 italic">
          ⚠ تحذيرات المحركات: {data.errors.join('، ')}
        </p>
      )}
    </SectionCard>
  );
}
