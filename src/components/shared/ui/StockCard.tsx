'use client';

/**
 * StockCard — Unified stock/asset card with trade parameters
 * ====================================================================
 * Per ALPHA Operational Directive 2026-10-20.
 *
 * Dumb presentational component: receives ALL data via props.
 * NO calculations in the frontend (per owner directive).
 * NO marketing language — plain market terms only.
 *
 * Track-based status badges:
 *   GOLDEN_DIP           → "سهم ريّح عند الدعم" (neutral/green)
 *   PEAK_MINEFIELD_WAIT  → "في قمة.. متشتريش" (yellow warning)
 *   FALLING_KNIFE_VETO   → "سهم بيقع.. ابعد عنه" (red danger)
 *
 * Trade Parameters Grid (4 cells):
 *   1. سعر الدخول     (entryPrice)
 *   2. وقف الخسارة   (stopLoss)
 *   3. بيع نص الكمية (tp1Price + tp1Pct)
 *   4. المدة          (holdingDays / maxHoldDays)
 *
 * @example
 * <StockCard
 *   ticker="ABUK"
 *   nameAr="أبو قير للأسمدة"
 *   price={125.50}
 *   change={2.5}
 *   track="GOLDEN_DIP"
 *   entryPrice={125.00}
 *   stopLoss={120.00}
 *   tp1Price={133.00}
 *   tp1Pct={6.4}
 *   holdingDays={2}
 *   maxHoldDays={5}
 *   userAdviceAr="ادخل بحجم 2% — السهم ريّح عند الدعم"
 *   variant="detailed"
 * />
 * ====================================================================
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { StockIconMini } from '@/modules/stock-analysis/components/StockIcon';
import { TrendIndicator } from './TrendIndicator';

// ─── Track badge metadata (NO marketing language) ───────────────────────

export type StockTrack =
  | 'GOLDEN_DIP'
  | 'PEAK_MINEFIELD_WAIT'
  | 'FALLING_KNIFE_VETO'
  | string;

interface TrackMeta {
  label: string;
  className: string;
}

const TRACK_BADGES: Record<string, TrackMeta> = {
  GOLDEN_DIP: {
    label: 'سهم ريّح عند الدعم',
    className: 'bg-muted text-muted-foreground border-border',
  },
  PEAK_MINEFIELD_WAIT: {
    label: 'في قمة.. متشتريش',
    className: 'bg-warning/10 text-warning border-warning/20',
  },
  FALLING_KNIFE_VETO: {
    label: 'سهم بيقع.. ابعد عنه',
    className: 'bg-loss/10 text-loss border-loss/20',
  },
};

// ─── Props ───────────────────────────────────────────────────────────────

export interface StockCardProps {
  /** Ticker symbol. */
  ticker: string;
  /** Arabic name. */
  nameAr?: string;
  /** English name. */
  name?: string;
  /** Current price. */
  price?: number | null;
  /** Price change (percent or value). */
  change?: number | null;
  /** Format for the change display. default: 'percent'. */
  changeFormat?: 'percent' | 'value';
  /** Sector name (for detailed variant). */
  sector?: string | null;
  /** Signal/trading recommendation (for detailed variant). */
  signal?: string | null;
  /** Arabic signal label. */
  signalAr?: string | null;
  /** Movement stage (for detailed variant). */
  stage?: string | null;
  /** Arabic stage label. */
  stageAr?: string | null;
  /** Risk/Reward ratio (for detailed variant). */
  riskReward?: number | null;
  /** Logo URL from API. */
  logoUrl?: string | null;

  // ─── ALPHA Operational Directive: trade parameters ──────────────────
  /** Track classification (GOLDEN_DIP / PEAK_MINEFIELD_WAIT / FALLING_KNIFE_VETO). */
  track?: StockTrack | null;
  /** Entry price from API. */
  entryPrice?: number | null;
  /** Stop loss price from API. */
  stopLoss?: number | null;
  /** TP1 price (بيع نص الكمية) from API. */
  tp1Price?: number | null;
  /** TP1 percentage (e.g. +6.5%) from API. */
  tp1Pct?: number | null;
  /** Current holding days from API. */
  holdingDays?: number | null;
  /** Max holding days from API. */
  maxHoldDays?: number | null;
  /** Plain-text advice from API (user_advice_ar). */
  userAdviceAr?: string | null;

  /** Card variant. default: 'compact'. */
  variant?: 'compact' | 'detailed';
  /** Click handler. */
  onClick?: () => void;
  /** Extra className. */
  className?: string;
}

// ─── Helper: format number or dash ──────────────────────────────────────

function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(2);
}

// ─── Component ──────────────────────────────────────────────────────────

