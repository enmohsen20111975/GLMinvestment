'use client';

import React from 'react';
import { AlertTriangle, Construction } from 'lucide-react';
import { useAppStore, MarketType } from '@/lib/store';
import { Alert, AlertDescription } from '@/components/ui/alert';

// Markets that are under development (incomplete data).
// This list MUST reflect what's actually in stocks.db — DO NOT keep stale
// entries here, otherwise we lie to the user ("تحت التطوير") when real data
// is already available.
//
// As of 2026-10-28 (verified via `SELECT market, COUNT(*) FROM stocks GROUP BY market`):
//   EGX      → 460 stocks (132 active)    ✅ production-ready
//   TADAWUL  → 395 stocks (395 active)    ✅ production-ready
//   KSE      → 180 stocks (179 active)    ✅ production-ready
//   QSE      →  67 stocks ( 67 active)    ✅ production-ready
//   US       →  63 stocks ( 63 active)    ✅ production-ready
//   CRYPTO   → handled via /api/crypto (separate from stocks.db)
//   DFM      → 0 stocks in DB             ❌ genuinely not yet supported
//   BSE      → 0 stocks in DB             ❌ genuinely not yet supported
//
// So only DFM and BSE remain "under development" — those markets have zero
// stocks in the database. Every other market has real data and must NOT
// show this banner.
const DEVELOPMENT_MARKETS: MarketType[] = ['DFM', 'BSE'];

export function DevelopmentNotice() {
 const { currentMarket } = useAppStore();

 if (!DEVELOPMENT_MARKETS.includes(currentMarket)) {
 return null;
 }

 return (
 <Alert 
 className="mb-3 border-warning bg-warning/10 "
 dir="rtl"
 >
 <Construction className="h-4 w-4 text-warning " />
 <AlertDescription className="text-warning text-sm">
 <span className="font-semibold">تحت التطوير:</span>
 {' '}بيانات هذا السوق قد تكون غير مكتملة. نعمل على تحديث البيانات من مصادر متعددة.
 <span className="block mt-1 text-xs text-warning ">
 الأسعار والبيانات التاريخية قد لا تكون متاحة لجميع الأسهم حالياً.
 </span>
 </AlertDescription>
 </Alert>
 );
}
