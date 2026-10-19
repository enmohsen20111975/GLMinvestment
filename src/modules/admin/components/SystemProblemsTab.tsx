'use client';

/**
 * System Problems tab — renders the FULL list of `systemIssues` from AdminView.
 *
 * Previously the admin dashboard only showed a count badge ("9 مشاكل") without
 * surfacing what the problems actually were. This component renders the complete
 * list with severity badges, category, description, solution hint, and timestamp.
 *
 * Design rules (per task brief):
 *  - Arabic RTL layout.
 *  - NO indigo / blue. Critical = destructive (red), warning = amber,
 *    healthy / info = emerald.
 *  - Uses shadcn/ui Card, Badge, Button, Separator + a custom scrollbar.
 *  - Empty (0 issues) state shows a green "النظام يعمل بشكل سليم" panel.
 *  - Loading state shows skeletons.
 */

import React from 'react';
import {
  AlertTriangle,
  AlertCircle,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Server,
  Database,
  Target,
  Cpu,
  Clock,
  Lightbulb,
  Activity,
  Info,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { SystemIssue } from './AdminView';

// ==================== PROPS ====================

interface SystemProblemsTabProps {
  /** Full list of computed system issues (already includes critical + warning + info). */
  issues: SystemIssue[];
  /** Number of critical issues (severity === 'critical'). */
  criticalCount: number;
  /** Number of warning issues (severity === 'warning'). */
  warningCount: number;
  /** Optional refresh callback — wired to AdminView's data fetchers. */
  onRefresh?: () => void;
  /** True when a refresh is in-flight (disables the refresh button + shows spinner). */
  refreshing?: boolean;
}

// ==================== HELPERS ====================

const CATEGORY_LABELS: Record<SystemIssue['category'], string> = {
  service: 'خدمة',
  data: 'بيانات',
  analysis: 'تحليل',
  system: 'نظام',
};

function CategoryIcon({ category, className }: { category: SystemIssue['category']; className?: string }) {
  switch (category) {
    case 'service':
      return <Server className={className} />;
    case 'data':
      return <Database className={className} />;
    case 'analysis':
      return <Target className={className} />;
    case 'system':
    default:
      return <Cpu className={className} />;
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    // RTL-friendly: keep ISO date+time, no timezone confusion
    return d.toLocaleString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/**
 * Group issues by severity, with the most-severe first so the user always sees
 * critical problems at the top of the list.
 */
function groupBySeverity(issues: SystemIssue[]): {
  critical: SystemIssue[];
  warning: SystemIssue[];
  info: SystemIssue[];
} {
  const critical: SystemIssue[] = [];
  const warning: SystemIssue[] = [];
  const info: SystemIssue[] = [];
  for (const issue of issues) {
    if (issue.severity === 'critical') critical.push(issue);
    else if (issue.severity === 'warning') warning.push(issue);
    else info.push(issue);
  }
  return { critical, warning, info };
}

// ==================== SUB-COMPONENTS ====================

function SeverityBadge({ severity }: { severity: SystemIssue['severity'] }) {
  if (severity === 'critical') {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="w-3 h-3" />
        حرجة
      </Badge>
    );
  }
  if (severity === 'warning') {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-warning bg-warning text-warning dark:bg-warning/40 dark:text-warning"
      >
        <AlertCircle className="w-3 h-3" />
        تحذير
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-profit bg-profit text-profit dark:bg-profit/40 dark:text-profit"
    >
      <Info className="w-3 h-3" />
      معلومة
    </Badge>
  );
}

function IssueRow({ issue }: { issue: SystemIssue }) {
  const isCritical = issue.severity === 'critical';
  const isWarning = issue.severity === 'warning';

  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-colors',
        isCritical
          ? 'border-loss bg-loss/50 dark:border-loss/50 dark:bg-loss/20'
          : isWarning
            ? 'border-warning bg-warning/50 dark:border-warning/50 dark:bg-warning/20'
            : 'border-profit bg-profit/50 dark:border-profit/50 dark:bg-profit/20',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div
            className={cn(
              'shrink-0 mt-0.5 rounded-md p-1.5',
              isCritical
                ? 'bg-loss text-loss dark:bg-loss/50 dark:text-loss'
                : isWarning
                  ? 'bg-warning text-warning dark:bg-warning/50 dark:text-warning'
                  : 'bg-profit text-profit dark:bg-profit/50 dark:text-profit',
            )}
          >
            <CategoryIcon category={issue.category} className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h4 className="font-semibold text-sm text-foreground">{issue.title}</h4>
              <SeverityBadge severity={issue.severity} />
              <Badge variant="secondary" className="text-[10px]">
                {CATEGORY_LABELS[issue.category] ?? issue.category}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {issue.description}
            </p>
            {issue.solution && (
              <div className="mt-2 flex items-start gap-1.5 text-xs text-warning dark:text-warning">
                <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  <span className="font-medium">الحل المقترح: </span>
                  {issue.solution}
                </span>
              </div>
            )}
            <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span dir="ltr">{formatTimestamp(issue.timestamp)}</span>
              <span className="mx-1 opacity-40">•</span>
              <span className="font-mono opacity-70" dir="ltr">{issue.id}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IssueSection({
  title,
  icon,
  count,
  issues,
  accent,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  issues: SystemIssue[];
  accent: 'red' | 'amber' | 'emerald';
}) {
  if (issues.length === 0) return null;
  const accentClasses = {
    red: 'text-loss',
    amber: 'text-warning',
    emerald: 'text-profit',
  }[accent];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <span className={accentClasses}>{icon}</span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <Badge variant="secondary" className="text-[10px]">
          {count}
        </Badge>
      </div>
      <div className="space-y-2">
        {issues.map(issue => (
          <IssueRow key={issue.id} issue={issue} />
        ))}
      </div>
    </div>
  );
}

function SummaryStatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: 'red' | 'amber' | 'emerald' | 'neutral';
}) {
  const toneClasses = {
    red: 'bg-loss text-loss dark:bg-loss/30 dark:text-loss',
    amber: 'bg-warning text-warning dark:bg-warning/30 dark:text-warning',
    emerald:
      'bg-profit text-profit dark:bg-profit/30 dark:text-profit',
    neutral: 'bg-muted text-muted-foreground',
  }[tone];

  return (
    <div className="rounded-lg border bg-card p-4 text-center">
      <div className={cn('mx-auto mb-2 w-fit rounded-md p-2', toneClasses)}>
        {icon}
      </div>
      <div className="text-2xl font-bold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

// ==================== MAIN COMPONENT ====================

export function SystemProblemsTab({
  issues,
  criticalCount,
  warningCount,
  onRefresh,
  refreshing = false,
}: SystemProblemsTabProps) {
  const totalCount = issues.length;
  const infoCount = issues.filter(i => i.severity === 'info').length;
  const grouped = groupBySeverity(issues);

  // ---- Loading state ----
  // We treat "refreshing with no issues yet" as a loading state so the user
  // sees skeletons on first mount instead of the healthy/empty state.
  const isLoading = refreshing && totalCount === 0;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-warning" />
            <CardTitle>مشاكل النظام</CardTitle>
          </div>
          <CardDescription>جاري تحميل حالة النظام...</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
          <Separator />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  // ---- Healthy (empty) state ----
  if (totalCount === 0) {
    return (
      <Card className="border-profit dark:border-profit/60">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-profit" />
              <CardTitle>مشاكل النظام</CardTitle>
            </div>
            {onRefresh && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={refreshing}
                className="gap-1"
              >
                <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
                تحديث
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 rounded-full bg-profit p-4 dark:bg-profit/40">
              <ShieldCheck className="w-12 h-12 text-profit" />
            </div>
            <h3 className="text-lg font-semibold text-profit dark:text-profit">
              النظام يعمل بشكل سليم
            </h3>
            <p className="mt-1 text-sm text-muted-foreground max-w-md">
              لا توجد مشاكل حرجة أو تحذيرات في النظام حالياً. جميع الخدمات والبيانات
              تعمل ضمن المعدّلات الطبيعية.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---- Main render ----
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert
                className={cn(
                  'w-5 h-5',
                  criticalCount > 0 ? 'text-loss' : 'text-warning',
                )}
              />
              <CardTitle>مشاكل النظام</CardTitle>
              <Badge variant="secondary">{totalCount} إجمالي</Badge>
            </div>
            <CardDescription className="mt-1">
              قائمة تفصيلية بالمشاكل والتحذيرات النشطة في النظام — مرتّبة حسب
              الخطورة (الحرجة أولاً).
            </CardDescription>
          </div>
          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={refreshing}
              className="gap-1"
            >
              <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
              {refreshing ? 'جاري التحديث...' : 'تحديث'}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryStatCard
            label="إجمالي المشاكل"
            value={totalCount}
            icon={<Activity className="w-5 h-5" />}
            tone={criticalCount > 0 ? 'red' : 'amber'}
          />
          <SummaryStatCard
            label="مشاكل حرجة"
            value={criticalCount}
            icon={<AlertTriangle className="w-5 h-5" />}
            tone="red"
          />
          <SummaryStatCard
            label="تحذيرات"
            value={warningCount}
            icon={<AlertCircle className="w-5 h-5" />}
            tone="amber"
          />
          <SummaryStatCard
            label="معلومات"
            value={infoCount}
            icon={<Info className="w-5 h-5" />}
            tone="emerald"
          />
        </div>

        <Separator />

        {/* Scrollable issues list */}
        <div
          dir="rtl"
          className="max-h-[28rem] overflow-y-auto pl-1 pr-1
                     [&::-webkit-scrollbar]:w-2
                     [&::-webkit-scrollbar-track]:bg-transparent
                     [&::-webkit-scrollbar-thumb]:rounded-full
                     [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30
                     [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50"
        >
          <div className="space-y-5">
            <IssueSection
              title="مشاكل حرجة"
              icon={<AlertTriangle className="w-4 h-4" />}
              count={criticalCount}
              issues={grouped.critical}
              accent="red"
            />
            <IssueSection
              title="تحذيرات"
              icon={<AlertCircle className="w-4 h-4" />}
              count={warningCount}
              issues={grouped.warning}
              accent="amber"
            />
            <IssueSection
              title="معلومات"
              icon={<Info className="w-4 h-4" />}
              count={infoCount}
              issues={grouped.info}
              accent="emerald"
            />
          </div>
        </div>

        {/* Footer hint */}
        <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            تُجمَع هذه المشاكل تلقائياً من حالة الخدمات (VPS Python، قاعدة
            البيانات)، حالة تحديث بيانات الأسواق، وأداء التوقعات. اضغط
            «تحديث» لإعادة الفحص.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default SystemProblemsTab;
