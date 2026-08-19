'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Play, Loader2, RefreshCw, CheckCircle2, AlertTriangle, Activity } from 'lucide-react';

interface StatusDist {
  status: string;
  c: number;
}

interface ClosingStats {
  success: boolean;
  persona_predictions?: StatusDist[];
  master?: { open: number; closed: number; hit_target: number };
}

interface CloseResult {
  success: boolean;
  dryRun: boolean;
  table: string;
  expireDays: number;
  elapsedMs: number;
  summary?: {
    success: boolean;
    elapsed_seconds: number;
    results?: Record<string, Record<string, number>>;
  };
  output?: string;
  stderr?: string;
  error?: string;
}

export function PredictionClosingEngine() {
  const [stats, setStats] = useState<ClosingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [expireDays, setExpireDays] = useState(30);
  const [table, setTable] = useState<'all' | 'persona' | 'master'>('all');
  const [result, setResult] = useState<CloseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/close-predictions');
      const data = await res.json();
      if (data.success) setStats(data);
      else setError(data.error || 'فشل تحميل الحالة');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const runEngine = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/close-predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, expireDays, dryRun }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) {
        // Refresh stats after run
        setTimeout(() => fetchStats(), 500);
      } else {
        setError(data.error || 'فشل التشغيل');
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setRunning(false);
    }
  };

  const personaTotal = stats?.persona_predictions?.reduce((s, x) => s + x.c, 0) ?? 0;
  const personaPending = stats?.persona_predictions?.find((x) => x.status === 'PENDING')?.c ?? 0;
  const personaTarget = stats?.persona_predictions?.find((x) => x.status === 'TARGET_HIT')?.c ?? 0;
  const personaStopped = stats?.persona_predictions?.find((x) => x.status === 'STOPPED')?.c ?? 0;
  const personaExpired = stats?.persona_predictions?.find((x) => x.status === 'EXPIRED')?.c ?? 0;
  const masterOpen = stats?.master?.open ?? 0;
  const masterClosed = stats?.master?.closed ?? 0;
  const masterHit = stats?.master?.hit_target ?? 0;

  const closedRate = personaTotal > 0
    ? (((personaTotal - personaPending) / personaTotal) * 100).toFixed(1)
    : '0.0';

  return (
    <Card className="border-amber-500/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5 text-amber-600" />
            محرك إغلاق التوقعات
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchStats}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <div className="rounded-md border p-2.5 bg-muted/30">
            <div className="text-xs text-muted-foreground">persona مفتوحة</div>
            <div className="text-lg font-bold text-amber-600">{personaPending}</div>
          </div>
          <div className="rounded-md border p-2.5 bg-muted/30">
            <div className="text-xs text-muted-foreground">persona هدف ✓</div>
            <div className="text-lg font-bold text-emerald-600">{personaTarget}</div>
          </div>
          <div className="rounded-md border p-2.5 bg-muted/30">
            <div className="text-xs text-muted-foreground">persona ستوب ✗</div>
            <div className="text-lg font-bold text-destructive">{personaStopped}</div>
          </div>
          <div className="rounded-md border p-2.5 bg-muted/30">
            <div className="text-xs text-muted-foreground">نسبة الإغلاق</div>
            <div className="text-lg font-bold">{closedRate}%</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-md border p-2.5 bg-muted/30">
            <div className="text-xs text-muted-foreground">master مفتوحة</div>
            <div className="text-lg font-bold text-amber-600">{masterOpen}</div>
          </div>
          <div className="rounded-md border p-2.5 bg-muted/30">
            <div className="text-xs text-muted-foreground">master مغلقة</div>
            <div className="text-lg font-bold text-emerald-600">{masterClosed}</div>
          </div>
          <div className="rounded-md border p-2.5 bg-muted/30">
            <div className="text-xs text-muted-foreground">master هدف ✓</div>
            <div className="text-lg font-bold text-emerald-600">{masterHit}</div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">الجدول:</label>
            <select
              value={table}
              onChange={(e) => setTable(e.target.value as any)}
              className="h-8 rounded-md border bg-background px-2 text-sm"
              disabled={running}
            >
              <option value="all">الكل</option>
              <option value="persona">persona_predictions</option>
              <option value="master">predictions</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">انتهاء بعد:</label>
            <input
              type="number"
              value={expireDays}
              onChange={(e) => setExpireDays(Math.max(1, parseInt(e.target.value) || 30))}
              className="h-8 w-16 rounded-md border bg-background px-2 text-sm"
              disabled={running}
            />
            <span className="text-xs text-muted-foreground">يوم</span>
          </div>

          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              className="h-4 w-4"
              disabled={running}
            />
            تجربة فقط (dry-run)
          </label>

          <Button
            onClick={runEngine}
            disabled={running}
            variant={dryRun ? 'outline' : 'default'}
            className="ml-auto"
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                جاري التشغيل...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                {dryRun ? 'تجربة الإغلاق' : 'تشغيل محرك الإغلاق'}
              </>
            )}
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-sm">{error}</AlertDescription>
          </Alert>
        )}

        {result && result.success && (
          <Alert className="border-emerald-500/40 bg-emerald-500/5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertDescription className="text-sm">
              <div className="font-medium mb-1">
                {result.dryRun ? '✓ تجربة مكتملة' : '✓ تم تشغيل محرك الإغلاق'}
                <span className="text-muted-foreground font-normal ml-2">
                  ({result.elapsedMs}ms)
                </span>
              </div>
              {result.summary?.results && (
                <div className="space-y-1 text-xs">
                  {Object.entries(result.summary.results).map(([tbl, s]) => (
                    <div key={tbl} className="flex flex-wrap gap-x-3 gap-y-0.5">
                      <Badge variant="secondary" className="text-xs">{tbl}</Badge>
                      <span>إجمالي: {s.total}</span>
                      <span className="text-emerald-600">أهداف: {s.target_hit}</span>
                      <span className="text-destructive">ستوب: {s.stopped_out}</span>
                      <span>منتهية: {s.expired}</span>
                      <span className="text-amber-600">لا تزال مفتوحة: {s.still_pending}</span>
                      <span className="text-muted-foreground">بدون سعر: {s.no_price_data}</span>
                      {s.errors > 0 && (
                        <span className="text-destructive">أخطاء: {s.errors}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="text-xs text-muted-foreground pt-1 border-t">
          💡 المحرك يقارن السعر الحالي لكل توقع مفتوح بـ target/stop ويحدّث الحالة + P&L.
          شغّله يدوياً أو اضبط cron job: <code className="bg-muted px-1 rounded">python3 vps-service/scripts/close_predictions.py</code>
        </div>
      </CardContent>
    </Card>
  );
}
