'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, RefreshCw, AlertTriangle, CheckCircle2, Loader2, Database } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Phase 9: زرار مسح الكاش + إعادة بناء التوقعات
 *
 * بيمسح:
 * - cached_analysis (توقعات قديمة)
 * - stored_analyses (تحليلات مخزنة)
 * - prediction_logs أقدم من 7 أيام
 *
 * بعد المسح، المحرك هيعيد بناء التوقعات بالمحرك الجديد (V13 + Quant + SMC)
 */
export function PurgeCacheButton() {
  const [loading, setLoading] = useState(false);
  const [purging, setPurging] = useState(false);
  const [freedMB, setFreedMB] = useState<number | null>(null);
  const [stats, setStats] = useState<{
    cached_analysis?: number;
    latest_cache_date?: string;
    prediction_logs?: number;
    needs_purge?: boolean;
  } | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/purge-cache', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setStats(data.stats);
        }
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // P37-PHASE-4B: لما freedMB يتحدّث، اعرضه جنب الزرار لمدة 8 ثواني ثم اخفه.
  useEffect(() => {
    if (freedMB === null) return;
    const t = setTimeout(() => setFreedMB(null), 8000);
    return () => clearTimeout(t);
  }, [freedMB]);

  const handlePurge = async (scope: 'all' | 'cache_only' | 'predictions_only') => {
    setPurging(true);
    setFreedMB(null);
    try {
      const res = await fetch(`/api/admin/purge-cache?scope=${scope}`, {
        method: 'POST',
      });
      const data = await res.json();

      if (data.success) {
        // P37-PHASE-4B: الـ backend بيرجع freedBytes + freedMB. لو موجودين،
        // اعرضهم في الـ toast و inline تحت الزرار.
        const mb: number | null =
          typeof data.freedMB === 'number'
            ? data.freedMB
            : typeof data.freedBytes === 'number'
              ? Number((data.freedBytes / (1024 * 1024)).toFixed(2))
              : null;

        if (mb !== null && mb > 0) {
          setFreedMB(mb);
          toast.success(data.message || 'تم مسح الكاش بنجاح', {
            description: `تم تفريغ ${(mb ?? 0).toFixed(1)} MB`,
          });
        } else {
          toast.success(data.message || 'تم مسح الكاش بنجاح');
        }
        // Refresh stats
        await fetchStats();
      } else {
        toast.error(data.error || 'فشل مسح الكاش');
      }
    } catch {
      toast.error('خطأ في الاتصال');
    } finally {
      setPurging(false);
    }
  };

  const [generating, setGenerating] = useState(false);

  // PHASE4-APIS (Task PHASE4-APIS): /api/admin/generate-predictions is 410 Gone.
  // Predictions now auto-generate via cron (daily_predictor.py). The two
  // buttons that called handleGenerate were already commented out (see JSX
  // below at "DISABLED 2026-09-02" block). This function is kept as a no-op
  // safety net so future re-enabling surfaces the canonical guidance instead
  // of silently calling a dead endpoint.
  const handleGenerate = async (type: 'intraday' | 'daily') => {
    setGenerating(true);
    toast.info(
      type === 'daily'
        ? 'التوقعات اليومية تُولّد تلقائيًا عبر cron (daily_predictor.py) — لا حاجة لتشغيل يدوي.'
        : 'فحص السوق اللحظي يتم عبر MarketScheduler.tick في Python backend — لا حاجة لتشغيل يدوي.',
      { description: 'مسار /api/admin/generate-predictions معطّل (410 Gone).' }
    );
    setGenerating(false);
  };

  const cacheCount = stats?.cached_analysis ?? -1;
  const needsPurge = stats?.needs_purge === true || (cacheCount > 0);
  const latestDate = stats?.latest_cache_date;

  return (
    <Card className={needsPurge ? 'border-warning bg-warning/50 dark:bg-warning/10' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            مسح الكاش وإعادة بناء التوقعات
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={fetchStats} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            {cacheCount > 0 ? (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="w-3 h-3" />
                {cacheCount} صف قديم
              </Badge>
            ) : cacheCount === 0 ? (
              <Badge variant="default" className="gap-1 bg-profit">
                <CheckCircle2 className="w-3 h-3" />
                نظيف
              </Badge>
            ) : (
              <Badge variant="outline">غير متاح</Badge>
            )}
            <span className="text-muted-foreground text-xs">cached_analysis</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              prediction_logs: {stats?.prediction_logs ?? 'N/A'}
            </span>
          </div>
        </div>

        {/* Latest cache date warning */}
        {needsPurge && latestDate && (
          <div className="p-3 rounded-lg bg-warning dark:bg-warning/30 border border-warning dark:border-warning">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-warning dark:text-warning mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-semibold text-warning dark:text-warning">
                  الكاش قديم! آخر تحليل: {latestDate}
                </p>
                <p className="text-warning dark:text-warning text-xs mt-1">
                  التوقعات اللي بتظهر للعملاء هي من الكاش القديم. لازم تمسح الكاش عشان المحرك الجديد (V13 + Quant + SMC) يشتغل.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => handlePurge('all')}
            disabled={purging}
            className="bg-loss hover:bg-loss text-white gap-2"
          >
            {purging ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            مسح الكل + إعادة بناء
          </Button>

          <Button
            onClick={() => handlePurge('cache_only')}
            disabled={purging}
            variant="outline"
            className="gap-2"
          >
            <Trash2 className="w-4 h-4" />
            مسح cached_analysis فقط
          </Button>

          <Button
            onClick={() => handlePurge('predictions_only')}
            disabled={purging}
            variant="outline"
            className="gap-2"
          >
            <Trash2 className="w-4 h-4" />
            مسح التوقعات القديمة
          </Button>

          {/* ============================================================
          * DISABLED (2026-09-02) — Owner directive:
          * "زرار توليد توقعات ده معناه إننا بنعمل توقعات عشوائية الغيه خالص"
          *
          * التوقعات بـ تتولّد تلقائياً من V40.2 (cron job) — مش محتاجين تدخل يدوي.
          * الأزرار دي كانت بـ تشغل scripts بـ BYPASS_PRED_CAP=1 بدون context كافي،
          * فكانت بتـ produce توقعات عشوائية مش مبنية على التحليل الكامل.
          * ============================================================ */}
          {/* تم إزالة:
            - 🎯 فحص لحظي حقيقي (5 دقائق)
            - ⚡ تشغيل محرك V40.2 الموحد (اليومي)
          */}
        </div>

        {/* P37-PHASE-4B: حجم المساحة المُحرَّرة بعد آخر عملية مسح */}
        {freedMB !== null && (
          <div
            role="status"
            className="flex items-center gap-2 text-xs text-profit dark:text-profit"
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              تم تفريغ <span className="font-semibold">{(freedMB ?? 0).toFixed(1)} MB</span> من الكاش
            </span>
          </div>
        )}

        {/* Info */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>📝 بعد مسح الكاش، المحرك هيعيد بناء التوقعات بالمحرك الجديد:</p>
          <ul className="list-disc list-inside ml-2 space-y-0.5">
            <li>SMC Engine (Order Blocks + FVG + Sweeps)</li>
            <li>Quant Engine (Z-Score + VSA + TTM Squeeze)</li>
            <li>Dynamic Risk (Kaufman ER + ATR ديناميكي)</li>
            <li>EGX Tuned (Soft Penalty + RSI 80)</li>
          </ul>
          <p className="mt-2 text-warning dark:text-warning">
            ⚠️ يفضل تعمل restart لـ Python backend بعد المسح: pm2 restart python-backend
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
