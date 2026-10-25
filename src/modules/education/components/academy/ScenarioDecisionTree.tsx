'use client';

/**
 * academy/ScenarioDecisionTree.tsx
 * ============================================================================
 * F-Phase3-Split-Academy: Extracted from AcademyView.tsx (was 2,357 LOC).
 * ----------------------------------------------------------------------------
 * Trading Floor §2 — Scenario Decision Tree. Six scenario cards, each:
 * trigger condition → 2-3 branches (each branch = condition → action with
 * ✅/⚠️/🚫 verdict). Vertical branches on mobile, horizontal grid on desktop.
 *
 * Color system: emerald (bullish) + amber (wait) + red (bearish/mistakes)
 * + slate (neutral). NO indigo/blue (Rule 30).
 * ============================================================================
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  ArrowDown,
  Minus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { ScenarioTone } from './types';
import { SCENARIOS, SCENARIO_TONE_STYLES, VERDICT_STYLE } from './helpers';

function ScenarioToneIcon({ tone }: { tone: ScenarioTone }) {
  if (tone === 'bullish') return <TrendingUp className="h-4 w-4" />;
  if (tone === 'bearish') return <TrendingDown className="h-4 w-4" />;
  if (tone === 'wait') return <AlertTriangle className="h-4 w-4" />;
  return <Minus className="h-4 w-4" />;
}

export function ScenarioDecisionTree() {
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
