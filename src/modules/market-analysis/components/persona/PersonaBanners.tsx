'use client';

/**
 * persona/PersonaBanners.tsx
 * ============================================================================
 * F-Phase3-Split-PersonaTab — Inline banner stack (extracted).
 * ----------------------------------------------------------------------------
 * Originally 3 inline banner blocks inside PersonaTab container:
 *   1. `usingFallback` warning banner (lines 1646-1658)
 *   2. `sectorHeat` hot-sectors banner (gambler-only, lines 1660-1688)
 *   3. P21-PERSONA-CONSTRAINTS HOLD banner (conservative-only, lines 1776-1803)
 *
 * Extracted here so the container stays focused on view-mode branching.
 * ============================================================================
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Info } from 'lucide-react';
import type { Persona } from './types';
import { isLongTermPersona, getPersonaJsonKey } from './helpers';
import type { StoredAnalysisItem } from '../types';

// SectorHeat shape (from usePersonaTabData). Inline to keep this file
// self-contained — the canonical type lives in the hook module.
interface HotSectorEntry {
  sector: string;
  avg_chg: number;
  rising_ratio: number;
  n: number;
  boost: number;
}
interface SectorHeatLike {
  hot?: HotSectorEntry[];
  dead?: HotSectorEntry[];
}

export interface PersonaBannersProps {
  usingFallback: boolean;
  dataSource: 'stored' | 'predictions';
  items: StoredAnalysisItem[];
  itemsCount: number;
  sectorHeat: SectorHeatLike | null;
  persona: Persona;
}

/** Fallback warning + sector heat banner stack (gambler-only sector heat). */
export function PersonaBanners({
  usingFallback,
  dataSource,
  items,
  itemsCount,
  sectorHeat,
  persona,
}: PersonaBannersProps) {
  return (
    <>
      {/* ملاحظة وضع الـ fallback (predictions فقط — sniper اتشال في P42) */}
      {usingFallback && (
        <Card className="border-warning bg-warning/10 ">
          <CardContent className="p-2.5 flex items-center gap-2 text-xs">
            <Info className="h-4 w-4 text-warning flex-shrink-0" />
            <p className="text-warning ">
              {dataSource === 'predictions'
                ? `التحليل المخزن غير متوفر بعد، نعرض أحدث التوقعات (${itemsCount} سهم). سيتم تحديث التحليل المخزن تلقائياً.`
                : `التحليل المخزن غير متوفر لهذا السوق (${itemsCount} سهم).`}
            </p>
          </CardContent>
        </Card>
      )}

      {/* C2-SECTOR-HEAT: banner القطاعات السخنة (للمضارب فقط) — بيظهر لما في قطاع
          سخن (avg_chg≥1% AND ≥60% صاعد). ده الـ "sector rotation" اللي المفروض
          المضارب يركز عليه. المستثمر مش بيشوف الـ banner ده. */}
      {persona === 'gambler' && sectorHeat && sectorHeat.hot && sectorHeat.hot.length > 0 && (
        <Card className="border-orange-300 bg-warning/10 dark:border-orange-800">
          <CardContent className="p-2.5 flex items-start gap-2 text-xs">
            <span className="text-base flex-shrink-0">🔥</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-warning mb-1">قطاعات ساخنة — دوران قطاعي إيجابي</p>
              <div className="flex flex-wrap gap-1.5">
                {sectorHeat.hot.slice(0, 4).map((s) => (
                  <span
                    key={s.sector}
                    className="px-1.5 py-0.5 rounded-full bg-warning/10 text-warning dark:text-warning border border-warning/20 whitespace-nowrap"
                    title={`avg change ${(s.avg_chg ?? 0).toFixed(2)}% — ${Math.round(s.rising_ratio * 100)}% صاعد — ${s.n} سهم — boost +${Math.round(s.boost * 100)}%`}
                  >
                    {s.sector} <span className="opacity-70">+{(s.avg_chg ?? 0).toFixed(1)}%</span>
                  </span>
                ))}
              </div>
              <p className="text-xs text-warning mt-1 opacity-80">
                أسهم هذه القطاعات حصلت على +
                {Math.round((sectorHeat.hot[0]?.boost || 0.15) * 100)}% boost في ترتيب المضارب
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

export interface PersonaHoldBannerProps {
  items: StoredAnalysisItem[];
  persona: Persona;
}

/**
 * P21-PERSONA-CONSTRAINTS (Aug 2026): HOLD Banner for Conservative.
 * لما تبقى إشارات كلها HOLD في تبويب المستثمر، اعرض رسالة واضحة فوق الكروت
 * عشان العميل يفهم إن دي حماية لرأس المال، مش "منصة ميتة".
 * المضارب لازم يبدأ يعرض توقعات الشراء اللحظية (بعد تعديل الباك-إند).
 *
 * Returns null when persona isn't conservative or holdRatio < 0.6.
 */
export function PersonaHoldBanner({ items, persona }: PersonaHoldBannerProps) {
  const isLongTerm = isLongTermPersona(persona);
  if (!isLongTerm) return null;

  const _personaKey = getPersonaJsonKey(persona);
  const holdItems = items.filter((it) => {
    const pd = it.analysisJson?.[_personaKey] || {};
    const sig = String(pd.signal || pd.verdict || '').toUpperCase();
    return sig.includes('HOLD') || sig.includes('انتظر') || sig.includes('ابعد');
  });
  const holdRatio = items.length > 0 ? holdItems.length / items.length : 0;
  if (holdRatio < 0.6) return null;

  return (
    <Card className="border-profit bg-profit/10 ">
      <CardContent className="p-3 flex items-start gap-2.5">
        <span className="text-xl flex-shrink-0 mt-0.5">🛡️</span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-profit mb-0.5">
            وضع السوق الحالي لا يناسب الاستثمار طويل المدى
          </p>
          <p className="text-xs text-profit ">
            التوقعات الحالية للانتظار والحفاظ على رأس المال ({holdItems.length} من{' '}
            {items.length} سهم). إذا كنت ترغب في فرص شراء يومية أو أسبوعية، انتقل إلى تبويب
            المضارب 🎯 — السهم الذي لا يصلح فرصةً للاستثمار قد يصلح فرصةً للمضاربة.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
