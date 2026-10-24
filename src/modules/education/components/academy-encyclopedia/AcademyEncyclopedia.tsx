/**
 * academy-encyclopedia/AcademyEncyclopedia.tsx (container)
 * =========================================================
 * Thin orchestrator. Owns:
 *  - activeLessonId + progress + hydrated useState slices.
 *  - mount-time useEffect that calls `loadProgress()`.
 *  - markLessonComplete + goToNextLesson + defaultAccordionValue memos.
 *  - The render layout: progress bar + category sidebar (Accordion) +
 *    main lesson article (header + sections + LessonDiagram + LessonQuiz +
 *    "mark complete" fallback + next-lesson button).
 *
 * Sub-modules live in this folder:
 *  - types.ts                  (Category, Level, Lesson, QuizQuestion, etc.)
 *  - constants.ts              (CATEGORIES + LEVEL_LABELS + LEVEL_BADGE_VARIANT + PROGRESS_KEY)
 *  - lessons.ts                (LESSONS catalog — 12 lessons across 6 categories)
 *  - progress.ts              (loadProgress + saveProgress localStorage helpers)
 *  - renderBody.tsx           (inline **bold** markdown-like renderer)
 *  - LessonDiagram.tsx        (inline SVG candle / line / bar / pie diagrams)
 *  - LessonQuiz.tsx           (interactive quiz with instant feedback + retry)
 *
 * Extracted from the original `AcademyEncyclopedia.tsx` (2,054 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 *
 * Backward compatible: existing import sites keep working unchanged via the
 * parent re-export shim (`src/modules/education/components/AcademyEncyclopedia.tsx`).
 */

'use client';

// P40-ACADEMY PILLAR 4: Encyclopedia
// Comprehensive illustrated Arabic-RTL trading academy with category sidebar,
// rich lesson content, simple SVG diagrams, interactive quizzes, localStorage
// progress tracking, and PDF export hook (via LessonPDFExporter).

import * as React from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  Circle,
  Clock,
  GraduationCap,
  Trophy,
} from 'lucide-react';
import { toast } from 'sonner';
import { LessonPDFExporter } from '../LessonPDFExporter';
import { CATEGORIES, LEVEL_BADGE_VARIANT, LEVEL_LABELS } from './constants';
import { LESSONS } from './lessons';
import { loadProgress, saveProgress } from './progress';
import { renderBody } from './renderBody';
import { LessonDiagram } from './LessonDiagram';
import { LessonQuiz } from './LessonQuiz';
import type { AcademyProgress, Category, Lesson } from './types';

