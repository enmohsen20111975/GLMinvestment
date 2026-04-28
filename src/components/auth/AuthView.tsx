'use client';

import React, { useState, useEffect } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { signIn } from 'next-auth/react';
import { useSession } from 'next-auth/react';
import {
  LogIn,
  UserPlus,
  Mail,
  Lock,
  User,
  Shield,
  Eye,
  EyeOff,
  Loader2,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

// ==================== LOGIN SCHEMA ====================
const loginSchema = z.object({
  username_or_email: z
    .string()
    .min(1, 'يرجى إدخال اسم المستخدم أو البريد الإلكتروني'),
  password: z
    .string()
    .min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

// ==================== REGISTER SCHEMA ====================
const registerSchema = z.object({
  email: z
    .string()
    .min(1, 'يرجى إدخال البريد الإلكتروني')
    .email('يرجى إدخال بريد إلكتروني صحيح'),
  username: z
    .string()
    .min(3, 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل')
    .max(30, 'اسم المستخدم يجب أن لا يتجاوز 30 حرفاً'),
  password: z
    .string()
    .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
    .regex(/[A-Za-z]/, 'كلمة المرور يجب أن تحتوي على حروف إنجليزية')
    .regex(/[0-9]/, 'كلمة المرور يجب أن تحتوي على أرقام'),
  risk_tolerance: z.enum(['low', 'medium', 'high'], {
    message: 'يرجى اختيار مستوى تحمل المخاطر',
  }),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export function AuthView() {
  const { setUser, setApiKey, setCurrentView } = useAppStore();
  const { data: session, status: sessionStatus } = useSession();
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null);

  // Check if Google OAuth is configured on mount
  useEffect(() => {
    fetch('/api/auth/config')
      .then(res => res.json())
      .then(data => setGoogleConfigured(data?.google?.configured ?? false))
      .catch(() => setGoogleConfigured(false));
  }, []);

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (sessionStatus === 'authenticated' && session?.user) {
      const sessionUser = session.user as Record<string, unknown>;
      setUser({
        id: session.user.id || '',
        email: session.user.email || '',
        username: (sessionUser.username as string) || session.user.name || '',
        is_active: (sessionUser.is_active as boolean) ?? true,
        subscription_tier: (sessionUser.subscription_tier as string) || 'free',
        default_risk_tolerance: (sessionUser.default_risk_tolerance as string) || 'medium',
        created_at: new Date().toISOString(),
        last_login: new Date().toISOString(),
      });
      setCurrentView('dashboard');
    }
  }, [sessionStatus, session, setUser, setCurrentView]);

  // Login form
  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username_or_email: '',
      password: '',
    },
  });

  // Register form
  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      username: '',
      password: '',
      risk_tolerance: 'medium',
    },
  });

  const handleLogin = async (values: LoginFormValues) => {
    setIsSubmitting(true);
    setGoogleError(null);

    try {
      const result = await signIn('credentials', {
        username_or_email: values.username_or_email,
        password: values.password,
        redirect: false,
      });

      if (result?.error) {
        toast.error('اسم المستخدم أو كلمة المرور غير صحيحة');
      } else if (result?.ok) {
        toast.success('تم تسجيل الدخول بنجاح');
        // Session data will be picked up by the useEffect above
        setApiKey('session-key-' + Date.now());
        setCurrentView('dashboard');
      }
    } catch (error) {
      console.error('Login error:', error);
      toast.error('حدث خطأ أثناء تسجيل الدخول');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (values: RegisterFormValues) => {
    setIsSubmitting(true);
    setGoogleError(null);

    try {
      // Call register API
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        toast.error(data.error || 'حدث خطأ أثناء إنشاء الحساب');
        return;
      }

      // After successful registration, auto sign in
      const signInResult = await signIn('credentials', {
        username_or_email: values.email,
        password: values.password,
        redirect: false,
      });

      if (signInResult?.ok) {
        toast.success('تم إنشاء الحساب وتسجيل الدخول بنجاح');
        if (data.api_key) setApiKey(data.api_key);
        setCurrentView('dashboard');
      } else {
        toast.success('تم إنشاء الحساب بنجاح! يرجى تسجيل الدخول');
      }
    } catch (error) {
      console.error('Register error:', error);
      toast.error('حدث خطأ أثناء إنشاء الحساب');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsSubmitting(true);
    setGoogleError(null);

    try {
      const result = await signIn('google', {
        redirect: false,
      });

      if (result?.error) {
        if (result.error.includes('callback') || result.error.includes('OAUTH') || result.error.includes('redirect_uri')) {
          setGoogleError(
            'خطأ في عنوان إعادة التوجيه. تأكد من إضافة العناوين التالية في Google Cloud Console (APIs & Services → Credentials → Authorized redirect URIs):\n\n• http://localhost:8100/api/auth/callback/google\n• https://invist.m2y.net/api/auth/callback/google'
          );
        } else if (result.error.includes('configuration') || result.error.includes('CLIENT_SECRET')) {
          setGoogleError(
            'خطأ في تهيئة Google OAuth. تأكد من تحديث GOOGLE_CLIENT_SECRET في ملف .env بالقيمة الحقيقية من Google Cloud Console (وليس القيمة الافتراضية).'
          );
        } else if (result.error.includes('Access blocked') || result.error.includes('access_denied')) {
          setGoogleError(
            'تم رفض الوصول. تأكد من أن تطبيق Google OAuth منشور (بوضع "Testing" أو "Production") في Google Cloud Console.'
          );
        } else {
          setGoogleError(`حدث خطأ أثناء تسجيل الدخول بحساب Google: ${result.error}`);
        }
      } else if (result?.ok || result?.url) {
        toast.success('تم تسجيل الدخول بحساب Google بنجاح');
        setCurrentView('dashboard');
      }
    } catch (error) {
      console.error('Google login error:', error);
      setGoogleError(
        'حدث خطأ غير متوقع. تأكد من إعداد Google OAuth بشكل صحيح في ملف .env وإضافة عناوين إعادة التوجيه في Google Cloud Console.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <Header title="تسجيل الدخول" subtitle="مرحباً بك في منصة استثمار EGX" />
      <div className="p-4 md:p-6 flex items-start justify-center pb-24 lg:pb-6">
        <div className="w-full max-w-md">
          {/* Logo & Title */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
              <TrendingUp className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-foreground">منصة استثمار EGX</h2>
            <p className="text-sm text-muted-foreground mt-1">البورصة المصرية - استثمر بذكاء</p>
          </div>

          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="login" className="text-sm">
                <LogIn className="w-4 h-4 ml-1.5" />
                تسجيل الدخول
              </TabsTrigger>
              <TabsTrigger value="register" className="text-sm">
                <UserPlus className="w-4 h-4 ml-1.5" />
                حساب جديد
              </TabsTrigger>
            </TabsList>

            {/* Login Form */}
            <TabsContent value="login">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">تسجيل الدخول</CardTitle>
                  <CardDescription>أدخل بياناتك للوصول إلى حسابك</CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...loginForm}>
                    <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
                      <FormField
                        control={loginForm.control}
                        name="username_or_email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm">اسم المستخدم أو البريد الإلكتروني</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                  placeholder="أدخل اسم المستخدم أو البريد"
                                  className="pr-10"
                                  dir="rtl"
                                  {...field}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={loginForm.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm">كلمة المرور</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                  type={showLoginPassword ? 'text' : 'password'}
                                  placeholder="أدخل كلمة المرور"
                                  className="pr-10 pl-10"
                                  dir="rtl"
                                  {...field}
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowLoginPassword(!showLoginPassword)}
                                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  {showLoginPassword ? (
                                    <EyeOff className="w-4 h-4" />
                                  ) : (
                                    <Eye className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <Button
                        type="submit"
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-5 font-semibold"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                            جاري تسجيل الدخول...
                          </>
                        ) : (
                          <>
                            <LogIn className="w-4 h-4 ml-2" />
                            تسجيل الدخول
                          </>
                        )}
                      </Button>
                    </form>
                  </Form>

                  {/* Google Login */}
                  <div className="mt-4">
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">أو</span>
                      </div>
                    </div>

                    {/* Google Login - always show the button */}
                    {googleConfigured === null ? (
                      <div className="mt-4 flex justify-center">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          className="w-full mt-4 py-5 font-medium relative"
                          onClick={handleGoogleLogin}
                          disabled={isSubmitting || !googleConfigured}
                          title={!googleConfigured ? 'Google OAuth غير مهيأ - يرجى إعداد متغيرات البيئة على الخادم' : undefined}
                        >
                          {isSubmitting ? (
                            <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                          ) : (
                            <svg className="w-4 h-4 ml-2" viewBox="0 0 24 24">
                              <path
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                                fill="#4285F4"
                              />
                              <path
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                fill="#34A853"
                              />
                              <path
                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                fill="#FBBC05"
                              />
                              <path
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                fill="#EA4335"
                              />
                            </svg>
                          )}
                          الدخول بحساب Google
                        </Button>

                        {!googleConfigured && (
                          <p className="mt-2 text-xs text-center text-amber-600 dark:text-amber-400">
                            ⚠ Google OAuth غير مهيأ حالياً - يرجى التواصل مع المسؤول لإعداد تسجيل الدخول بحساب Google
                          </p>
                        )}

                        {googleError && (
                          <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed whitespace-pre-line">{googleError}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Register Form */}
            <TabsContent value="register">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">إنشاء حساب جديد</CardTitle>
                  <CardDescription>انضم إلى منصة استثمار EGX</CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...registerForm}>
                    <form onSubmit={registerForm.handleSubmit(handleRegister)} className="space-y-4">
                      <FormField
                        control={registerForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm">البريد الإلكتروني</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                  type="email"
                                  placeholder="example@email.com"
                                  className="pr-10"
                                  dir="ltr"
                                  {...field}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={registerForm.control}
                        name="username"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm">اسم المستخدم</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                  placeholder="أدخل اسم المستخدم"
                                  className="pr-10"
                                  dir="rtl"
                                  {...field}
                                />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={registerForm.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm">كلمة المرور</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                  type={showRegisterPassword ? 'text' : 'password'}
                                  placeholder="8 أحرف على الأقل، مع حروف وأرقام"
                                  className="pr-10 pl-10"
                                  dir="rtl"
                                  {...field}
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  {showRegisterPassword ? (
                                    <EyeOff className="w-4 h-4" />
                                  ) : (
                                    <Eye className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={registerForm.control}
                        name="risk_tolerance"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm flex items-center gap-1.5">
                              <Shield className="w-3.5 h-3.5" />
                              مستوى تحمل المخاطر
                            </FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="اختر المستوى" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="low">منخفض - محافظ</SelectItem>
                                <SelectItem value="medium">متوسط - متوازن</SelectItem>
                                <SelectItem value="high">مرتفع - جريء</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <Button
                        type="submit"
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-5 font-semibold"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                            جاري إنشاء الحساب...
                          </>
                        ) : (
                          <>
                            <UserPlus className="w-4 h-4 ml-2" />
                            إنشاء حساب
                          </>
                        )}
                      </Button>
                    </form>
                  </Form>

                  {/* Google Login */}
                  <div className="mt-4">
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">أو</span>
                      </div>
                    </div>

                    {/* Google Register - always show the button */}
                    {googleConfigured === null ? (
                      <div className="mt-4 flex justify-center">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          className="w-full mt-4 py-5 font-medium"
                          onClick={handleGoogleLogin}
                          disabled={isSubmitting || !googleConfigured}
                          title={!googleConfigured ? 'Google OAuth غير مهيأ - يرجى إعداد متغيرات البيئة على الخادم' : undefined}
                        >
                          {isSubmitting ? (
                            <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                          ) : (
                            <svg className="w-4 h-4 ml-2" viewBox="0 0 24 24">
                              <path
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                                fill="#4285F4"
                              />
                              <path
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                fill="#34A853"
                              />
                              <path
                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                fill="#FBBC05"
                              />
                              <path
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                fill="#EA4335"
                              />
                            </svg>
                          )}
                          التسجيل بحساب Google
                        </Button>

                        {!googleConfigured && (
                          <p className="mt-2 text-xs text-center text-amber-600 dark:text-amber-400">
                            ⚠ Google OAuth غير مهيأ حالياً - يرجى التواصل مع المسؤول لإعداد تسجيل الدخول بحساب Google
                          </p>
                        )}

                        {googleError && (
                          <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed whitespace-pre-line">{googleError}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
