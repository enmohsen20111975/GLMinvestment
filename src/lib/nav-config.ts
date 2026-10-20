/**
 * nav-config.ts — المصدر الوحيد للقوائم الثلاث (TopBar / MobileNav / MobileMoreSheet)
 * =====================================================================
 * ALPHA-FIX Task 4 (2026-10-20): إعادة هيكلة لـ 4 بوابات استثمارية واضحة:
 *
 * TopBar → 6 بوابات (4 رئيسية + 2 مساعدة):
 * 1. 📊 نبض السوق (Market Pulse) — dashboard + liquidity-radar + sectors + market-status + historical-trades
 * 2. 🎯 الفرص والتربص (Picks & Stalking) — recommendations + market-depth + picks-management + specialist-analysis
 * 3. 🔬 مجهر الأسهم (Stock DNA) — stocks + stock-filters + screener + trading-chart + smart-confluence
 * 4. 💼 الصفقات والمحفظة (Portfolio) — portfolio + watchlist + alerts-center + bagholder-rescue
 * 5. 🎓 التعلّم (Education) — academy + simulation
 * 6. ⋯ المزيد (More) — news + subscription + settings + sharia + zakat + tithes + about
 *
 * MobileNav → 5 أزرار (بدون تغيير):
 * dashboard / stocks / recommendations / portfolio / market-depth
 *
 * MobileMoreSheet → أقسام أخرى (بدون تغيير)
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
 * TopBar — 6 بوابات استثمارية رئيسية (هيكلة نظيفة ومباشرة)
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
      { id: 'market-depth', label: 'عمق السوق والعملات', icon: Landmark },
      { id: 'market-status', label: 'حالة وضغط الجلسة', icon: Zap },
    ],
  },
  // ─── (2) 🎯 الفرص والتربص (Opportunities) ───
  {
    id: 'picks-stalking',
    label: 'الفرص والتربص',
    icon: Target,
    items: [
      { id: 'recommendations', label: 'التوصيات الذكية', icon: Target },
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
      { id: 'smart-confluence', label: 'التوافق الذكي', icon: Microscope },
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
      { id: 'sharia', label: 'الفلتر الشرعي', icon: ShieldCheck },
      { id: 'zakat', label: 'حاسبة الزكاة', icon: Landmark },
      { id: 'subscription', label: 'إدارة الاشتراك', icon: Crown, highlight: true },
      { id: 'settings', label: 'إعدادات الحساب', icon: Settings },
    ],
  },
];

/* ════════════════════════════════════════════════════════════════════════
 * MobileNav — 5 أزرار سفلية (بدون تغيير)
 * ════════════════════════════════════════════════════════════════════════ */
export const bottomNavItems: NavItem[] = [
  { id: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard },
  { id: 'stocks', label: 'الأسهم', icon: CandlestickChart },
  { id: 'recommendations', label: 'التحليلات', icon: TrendingUp },
  { id: 'portfolio', label: 'المحفظة', icon: Wallet },
  { id: 'market-depth', label: 'السيولة', icon: Activity },
];

/* ════════════════════════════════════════════════════════════════════════
 * MobileMoreSheet — أقسام أخرى (بدون تغيير)
 * ════════════════════════════════════════════════════════════════════════ */
export const moreNavItems: NavItem[] = [
  { id: 'bagholder-rescue', label: '🆘 إنقاذ سهم خاسر', icon: LifeBuoy },
  { id: 'watchlist', label: 'قوائم المراقبة', icon: Eye },
  { id: 'simulation', label: 'المحاكاة', icon: Gamepad2 },
  { id: 'academy', label: 'الأكاديمية', icon: GraduationCap },
  { id: 'news', label: 'الأخبار', icon: Newspaper },
  { id: 'subscription', label: 'الاشتراك', icon: Crown, highlight: true },
  { id: 'zakat', label: 'الزكاة', icon: Landmark },
  { id: 'tithes', label: 'العُشر', icon: Landmark },
  { id: 'settings', label: 'الإعدادات', icon: Settings },
  { id: 'about', label: 'من نحن', icon: Info },
];
