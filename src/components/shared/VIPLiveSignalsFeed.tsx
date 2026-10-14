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
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Zap, Target, ShieldAlert, ArrowRight, RefreshCw, Activity,
  Copy, Check, Flame, ChevronDown, ChevronUp, Search,
} from 'lucide-react';

interface LiveSignal {
  ticker: string;
  name: string | null;
  market: string | null;
  sector: string | null;
  signal: string | null;
  signal_ar: string | null;
  entry_price: number | null;
  target_1: number | null;
  target_1_pct: number | null;
  target_2: number | null;
  target_2_pct: number | null;
  stop_loss: number | null;
  stop_loss_pct: number | null;
  risk_reward: number | null;
  confidence: number | null;
  horizon: string | null;
  horizon_icon: string | null;
  catalyst: string | null;
  catalyst_ar: string | null;
  prediction_date: string | null;
  current_price: number | null;
}

interface FeedResponse {
  success: boolean;
  top_5_signals?: LiveSignal[];
  extra_signals?: LiveSignal[];
  active_live_signals?: LiveSignal[];
  summary?: {
    active_signals?: { count?: number; avg_rr?: number | null; avg_confidence?: number | null };
    audited_performance?: {
      total_closed?: number;
      wins?: number;
      losses?: number;
      win_rate?: number | null;
      avg_return?: number | null;
      best_return?: number | null;
      profit_factor?: number | null;
    };
  };
  error?: string;
  message?: string;
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

function SignalCard({ sig, onCopy, copied }: { sig: LiveSignal; onCopy: (e: React.MouseEvent, sig: LiveSignal) => void; copied: boolean }) {
  return (
    <Card key={`${sig.ticker}-${sig.prediction_date}`} className="overflow-hidden hover:border-emerald-500/40 transition-colors">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-bold text-base shrink-0">{sig.ticker}</span>
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
          </div>
          <div className="min-w-0">
            <p className="text-[9px] text-muted-foreground flex items-center gap-1">
              <ArrowRight className="w-2.5 h-2.5 shrink-0" /> <span className="truncate">الهدف</span>
            </p>
            <p className="font-mono font-semibold text-emerald-600 truncate">
              {fmtPrice(sig.target_1)}
              {sig.target_1_pct != null && (
                <span className="text-[9px] ml-1">({fmtPct(sig.target_1_pct)})</span>
              )}
            </p>
            {sig.target_2 != null && (
              <p className="font-mono text-[10px] text-emerald-500 truncate">
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
            )}
          </div>
        </div>

        {/* R:R + Horizon */}
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">
            R:R <span className="font-bold text-foreground">{fmtRR(sig.risk_reward)}</span>
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
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

export function VIPLiveSignalsFeed({ market }: { market: string }) {
  const [data, setData] = useState<FeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedTicker, setCopiedTicker] = useState<string | null>(null);
  const [showExtra, setShowExtra] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v2/commercial-feed?market=${encodeURIComponent(market)}`, { cache: 'no-store' });
      if (!res.ok) { setError('تعذّر جلب التوصيات'); setData(null); return; }
      const json: FeedResponse = await res.json();
      if (!json.success) { setError(json.message || 'تعذّر جلب التوصيات'); setData(null); return; }
      setData(json);
    } catch {
      setError('تعذّر الاتصال بالخادم');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCopy = async (e: React.MouseEvent, sig: LiveSignal) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(buildCopyMessage(sig));
      setCopiedTicker(sig.ticker);
      setTimeout(() => setCopiedTicker(null), 2000);
    } catch {
      // silent
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
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
      <Card>
        <CardContent className="p-6 text-center space-y-3">
          <Activity className="w-8 h-8 text-amber-500 mx-auto" />
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">{error || 'لا توجد بيانات'}</p>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  // T-ALPHA-A21: قراءة ما يرسله بايثون فقط — لا sort، لا filter، لا slice
  const topSignals: LiveSignal[] = data.top_5_signals || data.active_live_signals?.slice(0, 5) || [];
  const extraSignals: LiveSignal[] = data.extra_signals || [];

  // Audited Performance Banner (null safety مطلقة)
  const audited = data?.summary?.audited_performance;
  const showBanner = audited && audited.total_closed != null && audited.total_closed > 0;

  if (topSignals.length === 0 && extraSignals.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-2">
          <Activity className="w-8 h-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm font-semibold text-muted-foreground">
            لا توجد صفقات حية حالياً في {market}
          </p>
          <p className="text-xs text-muted-foreground">
            سيتم عرض الفرص الجديدة فور توفرها (Rule 27: لا بيانات وهمية)
          </p>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5 mt-2">
            <RefreshCw className="w-3.5 h-3.5" /> تحديث
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header strip */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-emerald-500" />
          <span className="text-sm font-semibold">الصفقات الحية</span>
          <Badge variant="outline" className="text-[10px]">{topSignals.length + extraSignals.length} صفقة</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchData} className="gap-1.5 h-7 text-xs">
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
            <CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground">إجمالي الصفقات</p>
                  <p className="text-lg font-bold">{audited?.total_closed ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">نسبة النجاح</p>
                  <p className={cn('text-lg font-bold', wr != null && wr >= 70 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                    {wr != null ? `${wr}%` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">متوسط الربح</p>
                  <p className={cn('text-lg font-bold', ar != null && ar >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                    {ar != null ? `${ar >= 0 ? '+' : ''}${ar}%` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">معامل الربحية</p>
                  <p className="text-lg font-bold">{pf ?? '—'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* T-ALPHA-A21: 🎯 أقوى 5 فرص استثمارية مؤكدة اليوم */}
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

      {/* T-ALPHA-A21: 🔍 استعراض باقي فرص الرادار الإضافية */}
      {extraSignals.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => setShowExtra(!showExtra)}
            className="flex items-center gap-2 px-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
            dir="rtl"
          >
            {showExtra ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            <Search className="w-3.5 h-3.5" />
            <span>
              استعراض باقي فرص الرادار الإضافية ({extraSignals.length} سهم)
            </span>
          </button>
          {showExtra && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
