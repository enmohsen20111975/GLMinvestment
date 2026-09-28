'use client';

/**
 * AssetPreferenceOnboarding — Modal shown on first visit so the user can
 * personalize what they see on the dashboard (Phase 5.2 — Mobile-First UX).
 *
 *   "إنت بتركم على إيه؟"
 *
 *   📈 أسهم بس     → 'stocks'
 *   💎 كريبتو بس   → 'crypto'
 *   🥇 ذهب بس      → 'gold'
 *   🌐 كل الأصول   → 'all'
 *
 * - Shows ONLY when localStorage `egx-asset-preference` is missing.
 * - "ابدأ" saves to store + localStorage, then closes.
 * - "تخطي" defaults to 'all'.
 * - RTL layout, emerald/green accents (no indigo/blue).
 */

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppStore, type AssetPreference } from '@/lib/store';

interface Option {
  value: AssetPreference;
  emoji: string;
  title: string;
  desc: string;
}

const OPTIONS: Option[] = [
  {
    value: 'stocks',
    emoji: '📈',
    title: 'أسهم بس',
    desc: 'بورصة مصر EGX والأخبار والتحليل الفني للأسهم',
  },
  {
    value: 'crypto',
    emoji: '💎',
    title: 'كريبتو بس',
    desc: 'العملات الرقمية وإشارات البيتكوين والألتكوينز',
  },
  {
    value: 'gold',
    emoji: '🥇',
    title: 'ذهب بس',
    desc: 'أسعار الذهب والمعادن الثمينة وحركة الملاذ الآمن',
  },
  {
    value: 'all',
    emoji: '🌐',
    title: 'كل الأصول',
    desc: 'الأسهم + الكريبتو + الذهب في لوحة واحدة شاملة',
  },
];

const STORAGE_KEY = 'egx-asset-preference';

export function AssetPreferenceOnboarding() {
  const { assetPreference, setAssetPreference } = useAppStore();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<AssetPreference>('all');

  // Only show on first visit (no value in localStorage yet).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw == null) {
        setOpen(true);
      } else {
        // store value may have been hydrated already; ensure sync.
        try {
          const parsed = JSON.parse(raw) as AssetPreference;
          if (parsed && parsed !== assetPreference) {
            setAssetPreference(parsed);
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    // Only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = () => {
    setAssetPreference(selected);
    setOpen(false);
  };

  const handleSkip = () => {
    setAssetPreference('all');
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        dir="rtl"
        aria-describedby="asset-pref-desc"
      >
        <DialogHeader className="text-center">
          <DialogTitle className="text-xl font-bold text-foreground text-center">
            إنت بتركم على إيه؟ 🤔
          </DialogTitle>
          <DialogDescription id="asset-pref-desc" className="text-center">
            اختار اللي بيهمك عشان نظبطلك اللوحة على مقاسك. تقدر تغيّر ده بعدين من الإعدادات.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="نوع الأصل">
          {OPTIONS.map((opt) => {
            const isActive = selected === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => setSelected(opt.value)}
                className={cn(
                  'group relative flex flex-col items-start gap-1 p-4 rounded-xl border-2 text-right transition-all min-h-[88px]',
                  isActive
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 shadow-sm'
                    : 'border-border bg-card hover:border-emerald-300 dark:hover:border-emerald-700'
                )}
              >
                <span className="text-2xl" aria-hidden>{opt.emoji}</span>
                <span
                  className={cn(
                    'text-sm font-bold',
                    isActive ? 'text-emerald-500 dark:text-emerald-300' : 'text-foreground'
                  )}
                >
                  {opt.title}
                </span>
                <span className="text-[11px] text-muted-foreground leading-snug">
                  {opt.desc}
                </span>
                {isActive && (
                  <span
                    className="absolute top-2 left-2 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white text-[10px] font-bold"
                    aria-hidden
                  >
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 mt-2">
          <Button
            type="button"
            onClick={handleStart}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-11"
          >
            ابدأ
          </Button>
          <button
            type="button"
            onClick={handleSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            تخطي (افتراضي: كل الأصول)
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AssetPreferenceOnboarding;
