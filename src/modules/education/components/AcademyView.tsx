'use client';

// P40-ACADEMY: Main view wrapper — combines all 5 pillars in tabs.
// Pillar 1: PaperTradingWorkstation (built by P40-1 in parallel).
// Pillar 2: CandlestickSimulator (built by P40-2 in parallel).
// Pillar 3: StrategySandbox (built by P40-3 in parallel).
// Pillar 4: AcademyEncyclopedia (built locally — P40-4).
// Pillar 5: LessonPDFExporter (built locally — P40-4, used by Pillar 4).
//
// Rule 63 (Education Unification 2026-10-01 — Task 9-A Step 2):
// Added a 5th tab "🎓 دروس متقدمة" that wires `content/education/*.md`
// (12 institutional-grade lessons written by the owner) into the user-facing
// academy screen. The 12 MD files were previously orphaned (only consumed
// by the admin-only ContentStudioHub for video card generation). They are
// now surfaced to end-users via the public `/api/ads/educational-lessons`
// API which reads the MD files at request time and returns parsed sections
// + fullContent. No new files created — the AdvancedLessonsTab component
// is inlined in this file (Rule 63.2 NO-NEW-SCREENS-FILES compliant).

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
 Sheet,
 SheetContent,
 SheetHeader,
 SheetTitle,
 SheetDescription,
} from '@/components/ui/sheet';
import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
 AlertTriangle,
 ArrowDown,
 ArrowDownCircle,
 BookOpen,
 Brain,
 Calculator,
 CheckCircle2,
 ChevronDown,
 ChevronLeft,
 Clock,
 Download,
 GraduationCap,
 Layers,
 ListChecks,
 Loader2,
 Lock,
 Minus,
 RefreshCw,
 Rocket,
 Search,
 ShieldAlert,
 Target,
 TrendingDown,
 TrendingUp,
 XCircle,
 type LucideIcon,
} from 'lucide-react';
import { AcademyEncyclopedia } from './AcademyEncyclopedia';
import { PaperTradingWorkstation } from './PaperTradingWorkstation';
import { CandlestickSimulator } from './CandlestickSimulator';
import { StrategySandbox } from './StrategySandbox';
import {
 LossAversionCurve,
 SopPipelineFlow,
 TradingSystemPipeline,
 MarketStagesVisual,
 OrderFlowVisual,
 CandlestickPatternsVisual,
 RiskRewardVisual,
 PortfolioAllocationVisual,
} from './LearningVisuals';
import { PortfolioSimulator } from './PortfolioSimulator';
import { EntryTimingSimulator } from './EntryTimingSimulator';
import { useAppStore } from '@/lib/store';
import { getTrialStatus } from '@/lib/subscription-gate';

export function AcademyView() {
 return (
 <div className="flex min-h-screen flex-col" dir="rtl">
 {/* Sticky header */}
 <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
 <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 sm:px-6">
 <div className="flex items-center gap-2">
 <span className="text-2xl" role="img" aria-label="أكاديمية">
 🎓
 </span>
 <h1 className="text-lg font-bold leading-tight sm:text-xl">
 أكاديمية دليل الاستثمار التعليمية ومحاكي التداول الحي
 </h1>
 </div>
 <p className="text-xs text-muted-foreground sm:text-sm">
 تعلّم الأساسيات، تدرّب على التداول الورقي بالأسعار الحقيقية، وابنِ استراتيجيتك
 بثقة — كل ذلك في مكان واحد.
 </p>
 </div>
 </header>

 {/* Main content */}
 <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4 sm:px-6">
 <Tabs defaultValue="encyclopedia" className="w-full">
 <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
 <TabsTrigger value="encyclopedia">📚 الموسوعة</TabsTrigger>
 <TabsTrigger value="paper-trading">💻 التداول الورقي</TabsTrigger>
 <TabsTrigger value="candle-sim">🕯️ محاكي الشموع</TabsTrigger>
 <TabsTrigger value="strategy-lab">📊 مختبر الاستراتيجيات</TabsTrigger>
 <TabsTrigger value="advanced-lessons">🎓 دروس متقدمة</TabsTrigger>
 <TabsTrigger value="trading-floor">
 <span className="text-profit ">📈</span> أرض التداول
 </TabsTrigger>
 <TabsTrigger value="practical-tools">
 <span className="text-warning ">🧮</span> الأدوات العملية
 </TabsTrigger>
 <TabsTrigger value="advanced-lab">
 <span className="text-profit ">🔬</span> المختبر المتقدم
 </TabsTrigger>
 </TabsList>

 <TabsContent value="encyclopedia" className="mt-4 focus-visible:outline-none">
 <AcademyEncyclopedia />
 </TabsContent>
 <TabsContent value="paper-trading" className="mt-4 focus-visible:outline-none">
 <PaperTradingWorkstation />
 </TabsContent>
 <TabsContent value="candle-sim" className="mt-4 focus-visible:outline-none">
 <CandlestickSimulator />
 </TabsContent>
 <TabsContent value="strategy-lab" className="mt-4 focus-visible:outline-none">
 <StrategySandbox />
 </TabsContent>
 <TabsContent value="advanced-lessons" className="mt-4 focus-visible:outline-none">
 <AdvancedLessonsTab />
 </TabsContent>
 <TabsContent value="trading-floor" className="mt-4 focus-visible:outline-none">
 <TradingFloorView />
 </TabsContent>
 <TabsContent value="practical-tools" className="mt-4 focus-visible:outline-none">
 <PracticalToolsView />
 </TabsContent>
 <TabsContent value="advanced-lab" className="mt-4 focus-visible:outline-none">
 <AdvancedLabView />
 </TabsContent>
 </Tabs>
 </main>

 {/* Footer */}
 <footer className="border-t bg-muted/30" dir="rtl">
 <div className="mx-auto max-w-7xl px-4 py-3 text-center text-xs text-muted-foreground sm:px-6">
 أكاديمية دليل الاستثمار — تعلّم، تدرّب، ثم استثمر بثقة
 </div>
 </footer>
 </div>
 );
}

/* ============================================================
 AdvancedLessonsTab — wires content/education/*.md into the UI
 ============================================================
 Fetches the 12 institutional-grade lessons from
 `/api/ads/educational-lessons` (which reads `content/education/*.md`
 at request time). Renders a sidebar list + a master-detail panel.
 "إظهار النص الكامل" button fetches the full markdown content of
 the selected lesson and renders it with a minimal markdown-to-JSX
 formatter (headings / bullets / numbered lists / code blocks /
 blockquotes / bold inline).
 ============================================================ */

interface AdvancedLessonSection {
 heading: string;
 content: string;
}

interface AdvancedLesson {
 id: string;
 filename: string;
 title: string;
 emoji: string;
 level: string;
 duration: string;
 tagline: string;
 sections: AdvancedLessonSection[];
 keyPoints: string[];
 fullContent?: string;
}

const LEVEL_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
 'مبتدئ': 'secondary',
 'متوسط': 'default',
 'متقدم': 'destructive',
};

