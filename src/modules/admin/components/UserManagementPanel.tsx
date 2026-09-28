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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function UserManagementPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'delete' | null>(null);
  const [updating, setUpdating] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        pageSize: '500',
        ...(search ? { search } : {}),
        ...(roleFilter !== 'all' ? { role: roleFilter } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
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
  }, [search, roleFilter, statusFilter]);

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
      } catch {
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
      } catch {
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
      } catch {
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
    return { total, active, premium, admins };
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
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatBox label="إجمالي المستخدمين" value={stats.total} icon={<Users className="w-4 h-4 text-sky-500" />} />
            <StatBox label="نشط" value={stats.active} icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />} />
            <StatBox label="مميزين + أدمن" value={stats.premium} icon={<Crown className="w-4 h-4 text-amber-500" />} />
            <StatBox label="أدمن" value={stats.admins} icon={<ShieldCheck className="w-4 h-4 text-red-500" />} />
          </div>
        </CardContent>
      </Card>

      {/* Filters + Bulk actions */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <div className="relative">
              <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالبريد/الاسم/المعرّف..."
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
            <Button variant="ghost" onClick={() => { setSearch(''); setRoleFilter('all'); setStatusFilter('all'); }} className="gap-2">
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
                    <th className="p-2 font-medium">الحالة</th>
                    <th className="p-2 font-medium">آخر دخول</th>
                    <th className="p-2 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const isSelected = selected.has(u.id);
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
                            <Avatar className="w-8 h-8">
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
                            </div>
                          </div>
                        </td>
                        <td className="p-2 whitespace-nowrap">{roleBadge(u.role)}</td>
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
