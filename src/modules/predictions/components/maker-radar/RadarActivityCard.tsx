'use client';

// ============================================================================
// RadarActivityCard.tsx — مدى شعل الرادار خلال فترة زمنية (أسبوع/شهر)
// + KpiCard — small stat card used by the radar summary grid.
// ============================================================================

import { useState, useMemo } from 'react';
import { Flame } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { RadarActivityCardProps, KpiCardProps } from './types';

// ============================================================================
// RadarActivityCard — مدى شعل الرادار خلال فترة زمنية (أسبوع/شهر)
// ============================================================================
export function RadarActivityCard({ data, lastUpdated, period = '7d', onPeriodChange }: RadarActivityCardProps) {
 const [localPeriod, setLocalPeriod] = useState<'7d' | '30d' | '90d'>(period);
 const activePeriod = period || localPeriod;
 const handleSelectPeriod = (p: '7d' | '30d' | '90d') => {
 setLocalPeriod(p);
 onPeriodChange?.(p);
 };

 // حساب نشاط الرادار من البيانات المتاحة
 const activity = useMemo(() => {
 if (!data) return null;

 const totalStocks = data.total_scanned ?? 0;
 const quiet = data.quiet_count ?? 0;
 const explosive = data.explosive_count ?? 0;
 const earlyBreak = data.early_break_count ?? 0;
 const tracked = data.tracked_count ?? 0;

 // نسبة الشعل = (الأسهم النشطة / إجمالي الأسهم) × 100
 const activeStocks = quiet + explosive + earlyBreak;
 const activityPct = totalStocks > 0 ? (activeStocks / totalStocks) * 100 : 0;

 // مستوى الشعل
 let level = 'هادئ';
 let levelColor = 'text-muted-foreground bg-muted dark:text-muted-foreground';
 if (activityPct > 30) {
 level = 'شعل عالي';
 levelColor = 'text-loss bg-loss/10 ';
 } else if (activityPct > 15) {
 level = 'شعل متوسط';
 levelColor = 'text-warning bg-warning/10 ';
 } else if (activityPct > 5) {
 level = 'شعل منخفض';
 levelColor = 'text-profit bg-profit/10 ';
 }

 return {
 totalStocks,
 activeStocks,
 activityPct: Math.round(activityPct * 10) / 10,
 quiet,
 explosive,
 earlyBreak,
 tracked,
 level,
 levelColor,
 };
 }, [data]);

 if (!activity) return null;

 // أرقام الفترة (محاكاة — في الإنتاج تأتي من cron runs)
 const periodLabels: Record<string, string> = { '7d': 'آخر 7 أيام', '30d': 'آخر 30 يوم', '90d': 'آخر 90 يوم' };
 const periodMultiplier: Record<string, number> = { '7d': 1, '30d': 4.3, '90d': 13 };

 return (
 <Card className="p-4">
 <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
 <div className="flex items-center gap-2">
 <Flame className="h-4 w-4 text-warning" />
 <span className="text-sm font-bold">مدى شعل الرادار</span>
 <Badge className={`text-xs ${activity.levelColor}`}>
 {activity.level}
 </Badge>
 </div>
 <div className="flex gap-1">
 {(['7d', '30d', '90d'] as const).map((p) => (
 <Button
 key={p}
 size="sm"
 variant={activePeriod === p ? 'default' : 'outline'}
 className="h-6 px-2 text-xs"
 onClick={() => handleSelectPeriod(p)}
 >
 {periodLabels[p]}
 </Button>
 ))}
 </div>
 </div>

 {/* شريط الشعل */}
 <div className="space-y-2">
 <div className="flex items-center justify-between text-xs">
 <span className="text-muted-foreground">نسبة الأسهم النشطة</span>
 <span className="font-bold tabular-nums">{activity.activityPct}%</span>
 </div>
 <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
 <div
 className={`h-full rounded-full transition-all duration-500 ${
 activity.activityPct > 30 ? 'bg-loss' :
 activity.activityPct > 15 ? 'bg-warning' :
 'bg-profit'
 }`}
 style={{ width: `${Math.min(activity.activityPct, 100)}%` }}
 />
 </div>
 </div>

 {/* إحصائيات الفترة */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
 <div className="text-center p-2 rounded-lg bg-muted/30">
 <div className="text-xs text-muted-foreground">إجمالي المفحوص</div>
 <div className="text-sm font-bold tabular-nums">
 {Math.round(activity.totalStocks * periodMultiplier[activePeriod]).toLocaleString('ar-EG')}
 </div>
 </div>
 <div className="text-center p-2 rounded-lg bg-muted/30">
 <div className="text-xs text-muted-foreground">تجميع هادئ</div>
 <div className="text-sm font-bold tabular-nums text-warning">
 {Math.round(activity.quiet * periodMultiplier[activePeriod])}
 </div>
 </div>
 <div className="text-center p-2 rounded-lg bg-muted/30">
 <div className="text-xs text-muted-foreground">موجات منفجرة</div>
 <div className="text-sm font-bold tabular-nums text-loss">
 {Math.round(activity.explosive * periodMultiplier[activePeriod])}
 </div>
 </div>
 <div className="text-center p-2 rounded-lg bg-muted/30">
 <div className="text-xs text-muted-foreground">اختراق مبكر</div>
 <div className="text-sm font-bold tabular-nums text-profit">
 {Math.round(activity.earlyBreak * periodMultiplier[activePeriod])}
 </div>
 </div>
 </div>

 {lastUpdated && (
 <div className="text-xs text-muted-foreground mt-2 text-center">
 آخر مسح: {lastUpdated.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}
 </div>
 )}
 </Card>
 );
}

// ============================================================================
// KPI Card
// ============================================================================
export function KpiCard({ icon, label, value, sub, accent }: KpiCardProps) {
 const colors: Record<KpiCardProps['accent'], { bg: string; text: string; ring: string }> = {
 blue: { bg: 'bg-primary/10', text: 'text-primary ', ring: 'ring-primary /40' },
 amber: { bg: 'bg-warning/10', text: 'text-warning ', ring: 'ring-warning dark:ring-warning/40' },
 rose: { bg: 'bg-loss/10', text: 'text-loss ', ring: 'ring-loss /40' },
 emerald:{ bg: 'bg-profit/10', text: 'text-profit ', ring: 'ring-profit /40' },
 gold: { bg: 'bg-warning/10', text: 'text-warning ', ring: 'ring-yellow-100 dark:ring-yellow-900/40' },
 };
 const c = colors[accent];
 // FIX-UI-AUDIT: support both numeric (toLocaleString) and string (ticker
 // symbol) values — the new «أقوى زخم حالي» and «أعلى سيولة» cards pass
 // ticker strings, the count cards pass numbers.
 const isNumber = typeof value === 'number';
 const display = isNumber ? (value as number).toLocaleString('en-US') : value;
 return (
 <Card className="p-3 relative overflow-hidden">
 <div className="flex items-start justify-between gap-2">
 <div className="flex-1 min-w-0">
 <div className="text-xs text-muted-foreground mb-1 truncate">{label}</div>
 <div className={`font-bold font-mono ${c.text} ${isNumber ? 'text-2xl' : 'text-xl'}`}>{display}</div>
 {sub && <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>}
 </div>
 <div className={`h-9 w-9 rounded-lg ${c.bg} flex items-center justify-center flex-shrink-0`}>
 <div className={c.text}>{icon}</div>
 </div>
 </div>
 </Card>
 );
}
