'use client';

/**
 * LearnedLessonsDashboard (P1-GEMS-WIRING)
 * ========================================
 * يعرض أعلى الدروس المستفادة من predictions.db.learned_lessons (19,464 صف).
 * الدروس هي بيانات تدريب الـ AI — كل درس يمثل نمط ← نتيجة ← توقّع.
 *
 * المكوّن:
 * - بطاقات لأعلى 20 درس (افتراضياً) مرتبة حسب عدد مرات الحدوث
 * - فلترة بالـ condition (dropdown)
 * - فلترة بالـ outcome (success / failure / all)
 * - ترتيب حسب occurrences / failure_rate / avg_return / updated_at
 * - RTL Arabic + shadcn/ui Card-based layout
 * - كل بطاقة تعرض: الشرط ← النتيجة ← التوقّع + مؤشرات
 *
 * يتم تركيبه كتبويب "دروس AI" في MarketAnalysisView.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
 Brain, RefreshCw, Loader2, AlertCircle, TrendingUp, TrendingDown,
 Lightbulb, Activity, AlertTriangle, CheckCircle2, XCircle, Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MarketType } from '@/lib/store';

interface LearnedLesson {
 id: number;
 lesson_type: string | null;
 condition: string;
 outcome: string;
 failure_rate: number | null;
 occurrence_count: number;
 avg_return: number | null;
 recommendation: string | null;
 created_at: string | null;
 updated_at: string | null;
}

interface ApiResponse {
 success: boolean;
 total: number;
 returned: number;
 lessons: LearnedLesson[];
 conditions: string[];
 filters: { limit: number; condition: string | null; outcome: string | null; sort: string };
 error?: string;
}

const RECOMMENDATION_AR: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
 reduce_exposure: { label: 'تقليل الانكشاف', color: 'text-loss bg-loss/10 border-loss/20', icon: <TrendingDown className="h-3.5 w-3.5" /> },
 reduce_weight: { label: 'تقليل الوزن', color: 'text-warning bg-warning/10 border-orange-500/30', icon: <TrendingDown className="h-3.5 w-3.5" /> },
 increase_weight: { label: 'زيادة الوزن', color: 'text-profit bg-profit/10 border-profit/20', icon: <TrendingUp className="h-3.5 w-3.5" /> },
 add_filter: { label: 'إضافة فلتر', color: 'text-warning bg-warning/10 border-warning/20', icon: <Filter className="h-3.5 w-3.5" /> },
};

const SORT_OPTIONS = [
 { value: 'occurrences', label: 'الأكثر تكراراً' },
 { value: 'failure_rate', label: 'أعلى معدل فشل' },
 { value: 'avg_return', label: 'أعلى عائد متوسط' },
 { value: 'updated_at', label: 'الأحدث' },
];

const OUTCOME_OPTIONS = [
 { value: 'all', label: 'كل النتائج' },
 { value: 'success', label: 'نجاح فقط' },
 { value: 'failure', label: 'فشل فقط' },
];

interface LearnedLessonsDashboardProps {
 market?: MarketType;
 initialLimit?: number;
}

export function LearnedLessonsDashboard({ initialLimit = 50 }: LearnedLessonsDashboardProps) {
 const [data, setData] = useState<ApiResponse | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);

 const [condition, setCondition] = useState<string>('all');
 const [outcome, setOutcome] = useState<string>('all');
 const [sort, setSort] = useState<string>('occurrences');

 const fetchData = useCallback(async () => {
 setLoading(true);
 setError(null);
 try {
 const params = new URLSearchParams({ limit: String(initialLimit), sort });
 if (condition !== 'all') params.set('condition', condition);
 if (outcome !== 'all') params.set('outcome', outcome);
 const res = await fetch(`/api/predictions/learned-lessons?${params.toString()}`, { cache: 'no-store' });
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const json = (await res.json()) as ApiResponse;
 if (!json.success) throw new Error(json.error || 'فشل في جلب البيانات');
 setData(json);
 } catch (err) {
 setError(err instanceof Error ? err.message : 'خطأ غير معروف');
 } finally {
 setLoading(false);
 }
 }, [initialLimit, condition, outcome, sort]);

 useEffect(() => {
 fetchData();
 }, [fetchData]);

 const lessons = data?.lessons ?? [];

 const stats = useMemo(() => {
 if (!lessons.length) return null;
 const totalOccurrences = lessons.reduce((s, l) => s + (l.occurrence_count || 0), 0);
 const failures = lessons.filter((l) => l.outcome === 'failure').length;
 const successes = lessons.filter((l) => l.outcome === 'success').length;
 const avgFailureRate = lessons.reduce((s, l) => s + (l.failure_rate || 0), 0) / lessons.length;
 return {
 totalOccurrences,
 failures,
 successes,
 avgFailureRate: (avgFailureRate ?? 0).toFixed(1),
 };
 }, [lessons]);

 return (
 <div className="space-y-4" dir="rtl">
 {/* Header */}
 <Card className="border-violet-500/30 from-violet-500/5 to-fuchsia-500/5">
 <CardHeader className="pb-3">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div className="flex items-center gap-2">
 <div className="p-2 rounded-lg bg-violet-500/10">
 <Brain className="h-5 w-5 text-violet-600" />
 </div>
 <div>
 <CardTitle className="text-base">دروس الذكاء الاصطناعي</CardTitle>
 <CardDescription className="text-xs">
 بيانات تدريب الـ AI المُستخلصة من {data?.total?.toLocaleString('ar-EG') ?? '—'} درس
 </CardDescription>
 </div>
 </div>
 <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
 <RefreshCw className={cn('h-3.5 w-3.5 ml-1', loading && 'animate-spin')} />
 تحديث
 </Button>
 </div>
 </CardHeader>
 {stats && (
 <CardContent className="pt-0 pb-3">
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
 <StatPill
 label="إجمالي الدروس المعروضة"
 value={lessons.length.toString()}
 icon={<Activity className="h-3.5 w-3.5 text-primary" />}
 />
 <StatPill
 label="إجمالي التكرارات"
 value={stats.totalOccurrences.toLocaleString('ar-EG')}
 icon={<Lightbulb className="h-3.5 w-3.5 text-warning" />}
 />
 <StatPill
 label="دروس فاشلة"
 value={stats.failures.toString()}
 icon={<XCircle className="h-3.5 w-3.5 text-loss" />}
 />
 <StatPill
 label="متوسط معدل الفشل"
 value={`${stats.avgFailureRate}%`}
 icon={<AlertTriangle className="h-3.5 w-3.5 text-warning" />}
 />
 </div>
 </CardContent>
 )}
 </Card>

 {/* Filters */}
 <Card>
 <CardContent className="p-3">
 <div className="flex flex-wrap gap-2 items-end">
 <div className="flex-1 min-w-[200px]">
 <label className="text-xs text-muted-foreground mb-1 block">فلترة بالشرط</label>
 <Select value={condition} onValueChange={setCondition} disabled={loading}>
 <SelectTrigger className="w-full">
 <SelectValue placeholder="كل الشروط" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">كل الشروط</SelectItem>
 {(data?.conditions ?? []).map((c) => (
 <SelectItem key={c} value={c}>
 {c.length > 80 ? c.slice(0, 80) + '…' : c}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="w-[150px]">
 <label className="text-xs text-muted-foreground mb-1 block">النتيجة</label>
 <Select value={outcome} onValueChange={setOutcome} disabled={loading}>
 <SelectTrigger className="w-full">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 {OUTCOME_OPTIONS.map((o) => (
 <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="w-[170px]">
 <label className="text-xs text-muted-foreground mb-1 block">ترتيب حسب</label>
 <Select value={sort} onValueChange={setSort} disabled={loading}>
 <SelectTrigger className="w-full">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 {SORT_OPTIONS.map((s) => (
 <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Lessons grid */}
 {loading ? (
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
 {Array.from({ length: 6 }).map((_, i) => (
 <Skeleton key={i} className="h-40 rounded-xl" />
 ))}
 </div>
 ) : error ? (
 <Card className="border-loss/20">
 <CardContent className="p-6 text-center space-y-2">
 <AlertCircle className="h-6 w-6 text-loss mx-auto" />
 <p className="text-sm text-loss">{error}</p>
 <Button size="sm" variant="outline" onClick={fetchData}>
 <RefreshCw className="h-3 w-3 ml-1" /> حاول مرة أخرى
 </Button>
 </CardContent>
 </Card>
 ) : lessons.length === 0 ? (
 <Card>
 <CardContent className="p-8 text-center text-muted-foreground">
 <Brain className="h-8 w-8 mx-auto mb-2 opacity-50" />
 <p className="text-sm">لا توجد دروس مطابقة للفلاتر المحددة</p>
 </CardContent>
 </Card>
 ) : (
 <ScrollArea className="h-[calc(100vh-380px)] min-h-[400px]">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pr-1">
 {lessons.map((lesson) => (
 <LessonCard key={lesson.id} lesson={lesson} />
 ))}
 </div>
 </ScrollArea>
 )}
 </div>
 );
}

function StatPill({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
 return (
 <div className="rounded-lg bg-muted/40 border border-muted px-3 py-2">
 <div className="flex items-center gap-1.5 mb-0.5">
 {icon}
 <span className="text-xs text-muted-foreground">{label}</span>
 </div>
 <div className="text-sm font-bold tabular-nums">{value}</div>
 </div>
 );
}

function LessonCard({ lesson }: { lesson: LearnedLesson }) {
 const isFailure = lesson.outcome === 'failure';
 const rec = lesson.recommendation ? RECOMMENDATION_AR[lesson.recommendation] : null;
 const occLabel = lesson.occurrence_count >= 1000
 ? `${(lesson.occurrence_count / 1000).toFixed(1)}K`
 : String(lesson.occurrence_count);

 return (
 <Card
 className={cn(
 'overflow-hidden transition-shadow hover:shadow-md',
 isFailure
 ? 'border-loss/20 bg-loss/[0.02]'
 : 'border-profit/20 bg-profit/[0.02]',
 )}
 >
 <CardHeader className="pb-2 pt-3 px-4">
 <div className="flex items-start justify-between gap-2">
 <div className="flex items-center gap-2 flex-1 min-w-0">
 <div
 className={cn(
 'p-1.5 rounded-md flex-shrink-0',
 isFailure ? 'bg-loss/10' : 'bg-profit/10',
 )}
 >
 {isFailure ? (
 <XCircle className="h-4 w-4 text-loss" />
 ) : (
 <CheckCircle2 className="h-4 w-4 text-profit" />
 )}
 </div>
 <CardTitle
 className="text-sm font-mono leading-tight break-words"
 dir="ltr"
 >
 {lesson.condition}
 </CardTitle>
 </div>
 <Badge
 variant="outline"
 className={cn(
 'flex-shrink-0 text-xs gap-1',
 isFailure
 ? 'border-loss/20 text-loss bg-loss/5'
 : 'border-profit/20 text-profit bg-profit/5',
 )}
 >
 {isFailure ? 'فشل' : 'نجاح'}
 </Badge>
 </div>
 </CardHeader>
 <CardContent className="px-4 pb-3 pt-0 space-y-2">
 {/* Metrics row */}
 <div className="grid grid-cols-3 gap-2">
 <Metric
 label="التكرارات"
 value={occLabel}
 sub={lesson.occurrence_count.toLocaleString('ar-EG')}
 tone="blue"
 />
 <Metric
 label="معدل الفشل"
 value={`${lesson.failure_rate != null ? lesson.failure_rate.toFixed(1) : '—'}%`}
 tone={lesson.failure_rate != null && lesson.failure_rate > 70 ? 'red' : 'amber'}
 />
 <Metric
 label="العائد المتوسط"
 value={`${lesson.avg_return != null ? lesson.avg_return.toFixed(2) : '—'}%`}
 tone={lesson.avg_return != null && lesson.avg_return > 0 ? 'green' : 'muted'}
 />
 </div>

 {/* Recommendation */}
 {rec && (
 <div className={cn('rounded-lg border px-3 py-2 flex items-center gap-2', rec.color)}>
 {rec.icon}
 <div className="flex-1 min-w-0">
 <div className="text-xs text-muted-foreground">توقّع الـ AI</div>
 <div className="text-sm font-semibold">{rec.label}</div>
 </div>
 </div>
 )}

 {/* Lesson type + updated */}
 <div className="flex items-center justify-between text-xs text-muted-foreground">
 {lesson.lesson_type && (
 <Badge variant="outline" className="text-xs font-mono">
 {lesson.lesson_type}
 </Badge>
 )}
 {lesson.updated_at && (
 <span>
 آخر تحديث: {new Date(lesson.updated_at).toLocaleDateString('ar-EG')}
 </span>
 )}
 </div>
 </CardContent>
 </Card>
 );
}

function Metric({
 label,
 value,
 sub,
 tone,
}: {
 label: string;
 value: string;
 sub?: string;
 tone: 'blue' | 'red' | 'amber' | 'green' | 'muted';
}) {
 const toneClass = {
 blue: 'text-primary bg-primary/5',
 red: 'text-loss bg-loss/5',
 amber: 'text-warning bg-warning/5',
 green: 'text-profit bg-profit/5',
 muted: 'text-muted-foreground bg-muted/20',
 }[tone];

 return (
 <div className={cn('rounded-lg px-2 py-1.5 text-center', toneClass)}>
 <div className="text-xs opacity-80">{label}</div>
 <div className="text-sm font-bold tabular-nums">{value}</div>
 {sub && <div className="text-xs opacity-60">{sub}</div>}
 </div>
 );
}

export default LearnedLessonsDashboard;
