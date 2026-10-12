'use client';

// P40-ACADEMY PILLAR 4: Encyclopedia
// Comprehensive illustrated Arabic-RTL trading academy with category sidebar,
// rich lesson content, simple SVG diagrams, interactive quizzes, localStorage
// progress tracking, and PDF export hook (via LessonPDFExporter).
//
// PKG1-ROUND2 (i18n Migration):
//   - Lesson content (titles, summaries, sections, quiz text) extracted to
//     /messages/academy-lessons.{ar,en}.json (NOT under src/ → not counted by
//     i18n_audit.py).
//   - UI strings (category labels, level labels, toasts, buttons, badges) now
//     go through useTranslation() hook → keys under messages/{ar,en}.json
//     "academy.*".

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
import { useTranslation, useLocale } from '@/lib/i18n-context';
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  Circle,
  Clock,
  GraduationCap,
  Trophy,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  LessonPDFExporter,
  type LessonContent,
  type LessonSection,
} from './LessonPDFExporter';
import academyLessonsAr from '../../../../messages/academy-lessons.ar.json';
import academyLessonsEn from '../../../../messages/academy-lessons.en.json';

/* ============================================================
   TYPES — local superset of LessonContent
   ============================================================ */

type Category = LessonContent['category'];
type Level = LessonContent['level'];

interface Lesson extends LessonContent {}

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

/* ============================================================
   CATEGORY METADATA — labels now sourced via t('academy.categories.<id>')
   ============================================================ */

interface CategoryMeta {
  id: Category;
  icon: string;
  color: string;
}

const CATEGORIES: CategoryMeta[] = [
  { id: 'basics', icon: '📘', color: 'text-sky-600' },
  { id: 'technical', icon: '📈', color: 'text-violet-600' },
  { id: 'fundamental', icon: '🏛️', color: 'text-amber-600' },
  { id: 'smc', icon: '⚙️', color: 'text-rose-600' },
  { id: 'risk', icon: '🛡️', color: 'text-emerald-600' },
  { id: 'psychology', icon: '🧘', color: 'text-fuchsia-600' },
  // Task 29 Fix 4 — new category to surface Islamic finance / purification lessons
  { id: 'islamic', icon: '🕌', color: 'text-teal-700 dark:text-teal-400' },
];

const LEVEL_BADGE_VARIANT: Record<
  Level,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  beginner: 'secondary',
  intermediate: 'default',
  advanced: 'destructive',
};

/* ============================================================
   LESSONS — bilingual content loaded from /messages/*.json
   (outside src/ → not counted by i18n_audit.py)
   ============================================================ */

const LESSONS_BY_LOCALE: Record<'ar' | 'en', Lesson[]> = {
  ar: (academyLessonsAr as { lessons: Lesson[] }).lessons,
  en: (academyLessonsEn as { lessons: Lesson[] }).lessons,
};

/* ============================================================
   PROGRESS TRACKING — localStorage (academy_progress)
   ============================================================ */

interface AcademyProgress {
  completedLessonIds: string[];
  quizScores: Record<string, number>; // lessonId -> correct count
}

const PROGRESS_KEY = 'academy_progress';

function loadProgress(): AcademyProgress {
  if (typeof window === 'undefined') {
    return { completedLessonIds: [], quizScores: {} };
  }
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return { completedLessonIds: [], quizScores: {} };
    const parsed = JSON.parse(raw) as Partial<AcademyProgress>;
    return {
      completedLessonIds: parsed.completedLessonIds ?? [],
      quizScores: parsed.quizScores ?? {},
    };
  } catch { // silent fallback (safe-by-design)
    return { completedLessonIds: [], quizScores: {} };
  }
}

function saveProgress(p: AcademyProgress) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch { // silent fallback (safe-by-design)
    // ignore
  }
}

/* ============================================================
   DIAGRAM COMPONENT — illustrative SVG
   ============================================================ */

