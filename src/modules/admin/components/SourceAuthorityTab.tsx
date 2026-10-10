'use client';

/**
 * SourceAuthorityTab
 * ==================
 * Task 28-B (Fix 2 — Fix Battalion):
 *   Admin UI for the Canonical Source Authority subsystem (Rule 66).
 *
 *   Shows:
 *     - CANONICAL_SOURCES per market (mirrored from vps-service/data/source_authority.py)
 *     - BANNED_SOURCES list (with reason)
 *     - Multi-source conflict count: tickers whose price_history has >1 source
 *       (live from /api/admin/sources when available, otherwise shows the
 *       mirror constants + a notice that the live endpoint isn't wired)
 *
 *   This tab is the missing P0 admin view: the backend has write_guarded()
 *   that protects against multi-source contamination, but admin had NO UI
 *   to see which sources are canonical, which are banned, or how many
 *   tickers have conflicting multi-source data.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2, XCircle,
  Database, Layers, Ban, TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Mirror of vps-service/data/source_authority.py CANONICAL_SOURCES   */
/*  (kept in sync manually — Task 28-B Fix 2 — Fix Battalion)          */
/* ------------------------------------------------------------------ */

const CANONICAL_SOURCES_FALLBACK: Record<string, string[]> = {
  EGX: ['intraday_aggregated', 'egksco', 'yahoo_clean'],
  TADAWUL: ['yahoo_clean', 'egx_investment_migration'],
  KSE: ['yahoo_clean'],
  QSE: ['yahoo_clean'],
  US: ['yahoo_clean'],
  CRYPTO: ['crypto_fetcher', 'tradingview_live'],
  GOLD: ['gold_fetcher', 'yahoo_clean'],
};

const BANNED_SOURCES_FALLBACK: Array<{ source: string; reason: string }> = [
  { source: 'egxpilot_live', reason: 'بيانات تجريبية — مدى قصير وغير موثوق' },
  { source: 'yahoo_safetynet', reason: 'احتياطي للاحتياطي — تغطية محدودة' },
  { source: 'yfinance_backfill', reason: '18 صف فقط — غير موثوق' },
];

interface SourceAuthorityResponse {
  success: boolean;
  canonical_sources?: Record<string, string[]>;
  banned_sources?: Array<{ source: string; reason: string }>;
  multi_source_conflicts?: {
    total_tickers_with_multi_sources: number;
    by_market?: Array<{ market: string; ticker_count: number; sources: string[] }>;
    sample?: Array<{ ticker: string; market: string; sources: string[] }>;
  };
  endpoint_live?: boolean;
  error?: string;
}

