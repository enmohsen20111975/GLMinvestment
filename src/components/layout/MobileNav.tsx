'use client';

/**
 * MobileNav — Bottom navigation bar with EXACTLY 5 icons.
 * (Phase 5.2 — Mobile-First UX)
 *
 *   1. الرئيسية      → dashboard    (LayoutDashboard)
 *   2. التوقعات      → recommendations (TrendingUp)
 *   3. المحفظة       → portfolio    (Wallet)
 *   4. الشارت        → screener     (BarChart3)
 *   5. الإعدادات     → settings     (Settings)
 *
 * The previous "More" 6th button is gone. The crypto / learning / simulation
 * / about / watchlist / search / notifications / account items now live in
 * `MobileMoreSheet`, triggered from the mobile Header (`MobileMoreButton`).
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
  Settings,
  BarChart3,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { AppView } from '@/types';

/* Bottom bar: EXACTLY 5 items (per user request: "5 أيقونات بس") */
const bottomNavItems: Array<{ id: AppView; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard',       label: 'الرئيسية', icon: LayoutDashboard },
  { id: 'recommendations', label: 'التوقعات', icon: TrendingUp },
  { id: 'portfolio',       label: 'المحفظة',  icon: Wallet },
  { id: 'trading-chart',   label: 'الشارت',   icon: BarChart3 },
  { id: 'settings',        label: 'الإعدادات', icon: Settings },
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
                isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
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
