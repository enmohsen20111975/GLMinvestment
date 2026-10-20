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
 Ticket,
 Gift,
 Sparkles,
 Copy,
 Check,
 RefreshCw,
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
/* Types */
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
 promoStats?: {
 totalWithPromo: number;
 activePromoUsers: number;
 expiredPromoUsers: number;
 };
}

/* ------------------------------------------------------------------ */
/* Admin Fetch Helper */
/* ------------------------------------------------------------------ */

function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
 return getAdminToken().then((token) => {
 const headers = new Headers(options.headers);
 if (token) {
 headers.set('X-Admin-Token', token);
 }
 if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
 headers.set('Content-Type', 'application/json');
 }
 return fetch(url, {
 ...options,
 headers,
 credentials: options.credentials || 'same-origin',
 });
 });
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

export function UsersManagement() {
 const [users, setUsers] = useState<UserDetails[]>([]);
 const [loading, setLoading] = useState(true);
 const [searchQuery, setSearchQuery] = useState('');
 const [roleFilter, setRoleFilter] = useState<string>('all');
 const [statusFilter, setStatusFilter] = useState<string>('all');
 const [promoFilter, setPromoFilter] = useState<string>('all');
 const [promoStats, setPromoStats] = useState<{ totalWithPromo: number; activePromoUsers: number; expiredPromoUsers: number } | null>(null);

 // Promo modal state
 const [showPromoModal, setShowPromoModal] = useState(false);
 const [promoTargetUser, setPromoTargetUser] = useState<UserDetails | null>(null);
 const [availablePromoCodes, setAvailablePromoCodes] = useState<Array<any>>([]);
 const [selectedPromoCode, setSelectedPromoCode] = useState<string>('');
 const [customPromoTier, setCustomPromoTier] = useState<string>('all');
 const [customPromoDays, setCustomPromoDays] = useState<number>(30);
 const [customPromoCodeInput, setCustomPromoCodeInput] = useState<string>('');
 const [isAssigningPromo, setIsAssigningPromo] = useState(false);
 const [copiedCode, setCopiedCode] = useState<string | null>(null);

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

 const fetchAvailablePromoCodes = useCallback(async () => {
 try {
 const res = await adminFetch('/api/admin/promo-codes');
 const data = await res.json();
 if (data.success && Array.isArray(data.promo_codes)) {
 setAvailablePromoCodes(data.promo_codes.filter((p: any) => p.is_active));
 }
 } catch {}
 }, []);

 const fetchUsers = useCallback(async () => {
 setLoading(true);
 try {
 const params = new URLSearchParams();
 if (searchQuery) params.append('search', searchQuery);
 if (roleFilter !== 'all') params.append('role', roleFilter);
 if (statusFilter !== 'all') params.append('status', statusFilter);
 if (promoFilter !== 'all') params.append('promo', promoFilter);
 params.append('withUsage', '1');

 const res = await adminFetch(`/api/admin/users?${params.toString()}`);
 const data: UsersResponse = await res.json();
 
 if (data.success) {
 setUsers(data.users);
 if (data.promoStats) setPromoStats(data.promoStats);
 } else {
 toast.error('فشل في تحميل المستخدمين');
 }
 } catch (error) {
 console.error('Error fetching users:', error);
 toast.error('خطأ في الاتصال');
 } finally {
 setLoading(false);
 }
 }, [searchQuery, roleFilter, statusFilter, promoFilter]);

 useEffect(() => {
 fetchUsers();
 fetchAvailablePromoCodes();
 }, [fetchUsers, fetchAvailablePromoCodes]);

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
 return <Badge className="bg-loss gap-1"><Shield className="w-3 h-3" />مدير</Badge>;
 case 'premium':
 return <Badge className="bg-warning gap-1"><Crown className="w-3 h-3" />بريميوم</Badge>;
 default:
 return <Badge variant="secondary">مستخدم</Badge>;
 }
 };

 const getStatusBadge = (status: string) => {
 switch (status) {
 case 'active':
 return <Badge className="bg-profit gap-1"><CheckCircle className="w-3 h-3" />نشط</Badge>;
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
 return <Badge className="bg-profit/10 text-profit border-profit gap-1"><Activity className="w-3 h-3" />نشط</Badge>;
 }
 return <Badge className="bg-slate-500/10 text-muted-foreground border-border gap-1"><XCircle className="w-3 h-3" />غير نشط</Badge>;
 };

 const handleOpenPromoModal = (user: UserDetails) => {
 setPromoTargetUser(user);
 setSelectedPromoCode(user.promoCode?.code || '');
 setCustomPromoTier(user.promoCode?.plan_tier || 'all');
 setCustomPromoDays(user.promoCode?.premium_days || 30);
 setCustomPromoCodeInput('');
 setShowPromoModal(true);
 fetchAvailablePromoCodes();
 };

 const handleAssignPromo = async () => {
 if (!promoTargetUser) return;
 setIsAssigningPromo(true);
 try {
 const payload: any = {
 plan_tier: customPromoTier,
 duration_days: customPromoDays,
 };
 if (selectedPromoCode && selectedPromoCode !== 'custom') {
 payload.code = selectedPromoCode;
 } else if (customPromoCodeInput.trim()) {
 payload.code = customPromoCodeInput.trim();
 }

 const res = await adminFetch(`/api/admin/users/${promoTargetUser.id}/promo`, {
 method: 'POST',
 body: JSON.stringify(payload),
 });
 const data = await res.json();
 if (data.success) {
 toast.success(data.message || 'تم تفعيل كود الخصم بنجاح');
 setShowPromoModal(false);
 if (selectedUser?.id === promoTargetUser.id && data.promo) {
 setSelectedUser({
 ...selectedUser,
 promoCode: data.promo,
 role: data.promo.plan_tier === 'developer' || data.promo.plan_tier === 'all' ? 'user' : 'premium',
 });
 }
 fetchUsers();
 } else {
 toast.error(data.error || 'فشل تفعيل كود الخصم');
 }
 } catch (e: any) {
 toast.error('حدث خطأ أثناء تفعيل كود الخصم');
 } finally {
 setIsAssigningPromo(false);
 }
 };

 const handleRevokePromo = async (userId: string) => {
 if (!confirm('هل أنت متأكد من رغبتك في إلغاء كود الخصم لهذا المستخدم وإعادته للباقة المجانية؟')) return;
 try {
 const res = await adminFetch(`/api/admin/users/${userId}/promo`, {
 method: 'DELETE',
 });
 const data = await res.json();
 if (data.success) {
 toast.success(data.message || 'تم إلغاء كود الخصم بنجاح');
 if (selectedUser?.id === userId) {
 setSelectedUser({
 ...selectedUser,
 promoCode: null,
 role: 'user',
 });
 }
 fetchUsers();
 } else {
 toast.error(data.error || 'فشل إلغاء كود الخصم');
 }
 } catch (e: any) {
 toast.error('حدث خطأ أثناء إلغاء كود الخصم');
 }
 };

 const copyToClipboard = (text: string) => {
 navigator.clipboard.writeText(text);
 setCopiedCode(text);
 toast.success(`تم نسخ الكود: ${text}`);
 setTimeout(() => setCopiedCode(null), 2000);
 };

 const getPromoBadge = (promo?: UserDetails['promoCode']) => {
 if (!promo) return null;
 const isVip = promo.plan_tier === 'all' || promo.plan_tier === 'developer';
 const isPremium = promo.plan_tier === 'premium';
 return (
 <Badge
 className={cn(
 "gap-1.5 py-0.5 px-2.5 font-medium text-xs border shadow-sm transition-all",
 isVip
 ? "bg-primary/15 text-primary border-purple-500/40 hover:bg-primary/25"
 : isPremium
 ? "bg-profit/15 text-profit border-profit/20 hover:bg-profit/25"
 : "bg-primary/15 text-primary border-primary/20 hover:bg-primary/25"
 )}
 >
 <Ticket className="w-3.5 h-3.5 text-current shrink-0" />
 <span className="font-mono font-bold tracking-wider">{promo.code}</span>
 <span className="text-xs opacity-90 font-sans">({promo.plan_label})</span>
 {promo.is_active ? (
 <span className="text-xs bg-profit/20 text-profit px-1.5 py-0.5 rounded font-mono font-bold">
 {promo.days_left > 365 ? 'مفتوح ♾️' : `${promo.days_left} يوم`}
 </span>
 ) : (
 <span className="text-xs bg-loss/20 text-loss px-1.5 py-0.5 rounded font-sans font-bold">
 منتهي
 </span>
 )}
 </Badge>
 );
 };

 const getTrialBadge = (trialStatus: any) => {
 if (!trialStatus) return null;
 if (trialStatus.isInTrial) {
 return <Badge className="bg-primary/10 text-primary border-primary gap-1">فترة تجريبية ({trialStatus.daysLeft} يوم)</Badge>;
 }
 if (trialStatus.isInWarning) {
 return <Badge className="bg-warning/10 text-warning border-warning gap-1"><Clock className="w-3 h-3" />تنبيه ({trialStatus.warningDaysLeft} يوم)</Badge>;
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
 user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
 (user.promoCode && user.promoCode.code.toLowerCase().includes(searchQuery.toLowerCase()));
 
 const matchesRole = roleFilter === 'all' || user.role === roleFilter;
 const matchesStatus = statusFilter === 'all' || user.status === statusFilter;

 let matchesPromo = true;
 if (promoFilter === 'with_promo') {
 matchesPromo = !!user.promoCode;
 } else if (promoFilter === 'active_promo') {
 matchesPromo = !!(user.promoCode && user.promoCode.is_active);
 } else if (promoFilter === 'expired_promo') {
 matchesPromo = !!(user.promoCode && user.promoCode.is_expired);
 } else if (promoFilter === 'vip') {
 matchesPromo = !!(user.promoCode && (user.promoCode.plan_tier === 'all' || user.promoCode.plan_tier === 'developer'));
 } else if (promoFilter === 'premium') {
 matchesPromo = !!(user.promoCode && user.promoCode.plan_tier === 'premium');
 } else if (promoFilter === 'normal') {
 matchesPromo = !!(user.promoCode && user.promoCode.plan_tier === 'normal');
 } else if (promoFilter === 'without_promo') {
 matchesPromo = !user.promoCode;
 }
 
 return matchesSearch && matchesRole && matchesStatus && matchesPromo;
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
 <span className="text-loss text-sm">هذا الإجراء سيحذف بياناتهم نهائياً من كل قواعد البيانات ولا يمكن التراجع عنه.</span>
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
 className="bg-loss hover:bg-loss"
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
 <div className="flex flex-col sm:flex-row gap-4 items-center">
 <div className="flex-1 relative w-full">
 <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
 <Input
 placeholder="البحث بالبريد أو الاسم أو كود الخصم..."
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

 <Select value={promoFilter} onValueChange={setPromoFilter}>
 <SelectTrigger className="w-48 border-purple-500/30">
 <SelectValue placeholder="فلتر البرومو كود" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">الكل (مع وبدون كود)</SelectItem>
 <SelectItem value="with_promo">مشتركون ببرومو كود 🎟️</SelectItem>
 <SelectItem value="active_promo">كود نشط حالياً 🟢</SelectItem>
 <SelectItem value="expired_promo">كود منتهي الصلاحية 🔴</SelectItem>
 <SelectItem value="vip">كود VIP شامل ⭐</SelectItem>
 <SelectItem value="premium">كود المحترفين 🛡️</SelectItem>
 <SelectItem value="normal">كود عادي 📘</SelectItem>
 <SelectItem value="without_promo">بدون كود خصم ⚪</SelectItem>
 </SelectContent>
 </Select>

 <Button
 variant="outline"
 size="icon"
 onClick={() => fetchUsers()}
 disabled={loading}
 title="تحديث البيانات"
 className="shrink-0"
 >
 <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
 </Button>
 </div>
 </CardContent>
 </Card>

 {/* Users List */}
 <Card>
 <CardHeader>
 <div className="flex items-center justify-between flex-wrap gap-2">
 <CardTitle className="flex items-center gap-2">
 <Users className="w-5 h-5" />
 قائمة المستخدمين
 <Badge variant="secondary">{filteredUsers.length}</Badge>
 </CardTitle>

 <div className="flex items-center gap-2 flex-wrap">
 <Badge variant="outline" className="gap-1.5 border-purple-500/40 bg-primary/10 text-primary py-1 px-2.5">
 <Ticket className="w-3.5 h-3.5 text-primary" />
 <span>مستخدمو البرومو كود:</span>
 <strong className="font-mono text-foreground font-bold">
 {promoStats?.totalWithPromo ?? users.filter(u => !!u.promoCode).length}
 </strong>
 <span className="text-xs text-profit font-normal">
 (نشط: {promoStats?.activePromoUsers ?? users.filter(u => u.promoCode?.is_active).length})
 </span>
 </Badge>
 </div>
 </div>
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
 <div className="flex items-center gap-2 flex-wrap">
 <span className="font-medium truncate">
 {user.name || user.username}
 </span>
 {getRoleBadge(user.role)}
 {getStatusBadge(user.status)}
 {getUserActivityBadge(user.isActive)}
 {getTrialBadge(user.trialStatus)}
 {getPromoBadge(user.promoCode)}
 </div>
 <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
 <span className="flex items-center gap-1">
 <Mail className="w-3 h-3" />
 {user.email}
 </span>
 {user.emailVerified && (
 <span className="text-profit flex items-center gap-1">
 <CheckCircle className="w-3 h-3" />
 موثق
 </span>
 )}
 {user.promoCode && (
 <span className="flex items-center gap-1 text-xs text-primary font-mono">
 <Ticket className="w-3 h-3" />
 تفعيل: {formatDate(user.promoCode.redeemed_at)}
 {user.promoCode.expires_at && ` | انتهاء: ${formatDate(user.promoCode.expires_at)}`}
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
 className="h-full bg-primary rounded-full"
 style={{ width: `${Math.min(100, (user.usage.pageViews / Math.max(1, ...filteredUsers.filter(u => u.usage).map(u => u.usage!.pageViews))) * 100)}%` }}
 />
 </div>
 <span className="flex items-center gap-1">
 <TrendingUp className="w-3 h-3" />
 {user.usage.featureUses}
 </span>
 <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
 <div
 className="h-full bg-warning rounded-full"
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
 <DropdownMenuLabel>كود الخصم والاشتراك</DropdownMenuLabel>

 <DropdownMenuItem onClick={() => handleOpenPromoModal(user)}>
 <Ticket className="w-4 h-4 ml-2 text-primary" />
 {user.promoCode ? 'تعديل / تجديد البرومو كود' : 'تفعيل برومو كود للمستخدم'}
 </DropdownMenuItem>

 {user.promoCode && (
 <DropdownMenuItem onClick={() => handleRevokePromo(user.id)} className="text-loss">
 <XCircle className="w-4 h-4 ml-2" />
 إلغاء البرومو كود
 </DropdownMenuItem>
 )}
 
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
 <CheckCircle className="w-4 h-4 ml-2 text-profit" />
 تفعيل
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => handleUpdateUserStatus(user.id, 'inactive')}>
 <XCircle className="w-4 h-4 ml-2 text-warning" />
 تعطيل
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => handleUpdateUserStatus(user.id, 'suspended')}>
 <XCircle className="w-4 h-4 ml-2 text-loss" />
 إيقاف
 </DropdownMenuItem>
 
 <DropdownMenuSeparator />
 
 <DropdownMenuItem 
 onClick={() => {
 setUserToDelete(user);
 setShowDeleteDialog(true);
 }}
 className="text-loss focus:text-loss"
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
 <Badge variant="outline" className="text-profit text-xs">
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

 {/* Promo Code Section */}
 <div className="rounded-xl border border-purple-500/30 bg-primary/5 p-4 space-y-3">
 <div className="flex items-center justify-between">
 <h4 className="font-bold text-sm flex items-center gap-2 text-primary">
 <Ticket className="w-4 h-4 text-primary" />
 بيانات كود الخصم والترقية (Promo Code)
 </h4>
 {selectedUser.promoCode ? (
 <Badge className={selectedUser.promoCode.is_active ? "bg-profit/20 text-profit border-profit/20" : "bg-loss/20 text-loss border-loss/20"}>
 {selectedUser.promoCode.is_active ? `نشط (متبقي ${selectedUser.promoCode.days_left} يوم)` : 'منتهي الصلاحية'}
 </Badge>
 ) : (
 <Badge variant="outline" className="text-muted-foreground">لا يوجد كود مفعل</Badge>
 )}
 </div>

 {selectedUser.promoCode ? (
 <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs pt-1">
 <div className="bg-background/60 p-2.5 rounded-lg border border-border/60 space-y-1">
 <span className="text-muted-foreground block text-xs">رمز الكود</span>
 <div className="flex items-center justify-between">
 <span className="font-mono font-bold text-sm text-foreground tracking-wider">{selectedUser.promoCode.code}</span>
 <Button
 variant="ghost"
 size="sm"
 onClick={() => copyToClipboard(selectedUser.promoCode!.code)}
 className="h-6 w-6 p-0"
 >
 {copiedCode === selectedUser.promoCode.code ? <Check className="w-3 h-3 text-profit" /> : <Copy className="w-3 h-3" />}
 </Button>
 </div>
 </div>

 <div className="bg-background/60 p-2.5 rounded-lg border border-border/60 space-y-1">
 <span className="text-muted-foreground block text-xs">نوع وترقية الباقة</span>
 <span className="font-bold text-foreground block">{selectedUser.promoCode.plan_label}</span>
 </div>

 <div className="bg-background/60 p-2.5 rounded-lg border border-border/60 space-y-1">
 <span className="text-muted-foreground block text-xs">المدة الممنوحة</span>
 <span className="font-bold text-foreground block">{selectedUser.promoCode.premium_days} يوم</span>
 </div>

 <div className="bg-background/60 p-2.5 rounded-lg border border-border/60 space-y-1">
 <span className="text-muted-foreground block text-xs">تاريخ التفعيل</span>
 <span className="text-foreground block">{formatDate(selectedUser.promoCode.redeemed_at)}</span>
 </div>

 <div className="bg-background/60 p-2.5 rounded-lg border border-border/60 space-y-1">
 <span className="text-muted-foreground block text-xs">تاريخ الانتهاء</span>
 <span className="text-foreground block">
 {selectedUser.promoCode.expires_at ? formatDate(selectedUser.promoCode.expires_at) : 'مفتوح / دائم'}
 </span>
 </div>

 <div className="bg-background/60 p-2.5 rounded-lg border border-border/60 flex items-center justify-center gap-2">
 <Button
 size="sm"
 variant="outline"
 className="text-xs h-7 text-primary border-purple-500/40 hover:bg-primary/10"
 onClick={() => handleOpenPromoModal(selectedUser)}
 >
 <Sparkles className="w-3 h-3 ml-1" />
 تعديل
 </Button>
 <Button
 size="sm"
 variant="outline"
 className="text-xs h-7 text-loss border-loss/20 hover:bg-loss/10"
 onClick={() => handleRevokePromo(selectedUser.id)}
 >
 إلغاء
 </Button>
 </div>
 </div>
 ) : (
 <div className="flex items-center justify-between bg-background/40 p-3 rounded-lg border border-border/60">
 <span className="text-xs text-muted-foreground">هذا المستخدم يعمل بالباقة العادية بدون برومو كود.</span>
 <Button
 size="sm"
 className="bg-primary hover:bg-primary text-white text-xs h-8 gap-1.5"
 onClick={() => handleOpenPromoModal(selectedUser)}
 >
 <Ticket className="w-3.5 h-3.5" />
 تفعيل برومو كود الآن
 </Button>
 </div>
 )}
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
 <div className="text-2xl font-bold text-profit">
 {selectedUser._count?.watchlist ?? 0}
 </div>
 <div className="text-xs text-muted-foreground">قائمة المراقبة</div>
 </div>
 <div className="text-center p-3 bg-muted/50 rounded-lg">
 <div className="text-2xl font-bold text-primary">
 {selectedUser._count?.portfolio ?? 0}
 </div>
 <div className="text-xs text-muted-foreground">محفظة</div>
 </div>
 <div className="text-center p-3 bg-muted/50 rounded-lg">
 <div className="text-2xl font-bold text-warning">
 {selectedUser._count?.alerts ?? 0}
 </div>
 <div className="text-xs text-muted-foreground">تنبيهات</div>
 </div>
 <div className="text-center p-3 bg-muted/50 rounded-lg">
 <div className="text-2xl font-bold text-primary">
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
 <div className="text-2xl font-bold text-primary">
 {selectedUser.usage.pageViews}
 </div>
 <div className="text-xs text-muted-foreground">مشاهدات</div>
 </div>
 <div className="text-center p-3 bg-muted/50 rounded-lg">
 <div className="text-2xl font-bold text-warning">
 {selectedUser.usage.featureUses}
 </div>
 <div className="text-xs text-muted-foreground">استخدام ميزات</div>
 </div>
 <div className="text-center p-3 bg-muted/50 rounded-lg">
 <div className="text-2xl font-bold text-loss">
 {selectedUser.usage.errors}
 </div>
 <div className="text-xs text-muted-foreground">أخطاء</div>
 </div>
 <div className="text-center p-3 bg-muted/50 rounded-lg">
 <div className="text-2xl font-bold text-primary">
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
 <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
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
 <div className="h-full bg-warning rounded-full" style={{ width: `${pct}%` }} />
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
 <span className="text-loss text-sm">هذا الإجراء لا يمكن التراجع عنه.</span>
 </AlertDialogDescription>
 </AlertDialogHeader>
 <AlertDialogFooter>
 <AlertDialogCancel>إلغاء</AlertDialogCancel>
 <AlertDialogAction
 onClick={handleDeleteUser}
 disabled={isDeleting}
 className="bg-loss hover:bg-loss"
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

 {/* Assign / Update Promo Modal Dialog */}
 <Dialog open={showPromoModal} onOpenChange={setShowPromoModal}>
 <DialogContent className="sm:max-w-md" dir="rtl">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
 <Ticket className="w-5 h-5 text-primary" />
 تفعيل / تعديل برومو كود للمستخدم
 </DialogTitle>
 <DialogDescription className="text-xs">
 تطبيق ترقية فورية للمستخدم: <strong className="text-foreground font-mono">{promoTargetUser?.username || promoTargetUser?.email}</strong>
 </DialogDescription>
 </DialogHeader>

 <div className="space-y-4 py-3">
 {/* Pick from existing active codes */}
 {availablePromoCodes.length > 0 && (
 <div className="space-y-1.5">
 <Label className="text-xs font-semibold">اختيار كود متاح مسبقاً</Label>
 <Select
 value={selectedPromoCode}
 onValueChange={(val) => {
 setSelectedPromoCode(val);
 const found = availablePromoCodes.find((p) => p.code === val);
 if (found) {
 setCustomPromoTier(found.plan_tier || 'all');
 setCustomPromoDays(found.premium_days || 30);
 }
 }}
 >
 <SelectTrigger className="text-xs">
 <SelectValue placeholder="اختر كود من القائمة أو حدد كود مخصص" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="custom">-- إنشاء أو كتابة كود مخصص --</SelectItem>
 {availablePromoCodes.map((p) => (
 <SelectItem key={p.id} value={p.code}>
 <span className="font-mono font-bold">{p.code}</span> ({p.plan_tier === 'all' || p.plan_tier === 'developer' ? 'VIP شامل' : p.plan_tier === 'premium' ? 'محترفين' : 'عادي'} - {p.premium_days} يوم)
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 )}

 {/* Custom code name */}
 {(selectedPromoCode === 'custom' || selectedPromoCode === '' || availablePromoCodes.length === 0) && (
 <div className="space-y-1.5">
 <Label className="text-xs font-semibold">رمز الكود (اختياري - اتركه فارغاً للتوليد التلقائي)</Label>
 <Input
 placeholder="مثال: VIP-SPECIAL2026"
 value={customPromoCodeInput}
 onChange={(e) => setCustomPromoCodeInput(e.target.value.toUpperCase().replace(/\s+/g, ''))}
 className="font-mono uppercase text-xs"
 />
 </div>
 )}

 {/* Plan Tier */}
 <div className="space-y-1.5">
 <Label className="text-xs font-semibold">نوع ومميزات الباقة</Label>
 <Select value={customPromoTier} onValueChange={setCustomPromoTier}>
 <SelectTrigger className="text-xs">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">VIP شامل (جميع الأسواق والمميزات كاملة)</SelectItem>
 <SelectItem value="premium">باقة المحترفين (Premium)</SelectItem>
 <SelectItem value="normal">الباقة العادية</SelectItem>
 </SelectContent>
 </Select>
 </div>

 {/* Duration */}
 <div className="space-y-1.5">
 <Label className="text-xs font-semibold">مدة الصلاحية</Label>
 <Select
 value={String(customPromoDays)}
 onValueChange={(val) => setCustomPromoDays(parseInt(val, 10))}
 >
 <SelectTrigger className="text-xs">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="7">أسبوع واحد (7 أيام)</SelectItem>
 <SelectItem value="14">أسبوعين (14 يوم)</SelectItem>
 <SelectItem value="30">شهر كامل (30 يوم)</SelectItem>
 <SelectItem value="90">3 أشهر (90 يوم)</SelectItem>
 <SelectItem value="180">6 أشهر (180 يوم)</SelectItem>
 <SelectItem value="365">سنة كاملة (365 يوم)</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>

 <DialogFooter className="gap-2 sm:gap-0">
 <Button variant="outline" size="sm" onClick={() => setShowPromoModal(false)}>
 إلغاء
 </Button>
 <Button
 size="sm"
 onClick={handleAssignPromo}
 disabled={isAssigningPromo}
 className="bg-primary hover:bg-primary text-white font-bold gap-1.5"
 >
 {isAssigningPromo ? (
 <>
 <Loader2 className="w-4 h-4 animate-spin" />
 جاري التفعيل...
 </>
 ) : (
 <>
 <Ticket className="w-4 h-4" />
 تفعيل وترقية المستخدم
 </>
 )}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </div>
 );
}

export default UsersManagement;
