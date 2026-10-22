'use client';

// MAESTRO-DISABLED (Task PHASE-2-MAESTRO-KILL, Rule 73)
// Phase 0 already removed the MaestroWidget import. The two legacy comment
// lines below are retained for traceability — no maestro engine code remains
// in this file. Dashboard fetches go through unified API routes only.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Download, Zap, RefreshCw, Pin } from 'lucide-react';
import { useAppStore, MARKET_NAMES_AR } from '@/lib/store';
import { Header } from '@/components/layout/Header';
import { MarketSummary } from '@/modules/dashboard/components/MarketSummary';
import { IndexCards } from '@/modules/dashboard/components/IndexCards';
import { TopMovers } from '@/modules/dashboard/components/TopMovers';
import { MarketSentiment } from '@/modules/dashboard/components/MarketSentiment';

import { CryptoSignalsWidget } from '@/modules/dashboard/components/CryptoSignalsWidget';
import { SeasonalitySignalsWidget } from '@/modules/dashboard/components/SeasonalitySignalsWidget';
// ALPHA-PIPE-FIX: EidPredictionsWidget import removed — was mixing BTC+ETH with EGX stocks
// ALPHA-PHASE2: SovereignMetalsDesk — مكتب الذهب والعملات المستقل (بدون كريبتو/أسهم)
import { SovereignMetalsDesk } from '@/modules/dashboard/components/SovereignMetalsDesk';
import { AutoAnalysisWidget } from '@/components/auto-analysis-widget';
// ─── PHASE-0 (Task UNIFICATION-PHASE-0) ──────────────────────────────────
// MaestroWidget import تم تعطيله (Rule 73: SINGLE-DISPLAY-SOURCE).
// Maestro محرك قرار مختلف الـ thresholds — مش canonical.
// import { MaestroWidget } from '@/modules/dashboard/components/MaestroWidget';
import { LiveStockTicker } from '@/modules/dashboard/components/LiveStockTicker';
import { MarketPulseWidget } from '@/modules/dashboard/components/MarketPulseWidget';
// PORTFOLIO-INTEGRATION: ربط المحفظة بالدashboard — عمود من أعمدة المنصة
import { LiveMonitor } from '@/modules/dashboard/components/LiveMonitor';
// SCREENS-REORG-VISION (P0-1): رجّعنا InvestorsFlowPanel للـ Dashboard (EGX بس).
// السيولة (أجانب/عرب/مصريين) اختفت من أي قائمة — رجعت للـ home widget +
// لـ TopBar/MobileNav. شاشة #market-depth لسه شغّالة (للعرض الأعمق).
import { InvestorsFlowPanel } from '@/modules/dashboard/components/InvestorsFlowPanel';
// FOCUS-5-TASKS (2026-10-01): MyStocksBriefing — الـ widget الشخصي للعميل.
// بيجيب /api/portfolio/unified-watch (محفظة + توقعات + advice + exit_radar)
// + /api/news?tickers=... (أخبار مفلترة). بيتعرض في أول الـ dashboard للعميل
// المسجّل — عشان أول حاجة يشوفها الصبح هي: محفظته + تنبيهاته + أخباره.
import { MyStocksBriefing } from '@/modules/dashboard/components/MyStocksBriefing';
// FOCUS-5-TASKS — i18n Phase 2 Full (2026-10-01): useTranslation hook.
import { useTranslation } from '@/lib/i18n-context';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { ShareButton } from '@/components/share/ShareButton';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { StockSelector } from '@/modules/stock-analysis/components/StockSelector';
import { toast } from 'sonner';
import { SafeWidget } from '@/modules/dashboard/components/SafeWidget';
import { DevelopmentNotice } from '@/modules/dashboard/components/DevelopmentNotice';
// ALPHA-UX-FIX-2: guest signup enticement banner (shows only for unauthenticated users)
import { GuestSignupBanner } from '@/components/auth/GuestSignupBanner';
// FIX (owner directive — "الجرعة التخفيذية" للعميل الجديد):
// widgets جديدة للـ engagement + trust-building. كلها في PinnableWidget registry (Rule 52).
import { OpportunityCalculatorWidget } from '@/modules/dashboard/components/OpportunityCalculatorWidget';
import { TrackRecordWidget } from '@/modules/dashboard/components/TrackRecordWidget';
import { PriorityNotificationsWidget } from '@/modules/dashboard/components/PriorityNotificationsWidget';
// MultiMarketWidget اتشال من هنا — بقى في شاشة #market-depth المنفصلة (Owner directive).
// Owner directive: "الأسواق المتعددة → عملات + ذهب فقط" بقت شاشة مستقلة مع حركة
// السيولة + تدفّق المستثمرين + ضغط الجلسة (عمق السوق من قائمة الأعلى).
import { AssetPreferenceOnboarding } from '@/modules/dashboard/components/AssetPreferenceOnboarding';
import { PinnableWidget } from '@/modules/dashboard/components/PinnableWidget';

