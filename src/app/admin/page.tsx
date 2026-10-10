'use client';

export const dynamic = "force-dynamic";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/**
 * Admin Page Redirect
 * 
 * This page redirects to the main app's admin view (#admin)
 * The admin functionality is now integrated into the main application
 * for a unified experience with all features:
 * 
 * - Crypto (العملات الرقمية): #crypto
 * - Simulation (المحاكاة): #simulation
 * - Recommendations (تحليلات الخبراء): #recommendations
 * - Admin Dashboard (لوحة الإدارة): #admin
 */
export default function AdminRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to main app's admin view
    window.location.href = '/#admin';
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background" dir="rtl">
      <div className="text-center space-y-4">
        <Loader2 className="w-10 h-10 animate-spin text-emerald-600 mx-auto" />
        <p className="text-muted-foreground">جارٍ التحويل إلى لوحة الإدارة...</p>
      </div>
    </div>
  );
}
