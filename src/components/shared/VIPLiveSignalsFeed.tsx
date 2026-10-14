'use client';
<<<<<<< HEAD

/**
 * VIP Live Signals Feed — كروت تداول احترافية صالحة للشراء الآن
 * ==================================================================
 * T-ALPHA-A17: يستهلك من /api/v2/commercial-feed (Single Commercial Feed).
 *   • يعرض كروت الصفقات الحية مع الدافع الفني (catalyst) بروز بارز.
 *   • يوفر زر نسخ تفاصيل التوصية جاهز للإرسال عبر Telegram/WhatsApp.
 *   • يعرض بانر السجل الموثق (Audited Performance) + جدول آخر 20 صفقة.
 *
 * Rule 27: لا بيانات وهمية — إذا الـ API فارغ، اعرض رسالة واضحة.
 * Rule 4: لا حساب مالي — كل الأرقام من الـ API.
 * Rule 30: لا أزرق/إنديغو — لوحة زمردي/تركوازي.
 */

=======
>>>>>>> 0a55727 (feat(ui): A-18: Null safety + unified Arabic tabs + English purge)
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
<<<<<<< HEAD
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useAppStore, MARKET_CURRENCY_LABEL, type MarketType } from '@/lib/store';
import {
  Zap, Target, ShieldAlert, ArrowRight, RefreshCw, Activity,
  Copy, Check, Flame, History, Trophy, TrendingUp, BarChart3,
} from 'lucide-react';

/* ============================================================================
 * Types — match the actual /api/v2/commercial-feed response shape
 * ============================================================================ */

interface LiveSignal {
  ticker: string;
  name: string | null;
  sector: string | null;
  market: string;
  signal: string;
  signal_ar: string | null;
  signal_type: string | null;
  entry_price: number | null;
  target_1: number | null;
  target_1_pct: number | null;
  target_2: number | null;
  target_2_pct: number | null;
  stop_loss: number | null;
  risk_reward: number | null;
  confidence: number | null;
  horizon: string | null;
  horizon_icon: string | null;
  catalyst: string | null;
  catalyst_ar: string | null;
  prediction_date: string | null;
  current_price: number | null;
  source: string | null;
}

interface AuditedTrade {
  ticker: string;
  name: string | null;
  market: string | null;
  sector: string | null;
  signal: string | null;
  entry_price: number | null;
  exit_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  highest_price: number | null;
  lowest_price: number | null;
  actual_return_pct: number | null;
  status: string | null;
  status_ar: string | null;
  hit_target: boolean | null;
  hit_stop: boolean | null;
  holding_days: number | null;
  outcome_date: string | null;
  prediction_date: string | null;
  confidence: number | null;
}

interface ActiveSignalsSummary {
  count: number;
  avg_rr: number | null;
  avg_confidence: number | null;
}

interface AuditedPerformanceSummary {
  total_closed: number;
  wins: number;
  losses: number;
  expired?: number;
  win_rate: number | null;
  avg_return: number | null;
  best_return: number | null;
  worst_return: number | null;
  profit_factor: number | null;
}

interface FeedResponse {
  success: boolean;
  summary?: {
    active_signals?: ActiveSignalsSummary;
    audited_performance?: AuditedPerformanceSummary;
    generated_at?: string;
  };
  active_live_signals: LiveSignal[];
  audited_performance_history: AuditedTrade[];
  error?: string;
  message?: string;
}

/* ============================================================================
 * Formatters (display only — no financial math)
 * ============================================================================ */

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(2);
}