function DashboardSkeleton() {
 return (
 <div className="space-y-3 p-3 md:p-4" dir="rtl">
 {/* Summary skeleton */}
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
 {Array.from({ length: 4 }).map((_, i) => (
 <div key={i} className="rounded-lg border p-3">
 <Skeleton className="h-3 w-14 mb-1.5" />
 <Skeleton className="h-6 w-10 mb-1" />
 <Skeleton className="h-3 w-16" />
 </div>
 ))}
 </div>

 {/* Index cards skeleton */}
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
 {Array.from({ length: 4 }).map((_, i) => (
 <div key={i} className="rounded-lg border p-3">
 <Skeleton className="h-4 w-12 mb-2" />
 <Skeleton className="h-3 w-20 mb-1" />
 <Skeleton className="h-5 w-24 mb-1.5" />
 <Skeleton className="h-3 w-16" />
 </div>
 ))}
 </div>

 {/* Bottom section skeleton */}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
 <div className="rounded-lg border p-3">
 <Skeleton className="h-4 w-24 mb-3" />
 <div className="space-y-2">
 {Array.from({ length: 4 }).map((_, i) => (
 <div key={i} className="flex items-center gap-2">
 <Skeleton className="h-7 w-7 rounded-lg" />
 <div className="flex-1">
 <Skeleton className="h-3 w-14 mb-0.5" />
 <Skeleton className="h-2.5 w-20" />
 </div>
 <Skeleton className="h-3 w-14" />
 </div>
 ))}
 </div>
 </div>
 <div className="rounded-lg border p-3">
 <Skeleton className="h-4 w-24 mb-3" />
 <div className="flex justify-center mb-3">
 <Skeleton className="h-28 w-28 rounded-full" />
 </div>
 <div className="grid grid-cols-2 gap-2">
 <Skeleton className="h-12 w-full rounded-lg" />
 <Skeleton className="h-12 w-full rounded-lg" />
 </div>
 </div>
 </div>
 </div>
 );
}

/**
 * Widget descriptor. Each major dashboard widget is registered here so the
 * pin/personalization layer can reorder, filter, and wrap them uniformly.
 */
interface WidgetDescriptor {
 id: string;
 title: string;
 /**
 * Whether the widget should be visible for the given asset preference.
 * Defaults to true for 'all'.
 */
 visible: (pref: 'stocks' | 'crypto' | 'gold' | 'all') => boolean;
 render: () => React.ReactNode;
}

