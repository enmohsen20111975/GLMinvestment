'use client';

import React from 'react';
import { AlertTriangle, Construction } from 'lucide-react';
import { useAppStore, MarketType } from '@/lib/store';
import { Alert, AlertDescription } from '@/components/ui/alert';

// Markets that are under development (incomplete data)
const DEVELOPMENT_MARKETS: MarketType[] = ['TADAWUL', 'KSE', 'DFM', 'BSE', 'QSE', 'US']; // PHASE3-MARKET-SEGREGATION: US added (no stocks/predictions yet)

export function DevelopmentNotice() {
  const { currentMarket } = useAppStore();

  if (!DEVELOPMENT_MARKETS.includes(currentMarket)) {
    return null;
  }

  return (
    <Alert 
      className="mb-3 border-amber-200 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800"
      dir="rtl"
    >
      <Construction className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <AlertDescription className="text-amber-800 dark:text-amber-200 text-sm">
        <span className="font-semibold">تحت التطوير:</span>
        {' '}بيانات هذا السوق قد تكون غير مكتملة. نعمل على تحديث البيانات من مصادر متعددة.
        <span className="block mt-1 text-xs text-amber-600 dark:text-amber-400">
          الأسعار والبيانات التاريخية قد لا تكون متاحة لجميع الأسهم حالياً.
        </span>
      </AlertDescription>
    </Alert>
  );
}
