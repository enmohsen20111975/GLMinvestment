/**
 * nav-config.ts — المصدر الوحيد للقوائم الثلاث (TopBar / MobileNav / MobileMoreSheet)
 * =====================================================================
 * ALPHA Navigation Cleanup (2026-10-20):
 * - حذف الشاشات الوهمية (market-depth, smart-confluence, tithes منفصلة)
 * - دمج الحسابات الشرعية والزكاة في خيار واحد
 * - استبدال market-depth في الموبايل بـ liquidity-radar
 *
 * TopBar → 6 بوابات:
 * 1. 📊 نبض السوق — dashboard + liquidity-radar + market-status
 * 2. 🎯 الفرص والتربص — recommendations + incubator + prediction-tracking
 * 3. 🔬 مجهر الأسهم — stocks + trading-chart
 * 4. 💼 المحفظة — portfolio + watchlist + trading-journal + alerts + rescue
 * 5. 🎓 التعلّم — academy + simulation
 * 6. ⚙️ المزيد — news + sharia(زكاة+شرعية) + subscription + settings
 */

import {
  LayoutDashboard,
  CandlestickChart,
  Activity,
  Target,
  Wallet,
  Eye,
  Bell,
  LifeBuoy,
  GraduationCap,
  Gamepad2,
  Menu,
  Newspaper,
  Crown,
  Settings,
  Info,
  ShieldCheck,
  BarChart3,
  TrendingUp,
  Landmark,
  Microscope,
  Zap,
  Egg,
  BookOpen,
  Waves,
  FileBarChart,
  type LucideIcon,
} from 'lucide-react';
import type { AppView } from '@/types';

export interface NavItem {
  id: AppView;
  label: string;
  icon: LucideIcon;
  highlight?: boolean;
}

export interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

/* ════════════════════════════════════════════════════════════════════════
 * TopBar — 6 بوابات استثمارية رئيسية
 * ════════════════════════════════════════════════════════════════════════ */
export const navSections: NavSection[] = [
  // ─── (1) 📊 نبض السوق (Market Pulse) ───
  {
    id: 'market-pulse',
    label: 'نبض السوق',
    icon: Activity,
    items: [
      { id: 'dashboard', label: 'نظرة عامة', icon: LayoutDashboard },
      { id: 'liquidity-radar', label: 'رادار السيولة والقطاعات', icon: Waves },
      { id: 'market-status', label: 'حالة وضغط الجلسة', icon: Zap },
      { id: 'reports', label: 'التقارير اليومية والأسبوعية', icon: FileBarChart, highlight: true },
    ],
  },
  // ─── (2) 🎯 الفرص والتربص (Opportunities) ───
  {
    id: 'picks-stalking',
    label: 'الفرص والتربص',
    icon: Target,
    items: [
      { id: 'recommendations', label: 'التوقعات الذكية', icon: Target },
      { id: 'incubator', label: 'حاضنة الأسهم', icon: Egg },
      { id: 'prediction-tracking', label: 'سجل وتتبع التوقعات', icon: TrendingUp },
    ],
  },
  // ─── (3) 🔬 مجهر الأسهم (Stock Microscopic) ───
  {
    id: 'stock-dna',
    label: 'مجهر الأسهم',
    icon: Microscope,
    items: [
      { id: 'stocks', label: 'قائمة الأسهم والفلترة', icon: CandlestickChart },
      { id: 'trading-chart', label: 'شارت التداول الفني', icon: BarChart3 },
    ],
  },
  // ─── (4) 💼 محفظتي وحساباتي (Portfolio & Trades) ───
  {
    id: 'portfolio',
    label: 'محفظتي وحساباتي',
    icon: Wallet,
    items: [
      { id: 'portfolio', label: 'المحفظة الحية', icon: Wallet },
      { id: 'watchlist', label: 'قائمة المتابعة', icon: Eye },
      { id: 'trading-journal', label: 'سجل الصفقات', icon: BookOpen },
      { id: 'alerts-center', label: 'التنبيهات والأهداف', icon: Bell },
      { id: 'bagholder-rescue', label: 'خطة إنقاذ المحفظة', icon: LifeBuoy },
    ],
  },
  // ─── (5) 🎓 التعلّم والمحاكاة (Learn & Simulate) ───
  {
    id: 'education',
    label: 'التعلّم والمحاكاة',
    icon: GraduationCap,
    items: [
      { id: 'academy', label: 'أكاديمية التداول', icon: GraduationCap },
      { id: 'simulation', label: 'محاكي التداول التجريبي', icon: Gamepad2 },
    ],
  },
  // ─── (6) ⚙️ المزيد والإعدادات (More & Settings) ───
  {
    id: 'more',
    label: 'المزيد والإعدادات',
    icon: Menu,
    items: [
      { id: 'news', label: 'الأخبار والإفصاحات', icon: Newspaper },
      { id: 'sharia', label: 'الحسابات الشرعية والزكاة', icon: ShieldCheck },
      { id: 'subscription', label: 'إدارة الاشتراك', icon: Crown, highlight: true },
      { id: 'settings', label: 'إعدادات الحساب', icon: Settings },
    ],
  },
];

/* ════════════════════════════════════════════════════════════════════════
 * MobileNav — 5 أزرار سفلية
 * استبدلنا market-depth بـ liquidity-radar (شاشة حقيقية مش وهمية)
 * ════════════════════════════════════════════════════════════════════════ */
export const bottomNavItems: NavItem[] = [
  { id: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard },
  { id: 'stocks', label: 'الأسهم', icon: CandlestickChart },
  { id: 'recommendations', label: 'التحليلات', icon: TrendingUp },
  { id: 'portfolio', label: 'المحفظة', icon: Wallet },
  { id: 'liquidity-radar', label: 'رادار السيولة', icon: Waves },
];

/* ════════════════════════════════════════════════════════════════════════
 * MobileMoreSheet — أقسام أخرى
 * دمجنا zakat + tithes في خيار واحد (الحسابات الشرعية)
 * ════════════════════════════════════════════════════════════════════════ */
export const moreNavItems: NavItem[] = [
  { id: 'bagholder-rescue', label: '🆘 إنقاذ سهم خاسر', icon: LifeBuoy },
  { id: 'watchlist', label: 'قوائم المراقبة', icon: Eye },
  { id: 'simulation', label: 'المحاكاة', icon: Gamepad2 },
  { id: 'academy', label: 'الأكاديمية', icon: GraduationCap },
  { id: 'news', label: 'الأخبار', icon: Newspaper },
  { id: 'subscription', label: 'الاشتراك', icon: Crown, highlight: true },
  { id: 'sharia', label: 'الحسابات الشرعية والزكاة', icon: ShieldCheck },
  { id: 'settings', label: 'الإعدادات', icon: Settings },
  { id: 'about', label: 'من نحن', icon: Info },
];
