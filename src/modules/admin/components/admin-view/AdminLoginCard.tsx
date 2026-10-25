/**
 * admin-view/AdminLoginCard.tsx
 * ============================
 * Login form shown when the current user is NOT an admin (no Google session
 * with admin tier + no direct admin_session cookie).
 *
 * Form fields: username + password. On submit calls `handleDirectLogin`
 * which posts to `/api/admin/auth`. On success the server sets an httpOnly
 * admin_session cookie and the parent re-renders to show the dashboard.
 *
 * Originally inlined inside AdminView (lines ~948-996).
 */

'use client';

import React from 'react';
import { Shield, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AdminLoginCardProps {
 directLoginUsername: string;
 setDirectLoginUsername: React.Dispatch<React.SetStateAction<string>>;
 directLoginPassword: string;
 setDirectLoginPassword: React.Dispatch<React.SetStateAction<string>>;
 directLoginError: string;
 directLoginLoading: boolean;
 onLogin: (e: React.FormEvent) => Promise<void>;
}

export function AdminLoginCard({
 directLoginUsername,
 setDirectLoginUsername,
 directLoginPassword,
 setDirectLoginPassword,
 directLoginError,
 directLoginLoading,
 onLogin,
}: AdminLoginCardProps) {
 return (
 <div className="min-h-screen flex items-center justify-center p-4" dir="rtl">
 <Card className="w-full max-w-md">
 <CardHeader className="text-center">
 <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-profit/10 flex items-center justify-center">
 <Shield className="w-8 h-8 text-profit" />
 </div>
 <CardTitle>دخول المدير</CardTitle>
 <CardDescription>أدخل بيانات الدخول للوصول للوحة التحكم</CardDescription>
 </CardHeader>
 <CardContent>
 <form onSubmit={onLogin} className="space-y-4">
 <div className="space-y-2">
 <label className="text-sm font-medium">اسم المستخدم</label>
 <Input
 type="text"
 value={directLoginUsername}
 onChange={(e) => setDirectLoginUsername(e.target.value)}
 placeholder="أدخل اسم المستخدم"
 required
 />
 </div>
 <div className="space-y-2">
 <label className="text-sm font-medium">كلمة المرور</label>
 <Input
 type="password"
 value={directLoginPassword}
 onChange={(e) => setDirectLoginPassword(e.target.value)}
 placeholder="أدخل كلمة المرور"
 required
 />
 </div>
 {directLoginError && (
 <p className="text-sm text-loss text-center">{directLoginError}</p>
 )}
 <Button type="submit" className="w-full" disabled={directLoginLoading}>
 {directLoginLoading ? (
 <><Loader2 className="w-4 h-4 ml-2 animate-spin" /> جاري الدخول...</>
 ) : (
 <><Shield className="w-4 h-4 ml-2" /> دخول</>
 )}
 </Button>
 </form>
 </CardContent>
 </Card>
 </div>
 );
}
