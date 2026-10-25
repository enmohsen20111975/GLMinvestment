'use client';

/**
 * ExpertIntelligencePanel
 * لوحة ذكاء المحلل الخبير — 3 طبقات على نفس البيانات:
 * 1) الفرص الضائعة والتوقعات الغلط (missed-opportunities)
 * 2) ذكاء القطاعات (sector-intelligence)
 * 3) الإجماع الخبير الموحّد (expert-consensus)
 *
 * مستخرجة من MaestroDashboard وعُملت component مستقل reusable
 * عشان تظهر في شاشة المتخصصين وشاشة التحليلات.
 *
 * Mobile-first 100%: كل النصوص sm: breakpoints، padding متدرّج، grids متاستة.
 * بدون ألوان indigo/blue — اللمسة الأساسية emerald/teal.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '@/components/ui/select';
import {
 AlertOctagon, AlertTriangle, Layers, Crosshair, Clock3,
 RefreshCw, Loader2, ThumbsDown, ThumbsUp, Trophy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UnifiedEmptyState } from '@/components/shared/ui';

// ==================== Types ====================

interface MissedOpportunity {
 summary?: {
 missed_bulls: number;
 false_positives: number;
 correct_buys: number;
 correct_sells: number;
 accuracy_rate_pct: number;
 avg_missed_gain_pct: number;
 avg_false_loss_pct: number;
 prices_fresh?: number;
 prices_stale?: number;
 };
 missed_bulls?: Array<{
 ticker: string; name?: string; sector?: string;
 signal: string; entry_price: number; current_price: number;
 pct_change: number; days_since_prediction: number;
 price_is_stale?: boolean;
 }>;
 false_positives?: Array<any>;
 correct_buys?: Array<any>;
 correct_sells?: Array<any>;
 success?: boolean;
}

interface SectorIntelligence {
 summary?: {
 market_breadth?: {
 market_mood?: string;
 sectors_up?: number;
 sectors_down?: number;
 total_sectors?: number;
 };
 best_sector?: { sector: string; avg_change_pct: number };
 worst_sector?: { sector: string; avg_change_pct: number };
 };
 sector_ranking?: Array<{
 sector: string; gainers: number; losers: number; total_stocks: number;
 avg_change_pct: number; top_gainer?: { ticker: string };
 prices_fresh_count?: number; prices_stale_count?: number;
 }>;
 top_outperformers?: Array<{
 ticker: string; sector: string;
 stock_change_pct: number; sector_avg_change_pct: number;
 relative_strength: number;
 }>;
 success?: boolean;
}

interface ConsensusItem {
 ticker: string;
 name?: string; sector?: string;
 verdict: string;
 confidence_pct: number;
 is_egx30?: boolean; is_egx100?: boolean;
 bullish_signals: number;
 bearish_signals: number;
 reasons?: string[];
 dissent?: string[];
 current_state?: {
 price?: number;
 change_pct?: number;
 rsi?: number;
 price_freshness_minutes?: number;
 price_is_stale?: boolean;
 };
 sector_context?: { relative_strength?: number };
}

interface ConsensusSummary {
 by_verdict?: Record<string, number>;
}

interface SingleConsensus {
 ticker: string;
 name?: string;
 verdict?: string;
 confidence_pct?: number;
 bullish_signals?: number;
 bearish_signals?: number;
 reasons?: string[];
 dissent?: string[];
 current_state?: {
 price_freshness_minutes?: number;
 };
 error?: string;
}

// ==================== Helper ====================

function verdictColor(v: string): string {
 if (v === 'STRONG_BUY') return 'bg-success';
 if (v === 'BUY') return 'bg-success';
 if (v === 'SELL') return 'bg-loss';
 if (v === 'STRONG_SELL') return 'bg-loss';
 return 'bg-warning';
}

function verdictLabel(v: string): string {
 if (v === 'STRONG_BUY') return 'شراء قوي';
 if (v === 'BUY') return 'شراء';
 if (v === 'SELL') return 'بيع';
 if (v === 'STRONG_SELL') return 'بيع قوي';
 return 'احتفاظ';
}

// ==================== Main Component ====================

interface ExpertIntelligencePanelProps {
 /** كود السوق (EGX, TADAWUL, KSE, QSE) */
 marketCode?: string;
 /**紧凑 mode — يخفي الـ header gradient */
 compact?: boolean;
 className?: string;
}