function fmtPct(n: number | null | undefined, withSign = true): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const sign = withSign && n >= 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(1)}%`;
}

function fmtRR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) <= 0) return '—';
  return `1:${Number(n).toFixed(1)}`;
}

/* ============================================================================
 * Copy message builder — جاهز للإرسال عبر Telegram/WhatsApp
 * ============================================================================ */

function buildCopyMessage(sig: LiveSignal, currency: string = 'ج.م'): string {
  const lines: string[] = [];
  lines.push('🎯 توصية GLMinvestment');
  lines.push('');
  lines.push(`📈 السهم: ${sig.ticker} — ${sig.name || ''}`);
  lines.push(`🎯 نوع الإشارة: ${sig.signal_ar || sig.signal || ''}`);
  lines.push(`💰 سعر الدخول: ${fmtPrice(sig.entry_price)} ${currency}`);
  lines.push(
    `🎯 الهدف: ${fmtPrice(sig.target_1)} ${currency} (+${Number(sig.target_1_pct ?? 0).toFixed(1)}%)`,
  );
  lines.push(`🛑 وقف الخسارة: ${fmtPrice(sig.stop_loss)} ${currency}`);
  lines.push(`⚖️ نسبة المخاطرة/العائد: 1:${fmtRR(sig.risk_reward).replace('1:', '')}`);
  lines.push(`📊 الثقة: ${sig.confidence != null ? Math.round(Number(sig.confidence)) : '—'}%`);
  lines.push(`⏱️ الأفق: ${sig.horizon || '—'}`);
  lines.push('');
  lines.push('🔥 الدافع الفني:');
  lines.push(sig.catalyst_ar || sig.catalyst || '—');
  lines.push('');
  lines.push('⚠️ إدارة المخاطر: لا تخاطر بأكثر من 2% من رأس المال');
  lines.push(`📅 تاريخ التوصية: ${sig.prediction_date || '—'}`);
  return lines.join('\n');
}

/* ============================================================================
 * Main component
 * ============================================================================ */

export function VIPLiveSignalsFeed({ market }: { market: string }) {
  const currency = MARKET_CURRENCY_LABEL[market as MarketType] || 'ج.م';
  const [data, setData] = useState<FeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedTicker, setCopiedTicker] = useState<string | null>(null);
  const setSelectedTicker = useAppStore((s) => s.setSelectedTicker);
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v2/commercial-feed?market=${encodeURIComponent(market)}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        setError('تعذّر جلب الصفقات الحية');
        setData(null);
        return;
      }
      const json: FeedResponse = await res.json();
      if (!json.success) {
        setError(json.message || 'تعذّر جلب الصفقات الحية');
        setData(null);
        return;
      }
      setData(json);
    } catch {
      setError('تعذّر الاتصال بالخادم');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleOpenStock = (ticker: string) => {
    setSelectedTicker(ticker);
    setCurrentView('stock-detail');
  };

  const handleCopy = async (e: React.MouseEvent, sig: LiveSignal) => {
    e.stopPropagation();
    try {
      const msg = buildCopyMessage(sig, currency);
      await navigator.clipboard.writeText(msg);
      setCopiedTicker(sig.ticker);
      setTimeout(() => setCopiedTicker((t) => (t === sig.ticker ? null : t)), 2000);
    } catch {
      // Clipboard might be blocked — silent fallback (no fake success)
      setCopiedTicker(null);
    }
  };

  /* ---- Loading ---- */
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-44 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  /* ---- Error ---- */
  if (error || !data) {
    return (
      <Card className="border-amber-200 dark:border-amber-800/50">
        <CardContent className="p-6 text-center space-y-3">
          <Activity className="w-8 h-8 text-amber-500 mx-auto" />
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
            {error || 'لا توجد بيانات'}
          </p>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  const signals = data.active_live_signals || [];
  const auditedHistory = data.audited_performance_history || [];
  const auditedSummary = data.summary?.audited_performance;
  const activeSummary = data.summary?.active_signals;
  const last20Trades = auditedHistory.slice(0, 20);
  const winRate = auditedSummary?.win_rate;
  const winRateTone =
    winRate == null
      ? 'neutral'
      : winRate >= 70
        ? 'positive'
        : winRate < 50
          ? 'negative'
          : 'warning';

  return (
    <div className="space-y-4">
      {/* ============ Audited Performance Banner ============ */}
      {auditedSummary && auditedSummary.total_closed > 0 && (
        <Card className="border-emerald-200 dark:border-emerald-900/40 bg-gradient-to-l from-emerald-50/60 to-teal-50/40 dark:from-emerald-950/30 dark:to-teal-950/20">
          <CardContent className="p-3 sm:p-4 space-y-3">
            <div className="flex items-center gap-2 px-1" dir="rtl">
              <Trophy className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                السجل الموثّق — أداء مُدقّق
              </span>
              <Badge variant="outline" className="text-[9px] text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700">
                {auditedSummary.total_closed} صفقة مغلقة
              </Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatBox
                icon={<BarChart3 className="w-3.5 h-3.5" />}
                label="إجمالي الصفقات"
                value={String(auditedSummary.total_closed)}
                tone="neutral"
              />
              <StatBox
                icon={<Target className="w-3.5 h-3.5" />}
                label="نسبة النجاح"
                value={winRate != null ? `${winRate.toFixed(0)}%` : '—'}
                tone={winRateTone}
              />
              <StatBox
                icon={<TrendingUp className="w-3.5 h-3.5" />}
                label="متوسط الربح"
                value={auditedSummary.avg_return != null ? `+${auditedSummary.avg_return.toFixed(1)}%` : '—'}
                tone="positive"
              />
              <StatBox
                icon={<Trophy className="w-3.5 h-3.5" />}
                label="معامل الربحية"
                value={auditedSummary.profit_factor != null ? `${auditedSummary.profit_factor.toFixed(1)}×` : '—'}
                tone="positive"
                subtext={
                  auditedSummary.best_return != null
                    ? `الأفضل: +${auditedSummary.best_return.toFixed(1)}%`
                    : undefined
                }
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ============ Header strip ============ */}
      <div className="flex items-center justify-between px-1" dir="rtl">
        <div className="flex items-center gap-2 flex-wrap">
          <Zap className="w-4 h-4 text-emerald-500" />
          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
            الصفقات الحية ({signals.length})
          </span>
          {activeSummary?.avg_rr != null && (
            <Badge variant="outline" className="text-[9px]">
              متوسط R:R 1:{activeSummary.avg_rr.toFixed(1)}
            </Badge>
          )}
          {activeSummary?.avg_confidence != null && (
            <Badge variant="outline" className="text-[9px]">
              متوسط الثقة {Math.round(activeSummary.avg_confidence)}%
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={fetchData} className="h-7 px-2">
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* ============ Active Signals (or empty state) ============ */}
      {signals.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center space-y-2">
            <Zap className="w-8 h-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm font-semibold text-muted-foreground">
              لا توجد صفقات حية صالحة للشراء الآن
            </p>
            <p className="text-xs text-muted-foreground">
              المحرك يفحص السوق باستمرار — ستظهر الفرص المؤكدة هنا فور توليدها
            </p>
            <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5 mt-2">
              <RefreshCw className="w-3.5 h-3.5" />
              تحديث
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {signals.map((sig) => {
            const isStrongBuy = sig.signal?.toUpperCase() === 'STRONG_BUY';
            const rr = Number(sig.risk_reward) || 0;
            const isGoodRR = rr >= 2.0;
            const confidence = Number(sig.confidence) || 0;
            const isHighConfidence = confidence >= 65;
            const isCopied = copiedTicker === sig.ticker;
            const hasCatalyst = !!(sig.catalyst_ar || sig.catalyst);

            return (
              <Card
                key={sig.ticker + (sig.prediction_date || '')}
                className={cn(
                  'border-r-4 overflow-hidden transition-all hover:shadow-lg',
                  isStrongBuy ? 'border-r-emerald-500' : 'border-r-amber-400',
                )}
              >
                <CardContent className="p-3 space-y-2.5">
                  {/* Row 1: Ticker + Name + Signal Badge */}
                  <div
                    className="flex items-start justify-between gap-2 cursor-pointer"
                    onClick={() => handleOpenStock(sig.ticker)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-bold text-sm">{sig.ticker}</span>
                        {sig.market && sig.market !== 'EGX' && (
                          <span className="text-[9px] text-muted-foreground">{sig.market}</span>
                        )}
                        {sig.horizon && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded-full border border-amber-400/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400"
                            title={`الأفق الزمني: ${sig.horizon}`}
                          >
                            <span>{sig.horizon_icon || '⏱️'}</span>
                            <span className="truncate max-w-[80px]">{sig.horizon}</span>
                          </span>
                        )}
                      </div>
                      {sig.name && (
                        <div className="text-[11px] text-muted-foreground truncate" title={sig.name}>
                          {sig.name}
                        </div>
                      )}
                      {sig.sector && (
                        <div className="text-[9px] text-muted-foreground/70 truncate">{sig.sector}</div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge
                        className={cn(
                          'text-[10px] font-bold',
                          isStrongBuy
                            ? 'bg-emerald-500 text-white'
                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
                        )}
                      >
                        {sig.signal_ar || sig.signal || '—'}
                      </Badge>
                    </div>
                  </div>

                  {/* Row 2: Entry / Target / Stop grid */}
                  <div className="grid grid-cols-3 gap-2">
                    {/* Entry */}
                    <div className="rounded-md bg-muted/40 p-1.5 text-center">
                      <div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5">
                        <ArrowRight className="w-2.5 h-2.5" /> دخول
                      </div>
                      <div className="font-mono font-bold text-xs">{fmtPrice(sig.entry_price)} <span className="text-[8px] font-normal text-muted-foreground">{currency}</span></div>
                    </div>
                    {/* Target */}
                    <div className="rounded-md bg-emerald-500/5 border border-emerald-500/20 p-1.5 text-center">
                      <div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5">
                        <Target className="w-2.5 h-2.5" /> هدف
                      </div>
                      <div className="font-mono font-bold text-xs text-emerald-600 dark:text-emerald-400">
                        {fmtPrice(sig.target_1)} <span className="text-[8px] font-normal text-muted-foreground">{currency}</span>
                      </div>
                      {sig.target_1_pct != null && (
                        <div className="text-[8px] text-emerald-500 font-semibold">
                          {fmtPct(sig.target_1_pct, false)}
                        </div>
                      )}
                    </div>
                    {/* Stop */}
                    <div className="rounded-md bg-red-500/5 border border-red-500/20 p-1.5 text-center">
                      <div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5">
                        <ShieldAlert className="w-2.5 h-2.5" /> وقف
                      </div>
                      <div className="font-mono font-bold text-xs text-red-600 dark:text-red-400">
                        {fmtPrice(sig.stop_loss)} <span className="text-[8px] font-normal text-muted-foreground">{currency}</span>
                      </div>
                    </div>
                  </div>

                  {/* Row 3: R:R + Confidence bar */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] text-muted-foreground">R:R</span>
                      <span
                        className={cn(
                          'font-mono font-bold text-xs',
                          isGoodRR
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400',
                        )}
                      >
                        {fmtRR(sig.risk_reward)}
                      </span>
                      {isGoodRR && <span className="text-[8px] text-emerald-500">✓</span>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-1 max-w-[140px]">
                      <span className="text-[9px] text-muted-foreground whitespace-nowrap">ثقة</span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            isHighConfidence ? 'bg-emerald-500' : 'bg-amber-500',
                          )}
                          style={{ width: `${Math.min(confidence, 100)}%` }}
                        />
                      </div>
                      <span className="text-[9px] font-bold tabular-nums">
                        {confidence > 0 ? `${Math.round(confidence)}%` : '—'}
                      </span>
                    </div>
                  </div>

                  {/* Row 4: Catalyst — Technical Driver */}
                  {hasCatalyst && (
                    <div className="rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-2 space-y-1">
                      <div className="flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                        <Flame className="w-3 h-3" />
                        <span>الدافع الفني</span>
                      </div>
                      <p
                        dir="rtl"
                        className="text-[11px] italic leading-relaxed text-amber-900 dark:text-amber-200 break-words"
                      >
                        {sig.catalyst_ar || sig.catalyst}
                      </p>
                    </div>
                  )}

                  {/* Row 5: Meta — date + current price + signal_type */}
                  <div className="flex items-center justify-between text-[9px] text-muted-foreground pt-1 border-t border-border/30" dir="rtl">
                    {sig.current_price != null && Number(sig.current_price) > 0 ? (
                      <span>
                        سعر السوق: <span className="font-mono font-semibold">{fmtPrice(sig.current_price)}</span>
                      </span>
                    ) : (
                      <span>—</span>
                    )}
                    <span className="text-muted-foreground/70">
                      {sig.signal_type === 'institutional_scan' ? 'مسح مؤسسي' : sig.prediction_date || '—'}
                    </span>
                  </div>

                  {/* Row 6: Copy button */}
                  <Button
                    type="button"
                    variant={isCopied ? 'default' : 'outline'}
                    size="sm"
                    onClick={(e) => handleCopy(e, sig)}
                    className={cn(
                      'w-full h-8 gap-1.5 text-[11px] font-bold transition-all',
                      isCopied
                        ? 'bg-emerald-500 text-white hover:bg-emerald-600 border-emerald-500'
                        : 'border-emerald-300 text-emerald-700 dark:text-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40',
                    )}
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        تم نسخ التوصية ✓
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        📋 نسخ تفاصيل التوصية
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ============ Audited History Table ============ */}
      {last20Trades.length > 0 && (
        <Card className="border-emerald-200/60 dark:border-emerald-900/40">
          <CardContent className="p-3 sm:p-4 space-y-2">
            <div className="flex items-center gap-2 px-1" dir="rtl">
              <History className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                السجل الموثّق — آخر {last20Trades.length} صفقة
              </span>
              {auditedHistory.length > last20Trades.length && (
                <Badge variant="outline" className="text-[9px]">
                  من أصل {auditedHistory.length}
                </Badge>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto rounded-md border border-border/40">
              <Table>
                <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                  <TableRow>
                    <TableHead className="text-right text-[10px]">السهم</TableHead>
                    <TableHead className="text-right text-[10px]">تاريخ الدخول</TableHead>
                    <TableHead className="text-right text-[10px]">تاريخ الخروج</TableHead>
                    <TableHead className="text-right text-[10px]">سعر الدخول ({currency})</TableHead>
                    <TableHead className="text-right text-[10px]">سعر الخروج ({currency})</TableHead>
                    <TableHead className="text-right text-[10px]">الربح/الخسارة</TableHead>
                    <TableHead className="text-right text-[10px]">النتيجة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {last20Trades.map((t, i) => {
                    const ret = Number(t.actual_return_pct);
                    const isPositive = Number.isFinite(ret) && ret > 0;
                    const isNegative = Number.isFinite(ret) && ret < 0;
                    return (
                      <TableRow key={`${t.ticker}-${t.prediction_date}-${i}`}>
                        <TableCell className="text-right">
                          <div className="flex flex-col">
                            <span className="font-mono font-bold text-[11px]">{t.ticker}</span>
                            {t.name && (
                              <span className="text-[9px] text-muted-foreground truncate max-w-[120px]" title={t.name}>
                                {t.name}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-[10px] font-mono text-muted-foreground">
                          {t.prediction_date || '—'}
                        </TableCell>
                        <TableCell className="text-right text-[10px] font-mono text-muted-foreground">
                          {t.outcome_date || '—'}
                        </TableCell>
                        <TableCell className="text-right text-[10px] font-mono">
                          {fmtPrice(t.entry_price)}
                        </TableCell>
                        <TableCell className="text-right text-[10px] font-mono">
                          {fmtPrice(t.exit_price)}
                        </TableCell>
                        <TableCell className="text-right text-[10px] font-mono font-bold">
                          <span
                            className={cn(
                              isPositive && 'text-emerald-600 dark:text-emerald-400',
                              isNegative && 'text-red-600 dark:text-red-400',
                              !isPositive && !isNegative && 'text-muted-foreground',
                            )}
                          >
                            {t.actual_return_pct != null ? fmtPct(t.actual_return_pct) : '—'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-[10px]">
                          <span
                            className={cn(
                              'inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold',
                              t.status === 'win' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
                              t.status === 'loss' && 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
                              t.status !== 'win' && t.status !== 'loss' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
                            )}
                          >
                            {t.status_ar || t.status || '—'}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
=======
import { TimeHorizonBadge } from '@/components/shared/TimeHorizonBadge';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { Zap, Target, ShieldAlert, ArrowRight, RefreshCw, Activity, Copy, Check, Flame } from 'lucide-react';
import { toast } from 'sonner';

interface LiveSignal {
  ticker: string; name_ar: string | null; sector: string | null; market: string;
  signal: string; signal_ar: string; entry_price: number | null; target_price: number | null;
  target_price_2: number | null; stop_loss: number | null; risk_reward: number | null;
  confidence: number | null; master_score: number | null; persona: string | null;
  prediction_date: string | null; current_price: number | null; upside_pct: number | null;
  downside_pct: number | null; catalyst?: string | null; analysis_reason?: string | null;
}
interface FeedResponse {
  success: boolean; market: string; active_live_signals: LiveSignal[];
  audited_performance: unknown[];
  stats: { live_count: number; audited_count: number; win_rate: number | null; avg_return: number | null; };
  error?: string; message?: string;
}
function fmtPrice(n: number | null | undefined): string { if (n == null || !Number.isFinite(Number(n))) return '—'; return Number(n).toFixed(2); }
function fmtPct(n: number | null | undefined): string { if (n == null || !Number.isFinite(Number(n))) return '—'; const s = n >= 0 ? '+' : ''; return `${s}${Number(n).toFixed(1)}%`; }
function fmtRR(n: number | null | undefined): string { if (n == null || !Number.isFinite(Number(n)) || Number(n) <= 0) return '—'; return `1:${Number(n).toFixed(1)}`; }

export function VIPLiveSignalsFeed({ market }: { market: string }) {
  const [data, setData] = useState<FeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const setSelectedTicker = useAppStore((s) => s.setSelectedTicker);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/v2/commercial-feed?market=${encodeURIComponent(market)}`, { cache: 'no-store' });
      if (!res.ok) { setError('تعذّر جلب الصفقات الحية'); setData(null); return; }
      const json: FeedResponse = await res.json();
      if (!json.success) { setError(json.message || 'تعذّر جلب الصفقات الحية'); setData(null); return; }
      setData(json);
    } catch { setError('تعذّر الاتصال بالخادم'); setData(null); }
    finally { setLoading(false); }
  }, [market]);
  useEffect(() => { fetchData(); }, [fetchData]);
  const handleOpenStock = (ticker: string) => { setSelectedTicker(ticker); setCurrentView('stock-detail'); };

  if (loading) return (<div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}</div>);
  if (error || !data) return (
    <Card className="border-amber-200 dark:border-amber-800/50">
      <CardContent className="p-6 text-center space-y-3">
        <Activity className="w-8 h-8 text-amber-500 mx-auto" />
        <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">{error || 'لا توجد بيانات'}</p>
        <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> إعادة المحاولة</Button>
      </CardContent>
    </Card>
  );
  const signals = data.active_live_signals;
  // T-ALPHA-18: Null safety — stats?.win_rate ?? null
  const winRate = data?.stats?.win_rate ?? null;
  if (signals.length === 0) return (
    <Card><CardContent className="p-6 text-center space-y-2">
      <Zap className="w-8 h-8 text-muted-foreground/40 mx-auto" />
      <p className="text-sm font-semibold text-muted-foreground">لا توجد صفقات حية صالحة للشراء الآن</p>
      <p className="text-xs text-muted-foreground">المحرك يفحص السوق باستمرار — ستظهر الفرص المؤكدة هنا فور توليدها</p>
      <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5 mt-2"><RefreshCw className="w-3.5 h-3.5" /> تحديث</Button>
    </CardContent></Card>
  );
  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-emerald-500" />
          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">الصفقات الحية ({signals.length})</span>
          {winRate != null && <Badge variant="outline" className="text-[9px]">معدل النجاح: {winRate}%</Badge>}
        </div>
        <Button variant="ghost" size="sm" onClick={fetchData} className="h-7 px-2"><RefreshCw className="w-3.5 h-3.5" /></Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {signals.map((sig) => {
          const isStrongBuy = sig.signal?.toUpperCase() === 'STRONG_BUY';
          const rr = Number(sig.risk_reward) || 0;
          const isGoodRR = rr >= 2.0;
          const confidence = Number(sig.confidence) || 0;
          const isHighConfidence = confidence >= 65;
          const catalyst = sig.catalyst || sig.analysis_reason;
          return (
            <Card key={sig.ticker + sig.prediction_date} className={cn('border-r-4 overflow-hidden transition-all hover:shadow-lg cursor-pointer', isStrongBuy ? 'border-r-emerald-500' : 'border-r-amber-400')} onClick={() => handleOpenStock(sig.ticker)}>
              <CardContent className="p-3 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-sm">{sig.ticker}</span>
                      {sig.market && sig.market !== 'EGX' && <span className="text-[9px] text-muted-foreground">{sig.market}</span>}
                    </div>
                    {sig.name_ar && <div className="text-[11px] text-muted-foreground truncate" title={sig.name_ar}>{sig.name_ar}</div>}
                    {sig.sector && <div className="text-[9px] text-muted-foreground/70 truncate">{sig.sector}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge className={cn('text-[10px] font-bold', isStrongBuy ? 'bg-emerald-500 text-white' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300')}>{sig.signal_ar || sig.signal || '—'}</Badge>
                    {sig.persona && <TimeHorizonBadge persona={sig.persona} size="sm" />}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-md bg-muted/40 p-1.5 text-center"><div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5"><ArrowRight className="w-2.5 h-2.5" /> دخول</div><div className="font-mono font-bold text-xs">{fmtPrice(sig.entry_price)}</div></div>
                  <div className="rounded-md bg-emerald-500/5 border border-emerald-500/20 p-1.5 text-center"><div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5"><Target className="w-2.5 h-2.5" /> هدف</div><div className="font-mono font-bold text-xs text-emerald-600 dark:text-emerald-400">{fmtPrice(sig.target_price)}</div>{sig.upside_pct != null && <div className="text-[8px] text-emerald-500 font-semibold">{fmtPct(sig.upside_pct)}</div>}</div>
                  <div className="rounded-md bg-red-500/5 border border-red-500/20 p-1.5 text-center"><div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5"><ShieldAlert className="w-2.5 h-2.5" /> وقف</div><div className="font-mono font-bold text-xs text-red-600 dark:text-red-400">{fmtPrice(sig.stop_loss)}</div>{sig.downside_pct != null && <div className="text-[8px] text-red-500 font-semibold">{fmtPct(sig.downside_pct)}</div>}</div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1"><span className="text-[9px] text-muted-foreground">R:R</span><span className={cn('font-mono font-bold text-xs', isGoodRR ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>{fmtRR(sig.risk_reward)}</span>{isGoodRR && <span className="text-[8px] text-emerald-500">✓</span>}</div>
                  <div className="flex items-center gap-1.5 flex-1 max-w-[120px]"><span className="text-[9px] text-muted-foreground whitespace-nowrap">ثقة</span><div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden"><div className={cn('h-full rounded-full transition-all', isHighConfidence ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: `${Math.min(confidence, 100)}%` }} /></div><span className="text-[9px] font-bold tabular-nums">{confidence > 0 ? `${Math.round(confidence)}%` : '—'}</span></div>
                </div>
                <div className="flex items-center justify-between text-[9px] text-muted-foreground pt-1 border-t border-border/30">
                  <span>{sig.target_price_2 != null && sig.target_price_2 > 0 ? <>هدف 2: <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{fmtPrice(sig.target_price_2)}</span></> : <span>—</span>}</span>
                  {sig.current_price != null && sig.current_price > 0 && <span>سعر السوق: <span className="font-mono font-semibold">{fmtPrice(sig.current_price)}</span></span>}
                  {sig.prediction_date && <span className="text-muted-foreground/60">{sig.prediction_date}</span>}
                </div>
                {catalyst && (
                  <div className="flex items-start gap-1.5 rounded-md bg-amber-500/5 border border-amber-500/20 p-1.5">
                    <Flame className="w-3 h-3 text-amber-500 shrink-0 mt-px" />
                    <span className="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed flex-1">{catalyst}</span>
                  </div>
                )}
                <CopyButton signal={sig} />
              </CardContent>
            </Card>
          );
        })}
      </div>
>>>>>>> 0a55727 (feat(ui): A-18: Null safety + unified Arabic tabs + English purge)
    </div>
  );
}

<<<<<<< HEAD
/* ============================================================================
 * Local StatBox — emerald/teal palette (no blue/indigo — Rule 30)
 * ============================================================================ */

interface StatBoxProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning';
  subtext?: string;
}

function StatBox({ icon, label, value, tone = 'neutral', subtext }: StatBoxProps) {
  return (
    <div className="rounded-md border border-border/50 bg-background/60 p-2 space-y-0.5">
      <div className="flex items-center gap-1 text-muted-foreground">
        {icon}
        <span className="text-[10px] font-medium truncate">{label}</span>
      </div>
      <div
        className={cn(
          'text-base font-bold tabular-nums',
          tone === 'positive' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'negative' && 'text-red-600 dark:text-red-400',
          tone === 'warning' && 'text-amber-600 dark:text-amber-400',
          tone === 'neutral' && 'text-foreground',
        )}
      >
        {value}
      </div>
      {subtext && (
        <div className="text-[9px] text-muted-foreground truncate">{subtext}</div>
      )}
    </div>
  );
}

export default VIPLiveSignalsFeed;
=======
function CopyButton({ signal }: { signal: LiveSignal }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const lines = ['📊 توصية استثمارية — منصة دليل الاستثمار', '━━━━━━━━━━━━━━━━━━━━'];
    lines.push(`السهم: ${signal.ticker}${signal.name_ar ? ` (${signal.name_ar})` : ''}`);
    lines.push(`الإشارة: ${signal.signal_ar || signal.signal || '—'}`);
    if (signal.entry_price != null) lines.push(`💰 سعر الدخول: ${fmtPrice(signal.entry_price)} ج.م`);
    if (signal.target_price != null) lines.push(`🎯 الهدف الأول: ${fmtPrice(signal.target_price)} ج.م${signal.upside_pct != null ? ` (+${signal.upside_pct.toFixed(1)}%)` : ''}`);
    if (signal.target_price_2 != null && signal.target_price_2 > 0) lines.push(`🎯 الهدف الثاني: ${fmtPrice(signal.target_price_2)} ج.م`);
    if (signal.stop_loss != null) lines.push(`🛑 وقف الخسارة: ${fmtPrice(signal.stop_loss)} ج.م${signal.downside_pct != null ? ` (${signal.downside_pct.toFixed(1)}%)` : ''}`);
    if (signal.risk_reward != null && Number(signal.risk_reward) > 0) lines.push(`⚖️ نسبة العائد/المخاطرة: 1:${Number(signal.risk_reward).toFixed(1)}`);
    if (signal.confidence != null && Number(signal.confidence) > 0) lines.push(`🔐 نسبة الثقة: ${Math.round(Number(signal.confidence))}%`);
    const catalyst = signal.catalyst || signal.analysis_reason;
    if (catalyst) lines.push(`🔥 الدافع الفني: ${catalyst}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━', '📌 منصة GLM Investment — نظام كشف السيولة الذكية', '⚠️ إخلاء مسؤولية: التوصيات للأغراض التعليمية فقط');
    navigator.clipboard.writeText(lines.join('\n')).then(() => { setCopied(true); toast.success('تم نسخ تفاصيل التوصية', { duration: 2000 }); setTimeout(() => setCopied(false), 2000); }).catch(() => toast.error('تعذّر نسخ التوصية'));
  }, [signal]);
  return (
    <Button variant="outline" size="sm" onClick={handleCopy} className="w-full h-7 text-[10px] gap-1.5 mt-1">
      {copied ? <><Check className="w-3 h-3 text-emerald-500" /><span className="text-emerald-500">تم النسخ</span></> : <><Copy className="w-3 h-3" /><span>📋 نسخ تفاصيل التوصية</span></>}
    </Button>
  );
}
>>>>>>> 0a55727 (feat(ui): A-18: Null safety + unified Arabic tabs + English purge)
