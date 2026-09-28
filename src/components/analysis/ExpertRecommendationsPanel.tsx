'use client';

/**
 * ExpertRecommendationsPanel
 * لوحة إدخال توقعات الخبراء — وضعان:
 *  1) جدول (Table mode): إدخال يدوي صف بصف.
 *  2) نص كامل (Full text mode): لصق نص عربي من واتساب ثم تحليله بالذكاء الاصطناعي واستيراده.
 *
 * أسفل الوضعين: قائمة "التوقعات المحفوظة" مع فلترة وبحث وتفاصيل قابلة للتوسيع.
 *
 * التركيب: داخل تبويب "توقعات الخبراء" في MarketAnalysisView.
 * لا يستخدم ألوان indigo/blue — اللمسة الأساسية emerald/teal.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { UnifiedPublishButton } from '@/components/shared/UnifiedPublishButton';
import { StockPublisher, type StockPublishData } from '@/components/shared/StockPublisher';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { MarketType, MARKET_NAMES_AR } from '@/lib/store';
import {
  Plus,
  Trash2,
  RefreshCw,
  Search,
  Sparkles,
  Loader2,
  Calendar,
  User,
  MessageSquare,
  ClipboardList,
  ChevronLeft,
  TrendingUp,
  TrendingDown,
  Target,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Upload,
  FileText,
  ListChecks,
  Filter,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface TableRec {
  stock_symbol: string;
  stock_name_ar: string;
  entry_price: string;
  target_price: string;
  target_price_2: string;
  stop_loss: string;
  support_level: string;
  resistance_level: string;
  action: string; // BUY | SELL | HOLD
  recommendation_reason: string;
}

/** الشكل الذي يرجعه /api/parse-recommendations */
interface ParsedTextRec {
  seq: string;
  stock: string;
  code: string;
  type: string;
  buyPrice: string;
  target1: string;
  target2: string;
  target3: string;
  stopLoss: string;
  support: string;
  resistance: string;
  expectedReturn: string;
  status: string;
  notes: string;
  date: string;
}

/** الشكل الذي يقبله /api/expert-recommendations/import في مصفوفة recommendations */
interface ImportRec {
  stock_symbol: string;
  stock_name_ar?: string;
  entry_price: number;
  entry_price_from?: number;
  entry_price_to?: number;
  target_price?: number;
  target_price_2?: number;
  support_level?: number;
  resistance_level?: number;
  expected_profit_min?: number;
  expected_profit_max?: number;
  stop_loss?: number;
  technical_analysis?: string;
  fundamental_analysis?: string;
  recommendation_reason?: string;
  action?: string;
  expected_duration?: string;
  expected_duration_days?: number;
}

interface StoredRec {
  id: string;
  stock_symbol: string;
  stock_name_ar?: string;
  expert_name: string;
  expert_source?: string;
  action: string;
  entry_price: number;
  target_price?: number;
  target_price_2?: number;
  stop_loss?: number;
  support_level?: number;
  resistance_level?: number;
  expected_profit_min?: number;
  expected_profit_max?: number;
  status: string;
  session_date?: string;
  session_type?: string;
  technical_analysis?: string;
  fundamental_analysis?: string;
  recommendation_reason?: string;
  expected_duration?: string;
  created_at?: string;
}

// ============================================================================
// UnifiedTable types & static columns (module-level)
// ============================================================================

type TableRecWithIdx = TableRec & { _idx: number };

const parsedRecColumns: Column<ParsedTextRec>[] = [
  {
    key: 'seq',
    header: '#',
    align: 'right',
    className: 'text-xs text-muted-foreground',
    render: (p) => p.seq || '—',
  },
  {
    key: 'stock',
    header: 'السهم',
    className: 'text-xs font-medium',
    render: (p) => p.stock || '—',
  },
  {
    key: 'code',
    header: 'الرمز',
    className: 'text-xs font-mono font-bold text-emerald-700',
    filterable: true,
    render: (p) => p.code || '—',
  },
  {
    key: 'buyPrice',
    header: 'الدخول',
    align: 'right',
    className: 'text-xs',
    render: (p) => p.buyPrice || '—',
  },
  {
    key: 'targets',
    header: 'الأهداف',
    align: 'right',
    className: 'text-xs',
    render: (p) =>
      [p.target1, p.target2, p.target3].filter(Boolean).join(' ← ') || '—',
  },
  {
    key: 'stopLoss',
    header: 'الوقف',
    align: 'right',
    className: 'text-xs text-rose-600',
    render: (p) => p.stopLoss || '—',
  },
  {
    key: 'support',
    header: 'الدعم',
    align: 'right',
    className: 'text-xs',
    render: (p) => p.support || '—',
  },
  {
    key: 'resistance',
    header: 'المقاومة',
    align: 'right',
    className: 'text-xs',
    render: (p) => p.resistance || '—',
  },
  {
    key: 'type',
    header: 'النوع',
    align: 'right',
    className: 'text-xs',
    filterable: true,
    render: (p) => p.type || '—',
  },
  {
    key: 'notes',
    header: 'ملاحظات',
    align: 'right',
    className: 'text-xs max-w-[200px] truncate',
    render: (p) => (
      <span className="block max-w-[200px] truncate" title={p.notes}>
        {p.notes || '—'}
      </span>
    ),
  },
];

