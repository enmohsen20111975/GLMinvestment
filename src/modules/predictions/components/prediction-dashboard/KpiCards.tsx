/**
 * prediction-dashboard/KpiCards.tsx
 * ================================
 * Hero KPI cards grid (5 cards in a responsive grid):
 *  1. صافي الربح/الخسارة (net return) — color-coded by sign.
 *  2. إجمالي الأرباح (gross profit) — green.
 *  3. إجمالي الخسائر (gross loss) — red.
 *  4. أقصى خسارة (max loss, protection) — warning amber.
 *  5. نسبة الربح/الخسارة (R:R ratio) — color-coded by tier (>=1.5 / >=1.0 / <1.0).
 *
 * Originally inlined at lines 1300-1398 of PredictionTrackingDashboard.tsx
 * (~98 LOC).
 */

'use client';

import React from 'react';
import { Scale, Shield, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PersonaStats } from './types';

interface KpiCardsProps {
 activeStats: PersonaStats;
}

export function KpiCards({ activeStats }: KpiCardsProps) {
 return (
 <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
 {/* صافي الربح/الخسارة — الفلوس الفعلية */}
 <div className={cn(
 'col-span-2 sm:col-span-1 p-4 rounded-2xl border flex flex-col justify-between relative overflow-hidden',
 activeStats.netReturn >= 0
 ? 'to-transparent border-profit/20'
 : 'to-transparent border-loss/20'
 )}>
 <div className="flex items-center justify-between text-xs font-bold mb-1">
 <span className={activeStats.netReturn >= 0 ? 'text-profit ' : 'text-loss '}>
 {activeStats.netReturn >= 0 ? 'صافي الربح' : 'صافي الخسارة'}
 </span>
 <TrendingUp className={cn('w-4 h-4', activeStats.netReturn >= 0 ? 'text-profit' : 'text-loss')} />
 </div>
 <div className="flex items-baseline gap-1 my-1">
 <span className={cn(
 'text-3xl md:text-4xl font-black tracking-tight font-mono',
 activeStats.netReturn >= 0 ? 'text-profit ' : 'text-loss '
 )}>
 {activeStats.netReturn >= 0 ? '+' : ''}{(activeStats.netReturn ?? 0).toFixed(1)}%
 </span>
 </div>
 <p className="text-xs text-muted-foreground">
 إجمالي عائد {activeStats.settled} صفقة مقفولة
 </p>
 </div>

 {/* إجمالي الأرباح */}
 <div className="bg-card border border-profit/20 p-4 rounded-2xl flex flex-col justify-between">
 <div className="flex items-center justify-between text-xs text-profit font-bold mb-1">
 <span>إجمالي الأرباح</span>
 <TrendingUp className="w-4 h-4" />
 </div>
 <div className="my-1">
 <span className="text-2xl md:text-3xl font-black font-mono text-profit ">
 +{(activeStats.grossProfit ?? 0).toFixed(1)}%
 </span>
 </div>
 <p className="text-xs text-muted-foreground">
 من {activeStats.wins} صفقة رابحة
 </p>
 </div>

 {/* إجمالي الخسائر */}
 <div className="bg-card border border-loss/20 p-4 rounded-2xl flex flex-col justify-between">
 <div className="flex items-center justify-between text-xs text-loss font-bold mb-1">
 <span>إجمالي الخسائر</span>
 <TrendingDown className="w-4 h-4" />
 </div>
 <div className="my-1">
 <span className="text-2xl md:text-3xl font-black font-mono text-loss ">
 {(activeStats.grossLoss ?? 0).toFixed(1)}%
 </span>
 </div>
 <p className="text-xs text-muted-foreground">
 من {activeStats.losses} صفقة خاسرة
 </p>
 </div>

 {/* الحماية من الخسائر — أقصى خسارة في صفقة */}
 <div className="bg-card border border-warning/20 p-4 rounded-2xl flex flex-col justify-between">
 <div className="flex items-center justify-between text-xs text-warning font-bold mb-1">
 <span>أقصى خسارة (حماية)</span>
 <Shield className="w-4 h-4" />
 </div>
 <div className="my-1">
 <span className="text-2xl md:text-3xl font-black font-mono text-warning ">
 {(activeStats.maxLoss ?? 0).toFixed(1)}%
 </span>
 </div>
 <p className="text-xs text-muted-foreground">
 الحد الأقصى للخسارة في صفقة واحدة
 </p>
 </div>

 {/* نسبة الربح للخسارة — R:R */}
 <div className="bg-card border border-border/80 p-4 rounded-2xl flex flex-col justify-between">
 <div className="flex items-center justify-between text-xs text-muted-foreground font-bold mb-1">
 <span>نسبة الربح/الخسارة</span>
 <Scale className="w-4 h-4 text-whale" />
 </div>
 <div className="my-1">
 <span className={cn(
 'text-2xl md:text-3xl font-black font-mono',
 activeStats.rrRatio >= 1.5 ? 'text-profit ' :
 activeStats.rrRatio >= 1.0 ? 'text-warning ' :
 'text-loss '
 )}>
 {(activeStats.rrRatio ?? 0).toFixed(2)}:1
 </span>
 </div>
 <p className="text-xs text-muted-foreground">
 متوسط الربح ÷ متوسط الخسارة
 </p>
 </div>
 </div>
 );
}
