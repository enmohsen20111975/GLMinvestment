'use client';

/**
 * academy/BiasDetectorQuiz.tsx
 * ============================================================================
 * F-Phase3-Split-Academy: Extracted from AcademyView.tsx (was 2,357 LOC).
 * ----------------------------------------------------------------------------
 * Practical Tools §2 — Bias Detector Quiz. 7-question self-assessment that
 * detects the dominant behavioral bias (Loss Aversion / FOMO / Confirmation
 * / Ego / Revenge Trading / Hope / Overtrading) and links back to the
 * relevant lesson (سيكولوجيا التداول or إدارة المخاطر الكمية).
 *
 * Replaces the most-asked-about code block from lessons 01-12 (Task ID 32:
 * owner feedback "أنت بتعرض كود برمجي حرفي لشخص مش مبرمج").
 *
 * Palette: emerald + amber + slate + red (Rule 30 NO indigo/blue).
 * ============================================================================
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { BIAS_QUESTIONS } from './helpers';

export function BiasDetectorQuiz() {
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
