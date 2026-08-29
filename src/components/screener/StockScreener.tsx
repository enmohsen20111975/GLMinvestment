'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Activity, TrendingUp, TrendingDown, RefreshCw, Download, Filter,
  Zap, Target, Search, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScreenerStock {
  symbol: string;
  name: string;
  market: string;
  price: number;
  change_percent?: number;
  score: number;
  reason: string;
}

interface PresetInfo {
  id: string;
  name_ar: string;
  name_en: string;
  description: string;
  icon: string;
}

interface ScreenerPresetsResponse {
  success: boolean;
  presets: PresetInfo[];
  error?: string;
  hint?: string;
}

interface ScreenerScanResponse {
  success: boolean;
  preset: string;
  preset_name: string;
  count: number;
  scan_date: string | null;
  results: ScreenerStock[];
  error?: string;
  hint?: string;
}

// ─── Format Helpers ──────────────────────────────────────────────────────────

function formatNumber(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || isNaN(n as number)) return '—';
  return (n as number).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

function getChangeColor(change: number | undefined): string {
  if (change === undefined || change === null) return 'text-muted-foreground';
  if (change > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (change < 0) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

function getScoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 50) return 'text-amber-600 dark:text-amber-400';
  if (score >= 30) return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function StockScreener() {
  // Filter state
  const [preset, setPreset] = useState<string>('momentum');
  const [market, setMarket] = useState('EGX');
  const [limit, setLimit] = useState(50);
  const [searchQuery, setSearchQuery] = useState('');

  // Data state
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [stocks, setStocks] = useState<ScreenerStock[]>([]);
  const [scanDate, setScanDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // === Fetch available presets (Python: /api/screener/presets) ===
  const fetchPresets = useCallback(async () => {
    try {
      const res = await fetch('/api/stocks/screener', { cache: 'no-store' });
      const json: ScreenerPresetsResponse = await res.json();
      if (json.success && json.presets) {
        setPresets(json.presets);
      }
    } catch (e) {
      console.error('[StockScreener] fetchPresets failed:', e);
    }
  }, []);

  // === Fetch screener results (Python: /api/screener/scan?preset=...) ===
  const fetchScreener = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        preset,
        market,
        limit: String(limit),
      });
      const res = await fetch(`/api/stocks/screener?${params}`, { cache: 'no-store' });
      const json: ScreenerScanResponse = await res.json();

      if (json.success) {
        setStocks(json.results || []);
        setScanDate(json.scan_date);
      } else {
        setError(json.error || json.hint || 'فشل تحميل البيانات');
        setStocks([]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'خطأ في الاتصال';
      setError(msg);
      setStocks([]);
    } finally {
      setLoading(false);
    }
  }, [preset, market, limit]);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  useEffect(() => {
    fetchScreener();
  }, [fetchScreener]);

  // Client-side search filter
  const filteredStocks = useMemo(() => {
    if (!searchQuery.trim()) return stocks;
    const q = searchQuery.toUpperCase();
    return stocks.filter(s =>
      s.symbol.includes(q) ||
      (s.name && s.name.toUpperCase().includes(q))
    );
  }, [stocks, searchQuery]);

  // Export to CSV
  const exportCSV = () => {
    const headers = ['Symbol', 'Name', 'Market', 'Price', 'Change%', 'Score', 'Reason'];
    const rows = filteredStocks.map(s => [
      s.symbol, s.name, s.market,
      s.price, s.change_percent ?? '', s.score, s.reason,
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screener_${preset}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`تم تصدير ${filteredStocks.length} سهم`);
  };

  return (
    <div className="space-y-4 p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-600" />
            ماسح الأسهم — فلترة بالـ Presets
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            فلترة الأسهم بـ presets جاهزة (الـ logic كله في Python — Node للعرض فقط)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!filteredStocks.length} className="gap-1.5">
            <Download className="w-3.5 h-3.5" />
            تصدير CSV
          </Button>
          <Button variant="outline" size="sm" onClick={fetchScreener} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            تحديث
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="w-4 h-4" />
            الفلاتر
            {scanDate && (
              <Badge variant="outline" className="text-xs">
                آخر scan: {scanDate}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {/* Preset */}
            <div className="col-span-2 sm:col-span-1">
              <Label className="text-xs">الـ Preset</Label>
              <Select value={preset} onValueChange={setPreset}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {presets.length === 0 ? (
                    <SelectItem value="momentum">صواريخ الزخم (افتراضي)</SelectItem>
                  ) : (
                    presets.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.icon} {p.name_ar}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Market */}
            <div>
              <Label className="text-xs">السوق</Label>
              <Select value={market} onValueChange={setMarket}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EGX">البورصة المصرية</SelectItem>
                  <SelectItem value="Tadawul">السعودية</SelectItem>
                  <SelectItem value="Kuwait">الكويت</SelectItem>
                  <SelectItem value="Qatar">قطر</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Limit */}
            <div>
              <Label className="text-xs">عدد النتائج</Label>
              <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Preset description */}
          {presets.find(p => p.id === preset) && (
            <div className="mt-3 text-xs text-muted-foreground p-2 rounded bg-muted/30 border border-muted/30">
              {presets.find(p => p.id === preset)?.icon}{' '}
              <span className="font-medium">{presets.find(p => p.id === preset)?.name_ar}:</span>{' '}
              {presets.find(p => p.id === preset)?.description}
            </div>
          )}

          {/* Search */}
          <div className="mt-3">
            <div className="relative">
              <Search className="absolute right-2 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالاسم أو الرمز..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-8 h-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">إجمالي النتائج</div>
            <div className="text-xl font-bold">{filteredStocks.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">أعلى score</div>
            <div className="text-xl font-bold text-emerald-600">
              {filteredStocks.length > 0 ? Math.max(...filteredStocks.map(s => s.score)).toFixed(0) : '—'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">متوسط score</div>
            <div className="text-xl font-bold text-amber-600">
              {filteredStocks.length > 0
                ? (filteredStocks.reduce((s, r) => s + r.score, 0) / filteredStocks.length).toFixed(0)
                : '—'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Preset</div>
            <div className="text-xl font-bold">
              {presets.find(p => p.id === preset)?.name_ar || preset}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
              جاري تحميل النتائج من Python backend...
            </div>
          ) : error ? (
            <div className="p-8 text-center text-red-600">
              <AlertTriangle className="w-6 h-6 mx-auto mb-2" />
              {error}
              <div className="text-xs text-muted-foreground mt-2">
                تأكد أن Python backend يعمل على port 8010 (محتاج: <code className="font-mono">/api/screener/scan?preset={preset}</code>)
              </div>
              <Button variant="outline" size="sm" onClick={fetchScreener} className="mt-3">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> إعادة المحاولة
              </Button>
            </div>
          ) : filteredStocks.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Search className="w-6 h-6 mx-auto mb-2 opacity-50" />
              لا توجد نتائج مطابقة. جرّب preset آخر أو شغّل <code className="font-mono">/api/screener/run-all</code>.
            </div>
          ) : (
            <div className="max-h-[600px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="text-right">السهم</TableHead>
                    <TableHead className="text-right">السعر</TableHead>
                    <TableHead className="text-right">التغير</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="text-right">السبب</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStocks.map((s) => (
                    <TableRow key={s.symbol} className="hover:bg-muted/50">
                      <TableCell>
                        <div className="font-mono font-bold text-sm">{s.symbol}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                          {s.name}
                        </div>
                        <div className="text-xs text-muted-foreground">{s.market}</div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {formatNumber(s.price)}
                      </TableCell>
                      <TableCell className={cn('font-mono text-sm font-medium', getChangeColor(s.change_percent))}>
                        {s.change_percent !== undefined
                          ? `${s.change_percent > 0 ? '+' : ''}${formatNumber(s.change_percent)}%`
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className={cn('font-mono text-sm font-bold', getScoreColor(s.score))}>
                            {s.score.toFixed(0)}
                          </span>
                          <div className="w-12 h-1.5 bg-muted rounded overflow-hidden">
                            <div
                              className={cn(
                                'h-full',
                                s.score >= 70 ? 'bg-emerald-500' :
                                s.score >= 50 ? 'bg-amber-500' :
                                s.score >= 30 ? 'bg-orange-500' : 'bg-red-500'
                              )}
                              style={{ width: `${Math.min(100, s.score)}%` }}
                            />
                          </div>
                          {s.score >= 70 && <Target className="w-3 h-3 text-emerald-500" />}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[280px]">
                        {s.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer hint */}
      <div className="text-xs text-muted-foreground text-center p-2">
        📡 البيانات من Python backend — الـ logic كله في <code className="font-mono">vps-service/analyzers/screener.py</code> (5 presets)
        • Node = عرض فقط (Rule 20)
      </div>
    </div>
  );
}
