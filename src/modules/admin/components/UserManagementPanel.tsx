'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Users, Search, Trash2, RefreshCw, Loader2, ShieldCheck, Crown, User as UserIcon,
  Mail, Clock, MoreVertical, Filter, UserCog, Power, CheckCircle2, XCircle,
  AlertTriangle,
  Ticket,
  Sparkles,
  Bot,
  CreditCard,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface AdminUser {
  id: string;
  email: string;
  username: string;
  name: string | null;
  image: string | null;
  role: 'admin' | 'premium' | 'user';
  status: 'active' | 'inactive';
  emailVerified: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  lastActive?: string | null;
  loginCount: number;
  isActive?: boolean;
  trialStatus?: {
    isInTrial: boolean;
    isInWarning: boolean;
    isTrialExpired: boolean;
    daysLeft: number;
    daysPassed: number;
  } | null;
  promoCode?: {
    id?: string;
    promo_code_id?: string;
    code: string;
    plan_tier: string;
    plan_label: string;
    premium_days: number;
    redeemed_at: string;
    expires_at: string | null;
    days_left: number;
    is_active: boolean;
    is_expired: boolean;
  } | null;
}

interface UsersResponse {
  success: boolean;
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  error?: string;
}

type Role = 'free' | 'premium' | 'admin';
type Status = 'active' | 'inactive' | 'suspended';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function roleBadge(role: string) {
  if (role === 'admin') return <Badge variant="destructive" className="gap-1"><Crown className="w-3 h-3" /> أدمن</Badge>;
  if (role === 'premium') return <Badge className="gap-1 bg-amber-500 hover:bg-amber-500"><ShieldCheck className="w-3 h-3" /> مميز</Badge>;
  return <Badge variant="outline" className="gap-1"><UserIcon className="w-3 h-3" /> مجاني</Badge>;
}

function promoBadge(promo: AdminUser['promoCode']) {
  if (!promo) return <span className="text-muted-foreground text-xs">—</span>;
  const isVip = promo.plan_tier === 'all' || promo.plan_tier === 'developer';
  const isPremium = promo.plan_tier === 'premium';
  return (
    <Badge
      className={cn(
        "gap-1 py-0.5 px-2 text-[11px] font-medium border shadow-xs transition-all",
        isVip
          ? "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/40"
          : isPremium
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40"
          : "bg-primary/15 text-primary dark:text-slate-300 border-primary/40"
      )}
    >
      <Ticket className="w-3 h-3 text-current shrink-0" />
      <span className="font-mono font-bold tracking-wider">{promo.code}</span>
      <span className="text-[10px] opacity-80 font-sans">({promo.plan_label})</span>
      {promo.is_active ? (
        <span className="text-[9px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-1 py-0.2 rounded font-mono">
          {promo.days_left > 365 ? '♾️' : `${promo.days_left}ي`}
        </span>
      ) : (
        <span className="text-[9px] bg-rose-500/20 text-rose-700 dark:text-rose-300 px-1 py-0.2 rounded font-sans">
          منتهي
        </span>
      )}
    </Badge>
  );
}

function statusBadge(status: string) {
  if (status === 'active') return <Badge variant="outline" className="gap-1 border-emerald-500 text-emerald-600"><CheckCircle2 className="w-3 h-3" /> نشط</Badge>;
  if (status === 'suspended') return <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600"><Power className="w-3 h-3" /> موقوف</Badge>;
  return <Badge variant="outline" className="gap-1 border-red-500 text-red-600"><XCircle className="w-3 h-3" /> غير نشط</Badge>;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return `منذ ${Math.floor(diffMs / 1000)} ث`;
  if (diffMs < 3_600_000) return `منذ ${Math.floor(diffMs / 60_000)} د`;
  if (diffMs < 86_400_000) return `منذ ${Math.floor(diffMs / 3_600_000)} س`;
  return `منذ ${Math.floor(diffMs / 86_400_000)} يوم`;
}