function LessonDiagram({ diagram, t }: { diagram: NonNullable<LessonSection['diagram']>; t: (k: string, p?: Record<string, string | number>) => string }) {
  const W = 480;
  const H = 200;
  if (diagram.type === 'candle') {
    const candles = [40, 110, 180, 250, 320, 390, 460];
    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        className="rounded-md bg-muted/30"
        role="img"
        aria-label={t('academy.diagram.candleAria')}
      >
        {candles.map((x, i) => {
          const up = i % 2 === 0;
          const color = up ? '#10b981' : '#ef4444';
          const top = 25 + ((i * 7) % 60);
          const bottom = H - 25 - ((i * 5) % 50);
          const bodyTop = top + 25;
          const bodyH = Math.max(bottom - top - 60, 18);
          return (
            <g key={x}>
              <line x1={x} y1={top} x2={x} y2={bottom} stroke={color} strokeWidth={2} />
              <rect
                x={x - 12}
                y={bodyTop}
                width={24}
                height={bodyH}
                fill={color}
                rx={2}
              />
            </g>
          );
        })}
      </svg>
    );
  }
  if (diagram.type === 'line') {
    const pts = [40, 70, 55, 95, 60, 130, 80, 110, 120, 60, 160, 90, 140, 50];
    const poly = pts.map((y, i) => `${20 + i * 32},${y}`).join(' ');
    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        className="rounded-md bg-muted/30"
        role="img"
        aria-label={t('academy.diagram.lineAria')}
      >
        <polyline points={poly} fill="none" stroke="#0d9488" strokeWidth={3} />
        {poly.split(' ').map((p) => {
          const [x, y] = p.split(',').map(Number);
          return <circle key={p} cx={x} cy={y} r={3} fill="#0f766e" />;
        })}
      </svg>
    );
  }
  if (diagram.type === 'bar') {
    const bars = [60, 110, 90, 140, 100, 130, 80];
    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        className="rounded-md bg-muted/30"
        role="img"
        aria-label={t('academy.diagram.barAria')}
      >
        {bars.map((h, i) => (
          <rect
            key={i}
            x={30 + i * 60}
            y={H - 25 - h}
            width={40}
            height={h}
            fill="#0d9488"
            rx={3}
          />
        ))}
      </svg>
    );
  }
  // pie
  const r = 80;
  const cx = W / 2;
  const cy = H / 2;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      className="rounded-md bg-muted/30"
      role="img"
      aria-label={t('academy.diagram.pieAria')}
    >
      <circle cx={cx} cy={cy} r={r} fill="#ccfbf1" />
      <path
        d={`M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx + r} ${cy} Z`}
        fill="#0d9488"
      />
      <path
        d={`M ${cx} ${cy} L ${cx + r} ${cy} A ${r} ${r} 0 0 1 ${cx} ${cy + r} Z`}
        fill="#0f766e"
      />
      <path
        d={`M ${cx} ${cy} L ${cx} ${cy + r} A ${r} ${r} 0 0 1 ${cx - r} ${cy} Z`}
        fill="#115e59"
      />
    </svg>
  );
}

/* ============================================================
   QUIZ COMPONENT
   ============================================================ */

interface QuizState {
  selected: Record<number, number>; // questionIndex -> selectedOptionIndex
  submitted: boolean;
}

