'use client';

/**
 * DevLoginForm — تسجيل دخول الأدمن على السيرفر التجريبي
 * ====================================================================
 *
 * بيظهر لما:
 *   - المستخدم مش مسجل (authStatus === 'unauthenticated')
 *   - في ?dev=1 في الـ URL
 *   - ALLOW_FORM_LOGIN=true في الـ env (عشان ما يشتغلش على الإنتاج)
 *
 * الـ flow:
 *   1. المستخدم يفتح http://localhost:3000/?dev=1
 *   2. النظام يعرض DevLoginForm بدل AuthView
 *   3. المستخدم يدخل ADMIN_USERNAME + ADMIN_PASSWORD (من env vars)
 *   4. POST /api/admin/auth → verify + set admin_session cookie
 *   5. redirect لـ /admin
 */

import React, { useState } from 'react';
import { Shield, Loader2, AlertTriangle, Lock, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface DevLoginFormProps {
  onSuccess?: () => void;
}

export function DevLoginForm({ onSuccess }: DevLoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('اسم المستخدم وكلمة المرور مطلوبان');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) {
        throw new Error(j.error || 'فشل تسجيل الدخول');
      }
      toast.success('تم تسجيل الدخول كأدمن');
      if (onSuccess) {
        onSuccess();
      } else {
        window.location.href = '/admin';
      }
    } catch (err: any) {
      setError(err?.message || 'فشل تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4" dir="rtl">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-full bg-gradient-to-br from-warning to-loss flex items-center justify-center">
            <Shield className="w-7 h-7 text-foreground" />
          </div>
          <div>
            <CardTitle className="text-xl">تسجيل دخول الأدمن</CardTitle>
            <CardDescription className="mt-1">
              السيرفر التجريبي — للتجارب والاختبارات فقط
            </CardDescription>
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-warning/10 text-warning dark:text-warning text-[11px] font-medium">
            <Lock className="w-3 h-3" />
            Dev Mode
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-sm font-medium">اسم المستخدم</Label>
              <div className="relative">
                <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin username"
                  className="pr-9"
                  autoFocus
                  disabled={loading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">كلمة المرور</Label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="admin password"
                  className="pr-9"
                  disabled={loading}
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-loss dark:bg-loss/30 border border-loss dark:border-loss">
                <AlertTriangle className="w-4 h-4 text-loss shrink-0" />
                <p className="text-xs text-loss dark:text-loss">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading || !username.trim() || !password.trim()}
              className="w-full gap-2 bg-gradient-to-r from-warning to-loss hover:from-warning hover:to-loss text-foreground"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              {loading ? 'جارٍ الدخول...' : 'دخول كأدمن'}
            </Button>
          </form>

          <div className="mt-4 pt-4 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground"
              onClick={() => { window.location.href = '/'; }}
            >
              العودة للتسجيل بـ Google
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
