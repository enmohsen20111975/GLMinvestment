'use client';

/**
 * MobileNav — Bottom navigation bar with EXACTLY 5 icons.
 * (SCREENS-REORG-VISION — رؤية سارة: الأكثر استخداماً يومياً)
 *
 * 1. الرئيسية  → dashboard
 * 2. الأسهم    → stocks
 * 3. التوصيات  → recommendations
 * 4. المحفظة   → portfolio
 * 5. السيولة   → market-depth (استبدل liquidity-radar — الأخير أعمق:
 *                 يشمل المؤسسات + الأجانب/عرب/مصريين — ده اللي العميل
 *                 محتاجه يومياً للـ EGX. الـ widget كمان رجع للـ Dashboard.)
 *
 * التعلّم (academy + simulation) بقى في TopBar (بوابة جديدة) +
 * MobileMoreSheet — reachable من زر «أقسام أخرى» في الـ Header.
 * settings لسه في MobileMoreSheet.
 *
 * Accessibility & layout:
 * - min-h-[48px] / min-w-[48px] touch targets
 * - aria-label + aria-current
 * - RTL (dir="rtl")
 * - safe-area-inset-bottom padding
 * - backdrop blur
 * - md:hidden (bottom bar only shows on screens < md)
 */

import React from 'react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
// SCREENS-REORG: bottomNavItems مصدر واحد من nav-config.
// (5 أزرار: الرئيسية/الأسهم/التوصيات/المحفظة/السيولة)
import { bottomNavItems } from '@/lib/nav-config';

export function MobileNav() {
 const { currentView, setCurrentView } = useAppStore();

 return (
 <div
 className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-card/95 backdrop-blur-sm border-t border-border"
 style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
 >
 <div
 className="flex items-stretch justify-around"
 role="navigation"
 aria-label="التنقل السريع"
 dir="rtl"
 >
 {bottomNavItems.map((item) => {
 const Icon = item.icon;
 const isActive = currentView === item.id;
 return (
 <button
 key={item.id}
 onClick={() => setCurrentView(item.id)}
 className={cn(
 'flex flex-col items-center justify-center gap-0.5 px-2 sm:px-3 py-2 rounded-lg transition-colors min-w-[48px] min-h-[48px] flex-1',
 isActive ? 'text-profit ' : 'text-muted-foreground'
 )}
 aria-label={item.label}
 aria-current={isActive ? 'page' : undefined}
 >
 <Icon className="w-5 h-5" />
 <span className="text-xs sm:text-xs font-medium leading-tight">{item.label}</span>
 </button>
 );
 })}
 </div>
 </div>
 );
}
