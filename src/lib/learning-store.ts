'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ============================================================
   TYPES
   ============================================================ */

export interface LearningBadge {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
  unlockedAt?: string;
  condition: string;
}

export interface LearningProgress {
  completedLessons: string[];
  quizScores: Record<string, number>;
  articlesRead: string[];
  xp: number;
  badges: LearningBadge[];
  streakDays: number;
  lastActiveDate: string;
}

export interface LearningStore {
  progress: LearningProgress;

  // Computed helpers
  getLevel: () => { name: string; min: number; max: number; index: number };
  getLevelProgress: () => number;
  getCompletedCourses: (totalCourseIds: string[]) => string[];
  getCourseProgress: (courseId: string, lessonCount: number) => number;
  getQuizAverage: () => number;

  // Actions
  markLessonComplete: (courseId: string, lessonIdx: number) => void;
  submitQuiz: (quizId: string, score: number) => void;
  markArticleRead: (articleId: string) => void;
  addXP: (amount: number) => void;
  checkBadges: (
    totalCourses: number,
    completedCourseIds: string[],
    totalArticles: number,
    quizCount: number,
    avgScore: number,
  ) => void;
  updateStreak: () => void;
  resetProgress: () => void;
}

/* ============================================================
   LEVEL DEFINITIONS
   ============================================================ */

const LEVELS = [
  { name: 'مبتدئ', min: 0, max: 100 },
  { name: 'متعلم', min: 100, max: 300 },
  { name: 'محترف', min: 300, max: 600 },
  { name: 'خبير', min: 600, max: 1000 },
  { name: 'مستثمر ذهبي', min: 1000, max: Infinity },
];

/* ============================================================
   BADGE DEFINITIONS
   ============================================================ */

const BADGE_TEMPLATES: Omit<LearningBadge, 'unlocked' | 'unlockedAt'>[] = [
  {
    id: 'first-lesson',
    name: 'الخطوة الأولى',
    description: 'أكمل أول درس لك',
    icon: '🎓',
    condition: 'first_lesson',
  },
  {
    id: 'first-course',
    name: 'خريج الدورة',
    description: 'أكمل دورة كاملة',
    icon: '🏅',
    condition: 'first_course',
  },
  {
    id: 'quiz-master',
    name: 'بطل الاختبارات',
    description: 'احصل على 85% أو أكثر في أي اختبار',
    icon: '🏆',
    condition: 'quiz_85',
  },
  {
    id: 'bookworm',
    name: 'قارئ نهم',
    description: 'اقرأ 5 مقالات',
    icon: '📚',
    condition: 'read_5_articles',
  },
  {
    id: 'streak-3',
    name: 'مثابر',
    description: 'تعلم 3 أيام متتالية',
    icon: '🔥',
    condition: 'streak_3',
  },
  {
    id: 'streak-7',
    name: 'منضبط',
    description: 'تعلم 7 أيام متتالية',
    icon: '⚡',
    condition: 'streak_7',
  },
  {
    id: 'xp-100',
    name: 'مئوي',
    description: 'اجمع 100 نقطة خبرة',
    icon: '💯',
    condition: 'xp_100',
  },
  {
    id: 'xp-500',
    name: 'خبير متمرس',
    description: 'اجمع 500 نقطة خبرة',
    icon: '🌟',
    condition: 'xp_500',
  },
  {
    id: 'all-quizzes',
    name: 'محترف الاختبارات',
    description: 'أكمل جميع الاختبارات',
    icon: '📝',
    condition: 'all_quizzes',
  },
  {
    id: 'diversified',
    name: 'متنوع',
    description: 'أكمل دورات من 3 مستويات مختلفة',
    icon: '🌈',
    condition: 'diversified',
  },
];

/* ============================================================
   DEFAULT STATE
   ============================================================ */

const defaultProgress: LearningProgress = {
  completedLessons: [],
  quizScores: {},
  articlesRead: [],
  xp: 0,
  badges: BADGE_TEMPLATES.map((b) => ({ ...b, unlocked: false })),
  streakDays: 0,
  lastActiveDate: '',
};

/* ============================================================
   STORE
   ============================================================ */

