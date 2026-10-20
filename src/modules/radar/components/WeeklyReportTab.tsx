'use client';

// ============================================================================
// WeeklyReportTab — التقرير الأسبوعي للرادار
// ============================================================================
// L2-WEEKLY-RADAR-REPORT: A weekly PDF + image report for subscribers.
// Sent every Sunday at 08:00 Cairo time via Telegram. Shows:
// 1. Top 5 stocks for the upcoming week (from radar cache)
// 2. Performance summary of last week's radar picks
// 3. "Stock of the Week" — highest-conviction pick with full analysis
// 4. Market regime (DEFENSIVE/NORMAL/AGGRESSIVE)
// 5. Sector heatmap (top 5 sectors by avg change %)
//
// Data source:
// GET /api/radar/weekly-report?market=EGX → JSON payload (instant <50ms)
// GET /api/radar/weekly-report/pdf?market=EGX → PDF download
//
// The component auto-refreshes every 5 minutes while visible (it doesn't
// need to be more frequent — the report is weekly). All UI is RTL Arabic,
// shadcn-based. Includes a "Download PDF" button + a subscribe CTA.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import {
 Calendar, Download, Star, TrendingUp, TrendingDown,
 RefreshCw, FileText, Bell, Sparkles, BarChart3, Activity,
 Target, Shield, ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { useVisibilityAwarePolling } from '@/hooks/useVisibilityAwarePolling';
// P0-COMPONENT-UNIFICATION Phase 2.7: canonical fmtPrice from '@/lib/utils'
import { fmtPrice } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n-context';
import { OFFICIAL_LINKS } from '@/modules/publishing/lib/official-links';
import type { MarketType } from '@/lib/store';

// ============================================================================
// Types — Weekly Report API contract
// ============================================================================
interface StockOfWeek {
 ticker: string;
 path?: string;
 path_ar?: string;
 current_price?: number;
 target_1?: number;
 target_2?: number;
 stop_loss?: number;
 target_1_pct?: number;
 stop_loss_pct?: number;
 signal_count?: number;
 risk_reward?: number;
 reason?: string;
}

interface Top5Stock {
 ticker: string;
 path?: string;
 path_ar?: string;
 current_price?: number;
 signal_count?: number;
 volume_ratio_10d_vs_20d?: number;
 reason?: string;
}

interface LastWeekStock {
 ticker: string;
 entry_price: number;
 entry_date?: string;
 current_price: number | null;
 return_pct: number | null;
 status: 'win' | 'loss' | 'flat' | 'no_data';
 status_emoji: string;
}

interface LastWeekPerformance {
 stocks: LastWeekStock[];
 avg_return_pct: number;
 win_count: number;
 total_count: number;
 win_rate_pct: number;
}

interface SectorInfo {
 sector: string;
 stocks_count: number;
 avg_change_pct: number;
 direction: 'inflow' | 'outflow' | 'neutral';
 color: string;
 emoji: string;
}

interface MarketRegime {
 regime: string;
 regime_ar?: string;
 last_update?: string | null;
 confidence?: number | null;
 reasons?: string[];
 source?: string;
}

interface WeeklyReportData {
 generated_at: string;
 market: string;
 week_number: number;
 year: number;
 week_start: string;
 week_end: string;
 week_start_ar?: string;
 week_end_ar?: string;
 market_regime: MarketRegime;
 stock_of_week: StockOfWeek | null;
 top_5: Top5Stock[];
 last_week_performance: LastWeekPerformance;
 sector_heatmap: SectorInfo[];
 db_source?: string | null;
 radar_cache_found?: boolean;
 tracking_count?: number;
 official_links?: Record<string, string>;
}

interface WeeklyReportResponse {
 success: boolean;
 cached?: boolean;
 cache_age_seconds?: number | null;
 cache_stale?: boolean;
 warmup_running?: boolean;
 cache_generated_at?: string | null;
 market?: string;
 report?: WeeklyReportData;
 warming_up?: boolean;
 error?: string;
 warning?: string;
}

interface WeeklyReportTabProps {
 market: MarketType | string;
}

