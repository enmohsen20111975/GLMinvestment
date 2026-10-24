/**
 * prediction-dashboard/HeaderBar.tsx
 * =================================
 * The luxury header + timeframe control bar:
 *  - Sparkles badge "مركز الشفافية والمصداقية الحية"
 *  - Market session badge (open/closed).
 *  - Title + description.
 *  - Refresh button (with countdown) + verify-pending button + ExportDropdown.
 *  - Timeframe selector pills (DAYS_OPTIONS).
 *  - Quality filter row (QUALITY_MODE_OPTIONS + CONFIDENCE_OPTIONS).
 *
 * Originally inlined at lines 1158-1298 of PredictionTrackingDashboard.tsx
 * (~140 LOC).
 */

'use client';

import React from 'react';
import { Activity, CheckCircle2, Gauge, Loader2, RefreshCw, Sparkles, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ExportDropdown } from '@/modules/screener/components/StockScreenerAdvanced';
import {
 DAYS_OPTIONS,
 QUALITY_MODE_OPTIONS,
 CONFIDENCE_OPTIONS,
} from './constants';
import type { DaysWindow, QualityMode } from './types';

interface HeaderBarProps {
 session: {
 is_open: boolean;
 server_time: string;
 next_refresh_seconds: number;
 session_name: string;
 } | undefined;
 refreshing: boolean;
 countdown: number;
 onRefresh: () => void;
 onVerifyPending: () => Promise<void>;
 shareText: string;

 // Filters
 days: DaysWindow;
 setDays: React.Dispatch<React.SetStateAction<DaysWindow>>;
 qualityMode: QualityMode;
 setQualityMode: React.Dispatch<React.SetStateAction<QualityMode>>;
 minConfidence: number;
 setMinConfidence: React.Dispatch<React.SetStateAction<number>>;
}

export function HeaderBar({
 session,
 refreshing,
 countdown,
 onRefresh,
 onVerifyPending,
 shareText,
 days,
 setDays,
 qualityMode,
 setQualityMode,
 minConfidence,
 setMinConfidence,
}: HeaderBarProps) {
 return (
 <Card className="border border-profit/20 from-card via-card shadow-xl rounded-2xl overflow-hidden">
 <CardHeader className="p-4 md:p-6 pb-3 border-b border-border/50">
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
 <div>
 <div className="flex items-center gap-2 flex-wrap">
 <Badge variant="outline" className="bg-profit/10 text-profit border-profit/20 gap-1 font-bold">
 <Sparkles className="w-3.5 h-3.5" />
 مركز الشفافية والمصداقية الحية
 </Badge>
 {session && (
 <Badge className={cn(
 'text-xs gap-1 font-bold',
 session.is_open
 ? 'bg-profit/20 text-profit border border-profit/20 animate-pulse'
 : 'bg-muted text-muted-foreground border border-border'
 )}>
 {session.is_open ? <Activity className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
 {session.is_open ? 'جلسة تداول حية LIVE' : 'السوق مغلق'}
 </Badge>
 )}
 </div>
 <h1 className="text-xl md:text-2xl font-black text-foreground mt-1.5 flex items-center gap-2">
 <Gauge className="w-6 h-6 text-profit" />
 سجل أداء التوقعات ودلائل صحة الصفقات
 </h1>
 <p className="text-xs md:text-sm text-muted-foreground mt-1">
 سجل موثق بالكامل لكافة الصفقات والتوقعات الصادرة من المحرك الفني الذكي، مع متابعة دقيقة لنسبة النجاح والأهداف المحققة.
 </p>
 </div>

 <div className="flex items-center gap-2 flex-wrap self-start md:self-auto">
 <Button
 variant="outline"
 size="sm"
 onClick={onRefresh}
 disabled={refreshing}
 className="h-9 px-3 text-xs border-border bg-background hover:bg-muted font-bold"
 >
 {refreshing ? <Loader2 className="w-3.5 h-3.5 ml-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 ml-1 text-profit" />}
 تحديث {countdown > 0 && `(${countdown}s)`}
 </Button>
 <Button
 variant="outline"
 size="sm"
 onClick={onVerifyPending}
 disabled={refreshing}
 className="h-9 px-3 text-xs border-warning/20 bg-warning/10 hover:bg-warning/20 text-warning font-bold"
 >
 {refreshing ? <Loader2 className="w-3.5 h-3.5 ml-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 ml-1" />}
 تحقق من المعلقة
 </Button>
 <ExportDropdown shareText={shareText} disabled={!shareText} />
 </div>
 </div>

 {/* Timeframe Selector Pills */}
 <div className="flex items-center gap-1.5 pt-4 overflow-x-auto no-scrollbar">
 <span className="text-xs text-muted-foreground font-bold ml-1 flex-shrink-0">الفترة الزمنية:</span>
 {DAYS_OPTIONS.map((opt) => (
 <button
 key={`days-${opt.value}`}
 onClick={() => setDays(opt.value)}
 className={cn(
 'px-3 py-1.5 text-xs font-bold rounded-xl transition-all whitespace-nowrap border',
 days === opt.value
 ? 'bg-profit text-white border-profit shadow-md shadow-emerald-500/20'
 : 'bg-background border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted'
 )}
 >
 {opt.label}
 </button>
 ))}
 </div>

 {/* RL-FIX-13: Quality Filter — يفلتر التوقعات الضعيفة من كل الإحصائيات */}
 <div className="flex flex-col gap-2 pt-3 mt-3 border-t border-border/40">
 <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
 <span className="text-xs text-muted-foreground font-bold ml-1 flex-shrink-0">الجودة:</span>
 {QUALITY_MODE_OPTIONS.map((opt) => (
 <button
 key={`qm-${opt.value}`}
 onClick={() => setQualityMode(opt.value)}
 title={opt.desc}
 className={cn(
 'px-3 py-1.5 text-xs font-bold rounded-xl transition-all whitespace-nowrap border',
 qualityMode === opt.value
 ? 'bg-warning text-white border-warning shadow-md shadow-amber-500/20'
 : 'bg-background border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted'
 )}
 >
 {opt.emoji} {opt.label}
 </button>
 ))}
 {qualityMode === 'top_picks' && (
 <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 text-xs font-bold mr-1">
 ≥{minConfidence} ثقة · 5/يوم/شخصية
 </Badge>
 )}
 </div>
 {qualityMode === 'top_picks' && (
 <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
 <span className="text-xs text-muted-foreground font-bold ml-1 flex-shrink-0">الثقة ≥:</span>
 {CONFIDENCE_OPTIONS.map((opt) => (
 <button
 key={`conf-${opt.value}`}
 onClick={() => setMinConfidence(opt.value)}
 className={cn(
 'px-2.5 py-1 text-xs font-bold rounded-lg transition-all whitespace-nowrap border',
 minConfidence === opt.value
 ? 'bg-profit/15 border-profit text-profit font-extrabold'
 : 'bg-background border-border text-muted-foreground hover:text-foreground'
 )}
 >
 {opt.label}
 </button>
 ))}
 </div>
 )}
 </div>
 </CardHeader>
 </Card>
 );
}
