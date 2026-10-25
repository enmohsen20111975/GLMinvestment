'use client';

/**
 * academy/AdvancedLabView.tsx
 * ============================================================================
 * F-Phase3-Split-Academy: Extracted from AcademyView.tsx (was 2,357 LOC).
 * ----------------------------------------------------------------------------
 * Advanced Lab tab (التبويب الثامن: المختبر المتقدم) — Task 36-B + 36-C.
 * Owner directive: «نزود فى المساعدات التعليمية من صور ومحاكيات ورسوم
 * بيانية ورسوم توضيحية».
 *
 * Renders all 5 new visuals + both new simulators in a single scrollable
 * layout. Each component is self-contained and teaches ONE specific concept
 * (Rule 67 — no stubs).
 * ============================================================================
 */

import {
  MarketStagesVisual,
  OrderFlowVisual,
  CandlestickPatternsVisual,
  RiskRewardVisual,
  PortfolioAllocationVisual,
} from '../LearningVisuals';
import { PortfolioSimulator } from '../PortfolioSimulator';
import { EntryTimingSimulator } from '../EntryTimingSimulator';

export function AdvancedLabView() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-profit/20 bg-profit/20 px-4 py-3 text-xs text-profit sm:px-6" dir="rtl">
        <span className="font-semibold">🔬 المختبر المتقدم —</span> 5 رسوم بيانية تفاعلية + محاكيان
        متقدمان. كل أداة بتعلمك مفهوم محدد: مراحل السوق، تدفّق الأوامر، أنماط الشموع،
        حاسبة المخاطرة/العائد، توزيع المحفظة، محاكاة Monte Carlo، ومقارنة استراتيجيات
        الدخول. اسحب، عدّل، وشغّل — التعليم بالتجربة أقوى من القراءة فقط.
      </div>

      {/* 5 visuals */}
      <MarketStagesVisual />
      <OrderFlowVisual />
      <CandlestickPatternsVisual />
      <RiskRewardVisual />
      <PortfolioAllocationVisual />

      {/* 2 simulators */}
      <PortfolioSimulator />
      <EntryTimingSimulator />
    </div>
  );
}