// GLM5.2-A (ADMIN-USER-MGMT): Member tenure — "مشترك منذ X شهر/يوم"
function memberTenure(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 1) return 'مشترك منذ اليوم';
  if (days < 30) return `مشترك منذ ${days} يوم`;
  const months = Math.floor(days / 30);
  if (months < 12) return `مشترك منذ ${months} ${months === 1 ? 'شهر' : months === 2 ? 'شهرين' : 'أشهر'}`;
  const years = Math.floor(months / 12);
  return `مشترك منذ ${years} ${years === 1 ? 'سنة' : 'سنوات'}`;
}

// Format exact Gregorian date for tooltip
function formatGregorian(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}

type SortKey = 'newest' | 'oldest' | 'lastActive' | 'role' | 'name';

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function UserManagementPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [promoFilter, setPromoFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'delete' | null>(null);
  const [updating, setUpdating] = useState(false);
  // GLM5.2-A (ADMIN-USER-MGMT): sorting state
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  // Task 28-B (Fix 8) — Fix Battalion: cleanup-expired dialog wired into the
  // new UserManagementPanel (was only in legacy UsersManagement.tsx before).
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<
    { dryRun: boolean; deleted: number; message: string; usersPreview?: Array<{ id: string; email: string }> } | null
  >(null);

  // PHASE2-ADMIN-PANEL: owner request — "مزامنة البوت". We poll
  // /api/admin/system-health (already used by SystemHealthCard) to get the
  // Telegram bot process status (pgrep -f telegram). Rule 27: if the field
  // is missing we show "—" — no fabrication.
  const [botStatus, setBotStatus] = useState<'online' | 'offline' | 'unknown'>('unknown');
  const [botLastSeen, setBotLastSeen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchBotStatus() {
      try {
        const res = await fetch('/api/admin/system-health', { credentials: 'same-origin' });
        const json = await res.json();
        if (cancelled || !json?.success) return;
        const svc = (json.services || []).find((s: any) => s.id === 'telegram_bot');
        if (svc) {
          setBotStatus(svc.status === 'online' ? 'online' : svc.status === 'offline' ? 'offline' : 'unknown');
          setBotLastSeen(svc.last_seen || null);
        }
      } catch { // silent fallback (safe-by-design)
        // silent — don't spam toast
      }
    }
    fetchBotStatus();
    const interval = setInterval(fetchBotStatus, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        pageSize: '500',
        ...(search ? { search } : {}),
        ...(roleFilter !== 'all' ? { role: roleFilter } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(promoFilter !== 'all' ? { promo: promoFilter } : {}),
      });
      const res = await fetch(`/api/admin/users?${params.toString()}`, { credentials: 'same-origin' });
      const json: UsersResponse = await res.json();
      if (json.success) {
        setUsers(json.users);
      } else {
        toast.error(json.error || 'فشل تحميل المستخدمين');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter, promoFilter]);

  // Task 28-B (Fix 8) — Fix Battalion: cleanup-expired handler
  // (mirrors UsersManagement.tsx handleCleanupExpired).
  const handleCleanupExpired = async (dryRun = false) => {
    setIsCleaningUp(true);
    try {
      const res = await fetch('/api/admin/users/cleanup-expired', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (data.success) {
        setCleanupResult({
          dryRun,
          deleted: data.deleted || 0,
          message: data.message || (dryRun ? 'معاينة فقط' : 'تم التنظيف'),
          usersPreview: dryRun && data.users ? data.users : undefined,
        });
        if (dryRun) {
          if (data.users?.length > 0) {
            toast.success(`سيتم حذف ${data.users.length} مستخدم. اضغط «حذف نهائي» للتأكيد.`);
          } else {
            toast.info(data.message || 'لا يوجد مستخدمين مؤهلين للحذف');
          }
        } else {
          toast.success(data.message || `تم حذف ${data.deleted} مستخدم`);
          fetchUsers(); // refresh the list after a real cleanup
        }
      } else {
        toast.error(data.error || 'فشل في التنظيف');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setIsCleaningUp(false);
      if (!dryRun) {
        setShowCleanupDialog(false);
      }
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => fetchUsers(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === users.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(users.map(u => u.id)));
    }
  };

  // GLM5.2-A (ADMIN-USER-MGMT): Sorted users memo — applies the selected sort
  const sortedUsers = useMemo(() => {
    const arr = [...users];
    switch (sortKey) {
      case 'newest':
        return arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      case 'oldest':
        return arr.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      case 'lastActive':
        return arr.sort((a, b) => {
          const aT = new Date(a.lastLoginAt || a.lastActive || 0).getTime();
          const bT = new Date(b.lastLoginAt || b.lastActive || 0).getTime();
          return bT - aT;
        });
      case 'role':
        return arr.sort((a, b) => {
          const order: Record<string, number> = { admin: 0, premium: 1, user: 2 };
          return (order[a.role] ?? 3) - (order[b.role] ?? 3);
        });
      case 'name':
        return arr.sort((a, b) => {
          const aName = (a.name || a.username || a.email || '').toLowerCase();
          const bName = (b.name || b.username || b.email || '').toLowerCase();
          return aName.localeCompare(bName);
        });
      default:
        return arr;
    }
  }, [users, sortKey]);

  // ---- Single user mutations ----

  const updateUser = async (id: string, patch: { role?: Role; status?: Status }) => {
    setUpdating(true);
    try {
      const body: Record<string, string> = {};
      if (patch.role) body.role = patch.role;
      if (patch.status === 'active') body.status = 'active';
      else if (patch.status === 'inactive') body.status = 'inactive';
      // suspended = inactive (we don't have a separate column)

      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم تحديث المستخدم بنجاح');
        // Update local state
        setUsers(prev => prev.map(u => {
          if (u.id !== id) return u;
          return {
            ...u,
            role: (patch.role as 'admin' | 'premium' | 'user') || u.role,
            status: patch.status === 'active' ? 'active' as const : 'inactive' as const,
          };
        }));
      } else {
        toast.error(json.error || 'فشل التحديث');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setUpdating(false);
    }
  };

  const deleteUser = async (id: string) => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم حذف المستخدم');
        setUsers(prev => prev.filter(u => u.id !== id));
        setSelected(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } else {
        toast.error(json.error || 'فشل الحذف');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setUpdating(false);
    }
  };

  // ---- Bulk mutations ----

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    setUpdating(true);
    let okCount = 0;
    let failCount = 0;
    const failedIds: string[] = [];
    // Sequential to avoid overwhelming the server
    for (const id of selected) {
      try {
        const res = await fetch(`/api/admin/users/${id}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        const json = await res.json();
        if (json.success) {
          okCount++;
        } else {
          failCount++;
          failedIds.push(id);
        }
      } catch { // silent fallback (safe-by-design)
        failCount++;
        failedIds.push(id);
      }
    }
    setUpdating(false);
    setBulkAction(null);
    if (okCount > 0) {
      toast.success(`تم حذف ${okCount} مستخدم`);
      setUsers(prev => prev.filter(u => !selected.has(u.id) || failedIds.includes(u.id)));
      setSelected(new Set(failedIds));
    }
    if (failCount > 0) {
      toast.error(`فشل حذف ${failCount} مستخدم`);
    }
  };

  const bulkUpdateStatus = async (status: Status) => {
    if (selected.size === 0) return;
    setUpdating(true);
    let okCount = 0;
    let failCount = 0;
    for (const id of selected) {
      try {
        const res = await fetch(`/api/admin/users/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ status }),
        });
        const json = await res.json();
        if (json.success) {
          okCount++;
          setUsers(prev => prev.map(u => u.id === id ? { ...u, status: status === 'active' ? 'active' as const : 'inactive' as const } : u));
        } else {
          failCount++;
        }
      } catch { // silent fallback (safe-by-design)
        failCount++;
      }
    }
    setUpdating(false);
    if (okCount > 0) toast.success(`تم تحديث حالة ${okCount} مستخدم إلى ${status === 'active' ? 'نشط' : 'غير نشط'}`);
    if (failCount > 0) toast.error(`فشل تحديث ${failCount} مستخدم`);
    setSelected(new Set());
  };

  const bulkUpdateTier = async (role: Role) => {
    if (selected.size === 0) return;
    setUpdating(true);
    let okCount = 0;
    let failCount = 0;
    for (const id of selected) {
      try {
        const res = await fetch(`/api/admin/users/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ role }),
        });
        const json = await res.json();
        if (json.success) {
          okCount++;
          setUsers(prev => prev.map(u => u.id === id ? { ...u, role: role === 'admin' ? 'admin' as const : role === 'premium' ? 'premium' as const : 'user' as const } : u));
        } else {
          failCount++;
        }
      } catch { // silent fallback (safe-by-design)
        failCount++;
      }
    }
    setUpdating(false);
    if (okCount > 0) toast.success(`تم تحديث ${okCount} مستخدم إلى ${role === 'admin' ? 'أدمن' : role === 'premium' ? 'مميز' : 'مجاني'}`);
    if (failCount > 0) toast.error(`فشل تحديث ${failCount} مستخدم`);
    setSelected(new Set());
  };

  // Stats
  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter(u => u.status === 'active').length;
    const premium = users.filter(u => u.role === 'premium' || u.role === 'admin').length;
    const admins = users.filter(u => u.role === 'admin').length;
    const withPromo = users.filter(u => !!u.promoCode).length;
    const activePromo = users.filter(u => u.promoCode && u.promoCode.is_active).length;
    // PHASE2-ADMIN-PANEL: tier breakdown — owner request:
    //   "جدول المستخدمين النشطين + مزامنة البوت + سجل المعاملات".
    //   Active subscribers per tier (only users with status='active').
    const activeByTier = {
      free: users.filter(u => u.status === 'active' && u.role === 'user').length,
      premium: users.filter(u => u.status === 'active' && u.role === 'premium').length,
      admin: users.filter(u => u.status === 'active' && u.role === 'admin').length,
      vip: users.filter(u => u.status === 'active' && u.promoCode && (u.promoCode.plan_tier === 'all' || u.promoCode.plan_tier === 'developer')).length,
    };
    return { total, active, premium, admins, withPromo, activePromo, activeByTier };
  }, [users]);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header + Stats */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-500" />
                إدارة المستخدمين
              </CardTitle>
              <CardDescription className="mt-1">
                عرض كل المستخدمين + تغيير الحالة / الاشتراك + حذف جماعي.
              </CardDescription>
            </div>
            <Button onClick={fetchUsers} disabled={loading} variant="outline" size="sm" className="gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              تحديث
            </Button>
            {/* Task 28-B (Fix 8) — Fix Battalion: cleanup-expired in new UserManagementPanel */}
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-amber-500 text-amber-700 hover:bg-amber-50"
              onClick={() => { setCleanupResult(null); setShowCleanupDialog(true); }}
            >
              <Trash2 className="w-4 h-4" />
              تنظيف المنتهي الفترة
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatBox label="إجمالي المستخدمين" value={stats.total} icon={<Users className="w-4 h-4 text-sky-500" />} />
            <StatBox label="نشط" value={stats.active} icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />} />
            <StatBox label="مميزين + أدمن" value={stats.premium} icon={<Crown className="w-4 h-4 text-amber-500" />} />
            <StatBox label="مشتركو البرومو كود" value={`${stats.withPromo} (${stats.activePromo} نشط)`} icon={<Ticket className="w-4 h-4 text-purple-500" />} />
            <StatBox label="أدمن" value={stats.admins} icon={<ShieldCheck className="w-4 h-4 text-red-500" />} />
          </div>

          {/* PHASE2-ADMIN-PANEL: Active subscribers per tier + Bot sync +
              Paymob transaction log placeholder — owner request:
              "جدول المستخدمين النشطين + مزامنة البوت + سجل المعاملات" */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            {/* Active subscribers per tier */}
            <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">المشتركون النشطون حسب الباقة</span>
                <Users className="w-3.5 h-3.5 text-emerald-500" />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <TierStat label="مجاني" value={stats.activeByTier.free} color="text-slate-600 dark:text-slate-300" />
                <TierStat label="مميز" value={stats.activeByTier.premium} color="text-amber-600" />
                <TierStat label="أدمن" value={stats.activeByTier.admin} color="text-red-600" />
                <TierStat label="VIP" value={stats.activeByTier.vip} color="text-purple-600" />
              </div>
            </div>

            {/* Bot sync status — uses /api/admin/system-health (pgrep telegram) */}
            <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">مزامنة Telegram Bot</span>
                <Bot className="w-3.5 h-3.5 text-cyan-500" />
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    botStatus === 'online' ? 'bg-emerald-500' : botStatus === 'offline' ? 'bg-red-500' : 'bg-slate-400'
                  )}
                />
                <span className="font-bold">
                  {botStatus === 'online' ? 'متصل ويعمل' : botStatus === 'offline' ? 'متوقف' : 'غير معروف'}
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                آخر نشاط: {botLastSeen ? new Date(botLastSeen).toLocaleString('ar-EG') : '—'}
              </div>
            </div>

            {/* Paymob transaction log placeholder — no Paymob API exists yet.
                Rule 27: don't fabricate transactions. Show clear "coming soon"
                message per owner instructions. */}
            <div className="p-3 rounded-lg bg-muted/30 border border-dashed border-border/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">سجل معاملات Paymob</span>
                <CreditCard className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <div className="text-xs text-muted-foreground italic">
                💳 سيتوفر قريباً
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                تكامل Paymob لم يُفعّل بعد. ستظهر هنا معاملات الاشتراكات تلقائياً.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters + Bulk actions */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <div className="relative">
              <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالبريد/الاسم/المعرّف/كود الخصم..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-8"
              />
            </div>
            <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as 'all' | Role)}>
              <SelectTrigger><SelectValue placeholder="الدور" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأدوار</SelectItem>
                <SelectItem value="free">مجاني</SelectItem>
                <SelectItem value="premium">مميز</SelectItem>
                <SelectItem value="admin">أدمن</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | Status)}>
              <SelectTrigger><SelectValue placeholder="الحالة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="active">نشط</SelectItem>
                <SelectItem value="inactive">غير نشط</SelectItem>
              </SelectContent>
            </Select>
            <Select value={promoFilter} onValueChange={setPromoFilter}>
              <SelectTrigger className="border-purple-500/30"><SelectValue placeholder="البرومو كود" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأكواد (الكل)</SelectItem>
                <SelectItem value="with_promo">مشتركون بكود 🎟️</SelectItem>
                <SelectItem value="active_promo">كود نشط 🟢</SelectItem>
                <SelectItem value="expired_promo">كود منتهي 🔴</SelectItem>
                <SelectItem value="vip">كود VIP شامل ⭐</SelectItem>
                <SelectItem value="premium">كود المحترفين 🛡️</SelectItem>
                <SelectItem value="without_promo">بدون كود ⚪</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" onClick={() => { setSearch(''); setRoleFilter('all'); setStatusFilter('all'); setPromoFilter('all'); }} className="gap-2">
              <Filter className="w-4 h-4" /> مسح الفلاتر
            </Button>
          </div>

          {/* Bulk actions */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-muted/40 border">
              <span className="text-sm font-medium ml-2">
                تم اختيار {selected.size} مستخدم:
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={updating} className="gap-2">
                    <UserCog className="w-4 h-4" />
                    تغيير الدور
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>تعيين الدور لـ {selected.size} مستخدم</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => bulkUpdateTier('free')}>مجاني</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => bulkUpdateTier('premium')}>مميز</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => bulkUpdateTier('admin')}>أدمن</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="outline" disabled={updating} onClick={() => bulkUpdateStatus('active')} className="gap-2">
                <Power className="w-4 h-4 text-emerald-500" /> تفعيل
              </Button>
              <Button size="sm" variant="outline" disabled={updating} onClick={() => bulkUpdateStatus('inactive')} className="gap-2">
                <Power className="w-4 h-4 text-amber-500" /> تعطيل
              </Button>
              <Button size="sm" variant="destructive" disabled={updating} onClick={() => setBulkAction('delete')} className="gap-2">
                <Trash2 className="w-4 h-4" /> حذف الكل
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                إلغاء التحديد
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Users table */}
      <Card>
        <CardContent className="p-0">
          {/* GLM5.2-A: Sorting bar */}
          {!loading && users.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap p-3 border-b border-border bg-muted/20">
              <span className="text-[11px] font-bold text-muted-foreground ml-1">ترتيب حسب:</span>
              {[
                { key: 'newest' as SortKey, label: 'الأحدث انضماماً' },
                { key: 'oldest' as SortKey, label: 'الأقدم انضماماً' },
                { key: 'lastActive' as SortKey, label: 'آخر نشاط' },
                { key: 'role' as SortKey, label: 'الدور' },
                { key: 'name' as SortKey, label: 'أبجدياً' },
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setSortKey(opt.key)}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all',
                    sortKey === opt.key
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-card text-muted-foreground border-border hover:bg-muted',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          {loading && users.length === 0 ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              لا يوجد مستخدمون مطابقون للبحث.
            </div>
          ) : (
            <div className="max-h-[40rem] overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background z-10 shadow-sm">
                  <tr className="text-right border-b">
                    <th className="p-2 w-10">
                      <Checkbox
                        checked={selected.size === users.length && users.length > 0}
                        onCheckedChange={toggleSelectAll}
                        aria-label="تحديد الكل"
                      />
                    </th>
                    <th className="p-2 font-medium">المستخدم</th>
                    <th className="p-2 font-medium">الدور</th>
                    <th className="p-2 font-medium">البرومو كود والترقية</th>
                    <th className="p-2 font-medium">الحالة</th>
                    <th className="p-2 font-medium">آخر دخول</th>
                    <th className="p-2 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.map(u => {
                    const isSelected = selected.has(u.id);
                    const roleValue: Role = u.role === 'admin' ? 'admin' : u.role === 'premium' ? 'premium' : 'free';
                    return (
                      <tr key={u.id} className={cn(
                        'border-b hover:bg-muted/30',
                        isSelected && 'bg-primary/5',
                      )}>
                        <td className="p-2">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(u.id)}
                            aria-label={`تحديد ${u.username}`}
                          />
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {/* GLM5.2-A (Task 1): AvatarImage — صورة Google الحقيقية */}
                            <Avatar className="w-8 h-8 ring-1 ring-border/50">
                              <AvatarImage src={u.image || undefined} alt={u.name || u.username} />
                              <AvatarFallback className="text-xs">
                                {(u.username || u.email || '?').slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="font-medium truncate text-xs">{u.name || u.username}</div>
                              <div className="text-[11px] text-muted-foreground flex items-center gap-1 truncate" dir="ltr">
                                <Mail className="w-3 h-3" />
                                {u.email}
                              </div>
                              {/* GLM5.2-A (Task 2): Member tenure */}
                              <div
                                className="text-[9px] text-muted-foreground mt-0.5 cursor-help"
                                title={`تاريخ التسجيل: ${formatGregorian(u.createdAt)}`}
                              >
                                {memberTenure(u.createdAt)}
                              </div>
                            </div>
                          </div>
                        </td>
                        {/* GLM5.2-A (Task 3): Quick Role Changer — Select dropdown مباشر */}
                        <td className="p-2 whitespace-nowrap">
                          <Select
                            value={roleValue}
                            onValueChange={(val) => {
                              updateUser(u.id, { role: val as Role });
                            }}
                            disabled={updating}
                          >
                            <SelectTrigger className="h-7 w-[100px] text-[11px] font-semibold">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="free" className="text-xs">👤 مجاني</SelectItem>
                              <SelectItem value="premium" className="text-xs">🛡️ مميز</SelectItem>
                              <SelectItem value="admin" className="text-xs">👑 أدمن</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2 whitespace-nowrap">{promoBadge(u.promoCode)}</td>
                        <td className="p-2 whitespace-nowrap">{statusBadge(u.status)}</td>
                        <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {timeAgo(u.lastLoginAt || u.lastActive)}
                          </div>
                        </td>
                        <td className="p-2">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="h-7 w-7" disabled={updating}>
                                <MoreVertical className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-48">
                              <DropdownMenuLabel>تغيير الدور</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => updateUser(u.id, { role: 'free' })}>مجاني</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => updateUser(u.id, { role: 'premium' })}>مميز</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => updateUser(u.id, { role: 'admin' })}>أدمن</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuLabel>تغيير الحالة</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => updateUser(u.id, { status: 'active' })}>تفعيل</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => updateUser(u.id, { status: 'inactive' })}>تعطيل</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => updateUser(u.id, { status: 'suspended' })}>إيقاف مؤقت</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-red-600 focus:text-red-700"
                                onClick={() => {
                                  if (confirm(`حذف المستخدم "${u.email}"؟ لا يمكن التراجع.`)) {
                                    deleteUser(u.id);
                                  }
                                }}
                              >
                                <Trash2 className="w-4 h-4 ml-2" />
                                حذف المستخدم
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk delete confirmation */}
      <AlertDialog open={bulkAction === 'delete'} onOpenChange={(v) => !v && setBulkAction(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف الجماعي</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف <strong className="text-red-600">{selected.size}</strong> مستخدم نهائياً.
              لا يمكن التراجع عن هذا الإجراء. سيتم حذف كل بياناتهم (watchlist، portfolio، ...).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={bulkDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              حذف نهائي
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Task 28-B (Fix 8) — Fix Battalion: cleanup-expired AlertDialog */}
      <AlertDialog open={showCleanupDialog} onOpenChange={setShowCleanupDialog}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              تنظيف المستخدمين منتهي الفترة
            </AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف جميع المستخدمين المجانيين الذين انتهت فترة تجربتهم (30 يوم + 7 يوم تحذير)
              ولم يشتركوا. هذا الإجراء يحذف بياناتهم نهائياً من كل قواعد البيانات (auth +
              stocks + analytics).
              <br />
              <span className="text-red-500 text-sm">لا يمكن التراجع عن هذا الإجراء.</span>
              <br />
              <span className="text-xs text-muted-foreground mt-2 block">
                نصيحة: اضغط «معاينة» أولاً لرؤية من سيتم حذفه قبل الحذف الفعلي.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {cleanupResult?.dryRun && cleanupResult.usersPreview && cleanupResult.usersPreview.length > 0 && (
            <div className="max-h-40 overflow-y-auto bg-muted/40 rounded p-2">
              <p className="text-xs font-bold mb-1">سيتم حذف {cleanupResult.usersPreview.length} مستخدم:</p>
              <ul className="text-[11px] space-y-0.5">
                {cleanupResult.usersPreview.slice(0, 10).map((u, i) => (
                  <li key={u.id} className="font-mono" dir="ltr">
                    {i + 1}. {u.email}
                  </li>
                ))}
                {cleanupResult.usersPreview.length > 10 && (
                  <li className="text-muted-foreground">
                    + {cleanupResult.usersPreview.length - 10} أخرى
                  </li>
                )}
              </ul>
            </div>
          )}
          {cleanupResult?.dryRun && (!cleanupResult.usersPreview || cleanupResult.usersPreview.length === 0) && (
            <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded p-2 text-xs text-emerald-700 dark:text-emerald-400">
              {cleanupResult.message || 'لا يوجد مستخدمين مؤهلين للحذف حالياً.'}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>إغلاق</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => handleCleanupExpired(true)}
              disabled={isCleaningUp}
              className="gap-2"
            >
              {isCleaningUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              معاينة
            </Button>
            <AlertDialogAction
              onClick={() => handleCleanupExpired(false)}
              disabled={isCleaningUp}
              className="bg-red-600 hover:bg-red-700 text-white gap-2"
            >
              {isCleaningUp ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  جاري الحذف...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  حذف نهائي
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {updating && (
        <div className="fixed bottom-4 left-4 z-50 bg-background/95 border rounded-lg shadow-lg p-3 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
          <span className="text-sm">جاري التحديث...</span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small presentational helper                                       */
/* ------------------------------------------------------------------ */

function StatBox({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg bg-muted/40 border border-border/50">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

// PHASE2-ADMIN-PANEL: small stat for the tier-breakdown grid
function TierStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between p-1.5 rounded bg-background/50">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn('font-bold text-sm', color)}>{value}</span>
    </div>
  );
}