function AdvancedLessonsTab() {
 const [lessons, setLessons] = React.useState<AdvancedLesson[]>([]);
 const [loading, setLoading] = React.useState(true);
 const [error, setError] = React.useState<string | null>(null);
 const [activeId, setActiveId] = React.useState<string | null>(null);
 const [fullCache, setFullCache] = React.useState<Record<string, string>>({});
 const [loadingFull, setLoadingFull] = React.useState<string | null>(null);
 const [showFull, setShowFull] = React.useState(false);

 // PAYWALL Gate 4: first 3 lessons free, lessons 4-12 locked (blurred) for free users post-trial.
 // Titles remain visible to communicate depth (12 institutional lessons).
 const subscriptionUser = useAppStore((s) => s.user);
 const lessonsSubStatus = getTrialStatus(subscriptionUser);
 const lessonsLocked = lessonsSubStatus.isFreeUser && lessonsSubStatus.isTrialExpired;
 const FREE_LESSON_COUNT = 3;

 React.useEffect(() => {
 let cancelled = false;
 fetch('/api/ads/educational-lessons')
 .then((r) => r.json())
 .then((data) => {
 if (cancelled) return;
 if (data.success && Array.isArray(data.lessons) && data.lessons.length > 0) {
 setLessons(data.lessons);
 setActiveId(data.lessons[0].id);
 } else {
 setError(data.error || 'فشل تحميل الدروس المتقدمة');
 }
 })
 .catch((err) => {
 if (!cancelled) setError(err?.message || 'خطأ في الشبكة');
 })
 .finally(() => {
 if (!cancelled) setLoading(false);
 });
 return () => {
 cancelled = true;
 };
 }, []);

 const active = React.useMemo(
 () => lessons.find((l) => l.id === activeId) ?? null,
 [lessons, activeId],
 );

 // PAYWALL Gate 4: determine if the active lesson is beyond the free tier (first 3)
 const activeIndex = React.useMemo(
 () => (active ? lessons.findIndex((l) => l.id === active.id) : -1),
 [lessons, active],
 );
 const isLessonLocked = lessonsLocked && activeIndex >= FREE_LESSON_COUNT;

 const loadFull = React.useCallback(
 async (id: string) => {
 if (fullCache[id]) {
 setShowFull(true);
 return;
 }
 setLoadingFull(id);
 try {
 const res = await fetch(
 `/api/ads/educational-lessons?id=${encodeURIComponent(id)}`,
 );
 const data = await res.json();
 if (data.success && data.lessons?.[0]?.fullContent) {
 setFullCache((prev) => ({ ...prev, [id]: data.lessons[0].fullContent }));
 setShowFull(true);
 }
 } catch {
 /* swallow — preview sections already visible */
 } finally {
 setLoadingFull(null);
 }
 },
 [fullCache],
 );

 React.useEffect(() => {
 // Reset "show full" toggle when user switches lesson
 setShowFull(false);
 }, [activeId]);

 if (loading) {
 return (
 <div className="flex min-h-[400px] items-center justify-center text-muted-foreground">
 <Loader2 className="ml-2 h-5 w-5 animate-spin" />
 جارٍ تحميل الدروس المتقدمة…
 </div>
 );
 }

 if (error) {
 return (
 <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
 <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-destructive" />
 <p className="text-sm font-semibold text-destructive">{error}</p>
 <Button
 variant="outline"
 size="sm"
 className="mt-3"
 onClick={() => {
 setLoading(true);
 setError(null);
 fetch('/api/ads/educational-lessons')
 .then((r) => r.json())
 .then((d) => {
 if (d.success && d.lessons?.length) {
 setLessons(d.lessons);
 setActiveId(d.lessons[0].id);
 } else {
 setError(d.error || 'فشل تحميل الدروس');
 }
 })
 .catch((e) => setError(e?.message || 'خطأ في الشبكة'))
 .finally(() => setLoading(false));
 }}
 >
 <RefreshCw className="ml-2 h-4 w-4" />
 إعادة المحاولة
 </Button>
 </div>
 );
 }

 if (!active) {
 return (
 <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
 لا توجد دروس متاحة.
 </div>
 );
 }

 const fullContent = fullCache[active.id];

 return (
 <div dir="rtl" className="flex min-h-[600px] flex-col gap-4">
 {/* Header banner */}
 <div className="rounded-lg border to-transparent p-4 dark:">
 <div className="flex items-start gap-3">
 <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning text-xl /50">
 <GraduationCap className="h-5 w-5 text-warning " />
 </div>
 <div className="flex-1">
 <h2 className="text-base font-bold sm:text-lg">دروس متقدمة — من محتوى المالك</h2>
 <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
 21 درساً مؤسسياً مُعَدّاً بمستوى احترافي يغطي التمويل السلوكي، تحليل المراحل،
 CAN SLIM، الانعكاس المتوسط، إدارة المخاطر الكمية، قراءة السعر، القصص التاريخية،
 الكريبتو (مبتدئ + متقدم)، البنية الدقيقة للسوق، الاقتصاد الكلي، التداول الكمي،
 فيبوناتشي، مذكرة التداول، التمويل الإسلامي، السوق السعودي (TADAWUL)،
 أسواق الكويت وقطر، الأسهم الأمريكية، تداول الذهب والمعادن،
 والتحليل عبر الأسواق (Intermarket Analysis). المحتوى يُقرأ مباشرةً
 من <code className="rounded bg-muted px-1 text-xs">content/education/*.md</code>.
 </p>
 </div>
 <Badge variant="outline" className="shrink-0 gap-1">
 <BookOpen className="h-3 w-3" />
 {lessons.length} درس
 </Badge>
 </div>
 </div>

 <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
 {/* Sidebar: lesson list */}
 <aside className="lg:sticky lg:top-20 lg:self-start">
 <div className="rounded-lg border bg-card">
 <div className="border-b px-4 py-3">
 <div className="flex items-center gap-2 font-semibold">
 <BookOpen className="h-4 w-4 text-warning" />
 فهرس الدروس المتقدمة
 </div>
 </div>
 <ScrollArea className="h-[60vh] lg:h-[70vh]">
 {/* Task 29 Fix 5 — Mobile UX: removed the Accordion wrapper that forced an
 extra click to expand the lesson list. The sidebar is already inside
 a ScrollArea, so the lessons are directly accessible. */}
 <div className="border-b px-4 py-2 text-xs text-muted-foreground">
 الكل ({lessons.length})
 </div>
 <ul className="space-y-1 p-2">
 {lessons.map((l) => {
 const isActive = l.id === activeId;
 return (
 <li key={l.id}>
 <button
 type="button"
 onClick={() => setActiveId(l.id)}
 className={cn(
 'flex w-full items-start gap-2 rounded-md px-2 py-2 text-right text-sm transition-colors',
 isActive
 ? 'bg-warning font-semibold text-warning/40 '
 : 'hover:bg-accent/60',
 )}
 >
 <span className="text-base">{l.emoji}</span>
 <span className="flex-1 leading-snug">{l.title}</span>
 <Badge
 variant={LEVEL_VARIANT[l.level] ?? 'outline'}
 className="shrink-0 text-xs"
 >
 {l.level}
 </Badge>
 </button>
 </li>
 );
 })}
 </ul>
 </ScrollArea>
 </div>
 </aside>

 {/* Main lesson area */}
 <main className="min-w-0">
 <article className="rounded-lg border bg-card">
 {/* Lesson header */}
 <header className="border-b to-transparent p-5 dark:">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div className="flex items-start gap-3">
 <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-warning text-2xl /50">
 {active.emoji}
 </div>
 <div>
 <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
 <span className="font-semibold text-warning ">
 درس متقدم
 </span>
 <span>·</span>
 <span className="font-mono">{active.filename}</span>
 </div>
 <h2 className="text-xl font-bold leading-tight sm:text-2xl">
 {active.title}
 </h2>
 {active.tagline ? (
 <p className="mt-1 text-sm text-muted-foreground">
 {active.tagline}
 </p>
 ) : null}
 <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
 <Badge variant={LEVEL_VARIANT[active.level] ?? 'outline'}>
 {active.level}
 </Badge>
 <Badge variant="outline" className="gap-1">
 <Clock className="h-3 w-3" />
 {active.duration}
 </Badge>
 <Badge variant="outline">
 {active.sections.length} أقسام
 </Badge>
 </div>
 </div>
 </div>
 <Button
 variant={showFull ? 'secondary' : 'default'}
 size="sm"
 disabled={loadingFull === active.id || isLessonLocked}
 onClick={() => loadFull(active.id)}
 >
 {loadingFull === active.id ? (
 <Loader2 className="ml-2 h-4 w-4 animate-spin" />
 ) : showFull ? (
 <CheckCircle2 className="ml-2 h-4 w-4" />
 ) : isLessonLocked ? (
 <Lock className="ml-2 h-4 w-4" />
 ) : (
 <Download className="ml-2 h-4 w-4" />
 )}
 {isLessonLocked
 ? '🔒 اشترك لفتح الدرس'
 : showFull
 ? 'النص الكامل مُعرض'
 : 'إظهار النص الكامل'}
 </Button>
 </div>
 </header>

 {/* Lesson body */}
 <div className="space-y-6 p-5">
 {isLessonLocked ? (
 <div className="space-y-4">
 {/* Blurred preview of lesson content (titles visible, body obscured) */}
 <div className="pointer-events-none select-none blur-sm opacity-60 space-y-4" aria-hidden="true">
 {active.sections.slice(0, 2).map((section, idx) => (
 <section key={idx} className="space-y-3">
 <h3 className="flex items-center gap-2 border-r-4 border-warning pr-3 text-lg font-bold">
 <span className="text-muted-foreground/60">{idx + 1}.</span>
 {section.heading}
 </h3>
 <AdvancedMarkdownRenderer content={section.content} compact />
 </section>
 ))}
 </div>

 {/* Lock CTA overlay */}
 <div className="rounded-md border border-warning/20 bg-warning/80 /30 p-5 text-center">
 <div className="mx-auto mb-3 h-10 w-10 rounded-full bg-warning/10 flex items-center justify-center">
 <Lock className="h-5 w-5 text-warning " />
 </div>
 <p className="text-sm font-semibold text-warning mb-2">
 🔒 اشترك لفتح جميع الدروس
 </p>
 <p className="text-xs text-muted-foreground mb-3">
 هذا الدرس (رقم {activeIndex + 1} من {lessons.length}) متاح للمشتركين.
 أول {FREE_LESSON_COUNT} دروس مجانية — بقية الدروس تتطلب اشتراك.
 </p>
 <Button
 variant="default"
 size="sm"
 onClick={() => {
 if (typeof window !== 'undefined') {
 window.location.href = '/pricing';
 }
 }}
 >
 اشترك لفتح جميع الدروس
 </Button>
 </div>
 </div>
 ) : showFull && fullContent ? (
 <AdvancedMarkdownRenderer content={fullContent} />
 ) : (
 <>
 {/* Preview: parsed sections (500 chars each) */}
 {active.sections.map((section, idx) => (
 <section key={idx} className="space-y-3">
 <h3 className="flex items-center gap-2 border-r-4 border-warning pr-3 text-lg font-bold">
 <span className="text-muted-foreground/60">{idx + 1}.</span>
 {section.heading}
 </h3>
 <AdvancedMarkdownRenderer content={section.content} compact />
 </section>
 ))}

 {/* Key points */}
 {active.keyPoints && active.keyPoints.length > 0 ? (
 <section className="space-y-2 rounded-md bg-warning/10 p-3 /20">
 <h3 className="flex items-center gap-2 text-sm font-bold">
 <CheckCircle2 className="h-4 w-4 text-warning" />
 النقاط الرئيسية
 </h3>
 <ul className="space-y-1.5">
 {active.keyPoints.map((kp, i) => (
 <li key={i} className="flex items-start gap-2 text-sm">
 <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
 <span className="leading-relaxed">{kp}</span>
 </li>
 ))}
 </ul>
 </section>
 ) : null}

 {/* CTA: load full content */}
 <section className="border-t pt-4">
 <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center">
 <p className="text-sm text-muted-foreground">
 هذا عرض مختصر لكل قسم. اضغط &quot;إظهار النص الكامل&quot; بالأعلى
 لقراءة الدرس كاملاً (يشمل المعادلات، الأكواد، الجداول، والقصص
 التفصيلية).
 </p>
 </div>
 </section>
 </>
 )}
 </div>

 {/* Footer: next lesson */}
 <section className="flex flex-wrap items-center justify-between gap-3 border-t p-5 pt-5">
 <div className="text-sm text-muted-foreground">
 الدرس الحالي: <span className="font-semibold text-foreground">{active.title}</span>
 </div>
 <Button
 onClick={() => {
 const idx = lessons.findIndex((l) => l.id === activeId);
 const next = lessons[(idx + 1) % lessons.length];
 if (next) setActiveId(next.id);
 if (typeof window !== 'undefined') {
 window.scrollTo({ top: 0, behavior: 'smooth' });
 }
 }}
 variant="default"
 >
 الدرس التالي
 <ChevronLeft className="h-4 w-4" />
 </Button>
 </section>
 </article>
 </main>
 </div>
 </div>
 );
}

/* ============================================================
 AdvancedMarkdownRenderer — minimal MD → JSX
 Handles: fenced code blocks (```), #/##/###/#### headings, - bullets,
 1. numbered lists, > blockquotes, **bold**, and plain paragraphs.
 Designed to read content/education/*.md faithfully (RTL-aware).
 ============================================================ */

