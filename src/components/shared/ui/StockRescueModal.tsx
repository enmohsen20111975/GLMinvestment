'use client';

/**
 * StockRescueModal — واجهة إنقاذ السهم المحبوس
 * ====================================================================
 * Per ALPHA Operational Directive (Task 3) 2026-10-20.
 *
 * Lets the user input their purchase price + share count,
 * and shows the EXPLICIT decision from the API — no flattery.
 *
 * Dumb component: ALL decisions come from API props.
 * NO calculations in React. NO marketing language.
 *
 * @example
 * <StockRescueModal
 *   open={true}
 *   onClose={() => setOpen(false)}
 *   ticker="ORAS"
 *   currentPrice={18.50}
 *   apiVerdict="exit_now"
 *   apiAdviceAr="السهم بينزف: اخرج فوراً بالخسارة الحالية لحماية باقي رأس مالك"
 *   apiRecoveryPrice={17.00}
 *   apiRecoveryTarget={19.50}
 *   apiRecoveryDays={5}
 * />
 * ====================================================================
 */

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, AlertTriangle, Shield, TrendingDown } from 'lucide-react';

export interface StockRescueModalProps {
  /** Modal open state. */
  open: boolean;
  /** Close handler. */
  onClose: () => void;
  /** Ticker symbol. */
  ticker: string;
  /** Arabic name. */
  nameAr?: string;
  /** Current price from API. */
  currentPrice?: number | null;
  // ─── API-provided verdict + advice (NO frontend calculations) ───
  /** API verdict: 'exit_now' | 'average_down' | 'hold' | 'wait' | string. */
  apiVerdict?: string | null;
  /** Plain-text advice from API (user_advice_ar). */
  apiAdviceAr?: string | null;
  /** Recovery entry price from API (for averaging down). */
  apiRecoveryPrice?: number | null;
  /** Recovery target price from API. */
  apiRecoveryTarget?: number | null;
  /** Recovery days from API. */
  apiRecoveryDays?: number | null;
}

// ─── Verdict styling (NO marketing language) ───────────────────────────

interface VerdictMeta {
  icon: React.ReactNode;
  className: string;
  defaultAr: string;
}

const VERDICT_META: Record<string, VerdictMeta> = {
  exit_now: {
    icon: <TrendingDown className="h-5 w-5" />,
    className: 'border-loss/30 bg-loss/10 text-loss',
    defaultAr: 'السهم بينزف: اخرج فوراً بالخسارة الحالية لحماية باقي رأس مالك',
  },
  average_down: {
    icon: <Shield className="h-5 w-5" />,
    className: 'border-profit/30 bg-profit/10 text-profit',
    defaultAr: 'السهم ريّح عند دعم وجفاف: اشتري كمية عند سعر منخفض وحط أمر بيع الكل عند الهدف للهروب برأس مالك',
  },
  hold: {
    icon: <AlertTriangle className="h-5 w-5" />,
    className: 'border-warning/30 bg-warning/10 text-warning',
    defaultAr: 'السهم مستقر — انتظر تطور الأداء قبل أي قرار',
  },
  wait: {
    icon: <AlertTriangle className="h-5 w-5" />,
    className: 'border-muted bg-muted/30 text-muted-foreground',
    defaultAr: 'تحت المراقبة — مفيش قرار واضح دلوقتي',
  },
};

export function StockRescueModal({
  open,
  onClose,
  ticker,
  nameAr,
  currentPrice,
  apiVerdict,
  apiAdviceAr,
  apiRecoveryPrice,
  apiRecoveryTarget,
  apiRecoveryDays,
}: StockRescueModalProps) {
  // User input fields (NOT sent to API — just for user's own tracking)
  const [userBuyPrice, setUserBuyPrice] = useState('');
  const [userShareCount, setUserShareCount] = useState('');

  const verdictKey = (apiVerdict || 'wait').toLowerCase();
  const verdictMeta = VERDICT_META[verdictKey] || VERDICT_META.wait;
  const adviceText = apiAdviceAr || verdictMeta.defaultAr;
  const showRecoveryPlan = verdictKey === 'average_down' && apiRecoveryPrice != null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 flex flex-col overflow-hidden rounded-lg" showCloseButton={false}>
        {/* Sticky header */}
        <div className="flex items-center justify-between gap-2 border-b bg-background/95 backdrop-blur px-4 py-2.5 flex-shrink-0 z-10">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary flex-shrink-0">
              🆘
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-sm font-bold truncate">
                إنقاذ سهم: {ticker}
              </DialogTitle>
              {nameAr && (
                <p className="text-xs text-muted-foreground truncate">{nameAr}</p>
              )}
            </div>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="flex-shrink-0 h-8 w-8 rounded-full" aria-label="إغلاق">
              <X className="h-4 w-4" />
            </Button>
          </DialogClose>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/10">
          {/* User input — purchase price + share count */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">سعر الشراء</label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={userBuyPrice}
                onChange={(e) => setUserBuyPrice(e.target.value)}
                className="h-8 text-sm tabular-nums"
                dir="ltr"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">عدد الأسهم</label>
              <Input
                type="number"
                placeholder="0"
                value={userShareCount}
                onChange={(e) => setUserShareCount(e.target.value)}
                className="h-8 text-sm tabular-nums"
                dir="ltr"
              />
            </div>
          </div>

          {/* Current price from API */}
          {currentPrice != null && (
            <div className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/40">
              <span className="text-muted-foreground">السعر الحالي</span>
              <span className="font-mono font-bold tabular-nums">{currentPrice.toFixed(2)}</span>
            </div>
          )}

          {/* API verdict card — EXPLICIT, no flattery */}
          <div className={cn('rounded-lg border p-3 space-y-2', verdictMeta.className)}>
            <div className="flex items-center gap-2">
              {verdictMeta.icon}
              <span className="text-sm font-bold">القرار الصريح</span>
            </div>
            <p className="text-xs leading-relaxed">{adviceText}</p>
          </div>

          {/* Recovery plan (if averaging down) — ALL from API */}
          {showRecoveryPlan && (
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="text-xs font-bold text-muted-foreground">خطة الهروب</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-muted/40 p-2">
                  <div className="text-[10px] text-muted-foreground">سعر الدخول</div>
                  <div className="font-mono text-sm font-bold tabular-nums">
                    {apiRecoveryPrice?.toFixed(2) ?? '—'}
                  </div>
                </div>
                <div className="rounded-md bg-profit/5 p-2">
                  <div className="text-[10px] text-muted-foreground">بيع الكل عند</div>
                  <div className="font-mono text-sm font-bold tabular-nums text-profit">
                    {apiRecoveryTarget?.toFixed(2) ?? '—'}
                  </div>
                </div>
                <div className="rounded-md bg-muted/40 p-2">
                  <div className="text-[10px] text-muted-foreground">المدة</div>
                  <div className="font-mono text-sm font-bold tabular-nums">
                    {apiRecoveryDays != null ? `${apiRecoveryDays} أيام` : '—'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default StockRescueModal;
