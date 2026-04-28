'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GraduationCap, BookOpen, TrendingUp, FileText, LineChart, Briefcase,
  Shield, Clock, ChevronLeft, CheckCircle2, Download, Award, Trophy,
  Target, ArrowRight, Star, Brain, Lightbulb, AlertTriangle, RotateCcw,
  Lock, Flame, Zap, Globe, ShieldAlert, GitBranch, Building, Globe2,
  Receipt, Bitcoin, BookmarkCheck, BarChart3, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { ShareButton } from '@/components/share/ShareButton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useLearningStore } from '@/lib/learning-store';
import {
  courses,
  articles,
  caseStudies,
  quizzes,
  getTotalLessons,
  getCourseCompletionStatus,
} from '@/data/learning-content';
import type { Course, Quiz, CaseStudy as CaseStudyType, Article as ArticleType } from '@/data/learning-content';

/* ============================================================
   ANIMATED INFOGRAPHIC COMPONENTS
   ============================================================ */

function AnimatedCounter({ value, duration = 1.2, className }: { value: number; duration?: number; className?: string }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (hasAnimated.current) return;
    hasAnimated.current = true;
    let start = 0;
    const end = Math.max(0, value);
    const stepTime = (duration * 1000) / Math.max(end, 1);
    const timer = setInterval(() => {
      start += 1;
      setDisplay(start);
      if (start >= end) clearInterval(timer);
    }, stepTime);
    return () => clearInterval(timer);
  }, [value, duration]);

  return <span ref={ref} className={className}>{display}</span>;
}

function StatsDonut({ percentage, size = 80, strokeWidth = 6, color = 'stroke-emerald-500' }: { percentage: number; size?: number; strokeWidth?: number; color?: string }) {
  const [offset, setOffset] = useState(0);
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;

  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(circumference - (Math.min(percentage, 100) / 100) * circumference);
    }, 300);
    return () => clearTimeout(timer);
  }, [percentage, circumference]);

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="stroke-muted" strokeWidth={strokeWidth} />
      <motion.circle
        cx={size / 2} cy={size / 2} r={radius} fill="none"
        className={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
    </svg>
  );
}

function LevelBadge({ level, index, isActive, isUnlocked }: { level: string; index: number; isActive: boolean; isUnlocked: boolean }) {
  const colors = ['bg-emerald-500', 'bg-teal-500', 'bg-amber-500', 'bg-orange-500', 'bg-yellow-400'];
  const glowColors = ['shadow-emerald-500/40', 'shadow-teal-500/40', 'shadow-amber-500/40', 'shadow-orange-500/40', 'shadow-yellow-400/40'];

  return (
    <motion.div
      className={cn(
        'relative flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl transition-all duration-300',
        isActive && 'bg-card border-2 border-emerald-500 shadow-lg ' + glowColors[index],
        isUnlocked && !isActive && 'bg-card border border-border',
        !isUnlocked && 'opacity-40',
      )}
      whileHover={{ scale: 1.05 }}
    >
      <div className={cn(
        'w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm',
        isUnlocked ? colors[index] : 'bg-muted-foreground/30',
      )}>
        {isUnlocked ? index + 1 : <Lock className="w-4 h-4" />}
      </div>
      <span className={cn('text-xs font-semibold text-center', isActive ? 'text-foreground' : 'text-muted-foreground')}>
        {level}
      </span>
      {isActive && (
        <motion.div
          className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full"
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
        />
      )}
    </motion.div>
  );
}

