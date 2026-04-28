'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Database,
  Users,
  Target,
  Clock,
  Activity,
  RefreshCw,
  Download,
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Shield,
  Zap,
  BarChart3,
  Eye,
  Lock,
  LogIn,
  LogOut,
  Settings,
  Brain,
  Server,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EnhancedAdminDashboard } from '@/components/admin/EnhancedAdminDashboard';
import { toast } from 'sonner';
import { verifyAdminCredentials, generateAdminToken } from '@/lib/admin-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';

interface MonitorData {
  success: boolean;
  timestamp: string;
  database: {
    total_stocks: number;
    active_stocks: number;
    sectors: number;
    egx30_count: number;
    price_history_points: number;
    deep_insight_count: number;
    gold_history_points: number;
    last_update: string | null;
  };
  users: {
    total: number;
    active: number;
    premium: number;
  };
  platform: {
    watchlist_items: number;
    portfolio_items: number;
  };
  predictions: {
    total: number;
    validated: number;
    accuracy_percent: number;
    recent: Array<{
      ticker: string;
      predicted_price: number;
      actual_price: number | null;
      prediction_date: string;
      prediction_type: string | null;
      status: string | null;
    }>;
  };
  feedback_loop: {
    recent_adjustments: Array<{
      ticker: string;
      adjustment_type: string;
      old_weight: number;
      new_weight: number;
      adjusted_at: string;
      reason: string | null;
    }>;
  };
  system_health: {
    light_db: string;
    heavy_db: string;
    prisma_db: string;
    data_freshness: string;
    hours_since_update: number | null;
  };
  data_freshness: string;
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
  variant = 'default',
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const variantStyles = {
    default: 'border-border',
    success: 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20',
    warning: 'border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20',
    danger: 'border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20',
  };

