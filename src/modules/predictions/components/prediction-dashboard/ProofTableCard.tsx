/**
 * prediction-dashboard/ProofTableCard.tsx
 * =======================================
 * The big proof table card: header (title + outcome filter buttons + search
 * + sort selector + entry period selector) + body (mobile card list OR
 * desktop UnifiedTable OR skeleton OR error OR empty state).
 *
 * Originally inlined at lines 1556-1936 of PredictionTrackingDashboard.tsx
 * (~380 LOC). The desktop columns memo lives in `desktopColumns.tsx` and the
 * mobile card row lives in `MobilePredictionCard.tsx`.
 */

'use client';

import React, { useMemo } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Search, Target, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { UnifiedTable } from '@/components/shared/UnifiedTable';
import { buildDesktopColumns } from './desktopColumns';
import { MobilePredictionCard } from './MobilePredictionCard';
import type {
 LivePrediction,
 OutcomeFilter,
 SortBy,
 EntryPeriod,
 FocusTickerInfo,
} from './types';

interface ProofTableCardProps {
 loading: boolean;
 hasData: boolean;
 error: string | null;
 refreshing: boolean;
 fetchData: () => void;

 // Filtered predictions to display
 filteredPredictions: LivePrediction[];

 // Filters state (controlled)
 selectedOutcome: OutcomeFilter;
 setSelectedOutcome: React.Dispatch<React.SetStateAction<OutcomeFilter>>;
 searchQuery: string;
 setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
 sortBy: SortBy;
 setSortBy: React.Dispatch<React.SetStateAction<SortBy>>;
 entryPeriod: EntryPeriod;
 setEntryPeriod: React.Dispatch<React.SetStateAction<EntryPeriod>>;

 // Focus tickers (for the focus badge inside each row)
 focusTickers: Record<string, FocusTickerInfo>;

 // Proof modal opener
 onSelectProof: (p: LivePrediction) => void;
}

