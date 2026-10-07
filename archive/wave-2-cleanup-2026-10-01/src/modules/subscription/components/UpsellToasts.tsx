'use client';

/**
 * UpsellToasts — تنبيهات الـ upsell (3 لحظات)
 * ============================================================
 *
 * بيتفعّل في 3 لحظات:
 *   1. لما المستخدم يوصل 80% من حد Free (4 أسهم في watchlist أو 4 صفقات في محفظة)
 *   2. لما يستخدم AI 3 مرات في يوم (خلص حصته)
 *   3. لما يفتح Pro feature (backtest / Devil / Hunter)
 *
 * القواعد:
 *   - max 1 toast/جلسة (تتخزّن في sessionStorage)
 *   - زر "جرّب Premium" + زر "لاحقاً" (مش "لا")
 *   - زر "جرّب Premium" → يفتح PricingView
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Crown, X, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { PricingView } from './PricingView';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const SESSION_KEY = 'upsell_shown_session';
const TRIGGER_COOLDOWN_MS = 60 * 1000; // دقيقة بين كل trigger

type UpsellTrigger = 'limit_80' | 'ai_depleted' | 'pro_feature';

interface UpsellToastOptions {
  trigger: UpsellTrigger;
  feature?: string;
}

const TRIGGER_MESSAGES: Record<UpsellTrigger, { title: string; body: string }> = {
  limit_80: {
    title: 'اقتربت من الحد الأقصى',
    body: 'وصلت لـ 80% من حدود الباقة المجانية. Premium بيفتح غير محدود.',
  },
  ai_depleted: {
    title: 'خلصت رسائل AI اليوم',
    body: 'استخدمت كل رسائل AI المجانية (3/يوم). Premium بيفتح غير محدود.',
  },
  pro_feature: {
    title: 'هذه ميزة Pro',
    body: 'الـ Backtesting + Devil\'s Advocate + Hunter متاحة في باقة Pro. جرّب 14 يوم مجاناً.',
  },
};

export function useUpsellToast() {
  const [pricingOpen, setPricingOpen] = useState(false);

  const showToast = useCallback(({ trigger, feature }: UpsellToastOptions) => {
    // فحص الـ session storage: لو اتعرض في الجلسة دي، متعرضش تاني
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
    } catch {
      /* ignore */
    }

    // فحص الـ cooldown
    const lastShown = parseInt(localStorage.getItem('upsell_last_shown') || '0', 10);
    if (Date.now() - lastShown < TRIGGER_COOLDOWN_MS) return;

    const msg = TRIGGER_MESSAGES[trigger];

    toast(msg.title, {
      description: msg.body,
      duration: 8000,
      icon: <Crown className="w-4 h-4 text-amber-500" />,
      action: {
        label: 'جرّب Premium',
        onClick: () => setPricingOpen(true),
      },
      cancel: {
        label: 'لاحقاً',
        onClick: () => {
          /* dismiss */
        },
      },
      onDismiss: () => {
        try {
          sessionStorage.setItem(SESSION_KEY, '1');
          localStorage.setItem('upsell_last_shown', String(Date.now()));
        } catch {
          /* ignore */
        }
      },
    });

    // console.log للتحليل
    console.log(`[upsell] trigger=${trigger} feature=${feature || 'none'}`);
  }, []);

  const PricingDialog = pricingOpen ? (
    <Dialog open={pricingOpen} onOpenChange={setPricingOpen}>
      <DialogContent className="max-w-5xl w-[calc(100%-1rem)] max-h-[90vh] overflow-y-auto p-0" dir="rtl">
        <DialogHeader className="sr-only">
          <DialogTitle>باقات الاشتراك</DialogTitle>
        </DialogHeader>
        <PricingView
          onCheckoutSuccess={(iframeUrl) => {
            window.location.href = iframeUrl;
          }}
        />
      </DialogContent>
    </Dialog>
  ) : null;

  return { showUpsell: showToast, PricingDialog };
}
