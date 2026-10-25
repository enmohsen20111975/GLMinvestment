/**
 * admin-view/admin-hubs.tsx
 * ========================
 * The 6 Core Admin Hubs config (Stream C / ADMIN-HUBS-REORG).
 *
 * Originally a single `ADMIN_HUBS` constant inlined at line ~1007 inside the
 * AdminView function body (because it depends on `feedbackCount` state for the
 * "feedback" tab count badge).
 *
 * Extracted here as a builder function `buildAdminHubs(feedbackCount?)` so the
 * container stays thin and the hub taxonomy lives in one searchable place.
 *
 * Each hub: id + Arabic label + shortLabel + icon + tailwind accent classes +
 * list of tabs (each: id + label + icon + optional count + optional desc).
 *
 * Tabs map 1:1 to AdminTab union members in types.ts. Adding a new tab to the
 * nav = add an entry here + ensure the AdminView container renders it.
 */

'use client';

import React from 'react';
import {
 Activity,
 Brain,
 BarChart3,
 Clock,
 Cpu,
 Database,
 DollarSign,
 FileText,
 Gauge,
 HeartPulse,
 MessageSquareText,
 Monitor,
 Newspaper,
 Send,
 Server,
 Settings,
 Shield,
 ShieldAlert,
 ShieldCheck,
 Sparkles,
 Ticket,
 Upload,
 Users,
 Wifi,
 Zap,
} from 'lucide-react';
import type { AdminHub } from './types';

