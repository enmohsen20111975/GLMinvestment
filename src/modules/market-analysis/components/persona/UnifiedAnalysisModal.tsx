'use client';

/**
 * persona/UnifiedAnalysisModal.tsx
 * ============================================================================
 * F-Phase3-Split-PersonaTab — Unified Analysis Modal (extracted).
 * ----------------------------------------------------------------------------
 * Originally lines 2165-2220 of `../PersonaTab.tsx`. Full-screen Dialog that
 * hosts the heavy `SingleStockAnalysisView` (chart + Stock DNA + SMC +
 * candle probability + trading plan) when the user drills into a ticker.
 *
 * ════════════════════════════════════════════════════════════════════
 * 🪟 نافذة التحليل الشامل (Unified Analysis Modal)
 * بدل ما المستهم يتنقل لصفحة جديدة، نفتح Dialog ضخمة فوق الشاشة
 * فيها كل مكونات التحليل: الشارت التفاعلي + بصمة السهم (Stock DNA)
 * + تحليل الحيتان (SMC) + توقع الشمعة (Candle Probability) + خطة التداول.
 * نعيد استخدام SingleStockAnalysisView الموجود بالفعل وتمرير ticker فقط.
 * ════════════════════════════════════════════════════════════════════
 * ============================================================================
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog';
import dynamic from 'next/dynamic';
import { BarChart3, X, Loader2 } from 'lucide-react';
import type { UnifiedAnalysisModalProps } from './types';
import { cleanTicker } from './helpers';

// NOTE: PHASE3-BUNDLE-OPT — dynamic import relocated from MarketAnalysisView.tsx.
// Relative path points two directories up since this file lives in
// market-analysis/components/persona/.
const SingleStockAnalysisViewDynamic = dynamic(
  () =>
    import('@/modules/market-analysis/components/SingleStockAnalysisView').then((m) => ({
      default: m.SingleStockAnalysisView,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    ),
  }
);

export function UnifiedAnalysisModal({
  selectedTicker,
  selectedContext,
  onClose,
}: UnifiedAnalysisModalProps) {
  return (
    <Dialog
      open={!!selectedTicker}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-[95vw] sm:max-w-[95vw] w-full h-[90vh] p-0 gap-0 flex flex-col overflow-hidden rounded-lg"
        showCloseButton={false}
      >
        {/* ─── Sticky Header — يظل ثابتاً أثناء التمرير للأسفل ─── */}
        <div className="flex items-center justify-between gap-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-2.5 flex-shrink-0 z-10">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary flex-shrink-0">
              <BarChart3 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-sm md:text-base font-bold truncate">
                نافذة التحليل الشامل
              </DialogTitle>
              {selectedTicker && (
                <p className="text-xs md:text-xs text-muted-foreground truncate">
                  {cleanTicker(selectedTicker)} — الشارت • بصمة السهم • SMC • خطة التداول
                </p>
              )}
            </div>
            {selectedContext && (
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-profit text-white font-bold">
                  {selectedContext.rating} · {(selectedContext.score ?? 0).toFixed(0)}%
                </span>
              </div>
            )}
          </div>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="flex-shrink-0 h-9 w-9 rounded-full hover:bg-muted"
              aria-label="إغلاق نافذة التحليل"
            >
              <X className="h-5 w-5" />
            </Button>
          </DialogClose>
        </div>

        {/* ─── Scrollable Body — SingleStockAnalysisView يحتوي على كل المكونات ─── */}
        <div className="flex-1 overflow-y-auto p-3 md:p-4 bg-muted/10">
          {selectedTicker && (
            <SingleStockAnalysisViewDynamic
              key={selectedTicker}
              initialTicker={cleanTicker(selectedTicker)}
              predictionContext={selectedContext ?? undefined}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
