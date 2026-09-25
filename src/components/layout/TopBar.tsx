'use client';
import { ExchangeSelector } from './ExchangeSelector';

/**
 * TopBar — القائمة العلوية المرتبة
 * =================================
 * بديل الـ Sidebar القديم. قائمة علوية بـ 5 أقسام رئيسية:
 *
 *   1. الرئيسية     → dashboard
 *   2. السوق        → stocks / stock-filters / trading-chart / screener / smart-confluence
 *   3. التوقعات     → recommendations / picks-management / specialist-analysis / reports
 *   4. أموالي       → portfolio / watchlist / wealth / alerts-center / live-monitor / trading-memory
 *   5. المزيد       → news / learning / simulation / academy / crypto / zakat / settings
 *
 * Features:
 *   - RTL + responsive (يدعم الموبايل)
 *   - Dropdown menus لكل قسم
 *   - Active state highlighting
 *   - Currency selector + theme toggle + notifications
 *   - Safe-area-inset support
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard, CandlestickChart, Filter, TrendingUp, Target,
  Crown, Sparkles, FileBarChart, Newspaper, GraduationCap, Gamepad2,
  Wallet, Eye, HandCoins, Shield, RadioTower, Brain,
  Activity, BarChart3, Settings, Menu, X, ChevronDown,
  Bell, Sun, Moon, DollarSign, Search, type LucideIcon,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { AppView } from '@/types';
import { NotificationCenter } from '@/components/notifications/NotificationCenter';
import { RoboNotifierToggle } from '@/components/notifications/RoboNotifierToggle';

interface NavItem {
  id: AppView;
  label: string;
  icon: LucideIcon;
  highlight?: boolean;
}

interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

// ── الأقسام الخمسة الرئيسية ─────────────────────────────────────────────
const navSections: NavSection[] = [
  {
    id: 'home',
    label: 'الرئيسية',
    icon: LayoutDashboard,
    items: [
      { id: 'dashboard', label: 'نظرة عامة', icon: LayoutDashboard },
    ],
  },
  {
    id: 'market',
    label: 'السوق',
    icon: CandlestickChart,
    items: [
      { id: 'stocks', label: 'الأسهم', icon: CandlestickChart },
      { id: 'stock-filters', label: 'فلاتر الأسهم', icon: Filter },
      { id: 'trading-chart', label: 'الشارت التفاعلي', icon: TrendingUp },
      { id: 'smart-confluence', label: 'تحليلات السوق', icon: Sparkles },
      { id: 'screener', label: 'الفلاتر المتقدمة', icon: Filter },
    ],
  },
  {
    id: 'predictions',
    label: 'التوقعات',
    icon: Target,
    items: [
      { id: 'recommendations', label: 'متابعة التوقعات', icon: Target },
      { id: 'picks-management', label: 'إدارة التوقعات', icon: Crown },
      { id: 'specialist-analysis', label: 'تحليل المتخصصين', icon: Sparkles },
      { id: 'reports', label: 'التقارير', icon: FileBarChart },
    ],
  },
  {
    id: 'finance',
    label: 'أموالي',
    icon: Wallet,
    items: [
      { id: 'portfolio', label: 'المحفظة الموحدة', icon: Wallet },
      { id: 'watchlist', label: 'قوائم المراقبة', icon: Eye },
      { id: 'wealth', label: 'الأموال', icon: HandCoins },
      { id: 'alerts-center', label: 'مركز التنبيهات', icon: Shield },
      { id: 'live-monitor', label: 'المراقبة الحية', icon: RadioTower },
      { id: 'trading-memory', label: 'ذاكرة التداول', icon: Brain },
    ],
  },
  {
    id: 'more',
    label: 'المزيد',
    icon: Menu,
    items: [
      { id: 'news', label: 'الأخبار والتحليلات', icon: Newspaper },
      { id: 'learning', label: 'مركز التعلم', icon: GraduationCap },
      { id: 'simulation', label: 'المحاكاة', icon: Gamepad2 },
      { id: 'academy', label: 'أكاديمية M2y', icon: GraduationCap },
      { id: 'crypto', label: 'الكريبتو', icon: Activity },
      { id: 'crypto-live', label: 'الجدول الحي للكريبتو', icon: Activity },
      { id: 'crypto-recommendations', label: 'تحليلات الكريبتو', icon: Target },
      { id: 'crypto-trading-chart', label: 'شارت الكريبتو', icon: BarChart3 },
      { id: 'crypto-screener', label: 'فلاتر الكريبتو', icon: Filter },
      { id: 'crypto-analysis', label: 'التحليل المتقدم للكريبتو', icon: Brain },
      { id: 'crypto-learning', label: 'تعلم الكريبتو', icon: GraduationCap },
      { id: 'crypto-simulation', label: 'محاكاة الكريبتو', icon: Gamepad2 },
      { id: 'zakat', label: 'حاسبة الزكاة', icon: HandCoins },
      { id: 'tithes', label: 'حاسبة العُشر', icon: HandCoins },
      { id: 'subscription', label: 'الباقات والاشتراكات', icon: Crown, highlight: true },
      { id: 'about', label: 'من نحن', icon: Sparkles },
      { id: 'settings', label: 'الإعدادات', icon: Settings },
    ],
  },
];

export function TopBar() {
  const { currentView, setCurrentView } = useAppStore();
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // إغلاق الـ dropdown لما تضغط خارجها
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setActiveSection(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // تحديد القسم النشط بناءً على currentView
  const getActiveSection = (): string => {
    for (const section of navSections) {
      if (section.items.some(item => item.id === currentView)) {
        return section.id;
      }
    }
    return 'home';
  };

  const activeSec = getActiveSection();

  const handleNavClick = (view: AppView) => {
    setCurrentView(view);
    setActiveSection(null);
    setMobileMenuOpen(false);
    if (typeof window !== 'undefined') {
      window.location.hash = view;
    }
  };

  return (
    <>
      <header
        className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        dir="rtl"
      >
        <div className="flex h-14 items-center justify-between px-3 md:px-6">
          {/* Logo + Brand */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleNavClick('dashboard')}
              className="flex items-center gap-2 font-bold text-sm md:text-base hover:opacity-80 transition-opacity"
              aria-label="الرئيسية"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold">
                M2Y
              </div>
              <span className="hidden sm:inline">دليل الاستثمار</span>
            </button>
            <ExchangeSelector />
            </button>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1" ref={dropdownRef}>
            {navSections.map((section) => (
              <div key={section.id} className="relative">
                <button
                  onClick={() =>
                    setActiveSection(activeSection === section.id ? null : section.id)
                  }
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 text-xs md:text-sm font-medium rounded-md transition-colors',
                    activeSec === section.id
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                  aria-expanded={activeSection === section.id}
                  aria-haspopup="true"
                >
                  <section.icon className="h-4 w-4" />
                  <span>{section.label}</span>
                  <ChevronDown
                    className={cn(
                      'h-3 w-3 transition-transform',
                      activeSection === section.id && 'rotate-180'
                    )}
                  />
                </button>

                {/* Dropdown */}
                {activeSection === section.id && (
                  <div className="absolute top-full right-0 mt-1 w-56 rounded-md border border-border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95">
                    {section.items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleNavClick(item.id)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors',
                          currentView === item.id
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                          item.highlight && 'text-amber-600 dark:text-amber-400 font-medium'
                        )}
                      >
                        <item.icon className="h-3.5 w-3.5" />
                        <span className="flex-1 text-right">{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>

          {/* Right Side: Search + Notifications + Theme + Currency */}
          <div className="flex items-center gap-1 md:gap-2">
            {/* Mobile menu trigger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
              aria-label="القائمة"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>

            {/* Notifications */}
            <NotificationCenter />

            {/* Robo toggle */}
            <div className="hidden sm:block">
              <RoboNotifierToggle />
            </div>
          </div>
        </div>

        {/* Mobile Menu (collapsible) */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-background">
            <nav className="grid gap-1 p-3" dir="rtl">
              {navSections.map((section) => (
                <div key={section.id} className="space-y-1">
                  <div className="flex items-center gap-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    <section.icon className="h-3 w-3" />
                    {section.label}
                  </div>
                  {section.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleNavClick(item.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors',
                        currentView === item.id
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-muted-foreground hover:bg-accent'
                      )}
                    >
                      <item.icon className="h-3.5 w-3.5" />
                      <span className="flex-1 text-right">{item.label}</span>
                    </button>
                  ))}
                </div>
              ))}
            </nav>
          </div>
        )}
      </header>
    </>
  );
}
