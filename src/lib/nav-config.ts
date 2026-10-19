/**
 * nav-config.ts — المصدر الوحيد للقوائم الثلاث (TopBar / MobileNav / MobileMoreSheet)
 * =====================================================================
 * SCREENS-REORG-VISION (تنفيذ رؤية سارة + عم رشاد):
 * - TopBar: 6 بوابات (الرئيسية / السوق / التحليل / محفظتي / التعلّم / المزيد)
 * - MobileNav: 5 أزرار (الرئيسية / الأسهم / التوصيات / المحفظة / السيولة)
 * - MobileMoreSheet: مبسّط (أخبار / اشتراك / إعدادات / من نحن / زكاة / عشور / دخول)
 *
 * مبدأ "التوحيد": كل الـ nav items معرّفة هنا مرة واحدة. أي تعديل في القوائم
 * يبقى هنا بس — مش لازم تعدّل 3 ملفات. الـ 3 مكوّنات بتـ import من هنا.
 *
 * مبدأ "عدم التكرار": مفيش array مكرّر في TopBar/MobileNav/MobileMoreSheet.
 *
 * مبدأ "البنية الهندسية": types صارمة (AppView) — لا casts.
 *
 * الألوان: كل الـ active/inactive states بتستخدم tokens (text-primary / text-muted-
 * foreground / text-warning / text-profit) — الـ tokens بـ handle dark mode أوتوماتيكياً.
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
  BookOpen,
  GraduationCap,
  Gamepad2,
  Menu,
  Newspaper,
  Crown,
  Settings,
  Info,
  ShieldCheck,
  Filter,
  BarChart3,
  Microscope,
  Layers,
  Gauge,
  GitBranch,
  Sparkles,
  TrendingUp,
  Landmark,
  LogIn,
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
 * TopBar — 6 بوابات (رؤية عم رشاد: كل أداة تحليلية في مكانها المنطقي)
 *
 * 1. 🏠 الرئيسية    → dashboard + market-depth (سيولة المستثمرين — رجّعت!)
 * 2. 📊 السوق       → stocks / stock-filters / liquidity-radar / trading-chart / sharia 🇪🇬
 * 3. 🎯 التحليل     → recommendations + الاستشارة الكاملة (specialist / unified / v82 / dual-track / smart-confluence)
 * 4. 💼 محفظتي     → portfolio / watchlist / alerts-center / bagholder-rescue / trading-journal
 * 5. 🎓 التعلّم     → academy + simulation (بوابة جديدة — طلب الأونر)
 * 6. ☰ المزيد      → news / subscription / settings / about
 *
 * ملاحظات:
 * - Sharia انتقلت لبوابة "السوق" (كانت معزولة على MobileMoreSheet) — 🇪🇬 badge
 *   يوضّح إنها للسوق المصري. الـ view نفسه مابيفحصش currentMarket (hardcoded EGX).
 * - شاشات الـ URL-only (wealth / trading-memory / publishing / live-monitor /
 *   advanced-portfolio / rescue / zakat / tithes / seasonality / backtesting /
 *   reports / prediction-tracking) لسه routable عبر الـ hash (Rule 67 — backward-compat).
 * ════════════════════════════════════════════════════════════════════════ */
