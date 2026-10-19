'use client';

/**
 * MarketDepthPanel — ضغط الشراء/البيع داخل الجلسة
 * ==================================================
 * بما إن مفيش جدول order_book فعلي في الـ DB، البانل ده بيعرض تحليل حقيقي
 * لضغط الشراء مقابل البيع على مدار الجلسة من بيانات stock_intraday اللحظية:
 * - لكل فترة زمنية (5/15/30 دقيقة أو ساعة): حجم الشراء vs حجم البيع
 * - صافي الضغط (net pressure)
 * - VWAP + open/close/high/low للجلسة
 * - تفسير تلقائي: ضغط شرائي / بيعي / متوازن
 *
 * مصدر البيانات: /api/market/intraday-pressure (intraday.db.stock_intraday)
 * - مفيش أي mock data.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Activity, TrendingUp, TrendingDown, Loader2, Gauge } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Bucket {
 time_label: string;
 buy_volume: number;
 sell_volume: number;
 neutral_volume: number;
 total_volume: number;
 buy_pressure_pct: number;
 sell_pressure_pct: number;
 net_pressure: number;
 vwap: number;
 tick_count: number;
}

interface SessionSummary {
 total_buy_volume: number;
 total_sell_volume: number;
 total_neutral_volume: number;
 total_volume: number;
 net_pressure: number;
 buy_pressure_pct: number;
 sell_pressure_pct: number;
 buy_sell_ratio: number;
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
 date: string;
 buckets: Bucket[];
 session_summary: SessionSummary;
}

const PERIOD_OPTIONS = [
 { value: '5min', label: '5 دقائق' },
 { value: '15min', label: '15 دقيقة' },
 { value: '30min', label: '30 دقيقة' },
 { value: '1h', label: 'ساعة' },
];

function fmtVol(n: number): string {
 const abs = Math.abs(n);
 if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
 if (abs >= 1_000) return (n / 1_000).toFixed(0) + 'K';
 return (n ?? 0).toFixed(0);
}

export function MarketDepthPanel({ initialTicker = 'COMI' }: { initialTicker?: string }) {
 const [ticker, setTicker] = useState(initialTicker);
 const [period, setPeriod] = useState('15min');
 const [loading, setLoading] = useState(false);
 const [data, setData] = useState<PressureData | null>(null);

 const loadDepth = useCallback(async () => {
 if (!ticker.trim()) return;
 setLoading(true);
 try {
 const res = await fetch(
 `/api/market/intraday-pressure?ticker=${encodeURIComponent(ticker.toUpperCase())}&period=${period}`
 );
 const json = (await res.json()) as PressureData;
 if (json.success) {
 setData(json);
 } else {
 setData(null);
 }
 } catch {
 setData(null);
 } finally {
 setLoading(false);
 }
 }, [ticker, period]);

 useEffect(() => {
 loadDepth();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [loadDepth]);

 // Update ticker when parent changes initialTicker
 useEffect(() => {
 setTicker(initialTicker);
 }, [initialTicker]);

 const summary = data?.session_summary;
 const buyPct = summary?.buy_pressure_pct ?? 0;
 const sellPct = summary?.sell_pressure_pct ?? 0;

 // Interpretation
 let interpretation = { label: 'متوازن', color: 'text-slate-600 bg-slate-500/10 border-slate-500/30' };
 if (buyPct >= 60) interpretation = { label: 'ضغط شرائي قوي', color: 'text-profit bg-profit/15 border-profit/40 ' };
 else if (buyPct >= 55) interpretation = { label: 'ضغط شرائي', color: 'text-profit bg-profit/10 border-profit/30 ' };
 else if (sellPct >= 60) interpretation = { label: 'ضغط بيعي قوي', color: 'text-loss bg-loss/15 border-loss/40 ' };
 else if (sellPct >= 55) interpretation = { label: 'ضغط بيعي', color: 'text-loss bg-loss/10 border-loss/30 ' };

 return (
 <Card dir="rtl">
 <CardHeader className="pb-2">
 <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
 <Activity className="w-4 h-4 text-cyan-500" />
 ضغط الشراء/البيع داخل الجلسة
 <div className="flex gap-1 mr-auto items-center">
 <Input
 value={ticker}
 onChange={(e) => setTicker(e.target.value)}
 placeholder="السهم"
 className="w-20 h-7 text-xs"
 onKeyDown={(e) => e.key === 'Enter' && loadDepth()}
 />
 <Button size="sm" variant="outline" onClick={loadDepth} disabled={loading} className="h-7 px-2">
 {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'تحديث'}
 </Button>
 </div>
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 {/* Period selector */}
 <div className="flex gap-1 flex-wrap">
 {PERIOD_OPTIONS.map((opt) => (
 <Button
 key={opt.value}
 size="sm"
 variant={period === opt.value ? 'default' : 'outline'}
 className="h-6 px-2 text-xs"
 onClick={() => setPeriod(opt.value)}
 >
 {opt.label}
 </Button>
 ))}
 </div>

 {loading ? (
 <div className="flex items-center justify-center py-6">
 <Loader2 className="w-5 h-5 animate-spin text-cyan-500" />
 </div>
 ) : !data || !summary ? (
 <div className="text-center py-6 text-xs text-muted-foreground">
 لا توجد بيانات لحظية لهذا السهم
 </div>
 ) : (
 <>
 {/* Interpretation badge */}
 <div className="flex items-center justify-between">
 <Badge className={cn('text-xs border', interpretation.color)}>
 <Gauge className="w-3 h-3 ml-1" />
 {interpretation.label}
 </Badge>
 <span className="text-xs text-muted-foreground tabular-nums">
 {data.date ? new Date(data.date).toLocaleDateString('ar-EG') : ''}
 </span>
 </div>

 {/* Overall buy/sell pressure bar */}
 <div className="space-y-1">
 <div className="flex items-center justify-between text-xs">
 <span className="flex items-center gap-1 text-profit font-medium">
 <TrendingUp className="w-3 h-3" />
 شراء {(buyPct ?? 0).toFixed(1)}%
 </span>
 <span className="flex items-center gap-1 text-loss font-medium">
 بيع {(sellPct ?? 0).toFixed(1)}%
 <TrendingDown className="w-3 h-3" />
 </span>
 </div>
 <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
 <div className="bg-profit " style={{ width: `${buyPct}%` }} />
 <div className="bg-slate-300 dark:bg-slate-600" style={{ width: `${100 - buyPct - sellPct}%` }} />
 <div className="bg-loss " style={{ width: `${sellPct}%` }} />
 </div>
 <div className="flex items-center justify-between text-xs text-muted-foreground">
 <span className="tabular-nums">شراء: {fmtVol(summary.total_buy_volume)}</span>
 <span className={cn(
 'font-semibold tabular-nums',
 summary.net_pressure >= 0 ? 'text-profit' : 'text-loss'
 )}>
 صافي: {summary.net_pressure >= 0 ? '+' : ''}{fmtVol(summary.net_pressure)}
 </span>
 <span className="tabular-nums">بيع: {fmtVol(summary.total_sell_volume)}</span>
 </div>
 </div>

 {/* Timeline buckets */}
 <div className="space-y-1">
 <div className="text-xs font-semibold text-muted-foreground pb-1 border-b border-border/50">
 الجدول الزمني للجلسة
 </div>
 <div className="max-h-64 overflow-y-auto pr-1 -mr-1 custom-scrollbar space-y-1">
 {data.buckets.map((b, i) => {
 const buyW = b.total_volume > 0 ? (b.buy_volume / b.total_volume) * 100 : 0;
 const sellW = b.total_volume > 0 ? (b.sell_volume / b.total_volume) * 100 : 0;
 const netPos = b.net_pressure >= 0;
 return (
 <div key={i} className="space-y-0.5">
 <div className="flex items-center justify-between text-xs">
 <span className="font-medium tabular-nums">{b.time_label}</span>
 <span className={cn(
 'font-semibold tabular-nums',
 netPos ? 'text-profit' : b.net_pressure < 0 ? 'text-loss' : 'text-muted-foreground'
 )}>
 {netPos ? '+' : ''}{fmtVol(b.net_pressure)}
 </span>
 </div>
 <div className="flex h-2 w-full overflow-hidden rounded-sm bg-muted">
 <div className="bg-profit/70" style={{ width: `${buyW}%` }} />
 <div className="bg-slate-300/50 dark:bg-slate-600/50" style={{ width: `${100 - buyW - sellW}%` }} />
 <div className="bg-loss/70" style={{ width: `${sellW}%` }} />
 </div>
 </div>
 );
 })}
 {data.buckets.length === 0 && (
 <div className="text-xs text-muted-foreground py-2 text-center">
 لا توجد بيانات للفترة المحددة
 </div>
 )}
 </div>
 </div>

 {/* Session summary cards */}
 <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-border/50">
 <div className="text-center p-1.5 rounded bg-muted/30">
 <div className="text-xs text-muted-foreground">VWAP</div>
 <div className="text-xs font-bold tabular-nums">{summary.session_vwap?.toFixed(2) || '—'}</div>
 </div>
 <div className="text-center p-1.5 rounded bg-muted/30">
 <div className="text-xs text-muted-foreground">افتتاح</div>
 <div className="text-xs font-bold tabular-nums">{summary.session_open?.toFixed(2) || '—'}</div>
 </div>
 <div className="text-center p-1.5 rounded bg-muted/30">
 <div className="text-xs text-muted-foreground">إغلاق</div>
 <div className="text-xs font-bold tabular-nums">{summary.session_close?.toFixed(2) || '—'}</div>
 </div>
 <div className="text-center p-1.5 rounded bg-muted/30">
 <div className="text-xs text-muted-foreground">أعلى</div>
 <div className="text-xs font-bold tabular-nums text-profit">{summary.session_high?.toFixed(2) || '—'}</div>
 </div>
 <div className="text-center p-1.5 rounded bg-muted/30">
 <div className="text-xs text-muted-foreground">أدنى</div>
 <div className="text-xs font-bold tabular-nums text-loss">{summary.session_low?.toFixed(2) || '—'}</div>
 </div>
 <div className="text-center p-1.5 rounded bg-muted/30">
 <div className="text-xs text-muted-foreground">نسبة ش/ب</div>
 <div className="text-xs font-bold tabular-nums">{summary.buy_sell_ratio?.toFixed(2) || '—'}</div>
 </div>
 </div>
 </>
 )}
 </CardContent>
 </Card>
 );
}
