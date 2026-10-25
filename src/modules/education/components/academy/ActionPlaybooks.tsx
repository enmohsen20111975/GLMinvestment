'use client';

/**
 * academy/ActionPlaybooks.tsx
 * ============================================================================
 * F-Phase3-Split-Academy: Extracted from AcademyView.tsx (was 2,357 LOC).
 * ----------------------------------------------------------------------------
 * Trading Floor §3 — Action Playbooks. Five predefined action plans for
 * common trading situations. Each playbook card is collapsible (first one
 * expanded by default). Layout: responsive grid (1 col mobile / 2 col tablet
 * / 3 col desktop).
 *
 * Premium look: emerald header strip, slate body, red mistake box with
 * AlertTriangle icon.
 * ============================================================================
 */

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ListChecks,
  Target,
} from 'lucide-react';
import type { Playbook } from './types';
import { PLAYBOOKS } from './helpers';

function PlaybookCard({ playbook, defaultOpen }: { playbook: Playbook; defaultOpen: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const Icon = playbook.icon;
  return (
    <div className="overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md">
      {/* Emerald header strip */}
      <div className="h-1 w-full bg-profit" />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-muted/30 px-3 py-2.5 text-right"
        aria-expanded={open}
      >
        <div className={cn('flex h-7 w-7 items-center justify-center rounded-md', playbook.iconBg)}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="flex-1 text-sm font-semibold leading-tight">{playbook.title}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="space-y-3 p-3">
          {/* Condition */}
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <CheckCircle2 className="h-3 w-3" />
              الشرط
            </div>
            <p className="rounded-md border bg-muted/30 p-2 text-xs leading-relaxed">
              {playbook.condition}
            </p>
          </div>
          {/* Steps */}
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ListChecks className="h-3 w-3" />
              الإجراء
            </div>
            <ol className="space-y-1.5">
              {playbook.steps.map((s, idx) => (
                <li key={idx} className="flex gap-2 text-xs leading-relaxed">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-profit/15 text-xs font-bold text-profit ">
                    {idx + 1}
                  </span>
                  <span className="flex-1 pt-0.5">{s}</span>
                </li>
              ))}
            </ol>
          </div>
          {/* Mistake */}
          <div className="rounded-md border border-loss/20 bg-loss/10 p-2">
            <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-loss ">
              <AlertTriangle className="h-3.5 w-3.5" />
              الخطأ الشائع
            </div>
            <p className="text-xs leading-relaxed text-loss ">
              {playbook.mistake}
            </p>
          </div>
          {/* Example */}
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Target className="h-3 w-3" />
              مثال
            </div>
            <p className="rounded-md border border-warning/20 bg-warning/5 p-2 text-xs leading-relaxed text-muted-foreground">
              {playbook.example}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function ActionPlaybooks() {
  return (
    <Card className="overflow-hidden border-profit/20 via-card to-card">
      <CardHeader className="gap-2 border-b bg-profit/20 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-profit/15 text-profit ">
            <ListChecks className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base sm:text-lg">كتيبات الإجراءات</CardTitle>
            <CardDescription className="text-xs">
              خطط جاهزة لكل موقف · انقر على البطاقة لتوسيعها
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {PLAYBOOKS.map((p, i) => (
            <PlaybookCard key={p.id} playbook={p} defaultOpen={i === 0} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
