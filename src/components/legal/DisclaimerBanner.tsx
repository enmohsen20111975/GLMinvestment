'use client';

import React, { useSyncExternalStore, useCallback } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'egx_disclaimer_dismissed';

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

function getSnapshot() {
  // During SSR, we return true to avoid hydration mismatch
  // The actual value will be checked client-side only
  if (typeof window === 'undefined') return true;
  return sessionStorage.getItem(STORAGE_KEY) !== 'true';
}

function getServerSnapshot() {
  return true;
}

export function DisclaimerBanner() {
  const visible = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const handleDismiss = useCallback(() => {
    sessionStorage.setItem(STORAGE_KEY, 'true');
    // Dispatch a storage event so useSyncExternalStore re-reads
    window.dispatchEvent(new Event('storage'));
  }, []);

  if (!visible) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 relative z-50">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 text-center">
          <p className="text-xs sm:text-sm text-amber-800 dark:text-amber-200 leading-relaxed" dir="rtl">
            ⚠️ هذه المنصة للأغراض التعليمية فقط. المحتوى لا يُعتبر نصيحة استثمارية أو توصية بشراء أو بيع الأوراق المالية.
          </p>
          <p className="text-[11px] sm:text-xs text-amber-600 dark:text-amber-300 mt-0.5">
            This platform is for educational purposes only. Content does not constitute investment advice.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50"
          onClick={handleDismiss}
          aria-label="إغلاق التنبيه"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
