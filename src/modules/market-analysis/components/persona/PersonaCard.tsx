'use client';

/**
 * persona/PersonaCard.tsx
 * ============================================================================
 * F-Phase3-Split-PersonaTab — PersonaCard component (extracted verbatim).
 * ----------------------------------------------------------------------------
 * Originally lines 140-758 of `../PersonaTab.tsx`. Card that renders a single
 * persona pick with:
 *   - Header: logo/emoji + ticker + Sharia badge + sector badges + verdict
 *   - P16-PERSONA-DIVERGENCE: persona signature chip (P/E ROE upside dividend)
 *   - Prediction grid (entry / target / stop)
 *   - Sniper gates visual (5 gates with pass/fail icons + tooltips)
 *   - Quick metrics row (RSI / R-R / Volume)
 *   - Momentum row (مضارب) or Fundamentals row (مستثمر)
 *   - Market regime + S/R levels + reason + narrative + conditions
 *   - Copy/Share/Facebook action buttons
 *   - Footer: score reference + beta/volatility/signal
 * ============================================================================
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, Crosshair, Copy, Share2, ShieldCheck, ShieldX, Target, Gauge, Facebook } from 'lucide-react';
import { cn, scoreColor } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { toast } from 'sonner';
import { getTrialStatus } from '@/lib/subscription-gate';
import { ShariaBadge } from '@/modules/sharia/components/ShariaBadge';
import type { PersonaCardProps } from './types';
import {
  getPersonaTheme,
  isLongTermPersona,
  formatVol,
  perfColor,
} from './helpers';
import {
  getVerdictColor,
  formatSinglePersonaPickText,
} from '../helpers';
import type { StoredAnalysisItem } from '../types';

export function PersonaCard({
  ticker,
  persona,
  data,
  maestroScore,
  updatedAt,
  narrative,
  market,
  nameAr,
  logoUrl,
  fundamentals,
  onClick,
}: PersonaCardProps) {
  const { loadStockDetail } = useAppStore();
  const subscriptionUser = useAppStore((s) => s.user);
  const colors = getVerdictColor(data.verdict);
  const score = data.score ?? 0;
  // P26: isInvestor بقى معناها "أفق طويل" = conservative (conservative = alias قديم لـ investor)
  const isInvestor = isLongTermPersona(persona);
  // PAYWALL Gate 1: fair value locked for free users post-trial
  const fairValueSubStatus = getTrialStatus(subscriptionUser);
  const fairValueLocked = fairValueSubStatus.isFreeUser && fairValueSubStatus.isTrialExpired;

  // ألوان البرسونا — emerald للمستثمر، amber للمتوازن، fuchsia للمضارب (تجنّب blue/indigo)
  const personaTheme = getPersonaTheme(persona);

  const targetPct =
    data.entry && data.target && data.entry > 0
      ? ((data.target - data.entry) / data.entry) * 100
      : null;
  const stopPct =
    data.entry && data.stop && data.entry > 0
      ? ((data.stop - data.entry) / data.entry) * 100
      : null;

  // Gates data from sniper engine
  const hasGates = data.gates && data.gates.passed > 0;
  const gatesList = data.gates
    ? [
        { label: 'السيولة', passed: data.gates.liquidity, detail: data.gate_details?.liquidity_reason },
        { label: 'الاتجاه', passed: data.gates.trend, detail: data.gate_details?.trend_reason },
        { label: 'دعم/مقاومة', passed: data.gates.support_resistance, detail: data.gate_details?.sr_reason },
        { label: 'عائد/مخاطرة', passed: data.gates.risk_reward, detail: data.gate_details?.rr_reason },
        { label: 'التأكيد', passed: data.gates.confirmation, detail: data.gate_details?.confirmation_reason },
      ]
    : [];

  return (
    <Card
      className={cn(
        'border-2',
        colors.border,
        'overflow-hidden transition-all duration-200 hover:shadow-md cursor-pointer',
        hasGates && data.gates!.passed >= 4 && 'ring-1 ring-profit ',
        hasGates && data.gates!.passed >= 5 && 'ring-2 ring-profit '
      )}
      onClick={onClick || (() => loadStockDetail(ticker))}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={ticker}
                className="w-9 h-9 rounded-full object-contain bg-background border border-border flex-shrink-0"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <span className="text-2xl flex-shrink-0">{personaTheme.emoji}</span>
            )}
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <CardTitle className="text-lg">{ticker}</CardTitle>
                {/* Task 23-C Deliverable 2 — inline Sharia badge next to each
                  stock in the predictions list. EGX-only: the API returns
                  404 for non-EGX markets, in which case the badge shows
                  "غير متاح". */}
                {market === 'EGX' && <ShariaBadge ticker={ticker} variant="compact" />}
              </div>
              {nameAr && (
                <p className="text-xs text-muted-foreground leading-tight">{nameAr}</p>
              )}
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className={cn('text-xs font-semibold', personaTheme.accent)}>
                  {personaTheme.label}
                </p>
                {/* C2-SECTOR-HEAT + CL7-UI-SECTORS: اعرض القطاع من fundamentals
                  (الـ backend بيملأه) مع شارة سخونة القطاع (🔥 hot / ❄️ dead)
                  وشارة دور السهم (قائد/تابع/متأخر). ده بيخلي العميل يفهم ليه
                  المنصة اختارت السهم ده (لأنه قائد قطاع بيتحرك). */}
                {(fundamentals?.sector || data.sector) && (
                  <span
                    className={cn(
                      'text-xs px-1.5 py-0 rounded-full border flex items-center gap-0.5',
                      fundamentals?.sector_heat === 'hot'
                        ? 'bg-warning/10 text-warning dark:text-warning border border-warning/20'
                        : fundamentals?.sector_heat === 'dead'
                          ? 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-800'
                          : 'bg-muted text-muted-foreground border-border'
                    )}
                    title={
                      fundamentals?.sector_heat === 'hot'
                        ? 'قطاع سخن — دوران قطاعي إيجابي (+15% boost للمضارب)'
                        : fundamentals?.sector_heat === 'dead'
                          ? 'قطاع ميت — معظم الأسهم هابطة (-10% penalty للمضارب)'
                          : undefined
                    }
                  >
                    {fundamentals?.sector_heat === 'hot' && <span>🔥</span>}
                    {fundamentals?.sector_heat === 'dead' && <span>❄️</span>}
                    {fundamentals?.sector || data.sector}
                  </span>
                )}
                {/* CL7-UI-SECTORS: شارة دور السهم جوه قطاعه (قائد/تابع/متأخر).
                  قائد قطاع ساخن = فرصة قوية للمضارب. متأخر في قطاع ميت = تجنّب. */}
                {fundamentals?.sector_role && fundamentals.sector_role !== 'mid' && (
                  <span
                    className={cn(
                      'text-xs px-1.5 py-0 rounded-full border flex items-center gap-0.5',
                      fundamentals.sector_role === 'leader'
                        ? 'bg-profit text-profit border-profit/20 '
                        : 'bg-loss/10 text-loss border-loss/20 '
                    )}
                    title={
                      fundamentals.sector_role === 'leader'
                        ? 'قائد القطاع — السهم بيقود حركة القطاع (مفضّل للمضارب في قطاع ساخن)'
                        : 'متأخر عن القطاع — السهم بيتأخر عن حركة القطاع (مرفوض للمضارب في قطاع ميت)'
                    }
                  >
                    {fundamentals.sector_role === 'leader' ? '👑 قائد' : '⬇️ متأخر'}
                  </span>
                )}
                {data.is_egx30 && (
                  <span className="text-xs px-1.5 py-0 rounded-full bg-warning/10 text-warning dark:text-warning border border-warning/20 ">
                    EGX30
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="text-left flex flex-col items-end gap-1">
            <Badge className={cn(colors.bg, colors.text, 'border-0 text-sm font-bold')}>
              {data.verdict || 'قيد التحليل'}
            </Badge>
            {/* DYNAMIC-SYSTEM-001: شارة "مراقبة" صفراء للأسهم اللي إشارتها HOLD
              بس درجتها عالية (>= 50%) — عشان تبويب المستثمر ميفضلش فاضي.
              المستخدم طلب: "لو السهم إشارته HOLD بس درجته عالية، اعرضه
              واكتب تحته بـ Badge لونه أصفر: مراقبة - انتظر كسر المقاومة" */}
            {isInvestor &&
              data.signal &&
              String(data.signal).toUpperCase() === 'HOLD' &&
              (data.score ?? 0) >= 50 && (
                <Badge
                  variant="outline"
                  className="text-xs px-1.5 py-0 border-warning/20 bg-warning/10 text-warning dark:text-warning "
                >
                  👁️ مراقبة — انتظر كسر المقاومة
                </Badge>
              )}
            {data.gates && (
              <Badge
                variant="outline"
                className={cn(
                  'text-xs px-1.5 py-0',
                  data.gates.passed >= 4
                    ? 'border-profit text-profit '
                    : data.gates.passed >= 3
                      ? 'border-warning text-warning '
                      : 'border-loss text-loss '
                )}
              >
                <Crosshair className="h-2.5 w-2.5 ml-0.5" />
                {data.gates.passed}/5
              </Badge>
            )}
            {updatedAt && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(updatedAt).toLocaleDateString('ar-EG', {
                  day: 'numeric',
                  month: 'short',
                })}
              </p>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* ══════ P16-PERSONA-DIVERGENCE: توقيع البرسونا (chip مميز لكل persona) ══════ */}
        {fundamentals && (
          <div
            className={cn(
              'rounded-md p-2 text-xs flex flex-wrap items-center gap-1.5',
              personaTheme.accentBg,
              personaTheme.accentBorder,
              'border'
            )}
          >
            {isInvestor ? (
              <>
                <span className={cn('font-bold', personaTheme.accent)}>🏦 توقيع المستثمر:</span>
                {fundamentals.pe_ratio ? (
                  <span>P/E {(fundamentals.pe_ratio ?? 0).toFixed(1)}</span>
                ) : null}
                {fundamentals.roe ? (
                  <span>• ROE {(fundamentals.roe ?? 0).toFixed(0)}%</span>
                ) : null}
                {fundamentals.fair_value_upside ? (
                  <span className="text-profit ">
                    • خصم {(fundamentals.fair_value_upside ?? 0).toFixed(1)}%
                  </span>
                ) : null}
                {fundamentals.dividend_yield ? (
                  <span>• توزيع {(fundamentals.dividend_yield ?? 0).toFixed(1)}%</span>
                ) : null}
              </>
            ) : (
              <>
                <span className={cn('font-bold', personaTheme.accent)}>🎯 توقيع المضارب:</span>
                {fundamentals.volume_ratio && fundamentals.volume_ratio >= 1.0 ? (
                  <span>حجم {(fundamentals.volume_ratio ?? 0).toFixed(1)}x</span>
                ) : null}
                {fundamentals.change_1d ? (
                  <span className={fundamentals.change_1d > 0 ? 'text-profit ' : 'text-loss '}>
                    • {fundamentals.change_1d > 0 ? '+' : ''}
                    {(fundamentals.change_1d ?? 0).toFixed(1)}%
                  </span>
                ) : null}
                {fundamentals.volatility ? (
                  <span>• تقلب {(fundamentals.volatility ?? 0).toFixed(1)}%</span>
                ) : null}
                {fundamentals.rsi ? (
                  <span>• RSI {(fundamentals.rsi ?? 0).toFixed(0)}</span>
                ) : null}
              </>
            )}
          </div>
        )}

        {/* ══════ التوقع — المحور الأساسي ══════ */}
        {(data.entry || data.target || data.stop) && (
          <div
            className={cn(
              'rounded-lg p-3 border-2',
              data.risk_reward && data.risk_reward >= 2.0
                ? 'bg-profit/10 border-profit '
                : data.risk_reward && data.risk_reward >= 1.5
                  ? 'bg-warning/10 border-warning '
                  : 'bg-muted/50 border-border'
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-foreground">🎯 التوقع</span>
              {data.risk_reward && data.risk_reward > 0 && (
                <span
                  className={cn(
                    'text-lg font-black',
                    data.risk_reward >= 3
                      ? 'text-profit '
                      : data.risk_reward >= 2
                        ? 'text-profit'
                        : data.risk_reward >= 1.5
                          ? 'text-warning '
                          : 'text-loss '
                  )}
                >
                  1:{(data.risk_reward ?? 0).toFixed(1)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-sm min-w-0">
              <div className="rounded-md bg-background/60 p-2 min-w-0">
                <p className="text-muted-foreground text-xs mb-0.5">💰 ادخل</p>
                <p className="font-bold text-foreground text-base">
                  {data.entry ? (data.entry ?? 0).toFixed(2) : '—'}
                </p>
              </div>
              <div className="rounded-md bg-profit/10 /30 p-2">
                <p className="text-profit text-xs mb-0.5">
                  📈 هدف{targetPct !== null && ` +${(targetPct ?? 0).toFixed(1)}%`}
                </p>
                <p className="font-bold text-profit text-base">
                  {data.target ? (data.target ?? 0).toFixed(2) : '—'}
                </p>
              </div>
              <div className="rounded-md bg-loss/10 /30 p-2">
                <p className="text-loss text-xs mb-0.5">
                  🛑 وقف{stopPct !== null && ` ${(stopPct ?? 0).toFixed(1)}%`}
                </p>
                <p className="font-bold text-loss text-base">
                  {data.stop ? (data.stop ?? 0).toFixed(2) : '—'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ALPHA-RR-GATE-1: الصفقات الـ R/R < 1.5 اتشالت من الجدول — مش محتاجين تحذير */}

        {/* Score bar */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">
              {data.sniper_score ? '🎯 نتيجة التصطاد' : 'النتيجة'}
            </span>
            <span className="font-bold font-mono tabular-nums glow-primary">
              {(score ?? 0).toFixed(0)}/100
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', scoreColor(score))}
              style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
            />
          </div>
        </div>

        {/* Gates visual — من محرك التصطاد (مع أسباب كل بوابة) */}
        {hasGates && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1">
                <Crosshair className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs text-muted-foreground">
                  بوابات التصفية ({data.gates?.passed ?? 0}/5)
                </span>
              </div>
            </div>
            <div className="flex gap-1">
              {gatesList.map((gate, i) => (
                <div
                  key={i}
                  title={gate.detail || ''}
                  className={cn(
                    'flex-1 flex flex-col items-center gap-0.5 rounded-md py-1.5 px-0.5 text-xs transition-colors cursor-default',
                    gate.passed
                      ? 'bg-profit text-profit/40 '
                      : 'bg-loss/10 text-loss '
                  )}
                >
                  {gate.passed ? (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  ) : (
                    <ShieldX className="h-3.5 w-3.5" />
                  )}
                  <span className="truncate w-full text-center">{gate.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick metrics row — RSI + R/R + Volume */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          {/* RSI */}
          <div className="rounded-md bg-muted/50 p-1.5 text-center">
            <p className="text-muted-foreground text-xs mb-0.5">RSI</p>
            <span
              className={cn(
                'font-semibold text-sm',
                data.rsi && data.rsi > 70
                  ? 'text-loss '
                  : data.rsi && data.rsi < 30
                    ? 'text-profit '
                    : 'text-foreground'
              )}
            >
              {data.rsi && data.rsi > 0 ? (data.rsi ?? 0).toFixed(0) : '—'}
            </span>
          </div>
          {/* Risk/Reward */}
          <div
            className={cn(
              'rounded-md p-1.5 text-center',
              data.risk_reward && data.risk_reward >= 3
                ? 'bg-profit/10'
                : data.risk_reward && data.risk_reward >= 1.5
                  ? 'bg-warning/10'
                  : data.risk_reward && data.risk_reward > 0
                    ? 'bg-loss/10'
                    : 'bg-muted/50'
            )}
          >
            <p className="text-muted-foreground text-xs mb-0.5">عائد/مخاطرة</p>
            <span
              className={cn(
                'font-bold text-sm',
                data.risk_reward && data.risk_reward >= 3
                  ? 'text-profit '
                  : data.risk_reward && data.risk_reward >= 1.5
                    ? 'text-warning '
                    : data.risk_reward && data.risk_reward > 0
                      ? 'text-loss '
                      : 'text-muted-foreground'
              )}
            >
              {data.risk_reward && data.risk_reward > 0
                ? `${(data.risk_reward ?? 0).toFixed(1)}`
                : '—'}
            </span>
          </div>
          {/* Volume */}
          <div className="rounded-md bg-muted/50 p-1.5 text-center">
            <p className="text-muted-foreground text-xs mb-0.5">الحجم</p>
            <span className="font-semibold text-sm text-foreground">
              {formatVol(data.volume)}
              {data.volume_ratio && data.volume_ratio > 1 && (
                <span className="text-profit text-xs mr-0.5">
                  ↑{(data.volume_ratio ?? 0).toFixed(1)}x
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Momentum / Performance (for المضارب) */}
        {!isInvestor && (data.perf_1w !== undefined || data.perf_1m !== undefined) && (
          <div className="flex items-center gap-3 px-1 text-xs">
            {data.perf_1w !== undefined && (
              <span className={cn('font-semibold', perfColor(data.perf_1w))}>
                أسبوع: {data.perf_1w > 0 ? '+' : ''}
                {(data.perf_1w ?? 0).toFixed(1)}%
              </span>
            )}
            {data.perf_1m !== undefined && (
              <span className={cn('font-semibold', perfColor(data.perf_1m))}>
                شهر: {data.perf_1m > 0 ? '+' : ''}
                {(data.perf_1m ?? 0).toFixed(1)}%
              </span>
            )}
            {data.perf_3m !== undefined && (
              <span className={cn('font-semibold', perfColor(data.perf_3m))}>
                3 أشهر: {data.perf_3m > 0 ? '+' : ''}
                {(data.perf_3m ?? 0).toFixed(1)}%
              </span>
            )}
          </div>
        )}

        {/* Fundamentals (for المستثمر) */}
        {isInvestor && (data.pe_ratio || data.roe || data.net_margin) && (
          <div className="flex items-center gap-3 px-1 text-xs flex-wrap">
            {data.pe_ratio && data.pe_ratio > 0 && (
              <span className="text-muted-foreground">
                P/E: <span className="font-semibold text-foreground">{(data.pe_ratio ?? 0).toFixed(1)}</span>
              </span>
            )}
            {data.roe && (
              <span className="text-muted-foreground">
                ROE:{' '}
                <span className={cn('font-semibold', data.roe > 10 ? 'text-profit' : 'text-foreground')}>
                  {(data.roe ?? 0).toFixed(1)}%
                </span>
              </span>
            )}
            {data.net_margin && (
              <span className="text-muted-foreground">
                هامش:{' '}
                <span className={cn('font-semibold', data.net_margin > 0 ? 'text-profit' : 'text-loss')}>
                  {(data.net_margin ?? 0).toFixed(1)}%
                </span>
              </span>
            )}
            {data.debt_to_equity && (
              <span className="text-muted-foreground">
                دين/حقوق:{' '}
                <span className={cn('font-semibold', data.debt_to_equity < 1 ? 'text-profit' : 'text-warning')}>
                  {(data.debt_to_equity ?? 0).toFixed(2)}
                </span>
              </span>
            )}
          </div>
        )}

        {/* Market regime badge */}
        {data.market_regime && (
          <div className="flex items-center gap-1.5 px-1 text-xs">
            <Gauge className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">وضع السوق:</span>
            <span
              className={cn(
                'font-semibold',
                data.market_regime === 'bullish'
                  ? 'text-profit '
                  : data.market_regime === 'bearish'
                    ? 'text-loss '
                    : 'text-warning '
              )}
            >
              {data.market_regime === 'bullish'
                ? 'صاعد'
                : data.market_regime === 'bearish'
                  ? 'هابط'
                  : 'متعادل'}
            </span>
          </div>
        )}

        {/* S/R levels */}
        {(data.support_level || data.resistance_level) && (
          <div className="flex items-center gap-3 px-1 text-xs">
            {data.support_level && (
              <span className="text-muted-foreground">
                دعم:{' '}
                <span className="font-semibold text-profit">
                  {(data.support_level ?? 0).toFixed(2)}
                </span>
              </span>
            )}
            {data.resistance_level && (
              <span className="text-muted-foreground">
                مقاومة:{' '}
                <span className="font-semibold text-loss">
                  {(data.resistance_level ?? 0).toFixed(2)}
                </span>
              </span>
            )}
            {data.price_vs_sr === 'near_support' && (
              <span className="text-xs px-1.5 py-0 rounded-full bg-profit text-profit/40 ">
                قرب الدعم ✓
              </span>
            )}
            {data.price_vs_sr === 'near_resistance' && (
              <span className="text-xs px-1.5 py-0 rounded-full bg-warning/10 text-warning dark:text-warning ">
                قرب المقاومة ⚡
              </span>
            )}
          </div>
        )}

        {/* Reason */}
        {data.reason && (
          <p className="text-sm leading-relaxed text-foreground/90 bg-muted/50 rounded-md p-2">
            {data.reason}
          </p>
        )}

        {/* Narrative — القصة */}
        {narrative && (narrative.line1 || narrative.line2 || narrative.line3) && (
          <div className={cn('rounded-md p-2 text-xs space-y-1', personaTheme.accentBg)}>
            {narrative.line1 && <p className="text-foreground/80">📍 {narrative.line1}</p>}
            {narrative.line2 && <p className="text-foreground/80">📊 {narrative.line2}</p>}
            {narrative.line3 && <p className="text-foreground/80">🔮 {narrative.line3}</p>}
          </div>
        )}

        {/* Timeframe (للمستثمر) */}
        {isInvestor && data.timeframe && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>
              الإطار الزمني: <span className="font-semibold text-foreground">{data.timeframe}</span>
            </span>
          </div>
        )}

        {/* Fair value (للمستثمر) — PAYWALL Gate 1: locked for free users post-trial */}
        {isInvestor && data.fair_value && data.fair_value > 0 && (
          fairValueLocked ? (
            (() => {
              const entryPrice = data.entry ?? 0;
              const upsidePct =
                entryPrice > 0
                  ? Math.round(((data.fair_value - entryPrice) / entryPrice) * 100)
                  : null;
              return (
                <div className="flex flex-col gap-1 text-xs rounded-md border border-warning/20 bg-warning/10 /30 p-2">
                  <div className="flex items-center gap-1.5 text-warning font-semibold">
                    <Target className="h-3 w-3" />
                    <span>🔒 القيمة العادلة — متاحة للمشتركين</span>
                  </div>
                  {upsidePct != null && upsidePct > 0 && (
                    <span className="text-xs text-muted-foreground">
                      القيمة العادلة أعلى من السعر الحالي بـ {upsidePct}%
                    </span>
                  )}
                </div>
              );
            })()
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Target className="h-3 w-3" />
              <span>
                القيمة العادلة:{' '}
                <span className="font-semibold text-foreground">
                  {(data.fair_value ?? 0).toFixed(2)}
                </span>
              </span>
            </div>
          )
        )}

        {/* Conditions */}
        {data.conditions && data.conditions.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">الشروط والأسباب:</p>
            <div className="flex flex-wrap gap-1.5">
              {data.conditions.slice(0, 5).map((c, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-0.5 rounded-full bg-muted text-foreground/80 border border-border"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* أزرار النسخ والمشاركة */}
        <div className="flex gap-2 mt-3 pt-2 border-t border-border/50">
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-8 text-xs flex-1"
            onClick={() => {
              const text = formatSinglePersonaPickText(
                {
                  ticker,
                  nameAr: data.name_ar,
                  name: ticker,
                  analysisJson: { [persona]: data },
                } as unknown as StoredAnalysisItem,
                persona,
                market
              );
              navigator.clipboard.writeText(text);
              toast.success('تم نسخ التوقع ✓');
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            نسخ
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-8 text-xs flex-1"
            onClick={async () => {
              const text = formatSinglePersonaPickText(
                {
                  ticker,
                  nameAr: data.name_ar,
                  name: ticker,
                  analysisJson: { [persona]: data },
                } as unknown as StoredAnalysisItem,
                persona,
                market
              );
              if (navigator.share) {
                try {
                  await navigator.share({ title: `توقعة ${ticker}`, text });
                } catch {}
              } else {
                navigator.clipboard.writeText(text);
                toast.success('تم نسخ التوقع ✓');
              }
            }}
          >
            <Share2 className="h-3.5 w-3.5" />
            مشاركة
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-8 text-xs flex-1 border-whale text-whale hover:bg-primary dark:hover:bg-primary/20"
            onClick={() => {
              const text = formatSinglePersonaPickText(
                {
                  ticker,
                  nameAr: data.name_ar,
                  name: ticker,
                  analysisJson: { [persona]: data },
                } as unknown as StoredAnalysisItem,
                persona,
                market
              );
              navigator.clipboard.writeText(text);
              window.open('https://www.facebook.com/', '_blank');
              toast.success('تم نسخ التوقع وجاري فتح فيسبوك لصق المنشور 💙');
            }}
          >
            <Facebook className="h-3.5 w-3.5" />
            فيسبوك
          </Button>
        </div>

        {/* Footer — score reference + volatility */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
          <span>
            {data.sniper_score
              ? `تصطاد: ${data.sniper_score}`
              : maestroScore
                ? `مايسترو: ${maestroScore}`
                : ''}
          </span>
          <div className="flex items-center gap-2">
            {data.beta !== undefined && data.beta > 0 && (
              <span>β {(data.beta ?? 0).toFixed(2)}</span>
            )}
            {data.volatility !== undefined && data.volatility > 0 && (
              <span>σ {(data.volatility ?? 0).toFixed(1)}%</span>
            )}
            {data.signal && <span>{data.signal}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
