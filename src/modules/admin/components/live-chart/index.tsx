'use client';

/**
 * Live Chart Primitives
 * =====================
 * مكوّنات مساعدة مستخرجة من SystemTopologyTab لتعميم نمط "المخطط الحي"
 * على كل شاشات الأدمن.
 *
 * الاستخدام:
 *   import { LiveStatusBar, LiveDot, useLivePolling, formatLiveSeconds, STATUS_STYLES } from './live-chart';
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

// ==================== Constants ====================

export const STATUS_STYLES: Record<string, { bg: string; text: string; border: string; dot: string; label: string }> = {
  running: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800', dot: 'bg-emerald-500', label: 'يعمل' },
  degraded: { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800', dot: 'bg-amber-500', label: 'بطيء' },
  stopped: { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800', dot: 'bg-red-500', label: 'متوقف' },
  unknown: { bg: 'bg-muted/50', text: 'text-muted-foreground', border: 'border-muted', dot: 'bg-muted-foreground', label: 'غير معروف' },
};

export function getStatusStyle(status: string) {
  return STATUS_STYLES[status] || STATUS_STYLES.unknown;
}

// ==================== Helpers ====================

export function formatLiveSeconds(isoTs: string | number | null | undefined, nowMs: number): string {
  if (!isoTs) return '—';
  const ts = typeof isoTs === 'string' ? new Date(isoTs).getTime() : isoTs;
  if (!ts || isNaN(ts)) return '—';
  // 🔴 إصلاح "منذ 216 سنة": تحقق إن الـ timestamp بعد 2020
  if (new Date(ts).getFullYear() < 2020) return '—';
  const diff = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diff < 60) return `منذ ${diff}ث`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hours < 24) return remainMins > 0 ? `منذ ${hours} ساعة و${remainMins} دقيقة` : `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  if (days < 7) return remainHours > 0 ? `منذ ${days} يوم و${remainHours} ساعة` : `منذ ${days} يوم`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    const remainDays = days % 7;
    return remainDays > 0 ? `منذ ${weeks} أسبوع و${remainDays} يوم` : `منذ ${weeks} أسبوع`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `منذ ${months} شهر`;
  }
  const years = Math.floor(days / 365);
  return `منذ ${years} سنة`;
}

export function formatLiveClock(nowMs: number): string {
  return new Date(nowMs).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ==================== LiveDot ====================

export function LiveDot({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' | 'lg' }) {
  const s = getStatusStyle(status);
  const sz = size === 'lg' ? 'h-4 w-4' : size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3';
  return (
    <span className={cn('relative inline-flex', sz)}>
      {status === 'running' && (
        <span className={cn('animate-ping absolute inline-flex h-full w-full rounded-full opacity-75', s.dot)} />
      )}
      <span className={cn('relative inline-flex rounded-full h-full w-full', s.dot)} />
    </span>
  );
}

// ==================== useLivePolling Hook ====================

/**
 * Hook لتوفير polling تلقائي + 1s ticker للـ "live timestamps".
 *
 * يعيد:
 *   - now: timestamp حالي (يُحدّث كل 1ث)
 *   - lastUpdate: آخر مرة نجح فيها الـ fetch (ms)
 *   - refreshing: هل الـ fetch جارٍ الآن
 *   - refresh: دالة لاستدعاء الـ fetch يدوياً
 *   - secondsUntilNext: ثواني للتحديث القادم
 */
export function useLivePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number = 15000,
  options: { onSuccess?: (data: T) => void; onError?: (err: unknown) => void } = {}
) {
  const [now, setNow] = useState(Date.now());
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fetcherRef = useRef(fetcher);
  const optsRef = useRef(options);

  // Update refs without re-triggering effect
  fetcherRef.current = fetcher;
  optsRef.current = options;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await fetcherRef.current();
      setLastUpdate(Date.now());
      setError(null);
      optsRef.current.onSuccess?.(data);
    } catch (err) {
      setError(err);
      optsRef.current.onError?.(err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Initial fetch + auto-refresh
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, intervalMs);
    return () => clearInterval(interval);
  }, [refresh, intervalMs]);

  // 1s ticker for live timestamps
  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);

  const secondsUntilNext = lastUpdate
    ? Math.max(0, Math.ceil((intervalMs - (now - lastUpdate)) / 1000))
    : 0;

  return { now, lastUpdate, refreshing, error, refresh, secondsUntilNext };
}