const storedRecColumns: Column<StoredRec>[] = [
  {
    key: 'session_date',
    header: 'التاريخ',
    align: 'right',
    sortable: true,
    className: 'text-xs whitespace-nowrap text-muted-foreground',
    render: (r) => r.session_date || r.created_at?.slice(0, 10) || '—',
  },
  {
    key: 'expert_name',
    header: 'الخبير',
    align: 'right',
    sortable: true,
    filterable: true,
    className: 'text-xs whitespace-nowrap',
    render: (r) => r.expert_name || '—',
  },
  {
    key: 'stock_symbol',
    header: 'السهم',
    align: 'right',
    sortable: true,
    filterable: true,
    render: (r) => (
      <div className="flex items-center gap-1">
        <div className="flex flex-col">
          <span className="font-mono font-bold text-emerald-700">
            {r.stock_symbol}
          </span>
          {r.stock_name_ar && (
            <span className="text-[10px] text-muted-foreground">
              {r.stock_name_ar}
            </span>
          )}
        </div>
        {r.stock_symbol && (
          <StockPublisher
            data={{
              ticker: r.stock_symbol,
              nameAr: r.stock_name_ar || undefined,
              currentPrice: Number(r.entry_price ?? 0) || 0,
              entryPrice: Number(r.entry_price ?? 0) || undefined,
              targetPrice1: Number(r.target_price ?? 0) || undefined,
              targetPrice2: Number(r.target_price_2 ?? 0) || undefined,
              stopLoss: Number(r.stop_loss ?? 0) || undefined,
              recommendation:
                r.action === 'BUY' ? 'BUY' :
                r.action === 'SELL' ? 'SELL' :
                r.action === 'HOLD' ? 'HOLD' : undefined,
            }}
            variant="icon"
            size="sm"
          />
        )}
      </div>
    ),
  },
  {
    key: 'action',
    header: 'الإجراء',
    align: 'right',
    filterable: true,
    render: (r) => actionBadge(r.action),
  },
  {
    key: 'entry_price',
    header: 'الدخول',
    align: 'right',
    sortable: true,
    className: 'text-xs font-mono',
    render: (r) => fmtNum(r.entry_price),
  },
  {
    key: 'target_price',
    header: 'الهدف',
    align: 'right',
    className: 'text-xs font-mono text-emerald-700',
    render: (r) =>
      `${fmtNum(r.target_price)}${r.target_price_2 ? ` ← ${fmtNum(r.target_price_2)}` : ''}`,
  },
  {
    key: 'stop_loss',
    header: 'الوقف',
    align: 'right',
    className: 'text-xs font-mono text-rose-600',
    render: (r) => fmtNum(r.stop_loss),
  },
  {
    key: 'status',
    header: 'الحالة',
    align: 'right',
    filterable: true,
    render: (r) => statusBadge(r.status),
  },
  {
    key: 'recommendation_reason',
    header: 'السبب',
    align: 'right',
    className: 'text-xs max-w-[180px] truncate text-muted-foreground',
    render: (r) => (
      <span className="block max-w-[180px] truncate" title={r.recommendation_reason || ''}>
        {r.recommendation_reason || '—'}
      </span>
    ),
  },
  {
    key: '_chevron',
    header: '',
    align: 'right',
    className: 'text-xs',
    render: () => <ChevronLeft className="w-4 h-4 text-muted-foreground" />,
  },
];

// ============================================================================
// Helpers
// ============================================================================

