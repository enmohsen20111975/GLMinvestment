'use client';

/**
 * MyStocksBriefing — الـ widget الشخصي للعميل على الـ Dashboard
 * =================================================================
 * FOCUS-5-TASKS (2026-10-01):
 * Task 1: الشاشة الرئيسية تبقى شخصية (محفظة + تنبيهات + توقعات تخص العميل)
 * Task 2: Exit Radar يدخل على المحفظة بـ badge أحمر + تنبيه عملي
 * Task 3: توقعات V40.2 اللي تخص أسهم العميل تظهر له في الأول
 * Task 4: الأخبار تبقى حسب أسهمه (filter by tickers)
 * Task 5: التنبيهات تبقى قرارات مش مجرد أسعار
 *
 * كل الـ APIs المطلوبة موجودة من قبل — الـ widget ده بيربطهم في مكوّن واحد:
 * - /api/portfolio/unified-watch (محفظة + توقعات V40.2 + advice + exit_radar_signal)
 * - /api/news?tickers=COMI,EGBE,...&limit=3 (أخبار مفلترة بأسهم العميل)
 *
 * الـ widget ده هو ربط خيوط، مش شاشة جديدة — نفس نمط LiquidityFlowPanel +
 * IntradayPressurePanel اللي اتضافوا في P1-GEMS-WIRING.
 */