export function AcademyEncyclopedia() {
  const [activeLessonId, setActiveLessonId] = React.useState<string>(LESSONS[0].id);
  const [progress, setProgress] = React.useState<AcademyProgress>({
    completedLessonIds: [],
    quizScores: {},
  });
  const [hydrated, setHydrated] = React.useState(false);

  // Load progress from localStorage on mount
  React.useEffect(() => {
    setProgress(loadProgress());
    setHydrated(true);
  }, []);

  const activeLesson = React.useMemo(
    () => LESSONS.find((l) => l.id === activeLessonId) ?? LESSONS[0],
    [activeLessonId],
  );

  // Group lessons by category
  const lessonsByCategory = React.useMemo(() => {
    const map: Record<Category, Lesson[]> = {
      basics: [],
      technical: [],
      fundamental: [],
      smc: [],
      risk: [],
      psychology: [],
      islamic: [],
    };
    for (const l of LESSONS) {
      map[l.category].push(l);
    }
    return map;
  }, []);

  const totalLessons = LESSONS.length;
  const completedCount = progress.completedLessonIds.length;
  const progressPercent = Math.round((completedCount / totalLessons) * 100);

  const markLessonComplete = React.useCallback(
    (lessonId: string, quizScore?: { correct: number; total: number }) => {
      setProgress((prev) => {
        const next: AcademyProgress = {
          completedLessonIds: prev.completedLessonIds.includes(lessonId)
            ? prev.completedLessonIds
            : [...prev.completedLessonIds, lessonId],
          quizScores:
            quizScore != null
              ? { ...prev.quizScores, [lessonId]: quizScore.correct }
              : prev.quizScores,
        };
        saveProgress(next);
        return next;
      });
      if (quizScore != null) {
        toast.success(`أحسنت! ${quizScore.correct}/${quizScore.total} — تم تسجيل إنجازك في الدرس`);
      }
    },
    [],
  );

  const goToNextLesson = React.useCallback(() => {
    const idx = LESSONS.findIndex((l) => l.id === activeLessonId);
    const next = LESSONS[(idx + 1) % LESSONS.length];
    setActiveLessonId(next.id);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activeLessonId]);

  // Default accordion: expand category of active lesson
  const defaultAccordionValue = React.useMemo(() => [activeLesson.category], [activeLesson]);

  return (
    <div dir="rtl" className="flex min-h-[600px] flex-col gap-4">
      {/* Progress bar */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <GraduationCap className="h-4 w-4 text-profit" />
            تقدّمك في الأكاديمية
          </div>
          <Badge variant="secondary" className="text-xs">
            {hydrated ? `أكملت ${completedCount} من ${totalLessons} درس` : '…'}
          </Badge>
        </div>
        <Progress value={hydrated ? progressPercent : 0} className="h-2" />
        <div className="mt-1.5 text-xs text-muted-foreground">
          {hydrated
            ? progressPercent === 100
              ? 'أكملت كل الدروس'
              : `بقي ${totalLessons - completedCount} درس لإكمال الأكاديمية`
            : 'جارٍ تحميل تقدّمك…'}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Sidebar: category accordion */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <div className="flex items-center gap-2 font-semibold">
                <BookOpen className="h-4 w-4 text-profit" />
                فهرس الدروس
              </div>
            </div>
            <ScrollArea className="h-[60vh] lg:h-[70vh]">
              <Accordion
                type="multiple"
                defaultValue={defaultAccordionValue}
                className="w-full px-2"
              >
                {CATEGORIES.map((cat) => {
                  const lessons = lessonsByCategory[cat.id];
                  if (lessons.length === 0) return null;
                  return (
                    <AccordionItem key={cat.id} value={cat.id}>
                      <AccordionTrigger className="px-2 hover:no-underline">
                        <span className="flex items-center gap-2">
                          <span className="text-base">{cat.icon}</span>
                          <span className={cn('font-semibold', cat.color)}>{cat.label}</span>
                          <Badge variant="outline" className="text-xs">
                            {lessons.length}
                          </Badge>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pb-2">
                        <ul className="space-y-1">
                          {lessons.map((l) => {
                            const isActive = l.id === activeLessonId;
                            const isDone = progress.completedLessonIds.includes(l.id);
                            return (
                              <li key={l.id}>
                                <button
                                  type="button"
                                  onClick={() => setActiveLessonId(l.id)}
                                  className={cn(
                                    'flex w-full items-start gap-2 rounded-md px-2 py-2 text-right text-sm transition-colors',
                                    isActive
                                      ? 'bg-profit font-semibold text-profit/40 '
                                      : 'hover:bg-accent/60',
                                  )}
                                >
                                  {isDone ? (
                                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-profit" />
                                  ) : (
                                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />
                                  )}
                                  <span className="flex-1 leading-snug">
                                    <span className="mr-1">{l.icon}</span>
                                    {l.title}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </ScrollArea>
          </div>
        </aside>

        {/* Main lesson area */}
        <main className="min-w-0">
          <article className="rounded-lg border bg-card">
            {/* Lesson header */}
            <header className="border-b to-transparent p-5 /20">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-profit text-2xl /50">
                    {activeLesson.icon}
                  </div>
                  <div>
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-profit ">
                        {CATEGORIES.find((c) => c.id === activeLesson.category)?.label}
                      </span>
                      <span>·</span>
                      <span>{activeLesson.titleEn}</span>
                    </div>
                    <h2 className="text-xl font-bold leading-tight sm:text-2xl">
                      {activeLesson.title}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant={LEVEL_BADGE_VARIANT[activeLesson.level]}>
                        {LEVEL_LABELS[activeLesson.level]}
                      </Badge>
                      <Badge variant="outline" className="gap-1">
                        <Clock className="h-3 w-3" />
                        {activeLesson.duration} دقيقة
                      </Badge>
                      <Badge variant="outline">{activeLesson.sections.length} أقسام</Badge>
                      {progress.completedLessonIds.includes(activeLesson.id) ? (
                        <Badge className="gap-1 bg-profit text-white hover:bg-profit">
                          <CheckCircle2 className="h-3 w-3" />
                          مكتمل
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </div>
                <LessonPDFExporter lesson={activeLesson} />
              </div>
              <p className="mt-3 rounded-md bg-muted/40 p-3 text-sm leading-relaxed text-muted-foreground">
                {activeLesson.summary}
              </p>
            </header>

            {/* Sections */}
            <div className="space-y-6 p-5">
              {activeLesson.sections.map((section, idx) => (
                <section key={idx} className="space-y-3">
                  <h2 className="flex items-center gap-2 border-r-4 border-profit pr-3 text-lg font-bold">
                    <span className="text-muted-foreground/60">{idx + 1}.</span>
                    {section.heading}
                  </h2>
                  <p className="whitespace-pre-line leading-relaxed text-foreground/90">
                    {renderBody(section.body)}
                  </p>

                  {section.diagram ? (
                    <figure className="my-3">
                      <LessonDiagram diagram={section.diagram} />
                      <figcaption className="mt-1 text-center text-xs text-muted-foreground">
                        شكل توضيحي: {section.heading}
                      </figcaption>
                    </figure>
                  ) : null}

                  {section.keyPoints && section.keyPoints.length > 0 ? (
                    <ul className="space-y-1.5 rounded-md bg-profit/10 p-3 /20">
                      {section.keyPoints.map((kp, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-profit" />
                          <span className="leading-relaxed">{kp}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ))}

              {/* Quiz */}
              {activeLesson.quiz && activeLesson.quiz.length > 0 ? (
                <section className="space-y-4 border-t pt-5">
                  <h2 className="flex items-center gap-2 text-lg font-bold">
                    <Trophy className="h-5 w-5 text-warning" />
                    اختبر معلوماتك
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    أجب عن الأسئلة التالية للحصول على شارة الإنجاز وإكمال الدرس. ستحصل على
                    تفسير فوري لكل إجابة.
                  </p>
                  <LessonQuiz
                    lessonId={activeLesson.id}
                    quiz={activeLesson.quiz}
                    onComplete={(correct, total) =>
                      markLessonComplete(activeLesson.id, { correct, total })
                    }
                  />
                </section>
              ) : (
                <section className="border-t pt-5">
                  <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                    هذا الدرس بدون اختبار — اضغط &quot;تم&quot; لتسجيل إكماله
                  </div>
                  <Button
                    className="mt-3 w-full sm:w-auto"
                    variant={
                      progress.completedLessonIds.includes(activeLesson.id)
                        ? 'secondary'
                        : 'default'
                    }
                    onClick={() => {
                      markLessonComplete(activeLesson.id);
                      toast.success('تم تسجيل إكمال الدرس');
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {progress.completedLessonIds.includes(activeLesson.id)
                      ? 'تم الإكمال ✓'
                      : 'وضع علامة كمكتمل'}
                  </Button>
                </section>
              )}

              {/* Next lesson */}
              <section className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                <div className="text-sm text-muted-foreground">
                  الدرس الحالي:{' '}
                  <span className="font-semibold text-foreground">{activeLesson.title}</span>
                </div>
                <Button onClick={goToNextLesson} variant="default">
                  الدرس التالي
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </section>
            </div>
          </article>
        </main>
      </div>
    </div>
  );
}

export default AcademyEncyclopedia;
