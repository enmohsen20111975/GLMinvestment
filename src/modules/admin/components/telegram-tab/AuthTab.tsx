/**
 * telegram-tab/AuthTab.tsx
 * ========================
 * Telegram authentication flow (phone → code → 2FA password).
 * Also renders the "connected" state with user info + logout button.
 */

'use client';

import React, { useState } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  ArrowRight, CheckCircle, Key, Loader2, Lock, LogOut, Phone, RefreshCw, XCircle,
} from 'lucide-react';

import type { AuthStatus } from './types';
import { colorForId, initialsOf } from './helpers';

interface AuthTabProps {
  authStatus: AuthStatus | null;
  authLoading: boolean;
  onRefresh: () => void;
  onLogout: () => void;
  onAuthenticated: (status: AuthStatus) => void;
}

export function AuthTab({
  authStatus, authLoading, onRefresh, onLogout, onAuthenticated,
}: AuthTabProps) {
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
            <CheckCircle className="h-5 w-5 text-profit" />
            متصل بـ Telegram
          </CardTitle>
          <CardDescription>تم تأكيد المصادقة على حسابك الشخصي</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-16 w-16">
              <AvatarFallback className={cn('text-foreground text-lg', colorForId(u?.id ?? name))}>
                {initialsOf(name)}
              </AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-lg font-semibold">{name}</p>
                <Badge className="bg-profit hover:bg-profit text-white">متصل</Badge>
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
          <XCircle className="h-5 w-5 text-loss" />
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
