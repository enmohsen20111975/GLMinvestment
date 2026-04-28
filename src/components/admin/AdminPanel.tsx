'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Lock,
  LogOut,
  Coins,
  DollarSign,
  FileJson,
  FileSpreadsheet,
  Upload,
  Download,
  RefreshCw,
  Shield,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpDown,
  Info,
  Save,
  Trash2,
  FileUp,
  AlertTriangle,
  Clock,
  ArrowRightLeft,
  Brain,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import FeedbackDashboard from './FeedbackDashboard';

// ==================== TYPES ====================

interface GoldPrice {
  karat: string;
  name_ar: string;
  price_per_gram: number;
  change: number;
  last_updated?: string;
}

interface CurrencyRate {
  code: string;
  name_ar: string;
  buy_rate: number;
  sell_rate: number;
  change: number;
  last_updated?: string;
}

interface Recommendation {
  ticker: string;
  company_name_ar?: string;
  recommendation_action: string;
  confidence_score?: number;
  target_price?: number;
  current_price?: number;
  reason?: string;
  sector?: string;
}

interface ImportPreview {
  success: boolean;
  type: string;
  file_name: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  columns?: string[];
  records: Record<string, unknown>[];
  message?: string;
  recommendations?: Recommendation[];
  error?: string;
}

// ==================== HELPER FUNCTIONS ====================

