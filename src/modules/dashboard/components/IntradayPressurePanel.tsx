'use client';

/**
 * IntradayPressurePanel — ضغط الشراء/البيع داخل الجلسة لسهم معيّن
 * ===================================================================
 * يعرض:
 *  - لكل باكت زمني: شريط مكدّس (أخضر=شراء | أحمر=بيع) + الوقت + الضغط الصافي
 *  - بطاقات ملخّص الجلسة: الضغط الصافي، نسبة شراء:بيع، VWAP، OHLC، الحجم الكلي
 *  - شارة تفسير (ضغط شرائي/بيعي/متوازن)
 *
 * NO mock data — كل البيانات من /api/market/intraday-pressure (اللي بدورها من intraday.db).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Gauge, TrendingUp, TrendingDown, Loader2, Search, Activity, Scale } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';

interface Bucket {
  bucket_start: string;
  bucket_end: string;
  time_label: string;
  buy_volume: number;
  sell_volume: number;
  neutral_volume: number;
  total_volume: number;
  buy_pressure_pct: number;
  sell_pressure_pct: number;
  net_pressure: number;
  vwap: number;
  avg_price: number;
  tick_count: number;
  open_price: number;
  close_price: number;
  high_price: number;
  low_price: number;
}

interface SessionSummary {
  total_buy_volume: number;
  total_sell_volume: number;
  total_neutral_volume: number;
  total_volume: number;
  net_pressure: number;
  buy_pressure_pct: number;
  sell_pressure_pct: number;
  buy_sell_ratio: number | null;
  session_vwap: number;
  session_open: number;
  session_close: number;
  session_high: number;
  session_low: number;
  tick_count: number;
}

interface PressureData {
  success: boolean;
  ticker: string;
  period: string;
  date: string | null;
  buckets: Bucket[];
  session_summary: SessionSummary | null;
  note?: string;
}

type PeriodKey = '5min' | '15min' | '30min' | '1h' | 'session';
const PERIOD_LABEL: Record<PeriodKey, string> = {
  '5min': '5 دقائق',
  '15min': '15 دقيقة',
  '30min': '30 دقيقة',
  '1h': 'ساعة',
  session: 'الجلسة كاملة',
};

interface Props {
  initialTicker?: string;
}

export function IntradayPressurePanel({ initialTicker = 'COMI' }: Props) {
  const [ticker, setTicker] = useState(initialTicker.toUpperCase());
  const [tickerInput, setTickerInput] = useState(initialTicker.toUpperCase());
  const [period, setPeriod] = useState<PeriodKey>('30min');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PressureData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/market/intraday-pressure?ticker=${encodeURIComponent(ticker)}&period=${period}`,
        { cache: 'no-store' }
      );
      if (!res.ok) {
        setError('تعذّر جلب البيانات. يرجى المحاولة مرة أخرى.');
        setData(null);
        return;
      }
      const json = (await res.json()) as PressureData;
      if (!json.success) {
        // PRED-RADAR-GAP-AUDIT fix: لا تعرض رسالة الخطأ الخام — اعرض رسالة عربية منسقة
        const rawNote = json.note || json.error || '';
        if (rawNote.includes('no intraday data') || rawNote.includes('no data')) {
          setError(`لا توجد بيانات لحظية لسهم ${ticker} — قد تكون الجلسة مغلقة أو البيانات غير متوفرة`);
        } else {
          setError(rawNote || 'تعذّر جلب البيانات');
        }
        setData(null);
        return;
      }
      setData(json);
    } catch (e) {
      setError('تعذّر الاتصال بالخادم. يرجى المحاولة مرة أخرى.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ticker, period]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSearch = () => {
    const t = tickerInput.trim().toUpperCase();
    if (t && t !== ticker) {
      setTicker(t);
    }
  };

  const session = data?.session_summary;
  const buyPressure = session?.buy_pressure_pct ?? 0;
  const interpretation: { label: string; tone: 'buy' | 'sell' | 'neutral' } = buyPressure > 55
    ? { label: 'ضغط شرائي', tone: 'buy' }
    : buyPressure < 45
    ? { label: 'ضغط بيعي', tone: 'sell' }
    : { label: 'متوازن', tone: 'neutral' };

  return (
    <Card dir="rtl" className="w-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2">
            <Gauge className="w-4 h-4 text-purple-500" />
            ضغط الشراء/البيع داخل الجلسة
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Input
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
              placeholder="الرمز"
              className="h-7 w-20 sm:w-24 text-xs"
              aria-label="رمز السهم"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2"
              onClick={handleSearch}
              aria-label="بحث"
            >
              <Search className="w-3.5 h-3.5" />
            </Button>
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
              <SelectTrigger className="h-7 w-[110px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5min">{PERIOD_LABEL['5min']}</SelectItem>
                <SelectItem value="15min">{PERIOD_LABEL['15min']}</SelectItem>
                <SelectItem value="30min">{PERIOD_LABEL['30min']}</SelectItem>
                <SelectItem value="1h">{PERIOD_LABEL['1h']}</SelectItem>
                <SelectItem value="session">{PERIOD_LABEL['session']}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        ) : error || !data || !data.session_summary ? (
          <div className="text-center text-xs py-6 space-y-2">
            {error ? (
              <div className="flex flex-col items-center gap-1">
                <span className="text-amber-600 dark:text-amber-400 text-sm">⚠️ {error}</span>
                <Button variant="outline" size="sm" className="h-6 text-[10px] mt-1" onClick={loadData}>
                  إعادة المحاولة
                </Button>
              </div>
            ) : data?.note ? (
              <span className="text-amber-600 dark:text-amber-400">{data.note}</span>
            ) : (
              <span className="text-muted-foreground">لا توجد بيانات تداول داخل الجلسة لهذا السهم</span>
            )}
          </div>
        ) : (
          <>
            {/* Header strip */}
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <Badge variant="outline" className="text-[10px] font-sans">{data.ticker}</Badge>
              {data.date && <Badge variant="outline" className="text-[10px]">{data.date}</Badge>}
              <Badge variant="outline" className="text-[10px]">{PERIOD_LABEL[data.period as PeriodKey]}</Badge>
              <Badge
                className={cn(
                  'text-[10px]',
                  interpretation.tone === 'buy'
                    ? 'bg-emerald-500/10 text-primary dark:text-primary border-emerald-500/30/30'
                    : interpretation.tone === 'sell'
                    ? 'bg-rose-500/10 text-rose-400 dark:text-rose-400 border-rose-500/30/30'
                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30'
                )}
              >
                {interpretation.tone === 'buy' ? <TrendingUp className="w-3 h-3 ml-1" /> :
                  interpretation.tone === 'sell' ? <TrendingDown className="w-3 h-3 ml-1" /> :
                  <Scale className="w-3 h-3 ml-1" />}
                {interpretation.label}
              </Badge>
            </div>

            {/* Session summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
              <SummaryCell
                label="الضغط الصافي"
                value={`${session!.net_pressure > 0 ? '+' : ''}${formatNumber(session!.net_pressure)}`}
                tone={session!.net_pressure > 0 ? 'pos' : session!.net_pressure < 0 ? 'neg' : 'neutral'}
              />
              <SummaryCell
                label="شراء : بيع"
                value={session!.buy_sell_ratio != null ? session!.buy_sell_ratio.toFixed(2) : '—'}
                tone={session!.buy_sell_ratio != null && session!.buy_sell_ratio > 1 ? 'pos' : session!.buy_sell_ratio != null && session!.buy_sell_ratio < 1 ? 'neg' : 'neutral'}
              />
              <SummaryCell label="VWAP الجلسة" value={(session!.session_vwap ?? 0).toFixed(2)} />
              <SummaryCell label="الافتتاح" value={(session!.session_open ?? 0).toFixed(2)} />
              <SummaryCell label="الإغلاق" value={(session!.session_close ?? 0).toFixed(2)} tone={(session!.session_close ?? 0) >= (session!.session_open ?? 0) ? 'pos' : 'neg'} />
              <SummaryCell label="أعلى / أدنى" value={`${(session!.session_high ?? 0).toFixed(2)} / ${(session!.session_low ?? 0).toFixed(2)}`} />
            </div>

            {/* Buy/Sell pressure bars per bucket — Face-to-Face (Diverging Bars) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-purple-500" />
                  <span className="text-xs font-semibold">الضغط عبر الوقت</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-sm bg-rose-500/70" /> بيع
                  </span>
                  <span className="text-muted-foreground/50">|</span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500/70" /> شراء
                  </span>
                </div>
              </div>

              {data.buckets.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-6">
                  لا توجد باكتات زمنية في هذه الجلسة
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto rounded-md border border-border/60 bg-secondary/10 pr-1
                                [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent
                                [&::-webkit-scrollbar-thumb]:bg-border/60 [&::-webkit-scrollbar-thumb]:rounded-full">
                  {data.buckets.map((b, idx) => {
                    // T-ALPHA-A8: Face-to-Face / Diverging Bars — buy grows RIGHT (green), sell grows LEFT (red)
                    const maxVol = Math.max(...data.buckets.map(bk => Math.max(bk.buy_volume, bk.sell_volume, 1)));
                    const buyWidthPct = maxVol > 0 ? (b.buy_volume / maxVol) * 50 : 0;
                    const sellWidthPct = maxVol > 0 ? (b.sell_volume / maxVol) * 50 : 0;
                    const netTone = b.net_pressure > 0 ? 'pos' : b.net_pressure < 0 ? 'neg' : 'neutral';
                    return (
                      <div
                        key={b.bucket_start + idx}
                        className="flex items-center gap-1 py-1.5 px-2 border-b border-border/60 last:border-0 hover:bg-secondary/30"
                      >
                        <div className="text-[10px] text-muted-foreground w-10 flex-shrink-0 font-mono" title={b.bucket_start}>
                          {b.time_label}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                          {/* Diverging bars — sell LEFT (red), buy RIGHT (green), center divider */}
                          <div className="flex h-3 w-full items-center gap-px">
                            <div className="flex-1 flex justify-end">
                              <div
                                className="bg-rose-500/70 transition-all h-full rounded-l-sm"
                                style={{ width: `${sellWidthPct * 2}%` }}
                                title={`بيع: ${formatNumber(b.sell_volume)} حصة`}
                              />
                            </div>
                            <div className="w-px h-full bg-border/60 flex-shrink-0" />
                            <div className="flex-1 flex justify-start">
                              <div
                                className="bg-emerald-500/70 transition-all h-full rounded-r-sm"
                                style={{ width: `${buyWidthPct * 2}%` }}
                                title={`شراء: ${formatNumber(b.buy_volume)} حصة`}
                              />
                            </div>
                          </div>
                          <div className="text-[8px] sm:text-[9px] text-muted-foreground flex items-center justify-between overflow-hidden">
                            <span className="text-rose-400/80 font-mono">{formatNumber(b.sell_volume)}</span>
                            <span className="font-mono">{formatNumber(b.total_volume)} حصة</span>
                            <span className="text-primary/80 font-mono">{formatNumber(b.buy_volume)}</span>
                          </div>
                        </div>
                        <div
                          className={cn(
                            'text-[10px] font-bold w-14 text-left whitespace-nowrap',
                            netTone === 'pos' ? 'text-primary dark:text-primary' :
                            netTone === 'neg' ? 'text-rose-400 dark:text-rose-400' : 'text-muted-foreground'
                          )}
                          title="الضغط الصافي (شراء - بيع)"
                        >
                          {b.net_pressure > 0 ? '+' : ''}
                          {formatNumber(b.net_pressure)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* T-ALPHA-A8: Cumulative Net Pressure Curve — Smooth Bezier + Dual-Tone Gradient */}
            {data.buckets.length > 1 && (() => {
              const buckets = data.buckets;
              const cumulative: number[] = [];
              let runningSum = 0;
              for (const b of buckets) {
                runningSum += Number(b.net_pressure) || 0;
                cumulative.push(runningSum);
              }
              const width = 320;
              const height = 80;
              const padding = 10;
              const n = cumulative.length;
              if (n < 2) return null;
              const maxVal = Math.max(...cumulative, 0);
              const minVal = Math.min(...cumulative, 0);
              const range = maxVal - minVal || 1;
              const points = cumulative.map((val, i) => ({
                x: padding + (i / (n - 1)) * (width - 2 * padding),
                y: padding + ((maxVal - val) / range) * (height - 2 * padding),
              }));
              // T-ALPHA-A8: Smooth Bezier curve (Catmull-Rom → Cubic Bezier)
              const bezierPath = points.length < 2 ? '' : points.reduce((acc, p, i, arr) => {
                if (i === 0) return `M ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
                const prev = arr[i - 1];
                const cp1x = prev.x + (p.x - prev.x) / 3;
                const cp1y = prev.y;
                const cp2x = prev.x + (p.x - prev.x) * 2 / 3;
                const cp2y = p.y;
                return `${acc} C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
              }, '');
              const zeroY = padding + (maxVal / range) * (height - 2 * padding);
              const isPositiveTrend = cumulative[n - 1] >= 0;
              const areaPath = `${bezierPath} L ${(width - padding).toFixed(1)},${zeroY.toFixed(1)} L ${padding.toFixed(1)},${zeroY.toFixed(1)} Z`;
              // T-ALPHA-A8: Dual-Tone Gradient — green for positive, red for negative
              const gradientId = 'cumulative-gradient';
              return (
                <div className="rounded-md border border-border/60 bg-secondary/10 p-2 overflow-hidden">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <Activity className="w-3 h-3 text-purple-500" />
                      <span className="text-[11px] font-semibold">منحنى الضغط التراكمي</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[9px]">
                      <span className={cn('font-bold', isPositiveTrend ? 'text-primary' : 'text-rose-400')}>
                        {isPositiveTrend ? '▲ تجميع' : '▼ تصريف'}
                      </span>
                      <span className="text-muted-foreground font-mono">
                        ({cumulative[0] >= 0 ? '+' : ''}{formatNumber(cumulative[0])} → {cumulative[n - 1] >= 0 ? '+' : ''}{formatNumber(cumulative[n - 1])})
                      </span>
                    </div>
                  </div>
                  <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label={`منحنى الضغط التراكمي: ${isPositiveTrend ? 'صاعد تجميعي' : 'هابط تصريفي'}`}>
                    <defs>
                      {/* T-ALPHA-A8: Dual-Tone Gradient (green→red or red→green based on trend) */}
                      <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                        {isPositiveTrend ? (
                          <>
                            <stop offset="0%" stopColor="rgba(239, 68, 68, 0.2)" />
                            <stop offset="50%" stopColor="rgba(245, 158, 11, 0.15)" />
                            <stop offset="100%" stopColor="rgba(16, 185, 129, 0.3)" />
                          </>
                        ) : (
                          <>
                            <stop offset="0%" stopColor="rgba(16, 185, 129, 0.2)" />
                            <stop offset="50%" stopColor="rgba(245, 158, 11, 0.15)" />
                            <stop offset="100%" stopColor="rgba(239, 68, 68, 0.3)" />
                          </>
                        )}
                      </linearGradient>
                    </defs>
                    {/* Zero line */}
                    <line x1={padding} y1={zeroY} x2={width - padding} y2={zeroY} stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 3" className="text-muted-foreground/40" />
                    {/* Area fill with dual-tone gradient */}
                    <path d={areaPath} fill={`url(#${gradientId})`} />
                    {/* T-ALPHA-A8: Smooth Bezier curve */}
                    <path d={bezierPath} fill="none" stroke={isPositiveTrend ? '#10b981' : '#ef4444'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                    {/* Start point */}
                    <circle cx={points[0].x} cy={points[0].y} r="2" className="fill-muted-foreground" />
                    {/* End point */}
                    <circle cx={points[n - 1].x} cy={points[n - 1].y} r="2.5" fill={isPositiveTrend ? '#10b981' : '#ef4444'} />
                  </svg>
                  <div className="flex items-center justify-between text-[9px] text-muted-foreground mt-0.5">
                    <span>{buckets[0]?.time_label ?? ''}</span>
                    <span className="font-mono">صافي تراكمي: {cumulative[n - 1] >= 0 ? '+' : ''}{formatNumber(cumulative[n - 1])}</span>
                    <span>{buckets[n - 1]?.time_label ?? ''}</span>
                  </div>
                </div>
              );
            })()}

            {/* Volume totals */}
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div className="rounded-md bg-emerald-500/5 border border-emerald-500/30/20 p-2">
                <div className="text-[10px] text-muted-foreground">إجمالي شراء</div>
                <div className="font-bold text-primary dark:text-primary">{formatNumber(session!.total_buy_volume)}</div>
              </div>
              <div className="rounded-md bg-amber-500/5 border border-amber-500/20 p-2">
                <div className="text-[10px] text-muted-foreground">محايد</div>
                <div className="font-bold text-amber-600 dark:text-amber-400">{formatNumber(session!.total_neutral_volume)}</div>
              </div>
              <div className="rounded-md bg-rose-500/5 border border-rose-500/30/20 p-2">
                <div className="text-[10px] text-muted-foreground">إجمالي بيع</div>
                <div className="font-bold text-rose-400 dark:text-rose-400">{formatNumber(session!.total_sell_volume)}</div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryCell({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'pos' | 'neg' | 'neutral';
}) {
  return (
    <div className="rounded-md bg-secondary/40 p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-sm font-bold',
          tone === 'pos' ? 'text-primary dark:text-primary' :
          tone === 'neg' ? 'text-rose-400 dark:text-rose-400' : ''
        )}
      >
        {value}
      </div>
    </div>
  );
}
