'use client';

export const dynamic = "force-dynamic";

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trophy, Calendar, FileText } from 'lucide-react';
import { StockLeagueImageCard, type ReportPeriod } from '@/components/market/StockLeagueImageCard';
import { cn } from '@/lib/utils';

/* ============================================================
 REPORTS-HUB-039: Trading Reports Hub
 ============================================================
 مركز تقارير التداول — يعرض الدوري الممتاز للسوق حسب الفترة:
 يومي / أسبوعي / شهري / ربع سنوي / نص سنوي / سنوي.

 كل تقرير قابل للتحميل كـ PNG + النشر على تيليجرام.
 ============================================================ */

const PERIODS: Array<{ key: ReportPeriod; label: string; icon: typeof Calendar; description: string }> = [
 { key: 'daily', label: 'يومي', icon: Calendar, description: 'صفقات اليوم' },
 { key: 'weekly', label: 'أسبوعي', icon: Calendar, description: 'السبت - الخميس' },
 { key: 'monthly', label: 'شهري', icon: Calendar, description: 'الشهر الحالي' },
 { key: 'quarterly', label: 'ربع سنوي', icon: Calendar, description: 'Q1/Q2/Q3/Q4' },
 { key: 'semi_annual', label: 'نص سنوي', icon: Calendar, description: 'H1/H2' },
 { key: 'yearly', label: 'سنوي', icon: Calendar, description: 'السنة كاملة' },
];

export default function ReportsPage() {
 const [selectedPeriod, setSelectedPeriod] = useState<ReportPeriod>('monthly');

 return (
 <div className="min-h-screen bg-background p-4 md:p-6 space-y-6" dir="rtl">
 {/* Header */}
 <div className="flex items-center gap-3">
 <div className="w-12 h-12 rounded-full from-amber-400 to-amber-600 flex items-center justify-center">
 <FileText className="w-6 h-6 text-slate-900" />
 </div>
 <div>
 <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
 <Trophy className="h-7 w-7 text-warning" />
 مركز تقارير التداول
 </h1>
 <p className="text-muted-foreground text-sm md:text-base">
 الدوري الممتاز للسوق — تقارير احترافية قابلة للنشر على تليجرام وواتساب
 </p>
 </div>
 </div>

 {/* Period Selector */}
 <Card>
 <CardHeader>
 <CardTitle className="text-base flex items-center gap-2">
 <Calendar className="h-4 w-4 text-warning" />
 اختر الفترة الزمنية
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="flex flex-wrap gap-2">
 {PERIODS.map((p) => {
 const Icon = p.icon;
 const isActive = selectedPeriod === p.key;
 return (
 <Button
 key={p.key}
 variant={isActive ? 'default' : 'outline'}
 onClick={() => setSelectedPeriod(p.key)}
 className={cn(
 'flex flex-col items-center gap-0.5 h-auto py-2 px-4 min-w-[100px]',
 isActive
 ? 'from-amber-500 to-amber-600 text-white border-0'
 : 'hover:border-warning/20 hover:bg-warning/5 '
 )}
 >
 <div className="flex items-center gap-1.5">
 <Icon className="w-4 h-4" />
 <span className="font-bold text-sm">{p.label}</span>
 </div>
 <span className={cn('text-[10px]', isActive ? 'text-warning' : 'text-muted-foreground')}>
 {p.description}
 </span>
 </Button>
 );
 })}
 </div>
 </CardContent>
 </Card>

 {/* Report Card */}
 <div className="flex justify-center">
 <StockLeagueImageCard period={selectedPeriod} />
 </div>

 {/* Content Calendar Hint */}
 <Card className="from-amber-50 to-orange-50 dark:from-warning/5 dark:to-orange-950/20 border-warning/20 dark:border-warning/30">
 <CardContent className="p-4">
 <h3 className="text-sm font-bold text-warning dark:text-warning mb-2 flex items-center gap-1.5">
 <Calendar className="w-4 h-4" />
 📅 جدول النشر المقترح (Content Calendar)
 </h3>
 <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
 <div className="p-2 rounded-lg bg-background/50">
 <p className="font-bold text-warning dark:text-warning">📈 يومي</p>
 <p className="text-muted-foreground">نهاية كل يوم تداول (الخميس) — أكبر 5 صفقات طلعت النهارده</p>
 </div>
 <div className="p-2 rounded-lg bg-background/50">
 <p className="font-bold text-warning dark:text-warning">📊 أسبوعي</p>
 <p className="text-muted-foreground">يوم الجمعة — ملخص الأسبوع (أحسن إعلان يجذب المشتركين الجدد)</p>
 </div>
 <div className="p-2 rounded-lg bg-background/50">
 <p className="font-bold text-warning dark:text-warning">🏆 ربع سنوي</p>
 <p className="text-muted-foreground">كل 3 شهور — تقرير مفصل للناس اللي بتفكر تشترك باقة VIP السنوية</p>
 </div>
 </div>
 </CardContent>
 </Card>
 </div>
 );
}