export const useLearningStore = create<LearningStore>()(
  persist(
    (set, get) => ({
      progress: { ...defaultProgress },

      /* ── Computed ─────────────────────────────────────── */

      getLevel: () => {
        const xp = get().progress.xp;
        for (let i = LEVELS.length - 1; i >= 0; i--) {
          if (xp >= LEVELS[i].min) {
            return { ...LEVELS[i], index: i };
          }
        }
        return { ...LEVELS[0], index: 0 };
      },

      getLevelProgress: () => {
        const xp = get().progress.xp;
        const level = get().getLevel();
        const range = level.max - level.min;
        if (range === Infinity) return 100;
        const progress = ((xp - level.min) / range) * 100;
        return Math.min(Math.max(progress, 0), 100);
      },

      getCompletedCourses: (totalCourseIds: string[]) => {
        const completed = get().progress.completedLessons;
        return totalCourseIds.filter((id) => {
          // A course is complete if all its lessons are done
          // We need the lesson count — we approximate by checking
          // if at least one lesson for that course is completed
          return completed.some((l) => l.startsWith(`${id}-`));
        });
      },

      getCourseProgress: (courseId: string, lessonCount: number) => {
        const completed = get().progress.completedLessons;
        let done = 0;
        for (let i = 0; i < lessonCount; i++) {
          if (completed.includes(`${courseId}-${i}`)) done++;
        }
        return lessonCount > 0 ? (done / lessonCount) * 100 : 0;
      },

      getQuizAverage: () => {
        const scores = Object.values(get().progress.quizScores);
        if (scores.length === 0) return 0;
        return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      },

      /* ── Actions ──────────────────────────────────────── */

      markLessonComplete: (courseId: string, lessonIdx: number) => {
        const key = `${courseId}-${lessonIdx}`;
        set((state) => {
          if (state.progress.completedLessons.includes(key)) return state;
          return {
            progress: {
              ...state.progress,
              completedLessons: [...state.progress.completedLessons, key],
              xp: state.progress.xp + 10,
            },
          };
        });
        get().addXP(0); // trigger badge check via updateStreak
      },

      submitQuiz: (quizId: string, score: number) => {
        set((state) => ({
          progress: {
            ...state.progress,
            quizScores: {
              ...state.progress.quizScores,
              [quizId]: Math.max(score, state.progress.quizScores[quizId] || 0),
            },
          },
        }));
        if (score > 70) {
          get().addXP(50);
        }
      },

      markArticleRead: (articleId: string) => {
        set((state) => {
          if (state.progress.articlesRead.includes(articleId)) return state;
          return {
            progress: {
              ...state.progress,
              articlesRead: [...state.progress.articlesRead, articleId],
              xp: state.progress.xp + 5,
            },
          };
        });
      },

      addXP: (_amount: number) => {
        // XP is added directly in markLessonComplete / submitQuiz / markArticleRead
        // This exists for side effects
        get().updateStreak();
      },

      checkBadges: (
        totalCourses: number,
        completedCourseIds: string[],
        totalArticles: number,
        quizCount: number,
        avgScore: number,
      ) => {
        const state = get().progress;
        const now = new Date().toISOString();
        const newBadges = state.badges.map((badge) => {
          if (badge.unlocked) return badge;
          let shouldUnlock = false;

          switch (badge.condition) {
            case 'first_lesson':
              shouldUnlock = state.completedLessons.length >= 1;
              break;
            case 'first_course':
              shouldUnlock = completedCourseIds.length >= 1;
              break;
            case 'quiz_85':
              shouldUnlock = Object.values(state.quizScores).some((s) => s >= 85);
              break;
            case 'read_5_articles':
              shouldUnlock = state.articlesRead.length >= 5;
              break;
            case 'streak_3':
              shouldUnlock = state.streakDays >= 3;
              break;
            case 'streak_7':
              shouldUnlock = state.streakDays >= 7;
              break;
            case 'xp_100':
              shouldUnlock = state.xp >= 100;
              break;
            case 'xp_500':
              shouldUnlock = state.xp >= 500;
              break;
            case 'all_quizzes':
              shouldUnlock = Object.keys(state.quizScores).length >= quizCount && quizCount > 0;
              break;
            case 'diversified':
              // Simplified: check if completed lessons span at least 3 courses
              const uniqueCourses = new Set(state.completedLessons.map((l) => l.split('-')[0]));
              shouldUnlock = uniqueCourses.size >= 3;
              break;
          }

          return shouldUnlock ? { ...badge, unlocked: true, unlockedAt: now } : badge;
        });

        // Check if any new badges were unlocked
        const newlyUnlocked = newBadges.filter(
          (b, i) => b.unlocked && !state.badges[i].unlocked,
        );

        if (newlyUnlocked.length > 0) {
          set({ progress: { ...state, badges: newBadges } });
        }

        return newlyUnlocked;
      },

      updateStreak: () => {
        const today = new Date().toDateString();
        const lastActive = get().progress.lastActiveDate;

        if (lastActive === today) return; // Already active today

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        if (lastActive === yesterday.toDateString()) {
          set((state) => ({
            progress: {
              ...state.progress,
              streakDays: state.progress.streakDays + 1,
              lastActiveDate: today,
            },
          }));
        } else {
          set((state) => ({
            progress: {
              ...state.progress,
              streakDays: lastActive ? 1 : 0,
              lastActiveDate: today,
            },
          }));
        }
      },

      resetProgress: () => {
        set({ progress: { ...defaultProgress } });
      },
    }),
    {
      name: 'egx_learning_progress_v2',
    },
  ),
);