import React, { useMemo } from 'react';
import { useApiQuery } from '@/hooks/use-api-query';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';
import {
 AlertTriangle,
 BellRing,
 BookOpen,
 ChevronLeft,
 LogIn,
 PlusCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { WidgetCard } from '@/components/shared/WidgetCard';
import { WidgetStat, WidgetStatGrid } from '@/components/shared/WidgetStat';
import { WidgetError } from '@/components/shared/WidgetError';
// FOCUS-5-TASKS — i18n Phase 2 Full (2026-10-01): useTranslation hook.
import { useTranslation } from '@/lib/i18n-context';
import { useAppStore } from '@/lib/store';

// ============================================================
// Types (mirror the unified-watch API response shape)
// ============================================================

interface StockAdvice {
 type: 'TAKE_PROFIT' | 'STOP_LOSS' | 'APPROACHING_TARGET' | 'HOLD' | 'EXIT_RADAR' | string;
 reason: string;
 action: string;
 pnl_pct: number;
 to_target_pct: number;
 to_stop_pct: number;
 confidence?: number | null;
 signal?: string | null;
 severity?: 'critical' | 'warning' | 'caution' | undefined;
}

interface ExitRadarSignal {
 path: string;
 label_ar: string;
 reason: string;
 severity: 'critical' | 'warning' | 'caution';
 volume_ratio_today: number | null;
 all_paths: string[];
 current_price_from_radar: number | null;
 generated_at: string | null;
}

interface UserStock {
 ticker: string;
 name_ar?: string;
 sector?: string | null;
 sources: string[];
 entry_price: number | null;
 shares: number | null;
 current_price: number | null;
 change_percent: number | null;
 prediction: any | null;
 advice: StockAdvice | null;
 exit_radar_signal: ExitRadarSignal | null;
}

interface BriefingData {
 success: boolean;
 user_id: string;
 stocks: UserStock[];
 summary: {
 total_stocks: number;
 portfolio_stocks: number;
 watchlist_stocks: number;
 radar_tracked: number;
 total_value: number;
 total_cost: number;
 total_pnl: number;
 total_pnl_pct: number;
 sector_distribution: Record<string, number>;
 alerts: {
 total: number;
 critical: number;
 warning: number;
 caution: number;
 by_type: Record<string, number>;
 exit_radar_count: number;
 take_profit_count: number;
 stop_loss_count: number;
 approaching_target_count: number;
 };
 exit_radar_cache_age_seconds: number | null;
 };
}

interface NewsItem {
 id: number;
 title: string;
 summary_ar?: string | null;
 source?: string | null;
 importance?: number;
 sentiment?: string | null;
 published_at?: string | null;
 fetched_at?: string | null;
 tickers?: string;
 market?: string;
}

interface NewsResponse {
 news: NewsItem[];
 total: number;
 filter?: { tickers: string[]; tickers_count: number };
}

// ============================================================
// Constants
// ============================================================

const REFRESH_INTERVAL = 60; // 60s — quieter than LiveMonitor (10s) since this widget isn't a real-time ticker.

const ADVICE_TYPE_INFO: Record<string, { label_ar: string; color_class: string; icon_bg: string; priority: number }> = {
 EXIT_RADAR: {
 label_ar: 'إشارة خروج',
 color_class: 'text-loss bg-loss/10 border-loss ',
 icon_bg: 'bg-loss',
 priority: 100,
 },
 STOP_LOSS: {
 label_ar: 'وقف خسارة',
 color_class: 'text-loss bg-loss/10 border-loss ',
 icon_bg: 'bg-loss',
 priority: 90,
 },
 TAKE_PROFIT: {
 label_ar: 'جني أرباح',
 color_class: 'text-profit bg-profit/10 border-profit ',
 icon_bg: 'bg-profit',
 priority: 70,
 },
 APPROACHING_TARGET: {
 label_ar: 'اقتراب من الهدف',
 color_class: 'text-warning bg-warning/10 border-warning ',
 icon_bg: 'bg-warning',
 priority: 60,
 },
 HOLD: {
 label_ar: 'انتظار',
 color_class: 'text-muted-foreground bg-muted border-border',
 icon_bg: 'bg-muted-foreground',
 priority: 0,
 },
};

const numberFmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('en-US');

function fmtNum(value: number | null | undefined, decimals = 2): string {
 if (value === null || value === undefined || Number.isNaN(value)) return '—';
 if (decimals === 0) return intFmt.format(Math.round(value));
 return numberFmt2.format(value);
}

function fmtPct(value: number | null | undefined): string {
 if (value === null || value === undefined || Number.isNaN(value)) return '—';
 const sign = value > 0 ? '+' : '';
 return `${sign}${fmtNum(value)}%`;
}

function fmtCurrency(value: number | null | undefined): string {
 if (value === null || value === undefined || Number.isNaN(value)) return '—';
 return `${fmtNum(value)} ج.م`;
}

/** Relative time in Arabic for the news timestamps. */
function relativeTime(dateString: string | null | undefined): string {
 if (!dateString) return '';
 const date = new Date(dateString);
 if (Number.isNaN(date.getTime())) return '';
 const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
 if (diffSec < 0) return 'الآن';
 if (diffSec < 60) return `منذ ${diffSec} ثانية`;
 const diffMin = Math.floor(diffSec / 60);
 if (diffMin < 60) {
 if (diffMin === 1) return 'منذ دقيقة';
 if (diffMin <= 10) return `منذ ${diffMin} دقائق`;
 return `منذ ${diffMin} دقيقة`;
 }
 const diffHr = Math.floor(diffMin / 60);
 if (diffHr < 24) {
 if (diffHr === 1) return 'منذ ساعة';
 if (diffHr <= 10) return `منذ ${diffHr} ساعات`;
 return `منذ ${diffHr} ساعة`;
 }
 const diffDay = Math.floor(diffHr / 24);
 if (diffDay === 1) return 'منذ يوم';
 if (diffDay <= 10) return `منذ ${diffDay} أيام`;
 return `منذ ${diffDay} يوم`;
}

// ============================================================
// Sub-components
// ============================================================

function AlertCard({ stock }: { stock: UserStock }) {
 const t = useTranslation();
 const advice = stock.advice;
 if (!advice || advice.type === 'HOLD') return null;
 const info = ADVICE_TYPE_INFO[advice.type] ?? ADVICE_TYPE_INFO.HOLD;
 const pnlPositive = (advice.pnl_pct ?? 0) > 0;

 return (
 <div className={cn('rounded-lg border p-3 text-right', info.color_class)} dir="rtl">
 <div className="flex items-start justify-between gap-2 mb-1.5">
 <div className="flex items-center gap-1.5 min-w-0">
 <span className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', info.icon_bg)} />
 <span className="font-bold text-sm truncate">{stock.ticker}</span>
 {stock.name_ar && (
 <span className="text-xs text-muted-foreground truncate">— {stock.name_ar}</span>
 )}
 </div>
 <Badge variant="outline" className="text-xs py-0 px-1.5 h-5 flex-shrink-0">
 {info.label_ar}
 </Badge>
 </div>
 <p className="text-xs leading-relaxed mb-2 text-foreground/90">{advice.reason}</p>
 <div className="flex items-center justify-between gap-2 flex-wrap">
 <div className="flex items-center gap-2 text-xs">
 {advice.pnl_pct !== 0 && (
 <span className={cn('font-bold', pnlPositive ? 'text-profit ' : 'text-loss ')}>
 {fmtPct(advice.pnl_pct)}
 </span>
 )}
 {stock.current_price != null && (
 <span className="text-muted-foreground">{fmtNum(stock.current_price)} ج.م</span>
 )}
 {stock.shares != null && stock.shares > 0 && (
 <span className="text-muted-foreground">{intFmt.format(stock.shares)} سهم</span>
 )}
 </div>
 <Link
 href={`/?ticker=${encodeURIComponent(stock.ticker)}`}
 className="text-xs underline-offset-2 hover:underline flex items-center gap-0.5 text-foreground/80 hover:text-foreground"
 >
 {t('alerts.viewStock')}
 <ChevronLeft className="w-3 h-3" />
 </Link>
 </div>
 {advice.action && (
 <p className="text-xs mt-1.5 pt-1.5 border-t border-border/50 text-foreground/80 leading-relaxed">
 <span className="font-semibold">{t('alerts.action')}: </span>
 {advice.action}
 </p>
 )}
 </div>
 );
}

function PortfolioSummaryCard({ data }: { data: BriefingData }) {
 const { summary } = data;
 const isPositive = summary.total_pnl >= 0;

 return (
 <WidgetStatGrid cols={2} className="bg-transparent p-0">
 <WidgetStat label="القيمة الحالية" value={fmtCurrency(summary.total_value)} />
 <WidgetStat
 label="المكاسب/الخسائر"
 value={<>{isPositive ? '+' : ''}{fmtCurrency(summary.total_pnl)} <span className="text-xs ms-1 opacity-70">({fmtPct(summary.total_pnl_pct)})</span></>}
 valueClass={isPositive ? 'text-profit' : 'text-loss'}
 />
 <WidgetStat label="عدد الأسهم" value={intFmt.format(summary.portfolio_stocks)} />
 <WidgetStat label="قيمة التكلفة" value={fmtCurrency(summary.total_cost)} />
 </WidgetStatGrid>
 );
}

function NewsList({ news }: { news: NewsItem[] }) {
 const t = useTranslation();
 if (news.length === 0) {
 return (
 <div className="text-xs text-muted-foreground text-center py-3" dir="rtl">
 {t('dashboard.noAlerts')}
 </div>
 );
 }
 return (
 <div className="space-y-1.5" dir="rtl">
 {news.map((item) => (
 <a
 key={item.id}
 href={item.id ? `#news` : '#'}
 className="block rounded-md border bg-card p-2 hover:bg-accent/50 transition-colors text-right"
 >
 <div className="flex items-start justify-between gap-1.5 mb-0.5">
 <p className="text-xs font-medium leading-snug line-clamp-2 flex-1">{item.title}</p>
 {item.importance != null && item.importance > 0 && (
 <Badge variant="outline" className="text-xs py-0 px-1 h-4 flex-shrink-0">
 ★{item.importance}
 </Badge>
 )}
 </div>
 {item.summary_ar && (
 <p className="text-xs text-muted-foreground leading-snug line-clamp-1 mb-0.5">
 {item.summary_ar}
 </p>
 )}
 <div className="flex items-center gap-1.5 text-xs text-muted-foreground/80">
 <span>{relativeTime(item.published_at || item.fetched_at)}</span>
 {item.source && <span>• {item.source}</span>}
 </div>
 </a>
 ))}
 </div>
 );
}

// ============================================================
// Main component
// ============================================================

export function MyStocksBriefing() {
 const { data: session, status } = useSession();
 const isAuthenticated = status === 'authenticated' && !!session?.user;
 // FOCUS-5-TASKS — i18n Phase 2 Full (2026-10-01): translator hook.
 const t = useTranslation();
 // News lives inside the dashboard shell as a hash view (/#news) — there is
 // no standalone /news route, so navigate through the store instead of a Link.
 const setCurrentView = useAppStore((s) => s.setCurrentView);

 // F2.2: useApiQuery replaces manual fetch + useState + useCallback + useEffect.
 // 1) Fetch unified-watch (portfolio + predictions + advice + exit_radar).
 const { data: watchData, isLoading: loadingWatch, error: watchError, refetch: refetchWatch, isFetching: refreshingWatch } = useApiQuery<BriefingData>('/api/portfolio/unified-watch', {
   queryOptions: {
     enabled: isAuthenticated, // only fetch when authenticated
     refetchInterval: REFRESH_INTERVAL * 1000, // 60s polling
     refetchOnWindowFocus: false,
   },
 });

 // Derive briefing + newsTickers from cached watchData
 const briefing = watchData ?? null;
 const newsTickers = useMemo(() => {
   return (watchData?.stocks || [])
     .map(s => s.ticker)
     .filter(Boolean)
     .slice(0, 30);
 }, [watchData]);

 // 2) Fetch filtered news (only if user has tickers) — depends on watchData
 const { data: newsData, isLoading: loadingNews } = useApiQuery<NewsResponse>('/api/news', {
   params: newsTickers.length > 0 ? { tickers: newsTickers.join(','), limit: 3 } : undefined,
   queryOptions: {
     enabled: isAuthenticated && newsTickers.length > 0, // only fetch when user has tickers
     refetchInterval: REFRESH_INTERVAL * 1000,
     refetchOnWindowFocus: false,
   },
 });

 const news = useMemo(() => (Array.isArray(newsData?.news) ? newsData!.news : []), [newsData]);
 const loading = !isAuthenticated ? false : (loadingWatch || loadingNews);
 const refreshing = refreshingWatch;
 const error = !isAuthenticated ? null
   : (watchError ? 'auth_required' : null);

 const handleRefresh = () => { void refetchWatch(); };


 // ─── Loading state ─────────────────────────────────────────
 if (loading) {
 return (
 <WidgetCard title={t('dashboard.myStocksBriefing')} icon={BellRing} iconColor="text-profit" iconBg="bg-transparent" iconSize="w-4 h-4"
 hideRefresh className="border-profit" titleClassName="text-base"
 loading skeletonRows={3} skeletonHeight="h-16" />
 );
 }

 // ─── Not authenticated ─────────────────────────────────────
 if (!isAuthenticated) {
 return (
 <WidgetCard title={t('dashboard.myStocksBriefing')} icon={BellRing} iconColor="text-profit" iconBg="bg-transparent" iconSize="w-4 h-4"
 hideRefresh className="border-profit" titleClassName="text-base">
 <p className="text-xs text-muted-foreground text-center">{t('auth.loginPrompt')}</p>
 <Button asChild size="sm" className="gap-2 w-full">
 <Link href="/?dev=1">
 <LogIn className="w-4 h-4" />
 {t('common.login')}
 </Link>
 </Button>
 </WidgetCard>
 );
 }

 // ─── Authenticated but no portfolio yet ────────────────────
 if (briefing && briefing.summary.portfolio_stocks === 0 && briefing.summary.watchlist_stocks === 0 && briefing.summary.radar_tracked === 0) {
 return (
 <WidgetCard title={t('dashboard.myStocksBriefing')} icon={BellRing} iconColor="text-profit" iconBg="bg-transparent" iconSize="w-4 h-4"
 hideRefresh className="border-profit" titleClassName="text-base">
 <p className="text-xs text-muted-foreground text-center">{t('alerts.noAlerts')}</p>
 <Button asChild size="sm" variant="outline" className="gap-2 w-full">
 <Link href="/?ticker=COMI">
 <PlusCircle className="w-4 h-4" />
 {t('dashboard.myStocksBriefing')}
 </Link>
 </Button>
 </WidgetCard>
 );
 }

 // ─── Error state ────────────────────────────────────────────
 if (error || !briefing) {
 return (
 <WidgetError title={t('dashboard.myStocksBriefing')}
 message={error === 'auth_required' ? 'يلزم تسجيل الدخول.' : 'يرجى المحاولة مرة أخرى.'}
 onRetry={handleRefresh} className="border-loss/20" />
 );
 }
 // ─── Main content ───────────────────────────────────────────
 const { summary, stocks } = briefing;

 // Sort stocks by advice priority (exit_radar first, then stop_loss, take_profit, etc.).
 const sortedStocks = [...stocks].sort((a, b) => {
 const aP = a.advice ? (ADVICE_TYPE_INFO[a.advice.type]?.priority ?? 0) : 0;
 const bP = b.advice ? (ADVICE_TYPE_INFO[b.advice.type]?.priority ?? 0) : 0;
 return bP - aP;
 });

 const actionableStocks = sortedStocks.filter(s => s.advice && s.advice.type !== 'HOLD').slice(0, 5);
 const { alerts } = summary;
 const hasAlerts = alerts && alerts.total > 0;

 return (
 <WidgetCard title={t('dashboard.myStocksBriefing')} icon={BellRing} iconColor="text-profit" iconBg="bg-transparent" iconSize="w-4 h-4"
 className="border-profit" titleClassName="text-base"
 onRefresh={handleRefresh} refreshing={refreshing}
 badge={hasAlerts ? <Badge variant="outline" className="text-xs py-0 px-1.5 h-5 flex-shrink-0">{alerts.total > 9 ? '9+' : alerts.total}</Badge> : undefined}>
 {/* 1. Portfolio summary (Task 1) */}
 <PortfolioSummaryCard data={briefing} />

 {/* 2. Actionable alerts (Tasks 2, 3, 5) */}
 <div className="space-y-1.5">
 <div className="flex items-center justify-between" dir="rtl">
 <h4 className="text-xs font-semibold flex items-center gap-1.5">
 <AlertTriangle className={cn('w-3.5 h-3.5', hasAlerts ? 'text-warning' : 'text-muted-foreground')} />
 {t('alerts.alertsNeedDecision')}
 </h4>
 {hasAlerts && (
 <Badge variant="outline" className="text-xs py-0 px-1.5 h-5">
 {alerts.total}
 </Badge>
 )}
 </div>
 {actionableStocks.length === 0 ? (
 <div className="rounded-lg border bg-card p-3 text-xs text-muted-foreground text-center" dir="rtl">
 {t('alerts.noAlerts')}
 </div>
 ) : (
 <div className="space-y-1.5">
 {actionableStocks.map(stock => (
 <AlertCard key={stock.ticker} stock={stock} />
 ))}
 </div>
 )}
 </div>

 {/* 3. Personalized news (Task 4) */}
 <div className="space-y-1.5">
 <div className="flex items-center justify-between" dir="rtl">
 <h4 className="text-xs font-semibold flex items-center gap-1.5">
 <BookOpen className="w-3.5 h-3.5 text-primary" />
 {t('dashboard.latestNews')}
 </h4>
 {newsTickers.length > 0 && (
 <span className="text-xs text-muted-foreground">
 {newsTickers.length} سهم
 </span>
 )}
 </div>
 <NewsList news={news} />
 {news.length > 0 && (
 <button
 type="button"
 onClick={() => setCurrentView('news')}
 className="block w-full text-center text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline pt-0.5"
 dir="rtl"
 >
 عرض كل الأخبار
 </button>
 )}
 </div>

 {/* Footer: exit_radar cache age (transparency for Task 2) */}
 {summary.exit_radar_cache_age_seconds !== null && (
 <div className="text-xs text-muted-foreground/70 text-center pt-1 border-t border-border/30" dir="rtl">
 رادار الخروج آخر تحديث: {Math.round(summary.exit_radar_cache_age_seconds / 60)} دقيقة
 {summary.exit_radar_cache_age_seconds > 30 * 60 && ' (قديم — اتحدّث قريبًا)'}
 </div>
 )}
 </WidgetCard>
 );
}
