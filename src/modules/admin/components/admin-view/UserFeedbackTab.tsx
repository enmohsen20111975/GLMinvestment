/**
 * admin-view/UserFeedbackTab.tsx
 * =============================
 * Feedback list sub-component rendered inside the `feedback` tab.
 *
 * Shows:
 *  - 4 stat tiles by type (bug / suggestion / opinion / praise).
 *  - Scrollable list of feedback cards with type + status badges + rating stars
 *    + message body + page/contact metadata + status-change buttons (new →
 *    reviewed → resolved).
 *
 * Originally inlined at the bottom of AdminView.tsx (lines ~1955-2105, ~150 LOC)
 * as `UserFeedbackTab` + FEEDBACK_TYPE_META + FEEDBACK_STATUS_META constants.
 */

'use client';

import React from 'react';
import { MessageSquareText, RefreshCw, Star } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { FeedbackMetaEntry, FeedbackStatus, FeedbackType } from './types';

const FEEDBACK_TYPE_META: Record<FeedbackType, FeedbackMetaEntry> = {
 bug: { label: 'مشكلة', cls: 'border-loss bg-loss/10 text-loss border border-loss/20 ' },
 suggestion: { label: 'اقتراح', cls: 'border-warning bg-warning/10 text-warning dark:text-warning border border-warning/20 ' },
 opinion: { label: 'رأي / ملاحظة', cls: 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400' },
 praise: { label: 'إشادة', cls: 'border-profit bg-profit/10 text-profit border border-profit/20 ' },
};

const FEEDBACK_STATUS_META: Record<FeedbackStatus, FeedbackMetaEntry> = {
 new: { label: 'جديد', cls: 'bg-loss/10 text-loss border border-loss/20 ' },
 reviewed: { label: 'تمت المراجعة', cls: 'bg-warning/10 text-warning dark:text-warning border border-warning/20 ' },
 resolved: { label: 'تم الحل', cls: 'bg-profit/10 text-profit border border-profit/20 ' },
};

interface UserFeedbackTabProps {
 feedback: any[];
 loading: boolean;
 onRefresh: () => void;
 onStatusChange: (id: string, status: FeedbackStatus) => void;
}

export function UserFeedbackTab({
 feedback,
 loading,
 onRefresh,
 onStatusChange,
}: UserFeedbackTabProps) {
 const total = feedback.length;
 const byType = (t: string) => feedback.filter((f) => f.type === t).length;
 const newCount = feedback.filter((f) => f.status === 'new').length;

 if (loading && total === 0) {
 return (
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center gap-2">
 <MessageSquareText className="w-5 h-5 text-primary" />
 آراء المستخدمين
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 {Array.from({ length: 3 }).map((_, i) => (
 <Skeleton key={i} className="h-24 w-full" />
 ))}
 </CardContent>
 </Card>
 );
 }

 return (
 <Card>
 <CardHeader>
 <div className="flex items-center justify-between gap-2 flex-wrap">
 <div>
 <CardTitle className="flex items-center gap-2">
 <MessageSquareText className="w-5 h-5 text-primary" />
 آراء المستخدمين
 {newCount > 0 && (
 <Badge variant="destructive" className="mr-1">{newCount} جديد</Badge>
 )}
 </CardTitle>
 <CardDescription className="mt-1">
 البلاغات والآراء التي أرسلها المستخدمون من داخل المنصة.
 </CardDescription>
 </div>
 <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="gap-1">
 <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
 تحديث
 </Button>
 </div>
 {total > 0 && (
 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 mt-3">
 {(['bug', 'suggestion', 'opinion', 'praise'] as const).map((t) => (
 <div key={t} className={cn('rounded-lg border px-3 py-2 text-center', FEEDBACK_TYPE_META[t].cls)}>
 <div className="text-lg font-bold">{byType(t)}</div>
 <div className="text-xs">{FEEDBACK_TYPE_META[t].label}</div>
 </div>
 ))}
 </div>
 )}
 </CardHeader>
 <CardContent>
 {total === 0 ? (
 <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
 <MessageSquareText className="w-12 h-12 mb-3 opacity-40" />
 <p>لا توجد آراء أو بلاغات حتى الآن.</p>
 </div>
 ) : (
 <div className="space-y-3 max-h-[40rem] overflow-y-auto pr-1
 [&::-webkit-scrollbar]:w-2
 [&::-webkit-scrollbar-track]:bg-transparent
 [&::-webkit-scrollbar-thumb]:rounded-full
 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30">
 {feedback.map((f) => {
 const typeMeta = FEEDBACK_TYPE_META[f.type as FeedbackType] || FEEDBACK_TYPE_META.opinion;
 const statusMeta = FEEDBACK_STATUS_META[f.status as FeedbackStatus] || FEEDBACK_STATUS_META.new;
 return (
 <div key={f.id} className="rounded-lg border p-4">
 <div className="flex items-start justify-between gap-3 flex-wrap">
 <div className="flex items-center gap-2 flex-wrap">
 <Badge variant="outline" className={cn('text-xs', typeMeta.cls)}>
 {typeMeta.label}
 </Badge>
 <Badge className={cn('text-xs', statusMeta.cls)}>
 {statusMeta.label}
 </Badge>
 {typeof f.rating === 'number' && f.rating > 0 && (
 <span className="flex items-center gap-0.5 text-warning">
 {Array.from({ length: f.rating }).map((_, i) => (
 <Star key={i} className="w-3.5 h-3.5 fill-warning text-warning" />
 ))}
 </span>
 )}
 </div>
 <span className="text-xs text-muted-foreground" dir="ltr">
 {new Date(f.createdAt).toLocaleString('ar-EG')}
 </span>
 </div>
 <p className="mt-2 text-sm text-foreground leading-relaxed whitespace-pre-wrap">
 {f.message}
 </p>
 <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
 {f.contact && (
 <span dir="ltr">تواصل: {f.contact}</span>
 )}
 {f.page && (
 <span className="font-mono opacity-70" dir="ltr">صفحة: {f.page}</span>
 )}
 </div>
 <div className="mt-3 flex items-center gap-2">
 <span className="text-xs text-muted-foreground">تحديث الحالة:</span>
 {(['new', 'reviewed', 'resolved'] as const).map((s) => (
 <Button
 key={s}
 size="sm"
 variant={f.status === s ? 'default' : 'outline'}
 className="h-7 text-xs"
 onClick={() => onStatusChange(f.id, s)}
 >
 {FEEDBACK_STATUS_META[s].label}
 </Button>
 ))}
 </div>
 </div>
 );
 })}
 </div>
 )}
 </CardContent>
 </Card>
 );
}