export function ProofTableCard({
 loading,
 hasData,
 error,
 refreshing,
 fetchData,
 filteredPredictions,
 selectedOutcome,
 setSelectedOutcome,
 searchQuery,
 setSearchQuery,
 sortBy,
 setSortBy,
 entryPeriod,
 setEntryPeriod,
 focusTickers,
 onSelectProof,
}: ProofTableCardProps) {
 const desktopColumns = useMemo(
 () => buildDesktopColumns(focusTickers, onSelectProof),
 [focusTickers, onSelectProof],
 );

 return (
 <Card className="border border-border/80 shadow-md rounded-2xl overflow-hidden bg-card">
 <CardHeader className="p-4 border-b border-border/60 space-y-3">
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
 <div className="flex items-center gap-2">
 <Target className="w-5 h-5 text-profit" />
 <CardTitle className="text-base font-black">
 جدول صفقات التوقعات الموثقة ({filteredPredictions.length} صفقة)
 </CardTitle>
 </div>

 {/* Outcome Filter Buttons */}
 <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
 {(['ALL', 'WIN', 'LOSS', 'PENDING', 'EXPIRED'] as const).map((outcomeKey) => (
 <button
 key={`outcome-${outcomeKey}`}
 onClick={() => setSelectedOutcome(outcomeKey)}
 className={cn(
 'px-2.5 py-1 text-xs font-bold rounded-lg transition-colors whitespace-nowrap border',
 selectedOutcome === outcomeKey
 ? 'bg-foreground text-background border-foreground shadow-xs'
 : 'bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground'
 )}
 >
 {outcomeKey === 'ALL' && 'الكل'}
 {outcomeKey === 'WIN' && '🎯 الناجحة (WIN)'}
 {outcomeKey === 'LOSS' && '🛑 الخاسرة (LOSS)'}
 {outcomeKey === 'PENDING' && '⏳ المعلقة (PENDING)'}
 {outcomeKey === 'EXPIRED' && '⏰ انتهى الأفق الزمني'}
 </button>
 ))}
 </div>
 </div>

 {/* Sub Toolbar: Search Bar + Sorting
 FEAT5-PERSONA-REMOVAL: Persona Quick Filter removed — production
 engine is V40.2 balanced-only; client should not see persona
 switcher buttons. The `selectedPersona` state is still controlled
 by clicking the balanced breakdown card above (toggles between
 'all' and 'balanced' for filtering historical predictions). */}
 <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
 {/* Search & Sort Controls */}
 <div className="flex items-center gap-2 w-full sm:w-auto">
 {/* Search Bar */}
 <div className="relative flex-1 sm:w-56">
 <Search className="absolute right-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
 <Input
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 placeholder="ابحث برمز السهم أو الاسم..."
 className="pr-8 h-8 text-xs bg-background border-border"
 dir="rtl"
 />
 {searchQuery && (
 <button
 onClick={() => setSearchQuery('')}
 className="absolute left-2 top-2 p-0.5 text-muted-foreground hover:text-foreground"
 >
 <X className="w-3 h-3" />
 </button>
 )}
 </div>

 {/* Sort Selector */}
 <select
 value={sortBy}
 onChange={(e) => setSortBy(e.target.value as any)}
 className="h-8 text-xs bg-background border border-border rounded-lg px-2 font-bold text-foreground"
 >
 <option value="return">الأعلى أرباحاً (%)</option>
 <option value="date">الأحدث تاريخاً</option>
 <option value="target">الأقرب للهدف</option>
 <option value="days">أيام التداول</option>
 </select>
 </div>
 </div>

 {/* P0-v17: فلتر تاريخ الدخول (client-side) */}
 <div className="flex items-center gap-1.5 pt-2 overflow-x-auto no-scrollbar">
 <span className="text-xs text-muted-foreground font-bold ml-1 flex-shrink-0">تاريخ الدخول:</span>
 {([
 { v: 'all', l: 'الكل' },
 { v: '7d', l: 'آخر أسبوع' },
 { v: '30d', l: 'آخر شهر' },
 { v: '90d', l: 'آخر 3 شهور' },
 ] as const).map((opt) => (
 <button
 key={`entry-period-${opt.v}`}
 onClick={() => setEntryPeriod(opt.v)}
 className={cn(
 'px-2.5 py-1 text-xs font-bold rounded-lg border transition-all whitespace-nowrap',
 entryPeriod === opt.v
 ? 'bg-warning/15 border-warning text-warning font-extrabold'
 : 'bg-background border-border text-muted-foreground hover:text-foreground'
 )}
 >
 {opt.l}
 </button>
 ))}
 {entryPeriod !== 'all' && (
 <button
 onClick={() => setEntryPeriod('all')}
 className="px-1.5 py-1 text-xs text-muted-foreground hover:text-loss"
 title="إلغاء الفلتر"
 >
 <X className="w-3 h-3" />
 </button>
 )}
 </div>
 </CardHeader>

 <CardContent className="p-0">
 {loading && !hasData ? (
 <div className="p-8 space-y-3">
 <Skeleton className="h-12 w-full" />
 <Skeleton className="h-12 w-full" />
 <Skeleton className="h-12 w-full" />
 </div>
 ) : error && !hasData ? (
 // RL-FIX-16-FE: عرض خطأ واضح بدل "لا توجد صفقات" المضللة.
 // قبل كده، لما Python backend كان مش شغال، كان بيظهر رسالة "لا توجد صفقات
 // تطابق خيارات الفلترة" — المستخدم يفتكر إن الفلاتر غلط. دلوقتي بنوضّح
 // إن المشكلة في الاتصال بالخادم، مش في الفلاتر.
 <div className="p-12 text-center space-y-3 text-muted-foreground">
 <AlertTriangle className="w-10 h-10 mx-auto text-warning" />
 <p className="font-bold text-sm text-foreground">تعذّر تحميل بيانات التوقعات</p>
 <p className="text-xs">{error}</p>
 <p className="text-xs text-muted-foreground/70">
 تعذّر تحميل البيانات، اضغط تحديث للمحاولة مرة أخرى
 </p>
 <Button
 variant="outline"
 size="sm"
 onClick={fetchData}
 disabled={refreshing}
 className="mt-2 h-8 text-xs font-bold gap-1"
 >
 {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
 إعادة المحاولة
 </Button>
 </div>
 ) : filteredPredictions.length === 0 ? (
 <div className="p-12 text-center space-y-2 text-muted-foreground">
 <Target className="w-10 h-10 mx-auto opacity-30" />
 <p className="font-bold text-sm">لا توجد صفقات تطابق خيارات الفلترة المحددة</p>
 <p className="text-xs">جرب تغيير الفترة الزمنية أو تحديد شخصية أخرى</p>
 </div>
 ) : (
 <>
 {/* Mobile Card View (on small screens) */}
 <div className="block sm:hidden divide-y divide-border/40">
 {filteredPredictions.map((pred, idx) => (
 <MobilePredictionCard
 key={`mob-pred-${pred.ticker}-${idx}`}
 pred={pred}
 idx={idx}
 focusTickers={focusTickers}
 onSelectProof={onSelectProof}
 />
 ))}
 </div>

 {/* Desktop Table View — UnifiedTable (on sm and up) */}
 <div className="hidden sm:block">
 <UnifiedTable<LivePrediction>
 columns={desktopColumns}
 data={filteredPredictions}
 keyField="ticker"
 maxHeight="max-h-[70vh]"
 emptyTextAr="لا توجد صفقات تطابق الفلاتر الحالية"
 onRowClick={(p) => onSelectProof(p)}
 rowClassName={() => 'hover:bg-profit/5 group cursor-pointer'}
 publishable
 publishTitle="تتبّع التوقعات"
 publishFilename={`predictions-tracking-${new Date().toISOString().slice(0,10)}`}
 publishHashtags={['توقعات_الأسهم', 'EGX', 'بورصة_مصر', 'تداول', 'باك_تست']}
 />
 </div>
 </>
 )}
 </CardContent>
 </Card>
 );
}