export function SourceAuthorityTab() {
  const [data, setData] = useState<SourceAuthorityResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/sources', { credentials: 'same-origin', cache: 'no-store' });
      if (res.ok) {
        const json: SourceAuthorityResponse = await res.json();
        setData({ ...json, endpoint_live: true });
      } else {
        // Endpoint not yet wired (Fix 10) — fall back to mirror constants
        setData({
          success: true,
          canonical_sources: CANONICAL_SOURCES_FALLBACK,
          banned_sources: BANNED_SOURCES_FALLBACK,
          endpoint_live: false,
        });
      }
    } catch { // silent fallback (safe-by-design)
      // Network error — fall back to mirror constants
      setData({
        success: true,
        canonical_sources: CANONICAL_SOURCES_FALLBACK,
        banned_sources: BANNED_SOURCES_FALLBACK,
        endpoint_live: false,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const canonical = data?.canonical_sources ?? CANONICAL_SOURCES_FALLBACK;
  const banned = data?.banned_sources ?? BANNED_SOURCES_FALLBACK;
  const conflicts = data?.multi_source_conflicts;
  const isLive = data?.endpoint_live === true;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <Card className="border-emerald-200 dark:border-emerald-900/40">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                سلطة المصادر — Rule 66
              </CardTitle>
              <CardDescription className="mt-1 text-xs">
                المصدر الواحد الموثوق لكل سوق + المصادر المحظورة + كشف التعارضات متعددة المصادر.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {isLive ? (
                <Badge className="bg-emerald-600 text-[10px] gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Endpoint حيّ
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] gap-1 border-amber-500 text-amber-700">
                  <AlertTriangle className="w-3 h-3" /> بيانات محلية (endpoint غير مفعّل)
                </Badge>
              )}
              <Button onClick={fetchSources} disabled={loading} variant="ghost" size="sm" className="gap-2">
                <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
                تحديث
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Conflict alert */}
      {conflicts && conflicts.total_tickers_with_multi_sources > 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800/40">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-amber-800 dark:text-amber-300">
                {conflicts.total_tickers_with_multi_sources} سهم لديهم أكثر من مصدر في price_history
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                هذا قد يشير إلى تسريب بيانات من مصدر محظور أو fallback. يرجى مراجعة
                write_guarded logs والتأكد من أن المصدر الأساسي طازج.
              </p>
              {conflicts.sample && conflicts.sample.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {conflicts.sample.slice(0, 10).map((s, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]" dir="ltr">
                      {s.ticker} ({s.market}): {s.sources.join(' + ')}
                    </Badge>
                  ))}
                  {conflicts.total_tickers_with_multi_sources > 10 && (
                    <span className="text-[10px] text-muted-foreground">
                      + {conflicts.total_tickers_with_multi_sources - 10} أخرى
                    </span>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Conflict count box */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox
          label="إجمالي الأسواق"
          value={Object.keys(canonical).length}
          icon={<Database className="w-4 h-4 text-emerald-500" />}
        />
        <StatBox
          label="إجمالي المصادر الكنسية"
          value={Object.values(canonical).reduce((sum, arr) => sum + arr.length, 0)}
          icon={<Layers className="w-4 h-4 text-sky-500" />}
        />
        <StatBox
          label="مصادر محظورة"
          value={banned.length}
          icon={<Ban className="w-4 h-4 text-red-500" />}
        />
        <StatBox
          label="تعارضات متعددة المصادر"
          value={conflicts?.total_tickers_with_multi_sources ?? '—'}
          sub={isLive ? 'مباشر من DB' : 'يتطلب endpoint'}
          icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
        />
      </div>

      {/* Loading */}
      {loading && !data && (
        <Card>
          <CardContent className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Canonical sources per market */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            المصادر الكنسية حسب السوق
          </CardTitle>
          <CardDescription className="text-xs">
            الترتيب = الأولوية. المصدر الأول هو الأساسي، والباقي احتياطي يستخدم فقط عند جفاف الأساسي (&gt; 7 أيام).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(canonical).map(([market, sources]) => (
              <div
                key={market}
                className={cn(
                  'p-3 rounded-lg border',
                  'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900/40',
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <Badge className="bg-emerald-600 text-xs">{market}</Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {sources.length} مصدر
                  </span>
                </div>
                <div className="space-y-1.5">
                  {sources.map((src, idx) => (
                    <div key={src} className="flex items-center gap-2 text-xs">
                      <span
                        className={cn(
                          'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                          idx === 0
                            ? 'bg-emerald-600 text-white'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {idx + 1}
                      </span>
                      <span className="font-mono" dir="ltr">{src}</span>
                      {idx === 0 && (
                        <Badge variant="outline" className="text-[9px] border-emerald-500 text-emerald-700">
                          أساسي
                        </Badge>
                      )}
                      {idx > 0 && (
                        <Badge variant="outline" className="text-[9px] text-muted-foreground">
                          احتياطي
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Banned sources */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Ban className="w-4 h-4 text-red-500" />
            المصادر المحظورة ({banned.length})
          </CardTitle>
          <CardDescription className="text-xs">
            هذه المصادر لن تُكتب أبداً حتى كاحتياطي — أضيفت بسبب مشاكل جودة بيانات مكتشفة.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {banned.map((b) => (
              <div
                key={b.source}
                className="flex items-start gap-3 p-2.5 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/40"
              >
                <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-mono text-sm" dir="ltr">{b.source}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{b.reason}</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Conflicts by market */}
      {conflicts?.by_market && conflicts.by_market.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-amber-500" />
              توزيع التعارضات حسب السوق
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {conflicts.by_market.map((m) => (
                <div
                  key={m.market}
                  className="p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40"
                >
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-xs">{m.market}</Badge>
                    <span className="text-lg font-bold text-amber-700">{m.ticker_count}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {m.sources.slice(0, 5).map((s, i) => (
                      <Badge key={i} variant="outline" className="text-[9px]" dir="ltr">{s}</Badge>
                    ))}
                    {m.sources.length > 5 && (
                      <span className="text-[10px] text-muted-foreground">+{m.sources.length - 5}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small presentational helper                                       */
/* ------------------------------------------------------------------ */

function StatBox({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-lg bg-muted/40 border border-border/50">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="text-lg font-bold">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