function LessonQuiz({
  lessonId,
  quiz,
  onComplete,
  t,
}: {
  lessonId: string;
  quiz: QuizQuestion[];
  onComplete: (correctCount: number, total: number) => void;
  t: (k: string, p?: Record<string, string | number>) => string;
}) {
  const [state, setState] = React.useState<QuizState>({ selected: {}, submitted: false });

  const handleSelect = (qIdx: number, optIdx: number) => {
    if (state.submitted) return;
    setState((s) => ({ ...s, selected: { ...s.selected, [qIdx]: optIdx } }));
  };

  const handleSubmit = () => {
    const correct = quiz.reduce(
      (acc, q, i) => acc + (state.selected[i] === q.correctIndex ? 1 : 0),
      0,
    );
    setState((s) => ({ ...s, submitted: true }));
    onComplete(correct, quiz.length);
  };

  const handleReset = () => {
    setState({ selected: {}, submitted: false });
  };

  const correctCount = quiz.reduce(
    (acc, q, i) => acc + (state.selected[i] === q.correctIndex ? 1 : 0),
    0,
  );
  const allAnswered = quiz.every((_, i) => state.selected[i] !== undefined);
  const scorePercent = Math.round((correctCount / quiz.length) * 100);

  return (
    <div className="space-y-5" dir="rtl">
      {quiz.map((q, qi) => {
        const selectedIdx = state.selected[qi];
        const isCorrect = state.submitted && selectedIdx === q.correctIndex;
        const isWrong = state.submitted && selectedIdx !== undefined && selectedIdx !== q.correctIndex;
        return (
          <div
            key={qi}
            className={cn(
              'rounded-lg border p-4 transition-colors',
              isCorrect && 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30',
              isWrong && 'border-rose-500 bg-rose-50 dark:bg-rose-950/30',
              !state.submitted && 'border-border',
            )}
          >
            <div className="mb-3 flex items-start gap-2">
              <Badge variant="outline" className="shrink-0">
                {t('academy.quiz.question', { n: qi + 1 })}
              </Badge>
              <p className="font-semibold leading-relaxed">{q.question}</p>
            </div>
            <div className="space-y-2">
              {q.options.map((opt, oi) => {
                const isSelected = selectedIdx === oi;
                const showCorrect = state.submitted && oi === q.correctIndex;
                const showWrong = state.submitted && isSelected && oi !== q.correctIndex;
                return (
                  <button
                    key={oi}
                    type="button"
                    disabled={state.submitted}
                    onClick={() => handleSelect(qi, oi)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-right transition-colors',
                      'hover:bg-accent/60 disabled:cursor-not-allowed',
                      isSelected && !state.submitted && 'border-primary bg-primary/5',
                      showCorrect && 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40',
                      showWrong && 'border-rose-500 bg-rose-50 dark:bg-rose-950/40',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold',
                        isSelected && !state.submitted && 'border-primary bg-primary text-primary-foreground',
                        showCorrect && 'border-emerald-500 bg-emerald-500 text-white',
                        showWrong && 'border-rose-500 bg-rose-500 text-white',
                      )}
                    >
                      {showCorrect ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : showWrong ? (
                        <XCircle className="h-3.5 w-3.5" />
                      ) : (
                        String.fromCharCode(0x0623 + oi)
                      )}
                    </span>
                    <span className="flex-1 text-sm">{opt}</span>
                  </button>
                );
              })}
            </div>
            {state.submitted ? (
              <div
                className={cn(
                  'mt-3 rounded-md border-r-4 p-3 text-sm',
                  isCorrect
                    ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30'
                    : 'border-amber-500 bg-amber-50/60 dark:bg-amber-950/30',
                )}
              >
                <span className="font-semibold">
                  {isCorrect ? t('academy.quiz.correct') : t('academy.quiz.wrong')}
                </span>
                <span className="text-muted-foreground">{q.explanation}</span>
              </div>
            ) : null}
          </div>
        );
      })}

      {!state.submitted ? (
        <Button onClick={handleSubmit} disabled={!allAnswered} className="w-full sm:w-auto">
          <GraduationCap className="h-4 w-4" />
          {t('academy.quiz.submit')}
        </Button>
      ) : (
        <div className="space-y-3" dir="rtl">
          <div
            className={cn(
              'flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4',
              scorePercent >= 70
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                : scorePercent >= 50
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
                  : 'border-rose-500 bg-rose-50 dark:bg-rose-950/30',
            )}
          >
            <div className="flex items-center gap-3">
              <Trophy
                className={cn(
                  'h-8 w-8',
                  scorePercent >= 70
                    ? 'text-emerald-600'
                    : scorePercent >= 50
                      ? 'text-amber-600'
                      : 'text-rose-600',
                )}
              />
              <div>
                <div className="font-bold">
                  {t('academy.quiz.achievementBadge', { correct: correctCount, total: quiz.length })}
                </div>
                <div className="text-sm text-muted-foreground">
                  {t('academy.quiz.score', { percent: scorePercent })}
                  {scorePercent >= 70
                    ? t('academy.quiz.excellent')
                    : scorePercent >= 50
                      ? t('academy.quiz.good')
                      : t('academy.quiz.retry')}
                </div>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleReset}>
              {t('academy.quiz.retake')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   SECTION BODY — render markdown-like bold + bullets inline
   ============================================================ */

function renderBody(body: string): React.ReactNode {
  // Split on ** for bold spans
  const parts = body.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-bold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    // Convert newlines to <br/> for the print template consistency
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export function AcademyEncyclopedia() {
  const t = useTranslation();
  const { locale } = useLocale();
  const lessons = LESSONS_BY_LOCALE[locale] ?? LESSONS_BY_LOCALE.ar;

  const [activeLessonId, setActiveLessonId] = React.useState<string>(lessons[0].id);
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
    () => lessons.find((l) => l.id === activeLessonId) ?? lessons[0],
    [activeLessonId, lessons],
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
    for (const l of lessons) {
      map[l.category].push(l);
    }
    return map;
  }, [lessons]);

  const totalLessons = lessons.length;
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
        toast.success(
          t('academy.lesson.quizToast', { correct: quizScore.correct, total: quizScore.total }),
        );
      }
    },
    [t],
  );

  const goToNextLesson = React.useCallback(() => {
    const idx = lessons.findIndex((l) => l.id === activeLessonId);
    const next = lessons[(idx + 1) % lessons.length];
    setActiveLessonId(next.id);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activeLessonId, lessons]);

  // Default accordion: expand category of active lesson
  const defaultAccordionValue = React.useMemo(() => [activeLesson.category], [activeLesson]);

  return (
    <div dir="rtl" className="flex min-h-[600px] flex-col gap-4">
      {/* Progress bar */}
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <GraduationCap className="h-4 w-4 text-emerald-600" />
            {t('academy.progress.title')}
          </div>
          <Badge variant="secondary" className="text-xs">
            {hydrated ? t('academy.progress.completed', { completed: completedCount, total: totalLessons }) : '…'}
          </Badge>
        </div>
        <Progress value={hydrated ? progressPercent : 0} className="h-2" />
        <div className="mt-1.5 text-xs text-muted-foreground">
          {hydrated
            ? progressPercent === 100
              ? t('academy.progress.allDone')
              : t('academy.progress.remaining', { count: totalLessons - completedCount })
            : t('academy.progress.loading')}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Sidebar: category accordion */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <div className="flex items-center gap-2 font-semibold">
                <BookOpen className="h-4 w-4 text-emerald-600" />
                {t('academy.sidebar.title')}
              </div>
            </div>
            <ScrollArea className="h-[60vh] lg:h-[70vh]">
              <Accordion
                type="multiple"
                defaultValue={defaultAccordionValue}
                className="w-full px-2"
              >
                {CATEGORIES.map((cat) => {
                  const lessonsInCat = lessonsByCategory[cat.id];
                  if (lessonsInCat.length === 0) return null;
                  return (
                    <AccordionItem key={cat.id} value={cat.id}>
                      <AccordionTrigger className="px-2 hover:no-underline">
                        <span className="flex items-center gap-2">
                          <span className="text-base">{cat.icon}</span>
                          <span className={cn('font-semibold', cat.color)}>
                            {t(`academy.categories.${cat.id}`)}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {lessonsInCat.length}
                          </Badge>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pb-2">
                        <ul className="space-y-1">
                          {lessonsInCat.map((l) => {
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
                                      ? 'bg-emerald-50 font-semibold text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100'
                                      : 'hover:bg-accent/60',
                                  )}
                                >
                                  {isDone ? (
                                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
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
            <header className="border-b bg-gradient-to-l from-emerald-50/50 to-transparent p-5 dark:from-emerald-950/20">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-2xl dark:bg-emerald-950/50">
                    {activeLesson.icon}
                  </div>
                  <div>
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        {t(`academy.categories.${activeLesson.category}`)}
                      </span>
                      <span>·</span>
                      <span>{activeLesson.titleEn}</span>
                    </div>
                    <h2 className="text-xl font-bold leading-tight sm:text-2xl">
                      {activeLesson.title}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant={LEVEL_BADGE_VARIANT[activeLesson.level]}>
                        {t(`academy.levels.${activeLesson.level}`)}
                      </Badge>
                      <Badge variant="outline" className="gap-1">
                        <Clock className="h-3 w-3" />
                        {activeLesson.duration} {t('academy.lesson.minutes')}
                      </Badge>
                      <Badge variant="outline">
                        {activeLesson.sections.length} {t('academy.lesson.sections')}
                      </Badge>
                      {progress.completedLessonIds.includes(activeLesson.id) ? (
                        <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
                          <CheckCircle2 className="h-3 w-3" />
                          {t('academy.lesson.completed')}
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
                  <h2 className="flex items-center gap-2 border-r-4 border-emerald-500 pr-3 text-lg font-bold">
                    <span className="text-muted-foreground/60">{idx + 1}.</span>
                    {section.heading}
                  </h2>
                  <p className="whitespace-pre-line leading-relaxed text-foreground/90">
                    {renderBody(section.body)}
                  </p>

                  {section.diagram ? (
                    <figure className="my-3">
                      <LessonDiagram diagram={section.diagram} t={t} />
                      <figcaption className="mt-1 text-center text-xs text-muted-foreground">
                        {t('academy.diagram.caption', { heading: section.heading })}
                      </figcaption>
                    </figure>
                  ) : null}

                  {section.keyPoints && section.keyPoints.length > 0 ? (
                    <ul className="space-y-1.5 rounded-md bg-emerald-50/50 p-3 dark:bg-emerald-950/20">
                      {section.keyPoints.map((kp, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
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
                    <Trophy className="h-5 w-5 text-amber-500" />
                    {t('academy.quiz.title')}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t('academy.quiz.instructions')}
                  </p>
                  <LessonQuiz
                    lessonId={activeLesson.id}
                    quiz={activeLesson.quiz}
                    t={t}
                    onComplete={(correct, total) =>
                      markLessonComplete(activeLesson.id, { correct, total })
                    }
                  />
                </section>
              ) : (
                <section className="border-t pt-5">
                  <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                    {t('academy.lesson.noQuiz')}
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
                      toast.success(t('academy.lesson.lessonCompleteToast'));
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {progress.completedLessonIds.includes(activeLesson.id)
                      ? t('academy.lesson.markCompleteDone')
                      : t('academy.lesson.markComplete')}
                  </Button>
                </section>
              )}

              {/* Next lesson */}
              <section className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                <div className="text-sm text-muted-foreground">
                  {t('academy.lesson.currentLesson')}: <span className="font-semibold text-foreground">{activeLesson.title}</span>
                </div>
                <Button onClick={goToNextLesson} variant="default">
                  {t('academy.lesson.nextLesson')}
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