export function StockCard({
  ticker,
  nameAr,
  name,
  price,
  change,
  changeFormat = 'percent',
  sector,
  signal,
  signalAr,
  stage,
  stageAr,
  riskReward,
  logoUrl,
  track,
  entryPrice,
  stopLoss,
  tp1Price,
  tp1Pct,
  holdingDays,
  maxHoldDays,
  userAdviceAr,
  variant = 'compact',
  onClick,
  className,
}: StockCardProps) {
  const cleanTicker = (ticker || '').replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
  const displayName = nameAr || name || cleanTicker;

  // Track badge (if present)
  const trackMeta = track ? TRACK_BADGES[track] : undefined;

  if (variant === 'compact') {
    return (
      <Card
        className={cn('border-border hover:border-primary/30 transition-colors cursor-pointer', className)}
        onClick={onClick}
      >
        <CardContent className="p-3 flex items-center gap-3">
          <StockIconMini
            ticker={cleanTicker}
            name={displayName}
            sector={sector}
            logoUrl={logoUrl}
            className="w-8 h-8"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-sm truncate">{cleanTicker}</span>
              <span className="font-mono text-sm font-bold tabular-nums">
                {price != null ? price.toFixed(2) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground truncate">{displayName}</span>
              {change != null && (
                <TrendIndicator value={change} format={changeFormat} size="xs" />
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ─── Detailed variant with trade parameters ──────────────────────────
  return (
    <Card
      className={cn('border-border hover:border-primary/30 transition-colors cursor-pointer', className)}
      onClick={onClick}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header: icon + ticker + name + track badge */}
        <div className="flex items-center gap-3">
          <StockIconMini
            ticker={cleanTicker}
            name={displayName}
            sector={sector}
            logoUrl={logoUrl}
            className="w-10 h-10"
          />
          <div className="flex-1 min-w-0">
            <span className="font-bold text-base">{cleanTicker}</span>
            <p className="text-xs text-muted-foreground truncate">{displayName}</p>
          </div>
          {/* Track badge — NO marketing language */}
          {trackMeta && (
            <span className={cn(
              'inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap',
              trackMeta.className,
            )}>
              {trackMeta.label}
            </span>
          )}
        </div>

        {/* Price + change */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] text-muted-foreground">السعر</span>
            <div className="font-mono text-lg font-bold tabular-nums">
              {price != null ? price.toFixed(2) : '—'}
            </div>
          </div>
          {change != null && (
            <TrendIndicator value={change} format={changeFormat} size="md" />
          )}
        </div>

        {/* ─── Trade Parameters Grid (4 cells) ─────────────────────────── */}
        {(entryPrice != null || stopLoss != null || tp1Price != null || holdingDays != null) && (
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50">
            {/* سعر الدخول */}
            <div className="rounded-md bg-muted/40 p-2 text-center">
              <div className="text-[10px] text-muted-foreground">سعر الدخول</div>
              <div className="font-mono text-sm font-bold tabular-nums">{fmtNum(entryPrice)}</div>
            </div>
            {/* وقف الخسارة */}
            <div className="rounded-md bg-loss/5 p-2 text-center">
              <div className="text-[10px] text-muted-foreground">وقف الخسارة</div>
              <div className="font-mono text-sm font-bold tabular-nums text-loss">{fmtNum(stopLoss)}</div>
            </div>
            {/* بيع نص الكمية (TP1) */}
            <div className="rounded-md bg-profit/5 p-2 text-center">
              <div className="text-[10px] text-muted-foreground">بيع نص الكمية</div>
              <div className="font-mono text-sm font-bold tabular-nums text-profit">
                {fmtNum(tp1Price)}
                {tp1Pct != null && (
                  <span className="text-[9px] font-normal text-muted-foreground ml-1">
                    (+{tp1Pct.toFixed(1)}%)
                  </span>
                )}
              </div>
            </div>
            {/* المدة */}
            <div className="rounded-md bg-muted/40 p-2 text-center">
              <div className="text-[10px] text-muted-foreground">المدة</div>
              <div className="font-mono text-sm font-bold tabular-nums">
                {holdingDays != null && maxHoldDays != null ? (
                  <span>يوم {holdingDays} من {maxHoldDays}</span>
                ) : maxHoldDays != null ? (
                  <span>{maxHoldDays} أيام</span>
                ) : (
                  '—'
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── user_advice_ar (plain text from API) ───────────────────── */}
        {userAdviceAr && (
          <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground leading-relaxed">
            {userAdviceAr}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default StockCard;

// ─── Sanitization helper ────────────────────────────────────────────────
// Per ALPHA Operational Directive §3:
// FALLING_KNIFE_VETO + PEAK_MINEFIELD_WAIT excluded from "buy opportunities".
// Only show in "warnings/watch" tab.

/** Returns true if this stock should be EXCLUDED from buy/opportunity lists. */
export function isWarningOrVeto(track: StockTrack | null | undefined): boolean {
  if (!track) return false;
  const t = String(track).toUpperCase();
  return t === 'FALLING_KNIFE_VETO' || t === 'PEAK_MINEFIELD_WAIT';
}

/** Returns true if this stock is safe to show in buy/opportunity lists. */
export function isBuyOpportunity(track: StockTrack | null | undefined): boolean {
  return !isWarningOrVeto(track);
}
