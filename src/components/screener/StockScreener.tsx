'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Zap,
  Target,
  TrendingUp,
  Thermometer,
  Download,
  BookmarkPlus,
  Search,
  BarChart3,
  Crosshair,
  RefreshCw,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScreenerResult {
  symbol: string;
  name: string;
  market: string;
  price: number;
  score: number;
  reason: string;
  scan_date: string;
}

interface PresetConfig {
  id: string;
  label: string;
  labelEn: string;
  icon: React.ElementType;
  color: string;
  bgActive: string;
  description: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PRESETS: PresetConfig[] = [
  {
    id: 'day_trader',
    label: 'رادار المضارب',
    labelEn: 'Day Trader Radar',
    icon: Zap,
    color: 'text-amber-600 dark:text-amber-400',
    bgActive: 'bg-amber-100 dark:bg-amber-900/30 border-amber-400',
    description: 'أسهم عالية التذبذب مع تقييم فني إيجابي',
  },
  {
    id: 'daily_speculator',
    label: 'المضارب اليومي',
    labelEn: 'Daily Speculator',
    icon: Crosshair,
    color: 'text-violet-600 dark:text-violet-400',
    bgActive: 'bg-violet-100 dark:bg-violet-900/30 border-violet-400',
    description: '6 قواعد: خصم قمة 52 أسبوع + EPS + P/E + توزيعات + حجم',
  },
  {
    id: 'value',
    label: 'صائد القيمة',
    labelEn: 'Value Hunter',
    icon: Target,
    color: 'text-emerald-600 dark:text-emerald-400',
    bgActive: 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-400',
    description: 'أسهم مُقيّمة بأقل من قيمتها الدفترية',
  },
  {
    id: 'momentum',
    label: 'صواريخ الزخم',
    labelEn: 'Momentum Rockets',
    icon: TrendingUp,
    color: 'text-rose-600 dark:text-rose-400',
    bgActive: 'bg-rose-100 dark:bg-rose-900/30 border-rose-400',
    description: 'أسهم صاعدة بقوة مع زخم إيجابي',
  },
  {
    id: 'thermometer',
    label: 'ميزان حرارة السوق',
    labelEn: 'Market Thermometer',
    icon: Thermometer,
    color: 'text-sky-600 dark:text-sky-400',
    bgActive: 'bg-sky-100 dark:bg-sky-900/30 border-sky-400',
    description: 'درجة حرارة السوق بناءً على نسبة الصاعدة/الهابطة',
  },
];

const MARKET_OPTIONS = [
  { value: 'all', label: 'كل الأسواق' },
  { value: 'EGX', label: 'البورصة المصرية (EGX)' },
  { value: 'Tadawul', label: 'تداول (Tadawul)' },
  { value: 'KSE', label: 'بورصة الكويت (KSE)' },
  { value: 'QSE', label: 'بورصة قطر (QSE)' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function getScoreBg(score: number): string {
  if (score >= 70) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-0';
  if (score >= 50) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border-0';
  if (score >= 30) return 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400 border-0';
  return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border-0';
}

function getLabelFromReason(reason: string): { label: string; color: string } | null {
  if (reason.startsWith('فرصة') || reason.startsWith('شراء') || reason.startsWith('السهم')) return { label: 'شراء', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-0' };
  if (reason.startsWith('راقب')) return { label: 'راقب', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border-0' };
  if (reason.startsWith('انتظر')) return { label: 'انتظر', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border-0' };
  return null;
}

/** حساب مدة منذ آخر تحديث */
function getTimeSince(scanDate: string | null): { text: string; isStale: boolean } {
  if (!scanDate) return { text: 'لم يُحسب بعد', isStale: true };
  try {
    const scanTime = new Date(scanDate).getTime();
    const now = Date.now();
    const diffMs = now - scanTime;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffMin < 5) return { text: 'منذ لحظات', isStale: false };
    if (diffMin < 60) return { text: `منذ ${diffMin} دقيقة`, isStale: false };
    if (diffHr < 6) return { text: `منذ ${diffHr} ساعة`, isStale: diffHr > 2 };
    if (diffDay < 2) return { text: `منذ ${diffDay} يوم`, isStale: true };
    return { text: `منذ ${diffDay} أيام`, isStale: true };
  } catch {
    return { text: 'غير معروف', isStale: true };
  }
}

function exportToCSV(results: ScreenerResult[], presetName: string) {
  const headers = ['#', 'Symbol', 'Name', 'Market', 'Price', 'Score', 'Reason'];
  const rows = results.map((r, i) => [
    i + 1,
    r.symbol,
    r.name,
    r.market,
    r.price != null ? r.price.toFixed(2) : '',
    r.score != null ? r.score.toFixed(0) : '',
    `"${(r.reason ?? '').replace(/"/g, '""')}"`,
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `screener_${presetName}_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function saveFilterToLocalStorage(preset: string, market: string) {
  const key = 'screener_saved_filters';
  const saved = JSON.parse(localStorage.getItem(key) || '[]');
  const entry = { preset, market, savedAt: new Date().toISOString() };
  if (!saved.some((f: { preset: string; market: string }) => f.preset === preset && f.market === market)) {
    saved.push(entry);
    localStorage.setItem(key, JSON.stringify(saved));
    toast.success('تم حفظ الفلتر بنجاح');
  } else {
    toast.info('هذا الفلتر محفوظ بالفعل');
  }
}

// ─── Loading Skeleton ───────────────────────────────────────────────────────

function ScreenerSkeleton() {
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex gap-2 flex-wrap">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-32 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-10 w-48 rounded-lg" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// ─── Empty State ────────────────────────────────────────────────────────────

function EmptyState({ preset, isStale, onRefresh }: { preset?: string; isStale?: boolean; onRefresh?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      {isStale ? (
        <AlertTriangle className="w-12 h-12 mb-3 text-amber-500 opacity-40" />
      ) : (
        <Search className="w-12 h-12 mb-3 opacity-20" />
      )}
      <p className="text-sm font-medium mb-1">
        {isStale ? 'البيانات غير محسوبة بعد' : 'لا توجد نتائج'}
      </p>
      <p className="text-xs mb-3">
        {isStale
          ? 'اضغط "تحديث البيانات" لحساب التحليلات وتخزينها'
          : preset
            ? 'لم يتم العثور على أسهم مطابقة لهذا الفلتر'
            : 'اختر فلتراً للبدء في البحث'}
      </p>
      {isStale && onRefresh && (
        <Button variant="outline" size="sm" onClick={onRefresh} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          تحديث البيانات
        </Button>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function StockScreener() {
  const [activePreset, setActivePreset] = useState<string>('day_trader');
  const [market, setMarket] = useState<string>('all');
  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanDate, setScanDate] = useState<string | null>(null);
  const [presetName, setPresetName] = useState<string>('');
  const [isStale, setIsStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchScreener = useCallback(async (preset: string, mkt: string) => {
    if (!preset) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ preset });
      if (mkt && mkt !== 'all') params.set('market', mkt);

      const res = await fetch(`/api/stocks/screener?${params}`);
      const json = await res.json();

      if (json.success) {
        setResults(json.results || []);
        setPresetName(json.preset_name || preset);
        setScanDate(json.scan_date || null);
        setIsStale(json.is_stale || false);
      } else {
        setResults([]);
        setError(json.error || 'فشل في جلب البيانات');
      }
    } catch {
      setResults([]);
      setError('حدث خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on preset or market change
  useEffect(() => {
    fetchScreener(activePreset, market);
  }, [activePreset, market, fetchScreener]);

  /** تحديث البيانات — يحسب كل البريسيت ويخزنها */
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/stocks/screener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market: market !== 'all' ? market : undefined }),
      });
      const json = await res.json();

      if (json.success) {
        toast.success('تم تحديث البيانات بنجاح');
        // Re-fetch from cache
        await fetchScreener(activePreset, market);
      } else {
        toast.error(json.error || 'فشل في تحديث البيانات');
      }
    } catch {
      toast.error('حدث خطأ في التحديث');
    } finally {
      setRefreshing(false);
    }
  };

  const handleExport = () => {
    if (results.length === 0) {
      toast.error('لا توجد بيانات للتصدير');
      return;
    }
    exportToCSV(results, activePreset);
    toast.success('تم تصدير البيانات بنجاح');
  };

  const handleSaveFilter = () => {
    saveFilterToLocalStorage(activePreset, market);
  };

  const currentPreset = PRESETS.find(p => p.id === activePreset);
  const timeSince = getTimeSince(scanDate);

  return (
    <div className="space-y-6 p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">ماسح الأسهم</h1>
          <p className="text-sm text-muted-foreground">
            اكتشف فرص الاستثمار بناءً على استراتيجيات مُعدّة مسبقاً
          </p>
        </div>
        <BarChart3 className="w-8 h-8 text-emerald-600 dark:text-emerald-400 opacity-30" />
      </div>

      {/* Preset Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {PRESETS.map((preset) => {
          const Icon = preset.icon;
          const isActive = activePreset === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => setActivePreset(preset.id)}
              className={cn(
                'flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all duration-200 cursor-pointer',
                isActive
                  ? preset.bgActive
                  : 'border-border/50 bg-card hover:bg-muted/50'
              )}
            >
              <Icon className={cn('w-5 h-5', isActive ? preset.color : 'text-muted-foreground')} />
              <span className={cn(
                'text-xs font-medium text-center leading-tight',
                isActive ? 'text-foreground' : 'text-muted-foreground'
              )}>
                {preset.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active Preset Description */}
      {currentPreset && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <currentPreset.icon className={cn('w-3.5 h-3.5', currentPreset.color)} />
          <span>{currentPreset.description}</span>
        </div>
      )}

      {/* Market Filter + Action Buttons + Data Freshness */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={market} onValueChange={setMarket}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="اختر السوق" />
          </SelectTrigger>
          <SelectContent>
            {MARKET_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={handleExport}
          disabled={loading || results.length === 0}
        >
          <Download className="w-3.5 h-3.5" />
          تصدير CSV
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={handleSaveFilter}
        >
          <BookmarkPlus className="w-3.5 h-3.5" />
          حفظ الفلتر
        </Button>

        {/* 🔥 زرار تحديث البيانات */}
        <Button
          variant={isStale ? 'default' : 'outline'}
          size="sm"
          className={cn('gap-1.5', isStale && 'bg-amber-600 hover:bg-amber-700 text-white')}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
          {refreshing ? 'جاري التحديث...' : 'تحديث البيانات'}
        </Button>

        {/* 🔥 مؤشر آخر تحديث */}
        <div className={cn(
          'flex items-center gap-1.5 text-[10px] mr-auto',
          timeSince.isStale ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
        )}>
          <Clock className="w-3 h-3" />
          <span>{timeSince.text}</span>
          {timeSince.isStale && (
            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 text-[8px] px-1 py-0 border-0">
              قديم
            </Badge>
          )}
        </div>
      </div>

      {/* 🔥 Stale Data Warning */}
      {isStale && !loading && results.length === 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            البيانات مش محسوبة بعد. اضغط &quot;تحديث البيانات&quot; عشان يحسب التحليلات ويخزنها — بعد كده هتلاقيها جاهزة كل ما تفتح الشاشة.
          </p>
        </div>
      )}

      {/* Results Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>
              {presetName || 'النتائج'}
            </span>
            {!loading && results.length > 0 && (
              <Badge variant="secondary" className="text-xs font-normal">
                {results.length} سهم
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <ScreenerSkeleton />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Search className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm font-medium mb-1">خطأ في تحميل البيانات</p>
              <p className="text-xs text-red-500 mb-3">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchScreener(activePreset, market)}
              >
                إعادة المحاولة
              </Button>
            </div>
          ) : results.length === 0 ? (
            <EmptyState preset={activePreset} isStale={isStale} onRefresh={handleRefresh} />
          ) : (
            <div className="max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 [&::-webkit-scrollbar-thumb]:rounded-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-center">#</TableHead>
                    <TableHead>الرمز</TableHead>
                    <TableHead className="hidden sm:table-cell">الاسم</TableHead>
                    <TableHead className="hidden md:table-cell">السوق</TableHead>
                    <TableHead className="text-left">السعر</TableHead>
                    <TableHead className="text-center">التقييم</TableHead>
                    <TableHead className="hidden lg:table-cell">السبب</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.slice(0, 20).map((row, idx) => (
                    <TableRow key={row.symbol} className="cursor-pointer hover:bg-muted/50">
                      <TableCell className="text-center text-muted-foreground text-xs">
                        {idx + 1}
                      </TableCell>
                      <TableCell>
                        <span className="font-bold text-sm text-foreground">
                          {row.symbol}
                        </span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground max-w-[120px] truncate">
                        {row.name}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {row.market}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-left tabular-nums text-sm" dir="ltr">
                        {row.price != null ? row.price.toFixed(2) : '—'}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Badge className={cn('text-[10px] px-1.5 py-0', getScoreBg(row.score))}>
                            {Math.round(row.score)}
                          </Badge>
                          {getLabelFromReason(row.reason) && (
                            <Badge className={cn('text-[9px] px-1 py-0', getLabelFromReason(row.reason)!.color)}>
                              {getLabelFromReason(row.reason)!.label}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground max-w-[200px] truncate">
                        {row.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