// ============================================================================
// Regime styling — colors + Arabic labels for DEFENSIVE/NORMAL/AGGRESSIVE
// ============================================================================
const REGIME_STYLES: Record<string, { color: string; bg: string; border: string; emoji: string }> = {
 DEFENSIVE: {
 color: 'text-loss ',
 bg: 'bg-loss/10',
 border: 'border-loss ',
 emoji: '🛡️',
 },
 NORMAL: {
 color: 'text-warning ',
 bg: 'bg-warning/10',
 border: 'border-warning ',
 emoji: '⚖️',
 },
 AGGRESSIVE: {
 color: 'text-profit ',
 bg: 'bg-profit/10',
 border: 'border-profit ',
 emoji: '',
 },
};

// ============================================================================
// Helpers
// ============================================================================
// P0-COMPONENT-UNIFICATION Phase 2.7: removed local fmtPrice — now imported from '@/lib/utils'.
// (was: function fmtPrice(n?: number | null) { if (n == null || isNaN(n)) return '—'; return (n ?? 0).toFixed(2); })

function fmtPct(n?: number | null, withSign = true): string {
 if (n == null || Number.isNaN(n)) return '—';
 const sign = withSign && n > 0 ? '+' : '';
 return `${sign}${(n ?? 0).toFixed(1)}%`;
}

function fmtPctPlain(n?: number | null): string {
 if (n == null || Number.isNaN(n)) return '0.0';
 return (n ?? 0).toFixed(1);
}

// Note: regime Arabic label is now resolved via i18n at render time via
// t(`radar.weekly.regimes.${regime}`) — falls back to the raw regime string.