export const navSections: NavSection[] = [
  {
    id: 'home',
    label: 'الرئيسية',
    icon: LayoutDashboard,
    items: [
      { id: 'dashboard', label: 'نظرة عامة', icon: LayoutDashboard },
      // P0-1: رجّعنا سيولة المستثمرين (أجانب/عرب/مصريين) لبوابة الرئيسية
      { id: 'market-depth', label: 'سيولة المستثمرين', icon: Activity, highlight: true },
    ],
  },
  {
    id: 'market',
    label: 'السوق',
    icon: CandlestickChart,
    items: [
      { id: 'stocks', label: 'الأسهم', icon: CandlestickChart },
      { id: 'stock-filters', label: 'فلاتر الأسهم', icon: Filter },
      { id: 'liquidity-radar', label: 'رادار السيولة', icon: Activity },
      { id: 'trading-chart', label: 'الشارت التفاعلي', icon: BarChart3 },
      // P0-2: Sharia رجعت لبوابة واضحة (كانت معزولة على الموبايل)
      { id: 'sharia', label: 'التوافق الشرعي 🇪🇬', icon: ShieldCheck },
    ],
  },
  {
    id: 'analysis',
    label: 'التحليل',
    icon: Target,
    items: [
      { id: 'recommendations', label: 'التوصيات', icon: Target },
      // P0-4: الاستشارة الكاملة لسهم — كل الشاشات التحليلية واضحة هنا
      { id: 'specialist-analysis', label: 'التحليل المتخصص', icon: Microscope },
      { id: 'unified-analysis', label: 'التحليل الموحّد', icon: Layers },
      { id: 'v82', label: 'قرار V82', icon: Gauge },
      { id: 'dual-track', label: 'التوقعات المزدوجة', icon: GitBranch },
      { id: 'smart-confluence', label: 'المساعد الذكي', icon: Sparkles },
    ],
  },
  {
    id: 'portfolio',
    label: 'محفظتي',
    icon: Wallet,
    items: [
      { id: 'portfolio', label: 'المحفظة', icon: Wallet },
      { id: 'watchlist', label: 'قائمة المتابعة', icon: Eye },
      { id: 'alerts-center', label: 'مركز التنبيهات', icon: Bell },
      { id: 'bagholder-rescue', label: '🆘 إنقاذ سهم خاسر', icon: LifeBuoy },
      { id: 'trading-journal', label: 'يوميات التداول', icon: BookOpen },
    ],
  },
  {
    id: 'education',
    label: 'التعلّم',
    icon: GraduationCap,
    items: [
      { id: 'academy', label: 'الأكاديمية', icon: GraduationCap },
      { id: 'simulation', label: 'المحاكاة', icon: Gamepad2 },
    ],
  },
  {
    id: 'more',
    label: 'المزيد',
    icon: Menu,
    items: [
      { id: 'news', label: 'الأخبار', icon: Newspaper },
      { id: 'subscription', label: 'الاشتراك', icon: Crown, highlight: true },
      { id: 'settings', label: 'الإعدادات', icon: Settings },
      { id: 'about', label: 'من نحن', icon: Info },
    ],
  },
];

/* ════════════════════════════════════════════════════════════════════════
 * MobileNav — 5 أزرار سفلية (رؤية سارة: الأكثر استخداماً يومياً)
 *
 * 1. الرئيسية     → dashboard
 * 2. الأسهم       → stocks
 * 3. التوصيات     → recommendations
 * 4. المحفظة      → portfolio
 * 5. السيولة      → market-depth (استبدل liquidity-radar — لأن الأخير أعمق:
 *                    يشمل المؤسسات + الأجانب/عرب/مصريين — ده اللي سارة
 *                    محتاجاه يومياً للـ EGX)
 *
 * التعلّم (academy + simulation) بقى في بوابة TopBar + MobileMoreSheet —
 * reachable من الموبايل عبر زر "أقسام أخرى" في الـ Header.
 * ════════════════════════════════════════════════════════════════════════ */
export const bottomNavItems: NavItem[] = [
  { id: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard },
  { id: 'stocks', label: 'الأسهم', icon: CandlestickChart },
  { id: 'recommendations', label: 'التوصيات', icon: TrendingUp },
  { id: 'portfolio', label: 'المحفظة', icon: Wallet },
  { id: 'market-depth', label: 'السيولة', icon: Activity },
];

/* ════════════════════════════════════════════════════════════════════════
 * MobileMoreSheet — "أقسام أخرى" مبسّط
 *
 * العناصر الإضافية اللي مش في الـ bottom bar ولا ليها مكان واضح:
 * - bagholder-rescue / watchlist / simulation / academy / about (كانوا هنا)
 * - zakat / tithes (حسابات دينية — surfaced من الـ URL-only)
 * - news / subscription / settings (موجودة في TopBar أكتر — برضو هنا للموبايل)
 *
 * الأزرار التفاعلية (بحث عن سهم + الإشعارات + الحساب) لسه في الـ MobileMoreSheet
 * نفسها (مش nav items — بتفتح panels) — مابتتعملش هنا.
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
  // ملاحظة: 'auth' مش هنا — زر «الحساب/تسجيل الدخول» في MobileMoreSheet
  // بيـ handle الـ user state (logged in → settings، logged out → auth) وهو
  // زر ذكي مش nav item عادي. ده منع التكرار.
];
