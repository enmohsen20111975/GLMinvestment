/**
 * prediction-dashboard/FocusStocksBanner.tsx
 * =========================================
 * "Focus stocks" banner — shows tickers that appear in 2+ personas (a
 * "concentration/strength" signal). Each ticker is a button that filters
 * the predictions table by that ticker.
 *
 * Rendered only when `focusTickerList.length > 0`.
 *
 * Originally inlined at lines 1461-1501 of PredictionTrackingDashboard.tsx
 * (~40 LOC).
 */

'use client';

import React from 'react';
import { Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PERSONA_CONFIG } from './constants';
import type { FocusTickerInfo } from './types';

interface FocusStocksBannerProps {
 focusTickerList: string[];
 focusTickers: Record<string, FocusTickerInfo>;
 onSelectTicker: (ticker: string) => void;
}

export function FocusStocksBanner({
 focusTickerList,
 focusTickers,
 onSelectTicker,
}: FocusStocksBannerProps) {
 if (focusTickerList.length === 0) return null;

 return (
 <Card className="border border-warning/20 via-card to-card shadow-md rounded-2xl overflow-hidden">
 <CardHeader className="p-4 border-b border-warning/20">
 <div className="flex items-center gap-2 flex-wrap">
 <Badge className="bg-warning/15 text-warning border border-warning/20 gap-1 font-bold text-xs">
 <Layers className="w-3.5 h-3.5" />
 أسهم تحت التركيز ({focusTickerList.length})
 </Badge>
 <CardTitle className="text-sm font-black text-foreground">
 مكررة في أكثر من شخصية — إشارة قوية (طالع أو نازل)
 </CardTitle>
 </div>
 <p className="text-xs text-muted-foreground mt-1">
 نظام حساب واحد → ظهور نفس السهم في شخصيتين أو أكثر يعني تقارب التحليل. هذه الأسهم التي ينبغي التركيز عليها بوصفها مجموعة متقاربة.
 </p>
 </CardHeader>
 <CardContent className="p-3">
 <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
 {focusTickerList.map((tk) => {
 const info = focusTickers[tk];
 return (
 <button
 key={`focus-${tk}`}
 onClick={() => onSelectTicker(tk)}
 className="px-2.5 py-1 text-xs font-bold rounded-lg border border-warning/20 bg-warning/10 text-warning hover:bg-warning/20 transition-colors flex items-center gap-1"
 title="اضغط للفلترة على هذا السهم"
 >
 <span className="font-mono">{tk}</span>
 <span className="text-xs opacity-70">×{info.count}</span>
 <span className="flex gap-0.5">
 {info.personas.map((p) => (
 <span key={p} className="text-xs">{PERSONA_CONFIG[p as keyof typeof PERSONA_CONFIG]?.emoji}</span>
 ))}
 </span>
 </button>
 );
 })}
 </div>
 </CardContent>
 </Card>
 );
}