// ============================================================================
// WeeklyReportTab — main component
// ============================================================================
export function WeeklyReportTab({ market }: WeeklyReportTabProps) {
 const t = useTranslation();
 const [data, setData] = useState<WeeklyReportResponse | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [warmingUp, setWarmingUp] = useState(false);
 const [regenerating, setRegenerating] = useState(false);

 // CRYPTO / GOLD fallback to EGX (no dedicated crypto/gold radar data)
 const effectiveMarket =
 market === 'CRYPTO' || market === 'GOLD' ? 'EGX' : String(market || 'EGX');

 const fetchData = useCallback(async (showLoading = true) => {
 if (showLoading) setLoading(true);
 setError(null);
 try {
 const res = await fetch(
 `/api/radar/weekly-report?market=${encodeURIComponent(effectiveMarket)}`,
 { cache: 'no-store' },
 );
 const json: WeeklyReportResponse = await res.json();
 if (json.success) {
 setData(json);
 setWarmingUp(false);
 } else if (json.warming_up) {
 setWarmingUp(true);
 setData(null);
 // Retry in 15s — the background warmup should finish quickly.
 setTimeout(() => fetchData(false), 15_000);
 } else {
 setError(json.error || t('radar.weekly.loadFailed'));
 setData(null);
 }
 } catch (e) {
 setError(e instanceof Error ? e.message : t('radar.weekly.connectionError'));
 setData(null);
 } finally {
 if (showLoading) setLoading(false);
 }
 }, [effectiveMarket]);

 useEffect(() => { fetchData(); }, [fetchData]);

 // Poll every 5 minutes when the tab is visible — the report is weekly,
 // so we don't need to poll more frequently.
 useVisibilityAwarePolling(() => fetchData(false), 5 * 60 * 1000);

 const handleRefresh = async () => {
 setRegenerating(true);
 try {
 // Trigger synchronous regeneration via POST
 await fetch(
 `/api/radar/weekly-report?market=${encodeURIComponent(effectiveMarket)}`,
 { method: 'POST' },
 );
 await fetchData(false);
 } catch {
 // ignore — best-effort
 } finally {
 setRegenerating(false);
 }
 };

 const handleDownloadPdf = () => {
 // Open the PDF in a new tab — the browser handles the download.
 const url = `/api/radar/weekly-report/pdf?market=${encodeURIComponent(effectiveMarket)}`;
 window.open(url, '_blank', 'noopener,noreferrer');
 };

 // ============================================================================
 // Loading state
 // ============================================================================
 if (loading && !data) {
 return (
 <Card className="p-4">
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <FileText className="h-5 w-5 text-profit animate-pulse" />
 <h3 className="text-base font-semibold">{t('radar.weekly.title')}</h3>
 </div>
 <Skeleton className="h-6 w-32" />
 </div>
 <Skeleton className="h-8 w-full mb-2" />
 <Skeleton className="h-8 w-full mb-2" />
 <Skeleton className="h-8 w-full mb-2" />
 <Skeleton className="h-8 w-full" />
 </Card>
 );
 }

 // ============================================================================
 // Warming-up state (first request — cache being populated)
 // ============================================================================
 if (warmingUp && !data) {
 return (
 <Card className="p-8 text-center">
 <div className="flex flex-col items-center gap-3">
 <div className="h-12 w-12 rounded-full bg-profit/10 flex items-center justify-center">
 <FileText className="h-6 w-6 text-profit animate-pulse" />
 </div>
 <div>
 <h3 className="text-base font-semibold mb-1">{t('radar.weekly.loading')}</h3>
 <p className="text-sm text-muted-foreground">
 {t('radar.weekly.warmingUp')}
 </p>
 </div>
 </div>
 </Card>
 );
 }

 // ============================================================================
 // Error state
 // ============================================================================
 if (error && !data) {
 return (
 <Card className="p-4 border-dashed border-loss ">
 <div className="flex items-center gap-2 text-sm text-loss ">
 <AlertTriangle className="h-4 w-4" />
 <span>{t('radar.weekly.errorPrefix', { error })}</span>
 </div>
 <Button variant="outline" size="sm" className="mt-3" onClick={() => fetchData()}>
 <RefreshCw className="h-4 w-4 ml-2" />
 {t('radar.weekly.retry')}
 </Button>
 </Card>
 );
 }

 // Re-import here because it's used only in the render path above.
 function AlertTriangle({ className }: { className?: string }) {
 return <span className={className}>⚠️</span>;
 }

 const report = data?.report;
 if (!report) {
 return (
 <Card className="p-4">
 <div className="text-sm text-muted-foreground">{t('radar.weekly.noData')}</div>
 </Card>
 );
 }

 const regimeStyle = REGIME_STYLES[report.market_regime?.regime || 'NORMAL'] || REGIME_STYLES.NORMAL;
 const sow = report.stock_of_week;
 const top5 = report.top_5 || [];
 const perf = report.last_week_performance;
 const sectors = report.sector_heatmap || [];

 // ============================================================================
 // Main render
 // ============================================================================
 return (
 <div className="space-y-4">
 {/* ─── Header ─────────────────────────────────────────────────── */}
 <Card className="overflow-hidden">
 <CardHeader className={`pb-3 ${regimeStyle.bg} ${regimeStyle.border} border-b`}>
 <div className="flex items-start justify-between flex-wrap gap-2">
 <div>
 <CardTitle className="flex items-center gap-2 text-lg">
 <FileText className="h-5 w-5 text-profit " />
 <span>{t('radar.weekly.title')}</span>
 </CardTitle>
 <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
 <Calendar className="h-4 w-4" />
 <span>{t('radar.weekly.weekLabel', { week: report.week_number, year: report.year })}</span>
 <span className="text-muted-foreground/50">|</span>
 <span>{report.week_start_ar || report.week_start} — {report.week_end_ar || report.week_end}</span>
 </div>
 </div>
 <div className="flex items-center gap-2">
 <Button
 size="sm"
 variant="outline"
 onClick={handleRefresh}
 disabled={regenerating}
 >
 <RefreshCw className={`h-4 w-4 ml-1 ${regenerating ? 'animate-spin' : ''}`} />
 {regenerating ? t('radar.weekly.regenerating') : t('radar.weekly.regenerate')}
 </Button>
 <Button
 size="sm"
 onClick={handleDownloadPdf}
 >
 <Download className="h-4 w-4 ml-1" />
 {t('radar.weekly.downloadPdf')}
 </Button>
 </div>
 </div>
 </CardHeader>
 <CardContent className="pt-3">
 {/* Regime badge */}
 <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${regimeStyle.bg} ${regimeStyle.color} ${regimeStyle.border} border`}>
 <span className="text-base">{regimeStyle.emoji}</span>
 <span className="text-sm font-semibold">{t('radar.weekly.regimeLabel', { regime: report.market_regime?.regime || 'NORMAL' })}</span>
 <span className="text-xs opacity-80">({report.market_regime?.regime_ar || t(`radar.weekly.regimes.${report.market_regime?.regime || 'NORMAL'}`)})</span>
 </div>
 {report.market_regime?.reasons && report.market_regime.reasons.length > 0 && (
 <div className="mt-2 text-xs text-muted-foreground">
 <Sparkles className="inline h-3 w-3 ml-1" />
 {report.market_regime.reasons.slice(0, 2).join(' • ')}
 </div>
 )}
 </CardContent>
 </Card>

 {/* ─── Stock of the Week ─────────────────────────────────────── */}
 <Card className="border-profit ">
 <CardHeader className="pb-3 bg-profit/10 /20">
 <CardTitle className="flex items-center gap-2 text-base">
 <Star className="h-5 w-5 text-warning fill-warning" />
 <span>{t('radar.weekly.stockOfWeek.title')}</span>
 </CardTitle>
 </CardHeader>
 <CardContent className="pt-4">
 {sow ? (
 <div className="space-y-4">
 {/* Ticker + path */}
 <div className="flex items-center justify-between flex-wrap gap-2">
 <div className="flex items-center gap-3">
 <span className="text-2xl font-bold text-profit ">
 {sow.ticker}
 </span>
 <Badge variant="outline" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 ">
 {sow.path_ar || sow.path || '—'}
 </Badge>
 </div>
 <div className="text-left">
 <div className="text-xs text-muted-foreground">{t('radar.weekly.stockOfWeek.currentPrice')}</div>
 <div className="text-lg font-bold">{fmtPrice(sow.current_price)}</div>
 </div>
 </div>

 {/* Targets + stop loss */}
 <div className="grid grid-cols-3 gap-2 text-center">
 <div className="rounded-lg border border-profit p-2">
 <div className="text-xs text-muted-foreground">{t('radar.weekly.stockOfWeek.target1')}</div>
 <div className="text-base font-bold text-profit ">
 {fmtPrice(sow.target_1)}
 </div>
 <div className="text-xs text-profit">
 +{fmtPctPlain(sow.target_1_pct)}%
 </div>
 </div>
 <div className="rounded-lg border border-primary p-2">
 <div className="text-xs text-muted-foreground">{t('radar.weekly.stockOfWeek.target2')}</div>
 <div className="text-base font-bold text-primary ">
 {fmtPrice(sow.target_2)}
 </div>
 <div className="text-xs text-primary">
 {sow.target_2 && sow.current_price
 ? `+${((sow.target_2 / sow.current_price - 1) * 100).toFixed(1)}%`
 : '—'}
 </div>
 </div>
 <div className="rounded-lg border border-loss p-2">
 <div className="text-xs text-muted-foreground">{t('radar.weekly.stockOfWeek.stopLoss')}</div>
 <div className="text-base font-bold text-loss ">
 {fmtPrice(sow.stop_loss)}
 </div>
 <div className="text-xs text-loss">
 {fmtPct(sow.stop_loss_pct)}
 </div>
 </div>
 </div>

 {/* Signal strength + R/R */}
 <div className="flex items-center justify-between gap-2">
 <div className="flex items-center gap-2">
 <Activity className="h-4 w-4 text-warning" />
 <span className="text-sm">{t('radar.weekly.stockOfWeek.signalStrength')}</span>
 <span className="text-sm font-bold">
 {sow.signal_count || 0}/6
 </span>
 <span className="text-warning">
 {'⭐'.repeat(Math.min(5, sow.signal_count || 0))}
 </span>
 </div>
 {sow.risk_reward != null && (
 <div className="text-sm">
 <span className="text-muted-foreground">R/R: </span>
 <span className="font-bold text-primary ">
 {(sow.risk_reward ?? 0).toFixed(2)}
 </span>
 </div>
 )}
 </div>

 {/* Reason */}
 {sow.reason && (
 <div className="rounded-lg bg-muted/40 p-3 text-sm">
 <div className="font-semibold mb-1 flex items-center gap-1">
 <Sparkles className="h-3.5 w-3.5 text-warning" />
 {t('radar.weekly.stockOfWeek.reason')}
 </div>
 <p className="text-muted-foreground">{sow.reason}</p>
 </div>
 )}
 </div>
 ) : (
 <div className="text-sm text-muted-foreground py-4 text-center">
 {t('radar.weekly.stockOfWeek.empty')}
 </div>
 )}
 </CardContent>
 </Card>

 {/* ─── Top 5 stocks ───────────────────────────────────────────── */}
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-2 text-base">
 <Target className="h-5 w-5 text-primary " />
 <span>{t('radar.weekly.top5.title')}</span>
 </CardTitle>
 </CardHeader>
 <CardContent className="pt-3">
 {top5.length > 0 ? (
 <div className="space-y-2">
 {top5.map((s, i) => (
 <div
 key={s.ticker}
 className="flex items-center justify-between p-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors"
 >
 <div className="flex items-center gap-3">
 <span className="text-base font-bold text-muted-foreground w-6">
 {i + 1}.
 </span>
 <div>
 <div className="font-bold">{s.ticker}</div>
 <div className="text-xs text-muted-foreground">
 {s.path_ar || s.path || '—'}
 </div>
 </div>
 </div>
 <div className="flex items-center gap-3 text-sm">
 {s.signal_count != null && s.signal_count > 0 && (
 <Badge variant="outline" className="text-xs">
 {s.signal_count}/6
 </Badge>
 )}
 <span className="font-mono">{fmtPrice(s.current_price)}</span>
 {s.volume_ratio_10d_vs_20d != null && (
 <span className="text-xs text-muted-foreground">
 {(s.volume_ratio_10d_vs_20d ?? 0).toFixed(2)}×
 </span>
 )}
 </div>
 </div>
 ))}
 </div>
 ) : (
 <div className="text-sm text-muted-foreground py-4 text-center">
 {t('radar.weekly.top5.empty')}
 </div>
 )}
 </CardContent>
 </Card>

 {/* ─── Last week performance ──────────────────────────────────── */}
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-2 text-base">
 <BarChart3 className="h-5 w-5 text-warning " />
 <span>{t('radar.weekly.lastWeek.title')}</span>
 </CardTitle>
 </CardHeader>
 <CardContent className="pt-3">
 {perf && perf.stocks && perf.stocks.length > 0 ? (
 <div className="space-y-3">
 {/* Summary stats */}
 <div className="grid grid-cols-3 gap-2 text-center">
 <div className="rounded-lg border border-muted p-2">
 <div className="text-xs text-muted-foreground">{t('radar.weekly.lastWeek.avgReturn')}</div>
 <div className={`text-base font-bold ${perf.avg_return_pct >= 0 ? 'text-profit' : 'text-loss'}`}>
 {fmtPct(perf.avg_return_pct)}
 </div>
 </div>
 <div className="rounded-lg border border-muted p-2">
 <div className="text-xs text-muted-foreground">{t('radar.weekly.lastWeek.winRatio')}</div>
 <div className="text-base font-bold text-primary ">
 {perf.win_count}/{perf.total_count}
 </div>
 </div>
 <div className="rounded-lg border border-muted p-2">
 <div className="text-xs text-muted-foreground">{t('radar.weekly.lastWeek.winRate')}</div>
 <div className="text-base font-bold text-profit ">
 {(perf.win_rate_pct ?? 0).toFixed(0)}%
 </div>
 </div>
 </div>
 <Progress value={perf.win_rate_pct} className="h-2" />

 {/* Stocks list */}
 <div className="space-y-1.5 mt-3">
 {perf.stocks.map((s, i) => (
 <div
 key={`${s.ticker}-${i}`}
 className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/40 transition-colors"
 >
 <div className="flex items-center gap-2">
 <span className="text-base">{s.status_emoji}</span>
 <span className="font-bold">{s.ticker}</span>
 </div>
 <div className="flex items-center gap-2 text-xs">
 <span className="text-muted-foreground">
 {t('radar.weekly.lastWeek.enteredAt', { price: fmtPrice(s.entry_price) })}
 </span>
 <span className="text-muted-foreground/50">→</span>
 <span className="font-mono">{fmtPrice(s.current_price)}</span>
 {s.return_pct != null && (
 <Badge
 variant="outline"
 className={
 s.return_pct > 0
 ? 'text-profit '
 : s.return_pct < 0
 ? 'text-loss '
 : ''
 }
 >
 {fmtPct(s.return_pct)}
 </Badge>
 )}
 </div>
 </div>
 ))}
 </div>
 </div>
 ) : (
 <div className="text-sm text-muted-foreground py-4 text-center">
 {t('radar.weekly.lastWeek.empty')}
 <br />
 <span className="text-xs">{t('radar.weekly.lastWeek.emptyHint')}</span>
 </div>
 )}
 </CardContent>
 </Card>

 {/* ─── Sector heatmap ────────────────────────────────────────── */}
 {sectors.length > 0 && (
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center gap-2 text-base">
 <BarChart3 className="h-5 w-5 text-violet-600 dark:text-violet-400" />
 <span>{t('radar.weekly.sectors.title')}</span>
 </CardTitle>
 </CardHeader>
 <CardContent className="pt-3">
 <div className="space-y-1.5">
 {sectors.map((sec, i) => (
 <div
 key={`${sec.sector}-${i}`}
 className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/40 transition-colors"
 >
 <div className="flex items-center gap-2">
 <span className="text-base">{sec.emoji}</span>
 <span className="font-medium">{sec.sector}</span>
 <span className="text-xs text-muted-foreground">
 {t('radar.weekly.sectors.stockCount', { count: sec.stocks_count })}
 </span>
 </div>
 <div className="flex items-center gap-2">
 <Badge
 variant="outline"
 className={
 sec.avg_change_pct > 0
 ? 'text-profit border-profit '
 : sec.avg_change_pct < 0
 ? 'text-loss border-loss '
 : 'text-warning border-warning '
 }
 >
 {sec.avg_change_pct > 0 ? (
 <TrendingUp className="h-3 w-3 ml-1" />
 ) : sec.avg_change_pct < 0 ? (
 <TrendingDown className="h-3 w-3 ml-1" />
 ) : null}
 {fmtPct(sec.avg_change_pct)}
 </Badge>
 </div>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>
 )}

 {/* ─── Subscribe CTA ─────────────────────────────────────────── */}
 <Card className="border-2 border-dashed border-profit bg-profit/10 /10">
 <CardContent className="p-4 text-center">
 <div className="flex items-center justify-center gap-2 mb-2">
 <Bell className="h-5 w-5 text-profit " />
 <h3 className="text-base font-semibold">{t('radar.weekly.subscribe.title')}</h3>
 </div>
 <p className="text-sm text-muted-foreground mb-3">
 {t('radar.weekly.subscribe.body')}
 </p>
 <div className="flex items-center justify-center gap-2 flex-wrap">
 <a
 href={OFFICIAL_LINKS.telegram}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-1 text-sm text-profit hover:underline"
 >
 <ExternalLink className="h-3.5 w-3.5" />
 {t('radar.weekly.subscribe.telegram')}
 </a>
 <span className="text-muted-foreground">|</span>
 <a
 href={OFFICIAL_LINKS.website}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-1 text-sm text-profit hover:underline"
 >
 <ExternalLink className="h-3.5 w-3.5" />
 {t('radar.weekly.subscribe.website')}
 </a>
 <span className="text-muted-foreground">|</span>
 <a
 href={OFFICIAL_LINKS.android}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-1 text-sm text-profit hover:underline"
 >
 <ExternalLink className="h-3.5 w-3.5" />
 {t('radar.weekly.subscribe.android')}
 </a>
 </div>
 </CardContent>
 </Card>

 {/* ─── Footer with disclaimer ────────────────────────────────── */}
 <div className="text-center text-xs text-muted-foreground">
 <Shield className="inline h-3 w-3 ml-1" />
 {t('radar.weekly.footer.disclaimer')}
 <br />
 <span className="opacity-60">
 {t('radar.weekly.footer.lastUpdate')} {data?.cache_generated_at
 ? new Date(data.cache_generated_at).toLocaleString('ar-EG')
 : '—'}
 </span>
 </div>
 </div>
 );
}

export default WeeklyReportTab;
