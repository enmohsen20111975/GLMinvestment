'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bitcoin, BookOpen, TrendingUp, FileText, LineChart, Shield,
  Clock, ChevronLeft, CheckCircle2, Download, Award, Trophy,
  Target, ArrowRight, Star, Brain, Lightbulb, RotateCcw,
  Lock, Flame, Zap, Search, Sparkles, Info, X,
  GraduationCap, BarChart3, BookmarkCheck, Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useCryptoLearningStore } from '@/lib/crypto-learning-store';
import {
  cryptoCourses,
  cryptoArticles,
  cryptoQuizzes,
  cryptoGlossary,
  getTotalCryptoLessons,
  getCryptoCourseCompletionStatus,
} from '@/data/crypto-learning-content';
import type { CryptoCourse, CryptoQuiz, CryptoArticle, CryptoGlossaryTerm } from '@/data/crypto-learning-content';
import { MathText } from '@/modules/education/components/MathRenderer';

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

function StatsDonut({ percentage, size = 80, strokeWidth = 6, color = 'stroke-purple-500' }: { percentage: number; size?: number; strokeWidth?: number; color?: string }) {
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
  const colors = ['bg-purple-500', 'bg-violet-500', 'bg-teal-500', 'bg-fuchsia-500', 'bg-pink-500'];
  const glowColors = ['shadow-purple-500/40', 'shadow-violet-500/40', 'shadow-teal-500/40', 'shadow-fuchsia-500/40', 'shadow-pink-500/40'];

  return (
    <motion.div
      className={cn(
        'relative flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl transition-all duration-300',
        isActive && 'bg-card border-2 border-purple-500 shadow-lg ' + glowColors[index],
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
          className="absolute -top-1 -right-1 w-3 h-3 bg-purple-400 rounded-full"
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
        />
      )}
    </motion.div>
  );
}

function ProgressPath({ currentLevelIndex, levelProgress }: { currentLevelIndex: number; levelProgress: number }) {
  const levels = ['مبتدئ', 'متعلم', 'محلل', 'خبير', 'حيتان الكريبتو'];

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
                    i < currentLevelIndex ? 'from-purple-500 to-violet-400' : 'from-muted-foreground/20 to-transparent',
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
    color: ['bg-purple-400', 'bg-violet-400', 'bg-fuchsia-400', 'bg-pink-400', 'bg-teal-400'][i % 5],
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
const GLOSSARY_CATEGORIES = ['الكل', 'أساسيات', 'تقني', 'عملات', 'تداول', 'DeFi', 'NFT', 'تحليل', 'أمان', 'سيكولوجية', 'بيتكوين'];

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
  Bitcoin, BookOpen, FileText, TrendingUp, LineChart, Shield, Target, Brain, Sparkles,
};