function formatNumber(n: number): string {
  return new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function ChangeBadge({ value }: { value: number }) {
  if (value > 0) {
    return (
      <Badge variant="secondary" className="text-[10px] bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 gap-0.5">
        <TrendingUp className="w-3 h-3" />
        +{formatNumber(value)}
      </Badge>
    );
  }
  if (value < 0) {
    return (
      <Badge variant="secondary" className="text-[10px] bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-300 gap-0.5">
        <TrendingDown className="w-3 h-3" />
        {formatNumber(value)}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-[10px] bg-muted">
      <Minus className="w-3 h-3" />
      0.00
    </Badge>
  );
}

// ==================== ADMIN LOGIN ====================

function AdminLogin({ onLogin }: { onLogin: (password: string) => void }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('يرجى إدخال كلمة المرور');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (data.success) {
        sessionStorage.setItem('admin_password', password);
        onLogin(password);
        toast.success('تم تسجيل الدخول بنجاح');
      } else {
        setError(data.message || 'كلمة المرور غير صحيحة');
      }
    } catch {
      setError('حدث خطأ أثناء الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[50vh] p-4">
      <Card className="w-full max-w-md shadow-xl border-2 border-emerald-200 dark:border-emerald-900/50">
        <CardHeader className="text-center space-y-4 pb-2">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <div>
            <CardTitle className="text-xl font-bold">لوحة الإدارة</CardTitle>
            <CardDescription className="mt-1">
              يرجى إدخال كلمة المرور للوصول إلى لوحة الإدارة
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="كلمة المرور"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                className="h-12 text-base pe-12"
                autoFocus
                dir="ltr"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute left-1 top-1/2 -translate-y-1/2 h-10 w-10 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading || !password.trim()}
              className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-semibold gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  جاري التحقق...
                </>
              ) : (
                <>
                  <Lock className="w-5 h-5" />
                  تسجيل الدخول
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ==================== GOLD MANAGEMENT ====================

function GoldManagement({ password }: { password: string }) {
  const [prices, setPrices] = useState<GoldPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchPrices = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/gold');
      const data = await res.json();
      if (data.success && data.prices) {
        setPrices(data.prices);
      }
    } catch {
      toast.error('فشل في تحميل أسعار الذهب');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrices();
  }, []);

  const handlePriceChange = (index: number, field: 'price_per_gram' | 'change', value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    setPrices((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: num };
      return updated;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/gold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          prices: prices.map((p) => ({
            karat: p.karat,
            price_per_gram: p.price_per_gram,
            change: p.change,
          })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تم تحديث أسعار الذهب بنجاح');
        await fetchPrices();
      } else {
        toast.error('فشل في تحديث الأسعار', { description: data.message || 'حاول مرة أخرى' });
      }
    } catch {
      toast.error('حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
        <span className="mr-2 text-sm text-muted-foreground">جاري تحميل أسعار الذهب...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center">
            <Coins className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">أسعار الذهب الحالية</h3>
            <p className="text-xs text-muted-foreground">العملة: جنيه مصري (EGP)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchPrices}
            disabled={loading}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            تحديث
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                disabled={saving}
                className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 text-xs"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                حفظ التغييرات
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>تأكيد تحديث أسعار الذهب</AlertDialogTitle>
                <AlertDialogDescription>
                  هل أنت متأكد من رغبتك في تحديث أسعار الذهب؟ سيتم تطبيق التغييرات فوراً على جميع المستخدمين.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <AlertDialogAction onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  تأكيد الحفظ
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-emerald-50 dark:bg-emerald-950/20">
                <TableHead className="text-right text-xs font-semibold text-emerald-700 dark:text-emerald-300">العيار</TableHead>
                <TableHead className="text-right text-xs font-semibold text-emerald-700 dark:text-emerald-300">الاسم</TableHead>
                <TableHead className="text-right text-xs font-semibold text-emerald-700 dark:text-emerald-300">السعر لكل جرام (EGP)</TableHead>
                <TableHead className="text-right text-xs font-semibold text-emerald-700 dark:text-emerald-300">التغير</TableHead>
                <TableHead className="text-right text-xs font-semibold text-emerald-700 dark:text-emerald-300">آخر تحديث</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prices.map((item, index) => (
                <TableRow key={item.karat} className="hover:bg-emerald-50/50 dark:hover:bg-emerald-950/10">
                  <TableCell className="font-medium text-sm">{item.karat}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{item.name_ar}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={item.price_per_gram}
                      onChange={(e) => handlePriceChange(index, 'price_per_gram', e.target.value)}
                      className="w-28 h-8 text-sm text-left font-mono"
                      dir="ltr"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={item.change}
                      onChange={(e) => handlePriceChange(index, 'change', e.target.value)}
                      className="w-24 h-8 text-sm text-left font-mono"
                      dir="ltr"
                    />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(item.last_updated)}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

// ==================== CURRENCY MANAGEMENT ====================

function CurrencyManagement({ password }: { password: string }) {
  const [rates, setRates] = useState<CurrencyRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchRates = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/currency');
      const data = await res.json();
      if (data.success && data.currencies) {
        setRates(data.currencies);
      }
    } catch {
      toast.error('فشل في تحميل أسعار الصرف');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRates();
  }, []);

  const handleRateChange = (index: number, field: 'buy_rate' | 'sell_rate' | 'change', value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    setRates((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: num };
      return updated;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/currency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          rates: rates.map((r) => ({
            code: r.code,
            buy_rate: r.buy_rate,
            sell_rate: r.sell_rate,
            change: r.change,
          })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('تم تحديث أسعار الصرف بنجاح');
        await fetchRates();
      } else {
        toast.error('فشل في تحديث الأسعار', { description: data.message || 'حاول مرة أخرى' });
      }
    } catch {
      toast.error('حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
        <span className="mr-2 text-sm text-muted-foreground">جاري تحميل أسعار الصرف...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-teal-100 dark:bg-teal-950/30 flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-teal-600 dark:text-teal-400" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">أسعار الصرف الحالية</h3>
            <p className="text-xs text-muted-foreground">بالنسبة للجنيه المصري (EGP)</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchRates}
            disabled={loading}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            تحديث
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                disabled={saving}
                className="bg-teal-600 hover:bg-teal-700 text-white gap-1.5 text-xs"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                حفظ التغييرات
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>تأكيد تحديث أسعار الصرف</AlertDialogTitle>
                <AlertDialogDescription>
                  هل أنت متأكد من رغبتك في تحديث أسعار الصرف؟ سيتم تطبيق التغييرات فوراً على جميع المستخدمين.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <AlertDialogAction onClick={handleSave} className="bg-teal-600 hover:bg-teal-700 text-white">
                  تأكيد الحفظ
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-teal-50 dark:bg-teal-950/20">
                <TableHead className="text-right text-xs font-semibold text-teal-700 dark:text-teal-300">العملة</TableHead>
                <TableHead className="text-right text-xs font-semibold text-teal-700 dark:text-teal-300">الاسم</TableHead>
                <TableHead className="text-right text-xs font-semibold text-teal-700 dark:text-teal-300">سعر الشراء</TableHead>
                <TableHead className="text-right text-xs font-semibold text-teal-700 dark:text-teal-300">سعر البيع</TableHead>
                <TableHead className="text-right text-xs font-semibold text-teal-700 dark:text-teal-300">الفرق</TableHead>
                <TableHead className="text-right text-xs font-semibold text-teal-700 dark:text-teal-300">التغير</TableHead>
                <TableHead className="text-right text-xs font-semibold text-teal-700 dark:text-teal-300">آخر تحديث</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((item, index) => {
                const diff = item.sell_rate - item.buy_rate;
                return (
                  <TableRow key={item.code} className="hover:bg-teal-50/50 dark:hover:bg-teal-950/10">
                    <TableCell className="font-medium text-sm">{item.code}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.name_ar}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        value={item.buy_rate}
                        onChange={(e) => handleRateChange(index, 'buy_rate', e.target.value)}
                        className="w-28 h-8 text-sm text-left font-mono"
                        dir="ltr"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        value={item.sell_rate}
                        onChange={(e) => handleRateChange(index, 'sell_rate', e.target.value)}
                        className="w-28 h-8 text-sm text-left font-mono"
                        dir="ltr"
                      />
                    </TableCell>
                    <TableCell className="text-sm font-mono text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <ArrowRightLeft className="w-3 h-3" />
                        {formatNumber(diff)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        value={item.change}
                        onChange={(e) => handleRateChange(index, 'change', e.target.value)}
                        className="w-24 h-8 text-sm text-left font-mono"
                        dir="ltr"
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(item.last_updated)}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

// ==================== RECOMMENDATIONS MANAGEMENT ====================

function RecommendationsManagement({ password }: { password: string }) {
  const [exporting, setExporting] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ==================== EXPORT ====================

  const handleExport = async (format: string) => {
    setExporting(format);
    try {
      const response = await fetch(`/api/export?type=ai-adjustment&format=${format}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || 'فشل التصدير');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `egx_recommendations_ai_adjustment_${new Date().toISOString().split('T')[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      toast.success('تم تصدير التحليلات بنجاح', {
        description: `الصيغة: ${format.toUpperCase()} | الحجم: ${formatFileSize(blob.size)}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'حدث خطأ أثناء التصدير';
      toast.error('فشل التصدير', { description: message });
    } finally {
      setExporting(null);
    }
  };

  // ==================== IMPORT ====================

  const handleFileSelect = useCallback((file: File) => {
    setSelectedFile(file);
    setImportPreview(null);

    const isJSON = file.name.toLowerCase().endsWith('.json');
    if (!isJSON) {
      toast.error('صيغة ملف غير مدعومة', {
        description: 'يرجى اختيار ملف JSON (تم تصديره من هذه الصفحة)',
      });
      setSelectedFile(null);
      return;
    }

    toast.info('تم اختيار الملف', {
      description: `${file.name} (${formatFileSize(file.size)})`,
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handlePreview = async () => {
    if (!selectedFile) {
      toast.error('يرجى اختيار ملف أولاً');
      return;
    }

    setImporting(true);
    setImportPreview(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('type', 'ai-adjustment');

      const response = await fetch('/api/import', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'فشل تحليل الملف');
      }

      setImportPreview(result as ImportPreview);
      toast.success('تم تحليل الملف بنجاح', {
        description: result.message || `تم العثور على ${result.valid_rows || (result.records?.length || 0)} تحليل`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'حدث خطأ أثناء تحليل الملف';
      toast.error('فشل تحليل الملف', { description: message });
    } finally {
      setImporting(false);
    }
  };

  const handleApply = async () => {
    if (!importPreview) return;

    const recommendations = importPreview.recommendations || importPreview.records as Recommendation[];
    if (!recommendations || recommendations.length === 0) {
      toast.error('لا توجد تحليلات لتطبيقها');
      return;
    }

    setApplying(true);
    try {
      const res = await fetch('/api/admin/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          recommendations: recommendations.map((r: Recommendation) => ({
            ticker: r.ticker,
            recommendation_action: r.recommendation_action,
            confidence_score: r.confidence_score,
            target_price: r.target_price,
            current_price: r.current_price,
            reason: r.reason,
            sector: r.sector,
          })),
        }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success('تم تحديث التحليلات بنجاح', {
          description: `تم تحديث ${recommendations.length} تحليل`,
        });
        setImportPreview(null);
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        toast.error('فشل في تحديث التحليلات', { description: data.message || 'حاول مرة أخرى' });
      }
    } catch {
      toast.error('حدث خطأ أثناء تطبيق التغييرات');
    } finally {
      setApplying(false);
    }
  };

  const clearImport = () => {
    setSelectedFile(null);
    setImportPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ==================== RENDER ====================

  return (
    <div className="space-y-6">
      {/* Workflow Instructions */}
      <Card className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border-amber-200 dark:border-amber-900/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-amber-800 dark:text-amber-200">
            <Info className="w-4 h-4" />
            مسار عمل تعديل التحليلات بالذكاء الاصطناعي
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row items-start gap-4">
            {/* Step 1 */}
            <div className="flex items-start gap-3 flex-1">
              <div className="w-8 h-8 rounded-full bg-amber-200 dark:bg-amber-800/40 flex items-center justify-center flex-shrink-0 text-sm font-bold text-amber-800 dark:text-amber-200">
                1
              </div>
              <div>
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">تصدير البيانات</p>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  صدّر التحليلات الحالية بصيغة JSON أو CSV
                </p>
              </div>
            </div>
            {/* Step 2 */}
            <div className="flex items-start gap-3 flex-1">
              <div className="w-8 h-8 rounded-full bg-amber-200 dark:bg-amber-800/40 flex items-center justify-center flex-shrink-0 text-sm font-bold text-amber-800 dark:text-amber-200">
                2
              </div>
              <div>
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">تعديل بالذكاء الاصطناعي</p>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  أرسل الملف إلى AI لإعادة ضبط التحليلات
                </p>
              </div>
            </div>
            {/* Step 3 */}
            <div className="flex items-start gap-3 flex-1">
              <div className="w-8 h-8 rounded-full bg-amber-200 dark:bg-amber-800/40 flex items-center justify-center flex-shrink-0 text-sm font-bold text-amber-800 dark:text-amber-200">
                3
              </div>
              <div>
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">استيراد التعديلات</p>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  ارفع الملف المعدّل وطبّق التغييرات
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Export Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center">
            <Download className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">تصدير التحليلات</h3>
            <p className="text-xs text-muted-foreground">صدّر التحليلات لإرسالها إلى الذكاء الاصطناعي</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Card className="flex-1 overflow-hidden hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center flex-shrink-0">
                  <FileJson className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">JSON</p>
                  <p className="text-xs text-muted-foreground">الصيغة المفضلة للذكاء الاصطناعي</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleExport('json')}
                  disabled={!!exporting}
                  className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5 text-xs"
                >
                  {exporting === 'json' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  تصدير
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="flex-1 overflow-hidden hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-teal-100 dark:bg-teal-950/30 flex items-center justify-center flex-shrink-0">
                  <FileSpreadsheet className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">CSV</p>
                  <p className="text-xs text-muted-foreground">للقراءة في Excel أو Google Sheets</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleExport('csv')}
                  disabled={!!exporting}
                  className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5 text-xs"
                >
                  {exporting === 'csv' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  تصدير
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Separator />

      {/* Import Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center">
            <Upload className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">استيراد التحليلات المعدّلة</h3>
            <p className="text-xs text-muted-foreground">ارفع الملف بعد تعديله بالذكاء الاصطناعي</p>
          </div>
        </div>

        {/* File Upload Area */}
        <Card>
          <CardContent className="p-4 md:p-6">
            <div
              className={cn(
                'relative border-2 border-dashed rounded-xl p-8 md:p-10 text-center transition-all duration-200 cursor-pointer',
                dragOver
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20'
                  : selectedFile
                    ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-950/10'
                    : 'border-muted-foreground/25 hover:border-amber-400 hover:bg-muted/50'
              )}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileInput}
                className="hidden"
              />

              {selectedFile ? (
                <div className="space-y-3">
                  <div className="w-14 h-14 mx-auto rounded-full bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center">
                    <FileJson className="w-7 h-7 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-foreground truncate max-w-xs mx-auto">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatFileSize(selectedFile.size)} &bull; JSON
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-[10px] bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300">
                    <CheckCircle2 className="w-3 h-3 ml-1" />
                    جاهز للتحليل
                  </Badge>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="w-14 h-14 mx-auto rounded-full bg-muted flex items-center justify-center">
                    <FileUp className="w-7 h-7 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-foreground">
                      اسحب الملف هنا أو اضغط للاختيار
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      JSON فقط (الملف المصدر من التصدير أعلاه)
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    <FileJson className="w-3 h-3 ml-1" />
                    JSON
                  </Badge>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 mt-4">
              <Button
                onClick={handlePreview}
                disabled={!selectedFile || importing}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white gap-2"
              >
                {importing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    جاري التحليل...
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4" />
                    معاينة البيانات
                  </>
                )}
              </Button>
              {(selectedFile || importPreview) && (
                <Button variant="outline" onClick={clearImport} disabled={importing}>
                  <Trash2 className="w-4 h-4 ml-1" />
                  مسح
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Import Preview */}
        {importPreview && (
          <Card className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileJson className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    معاينة التحليلات
                  </CardTitle>
                  <Badge variant="secondary" className="text-[10px]">JSON</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="w-3 h-3 ml-1" />
                    {importPreview.valid_rows} صالح
                  </Badge>
                  {importPreview.invalid_rows > 0 && (
                    <Badge variant="secondary" className="text-[10px] bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-300">
                      <AlertCircle className="w-3 h-3 ml-1" />
                      {importPreview.invalid_rows} غير صالح
                    </Badge>
                  )}
                </div>
              </div>
              {importPreview.message && (
                <CardDescription className="text-xs">{importPreview.message}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Preview Table */}
              <div className="overflow-x-auto rounded-lg border">
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-amber-50 dark:bg-amber-950/20">
                      <tr>
                        <th className="px-3 py-2 text-right font-semibold text-amber-700 dark:text-amber-300 border-b">#</th>
                        <th className="px-3 py-2 text-right font-semibold text-amber-700 dark:text-amber-300 border-b">الرمز</th>
                        <th className="px-3 py-2 text-right font-semibold text-amber-700 dark:text-amber-300 border-b">الشركة</th>
                        <th className="px-3 py-2 text-right font-semibold text-amber-700 dark:text-amber-300 border-b">التحليل</th>
                        <th className="px-3 py-2 text-right font-semibold text-amber-700 dark:text-amber-300 border-b">الثقة</th>
                        <th className="px-3 py-2 text-right font-semibold text-amber-700 dark:text-amber-300 border-b">السعر الحالي</th>
                        <th className="px-3 py-2 text-right font-semibold text-amber-700 dark:text-amber-300 border-b">السعر المستهدف</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(importPreview.records || []).slice(0, 15).map((record, rowIndex) => {
                        const rec = record as unknown as Recommendation;
                        const actionLabels: Record<string, string> = {
                          buy: 'شراء',
                          sell: 'بيع',
                          hold: 'احتفاظ',
                          strong_buy: 'شراء قوي',
                          strong_sell: 'بيع قوي',
                        };
                        return (
                          <tr
                            key={rowIndex}
                            className={cn(
                              'border-b last:border-0 hover:bg-amber-50/50 dark:hover:bg-amber-950/10 transition-colors',
                              rowIndex % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                            )}
                          >
                            <td className="px-3 py-2 text-muted-foreground">{rowIndex + 1}</td>
                            <td className="px-3 py-2 font-mono font-medium">{rec.ticker || '—'}</td>
                            <td className="px-3 py-2">{rec.company_name_ar || '—'}</td>
                            <td className="px-3 py-2">
                              <Badge
                                variant="secondary"
                                className={cn(
                                  'text-[10px]',
                                  rec.recommendation_action?.includes('buy')
                                    ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                                    : rec.recommendation_action?.includes('sell')
                                      ? 'bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                                      : 'bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
                                )}
                              >
                                {actionLabels[rec.recommendation_action || ''] || rec.recommendation_action || '—'}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 font-mono">
                              {rec.confidence_score ? `${(rec.confidence_score * 100).toFixed(0)}%` : '—'}
                            </td>
                            <td className="px-3 py-2 font-mono">{rec.current_price ? formatNumber(rec.current_price) : '—'}</td>
                            <td className="px-3 py-2 font-mono">{rec.target_price ? formatNumber(rec.target_price) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {(importPreview.records?.length || 0) > 15 && (
                  <div className="px-3 py-2 bg-muted/50 text-center">
                    <p className="text-[10px] text-muted-foreground">
                      و {((importPreview.records?.length || 0) - 15)} تحليل آخر...
                    </p>
                  </div>
                )}
              </div>

              {/* Apply Button */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white gap-2"
                    disabled={applying || (importPreview.records?.length || 0) === 0}
                  >
                    {applying ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        جاري تطبيق التغييرات...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        تطبيق التحليلات ({importPreview.records?.length || 0} تحليل)
                      </>
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>تأكيد تطبيق التحليلات</AlertDialogTitle>
                    <AlertDialogDescription>
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                        <span className="font-medium text-foreground">هذا الإجراء سيستبدل التحليلات الحالية</span>
                      </div>
                      سيتم تحديث {importPreview.records?.length || 0} تحليل في قاعدة البيانات. لا يمكن التراجع عن هذا الإجراء.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>إلغاء</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleApply}
                      className="bg-amber-600 hover:bg-amber-700 text-white"
                    >
                      تأكيد التطبيق
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ==================== MAIN ADMIN PANEL ====================

export function AdminPanel() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    if (typeof window !== 'undefined') {
      return !!sessionStorage.getItem('admin_password');
    }
    return false;
  });
  const [password, setPassword] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('admin_password') || '';
    }
    return '';
  });

  const handleLogin = (pw: string) => {
    setPassword(pw);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('admin_password');
    setPassword('');
    setIsAuthenticated(false);
    toast.info('تم تسجيل الخروج');
  };

  if (!isAuthenticated) {
    return (
      <div dir="rtl">
        <AdminLogin onLogin={handleLogin} />
      </div>
    );
  }

  return (
    <div dir="rtl">
      {/* Panel Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-lg">لوحة الإدارة</h2>
            <p className="text-xs text-muted-foreground">إدارة أسعار الذهب والعملات والتحليلات</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleLogout}
          className="gap-1.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
        >
          <LogOut className="w-3.5 h-3.5" />
          تسجيل الخروج
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="gold" className="w-full" dir="rtl">
        <TabsList className="grid w-full grid-cols-4 mb-6">
          <TabsTrigger value="gold" className="gap-1.5 text-xs sm:text-sm">
            <Coins className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span className="hidden sm:inline">إدارة الذهب</span>
            <span className="sm:hidden">الذهب</span>
          </TabsTrigger>
          <TabsTrigger value="currency" className="gap-1.5 text-xs sm:text-sm">
            <DollarSign className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            <span className="hidden sm:inline">أسعار الصرف</span>
            <span className="sm:hidden">العملات</span>
          </TabsTrigger>
          <TabsTrigger value="recommendations" className="gap-1.5 text-xs sm:text-sm">
            <ArrowUpDown className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span className="hidden sm:inline">إدارة التحليلات</span>
            <span className="sm:hidden">التحليلات</span>
          </TabsTrigger>
          <TabsTrigger value="feedback" className="gap-1.5 text-xs sm:text-sm">
            <Brain className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            <span className="hidden sm:inline">التعلم الذاتي</span>
            <span className="sm:hidden">الذكاء</span>
          </TabsTrigger>
        </TabsList>

        {/* Gold Tab */}
        <TabsContent value="gold">
          <GoldManagement password={password} />
        </TabsContent>

        {/* Currency Tab */}
        <TabsContent value="currency">
          <CurrencyManagement password={password} />
        </TabsContent>

        {/* Recommendations Tab */}
        <TabsContent value="recommendations">
          <RecommendationsManagement password={password} />
        </TabsContent>

        {/* Feedback / Self-Learning Tab */}
        <TabsContent value="feedback">
          <FeedbackDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
