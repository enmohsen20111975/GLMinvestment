'use client';

/**
 * persona/PersonaEmptyStates.tsx
 * ============================================================================
 * F-Phase3-Split-PersonaTab — Loading / Error / Empty states (extracted).
 *
 * (ALPHA-UX-FIX — owner directive 2026-10-28):
 * «ممكن تخلى القرف دة شكلة احسن بدل ما هو ظاهر للعميل كما لوكان عيب فى النظام»
 *
 * Redesigned the defensive state to be:
 *   1. Shorter + cleaner (no wall of text)
 *   2. Actionable (links to prediction-tracking + radar)
 *   3. Positive framing (protection, not failure)
 *   4. No technical jargon (SMA20, breadth, drawdown — customer doesn't care)
 * ============================================================================
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, RefreshCw, Shield, TrendingUp, Activity } from 'lucide-react';
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
    const isDefensive = marketRegime?.regime === 'DEFENSIVE';
    const hasRegimeData = marketRegime !== null;

    // (ALPHA-UX-FIX): redesigned — shorter, positive, actionable.
    if (loading) {
      return (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <Activity className="h-8 w-8 mx-auto mb-3 text-primary animate-pulse" />
            <p className="text-lg font-semibold mb-1">جاري تحليل الفرص</p>
            <p className="text-sm text-muted-foreground">
              {isLongTerm
                ? 'محرك المستثمر يبحث عن فرص (6-12 شهر). تحديث تلقائي كل 15 دقيقة.'
                : persona === 'balanced'
                  ? 'محرك المتوازن يبحث عن فرص (2-6 أسابيع). تحديث تلقائي كل 15 دقيقة.'
                  : 'محرك المضارب يبحث عن فرص زخم (يومي-أسبوعي). تحديث تلقائي كل 15 دقيقة.'}
            </p>
          </CardContent>
        </Card>
      );
    }

    if (isDefensive) {
      // (ALPHA-UX-FIX): defensive state — clean, short, actionable.
      return (
        <Card className="border-warning/30 bg-gradient-to-br from-warning/5 to-transparent">
          <CardContent className="p-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-warning/10 border border-warning/20 mb-3">
              <Shield className="h-6 w-6 text-warning" />
            </div>
            <p className="text-base font-bold text-warning mb-1">
              وضع حماية رأس المال
            </p>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              السوق في حالة هبوط قوي. النظام يرفع شروط الدخول تلقائيًا لحماية استثماراتك.
              تابع الفرص البديلة أدناه.
            </p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.location.hash = 'prediction-tracking';
                  }
                }}
                className="gap-1.5"
              >
                <TrendingUp className="h-4 w-4" />
                عرض التوقعات النشطة
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.location.hash = 'liquidity-radar';
                  }
                }}
                className="gap-1.5"
              >
                <Activity className="h-4 w-4" />
                رادار السيولة
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onRetry}
                className="gap-1.5"
              >
                <RefreshCw className="h-4 w-4" />
                إعادة الفحص
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    if (hasRegimeData) {
      // Normal/Aggressive regime but no picks found.
      return (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center">
            <span className="text-3xl mb-2 block">📊</span>
            <p className="text-base font-semibold mb-1">لا توجد فرص متاحة حالياً</p>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              النظام ينتظر ظهور سهم قوي بزخم مؤسسي. تحدّث البيانات كل 15 دقيقة تلقائياً.
            </p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.location.hash = 'liquidity-radar';
                  }
                }}
                className="gap-1.5"
              >
                <Activity className="h-4 w-4" />
                استكشف رادار السيولة
              </Button>
              <Button variant="ghost" size="sm" onClick={onRetry} className="gap-1.5">
                <RefreshCw className="h-4 w-4" />
                تحديث الآن
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    // Fallback — no regime data.
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center">
          <Activity className="h-8 w-8 mx-auto mb-3 text-primary animate-pulse" />
          <p className="text-base font-semibold mb-1">جاري تحليل الفرص</p>
          <p className="text-sm text-muted-foreground">
            {isLongTerm
              ? 'محرك المستثمر يبحث عن فرص (6-12 شهر).'
              : persona === 'balanced'
                ? 'محرك المتوازن يبحث عن فرص (2-6 أسابيع).'
                : 'محرك المضارب يبحث عن فرص زخم (يومي-أسبوعي).'}
          </p>
        </CardContent>
      </Card>
    );
  }

  // No empty-state branch applies — caller should render the main view.
  return null;
}