// Stream C: 6 Core Admin Hubs — consolidates 26 flat tabs into 6 logical sectors.
// ADMIN-HUBS-REORG (2026-09-30): تبسيط 31 tab → 4 hubs مركّزة (17 tab فعّال)
// — شيلنا التبويبات الميتة/المتكررة
// — دمجنا hub "التواصل والتنبيهات" في "أدوات التسويق والنشر" (أداة قوية موحّدة)
// — دمجنا hub "البيانات" (9 tabs → 4): قواعد + نسخ احتياطي + تحكم + مصادر الأسواق
// — دمجنا hub "التعلم الذكي" (5 → 3): شيلنا historical-predictions + notebooks (ميتين)
// — دمجنا hub "المحركات" (3 → 2): شيلنا data-engine (مكرر)
export function buildAdminHubs(feedbackCount?: number): AdminHub[] {
 return [
 {
 id: 'health',
 label: 'المراقبة وصحة النظام',
 shortLabel: 'المراقبة',
 icon: <Activity className="w-4 h-4" />,
 accent: 'border-profit/20 bg-profit/5',
 tabs: [
 { id: 'dashboard', label: 'لوحة التحكم', icon: <Activity className="w-3.5 h-3.5" />, desc: 'نظرة عامة + صحة النظام' },
 { id: 'system-monitor', label: 'مراقبة الموارد', icon: <Monitor className="w-3.5 h-3.5" />, desc: 'CPU/RAM/DB' },
 { id: 'problems', label: 'مشاكل النظام', icon: <ShieldAlert className="w-3.5 h-3.5" />, desc: 'تنبيهات + حلول' },
 // Task 28-B (Fix 4) — Fix Battalion: Cron Health dashboard.
 { id: 'cron-health', label: 'حالة المهام', icon: <Clock className="w-3.5 h-3.5" />, desc: 'crontab + آخر تشغيل' },
 ],
 },
 {
 id: 'maestro',
 label: 'المحركات والتعلم الذكي',
 shortLabel: 'المحركات',
 icon: <Zap className="w-4 h-4" />,
 accent: 'border-warning/20 bg-warning/5',
 tabs: [
 // Task 31-B (Engine Monitor Battalion) — unified engine control room
 // (8 engine cards + per-engine deep view + error console + start-all/stop-all).
 { id: 'engine-control-room', label: '🎮 غرفة تحكم المحركات', icon: <Cpu className="w-3.5 h-3.5" />, desc: 'كل المحركات + كونسول + تحكم' },
 { id: 'data-engine', label: 'محرك البيانات', icon: <Database className="w-3.5 h-3.5" />, desc: 'تفاصيل Scrapers + Historical' },
 { id: 'general', label: 'المحركات', icon: <Server className="w-3.5 h-3.5" />, desc: 'حالة المحركات + تحكم' },
 { id: 'engine-settings', label: 'إعدادات المحرك', icon: <Settings className="w-3.5 h-3.5" />, desc: 'أوزان + بارامترات' },
 { id: 'learning', label: 'التعلم الذكي', icon: <Brain className="w-3.5 h-3.5" />, desc: 'تعلّم + توقعات' },
 { id: 'backtest', label: 'الباك تست', icon: <Activity className="w-3.5 h-3.5" />, desc: 'اختبار الاستراتيجيات' },
 { id: 'platform-performance', label: 'كفاءة المنصة', icon: <Gauge className="w-3.5 h-3.5" />, desc: 'مؤشرات الأداء' },
 ],
 },
 {
 id: 'data',
 label: 'البيانات وقواعد البيانات',
 shortLabel: 'البيانات',
 icon: <Database className="w-4 h-4" />,
 accent: 'border-sky-500/40 bg-sky-500/5',
 tabs: [
 // FRONTEND-1: Data Health — top of data hub so admins see freshness first.
 { id: 'data-health', label: 'صحة البيانات', icon: <HeartPulse className="w-3.5 h-3.5" />, desc: 'طزاجة كل مصدر لكل سوق' },
 { id: 'investors-entry', label: 'تدفق المستثمرين', icon: <Users className="w-3.5 h-3.5" />, desc: 'إدخال يدوي بيانات مصريين/عرب/أجانب' },
 { id: 'databases', label: 'قواعد البيانات', icon: <Database className="w-3.5 h-3.5" />, desc: 'إدارة DBs' },
 { id: 'db-backup', label: 'النسخ الاحتياطي', icon: <Upload className="w-3.5 h-3.5" />, desc: 'backup/restore' },
 { id: 'system-control', label: 'تحكم شامل', icon: <Settings className="w-3.5 h-3.5" />, desc: 'scraper + sync + cron' },
 { id: 'news-control', label: 'إدارة الأخبار', icon: <Newspaper className="w-3.5 h-3.5" />, desc: 'أخبار + مصادر' },
 // Task 28-B (Fix 6) — Fix Battalion: News source health dashboard.
 { id: 'news-health', label: 'صحة مصادر الأخبار', icon: <Wifi className="w-3.5 h-3.5" />, desc: 'last_fetch + مصادر معطّلة' },
 // Task 28-B (Fix 1) — Fix Battalion: Sharia management tab (Rule 64).
 { id: 'sharia', label: 'الفحص الشرعي', icon: <Shield className="w-3.5 h-3.5" />, desc: 'توافق + تطهير + سكرابر' },
 // Task 28-B (Fix 2) — Fix Battalion: Source Authority tab (Rule 66).
 { id: 'source-authority', label: 'سلطة المصادر', icon: <Shield className="w-3.5 h-3.5" />, desc: 'Rule 66 + محظورات + تعارضات' },
 // Task 28-B (Fix 3) — Fix Battalion: Validation Monitor tab (Rule 65).
 { id: 'validation-monitor', label: 'مراقبة التحقق', icon: <ShieldCheck className="w-3.5 h-3.5" />, desc: 'Rule 65 + حقول باطلة' },
 ],
 },
 {
 id: 'users',
 label: 'المستخدمين والاشتراكات',
 shortLabel: 'المستخدمين',
 icon: <Users className="w-4 h-4" />,
 accent: 'border-loss/20 bg-loss/5',
 tabs: [
 { id: 'user-management', label: 'إدارة المستخدمين', icon: <Users className="w-3.5 h-3.5" />, desc: 'CRUD + باقات' },
 { id: 'users', label: 'تحليلات المستخدمين', icon: <BarChart3 className="w-3.5 h-3.5" />, desc: 'إحصائيات + behavior' },
 { id: 'promo-codes', label: 'أكواد الخصم', icon: <Ticket className="w-3.5 h-3.5" />, desc: 'CRUD + متابعة' },
 // Task 28-B (Fix 5) — Fix Battalion: Pricing + paywall gates status.
 { id: 'pricing', label: 'التسعير + البوابات', icon: <DollarSign className="w-3.5 h-3.5" />, desc: 'plans + 7 paywall gates' },
 { id: 'feedback', label: 'آراء المستخدمين', icon: <MessageSquareText className="w-3.5 h-3.5" />, count: feedbackCount, desc: 'ملاحظات + شكاوى' },
 ],
 },
 {
 id: 'telegram',
 label: 'أدوات التسويق والنشر',
 shortLabel: 'التسويق',
 icon: <Send className="w-4 h-4" />,
 accent: 'border-whale/20 bg-whale/5',
 tabs: [
 { id: 'marketing-studio', label: 'استوديو التسويق', icon: <Sparkles className="w-3.5 h-3.5" />, desc: 'فيديو + كروت + حملات + تقويم' },
 { id: 'reports', label: 'التقارير الذكية', icon: <FileText className="w-3.5 h-3.5" />, desc: 'يومية + أسبوعية + PDF' },
 { id: 'telegram', label: 'تيليجرام', icon: <Send className="w-3.5 h-3.5" />, desc: 'bot + نشر + reports' },
 // Task 28-B (Fix 7) — Fix Battalion: Telegram published predictions audit.
 { id: 'telegram-predictions', label: 'تدقيق توقعات TG', icon: <MessageSquareText className="w-3.5 h-3.5" />, desc: 'published + pending' },
 ],
 },
 ];
}
