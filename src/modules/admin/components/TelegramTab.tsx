'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';

// shadcn UI
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
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

// Icons (emerald/teal accent — no blue/indigo for primary actions)
import {
  Key, Phone, Lock, Loader2, RefreshCw, Search, Send, Paperclip,
  ArrowRight, MoreVertical, Pencil, Trash2,
  User as UserIcon, Users, Megaphone, MessageSquare, LogOut,
  CheckCircle, XCircle, UserPlus, Shield, Bot,
  TrendingUp, Newspaper, FileText, Sparkles, Reply,
  Plus, ChevronUp,
} from 'lucide-react';

import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ====== Types ======
interface AuthUser {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  phone?: string;
}

interface AuthStatus {
  connected: boolean;
  user?: AuthUser | null;
}

interface DialogItem {
  id: number;
  title: string;
  type: 'user' | 'group' | 'channel' | string;
  unread_count?: number;
  last_message_text?: string;
  last_message_at?: string;
  username?: string;
}

interface MessageItem {
  id: number;
  text: string;
  date: string;
  from_id?: number;
  is_outgoing: boolean;
  media_type?: string | null;
  reply_to_msg_id?: number | null;
  pending?: boolean; // local-only optimistic flag
}

interface MemberItem {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  is_admin: boolean;
  is_banned: boolean;
}

interface SearchResult {
  id: number;
  chat_id: number;
  text: string;
  date: string;
  from_id?: number;
}

// ====== Helpers ======
const AVATAR_COLORS = [
  'bg-emerald-500', 'bg-teal-500', 'bg-cyan-500', 'bg-green-600',
  'bg-lime-600', 'bg-amber-600', 'bg-orange-600', 'bg-rose-500',
  'bg-pink-600', 'bg-fuchsia-600', 'bg-stone-600', 'bg-yellow-700',
];