function AdvancedMarkdownRenderer({
 content,
 compact = false,
}: {
 content: string;
 compact?: boolean;
}) {
 const blocks = React.useMemo(() => parseMarkdown(content), [content]);

 return (
 <div className={cn('space-y-3 leading-relaxed text-foreground/90', compact ? 'text-sm' : 'text-sm sm:text-base')}>
 {blocks.map((block, i) => {
 switch (block.kind) {
 case 'h1':
 return (
 <h2 key={i} className="mt-4 text-xl font-bold leading-tight sm:text-2xl">
 {block.text}
 </h2>
 );
 case 'h2':
 return (
 <h3 key={i} className="mt-3 flex items-center gap-2 border-r-4 border-warning pr-3 text-lg font-bold">
 {block.text}
 </h3>
 );
 case 'h3':
 return (
 <h4 key={i} className="mt-2 text-base font-bold text-warning ">
 {block.text}
 </h4>
 );
 case 'h4':
 return (
 <h5 key={i} className="mt-2 text-sm font-bold">
 {block.text}
 </h5>
 );
 case 'code': {
 // Task ID 30-A (Visual Battalion): detect ASCII-art code blocks
 // by signature keywords AND box-drawing characters, then render
 // a premium SVG instead of an ugly <pre><code> block. Source
 // .md files stay readable for content editors — swap happens at
 // render time only.
 //
 // The ASCII-art char check (┌│╲▲▼ etc.) ensures we NEVER replace
 // legitimate JS/Python code blocks that merely mention "Loss
 // Aversion" or "SOP Pipeline" in their comments — only true
 // ASCII diagrams are swapped to SVG.
 const codeText = block.text ?? '';
 const lowered = codeText.toLowerCase();
 const hasAsciiArt = /[┌┐└┘│─╲╱▲▼├┤┬┴┼╫║╝╗╔═]/.test(codeText);
 const isLossAversion =
 hasAsciiArt &&
 (codeText.includes('Loss Aversion') ||
 codeText.includes('منحنى Loss Aversion'));
 const isSopPipeline =
 hasAsciiArt &&
 codeText.includes('SOP') &&
 (codeText.includes('Pipeline') || codeText.includes('Standard Operating'));
 const isAlgoPipeline =
 codeText.length > 200 &&
 (codeText.includes('الربط البرمجي') ||
 codeText.includes('الخوارزمي') ||
 lowered.includes('algorithmic') ||
 lowered.includes('pipeline')) &&
 hasAsciiArt;
 if (isLossAversion) {
 return (
 <div key={i} className="my-4">
 <LossAversionCurve />
 </div>
 );
 }
 if (isSopPipeline) {
 return (
 <div key={i} className="my-4">
 <SopPipelineFlow />
 </div>
 );
 }
 if (isAlgoPipeline) {
 return (
 <div key={i} className="my-4">
 <TradingSystemPipeline />
 </div>
 );
 }
 return (
 <pre
 key={i}
 dir="ltr"
 className="my-2 overflow-x-auto rounded-md border bg-muted/60 p-3 text-xs leading-relaxed"
 >
 <code className="font-mono">{block.text}</code>
 </pre>
 );
 }
 case 'blockquote':
 return (
 <blockquote
 key={i}
 className="my-2 border-r-4 border-warning bg-warning/10 p-3 text-sm italic text-muted-foreground /10"
 >
 {renderInline(block.text)}
 </blockquote>
 );
 case 'ul':
 return (
 <ul key={i} className="space-y-1.5 pr-4">
 {block.items?.map((item, j) => (
 <li key={j} className="flex items-start gap-2 text-sm">
 <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
 <span className="flex-1">{renderInline(item)}</span>
 </li>
 ))}
 </ul>
 );
 case 'ol':
 return (
 <ol key={i} className="space-y-1.5 pr-4">
 {block.items?.map((item, j) => (
 <li key={j} className="flex items-start gap-2 text-sm">
 <span className="font-semibold text-warning ">
 {j + 1}.
 </span>
 <span className="flex-1">{renderInline(item)}</span>
 </li>
 ))}
 </ol>
 );
 case 'table':
 return (
 <div
 key={i}
 className="my-2 overflow-x-auto rounded-md border border-warning/20 /40"
 >
 <table className="w-full border-collapse text-xs sm:text-sm">
 <thead className="bg-warning/70 /30">
 <tr>
 {block.headers.map((h, hi) => (
 <th
 key={hi}
 className="border-b border-warning/20 /40 p-2 text-right font-bold text-warning "
 >
 {renderInline(h)}
 </th>
 ))}
 </tr>
 </thead>
 <tbody>
 {block.rows.map((row, ri) => (
 <tr
 key={ri}
 className={
 ri % 2 === 0
 ? 'bg-card'
 : 'bg-muted/30'
 }
 >
 {row.map((cell, ci) => (
 <td
 key={ci}
 className="border-b border-border/40 p-2 align-top leading-relaxed"
 >
 {renderInline(cell)}
 </td>
 ))}
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 );
 case 'hr':
 return <hr key={i} className="my-3 border-t border-dashed" />;
 case 'paragraph':
 default:
 return (
 <p key={i} className="whitespace-pre-line">
 {renderInline(block.text ?? '')}
 </p>
 );
 }
 })}
 </div>
 );
}

type MdBlock =
 | { kind: 'h1' | 'h2' | 'h3' | 'h4'; text: string }
 | { kind: 'code'; text: string }
 | { kind: 'blockquote'; text: string }
 | { kind: 'ul' | 'ol'; items: string[] }
 | { kind: 'table'; headers: string[]; rows: string[][] }
 | { kind: 'hr' }
 | { kind: 'paragraph'; text: string };

const TABLE_ROW_RE = /^\|(.+)\|\s*$/;
const TABLE_SEP_RE = /^\|([\s:|-]+)\|\s*$/;

function splitTableRow(raw: string): string[] {
 // raw is everything between the outer pipes — split on un-escaped |
 return raw
 .split(/(?<!\\)\|/)
 .map((c) => c.trim().replace(/\\\|/g, '|'));
}

function isTableRow(line: string): boolean {
 return TABLE_ROW_RE.test(line.trim());
}

function isTableSeparator(line: string): boolean {
 const trimmed = line.trim();
 if (!TABLE_SEP_RE.test(trimmed)) return false;
 // cells must look like :---, ---:, :---:, or ---
 const cells = splitTableRow(trimmed.slice(1, -1));
 return cells.every((c) => /^:?-{2,}:?$/.test(c.trim())) && cells.length > 0;
}

function parseMarkdown(src: string): MdBlock[] {
 const lines = src.replace(/\r\n/g, '\n').split('\n');
 const blocks: MdBlock[] = [];
 let i = 0;
 while (i < lines.length) {
 const line = lines[i];

 // Skip metadata line (the `> **المستوى:** ...` block at the top is parsed as blockquote)
 if (line.startsWith('```')) {
 const buf: string[] = [];
 i++;
 while (i < lines.length && !lines[i].startsWith('```')) {
 buf.push(lines[i]);
 i++;
 }
 i++; // skip closing fence
 blocks.push({ kind: 'code', text: buf.join('\n') });
 continue;
 }
 if (/^####\s+/.test(line)) {
 blocks.push({ kind: 'h4', text: line.replace(/^####\s+/, '').trim() });
 i++;
 continue;
 }
 if (/^###\s+/.test(line)) {
 blocks.push({ kind: 'h3', text: line.replace(/^###\s+/, '').trim() });
 i++;
 continue;
 }
 if (/^##\s+/.test(line)) {
 blocks.push({ kind: 'h2', text: line.replace(/^##\s+/, '').trim() });
 i++;
 continue;
 }
 if (/^#\s+/.test(line)) {
 blocks.push({ kind: 'h1', text: line.replace(/^#\s+/, '').trim() });
 i++;
 continue;
 }
 if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
 blocks.push({ kind: 'hr' });
 i++;
 continue;
 }
 if (/^>\s?/.test(line)) {
 const buf: string[] = [];
 while (i < lines.length && /^>\s?/.test(lines[i])) {
 buf.push(lines[i].replace(/^>\s?/, ''));
 i++;
 }
 blocks.push({ kind: 'blockquote', text: buf.join('\n') });
 continue;
 }
 // Markdown table block — header row + separator + body rows.
 // Detect BEFORE list/paragraph rules so a leading | doesn't get parsed
 // as a bullet. Requires at least: header | separator | (zero or more body rows).
 if (isTableRow(line)) {
 const tableLines: string[] = [];
 while (i < lines.length && isTableRow(lines[i])) {
 tableLines.push(lines[i].trim());
 i++;
 }
 // Need at least header + separator
 if (tableLines.length >= 2 && isTableSeparator(tableLines[1])) {
 const headers = splitTableRow(tableLines[0].slice(1, -1));
 const rows = tableLines.slice(2).map((row) =>
 splitTableRow(row.slice(1, -1)),
 );
 blocks.push({ kind: 'table', headers, rows });
 continue;
 }
 // Fallback: wasn't a real table — rewind and parse line-by-line
 i -= tableLines.length - 1;
 }
 if (/^[-*]\s+/.test(line)) {
 const items: string[] = [];
 while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
 items.push(lines[i].replace(/^[-*]\s+/, '').trim());
 i++;
 }
 blocks.push({ kind: 'ul', items });
 continue;
 }
 if (/^\d+\.\s+/.test(line)) {
 const items: string[] = [];
 while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
 items.push(lines[i].replace(/^\d+\.\s+/, '').trim());
 i++;
 }
 blocks.push({ kind: 'ol', items });
 continue;
 }
 if (line.trim() === '') {
 i++;
 continue;
 }
 blocks.push({ kind: 'paragraph', text: line });
 i++;
 }
 return blocks;
}

/** Render inline markdown: **bold**, *italic*, `code`, and plain text. */
function renderInline(text: string): React.ReactNode {
 if (!text) return null;
 // Tokenize on ** ** first, then ` `, then * *
 const nodes: React.ReactNode[] = [];
 const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
 let lastIndex = 0;
 let match: RegExpExecArray | null;
 let key = 0;
 while ((match = pattern.exec(text)) !== null) {
 if (match.index > lastIndex) {
 nodes.push(text.slice(lastIndex, match.index));
 }
 const token = match[0];
 if (token.startsWith('**')) {
 nodes.push(
 <strong key={key++} className="font-bold">
 {token.slice(2, -2)}
 </strong>,
 );
 } else if (token.startsWith('`')) {
 nodes.push(
 <code
 key={key++}
 dir="ltr"
 className="mx-0.5 rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
 >
 {token.slice(1, -1)}
 </code>,
 );
 } else if (token.startsWith('*')) {
 nodes.push(
 <em key={key++} className="italic">
 {token.slice(1, -1)}
 </em>,
 );
 }
 lastIndex = match.index + token.length;
 }
 if (lastIndex < text.length) {
 nodes.push(text.slice(lastIndex));
 }
 return nodes.length === 0 ? text : nodes;
}

/* ============================================================
 TradingFloorView — Task ID 30-B (Trading Floor Battalion)
 ============================================================
 Owner feedback: the Academy education module is excellent but too
 "school-like" for real investors. They want a real trading desk
 experience: live prices/volumes + scenario decision trees + action
 playbooks ("what to do if X happens").

 Three stacked sections, all inlined here (Rule 4 NO-NEW-FILES compliant):
 1) LiveMarketScanner — top tickers by activity from /api/stocks
 (with graceful fallback to demo data if the API is unreachable).
 2) ScenarioDecisionTree — 6 scenario cards with branching decision trees.
 3) ActionPlaybooks — 5 predefined action plans for common situations.

 Color system: emerald (bullish) + amber (wait) + red (bearish/mistakes)
 + slate (neutral). NO indigo/blue (Rule 30).
 ============================================================ */

interface FloorStock {
 ticker: string;
 name?: string;
 name_ar?: string;
 current_price: number;
 change_percent: number;
 volume: number;
 sector?: string;
}

interface AnalysisState {
 open: boolean;
 stock: FloorStock | null;
}

// Static demo list — shown only if /api/stocks is unreachable (graceful degrade)
const FALLBACK_STOCKS: FloorStock[] = [
 { ticker: 'COMI', name_ar: 'المصرية للاتصالات', current_price: 28.45, change_percent: 2.14, volume: 4_820_000 },
 { ticker: 'HRHO', name_ar: 'أوراسكوم للمقاولات', current_price: 412.6, change_percent: -1.2, volume: 1_240_000 },
 { ticker: 'EFGR', name_ar: 'البنك الأهلي المصري', current_price: 68.3, change_percent: 0.85, volume: 3_410_000 },
 { ticker: 'SWDY', name_ar: 'سويدى إلكتريك', current_price: 22.9, change_percent: -0.45, volume: 2_180_000 },
 { ticker: 'EKHO', name_ar: 'القاهرة للدواجن', current_price: 19.75, change_percent: 4.32, volume: 1_980_000 },
 { ticker: 'AUTO', name_ar: 'غبور أوتو', current_price: 7.42, change_percent: 0.0, volume: 5_120_000 },
 { ticker: 'TMGH', name_ar: 'طلعت مصطفى', current_price: 11.6, change_percent: 1.92, volume: 2_870_000 },
 { ticker: 'ORAS', name_ar: 'أوراسكوم للتنمية', current_price: 245.8, change_percent: -2.71, volume: 980_000 },
 { ticker: 'EAST', name_ar: 'الشرقية للدخان', current_price: 18.04, change_percent: 0.62, volume: 1_540_000 },
 { ticker: 'ABUK', name_ar: 'أبو قريم للأسمدة', current_price: 32.18, change_percent: 1.33, volume: 2_290_000 },
 { ticker: 'FWRY', name_ar: 'فوري', current_price: 4.71, change_percent: -0.85, volume: 3_960_000 },
 { ticker: 'MTIE', name_ar: 'موبكو', current_price: 211.4, change_percent: 3.45, volume: 1_120_000 },
 { ticker: 'EGCH', name_ar: 'مصر للأسمنت', current_price: 14.82, change_percent: 0.27, volume: 1_760_000 },
 { ticker: 'PHDC', name_ar: 'بريماء للصناعات الدوائية', current_price: 13.95, change_percent: -1.6, volume: 1_430_000 },
 { ticker: 'DCRC', name_ar: 'دلتا للسكر', current_price: 36.55, change_percent: 2.08, volume: 1_260_000 },
 { ticker: 'CNEG', name_ar: 'القاهرة للإسكان والتعمير', current_price: 9.18, change_percent: -0.32, volume: 2_040_000 },
 { ticker: 'ISPH', name_ar: 'المصرية للأدوية', current_price: 8.95, change_percent: 1.21, volume: 1_690_000 },
 { ticker: 'CCPA', name_ar: 'القاهرة للخدمات', current_price: 11.42, change_percent: 0.0, volume: 1_380_000 },
];

function normalizeStock(raw: Record<string, unknown>): FloorStock {
 return {
 ticker: String(raw.ticker ?? raw.symbol ?? ''),
 name: raw.name ? String(raw.name) : undefined,
 name_ar: raw.name_ar ? String(raw.name_ar) : undefined,
 current_price: Number(raw.current_price ?? raw.close ?? raw.last_price ?? 0) || 0,
 change_percent: Number(raw.change_percent ?? raw.price_change ?? 0) || 0,
 volume: Number(raw.volume_int ?? raw.volume ?? 0) || 0,
 sector: raw.sector ? String(raw.sector) : undefined,
 };
}

function changeTone(pct: number): 'up' | 'down' | 'flat' {
 if (pct > 0.001) return 'up';
 if (pct < -0.001) return 'down';
 return 'flat';
}

function formatVolume(v: number): string {
 if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
 if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
 return String(v);
}

function analysisHint(pct: number): { tone: 'up' | 'down' | 'flat'; hint: string } {
 if (pct > 5)
 return {
 tone: 'up',
 hint: 'زخم صعودي قوي — احذر من جني الأرباح المتأخر. تجنّب الشراء في قمة الجلسة، وانتظر ارتداداً صحياً نحو متوسط ٥ جلسات قبل الدخول.',
 };
 if (pct > 1)
 return {
 tone: 'up',
 hint: 'إيجابي معتدل — راقب تأكيد الحجم. الإدخال الأمثل يكون عند ارتداد بسيط فوق دعم الجلسة السابق مع وقف خسارة واضح أسفله.',
 };
 if (pct < -5)
 return {
 tone: 'down',
 hint: 'ضغط بيعي حاد — لا تتسرع في الشراء. انتظر استقرار السعر فوق الدعم التالي وحجم تناقصي قبل التفكير في الانعكاس.',
 };
 if (pct < -1)
 return {
 tone: 'down',
 hint: 'سلبي معتدل — راقب مستوى الدعم القادم وحجم التداول. كسر الدعم بحجم عالٍ = إشارة خروج؛ تثبيته بحجم منخفض = فرصة محتملة.',
 };
 return {
 tone: 'flat',
 hint: 'حركة جانبية — لا يوجد إجراء واضح. انتظر اختراق مستوى أو كسره بحجم مؤكد قبل الدخول أو الخروج.',
 };
}

/* ---------- Section 1: Live Market Scanner ---------- */
function LiveMarketScanner() {
 const [stocks, setStocks] = React.useState<FloorStock[]>([]);
 const [loading, setLoading] = React.useState(true);
 const [refreshing, setRefreshing] = React.useState(false);
 const [error, setError] = React.useState<string | null>(null);
 const [search, setSearch] = React.useState('');
 const [showAll, setShowAll] = React.useState(false);
 const [analysis, setAnalysis] = React.useState<AnalysisState>({ open: false, stock: null });
 const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null);

 const fetchStocks = React.useCallback(async (silent = false) => {
 if (!silent) setLoading(true);
 setRefreshing(true);
 try {
 const res = await fetch('/api/stocks?page_size=500', { cache: 'no-store' });
 if (!res.ok) throw new Error('HTTP ' + res.status);
 const data = await res.json();
 const list: unknown[] = Array.isArray(data?.stocks) ? data.stocks : [];
 const normalized = list
 .map((r) => normalizeStock(r as Record<string, unknown>))
 .filter((s) => s.ticker && s.volume > 0)
 .sort((a, b) => b.volume - a.volume);
 if (normalized.length === 0) {
 setStocks(FALLBACK_STOCKS);
 setError(null);
 } else {
 setStocks(normalized);
 setError(null);
 }
 setLastUpdated(new Date());
 } catch {
 setStocks(FALLBACK_STOCKS);
 setError('تعذّر الاتصال بـ /api/stocks — يتم عرض بيانات تجريبية للعرض التوضيحي.');
 setLastUpdated(new Date());
 } finally {
 setLoading(false);
 setRefreshing(false);
 }
 }, []);

 React.useEffect(() => {
 fetchStocks();
 const id = window.setInterval(() => fetchStocks(true), 60_000);
 return () => window.clearInterval(id);
 }, [fetchStocks]);

 const filtered = React.useMemo(() => {
 if (!search.trim()) return stocks;
 const q = search.trim().toLowerCase();
 return stocks.filter(
 (s) =>
 (s.ticker || '').toLowerCase().includes(q) ||
 (s.name_ar || '').toLowerCase().includes(q) ||
 (s.name || '').toLowerCase().includes(q),
 );
 }, [stocks, search]);

 const visible = showAll ? filtered : filtered.slice(0, 15);

 const timeLabel = lastUpdated
 ? lastUpdated.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
 : '—';

 return (
 <Card className="overflow-hidden border-profit/20 via-card to-card">
 <CardHeader className="gap-3 border-b bg-profit/10 px-4 py-3 sm:px-6">
 <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
 <div className="flex items-center gap-2">
 <div className="flex h-9 w-9 items-center justify-center rounded-md bg-profit/15 text-profit ">
 <TrendingUp className="h-5 w-5" />
 </div>
 <div>
 <CardTitle className="text-base sm:text-lg">ماسح السوق الحي</CardTitle>
 <CardDescription className="text-xs">
 أعلى الأسهم نشاطاً · تحديث تلقائي كل ٦٠ ثانية
 </CardDescription>
 </div>
 </div>
 <div className="flex items-center gap-2">
 <div className="relative flex-1 sm:w-64">
 <Search className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
 <Input
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder="ابحث برمز أو اسم السهم…"
 className="h-9 pr-8"
 />
 </div>
 <Button
 variant="outline"
 size="sm"
 onClick={() => fetchStocks()}
 disabled={refreshing}
 className="border-profit/20 text-profit hover:bg-profit/10 "
 >
 <RefreshCw className={cn('ml-1 h-4 w-4', refreshing && 'animate-spin')} />
 تحديث
 </Button>
 </div>
 </div>
 {error && (
 <div className="flex items-center gap-2 rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning ">
 <AlertTriangle className="h-4 w-4 shrink-0" />
 <span>{error}</span>
 </div>
 )}
 {!error && lastUpdated && (
 <div className="flex items-center gap-2 text-xs text-muted-foreground">
 <Clock className="h-3.5 w-3.5" />
 آخر تحديث: {timeLabel}
 </div>
 )}
 </CardHeader>
 <CardContent className="p-0">
 {loading ? (
 <div className="flex h-64 items-center justify-center text-muted-foreground">
 <Loader2 className="ml-2 h-5 w-5 animate-spin" />
 جارٍ تحميل بيانات السوق…
 </div>
 ) : filtered.length === 0 ? (
 <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
 لا توجد نتائج مطابقة لبحثك.
 </div>
 ) : (
 <>
 {/* Desktop table */}
 <div className="hidden md:block">
 <Table>
 <TableHeader>
 <TableRow className="hover:bg-transparent">
 <TableHead className="pr-6">السهم</TableHead>
 <TableHead className="text-left">السعر</TableHead>
 <TableHead className="text-left">التغير %</TableHead>
 <TableHead className="text-left">الحجم</TableHead>
 <TableHead className="text-center">الإجراء</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {visible.map((s) => {
 const tone = changeTone(s.change_percent);
 return (
 <TableRow key={s.ticker} className="group">
 <TableCell className="font-medium">
 <div className="flex flex-col">
 <span className="font-bold tracking-wide">{s.ticker}</span>
 <span className="text-xs text-muted-foreground">
 {s.name_ar || s.name || '—'}
 </span>
 </div>
 </TableCell>
 <TableCell className="text-left font-mono tabular-nums" dir="ltr">
 {(s.current_price ?? 0).toFixed(2)}
 </TableCell>
 <TableCell className="text-left">
 <span
 className={cn(
 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs font-semibold tabular-nums',
 tone === 'up' && 'bg-profit/10 text-profit ',
 tone === 'down' && 'bg-loss/10 text-loss ',
 tone === 'flat' && 'bg-slate-500/10 text-muted-foreground dark:text-muted-foreground',
 )}
 dir="ltr"
 >
 {tone === 'up' ? (
 <TrendingUp className="h-3 w-3" />
 ) : tone === 'down' ? (
 <TrendingDown className="h-3 w-3" />
 ) : null}
 {(s.change_percent ?? 0) >= 0 ? '+' : ''}
 {(s.change_percent ?? 0).toFixed(2)}%
 </span>
 </TableCell>
 <TableCell
 className="text-left font-mono text-xs tabular-nums text-muted-foreground"
 dir="ltr"
 >
 {formatVolume(s.volume)}
 </TableCell>
 <TableCell className="text-center">
 <Button
 variant="secondary"
 size="sm"
 onClick={() => setAnalysis({ open: true, stock: s })}
 className="h-8 bg-profit/15 text-profit hover:bg-profit/25 "
 >
 حلّل
 </Button>
 </TableCell>
 </TableRow>
 );
 })}
 </TableBody>
 </Table>
 </div>

 {/* Mobile cards */}
 <div className="grid gap-2 p-3 md:hidden">
 {visible.map((s) => {
 const tone = changeTone(s.change_percent);
 return (
 <div
 key={s.ticker}
 className="flex items-center justify-between rounded-lg border bg-card p-3 shadow-sm"
 >
 <div className="flex flex-col gap-0.5">
 <span className="font-bold tracking-wide">{s.ticker}</span>
 <span className="text-xs text-muted-foreground line-clamp-1">
 {s.name_ar || s.name || '—'}
 </span>
 <span
 className="font-mono text-xs tabular-nums text-muted-foreground"
 dir="ltr"
 >
 {(s.current_price ?? 0).toFixed(2)} · {formatVolume(s.volume)}
 </span>
 </div>
 <div className="flex flex-col items-end gap-2">
 <span
 className={cn(
 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs font-semibold tabular-nums',
 tone === 'up' && 'bg-profit/10 text-profit ',
 tone === 'down' && 'bg-loss/10 text-loss ',
 tone === 'flat' && 'bg-slate-500/10 text-muted-foreground dark:text-muted-foreground',
 )}
 dir="ltr"
 >
 {(s.change_percent ?? 0) >= 0 ? '+' : ''}
 {(s.change_percent ?? 0).toFixed(2)}%
 </span>
 <Button
 variant="secondary"
 size="sm"
 onClick={() => setAnalysis({ open: true, stock: s })}
 className="h-7 bg-profit/15 px-2 text-xs text-profit hover:bg-profit/25 "
 >
 حلّل
 </Button>
 </div>
 </div>
 );
 })}
 </div>

 {/* Show more / less */}
 {filtered.length > 15 && (
 <div className="border-t bg-muted/20 px-4 py-3 text-center">
 <Button
 variant="ghost"
 size="sm"
 onClick={() => setShowAll((v) => !v)}
 className="text-profit hover:bg-profit/10 "
 >
 {showAll
 ? `عرض أقل (١٥ من ${filtered.length})`
 : `عرض الكل (${filtered.length} سهم)`}
 </Button>
 </div>
 )}
 </>
 )}
 </CardContent>

 {/* Quick analysis sheet */}
 <Sheet
 open={analysis.open}
 onOpenChange={(o) => setAnalysis({ open: o, stock: analysis.stock })}
 >
 <SheetContent side="bottom" className="mx-auto max-w-xl rounded-t-2xl">
 {analysis.stock && (
 <>
 <SheetHeader className="text-right">
 <SheetTitle className="flex items-center gap-2">
 <span className="font-bold tracking-wide">{analysis.stock.ticker}</span>
 <span className="text-sm font-normal text-muted-foreground">
 {analysis.stock.name_ar || analysis.stock.name || ''}
 </span>
 </SheetTitle>
 <SheetDescription>
 تحليل سريع للسهم وفق الزخم الحالي — مجرد تلميح، ليس إشارة شراء أو بيع.
 </SheetDescription>
 </SheetHeader>
 <div className="space-y-3 px-4 pb-6">
 <div className="grid grid-cols-3 gap-2">
 <div className="rounded-lg border bg-muted/30 p-2 text-center">
 <div className="text-xs text-muted-foreground">السعر</div>
 <div className="font-mono text-sm font-semibold tabular-nums" dir="ltr">
 {(analysis.stock.current_price ?? 0).toFixed(2)}
 </div>
 </div>
 <div className="rounded-lg border bg-muted/30 p-2 text-center">
 <div className="text-xs text-muted-foreground">التغير</div>
 <div
 className={cn(
 'font-mono text-sm font-semibold tabular-nums',
 changeTone(analysis.stock.change_percent) === 'up' &&
 'text-profit ',
 changeTone(analysis.stock.change_percent) === 'down' &&
 'text-loss ',
 changeTone(analysis.stock.change_percent) === 'flat' && 'text-muted-foreground',
 )}
 dir="ltr"
 >
 {(analysis.stock.change_percent ?? 0) >= 0 ? '+' : ''}
 {(analysis.stock.change_percent ?? 0).toFixed(2)}%
 </div>
 </div>
 <div className="rounded-lg border bg-muted/30 p-2 text-center">
 <div className="text-xs text-muted-foreground">الحجم</div>
 <div className="font-mono text-sm font-semibold tabular-nums" dir="ltr">
 {formatVolume(analysis.stock.volume)}
 </div>
 </div>
 </div>
 {(() => {
 const hint = analysisHint(analysis.stock.change_percent);
 return (
 <div
 className={cn(
 'rounded-lg border p-3 text-sm',
 hint.tone === 'up' &&
 'border-profit/20 bg-profit/10 text-profit ',
 hint.tone === 'down' &&
 'border-loss/20 bg-loss/10 text-loss ',
 hint.tone === 'flat' &&
 'border-warning/20 bg-warning/10 text-warning ',
 )}
 >
 <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
 {hint.tone === 'up' && <CheckCircle2 className="h-4 w-4" />}
 {hint.tone === 'down' && <XCircle className="h-4 w-4" />}
 {hint.tone === 'flat' && <AlertTriangle className="h-4 w-4" />}
 تلميح السيناريو
 </div>
 <p className="leading-relaxed">{hint.hint}</p>
 </div>
 );
 })()}
 </div>
 </>
 )}
 </SheetContent>
 </Sheet>
 </Card>
 );
}

/* ============================================================
 ---------- Section 2: Scenario Decision Tree ----------
 ============================================================
 Six scenario cards, each: trigger condition → 2-3 branches
 (each branch = condition → action with ✅/⚠️/🚫 verdict).
 Vertical branches on mobile, horizontal grid on desktop.
 ============================================================ */

type ScenarioTone = 'bullish' | 'bearish' | 'wait' | 'neutral';
type Verdict = 'go' | 'wait' | 'avoid';

interface ScenarioBranch {
 condition: string;
 action: string;
 verdict: Verdict;
}

interface Scenario {
 id: string;
 title: string;
 trigger: string;
 tone: ScenarioTone;
 branches: ScenarioBranch[];
}

const SCENARIOS: Scenario[] = [
 {
 id: 'support-break',
 title: 'كسر الدعم بحجم عالٍ',
 trigger: 'السهم أغلق تحت مستوى دعم رئيسي بحجم تداول > 1.5× متوسط ٢٠ جلسة.',
 tone: 'bearish',
 branches: [
 {
 condition: 'الإغلاق اليومي مؤكد تحت الدعم والشمة البيعية قوية.',
 action: 'خروج فوري من المركز كاملاً أو تقليص ٥٠٪ على الأقل. لا تتوسط.',
 verdict: 'avoid',
 },
 {
 condition: 'السهم ارتد داخل الجلسة وأغلق فوق الدعم (False Breakdown).',
 action: 'انتظر إغلاق اليوم التالي للتأكيد قبل أي إجراء. لا تشترِ قبل التأكيد.',
 verdict: 'wait',
 },
 {
 condition: 'الدعم المحطوم تحوّل إلى مقاومة وتم اختباره من الأسفل.',
 action: 'بيع المركز القائم عند الاختبار، ولا تفتح مركزاً شرائياً جديداً.',
 verdict: 'avoid',
 },
 ],
 },
 {
 id: 'resistance-break',
 title: 'اختراق المقاومة بحجم مؤكد',
 trigger: 'السهم أغلق فوق مقاومة سابقة بحجم > 1.5× المتوسط وRSI(14) بين ٥٥ و٧٠.',
 tone: 'bullish',
 branches: [
 {
 condition: 'الإغلاق اليومي مؤكد فوق المقاومة والحجم مرتفع.',
 action: 'دخول بنسبة ٥٠٪ من حجم المركز المستهدف، وقف الخسارة أسفل المقاومة المحطومة.',
 verdict: 'go',
 },
 {
 condition: 'السهم اخترق لكنه لم يغلق فوق المقاومة بعد (Inside Day).',
 action: 'لا تتسرع؛ انتظر إغلاق اليوم التالي فوق المقاومة لتأكيد الاختراق.',
 verdict: 'wait',
 },
 {
 condition: 'الاختراق حدث بحجم ضعيف أقل من المتوسط.',
 action: 'تجنّب الدخول — اختراق كاذب محتمل خلال ١-٢ جلسة.',
 verdict: 'avoid',
 },
 ],
 },
 {
 id: 'rsi-divergence',
 title: 'تباعد RSI سلبي',
 trigger: 'السعر صنع قمة أعلى من القمة السابقة، بينما RSI(14) صنع قمة أقل (Bearish Divergence).',
 tone: 'wait',
 branches: [
 {
 condition: 'التباعد واضح على إطار ٤ ساعات ويومي والسعر قرب مقاومة قوية.',
 action: 'تقليص المركز ٣٠-٥٠٪ ورفع وقف الخسارة تحت آخر قمة سعرية.',
 verdict: 'wait',
 },
 {
 condition: 'تأكد التباعد بانكسار خط الاتجاه الصاعد.',
 action: 'خروج كامل من المركز، أو بيع على المكشوف بحجم صغير ووقف محكم.',
 verdict: 'avoid',
 },
 {
 condition: 'RSI ما زال فوق ٦٠ والتباعد غير مؤكد بعد.',
 action: 'لا تبع — انتظر تأكيد الانكسار أو ظهور شمعة هبوطية حادة.',
 verdict: 'wait',
 },
 ],
 },
 {
 id: 'hammer-at-support',
 title: 'شمعة المطرقة عند الدعم',
 trigger: 'شمعة Hammer ظهرت عند مستوى دعم قوي بحجم تداول مرتفع.',
 tone: 'bullish',
 branches: [
 {
 condition: 'المطرقة أغلقت قرب أعلى الجلسة والحجم > متوسط ٢٠ جلسة.',
 action: 'دخول طويل بحجم ٥٠٪ من المركز، وقف الخسارة أسفل ذيل المطرقة مباشرة.',
 verdict: 'go',
 },
 {
 condition: 'المطرقة ظهرت لكن حجم التداول ضعيف.',
 action: 'انتظر تأكيد اليوم التالي بشمعة خضراء فوق المطرقة قبل الدخول.',
 verdict: 'wait',
 },
 {
 condition: 'المطرقة ظهرت في اتجاه هبوطي قوي (RSI < 30) دون عوامل داعمة.',
 action: 'تجنّب — قد تكون مجرد توقف مؤقت قبل استئناف الهبوط.',
 verdict: 'avoid',
 },
 ],
 },
 {
 id: 'gap-up',
 title: 'فجوة سعرية صاعدة (Gap Up)',
 trigger: 'السهم افتتح بفجوة صاعدة > ٣٪ عن إغلاق الأمس.',
 tone: 'neutral',
 branches: [
 {
 condition: 'الفجوة مدعومة بأخبار إيجابية وحجم افتتاح مرتفع (> ٢× المتوسط).',
 action: 'راقب ملء الفجوة؛ إذا تجاوز السعر أعلى الفجوة، ادخل بحجم ٣٠٪ فقط.',
 verdict: 'go',
 },
 {
 condition: 'الفجوة بدون أخبار واضحة وحجم افتتاح عادي.',
 action: 'احذر — الفجوة قد تُملأ خلال نفس الجلسة. لا تتبع السعر.',
 verdict: 'wait',
 },
 {
 condition: 'السعر بدأ يهبط ويقترب من ملء الفجوة.',
 action: 'تجنّب الشراء — انتظر استقرار السعر فوق الفجوة على الأقل ٣ جلسات.',
 verdict: 'avoid',
 },
 ],
 },
 {
 id: 'earnings-momentum',
 title: 'ضغط شرائي بعد إعلان نتائج',
 trigger: 'السهم أعلن نتائج ربع سنوية، والسعر تحرك +/-٥٪ خلال الجلسة التالية.',
 tone: 'neutral',
 branches: [
 {
 condition: 'النتائج فاقت التوقعات (EPS > التوقعات بـ ١٠٪+) والزخم مستمر.',
 action: 'دخول بحجم ٥٠٪ بعد أول ارتداد صغير، وقف تحت سعر الإغلاق الأول.',
 verdict: 'go',
 },
 {
 condition: 'النتائج جيدة لكن السعر وصل لمقاومة قوية.',
 action: 'انتظر اختبار المقاومة وكسرها بحجم قبل الدخول — لا تطارد السعر.',
 verdict: 'wait',
 },
 {
 condition: 'النتائج أقل من التوقعات وانخفاض بحجم عالٍ.',
 action: 'خروج فوري إذا كنت مالكاً، ولا تتوسط بانتظار قاع — الانتظار يكلفك أكثر.',
 verdict: 'avoid',
 },
 ],
 },
];

const SCENARIO_TONE_STYLES: Record<
 ScenarioTone,
 { accentBorder: string; accentStrip: string; badge: string; badgeLabel: string; iconBg: string }
> = {
 bullish: {
 accentBorder: 'border-profit/20',
 accentStrip: 'bg-profit',
 badge: 'bg-profit/15 text-profit ',
 badgeLabel: 'صعودي',
 iconBg: 'bg-profit/15 text-profit ',
 },
 bearish: {
 accentBorder: 'border-loss/20',
 accentStrip: 'bg-loss',
 badge: 'bg-loss/15 text-loss ',
 badgeLabel: 'هبوطي',
 iconBg: 'bg-loss/15 text-loss ',
 },
 wait: {
 accentBorder: 'border-warning/20',
 accentStrip: 'bg-warning',
 badge: 'bg-warning/15 text-warning ',
 badgeLabel: 'تحذير',
 iconBg: 'bg-warning/15 text-warning ',
 },
 neutral: {
 accentBorder: 'border-slate-500/40',
 accentStrip: 'bg-slate-500',
 badge: 'bg-slate-600/15 text-muted-foreground dark:text-muted-foreground',
 badgeLabel: 'مشروط',
 iconBg: 'bg-slate-600/15 text-muted-foreground dark:text-muted-foreground',
 },
};

const VERDICT_STYLE: Record<
 Verdict,
 {
 Icon: typeof CheckCircle2;
 color: string;
 bg: string;
 label: string;
 }
> = {
 go: {
 Icon: CheckCircle2,
 color: 'text-profit ',
 bg: 'bg-profit/10 border-profit/20',
 label: 'إجراء',
 },
 wait: {
 Icon: AlertTriangle,
 color: 'text-warning ',
 bg: 'bg-warning/10 border-warning/20',
 label: 'انتظار',
 },
 avoid: {
 Icon: XCircle,
 color: 'text-loss ',
 bg: 'bg-loss/10 border-loss/20',
 label: 'تجنّب',
 },
};

function ScenarioToneIcon({ tone }: { tone: ScenarioTone }) {
 if (tone === 'bullish') return <TrendingUp className="h-4 w-4" />;
 if (tone === 'bearish') return <TrendingDown className="h-4 w-4" />;
 if (tone === 'wait') return <AlertTriangle className="h-4 w-4" />;
 return <Minus className="h-4 w-4" />;
}

/* ---------- Section 2 component ---------- */
function ScenarioDecisionTree() {
 return (
 <Card className="overflow-hidden border-warning/20 via-card to-card">
 <CardHeader className="gap-2 border-b bg-warning/20 px-4 py-3 sm:px-6">
 <div className="flex items-center gap-2">
 <div className="flex h-9 w-9 items-center justify-center rounded-md bg-warning/15 text-warning ">
 <AlertTriangle className="h-5 w-5" />
 </div>
 <div>
 <CardTitle className="text-base sm:text-lg">شجرة قرارات السيناريوهات</CardTitle>
 <CardDescription className="text-xs">
 مشغّل السوق → فروع قرار (إجراء / انتظار / تجنّب) · ٦ سيناريوهات شائعة
 </CardDescription>
 </div>
 </div>
 </CardHeader>
 <CardContent className="space-y-4 p-3 sm:p-4">
 {SCENARIOS.map((s) => {
 const tone = SCENARIO_TONE_STYLES[s.tone];
 return (
 <div
 key={s.id}
 className={cn(
 'relative overflow-hidden rounded-lg border bg-card shadow-sm',
 tone.accentBorder,
 )}
 >
 {/* Accent strip on top */}
 <div className={cn('h-1 w-full', tone.accentStrip)} />
 <div className="p-3 sm:p-4">
 {/* Title row */}
 <div className="mb-3 flex items-center gap-2">
 <div
 className={cn(
 'flex h-8 w-8 items-center justify-center rounded-md',
 tone.iconBg,
 )}
 >
 <ScenarioToneIcon tone={s.tone} />
 </div>
 <h4 className="flex-1 text-sm font-semibold leading-tight sm:text-base">
 {s.title}
 </h4>
 <span
 className={cn(
 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold',
 tone.badge,
 )}
 >
 {tone.badgeLabel}
 </span>
 </div>

 {/* Trigger box */}
 <div className="rounded-md border border-slate-500/30 bg-slate-950/20 p-3">
 <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
 المشغّل (Trigger)
 </div>
 <p className="text-xs leading-relaxed sm:text-sm">{s.trigger}</p>
 </div>

 {/* Arrow down to branches */}
 <div className="flex justify-center py-2 text-muted-foreground">
 <ArrowDown className="h-4 w-4" />
 </div>

 {/* Branches grid */}
 <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
 {s.branches.map((b, i) => {
 const v = VERDICT_STYLE[b.verdict];
 const VIcon = v.Icon;
 return (
 <div
 key={i}
 className="flex flex-col rounded-md border border-border bg-background/70 p-3"
 >
 <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
 الشرط #{i + 1}
 </div>
 <p className="mb-2 text-xs leading-relaxed">{b.condition}</p>
 <div className="flex flex-1 justify-center py-1 text-muted-foreground">
 <ArrowDown className="h-3.5 w-3.5" />
 </div>
 <div className={cn('rounded-md border p-2', v.bg)}>
 <div
 className={cn(
 'mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide',
 v.color,
 )}
 >
 <VIcon className="h-3.5 w-3.5" />
 {v.label}
 </div>
 <p className="text-xs leading-relaxed">{b.action}</p>
 </div>
 </div>
 );
 })}
 </div>
 </div>
 </div>
 );
 })}
 </CardContent>
 </Card>
 );
}

/* ============================================================
 ---------- Section 3: Action Playbooks ----------
 ============================================================
 Five predefined action plans for common trading situations.
 Each playbook card is collapsible (first one expanded by default).
 Layout: responsive grid (1 col mobile / 2 col tablet / 3 col desktop).
 Premium look: emerald header strip, slate body, red mistake box
 with AlertTriangle icon.
 ============================================================ */

interface Playbook {
 id: string;
 icon: LucideIcon;
 iconBg: string;
 title: string;
 condition: string;
 steps: string[];
 mistake: string;
 example: string;
}

const PLAYBOOKS: Playbook[] = [
 {
 id: 'breakout',
 icon: Rocket,
 iconBg: 'bg-profit/15 text-profit ',
 title: 'خطة Breakout (الاختراق)',
 condition:
 'السهم أغلق فوق مقاومة قوية بحجم > 1.5× المتوسط، والاتجاه العام صاعد (السعر فوق 50 MA).',
 steps: [
 'انتظر إغلاقاً يومياً مؤكداً فوق المقاومة (لا تدخل أثناء الجلسة).',
 'ضع أمر شراء بوقف (Buy Stop) أعلى قمة شمعة الاختراق.',
 'حدد وقف الخسارة تحت المقاومة المحطومة (صارت دعماً).',
 'حجم المركز: ٥٠٪ من المخطط، أضف ٢٥٪ عند أول ارتداد صاعد.',
 'جني الأرباح: ٥٠٪ عند 1R، و٥٠٪ عند 2R (R = مسافة وقف الخسارة).',
 ],
 mistake:
 'تطارد السعر بعد الاختراق مباشرة دون انتظار إغلاق مؤكد — يفتح بابًا للاختراقات الكاذبة.',
 example:
 'سهم @ 100 ج.م اخترق مقاومة 98 بإغلاق 102 وحجم 2× المتوسط. دخول @ 102.2، وقف 97، الهدف 1R=107، الهدف 2R=112.',
 },
 {
 id: 'pullback',
 icon: ArrowDownCircle,
 iconBg: 'bg-profit/15 text-profit ',
 title: 'خطة Pullback (شراء الارتداد)',
 condition:
 'السهم في اتجاه صاعد واضح (فوق 50 MA) ويهبط حالياً 2-5% لاختبار متوسط 20 يوم أو دعم قريب.',
 steps: [
 'تأكد أن الاتجاه العام صاعد (50 MA مائل صعوداً + السعر فوق 50 MA).',
 'انتظر ظهور شمعة انعكاس صاعدة (مطرقة أو ابتلاعية) عند الدعم.',
 'ادخل بعد إغلاق الشمعة الصاعدة بحجم ٥٠٪ من المركز.',
 'وقف الخسارة: تحت آخر قاع للارتداد (لا يتجاوز ٥٪ تحت السعر).',
 'الهدف: أعلى قمة سابقة + ٣٪، مع تحريك وقف الخسارة بعد كل قمة جديدة.',
 ],
 mistake:
 'شراء قبل ظهور شمعة انعكاس مؤكدة ظناً أن الارتداد انتهى — يعرضك لاستمرار الهبوط.',
 example:
 'سهم صاعد 80→95 ج.م ارتد إلى 88 (اختبار 20 MA). انتظر شمعة مطرقة @ 88، ادخل @ 89، وقف 85.5، الهدف 98.',
 },
 {
 id: 'stop-loss',
 icon: ShieldAlert,
 iconBg: 'bg-loss/15 text-loss ',
 title: 'خطة Stop-loss آلي (الخروج التلقائي)',
 condition:
 'تم فتح مركز شراء وحددت مسبقاً مستوى وقف الخسارة — والآن وصل السعر لهذا المستوى.',
 steps: [
 'لا تفاوض مع نفسك — نفّذ أمر البيع فوراً عند لمس مستوى وقف الخسارة.',
 'تأكد أن أمر Stop-Loss الآلي فعّل منذ فتح المركز (لا تنسَ تفعيله).',
 'لا تنقل وقف الخسارة لأسفل لتجنب الخروج — أكبر كارثة في التداول.',
 'بعد الخروج، سجّل سبب الخسارة في يوميات التداول لمراجعة لاحقة.',
 'لا تعد فتح نفس السهم في نفس اليوم — انتظر إشارة جديدة واضحة.',
 ],
 mistake:
 'تجميد قرار الخروج وتحويل خسارة صغيرة ٣٪ إلى خسارة كبيرة ١٥٪ بانتظار "يرتد السوق".',
 example:
 'مركز 1000 سهم @ 50 ج.م، وقف 47.5. السعر وصل 47.5 → خروج فوري، خسارة 2,500 ج.م. تجاهل الإشارة: يهبط إلى 42 → خسارة 8,000 ج.م.',
 },
 {
 id: 'dca',
 icon: Layers,
 iconBg: 'bg-slate-600/15 text-muted-foreground dark:text-muted-foreground',
 title: 'خطة DCA (متوسط التكلفة)',
 condition:
 'تستثمر في سهم أساسي طويل الأجل (بنك أو قائد قطاع) وتريد تخفيض متوسط التكلفة دون توقيت السوق.',
 steps: [
 'حدد مبلغاً ثابتاً شهرياً (مثلاً 5,000 ج.م) لشراء نفس السهم بغض النظر عن السعر.',
 'اشترِ في نفس اليوم من كل شهر — لا تؤجل بانتظار "سعر أفضل".',
 'راجع الأساسيات كل ربع سنة؛ توقف إذا تغيرت قصة الاستثمار.',
 'لا تزيد المبلغ عند هبوط السعر إلا لسبب أساسي (لا توقيت سوق).',
 'حدد أفق الاستثمار (٣-٥ سنوات على الأقل) قبل البدء.',
 ],
 mistake:
 'التوقف عن الشراء عند هبوط السوق (خوفاً) ثم العودة عند ارتفاع الأسعار — يقلب DCA إلى شراء غالٍ.',
 example:
 '5,000 ج.م شهرياً في سهم بنكي على 12 شهراً بأسعار 28-34 ج.م. متوسط التكلفة الناتج ≈ 30.8 ج.م (أقل من متوسط السوق في 8 من 12 شهراً).',
 },
 {
 id: 'take-profit',
 icon: Target,
 iconBg: 'bg-profit/15 text-profit ',
 title: 'خطة Take-profit متدرج (Scaling Out)',
 condition:
 'المركز في ربح ≥ 1R (مسافة وقف الخسارة) وتريد تأمين الأرباح تدريجياً دون خروج كامل.',
 steps: [
 'عند 1R: بع ٣٣٪ من المركز + حرك وقف الخسارة لنقطة الدخول (Break-even).',
 'عند 2R: بع ٣٣٪ إضافي + حرك وقف الخسارة لـ 1R.',
 'عند 3R: احتفظ بالـ ٣٣٪ الأخيرة بوقف خسارة متحرك (Trailing) أسفل كل قمة.',
 'إذا ظهرت إشارة خروج صريحة (انكسار اتجاه/تباعد سلبي) قبل الهدف، اخرج بالكامل.',
 'لا تعد الدخول في نفس السهم بعد خروج متدرج ناجح إلا بعد إشارة جديدة.',
 ],
 mistake:
 'طمع في تشغيل كامل المركز بانتظار هدف 5R — يحوّل ربحاً مؤكداً 1R إلى خسارة عند ارتداد السعر.',
 example:
 'مركز 1000 سهم @ 20 ج.م، وقف 19 (مسافة 1 ج.م = 1R). @ 21: بع 333 + حرك الوقف لـ 20. @ 22: بع 333 + حرك الوقف لـ 21. الـ 334 الأخيرة بوقف متحرك.',
 },
];

function PlaybookCard({ playbook, defaultOpen }: { playbook: Playbook; defaultOpen: boolean }) {
 const [open, setOpen] = React.useState(defaultOpen);
 const Icon = playbook.icon;
 return (
 <div className="overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md">
 {/* Emerald header strip */}
 <div className="h-1 w-full bg-profit" />
 <button
 type="button"
 onClick={() => setOpen((v) => !v)}
 className="flex w-full items-center gap-2 bg-muted/30 px-3 py-2.5 text-right"
 aria-expanded={open}
 >
 <div className={cn('flex h-7 w-7 items-center justify-center rounded-md', playbook.iconBg)}>
 <Icon className="h-4 w-4" />
 </div>
 <span className="flex-1 text-sm font-semibold leading-tight">{playbook.title}</span>
 <ChevronDown
 className={cn(
 'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
 open && 'rotate-180',
 )}
 />
 </button>
 {open && (
 <div className="space-y-3 p-3">
 {/* Condition */}
 <div>
 <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
 <CheckCircle2 className="h-3 w-3" />
 الشرط
 </div>
 <p className="rounded-md border bg-muted/30 p-2 text-xs leading-relaxed">
 {playbook.condition}
 </p>
 </div>
 {/* Steps */}
 <div>
 <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
 <ListChecks className="h-3 w-3" />
 الإجراء
 </div>
 <ol className="space-y-1.5">
 {playbook.steps.map((s, idx) => (
 <li key={idx} className="flex gap-2 text-xs leading-relaxed">
 <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-profit/15 text-xs font-bold text-profit ">
 {idx + 1}
 </span>
 <span className="flex-1 pt-0.5">{s}</span>
 </li>
 ))}
 </ol>
 </div>
 {/* Mistake */}
 <div className="rounded-md border border-loss/20 bg-loss/10 p-2">
 <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-loss ">
 <AlertTriangle className="h-3.5 w-3.5" />
 الخطأ الشائع
 </div>
 <p className="text-xs leading-relaxed text-loss ">
 {playbook.mistake}
 </p>
 </div>
 {/* Example */}
 <div>
 <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
 <Target className="h-3 w-3" />
 مثال
 </div>
 <p className="rounded-md border border-warning/20 bg-warning/5 p-2 text-xs leading-relaxed text-muted-foreground">
 {playbook.example}
 </p>
 </div>
 </div>
 )}
 </div>
 );
}

function ActionPlaybooks() {
 return (
 <Card className="overflow-hidden border-profit/20 via-card to-card">
 <CardHeader className="gap-2 border-b bg-profit/20 px-4 py-3 sm:px-6">
 <div className="flex items-center gap-2">
 <div className="flex h-9 w-9 items-center justify-center rounded-md bg-profit/15 text-profit ">
 <ListChecks className="h-5 w-5" />
 </div>
 <div>
 <CardTitle className="text-base sm:text-lg">كتيبات الإجراءات</CardTitle>
 <CardDescription className="text-xs">
 خطط جاهزة لكل موقف · انقر على البطاقة لتوسيعها
 </CardDescription>
 </div>
 </div>
 </CardHeader>
 <CardContent className="p-3 sm:p-4">
 <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
 {PLAYBOOKS.map((p, i) => (
 <PlaybookCard key={p.id} playbook={p} defaultOpen={i === 0} />
 ))}
 </div>
 </CardContent>
 </Card>
 );
}

function TradingFloorView() {
 return (
 <div className="space-y-6">
 {/* Owner intent banner — sets the tone that this is a desk, not a textbook */}
 <div className="rounded-lg border border-profit/20 bg-profit/20 px-4 py-3 text-xs text-profit sm:px-6">
 <span className="font-semibold">📊 أرض التداول —</span> مكتب عملي للقرارات المباشرة:
 شاشة أسعار حية، شجرة قرارات سيناريوهات، وكتيبات إجراءات جاهزة.
 </div>
 {/* Task ID 30-A §3: The Trading System Pipeline (الخريطة المنطقية للربط البرمجمي/الخوارزمي)
 — owner explicitly requested the algorithmic wiring to become a beautiful logic
 diagram. This premium SVG visualises the 8-stage pipeline (Data → Source Guard →
 Validation → Signal → Risk Gate → Execution → Journal → Review) with a feedback
 loop. Placed at the top of the Trading Floor so investors see HOW the system
 thinks before they act on the live prices below. */}
 <section aria-labelledby="pipeline-heading" className="rounded-xl border border-border bg-white/80 p-4 dark:bg-slate-950/60 sm:p-6">
 <div className="mb-3 flex items-center gap-2">
 <span className="text-lg" role="img" aria-label="خريطة">🗺️</span>
 <h3 id="pipeline-heading" className="text-base font-bold text-slate-800 dark:text-slate-100 sm:text-lg">
 الخريطة المنطقية لنظام التداول
 </h3>
 </div>
 <p className="mb-4 text-xs text-muted-foreground sm:text-sm">
 كيف يتدفّق قرارك من البيانات الخام حتى التنفيذ والمراجعة — فهم هذه الخريطة هو الفرق بين
 المستثمر المنضبط والمقامر العاطفي.
 </p>
 <TradingSystemPipeline />
 </section>
 <LiveMarketScanner />
 <ScenarioDecisionTree />
 <ActionPlaybooks />
 </div>
 );
}

/* ============================================================
 PracticalToolsView — Task ID 32 (Education Content Refactor Battalion)
 ============================================================
 Owner feedback: "أنت بتعرض كود برمجي حرفي لشخص مش مبرمج".
 Replaced JS code blocks in lessons 01-12 with investor-friendly
 checklists, EGX examples, and templates. This 7th tab provides
 two interactive calculators that replace the most-asked-about
 code blocks:
 1) حاسبة حجم الصفقة (Position Size Calculator)
 2) كاشف التحيز السلوكي (Bias Detector Quiz)
 Inline component (Rule 4 NO-NEW-FILES compliant).
 Palette: emerald + amber + slate + red (Rule 30 NO indigo/blue).
 ============================================================ */

const BIAS_QUESTIONS: Array<{
 id: string;
 text: string;
 bias: string;
 lesson: string;
 lessonNum: number;
}> = [
 {
 id: 'loss_aversion',
 text: 'هل بعت سهم رابح بسرعة لكن ماسكت سهم خسران طويلاً؟',
 bias: 'Loss Aversion (تجنّب الخسارة)',
 lesson: 'سيكولوجيا التداول',
 lessonNum: 1,
 },
 {
 id: 'fomo',
 text: 'هل اشتريت سهم بعد ما طلع كتير لأنك خفت تفوت الفرصة؟',
 bias: 'FOMO (الخوف من تفويت الفرصة)',
 lesson: 'سيكولوجيا التداول',
 lessonNum: 1,
 },
 {
 id: 'confirmation',
 text: 'هل بتدوّر على معلومات بتأكد رأيك بس وتتجاهل المعارضة؟',
 bias: 'Confirmation Bias (الانحياز للتأكيد)',
 lesson: 'سيكولوجيا التداول',
 lessonNum: 1,
 },
 {
 id: 'ego',
 text: 'هل رفضت تعترف بخطأ في صفقة خسرانة؟',
 bias: 'Ego / Pride (الأنانية)',
 lesson: 'إدارة المخاطر الكمية',
 lessonNum: 5,
 },
 {
 id: 'revenge',
 text: 'هل زوّدت حجم الصفقة بعد خسارة عشان تعوّض؟',
 bias: 'Revenge Trading (التداول الانتقامي)',
 lesson: 'إدارة المخاطر الكمية',
 lessonNum: 5,
 },
 {
 id: 'hope',
 text: 'هل بتأجّل بيع سهم خسران على أمل "هيرجع"؟',
 bias: 'Hope (الأمل الزائف)',
 lesson: 'سيكولوجيا التداول',
 lessonNum: 1,
 },
 {
 id: 'overtrading',
 text: 'هل بتفتح صفقات كتير في نفس الوقت (> 5)؟',
 bias: 'Overtrading (الإفراط في التداول)',
 lesson: 'إدارة المخاطر الكمية',
 lessonNum: 5,
 },
];

function PositionSizeCalculator() {
 const [capital, setCapital] = React.useState('');
 const [riskPct, setRiskPct] = React.useState('3');
 const [entryPrice, setEntryPrice] = React.useState('');
 const [stopPrice, setStopPrice] = React.useState('');

 const result = React.useMemo(() => {
 const cap = parseFloat(capital);
 const risk = parseFloat(riskPct);
 const entry = parseFloat(entryPrice);
 const stop = parseFloat(stopPrice);
 if (!isFinite(cap) || cap <= 0) return null;
 if (!isFinite(risk) || risk <= 0 || risk > 100) return null;
 if (!isFinite(entry) || entry <= 0) return null;
 if (!isFinite(stop) || stop <= 0) return null;
 if (entry === stop) return { error: 'سعر الدخول ووقف الخسارة لا يمكن أن يكونا متساويين' };
 const maxLoss = cap * (risk / 100);
 const perShareRisk = Math.abs(entry - stop);
 const maxShares = Math.floor(maxLoss / perShareRisk);
 const totalValue = maxShares * entry;
 const positionPct = (totalValue / cap) * 100;
 return {
 maxLoss,
 perShareRisk,
 maxShares,
 totalValue,
 positionPct,
 direction: entry > stop ? 'شراء (Long)' : 'بيع (Short)',
 };
 }, [capital, riskPct, entryPrice, stopPrice]);

 return (
 <Card className="overflow-hidden border-profit/20 via-card to-card">
 <CardHeader className="gap-2 border-b bg-profit/20 px-4 py-3 sm:px-6">
 <div className="flex items-center gap-2">
 <div className="flex h-9 w-9 items-center justify-center rounded-md bg-profit/15 text-profit ">
 <Calculator className="h-5 w-5" />
 </div>
 <div>
 <CardTitle className="text-base sm:text-lg">حاسبة حجم الصفقة</CardTitle>
 <CardDescription className="text-xs">
 احسب الحجم الأقصى لصفقتك بناءً على المخاطرة المسموحة — قبل ما تدخل
 </CardDescription>
 </div>
 </div>
 </CardHeader>
 <CardContent className="space-y-4 p-4 sm:p-6">
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
 <div className="space-y-1.5">
 <label className="text-xs font-semibold text-muted-foreground">
 رأس المال (جنيه مصري)
 </label>
 <Input
 type="number"
 inputMode="decimal"
 placeholder="100000"
 value={capital}
 onChange={(e) => setCapital(e.target.value)}
 dir="ltr"
 className="text-right font-mono"
 />
 </div>
 <div className="space-y-1.5">
 <label className="text-xs font-semibold text-muted-foreground">
 نسبة المخاطرة (%)
 </label>
 <Input
 type="number"
 inputMode="decimal"
 placeholder="3"
 value={riskPct}
 onChange={(e) => setRiskPct(e.target.value)}
 dir="ltr"
 className="text-right font-mono"
 />
 <p className="text-xs text-muted-foreground">
 القاعدة الذهبية: ≤ 3% للصفقة، ≤ 6% إجمالي للمحفظة
 </p>
 </div>
 <div className="space-y-1.5">
 <label className="text-xs font-semibold text-muted-foreground">
 سعر الدخول (جنيه)
 </label>
 <Input
 type="number"
 inputMode="decimal"
 placeholder="18.50"
 value={entryPrice}
 onChange={(e) => setEntryPrice(e.target.value)}
 dir="ltr"
 className="text-right font-mono"
 />
 </div>
 <div className="space-y-1.5">
 <label className="text-xs font-semibold text-muted-foreground">
 سعر وقف الخسارة (جنيه)
 </label>
 <Input
 type="number"
 inputMode="decimal"
 placeholder="17.50"
 value={stopPrice}
 onChange={(e) => setStopPrice(e.target.value)}
 dir="ltr"
 className="text-right font-mono"
 />
 </div>
 </div>

 {result && 'error' in result ? (
 <div className="rounded-md border border-warning/20 bg-warning/10 /20 p-3 text-xs text-warning ">
 ⚠️ {result.error}
 </div>
 ) : result ? (
 <div className="space-y-3">
 <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
 <div className="rounded-md border border-profit/20 bg-profit/10 /20 p-2.5 text-center">
 <div className="text-xs font-semibold uppercase tracking-wide text-profit ">
 المخاطرة (جنيه)
 </div>
 <div className="mt-1 text-base font-bold text-profit " dir="ltr">
 {result.maxLoss.toLocaleString('en-US', { maximumFractionDigits: 2 })}
 </div>
 </div>
 <div className="rounded-md border border-profit/20 bg-profit/10 /20 p-2.5 text-center">
 <div className="text-xs font-semibold uppercase tracking-wide text-profit ">
 الحجم الأقصى (سهم)
 </div>
 <div className="mt-1 text-base font-bold text-profit " dir="ltr">
 {result.maxShares.toLocaleString('en-US')}
 </div>
 </div>
 <div className="rounded-md border border-slate-500/30 bg-slate-50/50 dark:bg-slate-950/20 p-2.5 text-center">
 <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
 القيمة الإجمالية
 </div>
 <div className="mt-1 text-base font-bold text-slate-800 dark:text-slate-200" dir="ltr">
 {result.totalValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}
 </div>
 </div>
 <div className="rounded-md border border-slate-500/30 bg-slate-50/50 dark:bg-slate-950/20 p-2.5 text-center">
 <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
 % من المحفظة
 </div>
 <div className="mt-1 text-base font-bold text-slate-800 dark:text-slate-200" dir="ltr">
 {(result.positionPct ?? 0).toFixed(1)}%
 </div>
 </div>
 </div>
 <div className="flex flex-wrap items-center gap-2 text-xs">
 <span className="rounded-md border border-warning/20 bg-warning/10 /20 px-2 py-1 text-warning ">
 الاتجاه: {result.direction}
 </span>
 <span className="rounded-md border border-slate-500/30 bg-muted/40 px-2 py-1 text-muted-foreground" dir="ltr">
 المخاطرة/سهم: {(result.perShareRisk ?? 0).toFixed(3)} ج
 </span>
 </div>
 <div className="rounded-md border border-warning/20 bg-warning/10 /20 p-3 text-xs text-warning ">
 💡 <span className="font-semibold">ملاحظة عملية:</span> لو الحجم الأقصى أكبر من سيولة السهم في الـ order book → قلّل الكمية أو اختار stop أقرب لسعر الدخول. ما تدخلش بحجم يعادل أكتر من 10% من سيولة السهم اليومية.
 </div>
 </div>
 ) : (
 <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground">
 أدخل القيم الأربعة (رأس المال + نسبة المخاطرة + سعر الدخول + سعر الـ Stop) لحساب الحجم الأقصى للصفقة.
 </div>
 )}
 </CardContent>
 </Card>
 );
}

function BiasDetectorQuiz() {
 const [answers, setAnswers] = React.useState<Record<string, boolean>>({});
 const [submitted, setSubmitted] = React.useState(false);

 const toggleAnswer = (id: string, value: boolean) => {
 setAnswers((prev) => ({ ...prev, [id]: value }));
 };

 const scores = React.useMemo(() => {
 const byBias: Record<string, { count: number; lesson: string; lessonNum: number }> = {};
 for (const q of BIAS_QUESTIONS) {
 const ans = answers[q.id];
 if (ans === true) {
 if (!byBias[q.bias]) {
 byBias[q.bias] = { count: 0, lesson: q.lesson, lessonNum: q.lessonNum };
 }
 byBias[q.bias].count += 1;
 }
 }
 const sorted = Object.entries(byBias).sort((a, b) => b[1].count - a[1].count);
 const yesCount = BIAS_QUESTIONS.filter((q) => answers[q.id] === true).length;
 return { sorted, yesCount };
 }, [answers]);

 const dominantBias = scores.sorted.length > 0 ? scores.sorted[0] : null;
 const answeredCount = Object.keys(answers).length;

 const reset = () => {
 setAnswers({});
 setSubmitted(false);
 };

 return (
 <Card className="overflow-hidden border-warning/20 via-card to-card">
 <CardHeader className="gap-2 border-b bg-warning/20 px-4 py-3 sm:px-6">
 <div className="flex items-center gap-2">
 <div className="flex h-9 w-9 items-center justify-center rounded-md bg-warning/15 text-warning ">
 <Brain className="h-5 w-5" />
 </div>
 <div>
 <CardTitle className="text-base sm:text-lg">كاشف التحيز السلوكي</CardTitle>
 <CardDescription className="text-xs">
 7 أسئلة بسيطة — جاوب بصراحة لاكتشاف تحيزك المهيمن
 </CardDescription>
 </div>
 </div>
 </CardHeader>
 <CardContent className="space-y-4 p-4 sm:p-6">
 <div className="space-y-2.5">
 {BIAS_QUESTIONS.map((q, i) => (
 <div
 key={q.id}
 className="rounded-md border border-border bg-background/60 p-3"
 >
 <div className="mb-2 flex items-start gap-2">
 <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warning/15 text-xs font-bold text-warning ">
 {i + 1}
 </span>
 <p className="flex-1 text-xs leading-relaxed sm:text-sm">{q.text}</p>
 </div>
 <div className="flex gap-2 pr-7">
 <button
 type="button"
 onClick={() => toggleAnswer(q.id, true)}
 className={cn(
 'flex-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors',
 answers[q.id] === true
 ? 'border-loss/20 bg-loss/15 text-loss '
 : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60',
 )}
 >
 نعم
 </button>
 <button
 type="button"
 onClick={() => toggleAnswer(q.id, false)}
 className={cn(
 'flex-1 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors',
 answers[q.id] === false
 ? 'border-profit/20 bg-profit/15 text-profit '
 : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60',
 )}
 >
 لا
 </button>
 </div>
 </div>
 ))}
 </div>

 <div className="flex flex-wrap items-center gap-2">
 <Button
 onClick={() => setSubmitted(true)}
 disabled={answeredCount < BIAS_QUESTIONS.length}
 size="sm"
 className="bg-warning hover:bg-warning"
 >
 <CheckCircle2 className="ml-2 h-4 w-4" />
 اعرض التحيز المهيمن
 </Button>
 <Button onClick={reset} variant="outline" size="sm">
 <RefreshCw className="ml-2 h-4 w-4" />
 إعادة
 </Button>
 <span className="text-xs text-muted-foreground">
 ({answeredCount}/{BIAS_QUESTIONS.length} مجاب)
 </span>
 </div>

 {submitted && (
 <div className="space-y-3">
 {dominantBias ? (
 <div className="rounded-md border border-loss/20 bg-loss/10 p-4">
 <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-loss ">
 <AlertTriangle className="h-4 w-4" />
 تحيزك المهيمن: {dominantBias[0]}
 </div>
 <p className="text-xs leading-relaxed text-loss ">
 أجبت بـ &quot;نعم&quot; على {dominantBias[1].count} من الأسئلة المرتبطة بهذا التحيز. هذا
 التحيز هو السبب الأكثر احتمالاً لخسائرك. راجع{' '}
 <span className="font-semibold">درس رقم {dominantBias[1].lessonNum} — {dominantBias[1].lesson}</span>{' '}
 للتعمّق في الأسباب والحلول العملية.
 </p>
 </div>
 ) : (
 <div className="rounded-md border border-profit/20 bg-profit/10 p-4">
 <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-profit ">
 <CheckCircle2 className="h-4 w-4" />
 ممتاز — لا يوجد تحيز مهيمن واضح
 </div>
 <p className="text-xs leading-relaxed text-profit ">
 أجبت بـ &quot;لا&quot; على كل الأسئلة. هذا يعني أن سلوكك التداولي منضبط نسبياً. استمر في
 الالتزام بـ SOPs (Checklist + Hard Rules + Journal + Review) للحفاظ على هذا الانضباط.
 </p>
 </div>
 )}

 {scores.sorted.length > 1 && (
 <div className="rounded-md border border-slate-500/30 bg-muted/30 p-3">
 <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
 تحيزات أخرى مكتشفة ({scores.sorted.length})
 </div>
 <ul className="space-y-1.5">
 {scores.sorted.map(([bias, info]) => (
 <li key={bias} className="flex items-center justify-between text-xs">
 <span className="font-medium">{bias}</span>
 <span className="text-muted-foreground">
 {info.count} &middot; درس #{info.lessonNum}
 </span>
 </li>
 ))}
 </ul>
 </div>
 )}

 <div className="rounded-md border border-warning/20 bg-warning/10 /20 p-3 text-xs text-warning ">
 <span className="font-semibold">إجمالي إجابات &quot;نعم&quot;:</span> {scores.yesCount} من {BIAS_QUESTIONS.length}.{' '}
 {scores.yesCount >= 4
 ? '⚠️ درجة عالية — راجع يومياتك وطبّق SOPs بصرامة أكبر.'
 : scores.yesCount >= 2
 ? '🟡 درجة متوسطة — عندك تحيزات واضحة، اشتغل عليها.'
 : '✅ درجة منخفضة — سلوكك منضبط.'}
 </div>
 </div>
 )}
 </CardContent>
 </Card>
 );
}

function PracticalToolsView() {
 return (
 <div className="space-y-6">
 <div className="rounded-lg border border-warning/20 bg-warning/20 px-4 py-3 text-xs text-warning sm:px-6">
 <span className="font-semibold">🧮 الأدوات العملية —</span> حاسبتان عمليتان لكل مستثمر: الأولى
 تحسب حجم الصفقة المثالي بناءً على المخاطرة المسموحة، والثانية تكشف تحيزاتك السلوكية المهيمنة
 وتوجّهك للدرس المناسب.
 </div>
 <PositionSizeCalculator />
 <BiasDetectorQuiz />
 </div>
 );
}

/* ============================================================
 AdvancedLabView — التبويب الثامن: المختبر المتقدم
 Task 36-B + 36-C — Owner directive: «نزود فى المساعدات التعليمية
 من صور ومحاكيات ورسوم بيانية ورسوم توضيحية»
 Renders all 5 new visuals + both new simulators in a single
 scrollable layout. Each component is self-contained and
 teaches ONE specific concept (Rule 67 — no stubs).
 ============================================================ */
function AdvancedLabView() {
 return (
 <div className="space-y-6">
 <div className="rounded-lg border border-profit/20 bg-profit/20 px-4 py-3 text-xs text-profit sm:px-6" dir="rtl">
 <span className="font-semibold">🔬 المختبر المتقدم —</span> 5 رسوم بيانية تفاعلية + محاكيان
 متقدمان. كل أداة بتعلمك مفهوم محدد: مراحل السوق، تدفّق الأوامر، أنماط الشموع،
 حاسبة المخاطرة/العائد، توزيع المحفظة، محاكاة Monte Carlo، ومقارنة استراتيجيات
 الدخول. اسحب، عدّل، وشغّل — التعليم بالتجربة أقوى من القراءة فقط.
 </div>

 {/* 5 visuals */}
 <MarketStagesVisual />
 <OrderFlowVisual />
 <CandlestickPatternsVisual />
 <RiskRewardVisual />
 <PortfolioAllocationVisual />

 {/* 2 simulators */}
 <PortfolioSimulator />
 <EntryTimingSimulator />
 </div>
 );
}

export default AcademyView;
