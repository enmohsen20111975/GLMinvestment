'use client';

/**
 * persona/PersonaEmptyStates.tsx
 * ============================================================================
 * F-Phase3-Split-PersonaTab — Loading / Error / Empty states (extracted).
 * ----------------------------------------------------------------------------
 * Originally lines 1489-1582 of `../PersonaTab.tsx`. Returns the appropriate
 * empty-state card based on the hook state:
 *
 *   - loading → 4× Skeleton (h-44)
 *   - error → destructive card with retry button
 *   - items.length === 0 → REGIME-FIX (2026-10-05) 3-way ternary:
 *       1. loading=true → "جاري تحليل الفرص"
 *       2. regime=DEFENSIVE → "السوق في وضع دفاعي"
 *       3. regime=NORMAL/AGGRESSIVE → "لا توجد فرص متاحة حالياً"
 *
 * Returns `null` when none of the empty-state branches apply (so the caller
 * can proceed to render the main view).
 * ============================================================================
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { PersonaEmptyStatesProps } from './types';

export function PersonaEmptyStates({
  loading,
  error,
  itemsLength,
  marketRegime,
  persona,
  isLongTerm,
  headerTheme,
  onRetry,
}: PersonaEmptyStatesProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-44 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-4 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
          <p className="text-destructive mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-4 w-4 ml-2" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (itemsLength === 0) {
    // REGIME-FIX (2026-10-05): بـ نفرّق بين 3 حالات لما items.length === 0:
    // 1. loading=true → التحليل لسه بـ يشتغل (نعرض "جاري التحليل")
    // 2. regime=DEFENSIVE → التحليل خلص بس السوق هابط (نعرض "السوق دفاعي — مفيش فرص آمنة")
    // 3. regime=NORMAL/AGGRESSIVE → التحليل خلص ومفيش فرص مؤسسية (نعرض "مفيش فرص حالياً")
    const isDefensive = marketRegime?.regime === 'DEFENSIVE';
    const hasRegimeData = marketRegime !== null;
    const headline = loading
      ? 'جاري تحليل الفرص — سيتم التحديث خلال دقائق'
      : isDefensive
        ? 'السوق في وضع دفاعي — لا توجد فرص آمنة حالياً'
        : hasRegimeData
          ? 'لا توجد فرص متاحة حالياً'
          : 'جاري تحليل الفرص — سيتم التحديث خلال دقائق';
    const subtext = loading
      ? isLongTerm
        ? 'محرك المستثمر يبحث عن فرص تناسب الشخصية طويلة المدى (6-12 شهر). تتحدث البيانات كل 15 دقيقة تلقائياً — لا يوجد تحليل لحظي على هذه الشاشة.'
        : persona === 'balanced'
          ? 'محرك المتوازن يبحث عن فرص متوسطة المدى (2-6 أسابيع). تتحدث البيانات كل 15 دقيقة تلقائياً — لا يوجد تحليل لحظي على هذه الشاشة.'
          : 'محرك المضارب يبحث عن فرص زخم قصيرة المدى (يومي-أسبوعي). تتحدث البيانات كل 15 دقيقة تلقائياً — لا يوجد تحليل لحظي على هذه الشاشة.'
      : isDefensive
        ? 'محرك التحليل فحص كل أسهم EGX ولم يجد فرصة واحدة تجتاز معايير السوق الدفاعي. هذا الإجراء لحماية رأس مالك — السوق هابط والـ engine يرفع شروط الدخول تلقائياً. ستعود الفرص عند تحسن السوق (تجاوز المؤشر للمتوسطات + ارتفاع breadth فوق 25%).'
        : hasRegimeData
          ? 'محرك التحليل فحص كل الأسهم ولم يجد فرصة واحدة تستوفي معايير الدخول الصارمة. هذا طبيعي — النظام ينتظر ظهور سهم قوي بزخم مؤسسي. تحدّث البيانات كل 15 دقيقة تلقائياً.'
          : isLongTerm
            ? 'محرك المستثمر يبحث عن فرص تناسب الشخصية طويلة المدى (6-12 شهر). تتحدث البيانات كل 15 دقيقة تلقائياً — لا يوجد تحليل لحظي على هذه الشاشة.'
            : persona === 'balanced'
              ? 'محرك المتوازن يبحث عن فرص متوسطة المدى (2-6 أسابيع). تتحدث البيانات كل 15 دقيقة تلقائياً — لا يوجد تحليل لحظي على هذه الشاشة.'
              : 'محرك المضارب يبحث عن فرص زخم قصيرة المدى (يومي-أسبوعي). تتحدث البيانات كل 15 دقيقة تلقائياً — لا يوجد تحليل لحظي على هذه الشاشة.';
    const emoji = loading
      ? headerTheme.emoji
      : isDefensive
        ? '🛡️'
        : hasRegimeData
          ? '📊'
          : headerTheme.emoji;
    const headlineColor = isDefensive
      ? 'text-warning '
      : hasRegimeData && !loading
        ? 'text-muted-foreground'
        : '';
    return (
      <Card className={isDefensive ? 'border-warning bg-warning/10 /10' : 'border-dashed'}>
        <CardContent className="p-8 text-center">
          <span className="text-4xl mb-3 block">{emoji}</span>
          <p className={`text-lg font-semibold mb-1 ${headlineColor}`}>{headline}</p>
          <p className="text-sm text-muted-foreground mb-4 whitespace-pre-line">{subtext}</p>
          {isDefensive && marketRegime?.reasons && marketRegime.reasons.length > 0 && (
            <ul className="text-xs text-muted-foreground mb-4 max-w-md mx-auto text-right space-y-1">
              {marketRegime.reasons.slice(0, 4).map((r, i) => (
                <li key={i} className="flex items-start gap-1 justify-end">
                  <span className="text-warning mt-0.5">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="h-4 w-4 ml-2" />
              تحديث الآن
            </Button>
            <a
              href="https://invist.m2y.net"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              invist.m2y.net
            </a>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No empty-state branch applies — caller should render the main view.
  return null;
}
