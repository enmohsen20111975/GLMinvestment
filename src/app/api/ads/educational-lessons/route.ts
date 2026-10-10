import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getSessionUserId } from '@/lib/auth-helper';
import { checkTrialNotExpired } from '@/lib/subscription-gate';

/**
 * GET /api/ads/educational-lessons
 *
 * بيرجّع قائمة الدروس التعليمية من content/education/*.md
 * بقرأ الملفات الفعلية وبيستخرج:
 *   - العنوان
 *   - الـ emoji
 *   - المستوى
 *   - النقاط الرئيسية (من ## headings)
 *   - المحتوى الكامل (للعرض في الفيديو)
 *
 * PAYWALL Phase 2 — Gate 5 (P0-4):
 *   Per PAYWALL-STRATEGY-FINAL.md §5.2 row 6 — free users whose trial
 *   has expired get ONLY the first 3 lessons (basic level). Advanced
 *   lessons 4-12 return `{ locked: true }` so the UI can render a lock
 *   card. Anonymous + paid + trial-active users get all lessons.
 */

interface Lesson {
  id: string;
  filename: string;
  title: string;
  emoji: string;
  level: string;
  duration: string;
  tagline: string;
  sections: { heading: string; content: string }[];
  keyPoints: string[];
  fullContent: string;
}

const FREE_TIER_LESSON_LIMIT = 3;