export function DashboardView() {
 const { isLoading, loadDashboard, marketOverview, currentMarket, assetPreference, pinnedWidgets, stocks, v2Data } = useAppStore();
 // FOCUS-5-TASKS — i18n Phase 2 Full (2026-10-01): translator hook.
 const t = useTranslation();
 const [exporting, setExporting] = useState(false);
 const [mounted, setMounted] = useState(false);
 const dashboardRef = useRef<HTMLDivElement>(null);

 useEffect(() => {
 setMounted(true);
 }, []);

 useEffect(() => {
 loadDashboard();
 }, [loadDashboard]);

 const handleExportPDF = async () => {
 setExporting(true);
 try {
 const { exportToPdf } = await import('@/lib/patch-html2pdf');
 const element = document.getElementById('dashboard-export');
 if (!element) {
 toast.error('لم يتم العثور على محتوى لوحة التحكم');
 return;
 }
 await exportToPdf(element, {
 filename: `${currentMarket.toLowerCase()}_dashboard_${new Date().toISOString().split('T')[0]}.pdf`,
 });
 toast.success('تم تصدير التقرير بنجاح');
 } catch (err) {
 console.error('PDF export error:', err);
 toast.error('حدث خطأ أثناء تصدير PDF');
 } finally {
 setExporting(false);
 }
 };

 // Get market name for subtitle
 const marketNameAr = MARKET_NAMES_AR[currentMarket];

 // نص المشاركة للوححة التحكم — ينتج تلقائياً من حالة السوق الحالية.
 const dashboardShareText = useMemo(() => {
 const idxVal = marketOverview?.indices?.[0]?.value;
 const idxChg = marketOverview?.indices?.[0]?.change_percent;
 const isOpen = marketOverview?.market_status?.is_open;
 const lines: string[] = [
 `📊 لوحة تحكم ${marketNameAr}`,
 '',
 idxVal != null ? `قيمة المؤشر: ${idxVal.toLocaleString('ar-EG')}` : '',
 idxChg != null ? `التغير: ${idxChg >= 0 ? '+' : ''}${idxChg.toFixed(2)}%` : '',
 `حالة السوق: ${isOpen ? 'مفتوح' : 'مغلق'}`,
 '',
 '🔔 تابع تحليلات السوق المصرية لحظياً عبر منصة دليل الاستثمار.',
 ].filter(Boolean);
 return lines.join('\n');
 }, [marketOverview, marketNameAr]);

 // ---------- Widget registry ----------
 // Owner directive (2026-10-05): تنظيف شامل للوحة التحكم
 // 1. دمج نبض السوق + مؤشر المشاعر → مكون واحد
 // 2. توقعات اليوم تتبع السوق المختار
 // 3. شيل التحليل الآلي (مش مفيد)
 // 4. الأكثر تحركاً تتبع السوق
 // 5. الأسواق المتعددة → عملات + ذهب فقط
 // 6. دمج ملخص السوق + المؤشرات
 // 7. حركة السيولة + المستثمرين + ضغط الجلسة → شاشة منفصلة (EGX)
 // 9. إشارات الكريبتو → CRYPTO فقط
 // 10. شيل إشارات الموسمية
 const widgets: WidgetDescriptor[] = useMemo(() => [
 // 6. ملخص السوق + المؤشرات (مدموج — Owner directive)
 // FIX (Task MARKET-SEPARATION): إخفاء مؤشرات EGX في الأسواق التانية
 // EGX30/70/100 ملهاش معنى في السوق الأمريكي أو الكريبتو.
 {
 id: 'market-summary',
 title: 'ملخص السوق والمؤشرات',
 visible: () => currentMarket === 'EGX',
 render: () => (
 <div className="space-y-3">
 <MarketSummary />
 <IndexCards />
 </div>
 ),
 },
 // 1. نبض السوق + مؤشر المشاعر (مدموج — Owner directive)
 // FIX (Task MARKET-SEPARATION): MarketPulse + Sentiment للـ EGX فقط
 // (بيجيبوا EGX30/70 data من /api/market-pulse).
 {
 id: 'market-pulse',
 title: 'نبض السوق والمشاعر',
 visible: () => currentMarket === 'EGX',
 render: () => (
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
 <MarketPulseWidget />
 <MarketSentiment />
 </div>
 ),
 },
 // 1.5. تدفّق المستثمرين (EGX بس — SCREENS-REORG P0-1: رجّعنا الـ widget)
 // كان اتعزل في #market-depth بس — دلوقتي كمان widget على الـ Dashboard.
 {
 id: 'investors-flow',
 title: 'تدفّق المستثمرين (أجانب/عرب/مصريين)',
 visible: () => currentMarket === 'EGX',
 render: () => <InvestorsFlowPanel />,
 },
 // ALPHA-PIPE-FIX: حذف eid-predictions نهائياً — كان بـ يخلط BTC+ETH+COMI+GOLD
 // استُبدل بـ SovereignMetalsDesk (ذهب + عملات بس) في الأسفل
 // { id: 'eid-predictions' } — REMOVED (ممنوع BTC/ETH في داشبورد EGX)
 // 2. مكتب الذهب والعملات السيادي — ALPHA-PHASE2: مستقل عن الأسهم والكريبتو
 {
 id: 'metals-desk',
 title: 'الذهب والعملات',
 visible: () => currentMarket !== 'CRYPTO',
 render: () => <SovereignMetalsDesk />,
 },
 // 3. التحليل الآلي — تم إزالته (Owner directive: "مش شايفله أي لزمة")
 // 4. الأكثر تحركاً (تتبع السوق — Owner directive)
 {
 id: 'top-movers',
 title: 'الأكثر تحركاً',
 visible: () => true,
 render: () => <TopMovers />,
 },
 // 5. الأسواق المتعددة (عملات + ذهب) — اتشال من Dashboard (Owner directive:
 // "شاشة منفصلة من قائمة الأعلى"). الـ widget ده بقى في #market-depth مع
 // حركة السيولة + تدفّق المستثمرين + ضغط الجلسة.
 // محفظتي
 {
 id: 'live-monitor',
 title: 'محفظتي',
 visible: () => true,
 render: () => <LiveMonitor />,
 },
 // FIX (owner directive — "الجرعة التخفيذية" للعميل الجديد):
 // Track record أسبوعي (🥇 الأولوية 1 — إثبات مصداقية)
 {
 id: 'track-record',
 title: 'توقعاتنا الأسبوع ده',
 visible: () => true,
 render: () => <TrackRecordWidget />,
 },
 // "لو كنت مالك السهم" (🥈 الأولوية 2 — قيمة ملموسة حقيقية، بديل demo portfolio الوهمية)
 {
 id: 'opportunity-calculator',
 title: 'لو كنت مالك السهم ده',
 visible: () => true,
 render: () => <OpportunityCalculatorWidget />,
 },
 // التنبيهات الذكية (A3 — top 3 priority notifications for authenticated users)
 {
 id: 'priority-notifications',
 title: 'تنبيهاتك المهمة',
 visible: () => true,
 render: () => <PriorityNotificationsWidget />,
 },
 // 9. إشارات الكريبتو → CRYPTO فقط (Owner directive)
 {
 id: 'crypto-signals',
 title: 'إشارات الكريبتو',
 visible: (p) => p === 'crypto',
 render: () => <CryptoSignalsWidget />,
 },
 // 10. إشارات الموسمية — تم إزالتها (Owner directive: "شيلها خالص")
 ], []);

 // Effective preference: when the active market is CRYPTO, force crypto
 // widgets so the dashboard mirrors the stocks experience with crypto data.
 // This makes the crypto overview a true "carbon copy" of the stocks dashboard
 // — same layout, same widgets, only the data source differs.
 const effectivePref = currentMarket === 'CRYPTO' ? 'crypto' : assetPreference;

 // Eligible widgets (after effective-preference filter)
 const eligibleWidgets = useMemo(
 () => widgets.filter((w) => w.visible(effectivePref)),
 [widgets, effectivePref]
 );

 // Partition into pinned (top section) vs. normal (rest of layout)
 const pinnedSet = useMemo(() => new Set(pinnedWidgets), [pinnedWidgets]);
 const pinnedList = useMemo(
 () => eligibleWidgets.filter((w) => pinnedSet.has(w.id)),
 [eligibleWidgets, pinnedSet]
 );
 const isPinned = (id: string) => pinnedSet.has(id);

 // Section layout: original 7 sections, each now conditionally hides
 // widgets that are pinned (already shown at the top). Sections that
 // end up empty are skipped entirely.
 type LaidOutWidget = WidgetDescriptor & { pinned: boolean };
 const layout: LaidOutWidget[] = eligibleWidgets.map((w) => ({ ...w, pinned: pinnedSet.has(w.id) }));

 // Helper to render a widget wrapped in PinnableWidget + SafeWidget
 const renderWrapped = (w: WidgetDescriptor) => (
 <PinnableWidget id={w.id} title={w.title}>
 <SafeWidget name={w.title}>{w.render()}</SafeWidget>
 </PinnableWidget>
 );

 const showPinnedSection = mounted && pinnedList.length > 0;

 // ─── UNIFIED-MARKET-VIEW (Task 1): market-driven panels ─────────────────
 // SCREENS-REORG-VISION (P0-1): InvestorsFlowPanel رجعت للـ Dashboard (EGX
 // بس) كـ widget — السيولة (أجانب/عرب/مصريين) اختفت من أي قائمة فِرَجًا.
 // شاشة #market-depth لسه شغّالة للعرض الأعمق. LiquidityFlowPanel +
 // IntradayPressurePanel لسه في #market-depth بس.

 return (
 <div className="min-h-screen flex flex-col bg-background">
 {/* First-visit asset preference onboarding (P5-MOBILE-UX Part B.1) */}
 <AssetPreferenceOnboarding />

 <Header
 title={t('dashboard.title')}
 subtitle={`${t('dashboard.subtitle')} — ${marketNameAr}`}
 />
 {/* ALPHA-UX-FIX-2: guest signup enticement (shows only for unauthenticated users) */}
 <GuestSignupBanner />
 <div className="px-3 md:px-4 print:hidden">
 {/* Quick Stock Lookup */}
 <Card className="mb-3 py-0 gap-0">
 <CardContent className="p-3">
 <div className="flex items-center gap-2 mb-1.5">
 <Zap className="w-3.5 h-3.5 text-profit " />
 <span className="text-xs font-semibold">
 {currentMarket === 'CRYPTO' ? t('dashboard.quickLookup') : t('dashboard.quickLookup')}
 </span>
 </div>
 <StockSelector
 placeholder="ابحث بالرمز أو الاسم للانتقال مباشرة..."
 compact
 />
 </CardContent>
 </Card>

 <div className="flex items-center gap-2 flex-wrap">
 <Button
 variant="outline"
 size="sm"
 className="gap-2"
 onClick={() => loadDashboard()}
 >
 <RefreshCw className="w-4 h-4" />
 {t('common.refresh')}
 </Button>
 <ShareButton
 iconOnly={false}
 variant="outline"
 size="sm"
 stockData={{
 ticker: currentMarket === 'CRYPTO' ? 'BTC' : `${currentMarket}30`,
 name: currentMarket === 'CRYPTO' ? 'Bitcoin' : `${currentMarket} 30 Index`,
 nameAr: marketNameAr,
 price: marketOverview?.indices?.[0]?.value ?? 0,
 change: marketOverview?.indices?.[0]?.change_percent ?? 0,
 recommendation: marketOverview?.market_status?.is_open ? 'السوق مفتوح' : 'السوق مغلق',
 recommendationAr: marketOverview?.market_status?.is_open ? 'السوق مفتوح' : 'السوق مغلق',
 sector: 'نظرة عامة على السوق',
 }}
 />
 <Button onClick={handleExportPDF} disabled={exporting} variant="outline" size="sm" className="gap-2">
 <Download className="w-4 h-4" />
 {exporting ? t('common.loading') : t('dashboard.exportPdf')}
 </Button>
 <UnifiedPublishButton
 content={dashboardShareText}
 title={`لوحة تحكم ${marketNameAr}`}
 image={dashboardRef}
 filename={`dashboard_${currentMarket}_${new Date().toISOString().slice(0, 10)}`}
 hashtags={['EGX', 'بورصة', 'توقعات']}
 variant="outline"
 size="sm"
 />
 </div>
 </div>

 {/* Development Notice for non-EGX markets */}
 <div className="px-3 md:px-4 print:hidden">
 <DevelopmentNotice />
 </div>
 {/* Live Stock Ticker - شريط الأسعار الحي (EGX فقط — مخفي في وضع الكريبتو) */}
 {currentMarket !== 'CRYPTO' && (
 <div className="px-3 md:px-4 print:hidden">
 <LiveStockTicker />
 </div>
 )}

 <main className="flex-1">
 {!mounted || isLoading ? (
 <DashboardSkeleton />
 ) : (
 <div id="dashboard-export" ref={dashboardRef} className="space-y-4 p-3 md:p-4" dir="rtl">

 {/* ═══════════════════════════════════════════════════════════════
 🎯 فرص جاهزة الآن (Top 3-5 opportunities for investors)
 Owner directive: "لوحة فرص حقيقية" — فوق كل حاجة
 ═══════════════════════════════════════════════════════════════ */}
 {v2Data?.stocks && v2Data.stocks.length > 0 && (() => {
 // فلتر: Strong Buy + Buy بس (مفيش Hold/Avoid للمستثمر)
 const opportunities = v2Data.stocks
 .filter(s => s.recommendation === 'Strong Buy' || s.recommendation === 'Buy')
 .sort((a, b) => b.compositeScore - a.compositeScore)
 .slice(0, 5);
 if (opportunities.length === 0) return null;
 return (
 <section aria-label="فرص جاهزة الآن" className="space-y-2">
 <div className="flex items-center gap-2 px-1" dir="rtl">
 <Zap className="w-4 h-4 text-profit " />
 <span className="text-sm font-bold text-profit ">
 فرص جاهزة الآن ({opportunities.length})
 </span>
 </div>
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
 {opportunities.map((stock) => {
 const entry = stock.entryPrice || stock.currentPrice;
 const stop = stock.exitStrategy?.stopLoss || 0;
 const target = stock.exitStrategy?.targetPrice || 0;
 const target2 = stock.exitStrategy?.targetPrice2 || 0;
 // UNIFY-FIX (Rule 20): R:R من Python (stock.rrRatio) — لا حساب client-side
 const rr = (stock as Record<string, unknown>).rrRatio as number | undefined;
 const rrDisplay = rr != null ? rr.toFixed(2) : '—';
 const isStrong = stock.recommendation === 'Strong Buy';
 return (
 <Card
 key={stock.ticker}
 className={`border-r-4 ${isStrong ? 'border-r-profit' : 'border-r-primary/60'} cursor-pointer hover:shadow-md transition-shadow`}
 onClick={() => useAppStore.getState().setCurrentView('stock-detail') || useAppStore.getState().setSelectedTicker(stock.ticker)}
 >
 <CardContent className="p-3 space-y-2">
 {/* Header: ticker + signal */}
 <div className="flex items-center justify-between">
 <div>
 <div className="font-mono font-bold text-sm">{stock.ticker}</div>
 <div className="text-xs text-muted-foreground truncate max-w-[120px]">{stock.nameAr || stock.name}</div>
 </div>
 <span className={`text-xs font-bold px-2 py-0.5 rounded ${isStrong ? 'bg-profit/10 text-profit border border-profit/20-foreground' : 'bg-primary/10 text-primary'}`}>
 {stock.recommendationAr || stock.recommendation}
 </span>
 </div>
 {/* Entry / Stop / Target */}
 <div className="grid grid-cols-3 gap-2 text-xs">
 <div>
 <div className="text-muted-foreground">دخول</div>
 <div className="font-mono font-semibold">{entry > 0 ? (entry ?? 0).toFixed(2) : '—'}</div>
 </div>
 <div>
 <div className="text-muted-foreground">وقف</div>
 <div className="font-mono font-semibold text-loss ">{stop > 0 ? (stop ?? 0).toFixed(2) : '—'}</div>
 </div>
 <div>
 <div className="text-muted-foreground">هدف</div>
 <div className="font-mono font-semibold text-profit ">{target > 0 ? (target ?? 0).toFixed(2) : '—'}</div>
 </div>
 </div>
 {/* R:R + Confidence */}
 <div className="flex items-center justify-between text-xs">
 <span className="text-muted-foreground">R/R: <span className="font-mono font-bold">{rrDisplay}</span></span>
 <span className="text-muted-foreground">ثقة: <span className="font-bold">{stock.confidence?.toFixed(0) || '—'}%</span></span>
 </div>
 </CardContent>
 </Card>
 );
 })}
 </div>
 </section>
 );
 })()}

 {/* ═══════════════════════════════════════════════════════════════
 📊 حالة السوق (one sentence — owner directive)
 ═══════════════════════════════════════════════════════════════ */}
 {v2Data?.market && (() => {
 const regime = v2Data.market.regime;
 // UNIFY-FIX (Rule 20): isDefensive من regime.trend فقط (لا regimeMultiplier client-side)
 const isDefensive = regime?.trend === 'bear' || regime?.trend === 'distribution';
 const regimeText = regime?.regimeAr || regime?.trend || 'محايد';
 // UNIFY-FIX: advice من Python (regime.advice_ar) أو fallback نصي بسيط (لا حساب)
 const advice = regime?.advice_ar
 || (isDefensive
 ? 'السوق دفاعي — قلل الحجم وركّز على وقف الخسارة'
 : regime?.trend === 'bull'
 ? 'السوق صاعد — ركّز على الأسهم ذات الـ RS العالي'
 : 'السوق عرضي — انتظر فرص أوضح');
 return (
 <section aria-label="حالة السوق">
 <div className={`rounded-lg border p-3 ${isDefensive ? 'border-loss bg-loss/10' : 'border-profit bg-profit/10'}`}>
 <div className="flex items-center gap-2">
 {isDefensive ? (
 <span className="text-loss font-bold text-sm">⚠️ {advice}</span>
 ) : (
 <span className="text-profit font-bold text-sm">📊 {advice}</span>
 )}
 </div>
 </div>
 </section>
 );
 })()}

 {/* FOCUS-5-TASKS: تنبيهات أسهمك الشخصية — Owner directive: "تبقى أصغر أو في جانب" */}
 {/* خليها collapsible عشان مش تزحم الفرص فوق */}
 <details className="rounded-lg border border-profit/20 bg-profit/10 /10">
 <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-profit select-none flex items-center gap-2">
 🔔 تنبيهات أسهمك الشخصية
 </summary>
 <div className="p-4 pt-0">
 <MyStocksBriefing />
 </div>
 </details>

 {/* Pinned section — widgets the user pinned appear at the top */}
 {showPinnedSection && (
 <section aria-label="ودجات مثبتة" className="space-y-3">
 <div className="flex items-center gap-2 px-1" dir="rtl">
 <Pin className="w-4 h-4 text-profit " />
 <span className="text-sm font-bold text-profit ">
 مثبتة ({pinnedList.length})
 </span>
 </div>
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
 {pinnedList.map((w) => (
 <React.Fragment key={w.id}>{renderWrapped(w)}</React.Fragment>
 ))}
 </div>
 </section>
 )}

 {/* 1. ملخص السوق والمؤشرات (مدموج — Owner directive) */}
 {(() => {
 const w = layout.find((x) => x.id === 'market-summary');
 if (!w || w.pinned) return null;
 return (
 <section aria-label="ملخص السوق والمؤشرات">
 {renderWrapped(w)}
 </section>
 );
 })()}

 {/* 2. نبض السوق والمشاعر (مدموج — Owner directive) */}
 {(() => {
 const w = layout.find((x) => x.id === 'market-pulse');
 if (!w || w.pinned) return null;
 return (
 <section aria-label="نبض السوق والمشاعر">
 {renderWrapped(w)}
 </section>
 );
 })()}

 {/* 2.5. تدفّق المستثمرين (EGX بس — restored per SCREENS-REORG-VISION) */}
 {(() => {
 const w = layout.find((x) => x.id === 'investors-flow');
 if (!w || w.pinned) return null;
 return (
 <section aria-label="تدفّق المستثمرين (أجانب/عرب/مصريين)">
 {renderWrapped(w)}
 </section>
 );
 })()}

 {/* ALPHA-PIPE-FIX: eid-predictions section removed — was mixing BTC+ETH with EGX stocks */}

 {/* 4. الأكثر تحركاً */}
 {(() => {
 const w = layout.find((x) => x.id === 'top-movers');
 if (!w || w.pinned) return null;
 return (
 <section aria-label="الأكثر تحركاً">
 {renderWrapped(w)}
 </section>
 );
 })()}

 {/* 5. العملات والذهب — اتشال (نقل لشاشة #market-depth المنفصلة) */}

 {/* 6. إشارات الكريبتو (CRYPTO فقط — Owner directive) */}
 {(() => {
 const w = layout.find((x) => x.id === 'crypto-signals');
 if (!w || w.pinned) return null;
 return (
 <section aria-label="إشارات الكريبتو">
 {renderWrapped(w)}
 </section>
 );
 })()}

 {/* 7. حركة المستثمرين + السيولة + ضغط الجلسة — اتشالوا (نقلوا لشاشة
 #market-depth المنفصلة من قائمة الأعلى — Owner directive). الـ Dashboard
 بقى نضيف بدونهم. للوصول: قائمة السوق ← عمق السوق. */}

 {/* Empty-state when asset preference filters out everything */}
 {eligibleWidgets.length === 0 && (
 <section className="text-center py-12" dir="rtl">
 <p className="text-sm text-muted-foreground">
 لا توجد ودجات متاحة لتفضيل الأصول هذا حالياً. يمكنك تغيير التفضيل من الإعدادات.
 </p>
 </section>
 )}
 </div>
 )}
 </main>
 </div>
 );
}