function getIcon(name: string) {
  return ICON_MAP[name] || BookOpen;
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export function CryptoLearningView() {
  const store = useCryptoLearningStore();
  const { progress } = store;

  // ── UI State ─────────────────────────────────────────
  const [tab, setTab] = useState('courses');
  const [activeCourse, setActiveCourse] = useState<string | null>(null);
  const [activeLesson, setActiveLesson] = useState<number | null>(null);
  const [activeArticle, setActiveArticle] = useState<string | null>(null);
  const [activeQuiz, setActiveQuiz] = useState<string | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [difficultyFilter, setDifficultyFilter] = useState('الكل');
  const [confetti, setConfetti] = useState(false);

  // Glossary state
  const [glossarySearch, setGlossarySearch] = useState('');
  const [glossaryCategory, setGlossaryCategory] = useState('الكل');

  // ── Computed ─────────────────────────────────────────
  const totalLessons = getTotalCryptoLessons();
  const completedCount = progress.completedLessons.length;
  const overallPct = totalLessons > 0 ? (completedCount / totalLessons) * 100 : 0;
  const quizCount = Object.keys(progress.quizScores).length;
  const avgScore = store.getQuizAverage();
  const level = store.getLevel();
  const levelProgress = store.getLevelProgress();

  const completedCourseIds = useMemo(() => {
    return cryptoCourses
      .filter((c) => {
        const s = getCryptoCourseCompletionStatus(c.id, progress.completedLessons);
        return s.percentage === 100;
      })
      .map((c) => c.id);
  }, [progress.completedLessons]);

  const filteredCourses = useMemo(() => {
    if (difficultyFilter === 'الكل') return cryptoCourses;
    return cryptoCourses.filter((c) => c.difficulty === difficultyFilter);
  }, [difficultyFilter]);

  const filteredGlossary = useMemo(() => {
    return cryptoGlossary.filter((term) => {
      const matchesSearch = glossarySearch === '' ||
        term.termAr.includes(glossarySearch) ||
        term.termEn.toLowerCase().includes(glossarySearch.toLowerCase()) ||
        term.definition.includes(glossarySearch);
      const matchesCategory = glossaryCategory === 'الكل' || term.category === glossaryCategory;
      return matchesSearch && matchesCategory;
    });
  }, [glossarySearch, glossaryCategory]);

  // Derived data
  const currentCourse = activeCourse ? cryptoCourses.find((c) => c.id === activeCourse) ?? null : null;
  const currentArticle = activeArticle ? cryptoArticles.find((a) => a.id === activeArticle) ?? null : null;
  const currentQuiz = activeQuiz ? cryptoQuizzes.find((q) => q.id === activeQuiz) ?? null : null;

  const unlockedBadges = progress.badges.filter((b) => b.unlocked).length;
  const totalBadges = progress.badges.length;

  // ── Actions ──────────────────────────────────────────
  const handleMarkLesson = useCallback((courseId: string, idx: number) => {
    const key = `${courseId}-${idx}`;
    if (progress.completedLessons.includes(key)) return;
    store.markLessonComplete(courseId, idx);
    setConfetti(true);
    setTimeout(() => setConfetti(false), 1000);
    toast.success('تم إكمال الدرس بنجاح');
    setTimeout(() => {
      store.checkBadges(cryptoCourses.length, completedCourseIds, cryptoArticles.length, cryptoQuizzes.length, avgScore);
    }, 100);
  }, [progress.completedLessons, store, completedCourseIds, avgScore]);

  const handleSubmitQuiz = useCallback((quiz: CryptoQuiz) => {
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
      store.checkBadges(cryptoCourses.length, completedCourseIds, cryptoArticles.length, cryptoQuizzes.length, avgScore);
    }, 100);
  }, [quizAnswers, store, completedCourseIds, avgScore]);

  const handleMarkArticle = useCallback((articleId: string) => {
    if (progress.articlesRead.includes(articleId)) return;
    store.markArticleRead(articleId);
    toast.success('تم تحديد المقال كمقروء +5 XP 📚');
    setTimeout(() => {
      store.checkBadges(cryptoCourses.length, completedCourseIds, cryptoArticles.length, cryptoQuizzes.length, avgScore);
    }, 100);
  }, [progress.articlesRead, store, completedCourseIds, avgScore]);

  const startQuiz = (quizId: string) => {
    setActiveQuiz(quizId);
    setQuizAnswers({});
    setQuizSubmitted(false);
  };

  // ── Content renderer ─────────────────────────────────
  const renderContent = (text: string) => {
    return text.split('\n').map((paragraph, i) => {
      if (paragraph.startsWith('**') && paragraph.endsWith('**')) {
        return <h3 key={i} className="text-base font-bold mt-4 mb-2">{paragraph.replace(/\*\*/g, '')}</h3>;
      }
      if (paragraph.startsWith('- **')) {
        const [title, ...rest] = paragraph.replace(/^- /, '').split(':');
        return <p key={i} className="flex gap-2"><span className="font-semibold">{title.replace(/\*\*/g, '')}:</span><span><MathText text={rest.join(':').replace(/\*\*/g, '')} /></span></p>;
      }
      if (paragraph.startsWith('- ')) {
        return <li key={i} className="mr-4 text-sm"><MathText text={paragraph.slice(2)} /></li>;
      }
      if (paragraph.match(/^\d+\./)) {
        return <li key={i} className="mr-4 text-sm"><MathText text={paragraph.replace(/^(\d+)\. /, '')} /></li>;
      }
      if (paragraph.trim() === '') return <br key={i} />;
      return <p key={i}><MathText text={paragraph} /></p>;
    });
  };

  // ── Close detail views helper ────────────────────────
  const closeAll = () => {
    setActiveCourse(null); setActiveLesson(null);
    setActiveArticle(null); setActiveQuiz(null);
  };

  /* ============================================================
     RENDER
     ============================================================ */
  return (
    <div dir="rtl" className="min-h-screen bg-background">
      {/* ── HEADER ──────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 mr-auto">
            <h2 className="text-lg font-bold">مركز تعلم الكريبتو</h2>
            <p className="text-xs text-muted-foreground">Crypto Learning Center</p>
          </div>
          <Badge className="bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/30">
            <Sparkles className="w-3 h-3 ml-1" />
            {progress.xp} XP
          </Badge>
        </div>
      </div>

      <div className="p-4 md:p-6 space-y-6">
        {/* ── HERO / STATS SECTION ───────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <Card className="overflow-hidden border-0">
            <div className="relative bg-gradient-to-l from-purple-600 via-violet-600 to-purple-700 p-6 text-white overflow-hidden">
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
                    <Bitcoin className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">رحلة تعلمك في الكريبتو</h3>
                    <p className="text-sm text-white/80">تعلّم، تدرب، واحصل على إنجازات</p>
                  </div>
                  <div className="mr-auto flex items-center gap-2">
                    <Badge className="bg-white/20 text-white border-white/30 hover:bg-white/30">
                      <Sparkles className="w-3 h-3 ml-1" />
                      {progress.xp} XP
                    </Badge>
                    <Badge className="bg-fuchsia-500/90 text-white border-fuchsia-400">
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
                  <span className="font-medium">المستوى الحالي: <span className="text-purple-600 dark:text-purple-400 font-bold">{level.name}</span></span>
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
                  <motion.div className="h-full bg-gradient-to-l from-purple-500 to-violet-400"
                    initial={{ width: '0%' }}
                    animate={{ width: `${((activeLesson + 1) / currentCourse.lessons.length) * 100}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                <CardHeader>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className={getDifficultyColor(currentCourse.difficulty)}>{currentCourse.difficulty}</Badge>
                    <span className="text-xs text-muted-foreground">الدرس {activeLesson + 1} من {currentCourse.lessons.length}</span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {currentCourse.lessons[activeLesson].duration}
                    </span>
                  </div>
                  <CardTitle className="text-lg">{currentCourse.lessons[activeLesson].title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-line leading-relaxed text-sm">
                    {renderContent(currentCourse.lessons[activeLesson].content)}
                  </div>
                  <div className="flex gap-2 pt-4 border-t flex-wrap">
                    {activeLesson > 0 && (
                      <Button variant="outline" onClick={() => setActiveLesson(activeLesson - 1)} className="gap-2">
                        <ArrowRight className="w-4 h-4" /> السابق
                      </Button>
                    )}
                    <Button
                      onClick={() => handleMarkLesson(activeCourse, activeLesson)}
                      disabled={progress.completedLessons.includes(`${activeCourse}-${activeLesson}`)}
                      className={cn('gap-2', progress.completedLessons.includes(`${activeCourse}-${activeLesson}`) ? 'bg-purple-600' : '')}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {progress.completedLessons.includes(`${activeCourse}-${activeLesson}`) ? 'مكتمل ✓' : 'تحديد كمكتمل'}
                    </Button>
                    {activeLesson < currentCourse.lessons.length - 1 && (
                      <Button variant="outline" onClick={() => setActiveLesson(activeLesson + 1)} className="gap-2 mr-auto">
                        التالي <ChevronLeft className="w-4 h-4" />
                      </Button>
                    )}
                    {activeLesson === currentCourse.lessons.length - 1 && (
                      <Button 
                        variant="default" 
                        onClick={() => {
                          // Find and open the quiz for this course
                          const courseQuiz = cryptoQuizzes.find(q => q.courseId === activeCourse);
                          if (courseQuiz) {
                            startQuiz(courseQuiz.id);
                            setActiveLesson(null);
                          } else {
                            setActiveLesson(null);
                          }
                        }} 
                        className="gap-2 mr-auto bg-purple-600 hover:bg-purple-700"
                      >
                        <Trophy className="w-4 h-4" />
                        اختبر معلوماتك
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ── COURSE LESSON LIST ─────────────────────────── */}
          {activeCourse && activeLesson === null && !currentQuiz && currentCourse && (
            <motion.div key="course-list" initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }} className="space-y-4">
              <Button variant="ghost" size="sm" onClick={closeAll} className="gap-2">
                <ArrowRight className="w-4 h-4" /> العودة للدورات
              </Button>
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className={cn('w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-white', getDifficultyAccent(currentCourse.difficulty))}>
                      {React.createElement(getIcon(currentCourse.icon), { className: 'w-6 h-6' })}
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-lg">{currentCourse.title}</CardTitle>
                      <CardDescription>{currentCourse.description}</CardDescription>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className={getDifficultyColor(currentCourse.difficulty)}>{currentCourse.difficulty}</Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {currentCourse.totalDuration}
                        </span>
                      </div>
                    </div>
                    <Badge className="bg-purple-500/20 text-purple-600 dark:text-purple-400" variant="outline">
                      {getCryptoCourseCompletionStatus(currentCourse.id, progress.completedLessons).percentage.toFixed(0)}%
                    </Badge>
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
                          isComplete && 'bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/40',
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
                          isComplete ? 'bg-purple-500 text-white' : isUnlocked ? 'bg-muted text-foreground' : 'bg-muted text-muted-foreground',
                        )}>
                          {isComplete ? <CheckCircle2 className="w-4 h-4" /> : isUnlocked ? <span className="text-sm font-bold">{idx + 1}</span> : <Lock className="w-3 h-3" />}
                        </div>
                        <div className="flex-1">
                          <span className={cn('text-sm font-medium block', isComplete && 'text-purple-700 dark:text-purple-400')}>{lesson.title}</span>
                          <span className="text-xs text-muted-foreground">{lesson.duration}</span>
                        </div>
                        {isUnlocked && !isComplete && (
                          <motion.div className="w-2 h-2 rounded-full bg-purple-400 mr-auto"
                            animate={{ scale: [1, 1.5, 1] }}
                            transition={{ repeat: Infinity, duration: 2 }}
                          />
                        )}
                      </motion.button>
                    );
                  })}
                  {/* Quiz Button */}
                  {(() => {
                    const courseQuiz = cryptoQuizzes.find(q => q.courseId === currentCourse.id);
                    if (!courseQuiz) return null;
                    const hasCompleted = progress.quizScores[courseQuiz.id] !== undefined;
                    return (
                      <div className="pt-4 border-t mt-4">
                        <Button
                          onClick={() => startQuiz(courseQuiz.id)}
                          className={cn('w-full gap-2', hasCompleted ? 'bg-purple-600' : 'bg-gradient-to-r from-purple-500 to-violet-500')}
                        >
                          <Trophy className="w-5 h-5" />
                          {hasCompleted ? `إعادة الاختبار (آخر نتيجة: ${progress.quizScores[courseQuiz.id]}%)` : 'ابدأ اختبار الدورة'}
                        </Button>
                      </div>
                    );
                  })()}
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
                    {progress.articlesRead.includes(activeArticle) && <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"><BookmarkCheck className="w-3 h-3 ml-1" /> مقروء</Badge>}
                  </div>
                  <CardTitle className="text-lg">{currentArticle.title}</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">{currentArticle.titleEn}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="whitespace-pre-line leading-relaxed text-sm"><MathText text={currentArticle.content} /></div>
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

          {/* ── QUIZ VIEW ───────────────────────────────────── */}
          {activeQuiz && currentQuiz && (
            <motion.div key="quiz" initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }} className="space-y-4">
              <Button variant="ghost" size="sm" onClick={() => { setActiveQuiz(null); }} className="gap-2">
                <ArrowRight className="w-4 h-4" /> العودة
              </Button>
              <Card className="relative overflow-hidden">
                <ConfettiBurst show={confetti} />

                {quizSubmitted ? (
                  /* ── QUIZ RESULT ── */
                  <CardContent className="p-6 text-center space-y-4">
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 12 }}>
                      <div className={cn('w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4',
                        (store.progress.quizScores[activeQuiz] ?? 0) >= 85 ? 'bg-purple-100 dark:bg-purple-900/30' :
                        (store.progress.quizScores[activeQuiz] ?? 0) >= 70 ? 'bg-amber-100 dark:bg-amber-900/30' :
                        'bg-rose-100 dark:bg-rose-900/30'
                      )}>
                        <span className="text-3xl font-bold">{store.progress.quizScores[activeQuiz] ?? 0}%</span>
                      </div>
                    </motion.div>
                    <Badge className={cn(
                      (store.progress.quizScores[activeQuiz] ?? 0) >= 85 ? 'bg-purple-500' :
                      (store.progress.quizScores[activeQuiz] ?? 0) >= 70 ? 'bg-amber-500' : 'bg-rose-500',
                      'text-white text-lg px-4 py-1',
                    )}>
                      {(store.progress.quizScores[activeQuiz] ?? 0) >= 85 ? 'ممتاز A' :
                       (store.progress.quizScores[activeQuiz] ?? 0) >= 70 ? 'جيد B' : 'يحتاج مراجعة C'}
                    </Badge>
                    <p className="text-muted-foreground text-sm">
                      {(store.progress.quizScores[activeQuiz] ?? 0) >= 70 ? 'أحسنت! حصلت على 50 XP إضافية' : 'حاول مرة أخرى للتحسن'}
                    </p>
                    <div className="space-y-3 pt-4 text-right">
                      {currentQuiz.questions.map((q, i) => {
                        const isCorrect = quizAnswers[i] === q.correct;
                        return (
                          <div key={i} className={cn('p-3 rounded-lg border', isCorrect ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800/40' : 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800/40')}>
                            <p className="text-sm font-medium mb-1">{q.question}</p>
                            <p className="text-xs text-muted-foreground">{q.explanation}</p>
                            <Badge variant="outline" className={cn('mt-2', isCorrect ? 'text-purple-600 border-purple-300' : 'text-rose-600 border-rose-300')}>
                              {isCorrect ? '✓ صحيح' : `✗ خطأ - الجواب: ${q.options[q.correct]}`}
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
                          <div key={i} className={cn('w-2.5 h-2.5 rounded-full', quizAnswers[i] !== undefined ? 'bg-purple-500' : 'bg-muted')} />
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
                                  ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400'
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
                      className="w-full gap-2 bg-gradient-to-r from-purple-500 to-violet-500 hover:from-purple-600 hover:to-violet-600"
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
          {!activeCourse && !activeArticle && !activeQuiz && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Tabs value={tab} onValueChange={setTab} className="space-y-6">
                <TabsList className="grid grid-cols-3 sm:grid-cols-5 gap-1 h-auto">
                  <TabsTrigger value="courses" className="gap-1.5 text-xs sm:text-sm py-2">
                    <BookOpen className="w-4 h-4" /> الدورات
                  </TabsTrigger>
                  <TabsTrigger value="quizzes" className="gap-1.5 text-xs sm:text-sm py-2">
                    <BarChart3 className="w-4 h-4" /> الاختبارات
                  </TabsTrigger>
                  <TabsTrigger value="articles" className="gap-1.5 text-xs sm:text-sm py-2">
                    <FileText className="w-4 h-4" /> المقالات
                  </TabsTrigger>
                  <TabsTrigger value="glossary" className="gap-1.5 text-xs sm:text-sm py-2">
                    <Brain className="w-4 h-4" /> القاموس
                  </TabsTrigger>
                  <TabsTrigger value="achievements" className="gap-1.5 text-xs sm:text-sm py-2">
                    <Trophy className="w-4 h-4" /> الإنجازات
                  </TabsTrigger>
                </TabsList>

                {/* ── COURSES TAB ──────────────────────────────── */}
                <TabsContent value="courses" className="space-y-4">
                  {/* Difficulty filters */}
                  <div className="flex gap-2 flex-wrap">
                    {DIFFICULTY_FILTERS.map((f) => (
                      <Button
                        key={f}
                        variant={difficultyFilter === f ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setDifficultyFilter(f)}
                        className={cn(difficultyFilter === f && 'bg-purple-600 hover:bg-purple-700')}
                      >
                        {f}
                      </Button>
                    ))}
                  </div>

                  <div className="grid gap-4">
                    {filteredCourses.map((course, i) => {
                      const completion = getCryptoCourseCompletionStatus(course.id, progress.completedLessons);
                      const IconComponent = getIcon(course.icon);
                      return (
                        <motion.div
                          key={course.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.1 }}
                        >
                          <Card
                            className={cn('cursor-pointer hover:shadow-lg transition-all', getDifficultyCardBorder(course.difficulty))}
                            onClick={() => setActiveCourse(course.id)}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-start gap-4">
                                <div className={cn('w-14 h-14 rounded-xl bg-gradient-to-br flex items-center justify-center text-white flex-shrink-0', getDifficultyAccent(course.difficulty))}>
                                  <IconComponent className="w-7 h-7" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <h3 className="font-bold text-foreground">{course.title}</h3>
                                      <p className="text-xs text-muted-foreground">{course.titleEn}</p>
                                    </div>
                                    <Badge variant="outline" className={getDifficultyColor(course.difficulty)}>
                                      {course.difficulty}
                                    </Badge>
                                  </div>
                                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{course.description}</p>
                                  <div className="flex items-center gap-4 mt-3">
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                      <BookOpen className="w-3 h-3" />
                                      {course.lessons.length} دروس
                                    </div>
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                      <Clock className="w-3 h-3" />
                                      {course.totalDuration}
                                    </div>
                                    <div className="flex-1">
                                      <Progress value={completion.percentage} className="h-1.5" />
                                    </div>
                                    <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
                                      {completion.percentage.toFixed(0)}%
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      );
                    })}
                  </div>
                </TabsContent>

                {/* ── QUIZZES TAB ───────────────────────────────── */}
                <TabsContent value="quizzes" className="space-y-4">
                  <div className="grid gap-4">
                    {cryptoQuizzes.map((quiz, i) => {
                      const course = cryptoCourses.find(c => c.id === quiz.courseId);
                      const score = progress.quizScores[quiz.id];
                      return (
                        <motion.div
                          key={quiz.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.1 }}
                        >
                          <Card className="cursor-pointer hover:shadow-lg transition-all" onClick={() => startQuiz(quiz.id)}>
                            <CardContent className="p-4">
                              <div className="flex items-center gap-4">
                                <div className={cn(
                                  'w-12 h-12 rounded-xl flex items-center justify-center text-white',
                                  score !== undefined ? 'bg-purple-500' : 'bg-muted-foreground/20'
                                )}>
                                  {score !== undefined ? (
                                    <span className="text-lg font-bold">{score}%</span>
                                  ) : (
                                    <Trophy className="w-6 h-6 text-muted-foreground" />
                                  )}
                                </div>
                                <div className="flex-1">
                                  <h3 className="font-bold">{quiz.title}</h3>
                                  {course && (
                                    <p className="text-xs text-muted-foreground">تابع لـ: {course.title}</p>
                                  )}
                                  <div className="flex items-center gap-2 mt-2">
                                    <Badge variant="outline" className={getDifficultyColor(quiz.difficulty)}>{quiz.difficulty}</Badge>
                                    <span className="text-xs text-muted-foreground">{quiz.questions.length} أسئلة</span>
                                    {score !== undefined && (
                                      <Badge className={cn(
                                        'text-white',
                                        score >= 85 ? 'bg-purple-500' : score >= 70 ? 'bg-amber-500' : 'bg-rose-500'
                                      )}>
                                        {score >= 85 ? 'ممتاز' : score >= 70 ? 'جيد' : 'يحتاج مراجعة'}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <ChevronLeft className="w-5 h-5 text-muted-foreground" />
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      );
                    })}
                  </div>
                </TabsContent>

                {/* ── ARTICLES TAB ───────────────────────────────── */}
                <TabsContent value="articles" className="space-y-4">
                  <div className="grid gap-4">
                    {cryptoArticles.map((article, i) => {
                      const isRead = progress.articlesRead.includes(article.id);
                      return (
                        <motion.div
                          key={article.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.1 }}
                        >
                          <Card
                            className={cn('cursor-pointer hover:shadow-lg transition-all', isRead && 'border-purple-200 dark:border-purple-800/40')}
                            onClick={() => setActiveArticle(article.id)}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-start gap-3">
                                <div className={cn(
                                  'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                                  isRead ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' : 'bg-muted text-muted-foreground'
                                )}>
                                  {isRead ? <BookmarkCheck className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-bold line-clamp-1">{article.title}</h3>
                                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{article.summary}</p>
                                  <div className="flex items-center gap-2 mt-2">
                                    <Badge variant="outline">{article.category}</Badge>
                                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Clock className="w-3 h-3" /> {article.readTime}
                                    </span>
                                  </div>
                                </div>
                                <ChevronLeft className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      );
                    })}
                  </div>
                </TabsContent>

                {/* ── GLOSSARY TAB ───────────────────────────────── */}
                <TabsContent value="glossary" className="space-y-4">
                  {/* Search and Filter */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="ابحث في القاموس..."
                        value={glossarySearch}
                        onChange={(e) => setGlossarySearch(e.target.value)}
                        className="pr-10"
                      />
                    </div>
                    <Select value={glossaryCategory} onValueChange={setGlossaryCategory}>
                      <SelectTrigger className="w-full sm:w-[180px]">
                        <Filter className="w-4 h-4 ml-2" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GLOSSARY_CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Terms List */}
                  <div className="grid gap-2">
                    {filteredGlossary.map((term, i) => (
                      <motion.div
                        key={`${term.termEn}-${i}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                      >
                        <Card className="hover:shadow-md transition-all">
                          <CardContent className="p-3">
                            <div className="flex items-start gap-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-bold text-foreground">{term.termAr}</span>
                                  <span className="text-xs text-muted-foreground">({term.termEn})</span>
                                  <Badge variant="outline" className="text-[10px] py-0 h-5">{term.category}</Badge>
                                </div>
                                <p className="text-sm text-muted-foreground">{term.definition}</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>

                  {filteredGlossary.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <Brain className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>لا توجد نتائج للبحث</p>
                    </div>
                  )}
                </TabsContent>

                {/* ── ACHIEVEMENTS TAB ───────────────────────────── */}
                <TabsContent value="achievements" className="space-y-4">
                  {/* Stats Summary */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Card>
                      <CardContent className="p-4 text-center">
                        <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{progress.xp}</div>
                        <p className="text-xs text-muted-foreground">نقطة خبرة</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4 text-center">
                        <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{completedCount}</div>
                        <p className="text-xs text-muted-foreground">درس مكتمل</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4 text-center">
                        <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{unlockedBadges}/{totalBadges}</div>
                        <p className="text-xs text-muted-foreground">إنجاز</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4 text-center">
                        <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{avgScore}%</div>
                        <p className="text-xs text-muted-foreground">متوسط الاختبارات</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Badges Grid */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Trophy className="w-5 h-5 text-purple-500" />
                        الشارات والإنجازات
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {progress.badges.map((badge) => (
                          <motion.div
                            key={badge.id}
                            whileHover={{ scale: 1.05 }}
                            className={cn(
                              'p-4 rounded-xl border text-center transition-all',
                              badge.unlocked
                                ? 'bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20 border-purple-200 dark:border-purple-800/40'
                                : 'bg-muted/30 border-border opacity-50',
                            )}
                          >
                            <div className="text-3xl mb-2">{badge.icon}</div>
                            <h4 className="font-semibold text-sm">{badge.name}</h4>
                            <p className="text-xs text-muted-foreground mt-1">{badge.description}</p>
                            {badge.unlocked && badge.unlockedAt && (
                              <p className="text-[10px] text-purple-600 dark:text-purple-400 mt-2">
                                فُتح: {new Date(badge.unlockedAt).toLocaleDateString('ar-EG')}
                              </p>
                            )}
                            {!badge.unlocked && (
                              <div className="flex items-center justify-center gap-1 mt-2 text-muted-foreground">
                                <Lock className="w-3 h-3" />
                                <span className="text-[10px]">مغلق</span>
                              </div>
                            )}
                          </motion.div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Reset Progress */}
                  <div className="pt-4">
                    <Button variant="destructive" size="sm" onClick={() => {
                      if (confirm('هل أنت متأكد من إعادة تعيين كل التقدم؟')) {
                        store.resetProgress();
                        toast.success('تم إعادة تعيين التقدم');
                      }
                    }}>
                      <RotateCcw className="w-4 h-4 ml-2" />
                      إعادة تعيين التقدم
                    </Button>
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
