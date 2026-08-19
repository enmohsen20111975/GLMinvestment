'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Shield, Lock } from 'lucide-react';
import { MaestroPage } from '@/components/admin/MaestroPage';
import { Footer } from '@/components/layout/Footer';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { isClientAdmin } from '@/lib/admin-identities'; // P0.1 (SEC-01)

// P0.1 (SEC-01): admin emails/usernames sourced from env vars via
// @/lib/admin-identities (NEXT_PUBLIC_ADMIN_EMAILS / _USERNAMES).

export default function MaestroRoute() {
  const router = useRouter();
  const { user } = useAppStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    // Check if user is admin
    const checkAdmin = () => {
      const email = user?.email?.toLowerCase().trim();
      const username = user?.username?.toLowerCase().trim();

      const isAdmin = isClientAdmin(email, username);

      setIsAuthorized(!!user && isAdmin);
      setIsLoading(false);
    };

    // Small delay to let auth state settle
    const timer = setTimeout(checkAdmin, 500);
    return () => clearTimeout(timer);
  }, [user]);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" dir="rtl">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-emerald-600 mx-auto" />
          <p className="text-muted-foreground">جارٍ التحقق من الصلاحيات...</p>
        </div>
      </div>
    );
  }

  // Unauthorized state
  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" dir="rtl">
        <div className="text-center space-y-6 max-w-md mx-auto p-8">
          <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center mx-auto">
            <Lock className="w-10 h-10 text-red-600 dark:text-red-400" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">وصول مقيد</h1>
            <p className="text-muted-foreground">
              هذه الصفحة متاحة للمسؤولين فقط
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Shield className="w-4 h-4" />
            <span>نظام المايسترو - للمسؤولين</span>
          </div>
          <Button
            onClick={() => router.push('/')}
            className="mt-4"
          >
            العودة للرئيسية
          </Button>
        </div>
      </div>
    );
  }

  // Authorized - render Maestro page
  return (
    <div className="min-h-screen flex flex-col bg-background" dir="rtl">
      {/* Admin Badge */}
      <div className="bg-emerald-600 text-white text-center text-xs py-1">
        🔐 وضع المسؤول - Admin Mode
      </div>

      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                نظام المايسترو
                <span className="text-muted-foreground text-base font-normal">Maestro System</span>
                <span className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 rounded">
                  ADMIN
                </span>
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                نظام تحليل متكامل لجميع الأسواق - EGX, KSA, KSE, QSE, DFM, CRYPTO
              </p>
            </div>
            <a
              href="/#admin"
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              لوحة الإدارة
            </a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6">
        <MaestroPage />
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
