'use client';

// MAESTRO-DISABLED (Task PHASE-2-MAESTRO-KILL, Rule 73)
// No `/api/maestro/*` calls in this file. Uses /api/stored-analysis/*,
// /api/market/morning-bell, /api/stored-analysis/live-tracking instead.
// The single `item.maestroScore` reference is a property name mapping to the
// `maestro_score` DB column (stored_analyses). Left intact per Rule 4 (NO-DELETION).

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import {
 TrendingUp, TrendingDown, Clock, Calendar,
 BarChart3, Target, AlertTriangle, CheckCircle,
 Activity, ArrowUpRight, ArrowDownRight, Info,
 RefreshCw, Moon, Copy, Share2, ShieldCheck, ShieldX, Crosshair, Gauge, Facebook, ArrowRight, ArrowLeft,
 Bitcoin, Zap, Download, Image as ImageIcon, FileText, Camera, Loader2, X, Layers, Send
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { Radio, Radar } from 'lucide-react';
import {
 ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
 XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { cn, getRRVerdict, getStockRiskAlert, safeToFixed, verdictStyle, computeRR, rrColor, scoreColor, fmtPrice, formatNumber } from '@/lib/utils';
import { useAppStore, MARKET_NAMES_AR, MARKET_CURRENCY_LABEL, MarketType } from '@/lib/store';
import { useAnalysisStore } from '@/lib/analysis-store';
import { toast } from 'sonner';
import { OFFICIAL_LINKS_BLOCK, OFFICIAL_LINKS } from '@/modules/publishing/lib/official-links';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog';

import { isBuySignalLabel, isSellSignalLabel } from '@/lib/signal-utils';
import { PersonaImageCard, PersonaPick } from '@/components/market/PersonaImageCard';
import { ExpertPredictionsImageCard } from '@/components/market/ExpertPredictionsImageCard';
import { PredictionsImageCard } from '@/components/market/PredictionsImageCard';
import { ImageCardExport } from '@/components/market/ImageCardExport';
import { MarketStatusExport } from '@/components/market/MarketStatusExport';
import { MarketSelector } from '@/components/shared/MarketSelector';
import { RefreshAnalyticsButton } from '@/components/recommendations/RefreshAnalyticsButton';
import { ExpertRecommendationsPanel } from '@/modules/market-analysis/components/ExpertRecommendationsPanel';
import { ExpertIntelligencePanel } from '@/components/shared/ExpertIntelligencePanel';
import { DailyPicksPoster } from '@/components/daily-picks/DailyPicksPoster';
import type {
 StockData,
 LifecycleStatus,
 StatusBadgeStyle,
 PreviousPrediction,
 PersonaData,
 AnalysisJson,
 StoredAnalysisItem,
 NameMap,
 CryptoPrediction,
 CryptoPredictionsResponse,
 SectorTrackingStock,
 SectorTrackingEntry,
 SectorTrackingResponse,
 SectorSortField,
 SectorStockSortField,
 MorningBellStock,
 PredictionRow,
} from './types';
import {
 pickValidPrice,
 getStatusBadge,
 pnlColorClass,
 formatPnl,
 formatChangePct,
 formatDateShort,
 mapPredictionToStockData,
 MARKET_CODES,
 isMarketClosedNow,
 getNextTradingDay,
 formatDateLabel,
 formatAllPredictionsText,
 formatSinglePredictionText,
 formatSinglePersonaPickText,
 formatAllPersonaPicksText,
 formatComprehensiveStockText,
 formatSingleExpertPredictionText,
 formatAllExpertPredictionsText,
 isTraderPrediction,
 evalPrediction,
 buildNameMap,
 enrichItems,
 pickPersonaMix,
 pickPersonaDiverged,
 getVerdictColor,
 getScoreColor,
 PERSONA_DISPLAY_LIMIT,
 PERSONA_PAGE_SIZE,
 usdCurrencyFmt,
 arDateTimeFmt,
 cryptoSignalStyle,
 cryptoSignalLabelAr,
 cryptoSymbolMeta,
 HEAT_LEVEL_STYLE,
 formatVolumeShort,
 formatEGPShort,
 avgChangeHeatClass,
 stockChangeHeatClass,
 _isEgxIntradayNow,
} from './helpers';


export function HorizontalSectorsBar({ marketCode }: { marketCode: string }) {
 const [sectors, setSectors] = useState<any[]>([]);

 useEffect(() => {
 let cancelled = false;
 (async () => {
 try {
 const res = await fetch(`/api/stored-analysis/results?market=${marketCode}&limit=10`, { cache: 'no-store' });
 if (res.ok) {
 const json = await res.json();
 if (!cancelled && json.meta?.sectorSummary) {
 setSectors(json.meta.sectorSummary);
 }
 }
 } catch (e) {
 console.warn('[HorizontalSectorsBar] fetch failed', e);
 }
 })();
 return () => { cancelled = true; };
 }, [marketCode]);

 if (sectors.length === 0) return null;

 return (
 <div className="flex items-center gap-2 p-2 rounded-xl bg-card/80 border border-border/80 overflow-x-auto no-scrollbar shadow-sm my-1.5">
 <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-whale/10 text-whale font-bold text-xs flex-shrink-0 border border-whale/20">
 <Layers className="w-4 h-4 text-whale" />
 <span>ذكاء القطاعات</span>
 <Badge variant="secondary" className="text-xs px-1 py-0">{sectors.length}</Badge>
 </div>

 <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
 {sectors.map((s: any) => (
 <div
 key={s.sector}
 className={cn(
 'px-2.5 py-1 rounded-lg border text-xs font-medium flex items-center gap-1.5 flex-shrink-0 transition-all hover:scale-105',
 s.status === 'hot'
 ? 'border-orange-500/30 bg-warning/10 text-warning '
 : s.status === 'dead'
 ? 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300'
 : 'border-border bg-muted/40 text-foreground'
 )}
 >
 <span>{s.status === 'hot' ? '🔥' : s.status === 'dead' ? '❄️' : '📊'}</span>
 <span className="font-bold">{s.sector}</span>
 <span className={cn('font-mono text-xs', s.avg_chg > 0 ? 'text-profit font-bold' : s.avg_chg < 0 ? 'text-loss font-bold' : 'text-muted-foreground')}>
 {s.avg_chg > 0 ? '+' : ''}{(s.avg_chg ?? 0).toFixed(1)}%
 </span>
 {s.top_leader && (
 <span className="text-xs px-1 rounded bg-profit/20 text-profit font-bold">
 👑 {s.top_leader}
 </span>
 )}
 </div>
 ))}
 </div>
 </div>
 );
}


export function MorningBellSection({ marketCode }: { marketCode: string }) {
 const [stocks, setStocks] = useState<MorningBellStock[]>([]);
 const [loading, setLoading] = useState(true);
 const [label, setLabel] = useState('');
 const [marketStatus, setMarketStatus] = useState<'live' | 'closed'>('closed');
 const [isLive, setIsLive] = useState(false);
 const [refreshMin, setRefreshMin] = useState(15);
 const [cacheAge, setCacheAge] = useState<number | null>(null);
 const [vetoed, setVetoed] = useState(false);
 const [noteAr, setNoteAr] = useState('');

 useEffect(() => {
 // الجرس ده EGX-only — باقي الأسواق مش ليها جلسة صباحية مصرية
 if (marketCode !== 'EGX') {
 setStocks([]);
 setLoading(false);
 return;
 }
 let cancelled = false;
 setLoading(true);
 (async () => {
 try {
 // P41: جرّب الـ Live Morning Bell أولاً (RVOL + continuation)
 const liveRes = await fetch(`/api/market/morning-bell?live=1&limit=5`, { cache: 'no-store' });
 if (liveRes.ok) {
 const json = await liveRes.json();
 if (cancelled) return;
 if (json.success !== false && Array.isArray(json.stocks) && json.stocks.length > 0) {
 // خريطة الـ live picks للـ interface
 const mapped: MorningBellStock[] = json.stocks.map((s: any) => ({
 ticker: String(s.ticker || ''),
 name_ar: s.name_ar || s.ticker,
 signal: s.signal || 'morning_bell_buy',
 signal_ar: s.signal_ar || '🔔 شراء جرس الصباح',
 entry: Number(s.price ?? s.entry ?? 0),
 target: Number(s.suggested_tp1 ?? s.target ?? 0),
 stop: Number(s.suggested_stop ?? s.stop ?? 0),
 risk_reward: 0,
 score: Number(s.composite_score ?? s.confidence ?? 85),
 ath_breakout: false,
 delay_compensation_applied: false,
 updated_at: s.updated_at,
 price: Number(s.price ?? 0),
 rvol: Number(s.rvol ?? 0),
 extension_pct_day: Number(s.extension_pct_day ?? 0),
 volume: Number(s.volume ?? 0),
 continuation_state: s.continuation_state,
 prob_continue_up: Number(s.prob_continue_up ?? 0),
 prob_mild_pullback: Number(s.prob_mild_pullback ?? 0),
 prob_sharp_drop: Number(s.prob_sharp_drop ?? 0),
 suggested_tp1: Number(s.suggested_tp1 ?? 0),
 suggested_tp2: Number(s.suggested_tp2 ?? 0),
 suggested_stop: Number(s.suggested_stop ?? 0),
 risk_flag: s.risk_flag,
 client_responsibility_required: Boolean(s.client_responsibility_required),
 composite_score: Number(s.composite_score ?? 0),
 confidence: Number(s.confidence ?? 0),
 momentum_alive: Boolean(s.momentum_alive),
 trajectory: s.trajectory,
 plain_ar_warning: s.plain_ar_warning,
 reason_ar: s.reason_ar,
 }));
 setStocks(mapped);
 setLabel(json.label_ar || `🔔 جرس الصباح (${mapped.length})`);
 setMarketStatus(json.market_status === 'live' ? 'live' : 'closed');
 setIsLive(true);
 setRefreshMin(Number(json.refresh_interval_minutes ?? 15));
 setCacheAge(Number(json.cache_age_seconds ?? 0) || null);
 setVetoed(Boolean(json.market_vetoed));
 setNoteAr(json.note_ar || json.veto_reason || '');
 setLoading(false);
 return;
 }
 // لو الـ live مفيهوش picks (سوق مقفول/فيتو) — اعرض الحالة
 if (json.market_status === 'closed' || json.market_vetoed) {
 setStocks([]);
 setLabel(json.label_ar || '🔔 جرس الصباح');
 setMarketStatus(json.market_status === 'live' ? 'live' : 'closed');
 setIsLive(false);
 setVetoed(Boolean(json.market_vetoed));
 setNoteAr(json.note_ar || json.veto_reason || '');
 setLoading(false);
 return;
 }
 }

 // Fallback للـ static (stored-analysis) لو الـ live فشل
 let rawItems: any[] = [];
 const res = await fetch(`/api/stored-analysis/results?market=EGX&limit=15`, { cache: 'no-store' });
 if (res.ok) {
 const json2 = await res.json();
 if (json2.success !== false && Array.isArray(json2.data)) rawItems = json2.data;
 }
 if (rawItems.length < 3) {
 try {
 const ltRes = await fetch(`/api/stored-analysis/live-tracking?market=EGX&days=30&limit=20`, { cache: 'no-store' });
 if (ltRes.ok) {
 const ltJson = await ltRes.json();
 if (ltJson?.predictions) {
 Object.values(ltJson.predictions).forEach((arr: any) => {
 if (Array.isArray(arr)) rawItems.push(...arr);
 });
 }
 }
 } catch {}
 }
 if (cancelled) return;
 const seen = new Set<string>();
 const mapped: MorningBellStock[] = [];
 for (const item of rawItems) {
 const rawTicker = String(item.ticker || '').replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
 if (!rawTicker || seen.has(rawTicker)) continue;
 seen.add(rawTicker);
 mapped.push({
 ticker: rawTicker,
 name_ar: item.nameAr || item.name || item.name_ar || rawTicker,
 signal: String(item.recommendation || item.signal || 'BUY'),
 signal_ar: item.recommendationAr || (item.signal === 'STRONG_BUY' ? 'شراء قوي 🔥' : 'شراء 🟢'),
 entry: Number(item.entry?.price ?? item.entryPrice ?? item.currentPrice ?? 0),
 target: Number(item.entry?.target ?? item.targetPrice ?? 0),
 stop: Number(item.entry?.stopLoss ?? item.stopLoss ?? 0),
 risk_reward: Number(item.entry?.riskReward ?? 1.5),
 score: Number(item.maestroScore ?? item.confidence ?? 85),
 ath_breakout: false,
 delay_compensation_applied: Boolean(item.entry?.delayCompensation || false),
 updated_at: item.updatedAt || item.created_at,
 });
 if (mapped.length >= 5) break;
 }
 setStocks(mapped);
 setLabel(`أعلى ${mapped.length} فرص صباحية (static) 🍇`);
 setMarketStatus(mapped.length > 0 ? 'live' : 'closed');
 setIsLive(false);
 } catch (e) {
 console.warn('[MorningBell] fetch failed', e);
 } finally {
 if (!cancelled) setLoading(false);
 }
 })();
 return () => { cancelled = true; };
 }, [marketCode]);

 if (marketCode !== 'EGX') return null;

 if (loading) {
 return (
 <section className="grid gap-3" aria-label="Morning Bell">
 <Skeleton className="h-28" />
 </section>
 );
 }

 const contStateColor: Record<string, string> = {
 continuing: 'bg-profit text-profit/40 ',
 weakening: 'bg-warning text-warning/40 ',
 exhausted: 'bg-loss text-loss/40 ',
 };
 const contStateAr: Record<string, string> = {
 continuing: 'مستمرة',
 weakening: 'تضعف',
 exhausted: 'منتهية',
 };

 return (
 <section className="space-y-2" aria-label="Morning Bell">
 <div className="flex items-center gap-2 flex-wrap">
 <h3 className="text-base font-bold flex items-center gap-1.5">
 <span aria-hidden>🔔</span>
 <span>جرس الصباح</span>
 </h3>
 <Badge className="text-xs font-semibold border-0 bg-primary/10 text-primary">{label}</Badge>
 {marketStatus === 'live' && stocks.length > 0 && (
 <Badge className="text-xs font-semibold border-0 bg-profit text-profit/40 ">● مباشر</Badge>
 )}
 {isLive && stocks.length > 0 && (
 <Badge className="text-xs font-semibold border-0 bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-300" title={`دورة تجديد كل ${refreshMin} دقيقة`}>
 تجديد {refreshMin}د
 {cacheAge !== null && <span className="opacity-70"> · {Math.floor(cacheAge / 60)}د مضت</span>}
 </Badge>
 )}
 {vetoed && (
 <Badge className="text-xs font-semibold border-0 bg-loss text-loss/40 ">🛡️ كاش</Badge>
 )}
 </div>

 {noteAr && (
 <p className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1.5">{noteAr}</p>
 )}

 {stocks.length === 0 ? (
 <p className="text-xs text-muted-foreground">لا توجد فرص متاحة حالياً.</p>
 ) : (
 <>
 {/* تحذير مسؤولية العميل */}
 <div className="text-xs bg-warning/10 border border-warning rounded px-2 py-1.5 text-warning ">
 ⚠️ جرس الصباح = مخاطر عالية على مسؤولية العميل. استخدم الوقف. الخسارة بعد تجاهل خطة الخروج لا تُحسب على أداء المسار المنضبط.
 </div>
 <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
 {stocks.map((s, idx) => (
 <Card
 key={s.ticker}
 className={cn(
 'overflow-hidden border transition-shadow hover:shadow-md flex flex-col',
 s.risk_flag === 'extreme_north'
 ? 'border-loss bg-loss/10 /10'
 : s.continuation_state === 'continuing'
 ? 'border-profit bg-profit/10 /10'
 : 'border-border'
 )}
 >
 <CardHeader className="pb-2 pt-3 px-3">
 <div className="flex items-start justify-between gap-2">
 <div className="min-w-0">
 <div className="flex items-center gap-1.5 flex-wrap">
 <span className="font-mono text-sm font-bold">{s.ticker}</span>
 {idx === 0 && <Badge className="text-xs font-bold border-0 bg-warning text-warning ">#1</Badge>}
 {s.rvol !== undefined && s.rvol >= 1.5 && (
 <Badge className="text-xs font-bold border-0 bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-300" title="Relative Volume — حجم غير عادي">
 RVOL ×{safeToFixed(s.rvol, 1)}
 </Badge>
 )}
 </div>
 <p className="text-xs text-muted-foreground truncate mt-0.5">{s.name_ar}</p>
 </div>
 <div className="flex flex-col items-end gap-1 shrink-0">
 <Badge className={cn('text-xs font-bold border-0', s.signal === 'strong_buy' ? 'bg-profit text-white' : 'bg-profit text-profit/40 ')}>
 {s.signal_ar}
 </Badge>
 {s.continuation_state && (
 <Badge className={cn('text-xs font-semibold border-0', contStateColor[s.continuation_state] || 'bg-muted')}>
 {contStateAr[s.continuation_state] || s.continuation_state}
 </Badge>
 )}
 </div>
 </div>
 </CardHeader>
 <CardContent className="px-3 pb-3 pt-0 space-y-1.5 flex-1">
 {/* السعر + الامتداد */}
 {s.price !== undefined && s.price > 0 && (
 <div className="flex items-center justify-between text-xs">
 <span className="text-muted-foreground">السعر:</span>
 <span className="font-mono font-bold">{fmtPrice(s.price)}</span>
 {s.extension_pct_day !== undefined && (
 <span className={cn('font-mono font-semibold', s.extension_pct_day >= 0 ? 'text-profit ' : 'text-loss ')}>
 {s.extension_pct_day >= 0 ? '+' : ''}{safeToFixed(s.extension_pct_day, 2)}%
 </span>
 )}
 </div>
 )}
 {/* TP1 / TP2 / Stop */}
 <div className="grid grid-cols-3 gap-1 text-center text-xs">
 <div className="rounded bg-profit/10 py-1">
 <div className="text-xs text-profit ">TP1</div>
 <div className="font-mono font-semibold text-profit ">{fmtPrice(s.suggested_tp1 ?? s.target)}</div>
 </div>
 <div className="rounded bg-profit/10 py-1">
 <div className="text-xs text-profit ">TP2</div>
 <div className="font-mono font-semibold text-profit ">{fmtPrice(s.suggested_tp2 ?? 0)}</div>
 </div>
 <div className="rounded bg-loss/10 py-1">
 <div className="text-xs text-loss ">وقف</div>
 <div className="font-mono font-semibold text-loss ">{fmtPrice(s.suggested_stop ?? s.stop)}</div>
 </div>
 </div>
 {/* الاحتمالات الثلاثة */}
 {s.prob_continue_up !== undefined && (
 <div className="space-y-0.5">
 <div className="flex items-center justify-between text-xs">
 <span className="text-profit ">صعود</span>
 <span className="font-mono font-semibold text-profit ">{safeToFixed(s.prob_continue_up! * 100, 0)}%</span>
 </div>
 <div className="flex items-center justify-between text-xs">
 <span className="text-warning ">ارتداد بسيط</span>
 <span className="font-mono font-semibold text-warning ">{safeToFixed((s.prob_mild_pullback ?? 0) * 100, 0)}%</span>
 </div>
 <div className="flex items-center justify-between text-xs">
 <span className="text-loss ">هبوط قوي</span>
 <span className="font-mono font-semibold text-loss ">{safeToFixed((s.prob_sharp_drop ?? 0) * 100, 0)}%</span>
 </div>
 </div>
 )}
 {/* الشارات */}
 <div className="flex items-center justify-between gap-1 flex-wrap pt-1">
 <span className="text-xs text-muted-foreground">
 {s.composite_score !== undefined ? `مركّب: ${safeToFixed(s.composite_score, 0)}` : `R/R: ${s.risk_reward || '—'}`}
 {s.score !== undefined && s.composite_score === undefined && ` · نقاط: ${s.score}`}
 </span>
 <div className="flex items-center gap-1 flex-wrap">
 {s.risk_flag === 'extreme_north' && (
 <Badge className="text-xs font-semibold border-0 bg-loss text-loss/40 " title="أسهم الشمال — مخاطر عالية جداً">🔴 شمال</Badge>
 )}
 {s.delay_compensation_applied && (
 <Badge className="text-xs font-semibold border-0 cursor-help bg-warning text-warning "
 onClick={() => toast.info('⚠️ تعويض تأخير البيانات', { description: 'تم توسيع الهدف (+5%) وتضييق وقف الخسارة (-15%) لحماية صفقتك.', duration: 6000 })}>
 ⚠️ تعويض
 </Badge>
 )}
 </div>
 </div>
 </CardContent>
 </Card>
 ))}
 </div>
 </>
 )}
 </section>
 );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * 🔥 v3.66.9: فحص جلسة EGX الحالية (client-side).
 * مطابق لمنطق Python `_is_egx_intraday_now()` في stored_analysis_routes.py.
 * EGX hours: الأحد-الخميس، 10:00-14:30 توقيت القاهرة (Africa/Cairo).
 */