function todayISO(): string {
  try {
    return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function parseNum(s: string | undefined | null): number | undefined {
  if (s == null) return undefined;
  const trimmed = String(s).trim();
  if (!trimmed) return undefined;
  // Pick first numeric chunk (handles "1.5 جنيه", "1.5-1.6", etc.)
  const m = trimmed.match(/-?\d+(?:\.\d+)?/);
  if (!m) return undefined;
  const n = parseFloat(m[0]);
  return isNaN(n) ? undefined : n;
}

function parseRange(s: string | undefined | null): { from?: number; to?: number } {
  if (!s) return {};
  const matches = String(s).match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return {};
  if (matches.length === 1) {
    const n = parseFloat(matches[0]);
    return { from: n, to: n };
  }
  return { from: parseFloat(matches[0]), to: parseFloat(matches[1]) };
}

function fmtNum(n: number | undefined | null, digits = 2): string {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function actionBadge(action: string) {
  const a = (action || 'BUY').toUpperCase();
  if (a === 'SELL') {
    return (
      <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 border-rose-200">
        <TrendingDown className="w-3 h-3 ml-1" />
        بيع
      </Badge>
    );
  }
  if (a === 'HOLD') {
    return (
      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200">
        <Clock className="w-3 h-3 ml-1" />
        انتظار
      </Badge>
    );
  }
  return (
    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200">
      <TrendingUp className="w-3 h-3 ml-1" />
      شراء
    </Badge>
  );
}

function statusBadge(status: string) {
  const s = (status || 'PENDING').toUpperCase();
  if (s === 'TARGET_HIT') {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200">
        <CheckCircle2 className="w-3 h-3 ml-1" />
        ضرب الهدف
      </Badge>
    );
  }
  if (s === 'STOPPED') {
    return (
      <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 border-rose-200">
        <AlertTriangle className="w-3 h-3 ml-1" />
        ضرب الوقف
      </Badge>
    );
  }
  if (s === 'EXPIRED' || s === 'CLOSED') {
    return (
      <Badge className="bg-zinc-200 text-zinc-700 hover:bg-zinc-200 border-zinc-300">
        <Clock className="w-3 h-3 ml-1" />
        منتهية
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200">
      <Clock className="w-3 h-3 ml-1" />
      قيد التنفيذ
    </Badge>
  );
}

function emptyRow(): TableRec {
  return {
    stock_symbol: '',
    stock_name_ar: '',
    entry_price: '',
    target_price: '',
    target_price_2: '',
    stop_loss: '',
    support_level: '',
    resistance_level: '',
    action: 'BUY',
    recommendation_reason: '',
  };
}

/** خريطة لتطبيق الوضع الافتراضي للسوق على اسم المصدر */
function defaultSourceForMarket(market: MarketType): string {
  switch (market) {
    case 'EGX':
      return 'مباشر للأوراق المالية';
    case 'TADAWUL':
      return 'تداول السعودية';
    case 'KSE':
      return 'بورصة الكويت';
    case 'QSE':
      return 'بورصة قطر';
    default:
      return 'مباشر للأوراق المالية';
  }
}

// ============================================================================
// Component
// ============================================================================

export function ExpertRecommendationsPanel({ market }: { market: MarketType }) {
  const [mode, setMode] = useState<'table' | 'text'>('table');

  // Common inputs
  const [sessionDate, setSessionDate] = useState<string>(todayISO());
  const [sessionType, setSessionType] = useState<string>('صباحية');
  const [expertName, setExpertName] = useState<string>('');
  const [expertSource, setExpertSource] = useState<string>(defaultSourceForMarket(market));

  // Table mode state
  const [rows, setRows] = useState<TableRec[]>([emptyRow(), emptyRow()]);
  const [importingTable, setImportingTable] = useState(false);

  // Text mode state
  const [rawText, setRawText] = useState<string>('');
  const [parsedRecs, setParsedRecs] = useState<ParsedTextRec[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Stored recommendations
  const [stored, setStored] = useState<StoredRec[]>([]);
  const [storedLoading, setStoredLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchSymbol, setSearchSymbol] = useState<string>('');
  const [selectedRec, setSelectedRec] = useState<StoredRec | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Reset defaults when market changes
  useEffect(() => {
    setExpertSource(defaultSourceForMarket(market));
  }, [market]);

  // ========================================================================
  // Table mode handlers
  // ========================================================================

  const updateRow = (idx: number, field: keyof TableRec, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const buildImportFromTable = (): ImportRec[] => {
    const out: ImportRec[] = [];
    for (const r of rows) {
      const sym = r.stock_symbol.trim().toUpperCase();
      if (!sym) continue;
      const entry = parseNum(r.entry_price);
      if (entry == null || entry <= 0) continue;
      out.push({
        stock_symbol: sym,
        stock_name_ar: r.stock_name_ar.trim() || undefined,
        entry_price: entry,
        target_price: parseNum(r.target_price),
        target_price_2: parseNum(r.target_price_2),
        stop_loss: parseNum(r.stop_loss),
        support_level: parseNum(r.support_level),
        resistance_level: parseNum(r.resistance_level),
        action: r.action || 'BUY',
        recommendation_reason: r.recommendation_reason.trim() || undefined,
      });
    }
    return out;
  };

  const handleTableImport = async () => {
    if (!expertName.trim()) {
      toast.error('اكتب اسم الخبير أولًا');
      return;
    }
    if (!sessionDate) {
      toast.error('اختر تاريخ الجلسة');
      return;
    }
    const recs = buildImportFromTable();
    if (recs.length === 0) {
      toast.error('لا توجد صفوف صالحة للاستيراد — تأكد من إدخال رمز السهم وسعر الدخول');
      return;
    }
    setImportingTable(true);
    try {
      const res = await fetch('/api/expert-recommendations/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_date: sessionDate,
          session_type: sessionType,
          expert_name: expertName.trim(),
          expert_source: expertSource.trim() || 'manual',
          recommendations: recs,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل الاستيراد');
      }
      const imported = data.imported ?? recs.length;
      const errs: string[] = data.errors || [];
      toast.success(`تم استيراد ${imported} توقع بنجاح`);
      if (errs.length > 0) {
        toast.warning(`${errs.length} صف تم تخطيه`);
      }
      // Clear table
      setRows([emptyRow(), emptyRow()]);
      // Refresh stored
      fetchStored();
    } catch (e) {
      toast.error('خطأ في الاستيراد: ' + String(e));
    } finally {
      setImportingTable(false);
    }
  };

  // ========================================================================
  // Text mode handlers
  // ========================================================================

  const handleParse = async () => {
    if (!rawText.trim()) {
      toast.error('الصق النص أولًا');
      return;
    }
    setParsing(true);
    setParsedRecs(null);
    try {
      const res = await fetch('/api/parse-recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawText, format: 'json' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل التحليل');
      }
      const recs: ParsedTextRec[] = data.recommendations || [];
      setParsedRecs(recs);
      if (recs.length === 0) {
        toast.info('لم يتم العثور على توقعات في النص — تأكد من التنسيق');
      } else {
        toast.success(`تم تحليل ${recs.length} توقع من النص`);
      }
    } catch (e) {
      toast.error('خطأ في التحليل: ' + String(e));
    } finally {
      setParsing(false);
    }
  };

  const buildImportFromParsed = (): ImportRec[] => {
    if (!parsedRecs) return [];
    const out: ImportRec[] = [];
    for (const p of parsedRecs) {
      const sym = (p.code || '').trim().toUpperCase();
      if (!sym) continue;
      // entry_price: من buyPrice أو الدعم كاحتياط
      let entry = parseNum(p.buyPrice);
      if (entry == null) entry = parseNum(p.support);
      if (entry == null || entry <= 0) continue;

      const range = parseRange(p.buyPrice);
      out.push({
        stock_symbol: sym,
        stock_name_ar: p.stock?.trim() || undefined,
        entry_price: entry,
        entry_price_from: range.from,
        entry_price_to: range.to,
        target_price: parseNum(p.target1),
        target_price_2: parseNum(p.target2),
        stop_loss: parseNum(p.stopLoss),
        support_level: parseNum(p.support),
        resistance_level: parseNum(p.resistance),
        action: 'BUY',
        recommendation_reason:
          [p.type, p.notes].filter(Boolean).join(' — ') || undefined,
        expected_duration: p.expectedReturn || undefined,
      });
    }
    return out;
  };

  const handleConfirmImport = async () => {
    if (!expertName.trim()) {
      toast.error('اكتب اسم الخبير أولًا');
      return;
    }
    if (!sessionDate) {
      toast.error('اختر تاريخ الجلسة');
      return;
    }
    const recs = buildImportFromParsed();
    if (recs.length === 0) {
      toast.error('لا توجد توقعات قابلة للاستيراد بعد التحليل');
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch('/api/expert-recommendations/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_date: sessionDate,
          session_type: sessionType,
          expert_name: expertName.trim(),
          expert_source: expertSource.trim() || 'manual',
          recommendations: recs,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل الاستيراد');
      }
      const imported = data.imported ?? recs.length;
      toast.success(`تم استيراد ${imported} توقع من النص المحلَّل`);
      // Reset text mode
      setRawText('');
      setParsedRecs(null);
      // Refresh stored
      fetchStored();
    } catch (e) {
      toast.error('خطأ في الاستيراد: ' + String(e));
    } finally {
      setConfirming(false);
    }
  };

  // ========================================================================
  // Stored recommendations
  // ========================================================================

  const fetchStored = useCallback(async () => {
    setStoredLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (statusFilter !== 'all') {
        if (statusFilter === 'PENDING') {
          params.set('status', 'PENDING');
        } else if (statusFilter === 'closed') {
          // closed = not pending; we'll filter client-side below because API only filters exact status
        }
      }
      const res = await fetch(`/api/expert-recommendations?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      const list: StoredRec[] = data.recommendations || data.data || [];
      setStored(list);
    } catch (e) {
      console.error('fetchStored error', e);
      setStored([]);
    } finally {
      setStoredLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchStored();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredStored = useMemo(() => {
    let list = stored;
    if (statusFilter === 'PENDING') {
      list = list.filter((r) => (r.status || 'PENDING').toUpperCase() === 'PENDING');
    } else if (statusFilter === 'closed') {
      list = list.filter(
        (r) => (r.status || 'PENDING').toUpperCase() !== 'PENDING',
      );
    }
    const q = searchSymbol.trim().toUpperCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.stock_symbol?.toUpperCase().includes(q) ||
          r.stock_name_ar?.includes(searchSymbol.trim()),
      );
    }
    return list;
  }, [stored, statusFilter, searchSymbol]);

  const openDetails = (rec: StoredRec) => {
    setSelectedRec(rec);
    setSheetOpen(true);
  };

  // ========================================================================
  // UnifiedTable — editable grid columns + data with _idx
  // ========================================================================

  const rowsWithIdx: TableRecWithIdx[] = rows.map((r, i) => ({ ...r, _idx: i }));

  const tableEditorColumns: Column<TableRecWithIdx>[] = [
    {
      key: '_idx',
      header: '#',
      align: 'right',
      className: 'text-xs text-muted-foreground',
      render: (r) => r._idx + 1,
    },
    {
      key: 'stock_symbol',
      header: 'الرمز',
      render: (r) => (
        <Input
          value={r.stock_symbol}
          onChange={(e) => updateRow(r._idx, 'stock_symbol', e.target.value)}
          placeholder="COMI"
          className="h-9 w-24 font-mono"
        />
      ),
    },
    {
      key: 'stock_name_ar',
      header: 'الاسم (عربي)',
      render: (r) => (
        <Input
          value={r.stock_name_ar}
          onChange={(e) => updateRow(r._idx, 'stock_name_ar', e.target.value)}
          placeholder="التعمير"
          className="h-9 w-32"
        />
      ),
    },
    {
      key: 'entry_price',
      header: 'سعر الدخول',
      align: 'right',
      render: (r) => (
        <Input
          type="number"
          inputMode="decimal"
          value={r.entry_price}
          onChange={(e) => updateRow(r._idx, 'entry_price', e.target.value)}
          placeholder="1.91"
          className="h-9 w-20"
        />
      ),
    },
    {
      key: 'target_price',
      header: 'الهدف ١',
      align: 'right',
      render: (r) => (
        <Input
          type="number"
          inputMode="decimal"
          value={r.target_price}
          onChange={(e) => updateRow(r._idx, 'target_price', e.target.value)}
          placeholder="2.20"
          className="h-9 w-20"
        />
      ),
    },
    {
      key: 'target_price_2',
      header: 'الهدف ٢',
      align: 'right',
      render: (r) => (
        <Input
          type="number"
          inputMode="decimal"
          value={r.target_price_2}
          onChange={(e) => updateRow(r._idx, 'target_price_2', e.target.value)}
          placeholder="2.50"
          className="h-9 w-20"
        />
      ),
    },
    {
      key: 'stop_loss',
      header: 'وقف الخسارة',
      align: 'right',
      render: (r) => (
        <Input
          type="number"
          inputMode="decimal"
          value={r.stop_loss}
          onChange={(e) => updateRow(r._idx, 'stop_loss', e.target.value)}
          placeholder="1.75"
          className="h-9 w-20"
        />
      ),
    },
    {
      key: 'support_level',
      header: 'الدعم',
      align: 'right',
      render: (r) => (
        <Input
          type="number"
          inputMode="decimal"
          value={r.support_level}
          onChange={(e) => updateRow(r._idx, 'support_level', e.target.value)}
          placeholder="1.80"
          className="h-9 w-20"
        />
      ),
    },
    {
      key: 'resistance_level',
      header: 'المقاومة',
      align: 'right',
      render: (r) => (
        <Input
          type="number"
          inputMode="decimal"
          value={r.resistance_level}
          onChange={(e) => updateRow(r._idx, 'resistance_level', e.target.value)}
          placeholder="2.00"
          className="h-9 w-20"
        />
      ),
    },
    {
      key: 'action',
      header: 'الإجراء',
      align: 'right',
      render: (r) => (
        <Select
          value={r.action}
          onValueChange={(v) => updateRow(r._idx, 'action', v)}
        >
          <SelectTrigger className="h-9 w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BUY">شراء</SelectItem>
            <SelectItem value="SELL">بيع</SelectItem>
            <SelectItem value="HOLD">انتظار</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
    {
      key: 'recommendation_reason',
      header: 'ملاحظات',
      align: 'right',
      render: (r) => (
        <Input
          value={r.recommendation_reason}
          onChange={(e) => updateRow(r._idx, 'recommendation_reason', e.target.value)}
          placeholder="اختراق مقاومة..."
          className="h-9 w-40"
        />
      ),
    },
    {
      key: '_delete',
      header: 'حذف',
      align: 'center',
      render: (r) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => { e.stopPropagation(); removeRow(r._idx); }}
          disabled={rows.length <= 1}
          className="h-9 w-9 p-0 text-rose-600 hover:bg-rose-50"
          aria-label="حذف الصف"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      ),
    },
  ];

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <div dir="rtl" className="space-y-4 text-right">
      {/* Header */}
      <Card className="border-emerald-200/60 bg-gradient-to-l from-emerald-50/60 to-transparent">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2 text-emerald-800">
                <ClipboardList className="w-5 h-5" />
                توقعات الخبراء — {MARKET_NAMES_AR[market]}
              </CardTitle>
              <CardDescription>
                أدخل توقعات الخبراء يدويًا (جدول) أو انسخها من نص عربي (واتساب/تيليجرام)
                ودع الذكاء الاصطناعي يحللها ويستوردها. هذه التوقعات تغيّر تفكير الآلة عبر
                وكيل آخر على الباك إند.
              </CardDescription>
            </div>
            <UnifiedPublishButton
              variant="outline"
              size="sm"
              title="توقعات الخبراء"
              content={`توقعات الخبراء — ${MARKET_NAMES_AR[market]}\nالخبير: ${expertName || '—'} — ${sessionDate} (${sessionType})\n\n${filteredStored.slice(0, 20).map((r, i) => `${i + 1}. ${r.stock_symbol} — ${r.action === 'SELL' ? 'بيع' : r.action === 'HOLD' ? 'انتظار' : 'شراء'} — دخول ${fmtNum(r.entry_price)} — هدف ${fmtNum(r.target_price)}${r.target_price_2 ? ` ← ${fmtNum(r.target_price_2)}` : ''} — وقف ${fmtNum(r.stop_loss)}`).join('\n')}`}
              filename={`expert-recs-${market}-${Date.now()}`}
              hashtags={['توقعات', 'خبراء', MARKET_NAMES_AR[market]]}
              triggerLabel="نشر"
            />
          </div>
        </CardHeader>
      </Card>

      {/* Common meta inputs */}
      <Card>
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="er-session-date" className="flex items-center gap-1 text-xs">
              <Calendar className="w-3.5 h-3.5" />
              تاريخ الجلسة
            </Label>
            <Input
              id="er-session-date"
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="er-session-type" className="flex items-center gap-1 text-xs">
              <Clock className="w-3.5 h-3.5" />
              نوع الجلسة
            </Label>
            <Select value={sessionType} onValueChange={setSessionType}>
              <SelectTrigger id="er-session-type" className="h-11">
                <SelectValue placeholder="اختر النوع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="صباحية">صباحية</SelectItem>
                <SelectItem value="مسائية">مسائية</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="er-expert-name" className="flex items-center gap-1 text-xs">
              <User className="w-3.5 h-3.5" />
              اسم الخبير
            </Label>
            <Input
              id="er-expert-name"
              placeholder="مثال: أ/ ريمون رؤوف"
              value={expertName}
              onChange={(e) => setExpertName(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="er-expert-source" className="flex items-center gap-1 text-xs">
              <FileText className="w-3.5 h-3.5" />
              المصدر
            </Label>
            <Input
              id="er-expert-source"
              placeholder="مثال: مباشر للأوراق المالية"
              value={expertSource}
              onChange={(e) => setExpertSource(e.target.value)}
              className="h-11"
            />
          </div>
        </CardContent>
      </Card>

      {/* Mode tabs */}
      <Tabs value={mode} onValueChange={(v) => setMode(v as 'table' | 'text')}>
        <TabsList className="grid w-full grid-cols-2 h-auto">
          <TabsTrigger value="table" className="flex items-center gap-1.5 py-2.5">
            <ListChecks className="w-4 h-4" />
            <span>جدول</span>
          </TabsTrigger>
          <TabsTrigger value="text" className="flex items-center gap-1.5 py-2.5">
            <MessageSquare className="w-4 h-4" />
            <span>نص كامل</span>
          </TabsTrigger>
        </TabsList>

        {/* =================== TABLE MODE =================== */}
        <TabsContent value="table" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <ListChecks className="w-4 h-4 text-emerald-600" />
                  إدخال جدول التوقعات
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addRow}
                  className="h-9 gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                >
                  <Plus className="w-4 h-4" />
                  إضافة صف
                </Button>
              </CardTitle>
              <CardDescription>
                أدخل كل سهم في صف مستقل. الحقول الإلزامية: رمز السهم وسعر الدخول.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 sm:p-2">
              {/* Desktop: UnifiedTable; Mobile: stacked cards */}
              <div className="hidden lg:block">
                <UnifiedTable<TableRecWithIdx>
                  columns={tableEditorColumns}
                  data={rowsWithIdx}
                  keyField="_idx"
                  dense
                  className="border-emerald-100"
                  rowClassName={() => 'hover:bg-emerald-50/30'}
                  emptyTextAr="أضف صفًا لإدخال التوقعات"
                />
              </div>

              {/* Mobile stacked cards */}
              <div className="lg:hidden space-y-3 p-2">
                {rows.map((r, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">توقع #{idx + 1}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeRow(idx)}
                        disabled={rows.length <= 1}
                        className="h-8 w-8 p-0 text-rose-600 hover:bg-rose-50"
                        aria-label="حذف الصف"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px]">الرمز</Label>
                        <Input
                          value={r.stock_symbol}
                          onChange={(e) => updateRow(idx, 'stock_symbol', e.target.value)}
                          placeholder="COMI"
                          className="h-10 font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">الإجراء</Label>
                        <Select value={r.action} onValueChange={(v) => updateRow(idx, 'action', v)}>
                          <SelectTrigger className="h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="BUY">شراء</SelectItem>
                            <SelectItem value="SELL">بيع</SelectItem>
                            <SelectItem value="HOLD">انتظار</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label className="text-[10px]">الاسم (عربي)</Label>
                        <Input
                          value={r.stock_name_ar}
                          onChange={(e) => updateRow(idx, 'stock_name_ar', e.target.value)}
                          placeholder="التعمير"
                          className="h-10"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">سعر الدخول</Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={r.entry_price}
                          onChange={(e) => updateRow(idx, 'entry_price', e.target.value)}
                          placeholder="1.91"
                          className="h-10"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">وقف الخسارة</Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={r.stop_loss}
                          onChange={(e) => updateRow(idx, 'stop_loss', e.target.value)}
                          placeholder="1.75"
                          className="h-10"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">الهدف ١</Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={r.target_price}
                          onChange={(e) => updateRow(idx, 'target_price', e.target.value)}
                          placeholder="2.20"
                          className="h-10"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">الهدف ٢</Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={r.target_price_2}
                          onChange={(e) => updateRow(idx, 'target_price_2', e.target.value)}
                          placeholder="2.50"
                          className="h-10"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">الدعم</Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={r.support_level}
                          onChange={(e) => updateRow(idx, 'support_level', e.target.value)}
                          placeholder="1.80"
                          className="h-10"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">المقاومة</Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={r.resistance_level}
                          onChange={(e) => updateRow(idx, 'resistance_level', e.target.value)}
                          placeholder="2.00"
                          className="h-10"
                        />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label className="text-[10px]">ملاحظات</Label>
                        <Input
                          value={r.recommendation_reason}
                          onChange={(e) => updateRow(idx, 'recommendation_reason', e.target.value)}
                          placeholder="اختراق مقاومة..."
                          className="h-10"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <Button
                  variant="outline"
                  onClick={addRow}
                  className="w-full h-11 gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                >
                  <Plus className="w-4 h-4" />
                  إضافة صف
                </Button>
              </div>

              {/* Import button */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 border-t bg-emerald-50/30">
                <p className="text-xs text-muted-foreground">
                  سيتم استيراد{' '}
                  <span className="font-bold text-emerald-700">
                    {buildImportFromTable().length}
                  </span>{' '}
                  توقع للخبير{' '}
                  <span className="font-bold">{expertName || '—'}</span> في جلسة{' '}
                  <span className="font-bold">{sessionType}</span> بتاريخ{' '}
                  <span className="font-bold">{sessionDate}</span>.
                </p>
                <Button
                  onClick={handleTableImport}
                  disabled={importingTable}
                  className="h-11 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {importingTable ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  استيراد الجدول
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* =================== TEXT MODE =================== */}
        <TabsContent value="text" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquare className="w-4 h-4 text-emerald-600" />
                لصق النص الكامل للتحليل
              </CardTitle>
              <CardDescription>
                انسخ رسائل الواتساب أو تيليجرام كما هي. سيقوم المحلل باستخراج الرموز
                وأسعار الدخول والأهداف والوقف والدعم والمقاومة تلقائيًا.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="er-raw-text" className="text-xs">
                  النص الكامل
                </Label>
                <Textarea
                  id="er-raw-text"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={`1- التعمير (COMI) شراء من 1.91 هدف 2.20 ثم 2.50 استوب 1.75 دعم 1.80 مقاومة 2.00\n2- ...`}
                  className="min-h-[12rem] font-mono text-sm leading-relaxed"
                  rows={8}
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  onClick={handleParse}
                  disabled={parsing || !rawText.trim()}
                  className="h-11 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {parsing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  تحليل بالذكاء الاصطناعي
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRawText('');
                    setParsedRecs(null);
                  }}
                  className="h-11"
                  disabled={!rawText && !parsedRecs}
                >
                  مسح
                </Button>
              </div>

              {/* Parsing results */}
              {parsedRecs && (
                <div className="space-y-3">
                  <Separator />
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      معاينة النتائج المحلَّلة
                      <Badge variant="secondary" className="mr-1">
                        {parsedRecs.length} توقع
                      </Badge>
                    </h4>
                    {parsedRecs.length > 0 && (
                      <Button
                        onClick={handleConfirmImport}
                        disabled={confirming}
                        className="h-10 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        {confirming ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Upload className="w-4 h-4" />
                        )}
                        تأكيد الاستيراد
                      </Button>
                    )}
                  </div>

                  {parsedRecs.length === 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      <AlertTriangle className="w-4 h-4 inline ml-1" />
                      لم يتمكن المحلل من استخراج توقعات من النص. تأكد من أن النص يحتوي
                      على رمز سهم بين قوسين مثل (COMI) وأسعار دخول/هدف.
                    </div>
                  ) : (
                    <div className="rounded-lg border border-emerald-100 bg-white">
                      <UnifiedTable<ParsedTextRec>
                        columns={parsedRecColumns}
                        data={parsedRecs}
                        keyField="code"
                        dense
                        maxHeight="max-h-96"
                        className="border-emerald-100"
                        rowClassName={() => 'hover:bg-emerald-50/40'}
                      />
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* =================== STORED RECOMMENDATIONS =================== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-emerald-600" />
              التوقعات المحفوظة
              <Badge variant="secondary" className="mr-1">
                {filteredStored.length}
              </Badge>
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={fetchStored}
              disabled={storedLoading}
              className="h-9 gap-1"
            >
              <RefreshCw className={cn('w-4 h-4', storedLoading && 'animate-spin')} />
              تحديث
            </Button>
          </CardTitle>
          <CardDescription>
            آخر 50 توقع مستوردة. اضغط على أي صف لعرض التفاصيل الكاملة.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex items-center gap-2 flex-1">
              <div className="relative flex-1">
                <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="بحث برمز السهم أو الاسم..."
                  value={searchSymbol}
                  onChange={(e) => setSearchSymbol(e.target.value)}
                  className="h-10 pr-8"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-10 sm:w-48">
                <Filter className="w-3.5 h-3.5 ml-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="PENDING">قيد التنفيذ</SelectItem>
                <SelectItem value="closed">مغلقة</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          {storedLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredStored.length === 0 ? (
            <div className="rounded-lg border border-dashed border-emerald-200 bg-emerald-50/30 p-8 text-center text-sm text-muted-foreground">
              <ClipboardList className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
              لا توجد توقعات محفوظة بعد. ابدأ بإدخالها من الجدول أو النص بالأعلى.
            </div>
          ) : (
            <div
              className="rounded-lg border border-emerald-100 bg-white"
              style={{ scrollbarWidth: 'thin' }}
            >
              <UnifiedTable<StoredRec>
                columns={storedRecColumns}
                data={filteredStored}
                keyField="id"
                dense
                columnToggle
                filterable
                maxHeight="max-h-96"
                onRowClick={(r) => openDetails(r)}
                rowClassName={() => 'cursor-pointer hover:bg-emerald-50/40'}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* =================== DETAILS SHEET =================== */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="left"
          className="w-full sm:max-w-md overflow-y-auto p-0"
        >
          <SheetHeader className="p-4 border-b bg-emerald-50/60">
            <SheetTitle className="flex items-center gap-2 text-emerald-800">
              <Target className="w-4 h-4" />
              تفاصيل التوقع
            </SheetTitle>
          </SheetHeader>
          {selectedRec && (
            <div className="p-4 space-y-4 text-sm">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-2xl font-bold text-emerald-800 font-mono">
                    {selectedRec.stock_symbol}
                  </div>
                  {selectedRec.stock_name_ar && (
                    <div className="text-sm text-muted-foreground">
                      {selectedRec.stock_name_ar}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1 items-end">
                  {actionBadge(selectedRec.action)}
                  {statusBadge(selectedRec.status)}
                </div>
              </div>

              <Separator />

              {/* Expert info */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">الخبير</div>
                  <div className="font-medium">{selectedRec.expert_name || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">المصدر</div>
                  <div className="font-medium">{selectedRec.expert_source || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">تاريخ الجلسة</div>
                  <div className="font-medium">
                    {selectedRec.session_date || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">نوع الجلسة</div>
                  <div className="font-medium">{selectedRec.session_type || '—'}</div>
                </div>
              </div>

              <Separator />

              {/* Prices */}
              <div className="grid grid-cols-2 gap-3">
                <PriceCell label="سعر الدخول" value={fmtNum(selectedRec.entry_price)} accent="emerald" />
                <PriceCell label="وقف الخسارة" value={fmtNum(selectedRec.stop_loss)} accent="rose" />
                <PriceCell label="الهدف الأول" value={fmtNum(selectedRec.target_price)} accent="emerald" />
                <PriceCell label="الهدف الثاني" value={fmtNum(selectedRec.target_price_2)} accent="emerald" />
                <PriceCell label="الدعم" value={fmtNum(selectedRec.support_level)} accent="zinc" />
                <PriceCell label="المقاومة" value={fmtNum(selectedRec.resistance_level)} accent="zinc" />
                {selectedRec.expected_profit_min != null && (
                  <PriceCell
                    label="الربح المتوقع %"
                    value={`${fmtNum(selectedRec.expected_profit_min, 1)} - ${fmtNum(selectedRec.expected_profit_max, 1)}%`}
                    accent="emerald"
                  />
                )}
                {selectedRec.expected_duration && (
                  <PriceCell
                    label="المدة المتوقعة"
                    value={selectedRec.expected_duration}
                    accent="zinc"
                  />
                )}
              </div>

              {/* Analyses */}
              {selectedRec.technical_analysis && (
                <div className="space-y-1">
                  <div className="text-xs font-semibold flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                    التحليل الفني
                  </div>
                  <div className="rounded-md bg-emerald-50/50 p-3 text-xs leading-relaxed text-foreground">
                    {selectedRec.technical_analysis}
                  </div>
                </div>
              )}
              {selectedRec.fundamental_analysis && (
                <div className="space-y-1">
                  <div className="text-xs font-semibold flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5 text-emerald-600" />
                    التحليل الأساسي
                  </div>
                  <div className="rounded-md bg-emerald-50/50 p-3 text-xs leading-relaxed text-foreground">
                    {selectedRec.fundamental_analysis}
                  </div>
                </div>
              )}
              {selectedRec.recommendation_reason && (
                <div className="space-y-1">
                  <div className="text-xs font-semibold flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    سبب التوقع
                  </div>
                  <div className="rounded-md bg-emerald-50/50 p-3 text-xs leading-relaxed text-foreground">
                    {selectedRec.recommendation_reason}
                  </div>
                </div>
              )}

              <Separator />

              <div className="text-[10px] text-muted-foreground">
                أُنشئت في: {selectedRec.created_at || '—'}
              </div>
            </div>
          )}
          <SheetClose className="absolute top-3 left-3" />
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ============================================================================
// Small sub-component for price cells in the Sheet
// ============================================================================

function PriceCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: 'emerald' | 'rose' | 'zinc';
}) {
  const accentClasses = {
    emerald: 'text-emerald-700',
    rose: 'text-rose-600',
    zinc: 'text-foreground',
  } as const;
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn('font-mono font-bold text-sm', accentClasses[accent])}>{value}</div>
    </div>
  );
}

export default ExpertRecommendationsPanel;