  return (
    <Card className={variantStyles[variant]}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tabular-nums" dir="ltr">{value}</p>
            {subtitle && (
              <p className="text-[11px] text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className="text-muted-foreground">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'fresh':
    case 'connected':
      return (
        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-0 gap-1">
          <CheckCircle2 className="w-3 h-3" />
          {status === 'fresh' ? 'طازج' : 'متصل'}
        </Badge>
      );
    case 'stale':
      return (
        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border-0 gap-1">
          <AlertTriangle className="w-3 h-3" />
          قديم
        </Badge>
      );
    case 'outdated':
    case 'disconnected':
      return (
        <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border-0 gap-1">
          <XCircle className="w-3 h-3" />
          {status === 'outdated' ? 'منتهي' : 'غير متصل'}
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="gap-1">
          <Activity className="w-3 h-3" />
          غير معروف
        </Badge>
      );
  }
}

function MonitorSkeleton() {
  return (
    <div className="space-y-6 p-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

// ─── Login Form ────────────────────────────────────────────────────────────

function AdminLoginForm({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      setLoading(true);

      // Small delay to simulate auth check
      setTimeout(() => {
        if (verifyAdminCredentials(username, password)) {
          sessionStorage.setItem('admin_auth', 'true');
          sessionStorage.setItem('admin_auth_time', Date.now().toString());
          toast.success('تم تسجيل الدخول بنجاح');
          onLogin();
        } else {
          setError('اسم المستخدم أو كلمة المرور غير صحيحة');
          toast.error('بيانات الدخول غير صحيحة');
        }
        setLoading(false);
      }, 500);
    },
    [username, password, onLogin]
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background" dir="rtl">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4 pb-2">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Shield className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
          <div>
            <CardTitle className="text-xl font-bold">لوحة تحكم المسؤول</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              أدخل بيانات الدخول للوصول إلى لوحة المراقبة
            </p>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="admin-username">اسم المستخدم</Label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="admin-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="أدخل اسم المستخدم"
                  className="pr-10"
                  dir="ltr"
                  autoComplete="username"
                  required
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-password">كلمة المرور</Label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="admin-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="أدخل كلمة المرور"
                  className="pr-10"
                  dir="ltr"
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/10 rounded-lg px-3 py-2">
                <XCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  جارٍ التحقق...
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  تسجيل الدخول
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 pt-4 border-t text-center">
            <p className="text-[11px] text-muted-foreground">
              الوصول مقيد للمسؤولين المعتمدين فقط
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Data Sources Section ───────────────────────────────────────────────────

interface DataSourcesInfo {
  vps: {
    configured: boolean;
    url: string;
    available: boolean;
    last_check: string;
    description: string;
  };
  local_python: {
    available: boolean;
    path: string;
    description: string;
    note: string;
  };
  web_scraping: {
    available: boolean;
    sources: Array<{
      name: string;
      url: string;
      type: string;
      rate_limit: string;
    }>;
  };
  database: {
    light_db: {
      path: string;
      exists: boolean;
      size_bytes: number;
      size_human: string;
      stocks_count: number;
      last_update: string | null;
    };
    heavy_db: {
      path: string;
      exists: boolean;
      size_bytes: number;
      size_human: string;
    };
  };
  version: string;
}

function DataSourcesSection() {
  const [data, setData] = useState<DataSourcesInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDataSources = useCallback(async () => {
    try {
      setLoading(true);
      const token = generateAdminToken();
      const res = await fetch('/api/admin/data-sources', {
        headers: { 'X-Admin-Token': token },
      });
      if (!res.ok) throw new Error('غير مصرح');
      const json = await res.json();
      if (json.success) {
        setData(json.data_sources);
      }
    } catch (err) {
      toast.error('حدث خطأ أثناء جلب معلومات مصادر البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDataSources();
  }, [fetchDataSources]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Version Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Server className="w-5 h-5 text-emerald-600" />
          مصادر البيانات
        </h2>
        <Badge variant="outline" className="font-mono text-sm">v{data.version}</Badge>
      </div>

      {/* Data Sources Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* VPS API */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-600" />
              VPS API (egxpy-bridge)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">الحالة</span>
              <StatusBadge status={data.vps.available ? 'connected' : 'disconnected'} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">الإعداد</span>
              <span className="text-xs">{data.vps.configured ? 'مُعد' : 'غير مُعد'}</span>
            </div>
            {data.vps.url && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">الرابط</span>
                <code className="text-xs bg-muted px-2 py-1 rounded truncate max-w-[200px]">
                  {data.vps.url}
                </code>
              </div>
            )}
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground">{data.vps.description}</p>
            </div>
          </CardContent>
        </Card>

        {/* Local Python */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="w-4 h-4 text-purple-600" />
              Python المحلي
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">الحالة</span>
              <StatusBadge status={data.local_python.available ? 'connected' : 'disconnected'} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">المسار</span>
              <code className="text-xs bg-muted px-2 py-1 rounded">{data.local_python.path}</code>
            </div>
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground">{data.local_python.description}</p>
              <p className="text-xs text-amber-600 mt-1">⚠️ {data.local_python.note}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Web Scraping Sources */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-600" />
            مصادر Web Scraping
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-3">
            {data.web_scraping.sources.map((source, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{source.name}</span>
                  <Badge variant="secondary" className="text-xs">{source.type}</Badge>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">الرابط</span>
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    {source.url}
                  </a>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">الحد الأقصى</span>
                  <span className="text-amber-600">{source.rate_limit}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Database Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-600" />
            قواعد البيانات
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Light DB */}
            <div className="p-3 rounded-lg bg-muted/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">القاعدة الخفيفة (custom.db)</span>
                <StatusBadge status={data.database.light_db.exists ? 'connected' : 'disconnected'} />
              </div>
              <div className="text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">الحجم</span>
                  <span>{data.database.light_db.size_human}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">عدد الأسهم</span>
                  <span>{data.database.light_db.stocks_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">آخر تحديث</span>
                  <span dir="ltr">{data.database.light_db.last_update || 'غير محدد'}</span>
                </div>
              </div>
            </div>

            {/* Heavy DB */}
            <div className="p-3 rounded-lg bg-muted/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">القاعدة الرئيسية (egx_investment.db)</span>
                <StatusBadge status={data.database.heavy_db.exists ? 'connected' : 'disconnected'} />
              </div>
              <div className="text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">الحجم</span>
                  <span>{data.database.heavy_db.size_human}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">المسار</span>
                  <code className="text-[10px]">{data.database.heavy_db.path}</code>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Export/Import Section */}
      <DataManagementSection />
    </div>
  );
}

// ─── Data Management Section (Export/Import) ────────────────────────────────

function DataManagementSection() {
  const [exportLoading, setExportLoading] = useState(false);
  const [vpsExportLoading, setVpsExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    stats?: {
      stocks_imported: number;
      stocks_updated: number;
      price_history_imported: number;
      error_count: number;
    };
    error?: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleVpsExport = async () => {
    setVpsExportLoading(true);
    try {
      const token = generateAdminToken();
      const res = await fetch('/api/admin/export-vps', {
        headers: { 'X-Admin-Token': token },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `فشل في الاتصال بـ VPS (${res.status})`);
      }

      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `egx-vps-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`تم تصدير ${data.stocks?.length || 0} سهم و ${data.price_history?.length || 0} سجل سعري من VPS`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'حدث خطأ أثناء التصدير من VPS';
      toast.error(errorMessage);
      console.error(err);
    } finally {
      setVpsExportLoading(false);
    }
  };

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const token = generateAdminToken();
      const res = await fetch('/api/admin/export-data', {
        headers: { 'X-Admin-Token': token },
      });

      if (!res.ok) {
        throw new Error('فشل في تصدير البيانات');
      }

      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `egx-data-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`تم تصدير ${data.stocks?.length || 0} سهم و ${data.price_history?.length || 0} سجل سعري`);
    } catch (err) {
      toast.error('حدث خطأ أثناء تصدير البيانات');
      console.error(err);
    } finally {
      setExportLoading(false);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    setImportResult(null);

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const token = generateAdminToken();
      const res = await fetch('/api/admin/import-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': token,
        },
        body: JSON.stringify(data),
      });

      const result = await res.json();

      if (result.success) {
        setImportResult({
          success: true,
          stats: result.stats,
        });
        toast.success(`تم استيراد ${result.stats.stocks_imported + result.stats.stocks_updated} سهم و ${result.stats.price_history_imported} سجل سعري`);
      } else {
        throw new Error(result.error || 'فشل في استيراد البيانات');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'حدث خطأ أثناء استيراد البيانات';
      setImportResult({
        success: false,
        error: errorMessage,
      });
      toast.error(errorMessage);
      console.error(err);
    } finally {
      setImportLoading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Download className="w-4 h-4 text-blue-600" />
          إدارة البيانات (تصدير/استيراد)
        </CardTitle>
        <CardDescription>
          تصدير بيانات الأسهم إلى ملف JSON أو استيراد من ملف خارجي
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* VPS Export Section */}
          <div className="p-4 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/50">
            <div className="flex items-center gap-2 mb-3">
              <Server className="w-5 h-5 text-purple-600" />
              <span className="font-medium">تصدير من VPS</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              تنزيل بيانات egxpy-bridge مباشرة من VPS
            </p>
            <Button
              onClick={handleVpsExport}
              disabled={vpsExportLoading}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white gap-2"
            >
              {vpsExportLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  جارٍ التصدير...
                </>
              ) : (
                <>
                  <Server className="w-4 h-4" />
                  تصدير من VPS
                </>
              )}
            </Button>
          </div>

          {/* Local Export Section */}
          <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50">
            <div className="flex items-center gap-2 mb-3">
              <Download className="w-5 h-5 text-blue-600" />
              <span className="font-medium">تصدير محلي</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              تنزيل بيانات قاعدة البيانات المحلية
            </p>
            <Button
              onClick={handleExport}
              disabled={exportLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2"
            >
              {exportLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  جارٍ التصدير...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  تصدير محلي
                </>
              )}
            </Button>
          </div>

          {/* Import Section */}
          <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50">
            <div className="flex items-center gap-2 mb-3">
              <Play className="w-5 h-5 text-emerald-600" />
              <span className="font-medium">استيراد البيانات</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              استيراد بيانات من ملف JSON
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImport}
              className="hidden"
              id="import-file-input"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={importLoading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            >
              {importLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  جارٍ الاستيراد...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  استيراد من JSON
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Import Result */}
        {importResult && (
          <div className={`p-3 rounded-lg ${importResult.success ? 'bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50' : 'bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50'}`}>
            {importResult.success ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="font-medium">تم الاستيراد بنجاح</span>
                </div>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span>أسهم جديدة:</span>
                    <span className="font-medium">{importResult.stats?.stocks_imported || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>أسهم محدثة:</span>
                    <span className="font-medium">{importResult.stats?.stocks_updated || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>سجلات سعرية:</span>
                    <span className="font-medium">{importResult.stats?.price_history_imported || 0}</span>
                  </div>
                  {importResult.stats?.error_count ? (
                    <div className="flex justify-between text-amber-600">
                      <span>أخطاء:</span>
                      <span>{importResult.stats.error_count}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <XCircle className="w-4 h-4" />
                <span>{importResult.error}</span>
              </div>
            )}
          </div>
        )}

        {/* Usage Info */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>💡 <strong>استخدام:</strong> قم بتصدير البيانات من VPS (egxpy-bridge)، ثم استيرادها على Hostinger</p>
          <p>⚠️ <strong>تنبيه:</strong> الاستيراد سيضيف/يحدث البيانات الموجودة دون حذف</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Admin Dashboard ───────────────────────────────────────────────────────

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchMonitorData = useCallback(async () => {
    try {
      setLoading(true);
      // Send admin auth token in header
      const token = generateAdminToken();
      const res = await fetch('/api/admin/monitor', {
        headers: { 'X-Admin-Token': token },
      });
      if (!res.ok) throw new Error('غير مصرح');
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        toast.error(json.error || 'حدث خطأ أثناء جلب البيانات');
      }
    } catch (err) {
      toast.error('حدث خطأ أثناء جلب بيانات المراقبة');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMonitorData();
  }, [fetchMonitorData]);

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem('admin_auth');
    sessionStorage.removeItem('admin_auth_time');
    toast.success('تم تسجيل الخروج');
    onLogout();
  }, [onLogout]);

  const handleAction = async (action: string) => {
    setActionLoading(action);
    try {
      let endpoint = '';
      switch (action) {
        case 'sync':
          endpoint = '/api/market/sync-live';
          break;
        case 'feedback':
          endpoint = '/api/v2/feedback/run';
          break;
        case 'export':
          endpoint = '/api/export';
          break;
        default:
          return;
      }

      const token = generateAdminToken();
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'X-Admin-Token': token },
        cache: 'no-store',
      });
      const result = await res.json();

      if (result.success) {
        toast.success('تم تنفيذ العملية بنجاح');
        if (action === 'sync' || action === 'feedback') {
          // Refresh data after sync or feedback
          setTimeout(fetchMonitorData, 2000);
        }
      } else {
        toast.error(result.error || 'حدث خطأ أثناء تنفيذ العملية');
      }
    } catch {
      toast.error('حدث خطأ أثناء تنفيذ العملية');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading && !data) {
    return <MonitorSkeleton />;
  }

  if (!data) return null;

  const freshnessLabel: Record<string, string> = {
    fresh: 'بيانات طازجة',
    stale: 'بيانات قديمة',
    outdated: 'بيانات منتهية الصلاحية',
    unknown: 'غير معروف',
  };

  return (
    <div className="space-y-6 p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            <h1 className="text-xl font-bold">لوحة تحكم المسؤول</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            مراقبة وإدارة النظام الكامل
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={fetchMonitorData}
            disabled={loading}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            تحديث
          </Button>
          <Button
            onClick={handleLogout}
            variant="outline"
            size="sm"
            className="gap-2 text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
          >
            <LogOut className="w-4 h-4" />
            خروج
          </Button>
        </div>
      </div>

      {/* Version Badge */}
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="font-mono">v3.4.26</Badge>
      </div>

      {/* Tabs for different views */}
      <Tabs defaultValue="monitor" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="monitor" className="gap-2">
            <Activity className="w-4 h-4" />
            المراقبة
          </TabsTrigger>
          <TabsTrigger value="sources" className="gap-2">
            <Server className="w-4 h-4" />
            مصادر البيانات
          </TabsTrigger>
          <TabsTrigger value="cache" className="gap-2">
            <Database className="w-4 h-4" />
            الكاش والتعلّم
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="w-4 h-4" />
            الإعدادات
          </TabsTrigger>
        </TabsList>

        {/* Monitor Tab - Original Dashboard */}
        <TabsContent value="monitor" className="space-y-4">
          {/* System Overview Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <StatCard
              title="إجمالي الأسهم"
              value={data.database.active_stocks}
              subtitle={`${data.database.sectors} قطاع | ${data.database.egx30_count} EGX30`}
              icon={<BarChart3 className="w-5 h-5" />}
            />
            <StatCard
              title="المستخدمين"
              value={data.users.total}
              subtitle={`${data.users.active} نشط | ${data.users.premium} مميز`}
              icon={<Users className="w-5 h-5" />}
            />
            <StatCard
              title="دقة التوقعات"
              value={`${data.predictions.accuracy_percent}%`}
              subtitle={`${data.predictions.validated} من ${data.predictions.total} تم التحقق`}
              icon={<Target className="w-5 h-5" />}
              variant={data.predictions.accuracy_percent >= 70 ? 'success' : data.predictions.accuracy_percent >= 50 ? 'warning' : 'danger'}
            />
            <StatCard
              title="حداثة البيانات"
              value={data.system_health.hours_since_update !== null ? `${data.system_health.hours_since_update}س` : '—'}
              subtitle={freshnessLabel[data.data_freshness] || 'غير معروف'}
              icon={<Clock className="w-5 h-5" />}
              variant={data.data_freshness === 'fresh' ? 'success' : data.data_freshness === 'stale' ? 'warning' : 'danger'}
            />
          </div>

          {/* Secondary Stats Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Eye className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">قائمة المراقبة</span>
                </div>
                <p className="text-lg font-bold tabular-nums">{data.platform.watchlist_items}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Database className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">نقاط التاريخ السعرى</span>
                </div>
                <p className="text-lg font-bold tabular-nums">{data.database.price_history_points.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">المحفظة</span>
                </div>
            <p className="text-lg font-bold tabular-nums">{data.platform.portfolio_items}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">تحليلات عميقة</span>
            </div>
            <p className="text-lg font-bold tabular-nums">{data.database.deep_insight_count}</p>
          </CardContent>
        </Card>
      </div>

      {/* Data Source Status + Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Data Source Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              حالة مصادر البيانات
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">قاعدة بيانات الأسهم (الخفيفة)</span>
              <StatusBadge status={data.system_health.light_db} />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm">قاعدة البيانات الرئيسية (الثقيلة)</span>
              <StatusBadge status={data.system_health.heavy_db} />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm">قاعدة بيانات المستخدمين (Prisma)</span>
              <StatusBadge status={data.system_health.prisma_db} />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm">حداثة بيانات السوق</span>
              <StatusBadge status={data.data_freshness} />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">آخر تحديث للبيانات</span>
              <span className="text-xs tabular-nums" dir="ltr">
                {data.database.last_update
                  ? new Date(data.database.last_update).toLocaleString('ar-EG', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'غير محدد'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-600" />
              إجراءات سريعة
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <Button
              onClick={() => handleAction('sync')}
              disabled={actionLoading === 'sync'}
              variant="outline"
              className="w-full justify-start gap-3 text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${actionLoading === 'sync' ? 'animate-spin' : ''}`} />
              <div className="text-right">
                <p className="font-medium">مزامنة البيانات المباشرة</p>
                <p className="text-[11px] text-muted-foreground">تحديث أسعار الأسهم من مصدر البيانات</p>
              </div>
            </Button>
            <Separator />
            <Button
              onClick={() => handleAction('feedback')}
              disabled={actionLoading === 'feedback'}
              variant="outline"
              className="w-full justify-start gap-3 text-sm"
            >
              <Play className={`w-4 h-4 ${actionLoading === 'feedback' ? 'animate-pulse' : ''}`} />
              <div className="text-right">
                <p className="font-medium">تشغيل حلقة التغذية الراجعة</p>
                <p className="text-[11px] text-muted-foreground">تحديث أوزان نموذج التوقعات</p>
              </div>
            </Button>
            <Separator />
            <Button
              onClick={() => handleAction('export')}
              disabled={actionLoading === 'export'}
              variant="outline"
              className="w-full justify-start gap-3 text-sm"
            >
              <Download className={`w-4 h-4 ${actionLoading === 'export' ? 'animate-bounce' : ''}`} />
              <div className="text-right">
                <p className="font-medium">تصدير البيانات</p>
                <p className="text-[11px] text-muted-foreground">تصدير بيانات الأسهم والتوقعات</p>
              </div>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Recent Predictions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-emerald-600" />
              أحدث التوقعات
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {data.predictions.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                لا توجد توقعات متاحة
              </p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {data.predictions.recent.map((pred, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold" dir="ltr">{pred.ticker}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5">
                          {pred.prediction_type || 'N/A'}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground tabular-nums" dir="ltr">
                        {pred.prediction_date ? new Date(pred.prediction_date).toLocaleDateString('ar-EG') : '—'}
                      </p>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-bold tabular-nums" dir="ltr">
                        {pred.predicted_price?.toFixed(2)} ج.م
                      </p>
                      {pred.actual_price !== null && pred.actual_price !== undefined && (
                        <div className="flex items-center gap-1">
                          {pred.actual_price >= pred.predicted_price ? (
                            <TrendingUp className="w-3 h-3 text-emerald-500" />
                          ) : (
                            <TrendingDown className="w-3 h-3 text-red-500" />
                          )}
                          <span className={`text-[10px] tabular-nums ${pred.actual_price >= pred.predicted_price ? 'text-emerald-600' : 'text-red-600'}`} dir="ltr">
                            {pred.actual_price.toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Feedback Adjustments */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              أحدث تعديلات الأوزان
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {data.feedback_loop.recent_adjustments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                لا توجد تعديلات متاحة
              </p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {data.feedback_loop.recent_adjustments.map((adj, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold" dir="ltr">{adj.ticker}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5">
                          {adj.adjustment_type || 'تعديل'}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground tabular-nums" dir="ltr">
                        {adj.adjusted_at ? new Date(adj.adjusted_at).toLocaleDateString('ar-EG') : '—'}
                      </p>
                      {adj.reason && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">{adj.reason}</p>
                      )}
                    </div>
                    <div className="text-left flex items-center gap-2">
                      <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                        {adj.old_weight.toFixed(3)}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-xs font-bold tabular-nums" dir="ltr">
                        {adj.new_weight.toFixed(3)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Footer Timestamp */}
      <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground" dir="rtl">
        <Clock className="w-3 h-3" />
        <span>
          آخر تحديث: {new Date(data.timestamp).toLocaleString('ar-EG', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
        </TabsContent>

        {/* Data Sources Tab */}
        <TabsContent value="sources" className="space-y-4">
          <DataSourcesSection />
        </TabsContent>

        {/* Cache & Learning Tab */}
        <TabsContent value="cache" className="space-y-4">
          <EnhancedAdminDashboard />
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                إعدادات النظام
              </CardTitle>
              <CardDescription>
                إعدادات التحديث التلقائي والجدولة
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">تحديث البيانات التلقائي</span>
                  <Badge variant="default" className="bg-emerald-500">كل 30 دقيقة</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  يتم تحديث الكاش تلقائياً كل 30 دقيقة لتقليل حمل السيرفر
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Cron Endpoint</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded">/api/cron/update-cache</code>
                </div>
                <p className="text-xs text-muted-foreground">
                  استخدم هذا الرابط مع خدمة cron خارجية مثل cron-job.org أو Vercel Cron
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <span className="text-sm font-medium">Vercel Cron Configuration</span>
                <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto" dir="ltr">
{`// vercel.json
{
  "crons": [{
    "path": "/api/cron/update-cache",
    "schedule": "0,30 * * * *"
  }]
}`}
                </pre>
              </div>

              <Separator />

              <div className="space-y-2">
                <span className="text-sm font-medium">متغيرات البيئة المطلوبة</span>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between p-2 bg-muted rounded">
                    <code>CRON_SECRET</code>
                    <span className="text-muted-foreground">لحماية endpoint</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-muted rounded">
                    <code>DATABASE_URL</code>
                    <span className="text-muted-foreground">Prisma database</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Main Admin Page ──────────────────────────────────────────────────────

export default function AdminPage() {
  // Check sessionStorage for existing auth synchronously to avoid setState in effect
  const getInitialAuthState = (): { isAuthenticated: boolean; checking: boolean } => {
    if (typeof window === 'undefined') return { isAuthenticated: false, checking: true };
    const adminAuth = sessionStorage.getItem('admin_auth');
    if (adminAuth === 'true') {
      const authTime = sessionStorage.getItem('admin_auth_time');
      if (authTime) {
        const elapsed = Date.now() - parseInt(authTime, 10);
        if (elapsed < 24 * 60 * 60 * 1000) {
          return { isAuthenticated: true, checking: false };
        }
      }
      // Session expired
      sessionStorage.removeItem('admin_auth');
      sessionStorage.removeItem('admin_auth_time');
    }
    return { isAuthenticated: false, checking: false };
  };

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [initialized, setInitialized] = useState(false);

  // Run check on mount using a callback pattern
  useEffect(() => {
    const { isAuthenticated: authed, checking: done } = getInitialAuthState();
    // Use a microtask to avoid direct setState in effect body
    Promise.resolve().then(() => {
      setIsAuthenticated(authed);
      setChecking(done ? false : false);
      setInitialized(true);
    });
  }, []);

  if (checking || !initialized) {
    return <MonitorSkeleton />;
  }

  if (!isAuthenticated) {
    return <AdminLoginForm onLogin={() => setIsAuthenticated(true)} />;
  }

  return <AdminDashboard onLogout={() => setIsAuthenticated(false)} />;
}
