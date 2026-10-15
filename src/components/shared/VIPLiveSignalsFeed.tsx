'use client';

/**
 * VIP Live Signals Feed — كروت تداول احترافية صالحة للشراء الآن
 * ============================================================
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Zap, Target, ShieldAlert, ArrowRight, RefreshCw, Activity,
  Copy, Check, Flame, ChevronDown, ChevronUp, Search,
} from 'lucide-react';
import type { LiveSignal, CommercialFeedResponse, AuditedPerformance, MarketCode } from '@/types/commercial-feed';
import { safeFeedResponse, safeTop5Signals, safeAuditedPerformance, marketCurrencySymbol, EMPTY_AUDITED_PERFORMANCE } from '@/types/commercial-feed';

const ELITE_MARKETS: MarketCode[] = ['EGX', 'TADAWUL', 'KSE', 'QSE'];

interface MarketSummaryBadge {
  loading: boolean;
  audited: AuditedPerformance;
}

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
            <div className="mt-1 min-w-0">
              {badge?.loading ? (
                <div className="space-y-1">
                  <div className="h-2.5 w-10 bg-muted/50 rounded animate-pulse" />
                  <div className="h-2 w-14 bg-muted/40 rounded animate-pulse" />
                </div>
              ) : hasHistory ? (
                <div className="space-y-0.5 min-w-0">
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
                      'text-[9px] font-semibold tabular-nums font-mono',
                      ar != null && ar >= 0 ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-500 dark:text-red-400',
                    )}>
                      {ar != null ? `${ar >= 0 ? '+' : ''}${ar}%` : '—'}
                    </span>
                  </div>
                </div>
              ) : (
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

function SignalCard({ sig, onCopy, copied, onOpenDossier }: { sig: LiveSignal; onCopy: (e: React.MouseEvent, sig: LiveSignal) => void; copied: boolean; onOpenDossier: (ticker: string) => void }) {
  return (
    <Card className="glass-panel overflow-hidden hover:border-emerald-500/40 transition-colors">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
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
            {sig.name && <p className="text-xs text-muted-foreground mt-0.5 truncate">{sig.name}</p>}
            {sig.sector && <p className="text-[9px] text-muted-foreground/70 truncate">{sig.sector}</p>}
          </div>
          {sig.confidence != null && Number(sig.confidence) > 0 && (
            <div className="text-left shrink-0">
              <p className="text-[9px] text-muted-foreground">الثقة</p>
              <p className="text-sm font-bold text-emerald-600 font-mono tabular-nums">{Math.round(Number(sig.confidence))}%</p>
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="min-w-0">
            <p className="text-[9px] text-muted-foreground flex items-center gap-1">
              <Target className="w-2.5 h-2.5 shrink-0" /> <span className="truncate">الدخول</span>
            </p>
            <p className="font-mono font-semibold truncate tabular-nums">{fmtPrice(sig.entry_price)}</p>
          </div>
          <div className="min-w-0">
            <p className="text-[9px] text-muted-foreground flex items-center gap-1">
              <ArrowRight className="w-2.5 h-2.5 shrink-0" /> <span className="truncate">الهدف</span>
            </p>
            <p className="font-mono font-semibold text-emerald-600 truncate tabular-nums">
              {fmtPrice(sig.target_1)}
              {sig.target_1_pct != null && <span className="text-[9px] ml-1">({fmtPct(sig.target_1_pct)})</span>}
            </p>
            {sig.target_2 != null && (
              <p className="font-mono text-[10px] text-emerald-500 truncate tabular-nums">هدف 2: {fmtPrice(sig.target_2)}</p>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[9px] text-muted-foreground flex items-center gap-1">
              <ShieldAlert className="w-2.5 h-2.5 shrink-0" /> <span className="truncate">الوقف</span>
            </p>
            <p className="font-mono font-semibold text-red-500 truncate tabular-nums">{fmtPrice(sig.stop_loss)}</p>
            {sig.stop_loss_pct != null && <p className="text-[9px] text-red-400 tabular-nums">{fmtPct(sig.stop_loss_pct)}</p>}
          </div>
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">R:R <span className="font-bold text-foreground font-mono tabular-nums">{fmtRR(sig.risk_reward)}</span></span>
          {sig.horizon && <span className="text-muted-foreground">{sig.horizon_icon} {sig.horizon}</span>}
        </div>
        {(sig.catalyst_ar || sig.catalyst) && (
          <div className="flex items-start gap-1.5 rounded-md bg-amber-500/5 border border-amber-500/20 p-2">
            <Flame className="w-3 h-3 text-amber-500 shrink-0 mt-px" />
            <span className="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed flex-1">{sig.catalyst_ar || sig.catalyst}</span>
          </div>
        )}
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" onClick={(e) => onCopy(e, sig)} className="flex-1 h-7 text-[10px] gap-1.5">
            {copied ? <><Check className="w-3 h-3 text-emerald-500" /> تم النسخ ✓</> : <><Copy className="w-3 h-3" /> 📋 نسخ</>}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenDossier(sig.ticker)} className="h-7 text-[10px] gap-1">
            📂 الأدلة
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function VIPLiveSignalsFeed({ market }: { market: string }) {
  const [activeMarket, setActiveMarket] = useState<string>(market);
  const [data, setData] = useState<CommercialFeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedTicker, setCopiedTicker] = useState<string | null>(null);
  const [showExtra, setShowExtra] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, MarketSummaryBadge>>({});

  useEffect(() => { setActiveMarket(market); }, [market]);

  const fetchData = useCallback(async (mkt: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v2/commercial-feed?market=${encodeURIComponent(mkt)}`, { cache: 'no-store' });
      if (!res.ok) { setError('تعذّر جلب التوصيات'); setData(null); return; }
      const raw = await res.json();
      const json = safeFeedResponse(raw);
      if (!json.success) { setError(json.message || json.error || 'تعذّر جلب التوصيات'); setData(null); return; }
      setData(json);
      setSummaries((prev) => ({ ...prev, [mkt.toUpperCase()]: { loading: false, audited: safeAuditedPerformance(json) } }));
    } catch {
      setError('تعذّر الاتصال بالخادم');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(activeMarket); }, [fetchData, activeMarket]);

  useEffect(() => {
    const missing = ELITE_MARKETS.filter((m) => !summaries[m]);
    if (missing.length === 0) return;
    setSummaries((prev) => {
      const next = { ...prev };
      for (const m of missing) next[m] = { loading: true, audited: EMPTY_AUDITED_PERFORMANCE };
      return next;
    });
    missing.forEach(async (m) => {
      try {
        const res = await fetch(`/api/v2/commercial-feed?market=${m}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('fetch failed');
        const raw = await res.json();
        const feed = safeFeedResponse(raw);
        setSummaries((prev) => ({ ...prev, [m]: { loading: false, audited: safeAuditedPerformance(feed) } }));
      } catch {
        setSummaries((prev) => ({ ...prev, [m]: { loading: false, audited: EMPTY_AUDITED_PERFORMANCE } }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMarketSelect = useCallback((m: MarketCode) => { setActiveMarket(m); setShowExtra(false); }, []);

  const handleCopy = async (e: React.MouseEvent, sig: LiveSignal) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(buildCopyMessage(sig));
      setCopiedTicker(sig.ticker);
      setTimeout(() => setCopiedTicker(null), 2000);
      toast.success('تم نسخ التوصية', {
        description: `${sig.ticker} — جاهزة للمشاركة عبر تليجرام/واتساب ✓`,
        style: { background: 'rgb(6 95 70 / 0.08)', border: '1px solid rgb(6 95 70 / 0.25)', color: 'rgb(6 95 70)' },
        icon: <Check className="w-4 h-4 text-emerald-600" />,
      });
    } catch {
      toast.error('تعذّر النسخ', { description: 'حاول مرة أخرى أو انسخ النص يدوياً' });
    }
  };

  // ALPHA-2: Conviction Dossier
  const [dossierTicker, setDossierTicker] = useState<string | null>(null);
  const [dossierData, setDossierData] = useState<any>(null);
  const [dossierLoading, setDossierLoading] = useState(false);

  const openDossier = useCallback(async (ticker: string) => {
    setDossierTicker(ticker);
    setDossierLoading(true);
    setDossierData(null);
    try {
      const res = await fetch(`/api/recommendations/dossier/${ticker}`, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setDossierData(json);
      }
    } catch {
      // graceful — dossier may not be available
    } finally {
      setDossierLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <MarketSwitcherBar activeMarket={activeMarket} onSelect={handleMarketSelect} summaries={summaries} />
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
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

  const topSignals = safeTop5Signals(data);
  const extraSignals = data?.extra_signals ?? [];
  const audited = safeAuditedPerformance(data);
  const showBanner = audited != null && audited.total_closed > 0;

  if (topSignals.length === 0 && extraSignals.length === 0) {
    return (
      <div className="space-y-3">
        <MarketSwitcherBar activeMarket={activeMarket} onSelect={handleMarketSelect} summaries={summaries} />
        <Card>
          <CardContent className="p-6 text-center space-y-2">
            <Activity className="w-8 h-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm font-semibold text-muted-foreground">لا توجد صفقات حية حالياً في {activeMarket}</p>
            <p className="text-xs text-muted-foreground">سيتم عرض الفرص الجديدة فور توفرها (Rule 27: لا بيانات وهمية)</p>
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
      <MarketSwitcherBar activeMarket={activeMarket} onSelect={handleMarketSelect} summaries={summaries} />
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
      {showBanner && (() => {
        const wr = audited?.win_rate ?? null;
        const ar = audited?.avg_return ?? null;
        const pf = audited?.profit_factor ?? null;
        return (
          <Card className="glass-panel bg-gradient-to-r from-emerald-500/5 to-teal-500/5 border-emerald-500/20">
            <CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground">إجمالي الصفقات</p>
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
                  <p className={cn('text-lg font-bold font-mono tabular-nums', ar != null && ar >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                    {ar != null ? `${ar >= 0 ? '+' : ''}${ar}%` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">معامل الربحية</p>
                  <p className="text-lg font-bold font-mono tabular-nums">{pf ?? '—'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}
      {topSignals.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1" dir="rtl">
            <span className="text-base">🎯</span>
            <h3 className="text-sm font-bold text-emerald-600 dark:text-emerald-400">أقوى {topSignals.length} فرص استثمارية مؤكدة اليوم</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {topSignals.map((sig) => (
              <SignalCard key={`${sig.ticker}-${sig.prediction_date}`} sig={sig} onCopy={handleCopy} copied={copiedTicker === sig.ticker} />
            ))}
          </div>
        </div>
      )}
      {extraSignals.length > 0 && (
        <div className="space-y-3">
          <button onClick={() => setShowExtra(!showExtra)} className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 rounded-lg transition-all w-full" dir="rtl" aria-expanded={showExtra}>
            {showExtra ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 text-right">فرص استثمارية إضافية تحت المراقبة ({extraSignals.length} سهم)</span>
            <Badge variant="outline" className="text-[9px] shrink-0 bg-muted/40">{showExtra ? 'طي' : 'عرض'}</Badge>
          </button>
          {showExtra && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
              {extraSignals.map((sig) => (
                <SignalCard key={`${sig.ticker}-${sig.prediction_date}`} sig={sig} onCopy={handleCopy} copied={copiedTicker === sig.ticker} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ALPHA-2: Conviction Dossier Dialog */}
      <Dialog open={!!dossierTicker} onOpenChange={(open) => { if (!open) setDossierTicker(null); }}>
        <DialogContent className="max-w-[95vw] w-full max-w-2xl max-h-[85vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              📂 ملف الأدلة والبراهين — {dossierTicker}
            </DialogTitle>
          </DialogHeader>
          {dossierLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : dossierData ? (
            <div className="space-y-4">
              {/* برهان سيولة الحيتان */}
              <Card className="bg-card border-border">
                <CardContent className="p-3">
                  <h3 className="text-sm font-bold mb-2 flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-emerald-500" /> برهان سيولة الحيتان
                  </h3>
                  {dossierData.whale_flow_history && Array.isArray(dossierData.whale_flow_history) && dossierData.whale_flow_history.length > 0 ? (
                    <div className="space-y-1">
                      {dossierData.whale_flow_history.map((d: any, i: number) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{d.date || '—'}</span>
                          <span className={`font-mono tabular-nums font-semibold ${(d.net_flow ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {fmtPrice(d.net_flow)} ج.م
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">لا توجد بيانات تدفق متاحة</p>
                  )}
                </CardContent>
              </Card>
              {/* سجل النزاهة */}
              {dossierData.historical_win_rate != null && (
                <Card className="bg-card border-border">
                  <CardContent className="p-3">
                    <h3 className="text-sm font-bold mb-2 flex items-center gap-1.5">
                      <Trophy className="w-4 h-4 text-amber-500" /> سجل النزاهة والذاكرة
                    </h3>
                    <p className="text-sm">
                      نسبة نجاح المنصة في هذا السهم:{' '}
                      <span className="font-mono font-bold text-emerald-500">{dossierData.historical_win_rate}%</span>
                    </p>
                  </CardContent>
                </Card>
              )}
              {/* هندسة المخاطرة */}
              {dossierData.trade_math && (
                <Card className="bg-card border-border">
                  <CardContent className="p-3">
                    <h3 className="text-sm font-bold mb-2 flex items-center gap-1.5">
                      <Target className="w-4 h-4 text-emerald-500" /> هندسة المخاطرة
                    </h3>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>الدخول: <span className="font-mono font-bold">{fmtPrice(dossierData.trade_math.entry_price)}</span></div>
                      <div>الوقف: <span className="font-mono font-bold text-rose-500">{fmtPrice(dossierData.trade_math.stop_loss)}</span></div>
                      <div>الهدف 1: <span className="font-mono font-bold text-teal-500">{fmtPrice(dossierData.trade_math.target_1)}</span></div>
                      <div>R/R: <span className="font-mono font-bold text-emerald-500">1:{Number(dossierData.trade_math.rr_ratio ?? 0).toFixed(1)}</span></div>
                    </div>
                  </CardContent>
                </Card>
              )}
              {/* التفسير المؤسسي */}
              {dossierData.technical_rationale && (
                <Card className="bg-card border-border">
                  <CardContent className="p-3">
                    <h3 className="text-sm font-bold mb-2 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-emerald-500" /> التفسير المؤسسي
                    </h3>
                    <p className="text-sm text-foreground leading-relaxed">{dossierData.technical_rationale}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground text-sm">
              لا توجد بيانات أدلة متاحة حالياً
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
