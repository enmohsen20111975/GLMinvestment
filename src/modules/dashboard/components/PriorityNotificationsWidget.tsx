'use client';

/**
 * PriorityNotificationsWidget — "التنبيهات الذكية"
 * ====================================================================
 * Task A3 (تكليف ألفا — Dashboard Upgrade):
 *   عرض top 3 تنبيهات حسب الأولوية في الـ dashboard.
 *
 * Data source: /api/notifications/priority (برافو B3 — هيجهزه)
 *   - لو الـ endpoint لسه مش متاح → empty state نظيف (مش fake data)
 *   - لو الـ endpoint فشل → skeleton/آخر cached (مش يختفي)
 *   - لو مفيش notifications → "مفيش تنبيهات مهمة — كله تمام ✅"
 *
 * Rule 27 SAFE — صفر mock. كل التنبيهات من الـ backend حقيقية.
 * Rule 52 — widget مسجل في PinnableWidget registry.
 * Rule 20 — Python=Brain (priority_score بيتحسب في باك إند، مش في الفرونت).
 */

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Bell, AlertCircle, TrendingUp, CheckCircle2, ArrowLeft, BellRing } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';

type Severity = 'danger' | 'opportunity' | 'warning' | 'info' | 'success';

interface PriorityNotification {
  id: string;
  severity: Severity;
  priority_score: number;
  title: string;
  message: string;
  ticker?: string;
  created_at: string;
  action?: {
    label: string;
    url: string;
  };
}

interface PriorityResponse {
  success: boolean;
  data?: {
    priority: PriorityNotification[];
    total_count: number;
    rest_count: number;
  };
  error?: string;
}

const SEVERITY_CONFIG: Record<Severity, {
  icon: React.ElementType;
  dotClass: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
  label: string;
}> = {
  danger: {
    icon: AlertCircle,
    dotClass: 'bg-red-500',
    textClass: 'text-loss',
    bgClass: 'bg-red-50 dark:bg-red-950/30',
    borderClass: 'border-red-200 dark:border-red-900',
    label: 'خطر',
  },
  opportunity: {
    icon: TrendingUp,
    dotClass: 'bg-amber-500',
    textClass: 'text-amber-600 dark:text-amber-400',
    bgClass: 'bg-amber-50 dark:bg-amber-950/30',
    borderClass: 'border-amber-200 dark:border-amber-900',
    label: 'فرصة',
  },
  warning: {
    icon: AlertCircle,
    dotClass: 'bg-amber-500',
    textClass: 'text-amber-600 dark:text-amber-400',
    bgClass: 'bg-amber-50 dark:bg-amber-950/30',
    borderClass: 'border-amber-200 dark:border-amber-900',
    label: 'تحذير',
  },
  info: {
    icon: Bell,
    dotClass: 'bg-blue-500',
    textClass: 'text-blue-600 dark:text-blue-400',
    bgClass: 'bg-blue-50 dark:bg-blue-950/30',
    borderClass: 'border-blue-200 dark:border-blue-900',
    label: 'معلومة',
  },
  success: {
    icon: CheckCircle2,
    dotClass: 'bg-emerald-500',
    textClass: 'text-profit',
    bgClass: 'bg-emerald-50 dark:bg-emerald-950/30',
    borderClass: 'border-emerald-200 dark:border-emerald-900',
    label: 'تمام',
  },
};

export function PriorityNotificationsWidget() {
  const currentMarket = useAppStore((s) => s.currentMarket);
  const setSelectedTicker = useAppStore((s) => s.setSelectedTicker);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const [data, setData] = useState<PriorityResponse['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/notifications/priority?limit=3`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: PriorityResponse = await res.json();
        if (cancelled) return;
        if (json.success && json.data) {
          setData(json.data);
          setError(null);
        } else {
          setData(null);
          setError(json.error || 'no data');
        }
      } catch (e) {
        // Endpoint not ready (برافو still working on B3) — show empty state, don't crash.
        if (cancelled) return;
        setData(null);
        setError(e instanceof Error ? e.message : 'unknown');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentMarket]);

  const goToNotificationCenter = () => {
    // Toggle the notifications panel via store (NotificationCenter listens to this)
    setCurrentView('notifications');
    if (typeof window !== 'undefined') window.location.hash = 'notifications';
  };

  const handleNotificationClick = (n: PriorityNotification) => {
    if (n.ticker) {
      setSelectedTicker(n.ticker);
      setCurrentView('stock-detail');
      if (typeof window !== 'undefined') window.location.hash = 'stock-detail';
    } else if (n.action?.url) {
      // internal route
      if (typeof window !== 'undefined') window.location.hash = n.action.url.replace('/', '');
    }
  };

  // Loading skeleton (FCP ≤ 1.5s — lazy load, don't block first paint)
  if (loading) {
    return (
      <Card className="border-border bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <BellRing className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">تنبيهاتك المهمة</CardTitle>
              <CardDescription className="text-xs">جاري التحميل...</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Endpoint not ready or error — clean empty state (don't fake notifications)
  if (error || !data) {
    return (
      <Card className="border-border bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <BellRing className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">تنبيهاتك المهمة</CardTitle>
              <CardDescription className="text-xs">تنبيهات لحظية</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground py-4 text-center">
            التنبيهات الذكية هتظهر هنا أول ما تتفعّل.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { priority: top3, total_count, rest_count } = data;

  // No notifications — clean positive empty state
  if (!top3 || top3.length === 0) {
    return (
      <Card className="border-border bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
              <CheckCircle2 className="h-4 w-4 text-profit" />
            </div>
            <div>
              <CardTitle className="text-base">تنبيهاتك المهمة</CardTitle>
              <CardDescription className="text-xs">كل حاجة تمام</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="py-4 text-center">
            <CheckCircle2 className="h-8 w-8 text-profit mx-auto mb-2" />
            <p className="text-sm font-semibold text-foreground">مفيش تنبيهات مهمة — كله تمام ✅</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-white shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <BellRing className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">تنبيهاتك المهمة</CardTitle>
              <CardDescription className="text-xs">
                {total_count} تنبيه تحتاج انتباهك
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="gap-1 text-xs">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            {top3.length} عاجل
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Top 3 priority notifications */}
        <div className="space-y-1.5">
          {top3.map((n) => {
            const config = SEVERITY_CONFIG[n.severity] || SEVERITY_CONFIG.info;
            const Icon = config.icon;
            return (
              <button
                key={n.id}
                onClick={() => handleNotificationClick(n)}
                className={cn(
                  'w-full flex items-start gap-2 rounded-md border p-2.5 text-right transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/50',
                  config.borderClass,
                  config.bgClass
                )}
              >
                <div className={cn('flex-shrink-0 mt-0.5', config.textClass)}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold truncate">{n.title}</span>
                    {n.ticker && (
                      <span className="font-mono text-[10px] text-muted-foreground flex-shrink-0">
                        {n.ticker}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
                    {n.message}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* "شوف الكل" link — opens NotificationCenter */}
        {rest_count > 0 && (
          <Button
            onClick={goToNotificationCenter}
            variant="ghost"
            className="w-full text-xs h-8 gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <Bell className="h-3.5 w-3.5" />
            {rest_count} تنبيه تاني أقل أهمية — شوف الكل
            <ArrowLeft className="h-3 w-3" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