const LESSON_META: Record<string, { emoji: string; bg: string }> = {
  '01': { emoji: '🧠', bg: '#7c3aed' },
  '02': { emoji: '📊', bg: '#0ea5e9' },
  '03': { emoji: '🎯', bg: '#10b981' },
  '04': { emoji: '↩️', bg: '#f59e0b' },
  '05': { emoji: '🛡️', bg: '#ef4444' },
  '06': { emoji: '📈', bg: '#8b5cf6' },
  '07': { emoji: '🏆', bg: '#ec4899' },
  '08': { emoji: '₿', bg: '#f97316' },
  // Lessons 09-12 already existed in content/education/ but were falling back
  // to the default emoji — added explicit metadata here (Task 29 Fix 4).
  '09': { emoji: '🔬', bg: '#0891b2' },
  '10': { emoji: '🌍', bg: '#65a30d' },
  '11': { emoji: '🤖', bg: '#7c3aed' },
  '12': { emoji: '⛓️', bg: '#ea580c' },
  // Lessons 13-15 are NEW content added in Task 29 Fix 4 to cover missing
  // topics requested by the owner: Fibonacci, Trading Journal, Islamic Finance.
  '13': { emoji: '🌀', bg: '#d97706' }, // Fibonacci trading
  '14': { emoji: '📓', bg: '#0891b2' }, // Trading journal habits
  '15': { emoji: '🕌', bg: '#15803d' }, // Islamic finance & purification
  // Lessons 16-21 are NEW content added in Task 36-A (Multi-Market Education):
  // covers TADAWUL (Saudi), Kuwait+Qatar, US stocks, Gold/Metals, Advanced
  // Crypto, and Intermarket Analysis — closing the gap left by EGX-heavy
  // curriculum per owner directive (raise education efficiency across all
  // markets). Per Rule 67: real tickers, real trading hours, real fees only.
  '16': { emoji: '🇸🇦', bg: '#16a34a' }, // TADAWUL Saudi market guide
  '17': { emoji: '🇰🇼', bg: '#0891b2' }, // Kuwait + Qatar markets
  '18': { emoji: '🇺🇸', bg: '#dc2626' }, // US stocks market guide
  '19': { emoji: '🥇', bg: '#ca8a04' },  // Gold & metals trading
  '20': { emoji: '⛓️', bg: '#7c3aed' },  // Advanced crypto deep dive
  '21': { emoji: '🌐', bg: '#059669' },  // Cross-market (intermarket) analysis
};

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const lessonId = url.searchParams.get('id'); // لو محدد درس واحد

    // ── PAYWALL Phase 2 — Gate 5: resolve paywall state ───────────────
    //   Per PAYWALL-STRATEGY-FINAL.md §5.2 row 6 — free users whose trial
    //   has expired get ONLY the first 3 lessons. Lessons 4-12 (advanced)
    //   are locked. Anonymous + paid + trial-active get all lessons
    //   (anonymous = taste hook per §4).
    const { userId } = await getSessionUserId();
    let lessonsLocked = false;
    if (userId) {
      const trial = await checkTrialNotExpired(userId);
      if (!trial.ok) lessonsLocked = true;
    }

    const educationDir = path.join(process.cwd(), 'content', 'education');
    const files = (await fs.readdir(educationDir))
      .filter((f) => f.endsWith('.md') && f !== 'README.md')
      .sort();

    const lessons: Lesson[] = [];

    for (const filename of files) {
      const match = filename.match(/^(\d+)_(.+)\.md$/);
      if (!match) continue;
      const num = match[1];
      const slug = match[2];

      // لو محدد درس معين، نتجاهل الباقي
      if (lessonId && lessonId !== num && lessonId !== slug) continue;

      // PAYWALL Gate 5: if the user is locked AND this lesson is beyond
      // the free-tier preview (lessons 4+), return a lock stub instead of
      // reading the file content. This applies both to the list request
      // (`?id` absent) and the single-lesson request (`?id=04` etc).
      const lessonIndex = parseInt(num, 10) - 1; // 0-based index
      const isBeyondFreePreview = lessonsLocked && lessonIndex >= FREE_TIER_LESSON_LIMIT;
      if (isBeyondFreePreview) {
        lessons.push({
          id: num,
          filename,
          title: '🔒 اشترك لرؤية الدرس',
          emoji: '🔒',
          level: 'متقدم',
          duration: '—',
          tagline: 'هذا الدرس متاح لباقة بريميوم فأعلى',
          sections: [],
          keyPoints: [],
          fullContent: '',
          // extra lock signal for the UI (not part of Lesson interface
          // but NextResponse.json will serialize it):
          ...( { locked: true, upgradeUrl: '/pricing' } as Record<string, unknown> ),
        } as Lesson);
        continue;
      }

      const filepath = path.join(educationDir, filename);
      const content = await fs.readFile(filepath, 'utf-8');

      // استخراج العنوان (أول # heading)
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : slug;

      // استخراج الـ meta (مستوى + وقت)
      const levelMatch = content.match(/\*\*المستوى:\*\*\s*(.+?)[|｜]/);
      const level = levelMatch ? levelMatch[1].trim() : 'متوسط';
      const durationMatch = content.match(/\*\*الوقت:\*\*\s*(.+?)[|｜]/);
      const duration = durationMatch ? durationMatch[1].trim() : '15 دقيقة';

      // استخراج tagline (من السطر الأول بعد العنوان)
      const taglineMatch = content.match(/^>\s*(?:\*\*المستوى.*?\*\*\s*\|\s*\*\*الوقت.*?\*\*\s*\|\s*\*\*الجمهور.*?\*\*\s*\n+>\s*)?(.+)$/m);
      const tagline = taglineMatch ? taglineMatch[1].trim().slice(0, 100) : '';

      // استخراج الأقسام (## headings)
      const sections: { heading: string; content: string }[] = [];
      const sectionRegex = /^##\s+(.+)$/gm;
      let sectionMatch;
      const sectionPositions: { heading: string; start: number }[] = [];
      while ((sectionMatch = sectionRegex.exec(content)) !== null) {
        sectionPositions.push({
          heading: sectionMatch[1].trim(),
          start: sectionMatch.index + sectionMatch[0].length,
        });
      }
      for (let i = 0; i < sectionPositions.length; i++) {
        const end = i + 1 < sectionPositions.length ? sectionPositions[i + 1].start - sectionPositions[i + 1].heading.length - 3 : content.length;
        const sectionContent = content.slice(sectionPositions[i].start, end).trim();
        sections.push({
          heading: sectionPositions[i].heading,
          content: sectionContent.slice(0, 500), // حد 500 حرف لكل قسم
        });
      }

      // استخراج النقاط الرئيسية (### أو - bullets)
      const keyPoints: string[] = [];
      const bulletRegex = /^(?:###\s+|-\s+|\*\s+)(.+)$/gm;
      let bulletMatch;
      while ((bulletMatch = bulletRegex.exec(content)) !== null && keyPoints.length < 5) {
        const point = bulletMatch[1].trim().replace(/\*\*/g, '').slice(0, 80);
        if (point.length > 10 && !point.startsWith('```')) {
          keyPoints.push(point);
        }
      }

      const meta = LESSON_META[num] || { emoji: '📚', bg: '#6366f1' };

      lessons.push({
        id: num,
        filename,
        title,
        emoji: meta.emoji,
        level,
        duration,
        tagline,
        sections,
        keyPoints,
        fullContent: lessonId ? content : content.slice(0, 200), // الكامل بس لو محدد
      });
    }

    return NextResponse.json({
      success: true,
      lessons,
      count: lessons.length,
      // Paywall metadata so the UI can decide how to render the lock state
      // (free_preview_count: how many lessons are visible without a subscription;
      //  locked: whether any lessons were locked in this response).
      free_preview_count: FREE_TIER_LESSON_LIMIT,
      locked: lessonsLocked,
      ...(lessonsLocked ? { upgradeUrl: '/pricing' } : {}),
    });
  } catch (err: any) {
    console.error('[ads/educational-lessons] error:', err?.message || err);
    return NextResponse.json(
      { success: false, error: err?.message || 'فشل جلب الدروس', lessons: [] },
      { status: 500 },
    );
  }
}
