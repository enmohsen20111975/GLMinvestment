/**
 * academy-encyclopedia/LessonQuiz.tsx
 * ===================================
 * Interactive quiz renderer — supports multi-question MCQs with instant
 * feedback (correct / wrong) per option + per question, final score badge,
 * and a retry button.
 *
 * Extracted from the original `AcademyEncyclopedia.tsx` (2,054 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 */

'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, GraduationCap, Trophy, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { QuizQuestion, QuizState } from './types';

export interface LessonQuizProps {
  lessonId: string;
  quiz: QuizQuestion[];
  onComplete: (correctCount: number, total: number) => void;
}

export function LessonQuiz({ lessonId, quiz, onComplete }: LessonQuizProps) {
  // lessonId is part of the public API for backward compatibility (callers
  // pass it; the parent owns the score-state map keyed by lessonId).
  void lessonId;

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
        const isWrong =
          state.submitted && selectedIdx !== undefined && selectedIdx !== q.correctIndex;
        return (
          <div
            key={qi}
            className={cn(
              'rounded-lg border p-4 transition-colors',
              isCorrect && 'border-profit bg-profit/10',
              isWrong && 'border-loss bg-loss/10',
              !state.submitted && 'border-border',
            )}
          >
            <div className="mb-3 flex items-start gap-2">
              <Badge variant="outline" className="shrink-0">
                سؤال {qi + 1}
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
                      showCorrect && 'border-profit bg-profit/10',
                      showWrong && 'border-loss bg-loss/10',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
                        isSelected && !state.submitted && 'border-primary bg-primary text-primary-foreground',
                        showCorrect && 'border-profit bg-profit text-white',
                        showWrong && 'border-loss bg-loss text-white',
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
                    ? 'border-profit bg-profit/10 /30'
                    : 'border-warning bg-warning/10 /30',
                )}
              >
                <span className="font-semibold">
                  {isCorrect ? '✅ إجابة صحيحة. ' : '❌ إجابة خاطئة. '}
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
          تسليم الإجابات
        </Button>
      ) : (
        <div className="space-y-3" dir="rtl">
          <div
            className={cn(
              'flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4',
              scorePercent >= 70
                ? 'border-profit bg-profit/10'
                : scorePercent >= 50
                ? 'border-warning bg-warning/10'
                : 'border-loss bg-loss/10',
            )}
          >
            <div className="flex items-center gap-3">
              <Trophy
                className={cn(
                  'h-8 w-8',
                  scorePercent >= 70
                    ? 'text-profit'
                    : scorePercent >= 50
                    ? 'text-warning'
                    : 'text-loss',
                )}
              />
              <div>
                <div className="font-bold">شارة الإنجاز — {correctCount} / {quiz.length}</div>
                <div className="text-sm text-muted-foreground">
                  نسبتك {scorePercent}%
                  {scorePercent >= 70
                    ? ' — أحسنت! أكملت الدرس بنجاح.'
                    : scorePercent >= 50
                    ? ' — جيد، يمكنك التحسّن.'
                    : ' — راجع الدرس وأعد المحاولة.'}
                </div>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleReset}>
              إعادة الاختبار
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
