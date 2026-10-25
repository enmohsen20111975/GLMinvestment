/**
 * prediction-dashboard/CumulativeProfitChart.tsx
 * =============================================
 * Recharts BarChart visualizing cumulative profit % over closed trades.
 *
 * Each bar = one closed trade, colored green (positive cumulative) or red
 * (negative). ReferenceLine at y=0. Tooltip shows trade % + cumulative %.
 *
 * Rendered only when `cumulativeProfitData.length > 0`.
 *
 * Originally inlined at lines 1503-1554 of PredictionTrackingDashboard.tsx
 * (~51 LOC).
 */

'use client';

import React from 'react';
import { CalendarClock } from 'lucide-react';
import { BarChart, Bar, Cell as RechartsCell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CumulativeProfitPoint } from './types';

interface CumulativeProfitChartProps {
 data: CumulativeProfitPoint[];
}

export function CumulativeProfitChart({ data }: CumulativeProfitChartProps) {
 if (data.length === 0) return null;

 const lastCum = data[data.length - 1]?.cumulative ?? 0;

 return (
 <Card className="border border-border/80 shadow-md rounded-2xl overflow-hidden bg-card">
 <CardHeader className="p-4 border-b border-border/60">
 <div className="flex items-center justify-between gap-2 flex-wrap">
 <div className="flex items-center gap-2">
 <CalendarClock className="w-5 h-5 text-profit" />
 <CardTitle className="text-base font-black">حركة الأرباح التراكمية عبر الزمن</CardTitle>
 </div>
 <div className="flex items-center gap-3 text-xs">
 <span className="text-muted-foreground">إجمالي الصفقات المقفلة:</span>
 <Badge className="bg-profit/15 text-profit border border-profit/20 font-mono font-black">
 {data.length} صفقة
 </Badge>
 <Badge className={cn(
 'font-mono font-black',
 lastCum >= 0
 ? 'bg-profit/15 text-profit border border-profit/20'
 : 'bg-loss/15 text-loss border border-loss/20'
 )}>
 تراكمي: {lastCum >= 0 ? '+' : ''}{(lastCum).toFixed(2)}%
 </Badge>
 </div>
 </div>
 <p className="text-xs text-muted-foreground mt-1">
 الرسم بيوضح تراكم العائد % مع كل صفقة مقفلة (مرتبة حسب تاريخ التنفيذ). بـ يساعدك تشوف اتجاه الأرباح على المنصة عبر الفترات الزمنية.
 </p>
 </CardHeader>
 <CardContent className="p-2 md:p-4">
 <div className="h-56 md:h-64 w-full dir-ltr">
 <ResponsiveContainer width="100%" height="100%">
 <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
 <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
 <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} interval="preserveStartEnd" minTickGap={20} angle={-20} textAnchor="end" height={48} />
 <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} width={48} tickFormatter={(v) => `${v}%`} />
 <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" opacity={0.5} />
 <Tooltip
 contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 11, direction: 'ltr' }}
 labelStyle={{ fontWeight: 700, marginBottom: 4 }}
 formatter={(value: any, name: any) => [`${Number(value).toFixed(2)}%`, name === 'cumulative' ? 'التراكمي' : 'الصفقة']}
 />
 <Bar dataKey="cumulative" name="cumulative" radius={[4, 4, 0, 0]}>
 {data.map((entry, idx) => (
 <RechartsCell key={`cell-${idx}`} fill={entry.cumulative >= 0 ? '#10b981' : '#f43f5e'} />
 ))}
 </Bar>
 </BarChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>
 );
}
