'use client';

/**
 * academy/AdvancedLessonsTab.tsx
 * ============================================================================
 * F-Phase3-Split-Academy: Extracted from AcademyView.tsx (was 2,357 LOC).
 * ----------------------------------------------------------------------------
 * Advanced Lessons tab — wires `content/education/*.md` (12+ institutional
 * lessons written by the owner) into the user-facing academy screen via the
 * `/api/ads/educational-lessons` API. Renders a sidebar list + master-detail
 * panel. "إظهار النص الكامل" button fetches the full markdown content of the
 * selected lesson and renders it with AdvancedMarkdownRenderer.
 *
 * PAYWALL Gate 4: first 3 lessons free, lessons 4+ locked (blurred) for free
 * users post-trial. Titles remain visible to communicate depth.
 *
 * Data layer (Strangler F-Strangler-AcademyView): all fetch logic, caching,
 * and loadFull state are owned by `useAcademyLessonsData` (Phase 2). This
 * component retains only UI state: activeId (selected lesson), showFull (toggle).
 * ============================================================================
 */

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Download,
  GraduationCap,
  Loader2,
  Lock,
  RefreshCw,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { getTrialStatus } from '@/lib/subscription-gate';
import { useAcademyLessonsData } from '@/hooks/useAcademyData';
import { LEVEL_VARIANT } from './helpers';
import { AdvancedMarkdownRenderer } from './AdvancedMarkdownRenderer';

export function AdvancedLessonsTab() {
  // ─── Data layer (Strangler F-Strangler-AcademyView) ───────────────────────
  // All fetch logic, caching, and loadFull state are owned by useAcademyLessonsData.
  // Component retains only UI state: activeId (selected lesson), showFull (toggle).
  const {
    lessons,
    loading,
    error,
    refetch,
    loadingFull,
    loadFull,
    getFull,
  } = useAcademyLessonsData();

  // UI state (component-local — not data state)
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [showFull, setShowFull] = React.useState(false);

  // PAYWALL Gate 4: first 3 lessons free, lessons 4-12 locked (blurred) for free users post-trial.
  // Titles remain visible to communicate depth (12 institutional lessons).
  const subscriptionUser = useAppStore((s) => s.user);
  const lessonsSubStatus = getTrialStatus(subscriptionUser);
  const lessonsLocked = lessonsSubStatus.isFreeUser && lessonsSubStatus.isTrialExpired;
  const FREE_LESSON_COUNT = 3;

  // On first lessons arrival, auto-select the first lesson (matches original
  // `setActiveId(data.lessons[0].id)` inside fetch success handler).
  React.useEffect(() => {
    if (lessons.length > 0 && activeId === null) {
      setActiveId(lessons[0].id);
    }
  }, [lessons, activeId]);

  // Wrap imperative loadFull so the component toggles showFull on non-null return
  // (preserves original `setShowFull(true)` inside loadFull success branch).
  const handleLoadFull = React.useCallback(
    async (id: string) => {
      const full = await loadFull(id);
      if (full) setShowFull(true);
    },
    [loadFull],
  );

  // Reset "show full" toggle when user switches lesson (matches original).
  React.useEffect(() => {
    setShowFull(false);
  }, [activeId]);

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
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
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

  const fullContent = getFull(active.id);

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
                  onClick={() => handleLoadFull(active.id)}
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