// ==================== LiveStatusBar ====================

interface LiveStatusBarProps {
  title: string;
  now: number;
  lastUpdate: number | null;
  refreshing: boolean;
  onRefresh: () => void;
  intervalMs: number;
  secondsUntilNext: number;
  healthScore?: number;
  counts?: { label: string; value: string; tone?: 'emerald' | 'amber' | 'red' | 'muted' }[];
  badge?: string;
}

export function LiveStatusBar({
  title, now, lastUpdate, refreshing, onRefresh, intervalMs, secondsUntilNext,
  healthScore, counts = [], badge,
}: LiveStatusBarProps) {
  return (
    <Card className="border-primary/30 bg-gradient-to-l from-primary/5 to-transparent">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{title}</span>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {formatLiveClock(now)}
                </Badge>
                {badge && <Badge variant="secondary" className="text-[10px]">{badge}</Badge>}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {lastUpdate ? `آخر تحديث: ${formatLiveSeconds(lastUpdate, now)}` : 'جارٍ التحميل...'}
                {lastUpdate && ` • التحديث القادم خلال ${secondsUntilNext}ث`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {counts.map((c, i) => (
              <div key={i} className="text-center">
                <div className={cn(
                  'text-2xl font-bold',
                  c.tone === 'emerald' ? 'text-emerald-600' :
                  c.tone === 'amber' ? 'text-amber-600' :
                  c.tone === 'red' ? 'text-red-600' :
                  'text-foreground'
                )}>
                  {c.value}
                </div>
                <div className="text-[10px] text-muted-foreground">{c.label}</div>
              </div>
            ))}
            {healthScore !== undefined && (
              <div className="text-center min-w-[60px]">
                <div className={cn(
                  'text-2xl font-bold',
                  healthScore >= 80 ? 'text-emerald-600' : healthScore >= 50 ? 'text-amber-600' : 'text-red-600'
                )}>
                  {healthScore}%
                </div>
                <div className="text-[10px] text-muted-foreground">صحة</div>
              </div>
            )}
            <Button onClick={onRefresh} disabled={refreshing} size="sm" variant="outline" className="gap-1">
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
              تحديث
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== AnimatedEdge (SVG marching-ants + particles) ====================

/**
 * رسم edge متحرك بين نقطتين باستخدام SVG path + SMIL animations.
 * مناسب للمخططات الحية الصغيرة (حتى ~20 edge).
 */
export function AnimatedEdge({
  path,
  status = 'flowing',
  label,
  color,
}: {
  path: string;
  status?: 'flowing' | 'stale' | 'cut';
  label?: string;
  color?: string;
}) {
  const stroke = color || (status === 'flowing' ? '#10b981' : status === 'stale' ? '#f59e0b' : '#ef4444');
  const dur = status === 'flowing' ? '1.5s' : status === 'stale' ? '3s' : '0s';
  const particleDur = status === 'flowing' ? '2.2s' : status === 'stale' ? '4.5s' : '0s';
  const particleCount = status === 'flowing' ? 3 : status === 'stale' ? 1 : 0;

  return (
    <g>
      {/* Background dim path */}
      <path d={path} fill="none" stroke={stroke} strokeWidth={2} opacity={0.25} />
      {/* Animated marching-ants overlay */}
      {status !== 'cut' && (
        <path
          d={path}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeDasharray="8 12"
          opacity={0.8}
        >
          <animate attributeName="stroke-dashoffset" from="0" to="-40" dur={dur} repeatCount="indefinite" />
        </path>
      )}
      {/* Static red dashes for cut */}
      {status === 'cut' && (
        <path d={path} fill="none" stroke={stroke} strokeWidth={2} strokeDasharray="6 6" opacity={0.7} />
      )}
      {/* Travelling particles */}
      {particleCount > 0 && Array.from({ length: particleCount }).map((_, i) => (
        <g key={i}>
          <circle r={5} fill={stroke} opacity={0.18}>
            <animateMotion dur={particleDur} begin={`${(i * parseFloat(particleDur)) / particleCount}s`} repeatCount="indefinite" path={path} />
          </circle>
          <circle r={2.5} fill={stroke}>
            <animateMotion dur={particleDur} begin={`${(i * parseFloat(particleDur)) / particleCount}s`} repeatCount="indefinite" path={path} />
          </circle>
        </g>
      ))}
    </g>
  );
}
