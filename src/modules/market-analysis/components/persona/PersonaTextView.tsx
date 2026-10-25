'use client';

/**
 * persona/PersonaTextView.tsx
 * ============================================================================
 * F-Phase3-Split-PersonaTab — Text view mode (extracted).
 * ----------------------------------------------------------------------------
 * Originally lines 1858-1932 of `../PersonaTab.tsx`. Renders the persona
 * predictions as raw pre-formatted text cards — one per pick — with Copy /
 * Share / Facebook action buttons per card.
 *
 * Used when `viewMode === 'text'`. The text is produced by
 * `formatSinglePersonaPickText` (already canonical in `../helpers`).
 * ============================================================================
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Share2, Facebook } from 'lucide-react';
import { toast } from 'sonner';
import type { PersonaTextViewProps } from './types';
import { cleanTicker } from './helpers';
import { formatSinglePersonaPickText } from '../helpers';

export function PersonaTextView({
  items,
  persona,
  market,
  onSelectItem,
}: PersonaTextViewProps) {
  return (
    <div className="space-y-3">
      {items.map((it) => {
        // P26: استخدم _personaKey + fallback للحقول العلوية للسهم
        const pd =
          it.analysisJson?.[persona === 'conservative' ? 'investor' : 'gambler'] || {
            verdict: it.recommendationAr || '',
            score: it.maestroScore || 0,
            reason: '',
            signal: it.recommendation || 'HOLD',
            entry: it.entry?.price ?? null,
            target: it.entry?.target ?? null,
            stop: it.entry?.stopLoss ?? null,
            timeframe:
              persona === 'balanced'
                ? '2-6 أسابيع'
                : persona === 'conservative'
                  ? '6-12 شهر'
                  : '1-5 أيام',
          };
        void pd; // pd is computed for parity with the original; text formatter handles synthesis internally.
        const ticker = cleanTicker(it.ticker);
        const singleText = formatSinglePersonaPickText(it, persona, market);
        return (
          <Card
            key={`txt-${ticker}`}
            className="border border-border cursor-pointer"
            onClick={() => onSelectItem(it)}
          >
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold">
                  {ticker} - {it.nameAr || it.name}
                </span>
                <div className="flex gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 h-7 text-xs"
                    onClick={() => {
                      navigator.clipboard.writeText(singleText);
                      toast.success('تم نسخ التحليل ✓');
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    نسخ
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 h-7 text-xs"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (navigator.share) {
                        try {
                          await navigator.share({ title: `تحليل ${ticker}`, text: singleText });
                        } catch {}
                      } else {
                        navigator.clipboard.writeText(singleText);
                        toast.success('تم نسخ التحليل ✓');
                      }
                    }}
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    مشاركة
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 h-7 text-xs border-whale text-whale hover:bg-primary dark:hover:bg-primary/20"
                    onClick={() => {
                      navigator.clipboard.writeText(singleText);
                      window.open('https://www.facebook.com/', '_blank');
                      toast.success('تم نسخ التحليل وجاري فتح فيسبوك لصق المنشور 💙');
                    }}
                  >
                    <Facebook className="h-3.5 w-3.5" />
                    فيسبوك
                  </Button>
                </div>
              </div>
              <pre
                className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-foreground/90"
                dir="rtl"
              >
                {singleText}
              </pre>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