function colorForId(id: number | string | undefined): string {
  const s = String(id ?? 'x');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function initialsOf(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatTime(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDateTime(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('ar-EG', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function dialogTypeIcon(type: string) {
  switch (type) {
    case 'channel': return <Megaphone className="h-3.5 w-3.5" />;
    case 'group': return <Users className="h-3.5 w-3.5" />;
    case 'user': return <UserIcon className="h-3.5 w-3.5" />;
    default: return <MessageSquare className="h-3.5 w-3.5" />;
  }
}

function dialogTypeLabel(type: string): string {
  switch (type) {
    case 'channel': return 'قناة';
    case 'group': return 'مجموعة';
    case 'user': return 'مستخدم';
    default: return 'محادثة';
  }
}

// ====== Main Component ======
export function TelegramTab() {
  const [activeTab, setActiveTab] = useState<string>('auth');
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [selectedDialog, setSelectedDialog] = useState<DialogItem | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  const fetchAuthStatus = useCallback(async () => {
    setAuthLoading(true);
    try {
      const res = await fetch('/api/telegram/auth/status');
      const data = await res.json().catch(() => ({ connected: false }));
      setAuthStatus({
        connected: !!data.connected,
        user: data.user ?? null,
      });
    } catch {
      setAuthStatus({ connected: false });
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuthStatus();
  }, [fetchAuthStatus]);

  // Connect socket only when authenticated
  useEffect(() => {
    if (authStatus?.connected) {
      let s: Socket | null = null;
      try {
        s = io('/?XTransformPort=3003', {
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 1500,
        });
        setSocket(s);
      } catch (err) {
        console.error('[TelegramTab] socket.io connect failed', err);
      }
      return () => {
        if (s) {
          s.removeAllListeners();
          s.disconnect();
        }
        setSocket(null);
      };
    }
    return undefined;
  }, [authStatus?.connected]);

  const openDialog = useCallback((dialog: DialogItem) => {
    setSelectedDialog(dialog);
    setActiveTab('chat');
  }, []);

  const openDialogById = useCallback((chat_id: number, fallbackTitle?: string) => {
    setSelectedDialog({
      id: chat_id,
      title: fallbackTitle || `محادثة ${chat_id}`,
      type: 'group',
    });
    setActiveTab('chat');
  }, []);

  const handleLogout = () => {
    // No backend logout endpoint exists; do a frontend-only disconnect.
    // The session file remains on disk (so re-auth is fast).
    setAuthStatus({ connected: false, user: null });
    setSelectedDialog(null);
    setActiveTab('auth');
    toast.info('تم تسجيل الخروج محلياً — ملف الجلسة محفوظ لإعادة الدخول السريع');
  };

  const requireAuth = useCallback(() => {
    setActiveTab('auth');
    toast.error('يرجى تسجيل الدخول أولاً');
  }, []);

  return (
    <div dir="rtl" className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="auth" className="gap-1.5">
            <Key className="h-4 w-4" />
            المصادقة
            {authStatus?.connected ? (
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            ) : (
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            )}
          </TabsTrigger>
          <TabsTrigger value="dialogs" className="gap-1.5">
            <MessageSquare className="h-4 w-4" />
            المحادثات
          </TabsTrigger>
          <TabsTrigger value="chat" disabled={!selectedDialog} className="gap-1.5">
            <Send className="h-4 w-4" />
            المحادثة
          </TabsTrigger>
          <TabsTrigger
            value="members"
            disabled={!selectedDialog || selectedDialog.type === 'user'}
            className="gap-1.5"
          >
            <Users className="h-4 w-4" />
            الأعضاء
          </TabsTrigger>
          <TabsTrigger value="search" className="gap-1.5">
            <Search className="h-4 w-4" />
            البحث
          </TabsTrigger>
          <TabsTrigger value="legacy" className="gap-1.5">
            <Bot className="h-4 w-4" />
            أدوات البوت
          </TabsTrigger>
        </TabsList>

        <TabsContent value="auth">
          <AuthTab
            authStatus={authStatus}
            authLoading={authLoading}
            onRefresh={fetchAuthStatus}
            onLogout={handleLogout}
            onAuthenticated={(status) => {
              setAuthStatus(status);
              setActiveTab('dialogs');
            }}
          />
        </TabsContent>

        <TabsContent value="dialogs">
          <DialogsTab
            authenticated={!!authStatus?.connected}
            openDialog={openDialog}
            onRequireAuth={requireAuth}
          />
        </TabsContent>

        <TabsContent value="chat">
          {selectedDialog ? (
            <ChatTab
              dialog={selectedDialog}
              socket={socket}
              onBack={() => setActiveTab('dialogs')}
              onRequireAuth={requireAuth}
            />
          ) : (
            <EmptyState
              icon={<MessageSquare className="h-10 w-10" />}
              text="اختر محادثة من تبويب المحادثات"
            />
          )}
        </TabsContent>

        <TabsContent value="members">
          {selectedDialog && selectedDialog.type !== 'user' ? (
            <MembersTab
              groupId={selectedDialog.id}
              groupTitle={selectedDialog.title}
              authenticated={!!authStatus?.connected}
              onRequireAuth={requireAuth}
            />
          ) : (
            <EmptyState
              icon={<Users className="h-10 w-10" />}
              text="الأعضاء متاحون للمجموعات والقنوات فقط"
            />
          )}
        </TabsContent>

        <TabsContent value="search">
          <SearchTab
            authenticated={!!authStatus?.connected}
            openDialog={(chat_id, title) => openDialogById(chat_id, title)}
            onRequireAuth={requireAuth}
          />
        </TabsContent>

        <TabsContent value="legacy">
          <LegacyBotTab authenticated={!!authStatus?.connected} onRequireAuth={requireAuth} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ====== Empty State ======
function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <div className="mb-3 opacity-40">{icon}</div>
        <p className="text-sm">{text}</p>
      </CardContent>
    </Card>
  );
}

// ====== Not Authenticated Banner ======
function NotAuthBanner({ onRequireAuth }: { onRequireAuth: () => void }) {
  return (
    <Card className="border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
      <CardContent className="py-6 flex flex-col items-center text-center gap-3">
        <XCircle className="h-8 w-8 text-amber-600" />
        <p className="font-medium text-amber-800 dark:text-amber-200">
          يرجى تسجيل الدخول أولاً
        </p>
        <p className="text-sm text-amber-700 dark:text-amber-300">
          هذا التبويب يتطلب مصادقة على Telegram
        </p>
        <Button onClick={onRequireAuth} variant="outline">
          <Key className="h-4 w-4 ml-2" />
          الذهاب للمصادقة
        </Button>
      </CardContent>
    </Card>
  );
}

// ====== Tab 1: AuthTab ======
function AuthTab({ authStatus, authLoading, onRefresh, onLogout, onAuthenticated }: {
  authStatus: AuthStatus | null;
  authLoading: boolean;
  onRefresh: () => void;
  onLogout: () => void;
  onAuthenticated: (status: AuthStatus) => void;
}) {
  const [step, setStep] = useState<'phone' | 'code' | 'password'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendCode = async () => {
    if (!phone.trim()) { toast.error('أدخل رقم الهاتف'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/telegram/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.success || data.needs_code)) {
        setStep('code');
        toast.success('تم إرسال رمز التحقق إلى Telegram');
      } else {
        toast.error(data.error || 'فشل إرسال الكود');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  const handleConnectUser = async () => {
    if (!phone.trim()) { toast.error('أدخل رقم الهاتف'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/telegram/auth/connect-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.authorized) {
        toast.success('الجلسة فعّالة ✓');
        onRefresh();
        onAuthenticated({ connected: true, user: data.user });
      } else if (data.needs_code || data.success) {
        setStep('code');
        toast.success('تم بدء المصادقة — أرسل الكود الآن');
      } else {
        toast.error(data.error || 'فشل بدء المصادقة');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!code.trim()) { toast.error('أدخل رمز التحقق'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/telegram/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), code: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && data.authorized) {
        toast.success('تم المصادقة بنجاح ✓');
        onRefresh();
        onAuthenticated({ connected: true, user: data.user });
      } else if (data.needs_password || (data.error && /2FA|password|كلمة\s*المرور/i.test(String(data.error)))) {
        setStep('password');
        toast.info('الحساب محمي بكلمة مرور 2FA — أدخل كلمة المرور');
      } else {
        toast.error(data.error || 'رمز غير صحيح');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPassword = async () => {
    if (!password) { toast.error('أدخل كلمة المرور'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/telegram/auth/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && data.authorized) {
        toast.success('تم المصادقة بنجاح ✓');
        onRefresh();
        onAuthenticated({ connected: true, user: data.user });
      } else {
        toast.error(data.error || 'كلمة مرور غير صحيحة');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <Card>
        <CardContent className="py-10 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Connected view
  if (authStatus?.connected) {
    const u = authStatus.user;
    const name = [u?.first_name, u?.last_name].filter(Boolean).join(' ').trim() || 'مستخدم Telegram';
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-emerald-500" />
            متصل بـ Telegram
          </CardTitle>
          <CardDescription>تم تأكيد المصادقة على حسابك الشخصي</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-16 w-16">
              <AvatarFallback className={cn('text-white text-lg', colorForId(u?.id ?? name))}>
                {initialsOf(name)}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-lg font-semibold">{name}</p>
                <Badge className="bg-emerald-500 hover:bg-emerald-500 text-white">متصل</Badge>
              </div>
              {u?.username && (
                <p className="text-sm text-muted-foreground" dir="ltr">@{u.username}</p>
              )}
              {u?.phone && (
                <p className="text-sm text-muted-foreground" dir="ltr">{u.phone}</p>
              )}
              <p className="text-xs text-muted-foreground">ID: {u?.id ?? '—'}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onRefresh} disabled={authLoading}>
              <RefreshCw className={cn('h-4 w-4 ml-2', authLoading && 'animate-spin')} />
              تحديث الحالة
            </Button>
            <Button variant="destructive" onClick={onLogout}>
              <LogOut className="h-4 w-4 ml-2" />
              تسجيل الخروج
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Not connected — login form
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <XCircle className="h-5 w-5 text-red-500" />
          غير متصل بـ Telegram
        </CardTitle>
        <CardDescription>
          للمحادثات والإرسال، يجب المصادقة برقم هاتفك المسجل في Telegram
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {step === 'phone' && (
          <div className="space-y-3">
            <Label htmlFor="tg-phone">رقم الهاتف</Label>
            <div className="flex gap-2">
              <Input
                id="tg-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+201xxxxxxxxx"
                className="max-w-xs"
                dir="ltr"
              />
              <Button onClick={handleSendCode} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <Phone className="h-4 w-4 ml-2" />}
                إرسال الكود
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={handleConnectUser} disabled={loading}>
              <Key className="h-3.5 w-3.5 ml-1.5" />
              أو محاولة إعادة الاتصال بجلسة محفوظة
            </Button>
          </div>
        )}

        {step === 'code' && (
          <div className="space-y-3">
            <Label htmlFor="tg-code">رمز التحقق</Label>
            <p className="text-sm text-muted-foreground">
              تم إرسال رمز إلى Telegram على الرقم <span dir="ltr" className="font-mono">{phone}</span>
            </p>
            <div className="flex gap-2">
              <Input
                id="tg-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="12345"
                className="max-w-xs"
                dir="ltr"
                inputMode="numeric"
              />
              <Button onClick={handleVerifyCode} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <CheckCircle className="h-4 w-4 ml-2" />}
                تأكيد الكود
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setStep('phone')}>
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              رجوع
            </Button>
          </div>
        )}

        {step === 'password' && (
          <div className="space-y-3">
            <Label htmlFor="tg-password">كلمة مرور 2FA</Label>
            <p className="text-sm text-muted-foreground">الحساب محمي بتحقق بخطوتين</p>
            <div className="flex gap-2">
              <Input
                id="tg-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="max-w-xs"
                dir="ltr"
              />
              <Button onClick={handleVerifyPassword} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <Lock className="h-4 w-4 ml-2" />}
                تأكيد كلمة المرور
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setStep('code')}>
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              رجوع
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ====== Tab 2: DialogsTab ======
function DialogsTab({ authenticated, openDialog, onRequireAuth }: {
  authenticated: boolean;
  openDialog: (d: DialogItem) => void;
  onRequireAuth: () => void;
}) {
  const [dialogs, setDialogs] = useState<DialogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const fetchDialogs = useCallback(async () => {
    if (!authenticated) { onRequireAuth(); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/telegram/dialogs?limit=100');
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (data.success) {
        setDialogs(Array.isArray(data.dialogs) ? data.dialogs : []);
      } else {
        toast.error(data.error || 'فشل تحميل المحادثات');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, [authenticated, onRequireAuth]);

  useEffect(() => {
    if (authenticated) fetchDialogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  const filtered = dialogs.filter((d) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      d.title?.toLowerCase().includes(q) ||
      d.username?.toLowerCase().includes(q)
    );
  });

  if (!authenticated) return <NotAuthBanner onRequireAuth={onRequireAuth} />;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-emerald-600" />
            المحادثات
          </span>
          <Button variant="outline" size="sm" onClick={fetchDialogs} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4 ml-1', loading && 'animate-spin')} />
            تحديث
          </Button>
        </CardTitle>
        <CardDescription>
          {loading ? 'جاري التحميل...' : `${filtered.length} محادثة`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو اسم المستخدم..."
            className="pr-10"
          />
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-2">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-2.5 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-10 w-10" />}
            text={search ? 'لا توجد نتائج مطابقة' : 'لا توجد محادثات'}
          />
        ) : (
          <div className="max-h-[60vh] overflow-y-auto pr-1 -mr-1 space-y-1">
            {filtered.map((d) => (
              <button
                key={d.id}
                onClick={() => openDialog(d)}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent transition-colors text-right border border-transparent hover:border-border"
              >
                <Avatar className="h-11 w-11 shrink-0">
                  <AvatarFallback className={cn('text-white', colorForId(d.id))}>
                    {initialsOf(d.title)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">{dialogTypeIcon(d.type)}</span>
                    <p className="font-medium truncate">{d.title || 'بدون اسم'}</p>
                    {d.username && (
                      <span className="text-xs text-muted-foreground truncate" dir="ltr">@{d.username}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {d.last_message_text || '—'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatTime(d.last_message_at)}
                  </span>
                  {d.unread_count && d.unread_count > 0 ? (
                    <Badge className="bg-red-500 hover:bg-red-500 text-white text-[10px] h-5 min-w-5 px-1.5 justify-center">
                      {d.unread_count > 99 ? '99+' : d.unread_count}
                    </Badge>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ====== Tab 3: ChatTab ======
function ChatTab({ dialog, socket, onBack, onRequireAuth }: {
  dialog: DialogItem;
  socket: Socket | null;
  onBack: () => void;
  onRequireAuth: () => void;
}) {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<MessageItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [oldestId, setOldestId] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatIdRef = useRef<number>(dialog.id);
  chatIdRef.current = dialog.id;

  // Fetch history
  const fetchHistory = useCallback(async (offsetId?: number) => {
    const isMore = !!offsetId;
    if (isMore) setLoadingMore(true); else setLoading(true);
    try {
      const q = offsetId ? `&offset_id=${offsetId}` : '';
      const res = await fetch(`/api/telegram/dialogs/${dialog.id}/history?limit=50${q}`);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (data.success && Array.isArray(data.messages)) {
        const newMsgs: MessageItem[] = data.messages;
        if (isMore) {
          if (newMsgs.length === 0) { setHasMore(false); }
          else {
            setMessages((prev) => {
              const existingIds = new Set(prev.map((m) => m.id));
              const unique = newMsgs.filter((m) => !existingIds.has(m.id));
              // prepend older
              return [...unique, ...prev];
            });
            const minId = newMsgs.reduce((min, m) => (m.id < min ? m.id : min), newMsgs[0]?.id ?? Infinity);
            setOldestId((prev) => (prev === null ? minId : Math.min(prev, minId)));
            if (newMsgs.length < 50) setHasMore(false);
          }
        } else {
          setMessages(newMsgs);
          if (newMsgs.length > 0) {
            const minId = newMsgs.reduce((min, m) => (m.id < min ? m.id : min), newMsgs[0].id);
            setOldestId(minId);
          }
          if (newMsgs.length < 50) setHasMore(false);
        }
      } else if (!isMore) {
        toast.error(data.error || 'فشل تحميل الرسائل');
      }
    } catch {
      if (!isMore) toast.error('خطأ في الاتصال بالخادم');
    } finally {
      if (isMore) setLoadingMore(false); else setLoading(false);
    }
  }, [dialog.id, onRequireAuth]);

  // Initial load
  useEffect(() => {
    setMessages([]);
    setHasMore(true);
    setOldestId(null);
    fetchHistory();
  }, [fetchHistory]);

  // Auto scroll to bottom on first load + new outgoing
  useEffect(() => {
    if (!loading && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last?.is_outgoing || last?.pending) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages, loading]);

  // Socket.io real-time listeners
  useEffect(() => {
    if (!socket) return;
    const handlerNew = (data: { chat_id?: number; message_id?: number; text?: string; from_id?: number; is_outgoing?: boolean }) => {
      if (!data || data.chat_id !== chatIdRef.current) return;
      const newMsg: MessageItem = {
        id: data.message_id ?? Date.now(),
        text: data.text || '',
        date: new Date().toISOString(),
        from_id: data.from_id,
        is_outgoing: !!data.is_outgoing,
        media_type: null,
        reply_to_msg_id: null,
      };
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
      // auto-scroll on new incoming
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
    };
    const handlerEdited = (data: { chat_id?: number; message_id?: number; text?: string }) => {
      if (!data || data.chat_id !== chatIdRef.current) return;
      setMessages((prev) => prev.map((m) =>
        m.id === data.message_id ? { ...m, text: data.text ?? m.text, pending: false } : m
      ));
    };
    const handlerDeleted = (data: { chat_id?: number; deleted_ids?: number[] }) => {
      if (!data || data.chat_id !== chatIdRef.current) return;
      const ids = new Set(data.deleted_ids || []);
      if (ids.size === 0) return;
      setMessages((prev) => prev.filter((m) => !ids.has(m.id)));
    };

    socket.on('telegram:new_message', handlerNew);
    socket.on('telegram:message_edited', handlerEdited);
    socket.on('telegram:message_deleted', handlerDeleted);
    return () => {
      socket.off('telegram:new_message', handlerNew);
      socket.off('telegram:message_edited', handlerEdited);
      socket.off('telegram:message_deleted', handlerDeleted);
    };
  }, [socket]);

  // Send message
  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    // optimistic
    const tempId = -Date.now();
    const optimistic: MessageItem = {
      id: tempId,
      text,
      date: new Date().toISOString(),
      is_outgoing: true,
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }));
    try {
      const res = await fetch('/api/telegram/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer_id: dialog.id, message: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (data.success) {
        // replace temp with real id
        const realId = data.message_id ?? data.id;
        setMessages((prev) => prev.map((m) =>
          m.id === tempId ? { ...m, id: realId, pending: false } : m
        ));
      } else {
        toast.error(data.error || 'فشل إرسال الرسالة');
        // remove optimistic
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setInput(text); // restore input
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  // Edit message
  const handleStartEdit = (m: MessageItem) => {
    setEditingId(m.id);
    setEditText(m.text);
  };
  const handleCancelEdit = () => { setEditingId(null); setEditText(''); };
  const handleSaveEdit = async () => {
    if (editingId === null) return;
    const newText = editText.trim();
    if (!newText) { toast.error('النص فارغ'); return; }
    const prevText = messages.find((m) => m.id === editingId)?.text;
    setMessages((prev) => prev.map((m) => m.id === editingId ? { ...m, text: newText } : m));
    setEditingId(null);
    try {
      const res = await fetch('/api/telegram/messages/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer_id: dialog.id, message_id: editingId, new_text: newText }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (!data.success) {
        toast.error(data.error || 'فشل التعديل');
        setMessages((prev) => prev.map((m) => m.id === editingId ? { ...m, text: prevText ?? m.text } : m));
      } else {
        toast.success('تم تعديل الرسالة');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
      setMessages((prev) => prev.map((m) => m.id === editingId ? { ...m, text: prevText ?? m.text } : m));
    }
  };

  // Delete message
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    const prev = messages;
    setMessages((m) => m.filter((x) => x.id !== target.id));
    try {
      const res = await fetch('/api/telegram/messages/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer_id: dialog.id, message_ids: [target.id], revoke: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); setMessages(prev); return; }
      if (!data.success) {
        toast.error(data.error || 'فشل الحذف');
        setMessages(prev);
      } else {
        toast.success('تم حذف الرسالة');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
      setMessages(prev);
    }
  };

  // Media upload (note: proxy uses text() body which may corrupt binary — see report)
  const handleFilePick = () => fileInputRef.current?.click();
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.error('حجم الملف يتجاوز 50MB');
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    try {
      const fd = new FormData();
      fd.append('peer_id', String(dialog.id));
      fd.append('file', file);
      fd.append('caption', '');
      // XMLHttpRequest for progress events
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`HTTP ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error('network error'));
        xhr.open('POST', '/api/telegram/media/upload');
        xhr.send(fd);
      });
      toast.success('تم رفع الملف ✓');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`فشل رفع الملف: ${msg}`);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  // Pagination on scroll to top
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop < 50 && hasMore && !loadingMore && !loading && oldestId !== null) {
      fetchHistory(oldestId);
    }
  };

  return (
    <Card className="flex flex-col h-[75vh] min-h-[500px]">
      {/* Header */}
      <CardHeader className="py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Avatar className="h-9 w-9">
            <AvatarFallback className={cn('text-white text-sm', colorForId(dialog.id))}>
              {initialsOf(dialog.title)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{dialog.title}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              {dialogTypeIcon(dialog.type)} {dialogTypeLabel(dialog.type)}
              {dialog.username && <span dir="ltr">@{dialog.username}</span>}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => fetchHistory()} disabled={loading} className="h-8 w-8">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>

      {/* Messages */}
      <CardContent
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 space-y-2"
      >
        {hasMore && (
          <div className="flex justify-center pb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => oldestId !== null && fetchHistory(oldestId)}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <Loader2 className="h-3.5 w-3.5 ml-1 animate-spin" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5 ml-1" />
              )}
              تحميل رسائل أقدم
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <MessageSquare className="h-10 w-10 mb-2 opacity-30" />
            <p className="text-sm">لا توجد رسائل — أرسل أول رسالة</p>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              msg={m}
              editing={editingId === m.id}
              editText={editText}
              onEditText={setEditText}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={handleCancelEdit}
              onStartEdit={() => handleStartEdit(m)}
              onDelete={() => setDeleteTarget(m)}
            />
          ))
        )}
        <div ref={bottomRef} />
      </CardContent>

      {/* Input */}
      <div className="border-t p-3 shrink-0 space-y-2">
        {uploading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>جاري رفع الملف... {uploadProgress}%</span>
            <div className="flex-1 h-1.5 bg-muted rounded overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
            accept="image/*,video/*,audio/*,application/pdf"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={handleFilePick}
            disabled={uploading || sending}
            title="إرفاق ملف"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="اكتب رسالة..."
              disabled={sending || uploading}
            />
          </div>
          <Button onClick={handleSend} disabled={sending || !input.trim() || uploading}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Delete confirm dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الرسالة</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذه الرسالة؟ سيتم الحذف للجميع.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ====== Message Bubble ======
function MessageBubble({ msg, editing, editText, onEditText, onSaveEdit, onCancelEdit, onStartEdit, onDelete }: {
  msg: MessageItem;
  editing: boolean;
  editText: string;
  onEditText: (s: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={cn('flex', msg.is_outgoing ? 'justify-start' : 'justify-end')}>
      {/* RTL: outgoing on left (visually) since dir=rtl reverses — keep using justify-start for outgoing */}
      <div className={cn(
        'group relative max-w-[80%] rounded-2xl px-3 py-2 text-sm break-words shadow-sm',
        msg.is_outgoing
          ? 'bg-emerald-500 text-white rounded-tl-sm'
          : 'bg-muted text-foreground rounded-tr-sm'
      )}>
        {editing ? (
          <div className="space-y-2 min-w-[200px]">
            <textarea
              value={editText}
              onChange={(e) => onEditText(e.target.value)}
              className="w-full bg-white/10 border border-white/30 rounded p-1.5 text-white text-sm resize-none"
              rows={3}
              autoFocus
            />
            <div className="flex gap-1.5">
              <Button size="sm" className="h-7" onClick={onSaveEdit}>
                <CheckCircle className="h-3.5 w-3.5 ml-1" />
                حفظ
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-white hover:bg-white/10" onClick={onCancelEdit}>
                إلغاء
              </Button>
            </div>
          </div>
        ) : (
          <>
            {msg.media_type && (
              <div className="mb-1 text-[10px] opacity-80 flex items-center gap-1">
                <Paperclip className="h-3 w-3" />
                {msg.media_type}
              </div>
            )}
            <p className="whitespace-pre-wrap">{msg.text || '—'}</p>
            <div className={cn(
              'flex items-center gap-1 mt-1 text-[10px]',
              msg.is_outgoing ? 'text-white/70' : 'text-muted-foreground'
            )}>
              <span>{formatTime(msg.date)}</span>
              {msg.pending && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
            </div>

            {/* Actions menu */}
            {msg.is_outgoing && !msg.pending && (
              <div className="absolute -top-2 opacity-0 group-hover:opacity-100 transition-opacity"
                   style={msg.is_outgoing ? { left: -8 } : { right: -8 }}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-6 w-6 rounded-full shadow"
                    >
                      <MoreVertical className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align={msg.is_outgoing ? 'start' : 'end'}>
                    <DropdownMenuItem onClick={onStartEdit}>
                      <Pencil className="h-3.5 w-3.5 ml-2" />
                      تعديل
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onDelete}
                      className="text-red-600 focus:text-red-700 focus:bg-red-50 dark:focus:bg-red-950"
                    >
                      <Trash2 className="h-3.5 w-3.5 ml-2" />
                      حذف
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ====== Tab 4: MembersTab ======
function MembersTab({ groupId, groupTitle, authenticated, onRequireAuth }: {
  groupId: number;
  groupTitle: string;
  authenticated: boolean;
  onRequireAuth: () => void;
}) {
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [addUserId, setAddUserId] = useState('');
  const [addAccessHash, setAddAccessHash] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchMembers = useCallback(async () => {
    if (!authenticated) { onRequireAuth(); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/telegram/groups/${groupId}/members?limit=100&offset=0&search=${encodeURIComponent(search)}`);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (data.success) {
        setMembers(Array.isArray(data.members) ? data.members : []);
      } else {
        toast.error(data.error || 'فشل تحميل الأعضاء');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, [groupId, search, authenticated, onRequireAuth]);

  useEffect(() => {
    if (authenticated) fetchMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, groupId]);

  const filtered = members.filter((m) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const name = [m.first_name, m.last_name].filter(Boolean).join(' ').toLowerCase();
    return name.includes(q) || (m.username?.toLowerCase().includes(q) ?? false);
  });

  const handleAdd = async () => {
    const uid = addUserId.trim();
    if (!uid || !/^\d+$/.test(uid)) { toast.error('أدخل معرّف مستخدم صحيح (رقم)'); return; }
    setAdding(true);
    try {
      const body: { user_id: string; user_access_hash?: string } = { user_id: uid };
      if (addAccessHash.trim()) body.user_access_hash = addAccessHash.trim();
      const res = await fetch(`/api/telegram/groups/${groupId}/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (data.success) {
        toast.success('تمت إضافة العضو ✓');
        setAddUserId('');
        setAddAccessHash('');
        fetchMembers();
      } else {
        toast.error(data.error || 'فشل الإضافة');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (m: MemberItem) => {
    try {
      const res = await fetch(`/api/telegram/groups/${groupId}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: m.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (data.success) {
        toast.success('تم طرد العضو');
        setMembers((prev) => prev.filter((x) => x.id !== m.id));
      } else {
        toast.error(data.error || 'فشل الطرد');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    }
  };

  if (!authenticated) return <NotAuthBanner onRequireAuth={onRequireAuth} />;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Users className="h-5 w-5 text-emerald-600" />
            أعضاء: {groupTitle}
          </span>
          <Button variant="outline" size="sm" onClick={fetchMembers} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4 ml-1', loading && 'animate-spin')} />
            تحديث
          </Button>
        </CardTitle>
        <CardDescription>
          {loading ? 'جاري التحميل...' : `${filtered.length} عضو`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add member */}
        <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <UserPlus className="h-4 w-4 text-emerald-600" />
            إضافة عضو
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
              placeholder="معرّف المستخدم (user_id)"
              className="flex-1 min-w-[150px]"
              dir="ltr"
              inputMode="numeric"
            />
            <Input
              value={addAccessHash}
              onChange={(e) => setAddAccessHash(e.target.value)}
              placeholder="access_hash (اختياري)"
              className="flex-1 min-w-[150px]"
              dir="ltr"
            />
            <Button onClick={handleAdd} disabled={adding}>
              {adding ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <Plus className="h-4 w-4 ml-1" />}
              إضافة
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث عن عضو..."
            className="pr-10"
          />
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-2">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Users className="h-10 w-10" />} text={search ? 'لا توجد نتائج' : 'لا توجد أعضاء'} />
        ) : (
          <div className="max-h-[55vh] overflow-y-auto pr-1 -mr-1 space-y-1">
            {filtered.map((m) => {
              const name = [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || 'بدون اسم';
              const roleBadge = m.is_banned ? (
                <Badge className="bg-red-500 hover:bg-red-500 text-white text-[10px]">محظور</Badge>
              ) : m.is_admin ? (
                <Badge className="bg-teal-600 hover:bg-teal-600 text-white text-[10px]">
                  <Shield className="h-2.5 w-2.5 ml-1" />
                  مشرف
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]">عضو</Badge>
              );
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-transparent hover:border-border hover:bg-accent transition-colors"
                >
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarFallback className={cn('text-white text-sm', colorForId(m.id))}>
                      {initialsOf(name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{name}</p>
                      {roleBadge}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span dir="ltr">ID: {m.id}</span>
                      {m.username && <span dir="ltr">@{m.username}</span>}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                    onClick={() => handleRemove(m)}
                    title="طرد"
                  >
                    <UserPlus className="h-4 w-4 rotate-180" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ====== Tab 5: SearchTab ======
function SearchTab({ authenticated, openDialog, onRequireAuth }: {
  authenticated: boolean;
  openDialog: (chat_id: number, title?: string) => void;
  onRequireAuth: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) { toast.error('أدخل نص البحث'); return; }
    if (!authenticated) { onRequireAuth(); return; }
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/telegram/search?q=${encodeURIComponent(q)}&limit=50`);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (data.success) {
        setResults(Array.isArray(data.results) ? data.results : []);
        if ((data.results || []).length === 0) toast.info('لا توجد نتائج');
      } else {
        toast.error(data.error || 'فشل البحث');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  if (!authenticated) return <NotAuthBanner onRequireAuth={onRequireAuth} />;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5 text-emerald-600" />
          البحث في الرسائل
        </CardTitle>
        <CardDescription>بحث عام في كل المحادثات</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            placeholder="ابحث في الرسائل..."
            className="flex-1"
          />
          <Button onClick={handleSearch} disabled={loading || !query.trim()}>
            {loading ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <Search className="h-4 w-4 ml-1" />}
            بحث
          </Button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : results.length === 0 ? (
          searched ? (
            <EmptyState icon={<Search className="h-10 w-10" />} text="لا توجد نتائج" />
          ) : (
            <EmptyState icon={<Search className="h-10 w-10" />} text="ابدأ بكتابة نص للبحث" />
          )
        ) : (
          <div className="max-h-[60vh] overflow-y-auto pr-1 -mr-1 space-y-2">
            {results.map((r) => (
              <button
                key={`${r.chat_id}-${r.id}`}
                onClick={() => openDialog(r.chat_id, `محادثة ${r.chat_id}`)}
                className="w-full text-right p-3 rounded-lg border hover:border-emerald-400 hover:bg-accent transition-colors"
              >
                <p className="text-sm line-clamp-3 whitespace-pre-wrap">{r.text}</p>
                <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                  <span>محادثة #{r.chat_id}</span>
                  <span>{formatDateTime(r.date)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ====== Tab 6: LegacyBotTab (preserved bot-based features) ======
interface LegacyChannel {
  channel_id: string;
  channel_name: string;
  username?: string;
  market: string;
  content_type: string;
  is_active: number;
}
interface LegacyMyChannel {
  channel_id: string;
  channel_name: string;
  username?: string;
  type?: string;
  members?: number;
  market?: string;
  content_type?: string;
}
interface LegacyRec {
  id: number;
  symbol: string;
  market: string;
  action: string;
  entry_price?: number;
  target_price?: number;
  stop_loss?: number;
  confidence: number;
  channel_name: string;
  created_at: string;
}
interface LegacyNews {
  id: number;
  title: string;
  market: string;
  sentiment: string;
  importance: number;
  channel_name: string;
  created_at: string;
}
interface LegacyMessage {
  message_id: number;
  text: string;
  date: string;
  views?: number;
  channel_name?: string;
  has_images?: number;
  is_reply?: boolean;
  reply_to_text?: string | null;
}

function LegacyBotTab({ authenticated, onRequireAuth }: {
  authenticated: boolean;
  onRequireAuth: () => void;
}) {
  const [sub, setSub] = useState('channels');
  const [channels, setChannels] = useState<LegacyChannel[]>([]);
  const [myChannels, setMyChannels] = useState<LegacyMyChannel[]>([]);
  const [recommendations, setRecommendations] = useState<LegacyRec[]>([]);
  const [news, setNews] = useState<LegacyNews[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [newChannelMarket, setNewChannelMarket] = useState('egypt');
  const [newChannelType, setNewChannelType] = useState('recommendations');
  const [messages, setMessages] = useState<LegacyMessage[]>([]);
  const [selectedChannelForMessages, setSelectedChannelForMessages] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [processingMsg, setProcessingMsg] = useState<number | null>(null);
  const [cleanedTexts, setCleanedTexts] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [scraping, setScraping] = useState(false);

  const fetchMyChannels = useCallback(async () => {
    if (!authenticated) { onRequireAuth(); return; }
    setLoadingChannels(true);
    try {
      const res = await fetch('/api/telegram/channels/my');
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (data.success) setMyChannels(data.channels || []);
    } catch {
      /* silent */
    } finally {
      setLoadingChannels(false);
    }
  }, [authenticated, onRequireAuth]);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/channels/tracked');
      const data = await res.json().catch(() => ({}));
      setChannels(data.channels || []);
    } catch {
      /* silent */
    }
  }, []);

  const fetchRecs = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/recommendations?limit=20');
      const data = await res.json().catch(() => ({}));
      setRecommendations(data.recommendations || []);
    } catch {
      /* silent */
    }
  }, []);

  const fetchNewsList = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/news?limit=20');
      const data = await res.json().catch(() => ({}));
      setNews(data.news || []);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchChannels();
    fetchRecs();
    fetchNewsList();
    if (authenticated) fetchMyChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  const handleAddChannel = async () => {
    if (!selectedChannelId) { toast.error('اختر قناة من القائمة'); return; }
    const ch = myChannels.find((c) => c.channel_id === selectedChannelId);
    if (!ch) return;
    setScraping(true);
    try {
      const res = await fetch('/api/telegram/channels/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: ch.channel_id,
          channel_name: ch.channel_name,
          username: ch.username,
          market: newChannelMarket,
          content_type: newChannelType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setSelectedChannelId('');
        fetchChannels();
        toast.success('تمت إضافة القناة');
      } else {
        toast.error(data.error || 'خطأ في الإضافة');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setScraping(false);
    }
  };

  const handleRemoveChannel = async (channelId: string) => {
    try {
      const res = await fetch(`/api/telegram/channels/untrack/${channelId}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        fetchChannels();
        toast.success('تمت إزالة القناة');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    }
  };

  const handleScrape = async () => {
    setScraping(true);
    try {
      const res = await fetch('/api/telegram/scrape/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 7, limit: 100 }),
      });
      const data = await res.json().catch(() => ({}));
      toast.success(`تم سحب ${data.results?.length || 0} قناة`);
      fetchRecs();
      fetchNewsList();
    } catch {
      toast.error('خطأ في السحب');
    } finally {
      setScraping(false);
    }
  };

  const fetchMessages = async (channelId: string) => {
    if (!channelId) return;
    setLoadingMessages(true);
    setMessages([]);
    try {
      const res = await fetch('/api/telegram/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channelId, limit: 20, days: 7 }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && data.messages) setMessages(data.messages);
      else toast.error(data.error || 'فشل في سحب الرسائل');
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleCleanMessage = async (msgId: number, text: string) => {
    setProcessingMsg(msgId);
    try {
      const res = await fetch('/api/telegram/ai/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setCleanedTexts((prev) => ({ ...prev, [msgId]: data.text }));
        toast.success(`تم التنظيف بواسطة ${data.engine || 'AI'}`);
      } else {
        toast.error('AI غير متاح - استخدم النص الأصلي');
      }
    } catch {
      toast.error('خطأ في المعالجة');
    } finally {
      setProcessingMsg(null);
    }
  };

  const handleSaveMessage = async (msgId: number, type: 'recommendation' | 'news') => {
    const text = cleanedTexts[msgId] || messages.find((m) => m.message_id === msgId)?.text || '';
    if (!text) return;
    setSaving(true);
    try {
      const channel = channels.find((c) => c.channel_id === selectedChannelForMessages);
      const res = await fetch('/api/telegram/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          original_text: messages.find((m) => m.message_id === msgId)?.text || '',
          reasoning: text,
          channel_name: channel?.channel_name || '',
          market: channel?.market || 'egypt',
          symbol: '',
          action: 'buy',
          entry_price: 0,
          target_price: 0,
          stop_loss: 0,
          confidence: 0.5,
          title: text.substring(0, 100),
          summary: text,
          sentiment: 'neutral',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        toast.success(type === 'recommendation' ? 'تم حفظ التوقّع ✓' : 'تم حفظ الخبر ✓');
        fetchRecs();
        fetchNewsList();
      } else {
        toast.error(data.error || 'فشل الحفظ');
      }
    } catch {
      toast.error('خطأ في الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const getMarketLabel = (market: string) => {
    const labels: Record<string, string> = {
      egypt: '🇪🇬 مصر', saudi: '🇸🇦 السعودية', kuwait: '🇰🇼 الكويت',
      qatar: '🇶🇦 قطر', crypto: '₿ عملات رقمية', general: '🌍 عام',
    };
    return labels[market] || market;
  };

  const getActionBadge = (action: string) => {
    const colors: Record<string, string> = {
      buy: 'bg-emerald-500', sell: 'bg-red-500', hold: 'bg-amber-500',
    };
    return colors[action] || 'bg-gray-500';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-emerald-600" />
          أدوات البوت القديم
        </CardTitle>
        <CardDescription>
          تتبع القنوات، سحب المحتوى، تنظيفه بالـ AI وحفظه كتوقعات/أخبار
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={sub} onValueChange={setSub}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="channels"><Users className="h-3.5 w-3.5 ml-1" />القنوات</TabsTrigger>
            <TabsTrigger value="content"><FileText className="h-3.5 w-3.5 ml-1" />المحتوى</TabsTrigger>
            <TabsTrigger value="recommendations"><TrendingUp className="h-3.5 w-3.5 ml-1" />التوقعات</TabsTrigger>
            <TabsTrigger value="news"><Newspaper className="h-3.5 w-3.5 ml-1" />الأخبار</TabsTrigger>
          </TabsList>

          {/* Channels */}
          <TabsContent value="channels" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-3">
                <p className="text-sm font-medium">إضافة قناة للمتابعة</p>
                {loadingChannels ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> جاري تحميل قنواتك...
                  </div>
                ) : myChannels.length === 0 ? (
                  <div className="text-sm text-muted-foreground p-3 border rounded bg-muted/50">
                    {authenticated ? 'لم يتم العثور على قنوات. تأكد من اشتراكك.' : 'يجب المصادقة أولاً.'}
                  </div>
                ) : (
                  <select
                    className="w-full p-2 border rounded bg-background text-sm"
                    value={selectedChannelId}
                    onChange={(e) => setSelectedChannelId(e.target.value)}
                  >
                    <option value="">-- اختر قناة --</option>
                    {myChannels.map((ch) => (
                      <option key={ch.channel_id} value={ch.channel_id}>
                        {ch.channel_name}
                        {ch.members ? ` (${ch.members.toLocaleString()} عضو)` : ''}
                        {ch.username ? ` @${ch.username}` : ''}
                      </option>
                    ))}
                  </select>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="p-2 border rounded bg-background text-sm"
                    value={newChannelMarket}
                    onChange={(e) => setNewChannelMarket(e.target.value)}
                  >
                    <option value="egypt">🇪🇬 مصر (EGX)</option>
                    <option value="saudi">🇸🇦 السعودية</option>
                    <option value="kuwait">🇰🇼 الكويت</option>
                    <option value="crypto">₿ عملات رقمية</option>
                    <option value="general">🌍 عام</option>
                  </select>
                  <select
                    className="p-2 border rounded bg-background text-sm"
                    value={newChannelType}
                    onChange={(e) => setNewChannelType(e.target.value)}
                  >
                    <option value="recommendations">توقعات</option>
                    <option value="news">أخبار</option>
                    <option value="analysis">تحليلات</option>
                    <option value="general">عام</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={fetchMyChannels} disabled={loadingChannels}>
                    <RefreshCw className={cn('h-4 w-4 ml-1', loadingChannels && 'animate-spin')} />
                    تحديث
                  </Button>
                  <Button size="sm" onClick={handleAddChannel} disabled={scraping || !selectedChannelId}>
                    <Plus className="h-4 w-4 ml-1" /> إضافة
                  </Button>
                  <Button size="sm" variant="secondary" onClick={handleScrape} disabled={scraping}>
                    {scraping ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <RefreshCw className="h-4 w-4 ml-1" />}
                    سحب الكل
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">القنوات المتابعة ({channels.length})</p>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {channels.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4 text-sm">لا توجد قنوات متابعة</p>
                  ) : (
                    channels.map((c) => (
                      <div key={c.channel_id} className="flex items-center justify-between p-2 border rounded">
                        <div>
                          <p className="font-medium text-sm">{c.channel_name}</p>
                          <div className="flex gap-2 mt-1">
                            <Badge variant="outline" className="text-[10px]">{getMarketLabel(c.market)}</Badge>
                            <Badge variant="secondary" className="text-[10px]">{c.content_type}</Badge>
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRemoveChannel(c.channel_id)}>
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Content */}
          <TabsContent value="content" className="space-y-3 mt-4">
            <div className="flex items-center gap-2">
              <select
                className="w-full p-2 border rounded bg-background text-sm"
                value={selectedChannelForMessages}
                onChange={(e) => {
                  setSelectedChannelForMessages(e.target.value);
                  if (e.target.value) fetchMessages(e.target.value);
                }}
              >
                <option value="">-- اختر قناة --</option>
                {channels.map((c) => (
                  <option key={c.channel_id} value={c.channel_id}>
                    {c.channel_name} ({getMarketLabel(c.market)})
                  </option>
                ))}
              </select>
              {selectedChannelForMessages && (
                <Button variant="outline" size="sm" onClick={() => fetchMessages(selectedChannelForMessages)} disabled={loadingMessages}>
                  <RefreshCw className={cn('h-4 w-4', loadingMessages && 'animate-spin')} />
                </Button>
              )}
            </div>
            {loadingMessages ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <EmptyState icon={<FileText className="h-10 w-10" />} text={selectedChannelForMessages ? 'لا توجد رسائل' : 'اختر قناة لعرض المحتوى'} />
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {messages.map((msg) => (
                  <Card key={msg.message_id} className={cn('border-r-4', msg.is_reply ? 'border-r-fuchsia-500' : 'border-r-emerald-500')}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-[10px]">
                          {formatDateTime(msg.date)}
                        </Badge>
                        <div className="flex items-center gap-2">
                          {msg.is_reply && (
                            <Badge variant="secondary" className="text-[10px]">
                              <Reply className="h-3 w-3 ml-1" /> رد
                            </Badge>
                          )}
                          {msg.views != null && <span className="text-xs text-muted-foreground">👁 {msg.views}</span>}
                        </div>
                      </div>
                      {msg.is_reply && msg.reply_to_text && (
                        <div className="p-2 rounded bg-fuchsia-50 dark:bg-fuchsia-950/30 border-r-2 border-fuchsia-300 text-xs">
                          <p className="line-clamp-2 text-muted-foreground">{msg.reply_to_text}</p>
                        </div>
                      )}
                      <p className="text-sm whitespace-pre-wrap line-clamp-4">{msg.text}</p>
                      {cleanedTexts[msg.message_id] && (
                        <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs">
                          <div className="flex items-center gap-1 mb-1 text-emerald-700 dark:text-emerald-300">
                            <Sparkles className="h-3 w-3" /> <span className="font-medium">بعد التنظيف</span>
                          </div>
                          <p className="whitespace-pre-wrap">{cleanedTexts[msg.message_id]}</p>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleCleanMessage(msg.message_id, msg.text)} disabled={processingMsg === msg.message_id}>
                          {processingMsg === msg.message_id ? <Loader2 className="h-3.5 w-3.5 ml-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 ml-1" />}
                          تنظيف بالـ AI
                        </Button>
                        <Button variant="outline" size="sm" className="text-emerald-700 border-emerald-300 hover:bg-emerald-50" onClick={() => handleSaveMessage(msg.message_id, 'recommendation')} disabled={saving}>
                          <TrendingUp className="h-3.5 w-3.5 ml-1" /> حفظ كتوقعة
                        </Button>
                        <Button variant="outline" size="sm" className="text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => handleSaveMessage(msg.message_id, 'news')} disabled={saving}>
                          <Newspaper className="h-3.5 w-3.5 ml-1" /> حفظ كخبر
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Recommendations */}
          <TabsContent value="recommendations" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">التوقعات المستخرجة ({recommendations.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-right">
                        <th className="p-2">الرمز</th>
                        <th className="p-2">السوق</th>
                        <th className="p-2">الإجراء</th>
                        <th className="p-2">الدخول</th>
                        <th className="p-2">الهدف</th>
                        <th className="p-2">الوقف</th>
                        <th className="p-2">الثقة</th>
                        <th className="p-2">المصدر</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recommendations.length === 0 ? (
                        <tr><td colSpan={8} className="text-center py-4 text-muted-foreground">لا توجد توقعات</td></tr>
                      ) : (
                        recommendations.map((r) => (
                          <tr key={r.id} className="border-b">
                            <td className="p-2 font-bold">{r.symbol}</td>
                            <td className="p-2">{getMarketLabel(r.market)}</td>
                            <td className="p-2"><Badge className={cn('text-white', getActionBadge(r.action))}>{r.action}</Badge></td>
                            <td className="p-2">{r.entry_price || '-'}</td>
                            <td className="p-2 text-emerald-600">{r.target_price || '-'}</td>
                            <td className="p-2 text-red-500">{r.stop_loss || '-'}</td>
                            <td className="p-2">{(r.confidence * 100).toFixed(0)}%</td>
                            <td className="p-2 text-xs">{r.channel_name}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* News */}
          <TabsContent value="news" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">الأخبار المستخرجة ({news.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {news.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4 text-sm">لا توجد أخبار</p>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto">
                    {news.map((n) => (
                      <div key={n.id} className="p-3 border rounded">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm">{n.title}</p>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{n.channel_name}</span>
                        </div>
                        <div className="flex gap-2 mt-1">
                          <Badge variant="outline" className="text-[10px]">{getMarketLabel(n.market)}</Badge>
                          <Badge
                            variant={n.sentiment === 'positive' ? 'default' : n.sentiment === 'negative' ? 'destructive' : 'secondary'}
                            className="text-[10px]"
                          >
                            {n.sentiment}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