export function ExpertIntelligencePanel({
 marketCode = 'EGX',
 compact = false,
 className,
}: ExpertIntelligencePanelProps) {
 // ─── State ───
 const [missedOpp, setMissedOpp] = useState<MissedOpportunity | null>(null);
 const [missedOppLoading, setMissedOppLoading] = useState(false);

 const [sectorIntel, setSectorIntel] = useState<SectorIntelligence | null>(null);
 const [sectorIntelLoading, setSectorIntelLoading] = useState(false);

 const [consensusList, setConsensusList] = useState<ConsensusItem[]>([]);
 const [consensusSummary, setConsensusSummary] = useState<ConsensusSummary | null>(null);
 const [consensusLoading, setConsensusLoading] = useState(false);
 const [consensusVerdict, setConsensusVerdict] = useState('all');

 const [singleConsensus, setSingleConsensus] = useState<SingleConsensus | null>(null);
 const [singleConsensusTicker, setSingleConsensusTicker] = useState('');
 const [singleConsensusLoading, setSingleConsensusLoading] = useState(false);

 // ─── Fetchers ───
 const fetchMissedOpportunities = useCallback(async () => {
 setMissedOppLoading(true);
 try {
 const mkt = marketCode ? `&market=${marketCode}` : '';
 const res = await fetch(`/api/predictions/honest-tracking/missed-opportunities?threshold=10&limit=15${mkt}`);
 const data = await res.json();
 if (data.success) setMissedOpp(data);
 } catch (e) {
 console.error('[ExpertIntel] missed-opportunities fetch failed', e);
 } finally {
 setMissedOppLoading(false);
 }
 }, [marketCode]);

 const fetchSectorIntel = useCallback(async () => {
 setSectorIntelLoading(true);
 try {
 const res = await fetch('/api/market/sectors/intelligence?min_stocks=5&limit=10');
 const data = await res.json();
 if (data.success) setSectorIntel(data);
 } catch (e) {
 console.error('[ExpertIntel] sector intelligence fetch failed', e);
 } finally {
 setSectorIntelLoading(false);
 }
 }, []);

 const fetchConsensusList = useCallback(async (verdict: string = 'all') => {
 setConsensusLoading(true);
 try {
 const verdictParam = verdict && verdict !== 'all' ? `&verdict=${verdict}` : '';
 const res = await fetch(`/api/predictions/expert-consensus?limit=15&min_score=40${verdictParam}`);
 const data = await res.json();
 if (data.success) {
 setConsensusList(data.consensus_list || []);
 setConsensusSummary(data.summary || null);
 }
 } catch (e) {
 console.error('[ExpertIntel] consensus list fetch failed', e);
 } finally {
 setConsensusLoading(false);
 }
 }, []);

 const fetchSingleConsensus = useCallback(async (ticker: string) => {
 if (!ticker) return;
 setSingleConsensusLoading(true);
 try {
 const res = await fetch(`/api/predictions/expert-consensus?ticker=${ticker.toUpperCase()}`);
 const data = await res.json();
 if (data.success) setSingleConsensus(data.consensus || null);
 else setSingleConsensus({ error: data.error || 'غير موجود', ticker: '' });
 } catch (e) {
 console.error('[ExpertIntel] single consensus fetch failed', e);
 setSingleConsensus({ error: String(e), ticker: '' });
 } finally {
 setSingleConsensusLoading(false);
 }
 }, []);

 // Auto-load on mount
 useEffect(() => {
 fetchMissedOpportunities();
 fetchSectorIntel();
 fetchConsensusList('all');
 }, [fetchMissedOpportunities, fetchSectorIntel, fetchConsensusList]);

 // ─── Render ───
 return (
 <div className={cn('space-y-4', className)}>
 {!compact && (
 <div className="from-profit to-whale /20 dark:p-3 sm:p-4 rounded-lg border border-profit ">
 <div className="flex items-center gap-2">
 <Crosshair className="h-5 w-5 text-profit flex-shrink-0" />
 <span className="font-bold text-profit text-sm sm:text-base">
 ذكاء المحلل الخبير
 </span>
 </div>
 <p className="text-xs sm:text-sm text-profit mt-1 leading-relaxed">
 3 طبقات ذكاء على نفس البيانات: (1) الفرص اللي فاتتنا (2) ذكاء القطاعات (3) الإجماع الموحّد. الأسعار بتتحدث كل 5 دقايق.
 </p>
 </div>
 )}

 {/* ─── القسم 1: الفرص الضائعة ─── */}
 <Card>
 <CardHeader className="p-3 sm:p-5">
 <div className="flex items-center justify-between gap-2">
 <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
 <AlertOctagon className="h-5 w-5 text-loss flex-shrink-0" />
 <span>الفرص الضائعة والتوقعات الغلط</span>
 </CardTitle>
 <Button variant="ghost" size="sm" onClick={fetchMissedOpportunities} disabled={missedOppLoading} className="flex-shrink-0 h-9 w-9 p-0">
 <RefreshCw className={cn('h-4 w-4', missedOppLoading && 'animate-spin')} />
 </Button>
 </div>
 <CardDescription className="text-xs sm:text-xs">
 بيراجع التوقعات السابقة ويقارنها بآخر سعر — الأسعار بتتحدث كل 5 دقايق
 </CardDescription>
 </CardHeader>
 <CardContent className="p-3 sm:p-5 pt-0 space-y-3 sm:space-y-4">
 {missedOppLoading && (
 <div className="py-6 flex justify-center">
 <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
 </div>
 )}
 {!missedOpp && !missedOppLoading && (
 <div className="text-center py-6 text-muted-foreground text-sm">
 اضغط زر التحديث لتشغيل المراجعة
 </div>
 )}
 {missedOpp && missedOpp.summary && (
 <>
 {/* Summary stats */}
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
 <div className="bg-loss/20 p-2 sm:p-3 rounded-lg text-center">
 <div className="text-xl sm:text-2xl font-bold text-loss">{missedOpp.summary.missed_bulls}</div>
 <div className="text-xs sm:text-xs text-muted-foreground">فرصة ضاعت</div>
 </div>
 <div className="bg-warning/20 p-2 sm:p-3 rounded-lg text-center">
 <div className="text-xl sm:text-2xl font-bold text-warning">{missedOpp.summary.false_positives}</div>
 <div className="text-xs sm:text-xs text-muted-foreground">توقع خاطئ</div>
 </div>
 <div className="bg-success/20 p-2 sm:p-3 rounded-lg text-center">
 <div className="text-xl sm:text-2xl font-bold text-success">
 {missedOpp.summary.correct_buys + missedOpp.summary.correct_sells}
 </div>
 <div className="text-xs sm:text-xs text-muted-foreground">توقع صحيح</div>
 </div>
 <div className="bg-whale/20 p-2 sm:p-3 rounded-lg text-center">
 <div className="text-xl sm:text-2xl font-bold text-whale">{missedOpp.summary.accuracy_rate_pct}%</div>
 <div className="text-xs sm:text-xs text-muted-foreground">نسبة الدقة</div>
 </div>
 </div>

 {/* Freshness */}
 {(missedOpp.summary.prices_fresh || 0) > 0 || (missedOpp.summary.prices_stale || 0) > 0 ? (
 <div className="flex items-center gap-2 text-xs sm:text-xs p-2 rounded-lg bg-muted/30">
 <Clock3 className="h-3 w-3 flex-shrink-0" />
 <span className="text-muted-foreground">
 أسعار طازة: <b className="text-success">{missedOpp.summary.prices_fresh}</b> ·
 غير محدّثة (15+ دقيقة): <b className="text-warning">{missedOpp.summary.prices_stale}</b>
 </span>
 </div>
 ) : null}

 {/* Missed bulls */}
 {missedOpp.missed_bulls && missedOpp.missed_bulls.length > 0 && (
 <div>
 <div className="flex items-center gap-2 mb-2 flex-wrap">
 <ThumbsDown className="h-4 w-4 text-loss flex-shrink-0" />
 <span className="font-medium text-xs sm:text-sm">فرص ضاعت</span>
 <Badge variant="destructive" className="text-xs">متوسط: +{missedOpp.summary.avg_missed_gain_pct}%</Badge>
 </div>
 <div className="max-h-72 overflow-y-auto border rounded-lg divide-y">
 {missedOpp.missed_bulls.map((op, idx) => (
 <div key={`${op.ticker}-${idx}`} className="p-2.5 sm:p-3 hover:bg-muted/40">
 <div className="flex items-center justify-between gap-2">
 <div className="flex-1 min-w-0">
 <div className="font-medium text-sm truncate">{op.ticker}</div>
 <div className="text-xs sm:text-xs text-muted-foreground truncate">
 {op.name || op.sector || '—'}
 </div>
 <div className="text-xs sm:text-xs text-muted-foreground mt-0.5">
 <span className="text-loss">{op.signal}</span> · {op.days_since_prediction} يوم
 {op.price_is_stale && <span className="text-warning"> · ⏱️ سعر غير محدّث</span>}
 </div>
 </div>
 <div className="text-left flex-shrink-0">
 <div className="font-bold text-loss text-sm sm:text-base">+{op.pct_change}%</div>
 <div className="text-xs text-muted-foreground">{op.entry_price} → {op.current_price}</div>
 </div>
 </div>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* False positives */}
 {missedOpp.false_positives && missedOpp.false_positives.length > 0 && (
 <div>
 <div className="flex items-center gap-2 mb-2 flex-wrap">
 <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />
 <span className="font-medium text-xs sm:text-sm">توقعات شراء غلط</span>
 <Badge className="text-xs bg-warning/10 text-warning dark:text-warning border border-warning/20">متوسط: {missedOpp.summary.avg_false_loss_pct}%</Badge>
 </div>
 <div className="max-h-72 overflow-y-auto border rounded-lg divide-y">
 {missedOpp.false_positives.map((op: any, idx: number) => (
 <div key={`fp-${op.ticker}-${idx}`} className="p-2.5 sm:p-3 hover:bg-muted/40">
 <div className="flex items-center justify-between gap-2">
 <div className="flex-1 min-w-0">
 <div className="font-medium text-sm truncate">{op.ticker}</div>
 <div className="text-xs sm:text-xs text-muted-foreground truncate">
 {op.name || op.sector || '—'}
 </div>
 <div className="text-xs sm:text-xs text-muted-foreground mt-0.5">
 <span className="text-success">{op.signal}</span> · {op.days_since_prediction} يوم
 {op.price_is_stale && <span className="text-warning"> · ⏱️ سعر غير محدّث</span>}
 </div>
 </div>
 <div className="text-left flex-shrink-0">
 <div className="font-bold text-warning text-sm sm:text-base">{op.pct_change}%</div>
 <div className="text-xs text-muted-foreground">{op.entry_price} → {op.current_price}</div>
 </div>
 </div>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Correct calls */}
 {(missedOpp.correct_buys?.length || 0) > 0 || (missedOpp.correct_sells?.length || 0) > 0 ? (
 <div>
 <div className="flex items-center gap-2 mb-2">
 <ThumbsUp className="h-4 w-4 text-success flex-shrink-0" />
 <span className="font-medium text-xs sm:text-sm">توقعات صحيحة</span>
 </div>
 <div className="max-h-60 overflow-y-auto border rounded-lg divide-y">
 {missedOpp.correct_buys?.slice(0, 5).map((op: any, idx: number) => (
 <div key={`cb-${op.ticker}-${idx}`} className="flex items-center justify-between p-2.5 sm:p-3 hover:bg-muted/40 gap-2">
 <div className="flex-1 min-w-0">
 <div className="font-medium text-sm truncate">{op.ticker}</div>
 <div className="text-xs sm:text-xs text-muted-foreground">
 <span className="text-success">{op.signal}</span> · {op.days_since_prediction} يوم
 </div>
 </div>
 <div className="text-left flex-shrink-0">
 <div className="font-bold text-success text-sm">+{op.pct_change}%</div>
 </div>
 </div>
 ))}
 {missedOpp.correct_sells?.slice(0, 5).map((op: any, idx: number) => (
 <div key={`cs-${op.ticker}-${idx}`} className="flex items-center justify-between p-2.5 sm:p-3 hover:bg-muted/40 gap-2">
 <div className="flex-1 min-w-0">
 <div className="font-medium text-sm truncate">{op.ticker}</div>
 <div className="text-xs sm:text-xs text-muted-foreground">
 <span className="text-loss">{op.signal}</span> · {op.days_since_prediction} يوم
 </div>
 </div>
 <div className="text-left flex-shrink-0">
 <div className="font-bold text-success text-sm">{op.pct_change}%</div>
 </div>
 </div>
 ))}
 </div>
 </div>
 ) : null}
 </>
 )}
 </CardContent>
 </Card>

 {/* ─── القسم 2: ذكاء القطاعات ─── */}
 <Card>
 <CardHeader className="p-3 sm:p-5">
 <div className="flex items-center justify-between gap-2">
 <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
 <Layers className="h-5 w-5 text-whale flex-shrink-0" />
 <span>ذكاء القطاعات</span>
 </CardTitle>
 <Button variant="ghost" size="sm" onClick={fetchSectorIntel} disabled={sectorIntelLoading} className="flex-shrink-0 h-9 w-9 p-0">
 <RefreshCw className={cn('h-4 w-4', sectorIntelLoading && 'animate-spin')} />
 </Button>
 </div>
 <CardDescription className="text-xs sm:text-xs">
 ترتيب القطاعات + Relative Strength لكل سهم ضد قطاعه
 </CardDescription>
 </CardHeader>
 <CardContent className="p-3 sm:p-5 pt-0 space-y-3 sm:space-y-4">
 {sectorIntelLoading && (
 <div className="py-6 flex justify-center">
 <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
 </div>
 )}
 {!sectorIntel && !sectorIntelLoading && (
 <div className="text-center py-6 text-muted-foreground text-sm">
 اضغط زر التحديث لتشغيل تحليل القطاعات
 </div>
 )}
 {sectorIntel && sectorIntel.summary && (
 <>
 {/* Market mood */}
 <div className={cn(
 'rounded-lg p-3 sm:p-4 text-center',
 sectorIntel.summary.market_breadth?.market_mood?.includes('صاعد') ? 'bg-success/20' :
 sectorIntel.summary.market_breadth?.market_mood?.includes('هابط') ? 'bg-loss/20' :
 'bg-warning/20'
 )}>
 <div className="text-xs sm:text-xs text-muted-foreground">مزاج السوق</div>
 <div className="text-base sm:text-2xl font-bold">{sectorIntel.summary.market_breadth?.market_mood || '—'}</div>
 <div className="text-xs sm:text-xs text-muted-foreground mt-1">
 {sectorIntel.summary.market_breadth?.sectors_up} طالع · {sectorIntel.summary.market_breadth?.sectors_down} نازل · من {sectorIntel.summary.market_breadth?.total_sectors}
 </div>
 </div>

 {/* Best + worst */}
 <div className="grid grid-cols-2 gap-2 sm:gap-3">
 <div className="border rounded-lg p-2 sm:p-3 bg-success/20">
 <div className="text-xs sm:text-xs text-muted-foreground">أقوى قطاع</div>
 <div className="font-bold text-success text-xs sm:text-sm truncate">
 {sectorIntel.summary.best_sector?.sector || '—'}
 </div>
 <div className="text-xs sm:text-sm text-success">+{sectorIntel.summary.best_sector?.avg_change_pct}%</div>
 </div>
 <div className="border rounded-lg p-2 sm:p-3 bg-loss/20">
 <div className="text-xs sm:text-xs text-muted-foreground">أضعف قطاع</div>
 <div className="font-bold text-loss text-xs sm:text-sm truncate">
 {sectorIntel.summary.worst_sector?.sector || '—'}
 </div>
 <div className="text-xs sm:text-sm text-loss">{sectorIntel.summary.worst_sector?.avg_change_pct}%</div>
 </div>
 </div>

 {/* Sector ranking */}
 {sectorIntel.sector_ranking && sectorIntel.sector_ranking.length > 0 && (
 <div>
 <div className="text-xs sm:text-sm font-medium mb-2">ترتيب القطاعات</div>
 <div className="max-h-80 overflow-y-auto border rounded-lg divide-y">
 {sectorIntel.sector_ranking.map((s, i) => (
 <div key={s.sector} className="p-2.5 sm:p-3 hover:bg-muted/40">
 <div className="flex items-center justify-between gap-2">
 <div className="flex items-center gap-2 min-w-0">
 <span className={cn(
 'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
 i === 0 ? 'bg-profit/10 text-profit border border-profit/20' :
 i === sectorIntel.sector_ranking!.length - 1 ? 'bg-loss/10 text-loss border border-loss/20' :
 'bg-muted text-muted-foreground'
 )}>{i + 1}</span>
 <div className="min-w-0">
 <div className="font-medium text-xs sm:text-sm truncate">{s.sector}</div>
 <div className="text-xs sm:text-xs text-muted-foreground">
 {s.gainers} طالع · {s.losers} نازل · {s.total_stocks} سهم
 </div>
 </div>
 </div>
 <div className="text-left flex-shrink-0">
 <div className={cn(
 'font-bold text-xs sm:text-sm',
 s.avg_change_pct > 0 ? 'text-success' :
 s.avg_change_pct < 0 ? 'text-loss' : 'text-muted-foreground'
 )}>
 {s.avg_change_pct > 0 ? '+' : ''}{s.avg_change_pct}%
 </div>
 {s.top_gainer && (
 <div className="text-xs text-muted-foreground truncate">أقوى: {s.top_gainer.ticker}</div>
 )}
 </div>
 </div>
 {(s.prices_fresh_count || 0) > 0 || (s.prices_stale_count || 0) > 0 ? (
 <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
 <Clock3 className="h-2.5 w-2.5" />
 <span className="text-success">{s.prices_fresh_count} طازة</span>
 <span>·</span>
 <span className="text-warning">{s.prices_stale_count} غير محدّثة</span>
 </div>
 ) : null}
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Top outperformers */}
 {sectorIntel.top_outperformers && sectorIntel.top_outperformers.length > 0 && (
 <div>
 <div className="flex items-center gap-2 mb-2">
 <Trophy className="h-4 w-4 text-warning flex-shrink-0" />
 <span className="font-medium text-xs sm:text-sm">أقوى أسهم تتفوق على قطاعها</span>
 </div>
 <div className="max-h-60 overflow-y-auto border rounded-lg divide-y">
 {sectorIntel.top_outperformers.slice(0, 8).map((s, idx) => (
 <div key={`${s.ticker}-${idx}`} className="p-2.5 sm:p-3 hover:bg-muted/40">
 <div className="flex items-center justify-between gap-2">
 <div className="flex-1 min-w-0">
 <div className="font-medium text-sm truncate">{s.ticker}</div>
 <div className="text-xs sm:text-xs text-muted-foreground truncate">— {s.sector}</div>
 <div className="text-xs sm:text-xs text-muted-foreground">
 السهم {s.stock_change_pct > 0 ? '+' : ''}{s.stock_change_pct}% · القطاع {s.sector_avg_change_pct}%
 </div>
 </div>
 <Badge className="bg-profit/10 text-profit border border-profit/20 text-xs flex-shrink-0">RS +{s.relative_strength}%</Badge>
 </div>
 </div>
 ))}
 </div>
 </div>
 )}
 </>
 )}
 </CardContent>
 </Card>

 {/* ─── القسم 3: الإجماع الخبير ─── */}
 <Card>
 <CardHeader className="p-3 sm:p-5">
 <div className="flex items-center justify-between flex-wrap gap-2">
 <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
 <Crosshair className="h-5 w-5 text-profit flex-shrink-0" />
 <span>الإجماع الخبير</span>
 </CardTitle>
 <div className="flex items-center gap-2 flex-wrap">
 <Select
 value={consensusVerdict}
 onValueChange={(v) => { setConsensusVerdict(v); fetchConsensusList(v); }}
 >
 <SelectTrigger className="w-28 sm:w-40 h-8 text-xs">
 <SelectValue placeholder="كل التوقعات" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">الكل</SelectItem>
 <SelectItem value="STRONG_BUY">شراء قوي</SelectItem>
 <SelectItem value="BUY">شراء</SelectItem>
 <SelectItem value="HOLD">احتفاظ</SelectItem>
 <SelectItem value="SELL">بيع</SelectItem>
 <SelectItem value="STRONG_SELL">بيع قوي</SelectItem>
 </SelectContent>
 </Select>
 <Button variant="ghost" size="sm" onClick={() => fetchConsensusList(consensusVerdict)} disabled={consensusLoading} className="flex-shrink-0 h-9 w-9 p-0">
 <RefreshCw className={cn('h-4 w-4', consensusLoading && 'animate-spin')} />
 </Button>
 </div>
 </div>
 <CardDescription className="text-xs sm:text-xs">
 5 مصادر لكل سهم: توقع + أداء + RSI + MA + Relative Strength
 </CardDescription>
 </CardHeader>
 <CardContent className="p-3 sm:p-5 pt-0 space-y-3 sm:space-y-4">
 {/* Summary by verdict */}
 {consensusSummary?.by_verdict && (
 <div className="grid grid-cols-5 gap-1 sm:gap-2">
 {[
 { k: 'STRONG_BUY', label: 'قوي', color: 'bg-success' },
 { k: 'BUY', label: 'شراء', color: 'bg-success' },
 { k: 'HOLD', label: 'احتفاظ', color: 'bg-warning' },
 { k: 'SELL', label: 'بيع', color: 'bg-loss' },
 { k: 'STRONG_SELL', label: 'بيع قوي', color: 'bg-loss' },
 ].map((v) => (
 <div key={v.k} className="border rounded-lg p-1.5 sm:p-2 text-center">
 <div className={cn(
 'text-base sm:text-xl font-bold text-foreground rounded mx-auto w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center',
 v.color
 )}>
 {consensusSummary.by_verdict?.[v.k] || 0}
 </div>
 <div className="text-xs sm:text-xs text-muted-foreground mt-1">{v.label}</div>
 </div>
 ))}
 </div>
 )}

 {consensusLoading && (
 <div className="py-6 flex justify-center">
 <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
 </div>
 )}

 {/* P0-COMPONENT-UNIFICATION Phase 2.2: UnifiedEmptyState */}
 {!consensusLoading && consensusList.length === 0 && (
 <UnifiedEmptyState
 variant="empty"
 title="مفيش بيانات consensus"
 description="شغّل تحليلاً جديداً أولاً عشان تظهر النتايج هنا"
 />
 )}

 {/* Consensus list */}
 {consensusList.length > 0 && (
 <div className="max-h-96 overflow-y-auto border rounded-lg divide-y">
 {consensusList.map((c, idx) => (
 <div key={`${c.ticker}-${idx}`} className="p-2.5 sm:p-3 hover:bg-muted/40">
 <div className="flex items-center justify-between gap-2">
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-1.5 flex-wrap">
 <span className="font-bold text-sm">{c.ticker}</span>
 {c.is_egx30 && <Badge variant="outline" className="text-xs px-1 py-0">EGX30</Badge>}
 {c.is_egx100 && !c.is_egx30 && <Badge variant="outline" className="text-xs px-1 py-0">EGX100</Badge>}
 {c.current_state?.price_is_stale && (
 <Badge className="text-xs px-1 py-0 bg-warning/10 text-warning dark:text-warning border border-warning/20">⏱️</Badge>
 )}
 </div>
 <div className="text-xs sm:text-xs text-muted-foreground mt-0.5 truncate">
 {c.name || c.sector || '—'}
 </div>
 <div className="text-xs sm:text-xs text-muted-foreground mt-0.5">
 {c.current_state?.price != null && <span>{c.current_state.price} · </span>}
 {c.current_state?.change_pct != null && (
 <span className={cn(
 c.current_state.change_pct > 0 ? 'text-success' :
 c.current_state.change_pct < 0 ? 'text-loss' : ''
 )}>
 {c.current_state.change_pct > 0 ? '+' : ''}{c.current_state.change_pct}%
 </span>
 )}
 {c.current_state?.rsi != null && c.current_state.rsi > 0 && (
 <span> · RSI {(c.current_state.rsi ?? 0).toFixed(0)}</span>
 )}
 {c.sector_context?.relative_strength != null && (
 <span className={cn(
 c.sector_context.relative_strength > 0 ? ' text-success' :
 c.sector_context.relative_strength < 0 ? ' text-loss' : ''
 )}>
 {' '}· RS {c.sector_context.relative_strength > 0 ? '+' : ''}{c.sector_context.relative_strength}%
 </span>
 )}
 </div>
 {c.current_state?.price_freshness_minutes != null && (
 <div className="text-xs text-muted-foreground mt-0.5">
 <Clock3 className="h-2.5 w-2.5 inline" /> آخر سعر منذ {c.current_state.price_freshness_minutes} دقيقة
 </div>
 )}
 </div>
 <div className="text-left flex-shrink-0">
 <Badge className={cn('text-foreground text-xs sm:text-xs', verdictColor(c.verdict))}>
 {verdictLabel(c.verdict)}
 </Badge>
 <div className="text-xs sm:text-xs text-muted-foreground mt-1">ثقة {c.confidence_pct}%</div>
 </div>
 </div>
 {/* Reasons */}
 {c.reasons && c.reasons.length > 0 && (
 <div className="mt-2 flex flex-wrap gap-1">
 {c.reasons.slice(0, 3).map((r, i) => (
 <Badge key={i} variant="secondary" className="text-xs sm:text-xs font-normal">{r}</Badge>
 ))}
 </div>
 )}
 {/* Dissent */}
 {c.dissent && c.dissent.length > 0 && (
 <div className="mt-1 flex flex-wrap gap-1">
 {c.dissent.map((d, i) => (
 <Badge key={i} variant="outline" className="text-xs sm:text-xs font-normal text-warning border-orange-300">
 ⚠ {d}
 </Badge>
 ))}
 </div>
 )}
 </div>
 ))}
 </div>
 )}

 {/* Single ticker consensus */}
 <Separator />
 <div>
 <div className="text-xs sm:text-sm font-medium mb-2">اسأل عن إجماع سهم معين</div>
 <div className="flex gap-2">
 <Input
 placeholder="مثال: COMI"
 value={singleConsensusTicker}
 onChange={(e) => setSingleConsensusTicker(e.target.value.toUpperCase())}
 onKeyDown={(e) => e.key === 'Enter' && fetchSingleConsensus(singleConsensusTicker)}
 className="max-w-xs h-9 text-sm"
 />
 <Button onClick={() => fetchSingleConsensus(singleConsensusTicker)} disabled={singleConsensusLoading || !singleConsensusTicker} size="sm">
 {singleConsensusLoading ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <Crosshair className="h-4 w-4 ml-1" />}
 إجماع
 </Button>
 </div>
 {singleConsensus && (
 <div className="mt-3 border rounded-lg p-3 sm:p-4 space-y-2 bg-muted/30">
 {singleConsensus.error ? (
 <div className="text-loss text-sm">{singleConsensus.error}</div>
 ) : (
 <>
 <div className="flex items-center gap-2 flex-wrap">
 <span className="font-bold text-sm">{singleConsensus.ticker}</span>
 <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{singleConsensus.name || '—'}</span>
 <Badge className={cn('text-foreground text-xs', verdictColor(singleConsensus.verdict || 'HOLD'))}>
 {verdictLabel(singleConsensus.verdict || 'HOLD')}
 </Badge>
 <span className="text-xs">ثقة: <b>{singleConsensus.confidence_pct ?? 0}%</b></span>
 </div>
 <div className="text-xs text-muted-foreground">
 {singleConsensus.bullish_signals ?? 0} إشارة شراء · {singleConsensus.bearish_signals ?? 0} إشارة بيع
 {singleConsensus.current_state?.price_freshness_minutes != null && (
 <span> · آخر سعر منذ {singleConsensus.current_state.price_freshness_minutes} دقيقة</span>
 )}
 </div>
 {singleConsensus.reasons && singleConsensus.reasons.length > 0 && (
 <div className="text-xs sm:text-sm">
 <span className="font-medium">الأسباب: </span>
 <ul className="list-disc mr-5 mt-1 space-y-0.5">
 {singleConsensus.reasons.map((r, i) => <li key={i}>{r}</li>)}
 </ul>
 </div>
 )}
 {singleConsensus.dissent && singleConsensus.dissent.length > 0 && (
 <div className="text-xs sm:text-sm">
 <span className="font-medium text-warning">تحذيرات: </span>
 <ul className="list-disc mr-5 mt-1 space-y-0.5">
 {singleConsensus.dissent.map((d, i) => <li key={i}>{d}</li>)}
 </ul>
 </div>
 )}
 </>
 )}
 </div>
 )}
 </div>
 </CardContent>
 </Card>
 </div>
 );
}

export default ExpertIntelligencePanel;
