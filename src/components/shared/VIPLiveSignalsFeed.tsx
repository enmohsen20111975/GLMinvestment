'use client';

/**
 * VIP Live Signals Feed — كروت تداول احترافية صالحة للشراء الآن
 * ============================================================
 * T-ALPHA-A21: عرض ما يرسله بايثون فقط — لا فلترة، لا فرز، لا اقتطاع.
 *   • top_5_signals: أقوى 5 فرص (يعرضها البايثون مرتبة جاهزة)
 *   • extra_signals: باقي الفرص (قابلة للطي)
 *
 * Rule 4: شاشة عرض فقط — لا sort، لا filter، لا slice في الفرونت.
 * Rule 27: لا بيانات وهمية.
 * SCR-001: Bloomberg Terminal Feel + Glassmorphism + Elite Top 5
 *
 * Rule 4: شاشة عرض فقط — لا sort، لا filter، لا slice في الفرونت.
 * Rule 27: لا بيانات وهمية.
 * Rule 30: زمردي/تركوازي/أمبر فقط — NO blue/indigo.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Zap, Target, ShieldAlert, ArrowRight, RefreshCw, Activity,
  Copy, Check, Flame, ChevronDown, ChevronUp, Search,
} from 'lucide-react';
// Directive A-P2: CANONICAL TYPES from src/types/commercial-feed.ts (SSOT)
import type {
  LiveSignal,
  CommercialFeedResponse,
  AuditedPerformance,
  MarketCode,
} from '@/types/commercial-feed';
import { safeFeedResponse, safeTop5Signals, safeAuditedPerformance, marketCurrencySymbol, EMPTY_AUDITED_PERFORMANCE } from '@/types/commercial-feed';

// ============================================================================
// Directive A-P4: Elite Market Switcher Bar — 4 أسواق + بطاقة أداء موثقة لكل سوق
import type { LiveSignal, CommercialFeedResponse, AuditedPerformance, MarketCode } from '@/types/commercial-feed';
import { safeFeedResponse, safeTop5Signals, safeAuditedPerformance, marketCurrencySymbol, EMPTY_AUDITED_PERFORMANCE } from '@/types/commercial-feed';

// ============================================================================
// SCR-001: Elite Market Switcher Bar — 4 أسواق + بطاقة أداء موثقة
// ============================================================================

const ELITE_MARKETS: MarketCode[] = ['EGX', 'TADAWUL', 'KSE', 'QSE'];

interface MarketSummaryBadge {
  loading: boolean;
  audited: AuditedPerformance;
}

function MarketSwitcherBar({
  activeMarket,
  onSelect,
  summaries,
}: {
  activeMarket: string;
  onSelect: (m: MarketCode) => void;
  summaries: Record<string, MarketSummaryBadge>;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" dir="rtl">
      {ELITE_MARKETS.map((m) => {
        const isActive = activeMarket.toUpperCase() === m;
        const badge = summaries[m];
        const currency = marketCurrencySymbol(m);
        const audited = badge?.audited;
        const wr = audited?.win_rate ?? null;
        const pf = audited?.profit_factor ?? null;
        const ar = audited?.avg_return ?? null;
        const closed = audited?.total_closed ?? 0;
        const hasHistory = closed > 0;
        return (
          <button
            key={m}
            onClick={() => onSelect(m)}
            className={cn(
              'rounded-xl border p-2.5 text-right transition-all min-w-0',
              isActive
                ? 'border-emerald-500/60 bg-emerald-500/5 shadow-sm ring-1 ring-emerald-500/20'
                : 'border-border/50 hover:border-emerald-500/30 hover:bg-muted/30',
            )}
          >
            {/* Row 1: market code + currency */}
            <div className="flex items-center justify-between gap-1 min-w-0">
              <span className={cn(
                'text-xs font-bold truncate',
              'glass-panel rounded-xl border p-2.5 text-right transition-all min-w-0',
              isActive
                ? 'border-emerald-500/60 shadow-sm ring-1 ring-emerald-500/20'
                : 'border-border/50 hover:border-emerald-500/30',
            )}
          >
            <div className="flex items-center justify-between gap-1 min-w-0">
              <span className={cn(
                'text-xs font-bold truncate font-mono',
                isActive ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground',
              )}>
                {m}
              </span>
              <span className="text-[9px] text-muted-foreground shrink-0">{currency}</span>
            </div>
            {/* Row 2: audited performance badge or "قيد التدقيق المؤسسي" */}
            <div className="mt-1 min-w-0">
              {badge?.loading ? (
                <div className="space-y-1">
                  <div className="h-2.5 w-10 bg-muted/50 rounded animate-pulse" />
                  <div className="h-2 w-14 bg-muted/40 rounded animate-pulse" />
                </div>
              ) : hasHistory ? (
                <div className="space-y-0.5 min-w-0">
                  {/* Win rate — emerald if ≥60%, amber if 40-59%, muted if <40% */}
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <span className="text-[8px] text-muted-foreground shrink-0">الفوز</span>
                    <span className={cn(
                      'text-[10px] font-bold tabular-nums',
                      wr != null && wr >= 60
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : wr != null && wr >= 40
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-muted-foreground',
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <span className="text-[8px] text-muted-foreground shrink-0">الفوز</span>
                    <span className={cn(
                      'text-[10px] font-bold tabular-nums font-mono',
                      wr != null && wr >= 60 ? 'text-emerald-600 dark:text-emerald-400'
                        : wr != null && wr >= 40 ? 'text-amber-600 dark:text-amber-400'
                        : 'text-muted-foreground',
                    )}>
                      {wr != null ? `${wr}%` : '—'}
                    </span>
                  </div>
                  {/* Profit factor + avg return compact row */}
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <span className="text-[8px] text-muted-foreground shrink-0">ربحية</span>
                    <span className={cn(
                      'text-[9px] font-semibold tabular-nums',
                      pf != null && pf >= 1.3
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : pf != null && pf >= 1.0
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-muted-foreground',
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <span className="text-[8px] text-muted-foreground shrink-0">ربحية</span>
                    <span className={cn(
                      'text-[9px] font-semibold tabular-nums font-mono',
                      pf != null && pf >= 1.3 ? 'text-emerald-600 dark:text-emerald-400'
                        : pf != null && pf >= 1.0 ? 'text-amber-600 dark:text-amber-400'
                        : 'text-muted-foreground',
                    )}>
                      {pf != null ? pf.toFixed(2) : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <span className="text-[8px] text-muted-foreground shrink-0">عائد</span>
                    <span className={cn(
                      'text-[9px] font-semibold tabular-nums',
                      ar != null && ar >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                      'text-[9px] font-semibold tabular-nums font-mono',
                      ar != null && ar >= 0 ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-500 dark:text-red-400',
                    )}>
                      {ar != null ? `${ar >= 0 ? '+' : ''}${ar}%` : '—'}
                    </span>
                  </div>
                </div>
              ) : (
                /* No closed trades → honest "قيد التدقيق المؤسسي" badge (Rule 27: no fake 0%) */
                <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 px-1 py-0.5 text-[8px] font-medium text-amber-600 dark:text-amber-400">
                  <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse" />
                  قيد التدقيق المؤسسي
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(2);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(1)}%`;
}

function fmtRR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) <= 0) return '—';
  return `1:${Number(n).toFixed(1)}`;
}

function buildCopyMessage(sig: LiveSignal): string {
  const lines: string[] = [];
  lines.push('📊 توصية استثمارية — منصة دليل الاستثمار');
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`السهم: ${sig.ticker}${sig.name ? ` (${sig.name})` : ''}`);
  lines.push(`الإشارة: ${sig.signal_ar || sig.signal || '—'}`);
  if (sig.entry_price != null) lines.push(`💰 سعر الدخول: ${fmtPrice(sig.entry_price)}`);
  if (sig.target_1 != null) {
    lines.push(`🎯 الهدف الأول: ${fmtPrice(sig.target_1)}${sig.target_1_pct != null ? ` (+${sig.target_1_pct}%)` : ''}`);
  }
  if (sig.target_2 != null) lines.push(`🎯 الهدف الثاني: ${fmtPrice(sig.target_2)}`);
  if (sig.stop_loss != null) lines.push(`🛑 وقف الخسارة: ${fmtPrice(sig.stop_loss)}`);
  if (sig.risk_reward != null && Number(sig.risk_reward) > 0) {
    lines.push(`⚖️ نسبة العائد/المخاطرة: 1:${Number(sig.risk_reward).toFixed(1)}`);
  }
  if (sig.confidence != null && Number(sig.confidence) > 0) {
    lines.push(`🔐 نسبة الثقة: ${Math.round(Number(sig.confidence))}%`);
  }
  const catalyst = sig.catalyst_ar || sig.catalyst;
  if (catalyst) lines.push(`🔥 الدافع الفني: ${catalyst}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('⚠️ إخلاء مسؤولية: التوصيات للأغراض التعليمية فقط');
  return lines.join('\n');
}

function SignalCard({ sig, onCopy, copied }: { sig: LiveSignal; onCopy: (e: React.MouseEvent, sig: LiveSignal) => void; copied: boolean }) {
  return (
    <Card key={`${sig.ticker}-${sig.prediction_date}`} className="overflow-hidden hover:border-emerald-500/40 transition-colors">
// ============================================================================
// SignalCard — Premium emerald card with glassmorphism
// ============================================================================

function SignalCard({ sig, onCopy, copied }: { sig: LiveSignal; onCopy: (e: React.MouseEvent, sig: LiveSignal) => void; copied: boolean }) {
  return (
    <Card className="glass-panel overflow-hidden hover:border-emerald-500/40 transition-colors">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-bold text-base shrink-0">{sig.ticker}</span>
              <span className="font-bold text-base shrink-0 font-mono">{sig.ticker}</span>
              {sig.signal && (
                <Badge variant="outline" className={cn(
                  'text-[9px] shrink-0',
                  sig.signal === 'STRONG_BUY'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                    : 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30'
                )}>
                  {sig.signal_ar || sig.signal}
                </Badge>
              )}
            </div>
            {sig.name && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{sig.name}</p>
            )}
            {sig.sector && (
              <p className="text-[9px] text-muted-foreground/70 truncate">{sig.sector}</p>
            )}
          </div>
          {sig.confidence != null && Number(sig.confidence) > 0 && (
            <div className="text-left shrink-0">
              <p className="text-[9px] text-muted-foreground">الثقة</p>
              <p className="text-sm font-bold text-emerald-600">{Math.round(Number(sig.confidence))}%</p>
              <p className="text-sm font-bold text-emerald-600 font-mono tabular-nums">{Math.round(Number(sig.confidence))}%</p>
            </div>
          )}
        </div>

        {/* Prices */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="min-w-0">
            <p className="text-[9px] text-muted-foreground flex items-center gap-1">
              <Target className="w-2.5 h-2.5 shrink-0" /> <span className="truncate">الدخول</span>
            </p>
            <p className="font-mono font-semibold truncate">{fmtPrice(sig.entry_price)}</p>
            <p className="font-mono font-semibold truncate tabular-nums">{fmtPrice(sig.entry_price)}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[9px] text-muted-foreground flex items-center gap-1">
              <ArrowRight className="w-2.5 h-2.5 shrink-0" /> <span className="truncate">الهدف</span>
            </p>
            <p className="font-mono font-semibold text-emerald-600 truncate">
            <p className="font-mono font-semibold text-emerald-600 truncate tabular-nums">
              {fmtPrice(sig.target_1)}
              {sig.target_1_pct != null && (
                <span className="text-[9px] ml-1">({fmtPct(sig.target_1_pct)})</span>
              )}
            </p>
            {sig.target_2 != null && (
              <p className="font-mono text-[10px] text-emerald-500 truncate">
              <p className="font-mono text-[10px] text-emerald-500 truncate tabular-nums">
                هدف 2: {fmtPrice(sig.target_2)}
              </p>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[9px] text-muted-foreground flex items-center gap-1">
              <ShieldAlert className="w-2.5 h-2.5 shrink-0" /> <span className="truncate">الوقف</span>
            </p>
            <p className="font-mono font-semibold text-red-500 truncate">{fmtPrice(sig.stop_loss)}</p>
            {sig.stop_loss_pct != null && (
              <p className="text-[9px] text-red-400">{fmtPct(sig.stop_loss_pct)}</p>
            <p className="font-mono font-semibold text-red-500 truncate tabular-nums">{fmtPrice(sig.stop_loss)}</p>
            {sig.stop_loss_pct != null && (
              <p className="text-[9px] text-red-400 tabular-nums">{fmtPct(sig.stop_loss_pct)}</p>
            )}
          </div>
        </div>

        {/* R:R + Horizon */}
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">
            R:R <span className="font-bold text-foreground">{fmtRR(sig.risk_reward)}</span>
            R:R <span className="font-bold text-foreground font-mono tabular-nums">{fmtRR(sig.risk_reward)}</span>
          </span>
          {sig.horizon && (
            <span className="text-muted-foreground">{sig.horizon_icon} {sig.horizon}</span>
          )}
        </div>

        {/* Catalyst */}
        {(sig.catalyst_ar || sig.catalyst) && (
          <div className="flex items-start gap-1.5 rounded-md bg-amber-500/5 border border-amber-500/20 p-2">
            <Flame className="w-3 h-3 text-amber-500 shrink-0 mt-px" />
            <span className="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed flex-1">
              {sig.catalyst_ar || sig.catalyst}
            </span>
          </div>
        )}

        {/* Copy button */}
        <Button
          variant="outline"
          size="sm"
          onClick={(e) => onCopy(e, sig)}
          className="w-full h-7 text-[10px] gap-1.5"
        >
          {copied ? (
            <><Check className="w-3 h-3 text-emerald-500" /> تم نسخ التوصية ✓</>
          ) : (
            <><Copy className="w-3 h-3" /> 📋 نسخ تفاصيل التوصية</>
            <><Copy className="w-3 h-3" /> 📋 نسخ التوصية للتليجرام/واتساب</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

export function VIPLiveSignalsFeed({ market }: { market: string }) {
  // Directive A-P4: internal active market state (defaults to parent prop).
  // Allows instant market switching without touching the global TopBar switcher.
// ============================================================================
// Main Component
// ============================================================================

export function VIPLiveSignalsFeed({ market }: { market: string }) {
  const [activeMarket, setActiveMarket] = useState<string>(market);
  const [data, setData] = useState<CommercialFeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedTicker, setCopiedTicker] = useState<string | null>(null);
  const [showExtra, setShowExtra] = useState(false);
  // Per-market audited performance badges (for the switcher bar)
  const [summaries, setSummaries] = useState<Record<string, MarketSummaryBadge>>({});

  // Sync active market when parent prop changes
  const [summaries, setSummaries] = useState<Record<string, MarketSummaryBadge>>({});

  useEffect(() => { setActiveMarket(market); }, [market]);

  const fetchData = useCallback(async (mkt: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v2/commercial-feed?market=${encodeURIComponent(mkt)}`, { cache: 'no-store' });
      if (!res.ok) { setError('تعذّر جلب التوصيات'); setData(null); return; }
      const raw = await res.json();
      const json = safeFeedResponse(raw); // defensive — never crashes on malformed payload
      if (!json.success) { setError(json.message || json.error || 'تعذّر جلب التوصيات'); setData(null); return; }
      setData(json);
      // Update the summary badge for this market
      const json = safeFeedResponse(raw);
      if (!json.success) { setError(json.message || json.error || 'تعذّر جلب التوصيات'); setData(null); return; }
      setData(json);
      setSummaries((prev) => ({
        ...prev,
        [mkt.toUpperCase()]: { loading: false, audited: safeAuditedPerformance(json) },
      }));
    } catch {
      setError('تعذّر الاتصال بالخادم');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch the active market's feed on mount + when activeMarket changes
  useEffect(() => { fetchData(activeMarket); }, [fetchData, activeMarket]);

  // Directive A-P4: pre-fetch all 4 markets' audited summaries in the background
  // (lightweight — populates the switcher bar badges without blocking the main feed)
  useEffect(() => {
    const missing = ELITE_MARKETS.filter((m) => !summaries[m]);
    if (missing.length === 0) return;
    // Mark as loading
  useEffect(() => { fetchData(activeMarket); }, [fetchData, activeMarket]);

  // Pre-fetch all 4 markets' audited summaries in the background
  useEffect(() => {
    const missing = ELITE_MARKETS.filter((m) => !summaries[m]);
    if (missing.length === 0) return;
    setSummaries((prev) => {
      const next = { ...prev };
      for (const m of missing) next[m] = { loading: true, audited: EMPTY_AUDITED_PERFORMANCE };
      return next;
    });
    // Fetch each missing market's summary in parallel
    missing.forEach(async (m) => {
      try {
        const res = await fetch(`/api/v2/commercial-feed?market=${m}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('fetch failed');
        const raw = await res.json();
        const feed = safeFeedResponse(raw);
        setSummaries((prev) => ({
          ...prev,
          [m]: { loading: false, audited: safeAuditedPerformance(feed) },
        }));
      } catch {
        setSummaries((prev) => ({
          ...prev,
          [m]: { loading: false, audited: EMPTY_AUDITED_PERFORMANCE },
        }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMarketSelect = useCallback((m: MarketCode) => {
    setActiveMarket(m);
    setShowExtra(false);
  }, []);

  const handleCopy = async (e: React.MouseEvent, sig: LiveSignal) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(buildCopyMessage(sig));
      setCopiedTicker(sig.ticker);
      setTimeout(() => setCopiedTicker(null), 2000);
      // Marathon Phase 1: emerald Toast تأكيد أنيق
      toast.success('تم نسخ التوصية', {
        description: `${sig.ticker} — جاهزة للمشاركة عبر تليجرام/واتساب ✓`,
        style: {
          background: 'rgb(6 95 70 / 0.08)',
          border: '1px solid rgb(6 95 70 / 0.25)',
          color: 'rgb(6 95 70)',
        },
        icon: <Check className="w-4 h-4 text-emerald-600" />,
      });
    } catch {
      toast.error('تعذّر النسخ', {
        description: 'حاول مرة أخرى أو انسخ النص يدوياً',
      });
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <MarketSwitcherBar activeMarket={activeMarket} onSelect={handleMarketSelect} summaries={summaries} />
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <MarketSwitcherBar activeMarket={activeMarket} onSelect={handleMarketSelect} summaries={summaries} />
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <Activity className="w-8 h-8 text-amber-500 mx-auto" />
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">{error || 'لا توجد بيانات'}</p>
            <Button variant="outline" size="sm" onClick={() => fetchData(activeMarket)} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // T-ALPHA-A21 + A-P2: قراءة ما يرسله بايثون فقط — عبر safe accessors (defensive)
  const topSignals: LiveSignal[] = safeTop5Signals(data);
  const extraSignals: LiveSignal[] = data?.extra_signals ?? [];

  // Audited Performance Banner (null safety مطلقة — via safe accessor)
  const topSignals: LiveSignal[] = safeTop5Signals(data);
  const extraSignals: LiveSignal[] = data?.extra_signals ?? [];
  const audited = safeAuditedPerformance(data);
  const showBanner = audited != null && audited.total_closed > 0;

  if (topSignals.length === 0 && extraSignals.length === 0) {
    return (
      <div className="space-y-3">
        <MarketSwitcherBar activeMarket={activeMarket} onSelect={handleMarketSelect} summaries={summaries} />
        <Card>
          <CardContent className="p-6 text-center space-y-2">
            <Activity className="w-8 h-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm font-semibold text-muted-foreground">
              لا توجد صفقات حية حالياً في {activeMarket}
            </p>
            <p className="text-xs text-muted-foreground">
              سيتم عرض الفرص الجديدة فور توفرها (Rule 27: لا بيانات وهمية)
            </p>
            <Button variant="outline" size="sm" onClick={() => fetchData(activeMarket)} className="gap-1.5 mt-2">
              <RefreshCw className="w-3.5 h-3.5" /> تحديث
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Directive A-P4: Elite Market Switcher Bar — 4 أسواق + بطاقة أداء موثقة */}
      {/* SCR-001: Elite Market Switcher Bar */}
      <MarketSwitcherBar activeMarket={activeMarket} onSelect={handleMarketSelect} summaries={summaries} />

      {/* Header strip */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-emerald-500" />
          <span className="text-sm font-semibold">الصفقات الحية — {activeMarket}</span>
          <Badge variant="outline" className="text-[10px]">{topSignals.length + extraSignals.length} صفقة</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={() => fetchData(activeMarket)} className="gap-1.5 h-7 text-xs">
          <RefreshCw className="w-3.5 h-3.5" /> تحديث
        </Button>
      </div>

      {/* Audited Performance Banner */}
      {showBanner && (() => {
        const wr = audited?.win_rate ?? null;
        const ar = audited?.avg_return ?? null;
        const pf = audited?.profit_factor ?? null;
        return (
          <Card className="bg-gradient-to-r from-emerald-500/5 to-teal-500/5 border-emerald-500/20">
          <Card className="glass-panel bg-gradient-to-r from-emerald-500/5 to-teal-500/5 border-emerald-500/20">
            <CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground">إجمالي الصفقات</p>
                  <p className="text-lg font-bold">{audited?.total_closed ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">نسبة النجاح</p>
                  <p className={cn('text-lg font-bold', wr != null && wr >= 70 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                  <p className="text-lg font-bold font-mono tabular-nums">{audited?.total_closed ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">نسبة النجاح</p>
                  <p className={cn('text-lg font-bold font-mono tabular-nums', wr != null && wr >= 70 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                    {wr != null ? `${wr}%` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">متوسط الربح</p>
                  <p className={cn('text-lg font-bold', ar != null && ar >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                  <p className={cn('text-lg font-bold font-mono tabular-nums', ar != null && ar >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                    {ar != null ? `${ar >= 0 ? '+' : ''}${ar}%` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">معامل الربحية</p>
                  <p className="text-lg font-bold">{pf ?? '—'}</p>
                  <p className="text-lg font-bold font-mono tabular-nums">{pf ?? '—'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* T-ALPHA-A21: 🎯 أقوى 5 فرص استثمارية مؤكدة اليوم */}
      {/* 🎯 أقوى 5 فرص استثمارية مؤكدة */}
      {topSignals.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1" dir="rtl">
            <span className="text-base">🎯</span>
            <h3 className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
              أقوى {topSignals.length} فرص استثمارية مؤكدة اليوم
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {topSignals.map((sig) => (
              <SignalCard
                key={`${sig.ticker}-${sig.prediction_date}`}
                sig={sig}
                onCopy={handleCopy}
                copied={copiedTicker === sig.ticker}
              />
            ))}
          </div>
        </div>
      )}

      {/* Marathon Phase 1: 🔍 فرص استثمارية إضافية تحت المراقبة — Accordion مطوي افتراضياً */}
      {/* 🔍 فرص استثمارية إضافية تحت المراقبة — Accordion */}
      {extraSignals.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => setShowExtra(!showExtra)}
            className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded-lg transition-all w-full"
            dir="rtl"
            aria-expanded={showExtra}
          >
            {showExtra ? <ChevronUp className="w-4 h-4 shrink-0 transition-transform" /> : <ChevronDown className="w-4 h-4 shrink-0 transition-transform" />}
            {showExtra ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 text-right">
              فرص استثمارية إضافية تحت المراقبة ({extraSignals.length} سهم)
            </span>
            <Badge variant="outline" className="text-[9px] shrink-0 bg-muted/40">{showExtra ? 'طي' : 'عرض'}</Badge>
          </button>
          {showExtra && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
              {extraSignals.map((sig) => (
                <SignalCard
                  key={`${sig.ticker}-${sig.prediction_date}`}
                  sig={sig}
                  onCopy={handleCopy}
                  copied={copiedTicker === sig.ticker}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
