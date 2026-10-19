'use client';

/**
 * MobileNav — Bottom navigation bar with EXACTLY 5 icons.
 * (Phase 5.2 — Mobile-First UX, Task 40-B refresh 2026-10-04)
 *
 *   1. الرئيسية      → dashboard         (LayoutDashboard)
 *   2. التوقعات      → recommendations   (TrendingUp)
 *   3. المحفظة       → portfolio         (Wallet)
 *   4. الرادار        → liquidity-radar   (Activity)  ← NEW (Task 40-B: owner directive "put liquidity radar in the bottom bar")
 *   5. الشارت        → trading-chart     (BarChart3)
 *
 *   settings was moved OUT of the bottom bar (still reachable from the
 *   MobileMoreSheet that hangs off the mobile Header — verified by grep
 *   `settings` in MobileMoreSheet.tsx returns 3 hits).
 *
 * Accessibility & layout:
 *   - min-h-[48px] / min-w-[48px] touch targets
 *   - aria-label + aria-current
 *   - RTL (dir="rtl")
 *   - safe-area-inset-bottom padding
 *   - backdrop blur
 *   - md:hidden (bottom bar only shows on screens < md)
 */

import React from 'react';
import {
  LayoutDashboard,
  TrendingUp,
  Wallet,
  Activity,
  CandlestickChart,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { AppView } from '@/types';

/* Bottom bar: EXACTLY 5 items (per user request: "5 أيقونات بس").
 * Task 40-B (2026-10-04): settings dropped from bottom bar; liquidity-radar
 * added in its place so the most-used screen for active traders (رادار
 * السيولة) is one tap away. settings remains accessible via MobileMoreSheet. */
const bottomNavItems: Array<{ id: AppView; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard',       label: 'الرئيسية', icon: LayoutDashboard },
  { id: 'stocks',           label: 'الأسهم',   icon: CandlestickChart },
  { id: 'recommendations', label: 'التوصيات', icon: TrendingUp },
  { id: 'portfolio',       label: 'المحفظة',  icon: Wallet },
  { id: 'liquidity-radar', label: 'الرادار',  icon: Activity },
];

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
                isActive ? 'text-profit dark:text-profit' : 'text-muted-foreground'
              )}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] sm:text-xs font-medium leading-tight">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
