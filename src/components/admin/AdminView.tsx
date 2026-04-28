'use client';

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Shield,
  Users,
  TrendingUp,
  Activity,
  Database,
  RefreshCw,
  Wifi,
  WifiOff,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Eye,
  Loader2,
  Crown,
  UserCheck,
  UserX,
  ArrowUpDown,
  Star,
  BarChart3,
  Globe,
  Upload,
  Download,
  FileText,
  Bug,
  Layers,
  TrendingDown,
  Zap,
  Monitor,
  X,
  ChevronDown,
  ChevronUp,
  Search,
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useAppStore } from '@/lib/store';
import { isAdmin, generateAdminToken } from '@/lib/admin-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';

// ==================== ADMIN API HELPER ====================
// Automatically sends X-Admin-Token header for admin API routes.

function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = generateAdminToken();
  const headers = new Headers(options.headers);
  headers.set('X-Admin-Token', token);
  if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(url, { ...options, headers });
}

// ==================== TYPES ====================

interface AdminStats {
  success: boolean;
  timestamp: string;
  users: {
    total: number;
    active: number;
    premium: number;
    recent: Array<{
      email: string;
      name: string | null;
      subscription_tier: string;
      last_login: string | null;
      created_at: string;
    }>;
  };
  stocks: {
    total: number;
    active: number;
    sectors: number;
    price_history_points: number;
    last_update: string | null;
  };
  platform: {
    watchlist_items: number;
    portfolio_items: number;
  };
}

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  username: string | null;
  is_active: boolean;
  subscription_tier: string;
  default_risk_tolerance: string;
  last_login: string | null;
  email_verified: string | null;
  created_at: string;
  updated_at: string;
}

interface ConnectionInfo {
  timestamp: string;
  summary: string;
  sources: Record<string, {
    available: boolean;
    message: string;
    latency_ms?: number;
    role?: string;
  }>;
}

interface DbHealth {
  success: boolean;
  timestamp: string;
  sql_js_initialized: boolean;
  heavy_db: Record<string, unknown>;
  light_db: Record<string, unknown>;
}

interface AnalyticsData {
  success: boolean;
  summary: {
    total_events: number;
    today_events: number;
    today_page_views: number;
    today_errors: number;
    today_unique_users: number;
    today_unique_ips: number;
  };
  page_views_by_section: Array<{ view: string; count: number }>;
  daily_traffic: Array<{
    date: string; total: number; page_views: number; errors: number; unique_users: number;
  }>;
  recent_errors: Array<{
    id: number; view: string; action: string; detail: string;
    ip_hash: string; user_agent: string; created_at: string;
  }>;
  active_users_weekly: Array<{ user_id: string; visits: number; last_seen: string }>;
  feature_usage: Array<{ action: string; count: number }>;
  peak_hours: Array<{ hour: number; count: number }>;
  errors_by_view: Array<{ view: string; count: number }>;
}

type AdminTab = 'overview' | 'users' | 'traffic' | 'errors' | 'database' | 'data';

const TIER_NAMES_AR: Record<string, string> = {
  free: 'مجاني',
  plus: 'بلس',
  premium: 'بريميوم',
};

const TIER_STYLES: Record<string, { variant: 'default' | 'secondary' | 'outline'; className: string }> = {
  free: { variant: 'secondary', className: 'text-[10px]' },
  plus: { variant: 'outline', className: 'text-[10px] border-emerald-300 text-emerald-700 dark:text-emerald-400' },
  premium: { variant: 'default', className: 'text-[10px] bg-amber-600 text-white border-0' },
};

const VIEW_NAMES_AR: Record<string, string> = {
  dashboard: 'لوحة التحكم',
  stocks: 'الأسهم',
  'stock-detail': 'تفاصيل السهم',
  portfolio: 'المحفظة',
  watchlist: 'قائمة المراقبة',
  finance: 'الوضع المالي',
  recommendations: 'التوصيات',
  reports: 'التقارير',
  learning: 'التعلم',
  simulation: 'المحاكاة',
  settings: 'الإعدادات',
  admin: 'إدارة النظام',
  analysis: 'التحليلات',
  subscription: 'الاشتراكات',
  auth: 'تسجيل الدخول',
};

// ==================== COMPONENT ====================

