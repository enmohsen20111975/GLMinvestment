'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, RefreshCw, CheckCircle2, AlertCircle,
  PieChart, Loader2, Tag, Layers
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

// Types
interface SectorStats {
  total_stocks: number;
  with_sector: number;
  without_sector: number;
  coverage_pct: number;
  sectors: Array<{ sector: string; count: number }>;
}

interface ClassificationResult {
  classified_count: number;
  unclassified_count: number;
  sector_distribution: Record<string, number>;
  unclassified_samples: string[];
}

// ألوان القطاعات
const SECTOR_COLORS: Record<string, string> = {
  'Banks': 'bg-blue-500',
  'Real Estate': 'bg-amber-500',
  'Telecom': 'bg-purple-500',
  'Food & Beverage': 'bg-green-500',
  'Energy & Utilities': 'bg-orange-500',
  'Industrial': 'bg-gray-500',
  'Healthcare & Pharmaceuticals': 'bg-red-500',
  'Investment & Financial Services': 'bg-teal-500',
  'Technology': 'bg-cyan-500',
  'Tourism & Entertainment': 'bg-pink-500',
  'Retail & Consumer Services': 'bg-lime-500',
  'Education': 'bg-indigo-500',
  'Diversified': 'bg-slate-400',
};

/**
 * Sector Classification Admin Panel
 * لوحة تصنيف القطاعات
 */
export function SectorClassificationAdmin() {
  // State
  const [stats, setStats] = useState<SectorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [classifying, setClassifying] = useState(false);
  const [result, setResult] = useState<ClassificationResult | null>(null);

  // Fetch stats on mount
  useEffect(() => {
    fetchStats();
  }, []);

  // Fetch sector stats
  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/python/admin/sectors/stats');
      const data = await res.json();
      if (data.success) {
        setStats(data.data);
      }
    } catch (e) {
      console.error('Failed to fetch sector stats:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Classify stocks
  const handleClassify = useCallback(async () => {
    setClassifying(true);
    setResult(null);
    try {
      const res = await fetch('/api/python/admin/sectors/classify-stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        setResult(data.data);
        toast.success(`تم تصنيف ${data.data.classified_count} سهم`);
        fetchStats(); // Refresh stats
      } else {
        toast.error(data.error || 'فشل التصنيف');
      }
    } catch (e) {
      toast.error('فشل الاتصال بالخادم');
    } finally {
      setClassifying(false);
    }
  }, [fetchStats]);

  // Coverage percentage
  const coveragePct = stats?.coverage_pct || 0;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl shadow-lg">
            <Building2 className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold">تصنيف القطاعات</h2>
            <p className="text-sm text-muted-foreground">تصنيف الأسهم إلى قطاعات</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchStats}
          disabled={loading}
          className="gap-1"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          تحديث
        </Button>
      </div>

      {/* Coverage Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <PieChart className="h-4 w-4" />
            التغطية القطاعية
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl font-bold">{coveragePct}%</span>
                <Badge variant={coveragePct >= 80 ? 'default' : coveragePct >= 50 ? 'secondary' : 'destructive'}>
                  {coveragePct >= 80 ? 'ممتاز' : coveragePct >= 50 ? 'متوسط' : 'ضعيف'}
                </Badge>
              </div>
              <Progress value={coveragePct} className="h-3" />
              <div className="grid grid-cols-3 gap-4 mt-4 text-center">
                <div>
                  <p className="text-2xl font-bold">{stats?.total_stocks || 0}</p>
                  <p className="text-xs text-muted-foreground">إجمالي الأسهم</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-600">{stats?.with_sector || 0}</p>
                  <p className="text-xs text-muted-foreground">بقطاع محدد</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-600">{stats?.without_sector || 0}</p>
                  <p className="text-xs text-muted-foreground">بدون قطاع</p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Classify Button */}
      <Card className="border-dashed">
        <CardContent className="py-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">تصنيف الأسهم تلقائياً</h3>
              <p className="text-sm text-muted-foreground">
                تصنيف الأسهم بدون قطاع بناءً على اسمها ورمزها
              </p>
            </div>
            <Button
              onClick={handleClassify}
              disabled={classifying || (stats?.without_sector || 0) === 0}
              className="gap-2"
            >
              {classifying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري التصنيف...
                </>
              ) : (
                <>
                  <Tag className="h-4 w-4" />
                  تصنيف الآن
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Classification Result */}
      {result && (
        <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              نتيجة التصنيف
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="text-center p-3 bg-green-100/50 dark:bg-green-900/30 rounded-lg">
                <p className="text-2xl font-bold text-green-600">{result.classified_count}</p>
                <p className="text-xs text-muted-foreground">تم تصنيفه</p>
              </div>
              <div className="text-center p-3 bg-amber-100/50 dark:bg-amber-900/30 rounded-lg">
                <p className="text-2xl font-bold text-amber-600">{result.unclassified_count}</p>
                <p className="text-xs text-muted-foreground">لم يُصنف</p>
              </div>
            </div>
            {result.unclassified_samples.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">عينات غير مصنفة:</p>
                <div className="flex flex-wrap gap-1">
                  {result.unclassified_samples.slice(0, 10).map(ticker => (
                    <Badge key={ticker} variant="outline" className="text-xs">{ticker}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sectors Distribution */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4" />
            توزيع القطاعات
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : stats?.sectors && stats.sectors.length > 0 ? (
            <div className="space-y-2">
              {stats.sectors.map(({ sector, count }) => (
                <div key={sector} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
                  <div className={cn(
                    "w-3 h-3 rounded-full",
                    SECTOR_COLORS[sector] || 'bg-gray-400'
                  )} />
                  <span className="flex-1 text-sm">{sector}</span>
                  <Badge variant="secondary">{count} سهم</Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2" />
              <p>لا توجد قطاعات مسجلة</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