function ProgressPath({ currentLevelIndex, levelProgress }: { currentLevelIndex: number; levelProgress: number }) {
  const levels = ['مبتدئ', 'متعلم', 'محترف', 'خبير', 'مستثمر ذهبي'];

  return (
    <div className="w-full overflow-x-auto pb-2">
      <div className="flex items-center gap-2 min-w-max px-2">
        {levels.map((level, i) => (
          <React.Fragment key={level}>
            <LevelBadge level={level} index={i} isActive={i === currentLevelIndex} isUnlocked={i <= currentLevelIndex} />
            {i < levels.length - 1 && (
              <div className="flex-1 min-w-[40px] max-w-[80px] h-2 bg-muted rounded-full relative">
                <motion.div
                  className={cn(
                    'absolute inset-y-0 right-0 bg-gradient-to-l rounded-full',
                    i < currentLevelIndex ? 'from-emerald-500 to-teal-400' : 'from-muted-foreground/20 to-transparent',
                  )}
                  initial={{ width: '0%' }}
                  animate={{ width: i < currentLevelIndex ? '100%' : (i === currentLevelIndex ? `${levelProgress}%` : '0%') }}
                  transition={{ duration: 1, ease: 'easeOut', delay: 0.3 + i * 0.15 }}
                />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function ConfettiBurst({ show }: { show: boolean }) {
  if (!show) return null;
  const particles = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    x: Math.random() * 100 - 50,
    y: -(Math.random() * 80 + 20),
    color: ['bg-emerald-400', 'bg-teal-400', 'bg-amber-400', 'bg-rose-400', 'bg-yellow-400'][i % 5],
    delay: Math.random() * 0.3,
    size: Math.random() * 4 + 3,
  }));

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className={cn('absolute rounded-full', p.color)}
          style={{ width: p.size, height: p.size, left: '50%', top: '50%' }}
          initial={{ x: 0, y: 0, opacity: 1 }}
          animate={{ x: p.x, y: p.y, opacity: 0 }}
          transition={{ duration: 0.8, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

/* ============================================================
   HELPER FUNCTIONS
   ============================================================ */

const DIFFICULTY_FILTERS = ['الكل', 'مبتدئ', 'متوسط', 'متقدم'];

function getDifficultyColor(d: string) {
  if (d === 'مبتدئ') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
  if (d === 'متوسط') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
}

function getDifficultyCardBorder(d: string) {
  if (d === 'مبتدئ') return 'border-emerald-200 dark:border-emerald-800/40';
  if (d === 'متوسط') return 'border-amber-200 dark:border-amber-800/40';
  return 'border-rose-200 dark:border-rose-800/40';
}

function getDifficultyAccent(d: string) {
  if (d === 'مبتدئ') return 'from-emerald-500 to-teal-500';
  if (d === 'متوسط') return 'from-amber-500 to-orange-500';
  return 'from-rose-500 to-pink-500';
}

const ICON_MAP: Record<string, React.ElementType> = {
  BookOpen, FileText, TrendingUp, LineChart, Briefcase, Brain, Shield, Target,
  Globe, ShieldAlert, GitBranch, Building, Globe2, Receipt, Bitcoin,
};

function getIcon(name: string) {
  return ICON_MAP[name] || BookOpen;
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export function LearningView() {
  const store = useLearningStore();
  const { progress } = store;

  // ── UI State ─────────────────────────────────────────
  const [tab, setTab] = useState('courses');
  const [activeCourse, setActiveCourse] = useState<string | null>(null);
  const [activeLesson, setActiveLesson] = useState<number | null>(null);
  const [activeArticle, setActiveArticle] = useState<string | null>(null);
  const [activeCaseStudy, setActiveCaseStudy] = useState<string | null>(null);
  const [activeQuiz, setActiveQuiz] = useState<string | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [difficultyFilter, setDifficultyFilter] = useState('الكل');
  const [exporting, setExporting] = useState(false);
  const [confetti, setConfetti] = useState(false);

  // ── Computed ─────────────────────────────────────────
  const totalLessons = getTotalLessons();
  const completedCount = progress.completedLessons.length;
  const overallPct = totalLessons > 0 ? (completedCount / totalLessons) * 100 : 0;
  const quizCount = Object.keys(progress.quizScores).length;
  const avgScore = store.getQuizAverage();
  const level = store.getLevel();
  const levelProgress = store.getLevelProgress();

  const completedCourseIds = useMemo(() => {
    return courses
      .filter((c) => {
        const s = getCourseCompletionStatus(c.id, progress.completedLessons);
        return s.percentage === 100;
      })
      .map((c) => c.id);
  }, [progress.completedLessons]);

  const filteredCourses = useMemo(() => {
    if (difficultyFilter === 'الكل') return courses;
    return courses.filter((c) => c.difficulty === difficultyFilter);
  }, [difficultyFilter]);

  // Derived data
  const currentCourse = activeCourse ? courses.find((c) => c.id === activeCourse) ?? null : null;
  const currentArticle = activeArticle ? articles.find((a) => a.id === activeArticle) ?? null : null;
  const currentCaseStudy = activeCaseStudy ? caseStudies.find((cs) => cs.id === activeCaseStudy) ?? null : null;
  const currentQuiz = activeQuiz ? quizzes.find((q) => q.id === activeQuiz) ?? null : null;

  const unlockedBadges = progress.badges.filter((b) => b.unlocked).length;
  const totalBadges = progress.badges.length;

  // ── Actions ──────────────────────────────────────────
  const handleMarkLesson = useCallback((courseId: string, idx: number) => {
    const key = `${courseId}-${idx}`;
    if (progress.completedLessons.includes(key)) return;
    store.markLessonComplete(courseId, idx);
    setConfetti(true);
    setTimeout(() => setConfetti(false), 1000);
    toast.success('تم إكمال الدرس بنجاح! +10 XP 🎉');
    // Check badges
    setTimeout(() => {
      store.checkBadges(courses.length, completedCourseIds, articles.length, quizzes.length, avgScore);
    }, 100);
  }, [progress.completedLessons, store, completedCourseIds, avgScore]);

  const handleSubmitQuiz = useCallback((quiz: Quiz) => {
    let correct = 0;
    quiz.questions.forEach((q, i) => { if (quizAnswers[i] === q.correct) correct++; });
    const score = Math.round((correct / quiz.questions.length) * 100);
    store.submitQuiz(quiz.id, score);
    setQuizSubmitted(true);
    if (score >= 85) {
      setConfetti(true);
      setTimeout(() => setConfetti(false), 1500);
    }
    toast.success(`نتيجتك: ${score}% (${correct} من ${quiz.questions.length})`);
    setTimeout(() => {
      store.checkBadges(courses.length, completedCourseIds, articles.length, quizzes.length, avgScore);
    }, 100);
  }, [quizAnswers, store, completedCourseIds, avgScore]);

  const handleMarkArticle = useCallback((articleId: string) => {
    if (progress.articlesRead.includes(articleId)) return;
    store.markArticleRead(articleId);
    toast.success('تم تحديد المقال كمقروء +5 XP 📚');
    setTimeout(() => {
      store.checkBadges(courses.length, completedCourseIds, articles.length, quizzes.length, avgScore);
    }, 100);
  }, [progress.articlesRead, store, completedCourseIds, avgScore]);

  const startQuiz = (quizId: string) => {
    setActiveQuiz(quizId);
    setQuizAnswers({});
    setQuizSubmitted(false);
  };

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const { exportToPdf } = await import('@/lib/patch-html2pdf');
      const el = document.getElementById('learning-progress-export');
      if (!el) { toast.error('لم يتم العثور على محتوى'); return; }
      await exportToPdf(el, { filename: `learning_progress_${new Date().toISOString().split('T')[0]}.pdf` });
      toast.success('تم تصدير التقرير بنجاح');
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('حدث خطأ أثناء التصدير');
    } finally { setExporting(false); }
  };

  // ── Content renderer ─────────────────────────────────
  const renderContent = (text: string) => {
    return text.split('\n').map((paragraph, i) => {
      if (paragraph.startsWith('**') && paragraph.endsWith('**')) {
        return <h3 key={i} className="text-base font-bold mt-4 mb-2">{paragraph.replace(/\*\*/g, '')}</h3>;
      }
      if (paragraph.startsWith('- **')) {
        const [title, ...rest] = paragraph.replace(/^- /, '').split(':');
        return <p key={i} className="flex gap-2"><span className="font-semibold">{title.replace(/\*\*/g, '')}:</span><span>{rest.join(':').replace(/\*\*/g, '')}</span></p>;
      }
      if (paragraph.startsWith('- ')) {
        return <li key={i} className="mr-4 text-sm">{paragraph.slice(2)}</li>;
      }
      if (paragraph.match(/^\d+\./)) {
        return <li key={i} className="mr-4 text-sm">{paragraph.replace(/^(\d+)\. /, '')}</li>;
      }
      if (paragraph.trim() === '') return <br key={i} />;
      return <p key={i}>{paragraph}</p>;
    });
  };

  // ── Close detail views helper ────────────────────────
  const closeAll = () => {
    setActiveCourse(null); setActiveLesson(null);
    setActiveArticle(null); setActiveCaseStudy(null); setActiveQuiz(null);
  };

  /* ============================================================
     RENDER
     ============================================================ */
  return (
    <div dir="rtl" className="min-h-screen bg-background">
      {/* ── HEADER ──────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 mr-auto">
            <h2 className="text-lg font-bold">مركز التعلم</h2>
            <p className="text-xs text-muted-foreground">طوّر مهاراتك الاستثمارية</p>
          </div>
          <Button onClick={handleExportPDF} disabled={exporting} variant="outline" size="sm" className="gap-2 print:hidden">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">{exporting ? 'جارٍ التصدير...' : 'تصدير'}</span>
          </Button>
          <ShareButton iconOnly variant="outline" size="sm" stockData={{
            ticker: 'LEARNING', name: 'Learning Center',
            nameAr: `مركز التعلم - أكملت ${completedCount} من ${totalLessons} درس - المستوى: ${level.name}`,
            price: progress.xp,
            recommendation: `${level.name} - ${progress.xp} XP`,
            recommendationAr: `${level.name} - ${progress.xp} XP`,
            confidence: avgScore,
            sector: `${completedCourseIds.length} دورة مكتملة | ${unlockedBadges} إنجاز`,
          }} />
        </div>
      </div>

      <div className="p-4 md:p-6 space-y-6" id="learning-progress-export">
        {/* ── HERO / STATS SECTION ───────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <Card className="overflow-hidden border-0">
            <div className="relative bg-gradient-to-l from-emerald-600 via-teal-600 to-emerald-700 p-6 text-white overflow-hidden">
              {/* Floating particles */}
              <div className="absolute inset-0 opacity-10">
                {Array.from({ length: 6 }).map((_, i) => (
                  <motion.div key={i} className="absolute w-2 h-2 bg-white rounded-full"
                    style={{ top: `${15 + i * 14}%`, left: `${10 + i * 16}%` }}
                    animate={{ y: [0, -20, 0], opacity: [0.3, 0.8, 0.3] }}
                    transition={{ repeat: Infinity, duration: 3 + i * 0.5, delay: i * 0.4 }}
                  />
                ))}
              </div>
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
                    <GraduationCap className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">رحلة تعلمك الاستثمارية</h3>
                    <p className="text-sm text-white/80">تابع تقدمك واحصل على إنجازات</p>
                  </div>
                  <div className="mr-auto flex items-center gap-2">
                    <Badge className="bg-white/20 text-white border-white/30 hover:bg-white/30">
                      <Sparkles className="w-3 h-3 ml-1" />
                      {progress.xp} XP
                    </Badge>
                    <Badge className="bg-amber-500/90 text-white border-amber-400">
                      <Flame className="w-3 h-3 ml-1" />
                      {level.name}
                    </Badge>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'نقاط الخبرة', value: progress.xp, suffix: ' XP' },
                    { label: 'دروس مكتملة', value: completedCount, suffix: '' },
                    { label: 'متوسط الاختبارات', value: avgScore, suffix: '%' },
                    { label: 'مقالات مقروءة', value: progress.articlesRead.length, suffix: '' },
                  ].map((stat, i) => (
                    <motion.div
                      key={stat.label}
                      className="text-center p-3 bg-white/10 rounded-xl backdrop-blur-sm"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + i * 0.08 }}
                    >
                      <p className="text-2xl font-bold">
                        <AnimatedCounter value={stat.value} />
                        {stat.suffix}
                      </p>
                      <p className="text-xs text-white/70 mt-1">{stat.label}</p>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
            <CardContent className="p-4 space-y-4">
              {/* Level Progression Path */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">المستوى الحالي: <span className="text-emerald-600 dark:text-emerald-400 font-bold">{level.name}</span></span>
                  <span className="text-muted-foreground">{progress.xp} / {level.max === Infinity ? '1000+' : level.max} XP للمستوى التالي</span>
                </div>
                <ProgressPath currentLevelIndex={level.index} levelProgress={levelProgress} />
              </div>
              {/* Overall progress */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">التقدم الكلي في الدورات</span>
                  <span className="text-sm text-muted-foreground">{completedCount} من {totalLessons} درس</span>
                </div>
                <div className="relative">
                  <Progress value={overallPct} className="h-3" />
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                    <span className="text-[10px] font-bold text-muted-foreground bg-background px-1.5 py-0.5 rounded-full">
                      {overallPct.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* ── LESSON VIEW ─────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {activeCourse && activeLesson !== null && currentCourse && (
            <motion.div key="lesson" initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }} className="space-y-4">
              <Button variant="ghost" size="sm" onClick={() => setActiveLesson(null)} className="gap-2">
                <ArrowRight className="w-4 h-4" /> العودة للدورة
              </Button>
              <Card className="relative overflow-hidden">
                <ConfettiBurst show={confetti} />
                {/* Reading progress */}
                <div className="h-1 bg-muted">
                  <motion.div className="h-full bg-gradient-to-l from-emerald-500 to-teal-400"
                    initial={{ width: '0%' }}
                    animate={{ width: `${((activeLesson + 1) / currentCourse.lessons.length) * 100}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                <CardHeader>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className={getDifficultyColor(currentCourse.difficulty)}>{currentCourse.difficulty}</Badge>
                    <span className="text-xs text-muted-foreground">الدرس {activeLesson + 1} من {currentCourse.lessons.length}</span>
                  </div>
                  <CardTitle className="text-lg">{currentCourse.lessons[activeLesson].title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-line leading-relaxed text-sm">
                    {renderContent(currentCourse.lessons[activeLesson].content)}
                  </div>
                  <div className="flex gap-2 pt-4 border-t">
                    {activeLesson > 0 && (
                      <Button variant="outline" onClick={() => setActiveLesson(activeLesson - 1)} className="gap-2">
                        <ArrowRight className="w-4 h-4" /> السابق
                      </Button>
                    )}
                    <Button
                      onClick={() => handleMarkLesson(activeCourse, activeLesson)}
                      disabled={progress.completedLessons.includes(`${activeCourse}-${activeLesson}`)}
                      className={cn('gap-2', progress.completedLessons.includes(`${activeCourse}-${activeLesson}`) ? 'bg-emerald-600' : '')}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {progress.completedLessons.includes(`${activeCourse}-${activeLesson}`) ? 'مكتمل ✓' : 'تحديد كمكتمل'}
                    </Button>
                    {activeLesson < currentCourse.lessons.length - 1 && (
                      <Button variant="outline" onClick={() => setActiveLesson(activeLesson + 1)} className="gap-2 mr-auto">
                        التالي <ChevronLeft className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ── COURSE LESSON LIST ─────────────────────────── */}
          {activeCourse && activeLesson === null && currentCourse && !currentQuiz && (
            <motion.div key="course-list" initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }} className="space-y-4">
              <Button variant="ghost" size="sm" onClick={closeAll} className="gap-2">
                <ArrowRight className="w-4 h-4" /> العودة للدورات
              </Button>
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className={cn('w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-white', getDifficultyAccent(currentCourse.difficulty))}>
                      {React.createElement(getIcon(currentCourse.icon), { className: 'w-6 h-6' })}
                    </div>
                    <div>
                      <CardTitle className="text-lg">{currentCourse.title}</CardTitle>
                      <CardDescription>{currentCourse.description}</CardDescription>
                    </div>
                    <Badge className="mr-auto" variant="outline" >{getCourseCompletionStatus(currentCourse.id, progress.completedLessons).percentage.toFixed(0)}%</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {currentCourse.lessons.map((lesson, idx) => {
                    const isComplete = progress.completedLessons.includes(`${currentCourse.id}-${idx}`);
                    const isUnlocked = idx === 0 || progress.completedLessons.includes(`${currentCourse.id}-${idx - 1}`);
                    return (
                      <motion.button
                        key={idx}
                        className={cn(
                          'w-full flex items-center gap-3 p-3 rounded-lg text-right transition-all',
                          isComplete && 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40',
                          !isComplete && isUnlocked && 'hover:bg-muted border border-transparent',
                          !isUnlocked && 'opacity-50 cursor-not-allowed',
                        )}
                        onClick={() => isUnlocked && setActiveLesson(idx)}
                        whileHover={isUnlocked ? { scale: 1.01 } : {}}
                        whileTap={isUnlocked ? { scale: 0.99 } : {}}
                        disabled={!isUnlocked}
                      >
                        <div className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
                          isComplete ? 'bg-emerald-500 text-white' : isUnlocked ? 'bg-muted text-foreground' : 'bg-muted text-muted-foreground',
                        )}>
                          {isComplete ? <CheckCircle2 className="w-4 h-4" /> : isUnlocked ? <span className="text-sm font-bold">{idx + 1}</span> : <Lock className="w-3 h-3" />}
                        </div>
                        <span className={cn('text-sm font-medium', isComplete && 'text-emerald-700 dark:text-emerald-400')}>{lesson.title}</span>
                        {isUnlocked && !isComplete && (
                          <motion.div className="w-2 h-2 rounded-full bg-emerald-400 mr-auto"
                            animate={{ scale: [1, 1.5, 1] }}
                            transition={{ repeat: Infinity, duration: 2 }}
                          />
                        )}
                      </motion.button>
                    );
                  })}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ── ARTICLE VIEW ────────────────────────────────── */}
          {activeArticle && currentArticle && (
            <motion.div key="article" initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }} className="space-y-4">
              <Button variant="ghost" size="sm" onClick={() => setActiveArticle(null)} className="gap-2">
                <ArrowRight className="w-4 h-4" /> العودة للمقالات
              </Button>
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Badge variant="outline">{currentArticle.category}</Badge>
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> {currentArticle.readTime}</span>
                    {progress.articlesRead.includes(activeArticle) && <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"><BookmarkCheck className="w-3 h-3 ml-1" /> مقروء</Badge>}
                  </div>
                  <CardTitle className="text-lg">{currentArticle.title}</CardTitle>
                  <CardDescription>{currentArticle.summary}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="whitespace-pre-line leading-relaxed text-sm">{currentArticle.content}</div>
                  <div className="mt-4 pt-4 border-t">
                    <Button onClick={() => handleMarkArticle(activeArticle)} disabled={progress.articlesRead.includes(activeArticle)} className="gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      {progress.articlesRead.includes(activeArticle) ? 'مقروء ✓' : 'تحديد كمقروء'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ── CASE STUDY VIEW ─────────────────────────────── */}
          {activeCaseStudy && currentCaseStudy && (
            <motion.div key="case" initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }} className="space-y-4">
              <Button variant="ghost" size="sm" onClick={() => setActiveCaseStudy(null)} className="gap-2">
                <ArrowRight className="w-4 h-4" /> العودة لدراسات الحالة
              </Button>
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className={getDifficultyColor(currentCaseStudy.difficulty)}>{currentCaseStudy.difficulty}</Badge>
                    <Badge variant="outline" className="bg-muted">{currentCaseStudy.year}</Badge>
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> {currentCaseStudy.duration}</span>
                  </div>
                  <CardTitle className="text-lg">{currentCaseStudy.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="whitespace-pre-line leading-relaxed text-sm">{currentCaseStudy.narrative}</div>
                  <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                    <h4 className="font-bold text-sm">الدروس المستفادة:</h4>
                    {currentCaseStudy.lessons.map((l, i) => (
                      <p key={i} className="text-sm flex gap-2"><span className="text-emerald-500">•</span>{l}</p>
                    ))}
                  </div>
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800/40">
                    <h4 className="font-bold text-sm text-emerald-700 dark:text-emerald-400 mb-1"> takeaway:</h4>
                    <p className="text-sm">{currentCaseStudy.takeaway}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ── QUIZ VIEW ───────────────────────────────────── */}
          {activeQuiz && currentQuiz && (
            <motion.div key="quiz" initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }} className="space-y-4">
              <Button variant="ghost" size="sm" onClick={() => setActiveQuiz(null)} className="gap-2">
                <ArrowRight className="w-4 h-4" /> العودة للاختبارات
              </Button>
              <Card className="relative overflow-hidden">
                <ConfettiBurst show={confetti} />

                {quizSubmitted ? (
                  /* ── QUIZ RESULT ── */
                  <CardContent className="p-6 text-center space-y-4">
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 12 }}>
                      <div className={cn('w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4',
                        (store.progress.quizScores[activeQuiz] ?? 0) >= 85 ? 'bg-emerald-100 dark:bg-emerald-900/30' :
                        (store.progress.quizScores[activeQuiz] ?? 0) >= 70 ? 'bg-amber-100 dark:bg-amber-900/30' :
                        'bg-rose-100 dark:bg-rose-900/30'
                      )}>
                        <span className="text-3xl font-bold">{store.progress.quizScores[activeQuiz] ?? 0}%</span>
                      </div>
                    </motion.div>
                    <Badge className={cn(
                      (store.progress.quizScores[activeQuiz] ?? 0) >= 85 ? 'bg-emerald-500' :
                      (store.progress.quizScores[activeQuiz] ?? 0) >= 70 ? 'bg-amber-500' : 'bg-rose-500',
                      'text-white text-lg px-4 py-1',
                    )}>
                      {(store.progress.quizScores[activeQuiz] ?? 0) >= 85 ? 'ممتاز A' :
                       (store.progress.quizScores[activeQuiz] ?? 0) >= 70 ? 'جيد B' : 'يحتاج مراجعة C'}
                    </Badge>
                    <p className="text-muted-foreground text-sm">
                      {store.progress.quizScores[activeQuiz] ?? 0 >= 70 ? 'أحسنت! حصلت على 50 XP إضافية' : 'حاول مرة أخرى للتحسن'}
                    </p>
                    <div className="space-y-3 pt-4">
                      {currentQuiz.questions.map((q, i) => {
                        const isCorrect = quizAnswers[i] === q.correct;
                        return (
                          <div key={i} className={cn('p-3 rounded-lg border text-right', isCorrect ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/40' : 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800/40')}>
                            <p className="text-sm font-medium mb-1">{q.question}</p>
                            <p className="text-xs">{q.explanation}</p>
                            <Badge variant="outline" className={cn(isCorrect ? 'text-emerald-600' : 'text-rose-600')}>
                              {isCorrect ? '✓ صحيح' : `✗ خطأ - الجواب الصحيح: ${q.options[q.correct]}`}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                    <Button onClick={() => startQuiz(activeQuiz)} variant="outline" className="gap-2 mt-4">
                      <RotateCcw className="w-4 h-4" /> إعادة المحاولة
                    </Button>
                  </CardContent>
                ) : (
                  /* ── QUIZ QUESTIONS ── */
                  <CardContent className="p-6 space-y-4">
                    <div className="flex items-center justify-between mb-2">
                      <Badge variant="outline" className={getDifficultyColor(currentQuiz.difficulty)}>{currentQuiz.difficulty}</Badge>
                      <div className="flex gap-1.5">
                        {currentQuiz.questions.map((_, i) => (
                          <div key={i} className={cn('w-2.5 h-2.5 rounded-full', quizAnswers[i] !== undefined ? 'bg-emerald-500' : 'bg-muted')} />
                        ))}
                      </div>
                    </div>
                    <h3 className="text-lg font-bold">{currentQuiz.title}</h3>

                    {currentQuiz.questions.map((q, qIdx) => (
                      <div key={qIdx} className="space-y-3">
                        <p className="text-sm font-semibold">
                          <span className="text-muted-foreground ml-2">سؤال {qIdx + 1}:</span>
                          {q.question}
                        </p>
                        <div className="space-y-2">
                          {q.options.map((opt, optIdx) => (
                            <motion.button
                              key={optIdx}
                              className={cn(
                                'w-full text-right p-3 rounded-lg border text-sm transition-all',
                                quizAnswers[qIdx] === optIdx
                                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                                  : 'border-border hover:border-muted-foreground hover:bg-muted/50',
                              )}
                              onClick={() => setQuizAnswers((p) => ({ ...p, [qIdx]: optIdx }))}
                              whileHover={{ scale: 1.01 }}
                              whileTap={{ scale: 0.99 }}
                            >
                              {opt}
                            </motion.button>
                          ))}
                        </div>
                        {qIdx < currentQuiz.questions.length - 1 && <div className="border-t" />}
                      </div>
                    ))}

                    <Button
                      onClick={() => handleSubmitQuiz(currentQuiz)}
                      disabled={Object.keys(quizAnswers).length < currentQuiz.questions.length}
                      className="w-full gap-2"
                      size="lg"
                    >
                      <Award className="w-5 h-5" />
                      {Object.keys(quizAnswers).length < currentQuiz.questions.length
                        ? `أجب على جميع الأسئلة (${Object.keys(quizAnswers).length}/${currentQuiz.questions.length})`
                        : 'تقديم الإجابات'}
                    </Button>
                  </CardContent>
                )}
              </Card>
            </motion.div>
          )}

          {/* ── MAIN TABS ───────────────────────────────────── */}
          {!activeCourse && !activeArticle && !activeCaseStudy && !activeQuiz && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Tabs value={tab} onValueChange={setTab} className="space-y-6">
                <TabsList className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                  <TabsTrigger value="courses" className="gap-1.5 text-xs sm:text-sm">
                    <BookOpen className="w-4 h-4" /> الدورات
                  </TabsTrigger>
                  <TabsTrigger value="quizzes" className="gap-1.5 text-xs sm:text-sm">
                    <BarChart3 className="w-4 h-4" /> الاختبارات
                  </TabsTrigger>
                  <TabsTrigger value="articles" className="gap-1.5 text-xs sm:text-sm">
                    <FileText className="w-4 h-4" /> المقالات
                  </TabsTrigger>
                  <TabsTrigger value="achievements" className="gap-1.5 text-xs sm:text-sm">
                    <Trophy className="w-4 h-4" /> الإنجازات
                  </TabsTrigger>
                </TabsList>

                {/* ── COURSES TAB ──────────────────────────────── */}
                <TabsContent value="courses" className="space-y-4">
                  {/* Difficulty filters */}
                  <div className="flex gap-2 flex-wrap">
                    {DIFFICULTY_FILTERS.map((f) => (
                      <motion.button
                        key={f}
                        className={cn(
                          'px-4 py-2 rounded-full text-sm font-medium transition-all',
                          difficultyFilter === f
                            ? 'bg-emerald-600 text-white shadow-md'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80',
                        )}
                        onClick={() => setDifficultyFilter(f)}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        {f}
                      </motion.button>
                    ))}
                  </div>

                  {/* Case studies inline */}
                  <div>
                    <h3 className="text-base font-bold mb-3 flex items-center gap-2">
                      <Lightbulb className="w-5 h-5 text-amber-500" /> دراسات الحالة
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {caseStudies.map((cs, i) => (
                        <motion.div key={cs.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                          <Card className="cursor-pointer hover:shadow-md transition-all hover:border-amber-300 dark:hover:border-amber-700 h-full"
                            onClick={() => setActiveCaseStudy(cs.id)}>
                            <CardContent className="p-4">
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">{cs.year}</Badge>
                                <Badge variant="outline" className={getDifficultyColor(cs.difficulty)}>{cs.difficulty}</Badge>
                              </div>
                              <h4 className="font-semibold text-sm mb-1">{cs.title}</h4>
                              <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> {cs.duration}</p>
                            </CardContent>
                          </Card>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  {/* Course grid */}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <AnimatePresence mode="popLayout">
                      {filteredCourses.map((course, i) => {
                        const status = getCourseCompletionStatus(course.id, progress.completedLessons);
                        const isComplete = status.percentage === 100;
                        const IconComp = getIcon(course.icon);

                        return (
                          <motion.div key={course.id}
                            layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }} transition={{ delay: i * 0.04 }}
                          >
                            <Card className={cn(
                              'cursor-pointer hover:shadow-lg transition-all h-full relative overflow-hidden',
                              getDifficultyCardBorder(course.difficulty),
                              isComplete && 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-background',
                            )}
                              onClick={() => setActiveCourse(course.id)}
                            >
                              {isComplete && (
                                <div className="absolute top-3 left-3 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
                                  <CheckCircle2 className="w-4 h-4 text-white" />
                                </div>
                              )}
                              <CardContent className="p-4 flex gap-4">
                                <div className="flex flex-col items-center gap-2 flex-shrink-0">
                                  <div className={cn('w-14 h-14 rounded-xl bg-gradient-to-br flex items-center justify-center text-white relative', getDifficultyAccent(course.difficulty))}>
                                    <IconComp className="w-7 h-7" />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <StatsDonut percentage={status.percentage} size={56} strokeWidth={4} color="stroke-white/60" />
                                    </div>
                                  </div>
                                  <span className="text-[10px] font-bold text-muted-foreground">{status.percentage.toFixed(0)}%</span>
                                </div>
                                <div className="min-w-0 flex-1 space-y-1.5">
                                  <Badge variant="outline" className={cn('text-[10px]', getDifficultyColor(course.difficulty))}>{course.difficulty}</Badge>
                                  <h3 className="font-bold text-sm leading-tight line-clamp-2">{course.title}</h3>
                                  <p className="text-xs text-muted-foreground line-clamp-2">{course.description}</p>
                                  <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                                    <span className="flex items-center gap-1"><BookOpen className="w-3 h-3" /> {course.lessons.length} درس</span>
                                    <span className="flex items-center gap-1">{status.completed}/{status.total}</span>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </TabsContent>

                {/* ── QUIZZES TAB ─────────────────────────────── */}
                <TabsContent value="quizzes" className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {quizzes.map((quiz, i) => {
                      const prevScore = progress.quizScores[quiz.id];
                      return (
                        <motion.div key={quiz.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                          <Card className="cursor-pointer hover:shadow-lg transition-all h-full"
                            onClick={() => startQuiz(quiz.id)}>
                            <CardContent className="p-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <Badge variant="outline" className={getDifficultyColor(quiz.difficulty)}>{quiz.difficulty}</Badge>
                                {prevScore !== undefined && (
                                  <Badge className={cn(
                                    prevScore >= 85 ? 'bg-emerald-500' : prevScore >= 70 ? 'bg-amber-500' : 'bg-rose-500',
                                    'text-white',
                                  )}>
                                    {prevScore}%
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-3">
                                <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center',
                                  prevScore !== undefined && prevScore >= 85 ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-muted',
                                )}>
                                  <BarChart3 className={cn('w-6 h-6', prevScore !== undefined && prevScore >= 85 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')} />
                                </div>
                                <div>
                                  <h3 className="font-bold text-sm">{quiz.title}</h3>
                                  <p className="text-xs text-muted-foreground">{quiz.questions.length} سؤال</p>
                                </div>
                              </div>
                              <Button variant="outline" size="sm" className="w-full gap-2">
                                {prevScore !== undefined ? <RotateCcw className="w-3 h-3" /> : <Star className="w-3 h-3" />}
                                {prevScore !== undefined ? 'إعادة المحاولة' : 'ابدأ الاختبار'}
                              </Button>
                            </CardContent>
                          </Card>
                        </motion.div>
                      );
                    })}
                  </div>
                </TabsContent>

                {/* ── ARTICLES TAB ─────────────────────────────── */}
                <TabsContent value="articles" className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {articles.map((article, i) => {
                      const isRead = progress.articlesRead.includes(article.id);
                      return (
                        <motion.div key={article.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                          <Card className={cn('cursor-pointer hover:shadow-lg transition-all h-full', isRead && 'opacity-80')}
                            onClick={() => setActiveArticle(article.id)}>
                            <CardContent className="p-4 space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="text-[10px]">{article.category}</Badge>
                                <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> {article.readTime}</span>
                                {isRead && <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px]"><BookmarkCheck className="w-3 h-3 ml-1" /> مقروء</Badge>}
                              </div>
                              <h3 className="font-bold text-sm leading-tight">{article.title}</h3>
                              <p className="text-xs text-muted-foreground line-clamp-2">{article.summary}</p>
                            </CardContent>
                          </Card>
                        </motion.div>
                      );
                    })}
                  </div>
                </TabsContent>

                {/* ── ACHIEVEMENTS TAB ────────────────────────── */}
                <TabsContent value="achievements" className="space-y-6">
                  <div className="text-center space-y-2">
                    <h3 className="text-xl font-bold flex items-center justify-center gap-2">
                      <Trophy className="w-6 h-6 text-amber-500" /> إنجازاتك
                    </h3>
                    <p className="text-sm text-muted-foreground">{unlockedBadges} من {totalBadges} إنجاز ({((unlockedBadges / totalBadges) * 100).toFixed(0)}%)</p>
                    <Progress value={(unlockedBadges / totalBadges) * 100} className="h-2 max-w-xs mx-auto" />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {progress.badges.map((badge, i) => (
                      <motion.div key={badge.id}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.05 }}
                      >
                        <Card className={cn(
                          'text-center p-4 transition-all h-full',
                          badge.unlocked
                            ? 'border-2 border-amber-300 dark:border-amber-700 shadow-lg shadow-amber-500/10'
                            : 'opacity-60 grayscale',
                        )}>
                          <CardContent className="p-0 flex flex-col items-center gap-2">
                            <motion.div
                              className={cn('w-16 h-16 rounded-2xl flex items-center justify-center text-3xl',
                                badge.unlocked ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-muted',
                              )}
                              animate={badge.unlocked ? { scale: [1, 1.05, 1] } : {}}
                              transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                            >
                              {badge.icon}
                            </motion.div>
                            <h4 className="font-bold text-sm">{badge.name}</h4>
                            <p className="text-xs text-muted-foreground">{badge.description}</p>
                            <Badge variant="outline" className="text-[10px]">
                              {badge.unlocked ? `🔓 فُتح ${badge.unlockedAt ? new Date(badge.unlockedAt).toLocaleDateString('ar-EG') : ''}` : `🔒 ${badge.condition}`}
                            </Badge>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