export function AdminView() {
  const { data: session } = useSession();
  const { user } = useAppStore();
  const userEmail = user?.email || session?.user?.email || '';
  const userName = user?.username || (session?.user as Record<string, unknown>)?.username as string || '';
  const isAdminUser = isAdmin(userEmail, userName);

  // State
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [connections, setConnections] = useState<ConnectionInfo | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [dbHealth, setDbHealth] = useState<DbHealth | null>(null);
  const [dbHealthLoading, setDbHealthLoading] = useState(false);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [expandedErrors, setExpandedErrors] = useState<Set<number>>(new Set());
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-refresh timer
  const autoRefreshRef = useRef<NodeJS.Timeout | null>(null);

  // Filtered users
  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return users;
    const q = userSearch.toLowerCase();
    return users.filter(u =>
      u.email.toLowerCase().includes(q) ||
      (u.name || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q)
    );
  }, [users, userSearch]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await adminFetch('/api/admin/stats');
      const data = await res.json();
      if (data.success) {
        setStats(data);
      } else {
        toast.error(data.error || 'فشل جلب الإحصائيات');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // Fetch analytics
  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await adminFetch('/api/admin/analytics');
      const data = await res.json();
      if (data.success) {
        setAnalytics(data);
      }
    } catch {
      // silent
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  // Fetch monitor data
  const fetchMonitorData = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/monitor');
      const data = await res.json();
      if (data.success) {
        setStats(prev => prev ? {
          ...prev,
          stocks: {
            ...prev.stocks,
            price_history_points: data.database?.price_history_points ?? prev.stocks.price_history_points,
          },
          platform: {
            watchlist_items: data.platform?.watchlist_items ?? prev.platform.watchlist_items,
            portfolio_items: data.platform?.portfolio_items ?? prev.platform.portfolio_items,
          },
        } : prev);
      }
    } catch {
      // non-fatal
    }
  }, []);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await adminFetch('/api/admin/users');
      const data = await res.json();
      if (data.success) {
        setUsers(data.users);
      } else {
        toast.error(data.error || 'فشل جلب المستخدمين');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // Fetch connections
  const fetchConnections = useCallback(async () => {
    setConnectionsLoading(true);
    try {
      const res = await fetch('/api/market/connections');
      const data = await res.json();
      setConnections(data);
    } catch {
      toast.error('خطأ في فحص الاتصالات');
    } finally {
      setConnectionsLoading(false);
    }
  }, []);

  // Fetch DB health
  const fetchDbHealth = useCallback(async () => {
    setDbHealthLoading(true);
    try {
      const res = await fetch('/api/system/db-health');
      const data = await res.json();
      setDbHealth(data);
    } catch {
      toast.error('خطأ في فحص قاعدة البيانات');
    } finally {
      setDbHealthLoading(false);
    }
  }, []);

  // Sync data
  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/market/sync-live', {
        method: 'POST',
        headers: { 'x-force-refresh': 'true' },
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`تمت المزامنة: ${data.updated_count} سهم محدث`);
        fetchStats();
        fetchConnections();
      } else {
        toast.error(data.details?.errors?.[0] || 'فشلت المزامنة');
      }
    } catch {
      toast.error('خطأ في المزامنة');
    } finally {
      setSyncing(false);
    }
  };

  // Set user plan
  const handleSetPlan = async (userId: string, planName: string) => {
    setActionLoading(`plan-${userId}`);
    try {
      const res = await adminFetch('/api/admin/subscription/set-plan', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, plan_name: planName }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        fetchUsers();
      } else {
        toast.error(data.error || 'فشل في تحديث الباقة');
      }
    } catch {
      toast.error('خطأ في الاتصال');
    } finally {
      setActionLoading(null);
    }
  };

  // Toggle user active status
  const handleToggleActive = async (userId: string, currentStatus: boolean) => {
    setActionLoading(`active-${userId}`);
    try {
      const res = await adminFetch('/api/admin/subscription/set-plan', {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId,
          plan_name: 'free',
          activate: !currentStatus,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(currentStatus ? 'تم تعطيل المستخدم' : 'تم تفعيل المستخدم');
        fetchUsers();
      } else {
        toast.error(data.error || 'فشل في تحديث الحالة');
      }
    } catch {
      toast.error('خطأ في الاتصال');
    } finally {
      setActionLoading(null);
    }
  };

  // Upload data for AI analysis
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await adminFetch('/api/import', {
        method: 'POST',
        body: formData,
      });
      // Note: adminFetch sets Content-Type to json, we need to override for FormData
      // Use regular fetch with token for file uploads
      const token = generateAdminToken();
      const res2 = await fetch('/api/import', {
        method: 'POST',
        headers: { 'X-Admin-Token': token },
        body: formData,
      });
      const data = await res2.json();
      if (data.success) {
        toast.success('تم رفع الملف بنجاح');
      } else {
        toast.error(data.error || 'فشل في رفع الملف');
      }
    } catch {
      toast.error('خطأ في رفع الملف');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Export data
  const handleExport = async (type: string) => {
    try {
      const token = generateAdminToken();
      const res = await fetch(`/api/export?type=${type}&format=json`, {
        headers: { 'X-Admin-Token': token },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `egx_${type}_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('تم تصدير البيانات بنجاح');
    } catch {
      toast.error('فشل في تصدير البيانات');
    }
  };

  // Toggle error detail expansion
  const toggleError = (id: number) => {
    setExpandedErrors(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (isAdminUser) {
      fetchStats();
      fetchConnections();
      fetchMonitorData();
      fetchAnalytics();
    }
  }, [isAdminUser, fetchStats, fetchConnections, fetchMonitorData, fetchAnalytics]);

  useEffect(() => {
    if (isAdminUser && activeTab === 'users') {
      fetchUsers();
    }
  }, [isAdminUser, activeTab, fetchUsers]);

  useEffect(() => {
    if (isAdminUser && activeTab === 'database') {
      fetchDbHealth();
    }
  }, [isAdminUser, activeTab, fetchDbHealth]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (isAdminUser) {
      autoRefreshRef.current = setInterval(() => {
        fetchStats();
        fetchAnalytics();
      }, 60000);
    }
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [isAdminUser, fetchStats, fetchAnalytics]);

  // ---- Admin Guard ----
  if (!isAdminUser) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" dir="rtl">
        <Card className="w-full max-w-md text-center">
          <CardContent className="p-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center">
              <Shield className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">ليس لديك صلاحية الوصول</h2>
            <p className="text-muted-foreground text-sm">
              هذه الصفحة متاحة لصاحب المنصة فقط.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Helpers ----
  const vpsStatus = connections?.sources?.vps_python;
  const dbStatus = connections?.sources?.database;
  const isVpsConnected = vpsStatus?.available === true;
  const isDbOk = dbStatus?.available === true;
  const lastUpdate = stats?.stocks?.last_update;
  const dataAge = lastUpdate ? Date.now() - new Date(lastUpdate).getTime() : null;
  const dataAgeMinutes = dataAge !== null ? Math.floor(dataAge / 60000) : null;
  const isDataFresh = dataAgeMinutes !== null && dataAgeMinutes < 60;

  // Peak hours data for simple bar chart
  const maxPeakCount = useMemo(() => {
    if (!analytics?.peak_hours?.length) return 1;
    return Math.max(...analytics.peak_hours.map(h => h.count), 1);
  }, [analytics?.peak_hours]);

  const tabs: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'نظرة عامة', icon: <Activity className="w-4 h-4 ml-1" /> },
    { id: 'users', label: 'المستخدمين', icon: <Users className="w-4 h-4 ml-1" /> },
    { id: 'traffic', label: 'الزيارات', icon: <BarChart3 className="w-4 h-4 ml-1" /> },
    { id: 'errors', label: 'المشاكل', icon: <Bug className="w-4 h-4 ml-1" /> },
    { id: 'database', label: 'قاعدة البيانات', icon: <Database className="w-4 h-4 ml-1" /> },
    { id: 'data', label: 'إدارة البيانات', icon: <Upload className="w-4 h-4 ml-1" /> },
  ];

  return (
    <div className="min-h-screen p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">لوحة تحكم المدير</h1>
            <p className="text-xs text-muted-foreground">مراقبة وإدارة منصة استثمار EGX</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="default" className="bg-emerald-600 text-white text-xs">
            <Shield className="w-3 h-3 ml-1" />
            مدير النظام
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { fetchStats(); fetchAnalytics(); fetchConnections(); }}
            disabled={statsLoading}
            className="gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${statsLoading ? 'animate-spin' : ''}`} />
            تحديث الكل
          </Button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6 flex-wrap overflow-x-auto pb-1">
        {tabs.map(tab => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
            className="whitespace-nowrap"
          >
            {tab.icon}
            {tab.label}
            {tab.id === 'errors' && analytics?.summary?.today_errors > 0 && (
              <Badge variant="destructive" className="mr-1 text-[9px] px-1 py-0 min-w-[18px] text-center">
                {analytics.summary.today_errors}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {/* ==================== OVERVIEW TAB ==================== */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Stats Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Users */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950/30 flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                {statsLoading ? (
                  <Skeleton className="h-6 w-8" />
                ) : (
                  <span className="text-2xl font-bold text-foreground">
                    {stats?.users?.total ?? 0}
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-foreground">إجمالي المستخدمين</p>
              <p className="text-xs text-muted-foreground">
                {statsLoading ? (
                  <Skeleton className="h-3 w-24 mt-1" />
                ) : (
                  `${stats?.users?.active ?? 0} نشط · ${stats?.users?.premium ?? 0} بريميوم`
                )}
              </p>
            </Card>

            {/* Today Page Views */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-950/30 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                </div>
                {analyticsLoading ? (
                  <Skeleton className="h-6 w-8" />
                ) : (
                  <span className="text-2xl font-bold text-foreground">
                    {analytics?.summary?.today_page_views ?? 0}
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-foreground">زيارات اليوم</p>
              <p className="text-xs text-muted-foreground">
                {analyticsLoading ? (
                  <Skeleton className="h-3 w-24 mt-1" />
                ) : (
                  `${analytics?.summary?.today_unique_users ?? 0} مستخدم فريد · ${analytics?.summary?.today_unique_ips ?? 0} IP`
                )}
              </p>
            </Card>

            {/* Active Stocks */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                {statsLoading ? (
                  <Skeleton className="h-6 w-8" />
                ) : (
                  <span className="text-2xl font-bold text-foreground">
                    {stats?.stocks?.active ?? 0}
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-foreground">الأسهم النشطة</p>
              <p className="text-xs text-muted-foreground">
                {statsLoading ? (
                  <Skeleton className="h-3 w-24 mt-1" />
                ) : (
                  `${stats?.stocks?.sectors ?? 0} قطاع · {(stats?.stocks?.price_history_points ?? 0).toLocaleString('ar-EG')} نقطة بيانات`
                )}
              </p>
            </Card>

            {/* System Status */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  connectionsLoading
                    ? 'bg-gray-100 dark:bg-gray-800'
                    : isVpsConnected && isDbOk
                      ? 'bg-green-100 dark:bg-green-950/30'
                      : 'bg-red-100 dark:bg-red-950/30'
                }`}>
                  {connectionsLoading ? (
                    <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                  ) : isVpsConnected && isDbOk ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                  )}
                </div>
                <Badge variant={isVpsConnected && isDbOk ? 'default' : 'destructive'} className="text-[10px]">
                  {connectionsLoading ? 'جاري الفحص...' : isVpsConnected && isDbOk ? 'يعمل بشكل طبيعي' : 'مشكلة'}
                </Badge>
              </div>
              <p className="text-sm font-medium text-foreground">حالة النظام</p>
              <p className="text-xs text-muted-foreground">
                {statsLoading ? (
                  <Skeleton className="h-3 w-24 mt-1" />
                ) : lastUpdate ? (
                  `آخر تحديث: منذ ${dataAgeMinutes ?? '—'} دقيقة`
                ) : 'لا توجد بيانات'}
              </p>
            </Card>
          </div>

          {/* Second row: Traffic chart + Top sections */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Peak Hours (simple bar chart) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock className="w-4 h-4" />
                  ذروة النشاط (7 أيام)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analyticsLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : analytics?.peak_hours && analytics.peak_hours.length > 0 ? (
                  <div className="space-y-1.5">
                    {analytics.peak_hours.map(h => (
                      <div key={h.hour} className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-10 text-left" dir="ltr">
                          {String(h.hour).padStart(2, '0')}:00
                        </span>
                        <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-l from-emerald-500 to-teal-500 rounded-full transition-all duration-500"
                            style={{ width: `${(h.count / maxPeakCount) * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-medium w-6 text-left" dir="ltr">{h.count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">لا توجد بيانات بعد</p>
                )}
              </CardContent>
            </Card>

            {/* Most Visited Sections */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe className="w-4 h-4" />
                  أكثر الأقسام زيارة (7 أيام)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analyticsLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : analytics?.page_views_by_section && analytics.page_views_by_section.length > 0 ? (
                  <div className="space-y-2">
                    {analytics.page_views_by_section.slice(0, 8).map((s, idx) => {
                      const maxCount = analytics.page_views_by_section[0].count || 1;
                      return (
                        <div key={s.view} className="flex items-center gap-3">
                          <span className="text-xs font-bold text-muted-foreground w-5">{idx + 1}</span>
                          <span className="text-sm min-w-[100px]">{VIEW_NAMES_AR[s.view] || s.view}</span>
                          <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-l from-blue-500 to-indigo-500 rounded-full transition-all duration-500"
                              style={{ width: `${(s.count / maxCount) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium" dir="ltr">{s.count.toLocaleString('ar-EG')}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">لا توجد بيانات بعد</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Quick Actions + Platform stats */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Zap className="w-4 h-4" />
                  إجراءات سريعة
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleSync} disabled={syncing} size="sm" className="gap-1">
                    {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    مزامنة البيانات
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setActiveTab('traffic')} className="gap-1">
                    <BarChart3 className="w-3.5 h-3.5" /> الزيارات
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setActiveTab('errors')} className="gap-1">
                    <Bug className="w-3.5 h-3.5" /> المشاكل
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setActiveTab('data')} className="gap-1">
                    <Upload className="w-3.5 h-3.5" /> رفع بيانات
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setActiveTab('users')} className="gap-1">
                    <Users className="w-3.5 h-3.5" /> المستخدمين
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setActiveTab('database')} className="gap-1">
                    <Database className="w-3.5 h-3.5" /> قاعدة البيانات
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Platform Info */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Monitor className="w-4 h-4" />
                  معلومات المنصة
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                    <span className="text-sm">حالة VPS</span>
                    <div className="flex items-center gap-1">
                      {isVpsConnected ? <Wifi className="w-3.5 h-3.5 text-green-500" /> : <WifiOff className="w-3.5 h-3.5 text-red-500" />}
                      <Badge variant={isVpsConnected ? 'default' : 'destructive'} className="text-[10px]">
                        {isVpsConnected ? 'متصل' : 'غير متصل'}
                      </Badge>
                      {vpsStatus?.latency_ms && <span className="text-[10px] text-muted-foreground" dir="ltr">{vpsStatus.latency_ms}ms</span>}
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                    <span className="text-sm">حالة البيانات</span>
                    <Badge variant={isDataFresh ? 'default' : 'secondary'} className="text-[10px]">
                      {dataAgeMinutes !== null ? `منذ ${dataAgeMinutes} د` : '—'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                    <span className="text-sm">عناصر المراقبة</span>
                    <span className="text-sm font-medium">{(stats?.platform?.watchlist_items ?? 0).toLocaleString('ar-EG')}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                    <span className="text-sm">عناصر المحفظة</span>
                    <span className="text-sm font-medium">{(stats?.platform?.portfolio_items ?? 0).toLocaleString('ar-EG')}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                    <span className="text-sm">أخطاء اليوم</span>
                    <Badge variant={(analytics?.summary?.today_errors ?? 0) > 0 ? 'destructive' : 'default'} className="text-[10px]">
                      {analytics?.summary?.today_errors ?? 0}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Users Preview */}
          {stats?.users?.recent && stats.users.recent.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Clock className="w-4 h-4" />
                    آخر المستخدمين المسجلين
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setActiveTab('users')}>
                    عرض الكل
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {stats.users.recent.map((u, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-bold">
                            {(u.name || u.email).charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{u.name || u.email.split('@')[0]}</p>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant={u.subscription_tier === 'premium' ? 'default' : 'secondary'} className="text-[10px]">
                          {u.subscription_tier === 'premium' ? (
                            <><Crown className="w-3 h-3 ml-0.5" /> بريميوم</>
                          ) : (
                            'مجاني'
                          )}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground hidden sm:block">
                          {new Date(u.created_at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ==================== USERS TAB ==================== */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {/* User Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-blue-600">{stats?.users?.total ?? 0}</p>
              <p className="text-xs text-muted-foreground">إجمالي المستخدمين</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{stats?.users?.active ?? 0}</p>
              <p className="text-xs text-muted-foreground">مستخدم نشط</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-amber-600">{stats?.users?.premium ?? 0}</p>
              <p className="text-xs text-muted-foreground">بريميوم</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-purple-600">{analytics?.active_users_weekly?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground">نشط هذا الأسبوع</p>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="w-4 h-4" />
                    إدارة المستخدمين
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {usersLoading ? 'جاري التحميل...' : `${users.length} مستخدم مسجل`}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="بحث..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      className="h-8 text-xs w-[180px] pr-8"
                    />
                  </div>
                  <Button variant="outline" size="sm" onClick={fetchUsers} disabled={usersLoading} className="gap-1">
                    <RefreshCw className={`w-3.5 h-3.5 ${usersLoading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>{userSearch ? 'لا توجد نتائج' : 'لا يوجد مستخدمون مسجلون'}</p>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto rounded-lg border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead className="text-right">البريد الإلكتروني</TableHead>
                        <TableHead className="text-right">الاسم</TableHead>
                        <TableHead className="text-right">الباقة</TableHead>
                        <TableHead className="text-right">تغيير الباقة</TableHead>
                        <TableHead className="text-right">الحالة</TableHead>
                        <TableHead className="text-right">إجراء</TableHead>
                        <TableHead className="text-right">آخر دخول</TableHead>
                        <TableHead className="text-right">التسجيل</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className="text-right font-mono text-xs max-w-[180px] truncate">
                            {u.email}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {u.name || u.username || '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge {...TIER_STYLES[u.subscription_tier] || TIER_STYLES.free}>
                              {u.subscription_tier === 'premium' ? (
                                <><Crown className="w-3 h-3 ml-0.5" /> بريميوم</>
                              ) : u.subscription_tier === 'plus' ? (
                                <><Star className="w-3 h-3 ml-0.5" /> بلس</>
                              ) : (
                                'مجاني'
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Select
                              value={u.subscription_tier}
                              onValueChange={(val) => handleSetPlan(u.id, val)}
                              disabled={actionLoading === `plan-${u.id}`}
                            >
                              <SelectTrigger className="w-[120px] h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="free">مجاني</SelectItem>
                                <SelectItem value="plus">بلس</SelectItem>
                                <SelectItem value="premium">بريميوم</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={u.is_active ? 'default' : 'destructive'} className="text-[10px]">
                              {u.is_active ? (
                                <><UserCheck className="w-3 h-3 ml-0.5" /> نشط</>
                              ) : (
                                <><UserX className="w-3 h-3 ml-0.5" /> معطّل</>
                              )}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant={u.is_active ? 'destructive' : 'default'}
                              size="sm"
                              className="h-7 text-[10px] px-2"
                              onClick={() => handleToggleActive(u.id, u.is_active)}
                              disabled={actionLoading === `active-${u.id}`}
                            >
                              {actionLoading === `active-${u.id}` ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : u.is_active ? 'تعطيل' : 'تفعيل'}
                            </Button>
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                            {u.last_login
                              ? new Date(u.last_login).toLocaleString('ar-EG', {
                                  hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short',
                                })
                              : 'لم يسجل دخولاً'}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(u.created_at).toLocaleDateString('ar-EG', {
                              day: 'numeric', month: 'short', year: 'numeric',
                            })}
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
      )}

      {/* ==================== TRAFFIC TAB ==================== */}
      {activeTab === 'traffic' && (
        <div className="space-y-4">
          {/* Today's Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-blue-600">{analytics?.summary?.today_page_views ?? 0}</p>
              <p className="text-xs text-muted-foreground">زيارات اليوم</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{analytics?.summary?.today_unique_users ?? 0}</p>
              <p className="text-xs text-muted-foreground">مستخدمون فريدون</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-purple-600">{analytics?.summary?.today_unique_ips ?? 0}</p>
              <p className="text-xs text-muted-foreground">عناوين IP فريدة</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-amber-600">{analytics?.summary?.today_errors ?? 0}</p>
              <p className="text-xs text-muted-foreground">أخطاء اليوم</p>
            </Card>
          </div>

          {/* Daily Traffic Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="w-4 h-4" />
                  حركة الزيارات اليومية (30 يوم)
                </CardTitle>
                <Button variant="outline" size="sm" onClick={fetchAnalytics} disabled={analyticsLoading} className="gap-1">
                  <RefreshCw className={`w-3.5 h-3.5 ${analyticsLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {analyticsLoading ? (
                <Skeleton className="h-60 w-full" />
              ) : analytics?.daily_traffic && analytics.daily_traffic.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border max-h-[400px] overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead className="text-right">التاريخ</TableHead>
                        <TableHead className="text-right">إجمالي الأحداث</TableHead>
                        <TableHead className="text-right">زيارات الصفحات</TableHead>
                        <TableHead className="text-right">الأخطاء</TableHead>
                        <TableHead className="text-right">مستخدمون فريدون</TableHead>
                        <TableHead className="text-right">معدل الأخطاء</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analytics.daily_traffic.map((d, idx) => {
                        const errorRate = d.page_views > 0 ? ((d.errors / d.page_views) * 100).toFixed(1) : '0';
                        return (
                          <TableRow key={d.date + idx}>
                            <TableCell className="text-right text-sm">{d.date}</TableCell>
                            <TableCell className="text-right text-sm font-medium">{d.total.toLocaleString('ar-EG')}</TableCell>
                            <TableCell className="text-right text-sm">{d.page_views.toLocaleString('ar-EG')}</TableCell>
                            <TableCell className="text-right text-sm">
                              <span className={Number(d.errors) > 10 ? 'text-red-600 font-medium' : ''}>
                                {d.errors}
                              </span>
                            </TableCell>
                            <TableCell className="text-right text-sm">{d.unique_users}</TableCell>
                            <TableCell className="text-right">
                              <Badge
                                variant={Number(errorRate) > 10 ? 'destructive' : Number(errorRate) > 5 ? 'secondary' : 'default'}
                                className="text-[10px]"
                              >
                                {errorRate}%
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">لا توجد بيانات كافية بعد. سيتم عرض البيانات مع استخدام الموقع.</p>
              )}
            </CardContent>
          </Card>

          {/* Active Users This Week */}
          {analytics?.active_users_weekly && analytics.active_users_weekly.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="w-4 h-4" />
                  المستخدمون النشطون هذا الأسبوع
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {analytics.active_users_weekly.map((u, idx) => (
                    <div key={u.user_id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-muted-foreground w-5">{idx + 1}</span>
                        <span className="text-sm font-medium font-mono">{u.user_id.slice(0, 12)}...</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{u.visits} زيارة</span>
                        <span className="text-[10px] text-muted-foreground">
                          {u.last_seen ? new Date(u.last_seen).toLocaleString('ar-EG', {
                            hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short',
                          }) : '—'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ==================== ERRORS TAB ==================== */}
      {activeTab === 'errors' && (
        <div className="space-y-4">
          {/* Error Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-red-600">{analytics?.summary?.today_errors ?? 0}</p>
              <p className="text-xs text-muted-foreground">أخطاء اليوم</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-amber-600">{analytics?.recent_errors?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground">أخطاء آخر 24 ساعة</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold text-blue-600">{analytics?.summary?.today_page_views ?? 0}</p>
              <p className="text-xs text-muted-foreground">إجمالي الزيارات</p>
            </Card>
            <Card className="p-3 text-center">
              <p className="text-2xl font-bold">
                {analytics && analytics.summary.today_page_views > 0
                  ? ((analytics.summary.today_errors / analytics.summary.today_page_views) * 100).toFixed(1)
                  : '0'}%
              </p>
              <p className="text-xs text-muted-foreground">معدل الأخطاء</p>
            </Card>
          </div>

          {/* Errors by View */}
          {analytics?.errors_by_view && analytics.errors_by_view.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers className="w-4 h-4" />
                  الأخطاء حسب القسم (7 أيام)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {analytics.errors_by_view.map((e, idx) => {
                    const maxCount = analytics.errors_by_view[0].count || 1;
                    return (
                      <div key={e.view + idx} className="flex items-center gap-3">
                        <span className="text-sm min-w-[100px]">{VIEW_NAMES_AR[e.view] || e.view || 'غير محدد'}</span>
                        <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-l from-red-500 to-orange-500 rounded-full transition-all"
                            style={{ width: `${(e.count / maxCount) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-red-600">{e.count}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Errors Detail */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bug className="w-4 h-4" />
                  تفاصيل الأخطاء (آخر 24 ساعة)
                </CardTitle>
                <Button variant="outline" size="sm" onClick={fetchAnalytics} className="gap-1">
                  <RefreshCw className="w-3.5 h-3.5" /> تحديث
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {analyticsLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : analytics?.recent_errors && analytics.recent_errors.length > 0 ? (
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {analytics.recent_errors.map(err => (
                    <div key={err.id} className="border rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleError(err.id)}
                        className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-right"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                          <span className="text-sm font-medium truncate">
                            {VIEW_NAMES_AR[err.view || ''] || err.view || 'غير محدد'}
                            {err.action ? ` — ${err.action}` : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[10px] text-muted-foreground" dir="ltr">
                            {err.created_at ? new Date(err.created_at).toLocaleString('ar-EG', {
                              hour: '2-digit', minute: '2-digit',
                            }) : ''}
                          </span>
                          {expandedErrors.has(err.id) ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </div>
                      </button>
                      {expandedErrors.has(err.id) && (
                        <div className="px-3 pb-3 space-y-1.5 bg-muted/30">
                          {err.detail && (
                            <p className="text-xs text-red-600 break-all">{err.detail}</p>
                          )}
                          {err.user_agent && (
                            <p className="text-[10px] text-muted-foreground break-all">{err.user_agent}</p>
                          )}
                          {err.ip_hash && (
                            <p className="text-[10px] text-muted-foreground" dir="ltr">IP: {err.ip_hash}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-500 opacity-50" />
                  <p>لا توجد أخطاء مسجلة في آخر 24 ساعة</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ==================== DATABASE TAB ==================== */}
      {activeTab === 'database' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Database className="w-4 h-4" />
                    فحص صحة قواعد البيانات
                  </CardTitle>
                  <CardDescription className="mt-1">
                    فحص حالة sql.js و قواعد البيانات الخفيفة والثقيلة
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={fetchDbHealth} disabled={dbHealthLoading} className="gap-1">
                  <RefreshCw className={`w-3.5 h-3.5 ${dbHealthLoading ? 'animate-spin' : ''}`} />
                  فحص الآن
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {dbHealthLoading ? (
                <div className="space-y-4">
                  {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : dbHealth ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-2">
                      {dbHealth.sql_js_initialized ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-red-500" />
                      )}
                      <span className="text-sm font-medium">sql.js WASM</span>
                    </div>
                    <Badge variant={dbHealth.sql_js_initialized ? 'default' : 'destructive'} className="text-[10px]">
                      {dbHealth.sql_js_initialized ? 'مُهيأ' : 'غير مُهيأ'}
                    </Badge>
                  </div>

                  <div className="p-4 rounded-lg border">
                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Database className="w-4 h-4 text-emerald-500" />
                      قاعدة البيانات الخفيفة (custom.db)
                    </h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">الحالة</span>
                        <Badge variant={dbHealth.light_db?.loaded ? 'default' : 'destructive'} className="text-[10px]">
                          {dbHealth.light_db?.loaded ? 'محمّلة' : 'غير محمّلة'}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">إجمالي الأسهم</span>
                        <span className="font-medium" dir="ltr">{(dbHealth.light_db?.total_stocks ?? 0).toLocaleString('ar-EG')}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">الأسهم النشطة</span>
                        <span className="font-medium" dir="ltr">{(dbHealth.light_db?.active_stocks ?? 0).toLocaleString('ar-EG')}</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg border">
                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Database className="w-4 h-4 text-amber-500" />
                      قاعدة البيانات الرئيسية (egx_investment.db)
                    </h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">الحالة</span>
                        <Badge variant={dbHealth.heavy_db?.loaded ? 'default' : 'destructive'} className="text-[10px]">
                          {dbHealth.heavy_db?.loaded ? 'محمّلة' : 'غير محمّلة'}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">نقاط التاريخ السعرى</span>
                        <span className="font-medium" dir="ltr">{(dbHealth.heavy_db?.stock_price_history_rows ?? 0).toLocaleString('ar-EG')}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">أسهم لها بيانات تاريخية</span>
                        <span className="font-medium" dir="ltr">{(dbHealth.heavy_db?.distinct_stocks_with_history ?? 0).toLocaleString('ar-EG')}</span>
                      </div>
                      {dbHealth.heavy_db?.error && (
                        <div className="mt-2 p-2 rounded bg-red-50 dark:bg-red-950/20 text-xs text-red-600 dark:text-red-400">
                          خطأ: {String(dbHealth.heavy_db.error)}
                        </div>
                      )}
                    </div>
                  </div>

                  <p className="text-[10px] text-muted-foreground text-center">
                    آخر فحص: {new Date(dbHealth.timestamp).toLocaleString('ar-EG')}
                  </p>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Database className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">اضغط &quot;فحص الآن&quot; لفحص حالة قواعد البيانات</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ==================== DATA MANAGEMENT TAB ==================== */}
      {activeTab === 'data' && (
        <div className="space-y-4">
          {/* Upload Data */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Upload className="w-4 h-4" />
                رفع بيانات للتحليل بالذكاء الاصطناعي
              </CardTitle>
              <CardDescription>
                يمكنك رفع ملفات البيانات (JSON, CSV) لتحليلها باستخدام الذكاء الاصطناعي وتحسين التوصيات
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div
                  className="border-2 border-dashed rounded-lg p-8 text-center hover:border-emerald-500 transition-colors cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.csv,.xlsx"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  {uploading ? (
                    <div className="space-y-3">
                      <Loader2 className="w-10 h-10 mx-auto text-emerald-500 animate-spin" />
                      <p className="text-sm text-muted-foreground">جاري رفع الملف...</p>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                      <p className="text-sm font-medium">اضغط لاختيار ملف أو اسحب الملف هنا</p>
                      <p className="text-xs text-muted-foreground mt-1">JSON, CSV - حتى 10 ميجابايت</p>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Export Data */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Download className="w-4 h-4" />
                تصدير البيانات
              </CardTitle>
              <CardDescription>
                تصدير بيانات المنصة بتنسيق JSON للاستخدام في التحليل الخارجي
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Button
                  variant="outline"
                  className="h-auto py-4 flex-col gap-2"
                  onClick={() => handleExport('stocks')}
                >
                  <FileText className="w-6 h-6" />
                  <span className="text-sm">بيانات الأسهم</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-auto py-4 flex-col gap-2"
                  onClick={() => handleExport('watchlist')}
                >
                  <Eye className="w-6 h-6" />
                  <span className="text-sm">قوائم المراقبة</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-auto py-4 flex-col gap-2"
                  onClick={() => handleExport('ai-adjustment')}
                >
                  <TrendingUp className="w-6 h-6" />
                  <span className="text-sm">التوصيات المعدلة</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-auto py-4 flex-col gap-2"
                  onClick={() => handleExport('portfolio')}
                >
                  <Layers className="w-6 h-6" />
                  <span className="text-sm">المحافظ</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-auto py-4 flex-col gap-2"
                  onClick={() => handleExport('analytics')}
                >
                  <BarChart3 className="w-6 h-6" />
                  <span className="text-sm">بيانات التحليلات</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-auto py-4 flex-col gap-2"
                  onClick={handleSync}
                  disabled={syncing}
                >
                  {syncing ? <Loader2 className="w-6 h-6 animate-spin" /> : <RefreshCw className="w-6 h-6" />}
                  <span className="text-sm">مزامنة البيانات</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Feature Usage */}
          {analytics?.feature_usage && analytics.feature_usage.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Zap className="w-4 h-4" />
                  استخدام الميزات (7 أيام)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {analytics.feature_usage.map((f, idx) => {
                    const maxCount = analytics.feature_usage[0].count || 1;
                    return (
                      <div key={f.action + idx} className="flex items-center gap-3">
                        <span className="text-sm min-w-[120px]">{f.action}</span>
                        <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-l from-emerald-500 to-teal-500 rounded-full transition-all"
                            style={{ width: `${(f.count / maxCount) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium">{f.count}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
