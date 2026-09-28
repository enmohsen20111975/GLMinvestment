'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  UserPlus,
  Trash2,
  Edit,
  Search,
  MoreVertical,
  Mail,
  Phone,
  Calendar,
  Shield,
  Crown,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Eye,
  EyeOff,
  Key,
  Activity,
  TrendingUp,
  Heart,
  Bell,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getAdminToken } from '@/lib/admin-auth';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface UserDetails {
  id: string;
  email: string;
  username: string;
  name?: string;
  image?: string;
  role: 'user' | 'premium' | 'admin';
  status: 'active' | 'inactive' | 'suspended';
  emailVerified: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date | null;
  lastActive?: string | null;
  loginCount: number;
  isActive: boolean;
  trialStatus?: {
    isInTrial: boolean;
    isInWarning: boolean;
    isTrialExpired: boolean;
    isExpiredAndDeletionPending: boolean;
    daysPassed: number;
    daysLeft: number;
    warningDaysLeft: number;
    trialEndsAt: string;
    warningEndsAt: string;
  };
  preferences?: {
    notifications: boolean;
    darkMode: boolean;
    language: string;
  };
  _count?: {
    watchlist: number;
    portfolio: number;
    alerts: number;
  };
  usage?: {
    totalEvents: number;
    pageViews: number;
    featureUses: number;
    errors: number;
    lastActive: string | null;
    topSections: Array<{ section: string; count: number }>;
    topFeatures: Array<{ feature: string; count: number }>;
  };
}

interface UsersResponse {
  success: boolean;
  users: UserDetails[];
  total: number;
  page: number;
  pageSize: number;
}

/* ------------------------------------------------------------------ */
/*  Admin Fetch Helper                                                */
/* ------------------------------------------------------------------ */

function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return getAdminToken().then((token) => {
    if (!token) {
      return new Response(JSON.stringify({ success: false, error: 'غير مسجل الدخول' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const headers = new Headers(options.headers);
    headers.set('X-Admin-Token', token);
    if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(url, { ...options, headers });
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function UsersManagement() {
  const [users, setUsers] = useState<UserDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<UserDetails | null>(null);
  const [showUserDetails, setShowUserDetails] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [userToDelete, setUserToDelete] = useState<UserDetails | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);
  const [isCleaningUp, setIsCleaningUp] = useState(false);

  // Add user form state
  const [newUser, setNewUser] = useState({
    email: '',
    username: '',
    name: '',
    password: '',
    role: 'user' as 'user' | 'premium' | 'admin',
  });

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (roleFilter !== 'all') params.append('role', roleFilter);
      if (statusFilter !== 'all') params.append('status', statusFilter);
      params.append('withUsage', '1');

      const res = await adminFetch(`/api/admin/users?${params.toString()}`);
      const data: UsersResponse = await res.json();
      
      if (data.success) {
        setUsers(data.users);
      } else {
        toast.error('فشل في تحميل المستخدمين');
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, roleFilter, statusFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleAddUser = async () => {
    if (!newUser.email || !newUser.username || !newUser.password) {
      toast.error('يرجى ملء جميع الحقول المطلوبة');
      return;
    }

    setIsAdding(true);
    try {
      const res = await adminFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(newUser),
      });
      const data = await res.json();
      
      if (data.success) {
        toast.success('تم إضافة المستخدم بنجاح');
        setShowAddDialog(false);
        setNewUser({
          email: '',
          username: '',
          name: '',
          password: '',
          role: 'user',
        });
        fetchUsers();
      } else {
        toast.error(data.error || 'فشل في إضافة المستخدم');
      }
    } catch (error) {
      toast.error('خطأ في إضافة المستخدم');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    
    setIsDeleting(true);
    try {
      const res = await adminFetch(`/api/admin/users/${userToDelete.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      
      if (data.success) {
        toast.success('تم حذف المستخدم بنجاح');
        setShowDeleteDialog(false);
        setUserToDelete(null);
        fetchUsers();
      } else {
        toast.error(data.error || 'فشل في حذف المستخدم');
      }
    } catch (error) {
      toast.error('خطأ في حذف المستخدم');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUpdateUserStatus = async (userId: string, status: 'active' | 'inactive' | 'suspended') => {
    try {
      const res = await adminFetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      
      if (data.success) {
        toast.success('تم تحديث حالة المستخدم');
        fetchUsers();
      } else {
        toast.error(data.error || 'فشل في تحديث المستخدم');
      }
    } catch (error) {
      toast.error('خطأ في تحديث المستخدم');
    }
  };

  const handleUpdateUserRole = async (userId: string, role: 'user' | 'premium' | 'admin') => {
    try {
      const res = await adminFetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      
      if (data.success) {
        toast.success('تم تحديث دور المستخدم');
        fetchUsers();
      } else {
        toast.error(data.error || 'فشل في تحديث المستخدم');
      }
    } catch (error) {
      toast.error('خطأ في تحديث المستخدم');
    }
  };

  const handleCleanupExpired = async (dryRun = false) => {
    setIsCleaningUp(true);
    try {
      const res = await adminFetch('/api/admin/users/cleanup-expired', {
        method: 'POST',
        body: JSON.stringify({ dryRun: dryRun ? true : false }),
      });
      const data = await res.json();
      
      if (data.success) {
        if (dryRun && data.users?.length > 0) {
          toast.success(`سيتم حذف ${data.users.length} مستخدم. قم بتشغيل العملية بدون dryRun للحذف الفعلي.`);
        } else if (!dryRun) {
          toast.success(data.message || 'تم تنظيف المستخدمين منتهي الفترة');
          fetchUsers();
        } else {
          toast.success(data.message || 'لا يوجد مستخدمين للحذف');
        }
      } else {
        toast.error(data.error || 'فشل في التنظيف');
      }
    } catch (error) {
      toast.error('خطأ في التنظيف');
    } finally {
      setIsCleaningUp(false);
      setShowCleanupDialog(false);
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return <Badge className="bg-red-500 gap-1"><Shield className="w-3 h-3" />مدير</Badge>;
      case 'premium':
        return <Badge className="bg-amber-500 gap-1"><Crown className="w-3 h-3" />بريميوم</Badge>;
      default:
        return <Badge variant="secondary">مستخدم</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-emerald-500 gap-1"><CheckCircle className="w-3 h-3" />نشط</Badge>;
      case 'inactive':
        return <Badge variant="secondary" className="gap-1"><XCircle className="w-3 h-3" />غير نشط</Badge>;
      case 'suspended':
        return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />موقوف</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getUserActivityBadge = (isActive: boolean) => {
    if (isActive) {
      return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-200 gap-1"><Activity className="w-3 h-3" />نشط</Badge>;
    }
    return <Badge className="bg-slate-500/10 text-slate-600 border-slate-200 gap-1"><XCircle className="w-3 h-3" />غير نشط</Badge>;
  };

  const getTrialBadge = (trialStatus: any) => {
    if (!trialStatus) return null;
    if (trialStatus.isInTrial) {
      return <Badge className="bg-blue-500/10 text-blue-600 border-blue-200 gap-1">فترة تجريبية ({trialStatus.daysLeft} يوم)</Badge>;
    }
    if (trialStatus.isInWarning) {
      return <Badge className="bg-amber-500/10 text-amber-600 border-amber-200 gap-1"><Clock className="w-3 h-3" />تنبيه ({trialStatus.warningDaysLeft} يوم)</Badge>;
    }
    if (trialStatus.isExpiredAndDeletionPending) {
      return <Badge variant="destructive" className="gap-1"><Trash2 className="w-3 h-3" />بانتظار الحذف</Badge>;
    }
    return null;
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return 'غير محدد';
    return new Date(date).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatDateTime = (date: Date | string | null) => {
    if (!date) return 'غير محدد';
    return new Date(date).toLocaleString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getInitials = (name: string, email: string) => {
    if (name) {
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    return email.slice(0, 2).toUpperCase();
  };

  // Filter users locally for instant feedback
  const filteredUsers = users.filter(user => {
    const matchesSearch = !searchQuery || 
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.name?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    const matchesStatus = statusFilter === 'all' || user.status === statusFilter;
    
    return matchesSearch && matchesRole && matchesStatus;
  });

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">إدارة المستخدمين</h2>
          <p className="text-sm text-muted-foreground">عرض وإدارة جميع مستخدمي المنصة</p>
        </div>
        
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <UserPlus className="w-4 h-4" />
              إضافة مستخدم
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle>إضافة مستخدم جديد</DialogTitle>
              <DialogDescription>أدخل بيانات المستخدم الجديد</DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="email">البريد الإلكتروني *</Label>
                <Input
                  id="email"
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="user@example.com"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="username">اسم المستخدم *</Label>
                <Input
                  id="username"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  placeholder="username"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="name">الاسم الكامل</Label>
                <Input
                  id="name"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  placeholder="الاسم الكامل"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">كلمة المرور *</Label>
                <Input
                  id="password"
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="********"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="role">الدور</Label>
                <Select
                  value={newUser.role}
                  onValueChange={(value: 'user' | 'premium' | 'admin') => 
                    setNewUser({ ...newUser, role: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">مستخدم عادي</SelectItem>
                    <SelectItem value="premium">بريميوم</SelectItem>
                    <SelectItem value="admin">مدير</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                إلغاء
              </Button>
              <Button onClick={handleAddUser} disabled={isAdding}>
                {isAdding ? (
                  <>
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    جاري الإضافة...
                  </>
                ) : (
                  'إضافة'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Button variant="outline" className="gap-2" onClick={() => setShowCleanupDialog(true)}>
          <Trash2 className="w-4 h-4" />
          تنظيف المنتهي الفترة
        </Button>

        <AlertDialog open={showCleanupDialog} onOpenChange={setShowCleanupDialog}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>تنظيف المستخدمين منتهي الفترة</AlertDialogTitle>
              <AlertDialogDescription>
                سيتم حذف جميع المستخدمين المجانيين الذين انتهت فترة تجربتهم (30 يوم + 7 يوم تحذير) ولم يشتركوا.
                <br />
                <span className="text-red-500 text-sm">هذا الإجراء سيحذف بياناتهم نهائياً من كل قواعد البيانات ولا يمكن التراجع عنه.</span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <Button variant="outline" onClick={() => handleCleanupExpired(true)} disabled={isCleaningUp}>
                معاينة
              </Button>
              <AlertDialogAction
                onClick={() => handleCleanupExpired(false)}
                disabled={isCleaningUp}
                className="bg-red-500 hover:bg-red-600"
              >
                {isCleaningUp ? (
                  <>
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    جاري الحذف...
                  </>
                ) : (
                  'حذف نهائي'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="البحث بالبريد أو الاسم..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-9"
              />
            </div>
            
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="الدور" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأدوار</SelectItem>
                <SelectItem value="user">مستخدم</SelectItem>
                <SelectItem value="premium">بريميوم</SelectItem>
                <SelectItem value="admin">مدير</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="الحالة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="active">نشط</SelectItem>
                <SelectItem value="inactive">غير نشط</SelectItem>
                <SelectItem value="suspended">موقوف</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Users List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            قائمة المستخدمين
            <Badge variant="secondary">{filteredUsers.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4 rounded-lg border">
                  <Skeleton className="w-12 h-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                </div>
              ))}
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">لا يوجد مستخدمين</p>
            </div>
          ) : (
            <div className="divide-y">
              {filteredUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={user.image} />
                      <AvatarFallback>
                        {getInitials(user.name || '', user.email)}
                      </AvatarFallback>
                    </Avatar>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">
                          {user.name || user.username}
                        </span>
                        {getRoleBadge(user.role)}
                        {getStatusBadge(user.status)}
                        {getUserActivityBadge(user.isActive)}
                        {getTrialBadge(user.trialStatus)}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {user.email}
                        </span>
                        {user.emailVerified && (
                          <span className="text-emerald-500 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            موثق
                          </span>
                        )}
                      </div>
                      {user.usage && (
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                          <span className="flex items-center gap-1">
                            <Eye className="w-3 h-3" />
                            {user.usage.pageViews}
                          </span>
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${Math.min(100, (user.usage.pageViews / Math.max(1, ...filteredUsers.filter(u => u.usage).map(u => u.usage!.pageViews))) * 100)}%` }}
                            />
                          </div>
                          <span className="flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" />
                            {user.usage.featureUses}
                          </span>
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-500 rounded-full"
                              style={{ width: `${Math.min(100, (user.usage.featureUses / Math.max(1, ...filteredUsers.filter(u => u.usage).map(u => u.usage!.featureUses))) * 100)}%` }}
                            />
                          </div>
                          {user.usage.lastActive && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(user.usage.lastActive).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          {user.loginCount > 0 && (
                            <span className="flex items-center gap-1">
                              <Key className="w-3 h-3" />
                              {user.loginCount} دخول
                            </span>
                          )}
                          {user.lastActive && (
                            <span className="flex items-center gap-1">
                              <Activity className="w-3 h-3" />
                              {new Date(user.lastActive).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedUser(user);
                        setShowUserDetails(true);
                      }}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="left">
                        <DropdownMenuLabel>إجراءات</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        
                        <DropdownMenuItem onClick={() => {
                          setSelectedUser(user);
                          setShowUserDetails(true);
                        }}>
                          <Eye className="w-4 h-4 ml-2" />
                          عرض التفاصيل
                        </DropdownMenuItem>
                        
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>تغيير الدور</DropdownMenuLabel>
                        
                        <DropdownMenuItem onClick={() => handleUpdateUserRole(user.id, 'user')}>
                          <Users className="w-4 h-4 ml-2" />
                          مستخدم عادي
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleUpdateUserRole(user.id, 'premium')}>
                          <Crown className="w-4 h-4 ml-2" />
                          بروميوم
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleUpdateUserRole(user.id, 'admin')}>
                          <Shield className="w-4 h-4 ml-2" />
                          مدير
                        </DropdownMenuItem>
                        
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>تغيير الحالة</DropdownMenuLabel>
                        
                        <DropdownMenuItem onClick={() => handleUpdateUserStatus(user.id, 'active')}>
                          <CheckCircle className="w-4 h-4 ml-2 text-emerald-500" />
                          تفعيل
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleUpdateUserStatus(user.id, 'inactive')}>
                          <XCircle className="w-4 h-4 ml-2 text-amber-500" />
                          تعطيل
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleUpdateUserStatus(user.id, 'suspended')}>
                          <XCircle className="w-4 h-4 ml-2 text-red-500" />
                          إيقاف
                        </DropdownMenuItem>
                        
                        <DropdownMenuSeparator />
                        
                        <DropdownMenuItem 
                          onClick={() => {
                            setUserToDelete(user);
                            setShowDeleteDialog(true);
                          }}
                          className="text-red-500 focus:text-red-500"
                        >
                          <Trash2 className="w-4 h-4 ml-2" />
                          حذف المستخدم
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* User Details Dialog */}
      <Dialog open={showUserDetails} onOpenChange={setShowUserDetails}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          {selectedUser && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={selectedUser.image} />
                    <AvatarFallback>
                      {getInitials(selectedUser.name || '', selectedUser.email)}
                    </AvatarFallback>
                  </Avatar>
                  {selectedUser.name || selectedUser.username}
                  {getRoleBadge(selectedUser.role)}
                  {getStatusBadge(selectedUser.status)}
                </DialogTitle>
              </DialogHeader>
              
              <div className="space-y-6 py-4">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-muted-foreground">البريد الإلكتروني</Label>
                    <p className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      {selectedUser.email}
                      {selectedUser.emailVerified && (
                        <Badge variant="outline" className="text-emerald-500 text-xs">
                          موثق
                        </Badge>
                      )}
                    </p>
                  </div>
                  
                  <div className="space-y-1">
                    <Label className="text-muted-foreground">اسم المستخدم</Label>
                    <p>@{selectedUser.username}</p>
                  </div>
                  
                  <div className="space-y-1">
                    <Label className="text-muted-foreground">تاريخ التسجيل</Label>
                    <p className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      {formatDate(selectedUser.createdAt)}
                    </p>
                  </div>
                  
                  <div className="space-y-1">
                    <Label className="text-muted-foreground">آخر تسجيل دخول</Label>
                    <p className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      {selectedUser.lastLoginAt 
                        ? formatDateTime(selectedUser.lastLoginAt)
                        : 'لم يسجل دخول بعد'
                      }
                    </p>
                  </div>
                </div>
                
                <Separator />
                
                {/* Activity Stats */}
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    نشاط المستخدم
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold text-emerald-500">
                        {selectedUser._count?.watchlist ?? 0}
                      </div>
                      <div className="text-xs text-muted-foreground">قائمة المراقبة</div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold text-blue-500">
                        {selectedUser._count?.portfolio ?? 0}
                      </div>
                      <div className="text-xs text-muted-foreground">محفظة</div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold text-amber-500">
                        {selectedUser._count?.alerts ?? 0}
                      </div>
                      <div className="text-xs text-muted-foreground">تنبيهات</div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold text-purple-500">
                        {selectedUser.loginCount ?? 0}
                      </div>
                      <div className="text-xs text-muted-foreground">مرات الدخول</div>
                    </div>
                  </div>
                </div>
                
                <Separator />
                
                {/* Usage Stats */}
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    إحصائيات الاستخدام
                  </h4>
                  {selectedUser.usage ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <div className="text-2xl font-bold text-blue-500">
                            {selectedUser.usage.pageViews}
                          </div>
                          <div className="text-xs text-muted-foreground">مشاهدات</div>
                        </div>
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <div className="text-2xl font-bold text-amber-500">
                            {selectedUser.usage.featureUses}
                          </div>
                          <div className="text-xs text-muted-foreground">استخدام ميزات</div>
                        </div>
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <div className="text-2xl font-bold text-red-500">
                            {selectedUser.usage.errors}
                          </div>
                          <div className="text-xs text-muted-foreground">أخطاء</div>
                        </div>
                        <div className="text-center p-3 bg-muted/50 rounded-lg">
                          <div className="text-2xl font-bold text-purple-500">
                            {selectedUser.usage.totalEvents}
                          </div>
                          <div className="text-xs text-muted-foreground">إجمالي الأحداث</div>
                        </div>
                      </div>

                      {selectedUser.usage.lastActive && (
                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                          <Clock className="w-3 h-3" />
                          آخر نشاط: {new Date(selectedUser.usage.lastActive).toLocaleString('ar-EG')}
                        </div>
                      )}

                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div>
                           <h5 className="text-sm font-medium mb-2">الأقسام الأكثر زيارة</h5>
                           {selectedUser.usage.topSections.length > 0 ? (
                             <div className="space-y-2">
                               {selectedUser.usage.topSections.map((section, idx) => {
                                 const maxCount = Math.max(...selectedUser.usage!.topSections.map(s => s.count), 1);
                                 const pct = (section.count / maxCount) * 100;
                                 return (
                                   <div key={idx} className="space-y-1">
                                     <div className="flex items-center justify-between text-sm">
                                       <span className="truncate ml-2">{section.section || 'غير محدد'}</span>
                                       <span className="text-xs text-muted-foreground">{section.count}</span>
                                     </div>
                                     <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                       <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                                     </div>
                                   </div>
                                 );
                               })}
                             </div>
                           ) : (
                             <p className="text-xs text-muted-foreground">لا توجد بيانات</p>
                           )}
                         </div>
                         <div>
                           <h5 className="text-sm font-medium mb-2">الميزات الأكثر استخداماً</h5>
                           {selectedUser.usage.topFeatures.length > 0 ? (
                             <div className="space-y-2">
                               {selectedUser.usage.topFeatures.map((feature, idx) => {
                                 const maxCount = Math.max(...selectedUser.usage!.topFeatures.map(f => f.count), 1);
                                 const pct = (feature.count / maxCount) * 100;
                                 return (
                                   <div key={idx} className="space-y-1">
                                     <div className="flex items-center justify-between text-sm">
                                       <span className="truncate ml-2">{feature.feature || 'غير محدد'}</span>
                                       <span className="text-xs text-muted-foreground">{feature.count}</span>
                                     </div>
                                     <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                       <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} />
                                     </div>
                                   </div>
                                 );
                               })}
                             </div>
                           ) : (
                             <p className="text-xs text-muted-foreground">لا توجد بيانات</p>
                           )}
                         </div>
                       </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">لا توجد بيانات استخدام متاحة</p>
                  )}
                </div>
                
                <Separator />
                
                {/* Preferences */}
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <Bell className="w-4 h-4" />
                    الإعدادات
                  </h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span>الإشعارات</span>
                      <Badge variant={selectedUser.preferences?.notifications ? 'default' : 'secondary'}>
                        {selectedUser.preferences?.notifications ? 'مفعلة' : 'معطلة'}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>الوضع الداكن</span>
                      <Badge variant={selectedUser.preferences?.darkMode ? 'default' : 'secondary'}>
                        {selectedUser.preferences?.darkMode ? 'مفعلة' : 'معطلة'}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>اللغة</span>
                      <Badge variant="outline">
                        {selectedUser.preferences?.language === 'ar' ? 'العربية' : 
                         selectedUser.preferences?.language === 'en' ? 'English' : 
                         selectedUser.preferences?.language || 'غير محدد'}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
              
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowUserDetails(false)}>
                  إغلاق
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setShowUserDetails(false);
                    setUserToDelete(selectedUser);
                    setShowDeleteDialog(true);
                  }}
                >
                  <Trash2 className="w-4 h-4 ml-2" />
                  حذف المستخدم
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف المستخدم "{userToDelete?.username}"؟
              <br />
              <span className="text-red-500 text-sm">هذا الإجراء لا يمكن التراجع عنه.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={isDeleting}
              className="bg-red-500 hover:bg-red-600"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  جاري الحذف...
                </>
              ) : (
                'حذف'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default UsersManagement;
