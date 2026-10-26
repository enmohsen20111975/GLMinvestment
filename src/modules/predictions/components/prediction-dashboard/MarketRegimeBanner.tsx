/**
 * prediction-dashboard/MarketRegimeBanner.tsx
 * ============================================
 * Task 4-b (Alpha A4) — Market Warning Banner.
 *
 * Renders the `market_regime_info` block that B4 (Task 1-c / Bravo) added to
 * `/api/predictions/daily-picks` (and the two other prediction endpoints).
 *
 * Owner HARD CONSTRAINTS honored:
 *  1. Regime comes FROM THE BACKEND (`market_regime_info`) — this component
 *     NEVER computes regime client-side. If `marketRegimeInfo` is null, it
 *     renders a neutral "regime unavailable" panel — NEVER a fabricated regime.
 *  2. NO hardcoded percentages. If the backend later sends an index-drop
 *     percentage, we'll render it; otherwise it's omitted entirely.
 *  3. The banner is DISPLAY-ONLY — it does NOT change trading decisions.
 *  4. NO indigo / blue colors — DEFENSIVE uses amber (warning palette),
 *     NORMAL uses neutral, AGGRESSIVE uses green (profit palette).
 *
 * UI structure:
 *  - Regime badge (colored): DEFENSIVE / NORMAL / AGGRESSIVE / BEAR + Arabic name
 *  - Last-update relative time ("آخر تحديث: منذ X دقيقة")
 *  - Reasons list (the Arabic bullets straight from the backend)
 *  - When `no_trade_reason` is non-empty: the suggested Arabic copy +
 *    the backend's reason text
 */

'use client';

import React from 'react';
import { AlertTriangle, Info, Loader2, RefreshCw, Shield, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { MarketRegimeInfo, MarketRegime } from './types';

interface MarketRegimeBannerProps {
 marketRegimeInfo: MarketRegimeInfo | null;
 loading: boolean;
 error: string | null;
 onRefresh?: () => void;
}

// ── Regime → visual config ──────────────────────────────────────────────────
// NO indigo / blue. DEFENSIVE/BEAR = amber (warning palette). NORMAL = neutral.
// AGGRESSIVE = green (profit palette). Unknown regimes fall back to neutral.
//
// Note: the regime value comes verbatim from the backend (B4). The Arabic names
// are presentation-layer only — the regime enum itself is owned by Python
// (`vps-service/analyzers/market_regime_engine.py`).
interface RegimeStyle {
 labelAr: string;
 icon: typeof Shield;
 cardClass: string; // card wrapper border/bg
 badgeClass: string; // regime badge bg/text
 accentText: string; // accent color for headings
 dotClass: string; // small status dot
}

const REGIME_STYLE: Record<MarketRegime, RegimeStyle> = {
 DEFENSIVE: {
 labelAr: 'دفاعي',
 icon: Shield,
 cardClass: 'border-warning/30 bg-warning/[0.06]',
 badgeClass: 'bg-warning/15 text-warning border-warning/30',
 accentText: 'text-warning',
 dotClass: 'bg-warning',
 },
 BEAR: {
 labelAr: 'هابط',
 icon: AlertTriangle,
 cardClass: 'border-loss/30 bg-loss/[0.06]',
 badgeClass: 'bg-loss/15 text-loss border-loss/30',
 accentText: 'text-loss',
 dotClass: 'bg-loss',
 },
 NORMAL: {
 labelAr: 'محايد',
 icon: TrendingUp,
 cardClass: 'border-border bg-muted/30',
 badgeClass: 'bg-muted text-muted-foreground border-border',
 accentText: 'text-foreground',
 dotClass: 'bg-muted-foreground',
 },
 AGGRESSIVE: {
 labelAr: 'هجومي',
 icon: TrendingUp,
 cardClass: 'border-profit/30 bg-profit/[0.06]',
 badgeClass: 'bg-profit/15 text-profit border-profit/30',
 accentText: 'text-profit',
 dotClass: 'bg-profit',
 },
};

function resolveRegime(raw: string | undefined): MarketRegime | null {
 if (!raw) return null;
 const r = raw.toUpperCase().trim();
 if (r === 'DEFENSIVE' || r === 'BEAR' || r === 'NORMAL' || r === 'AGGRESSIVE') {
 return r;
 }
 return null;
}

// Localized relative time ("آخر تحديث: منذ X دقيقة"). Mirrors the logic in
// `src/components/shared/ui/DateText.tsx::relativeTime()` — duplicated here so
// the banner doesn't pull in another React tree just for one string.
function formatRelativeArabic(isoTs: string): string {
 if (!isoTs) return '—';
 const d = new Date(isoTs);
 if (isNaN(d.getTime())) return '—';
 const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
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

// Suggested Arabic copy (owner's spec #7). Shown verbatim — never edited,
// never templated with hardcoded percentages. The backend's `no_trade_reason`
// is appended separately so the user sees BOTH the official copy + the
// machine-generated reason.
const NO_TRADE_HEADLINE_AR =
 'لا توجد فرص شراء مستوفية لشروط النظام حاليًا. الحفاظ على السيولة هو القرار المعتمد في هذه الحالة.';

export function MarketRegimeBanner({
 marketRegimeInfo,
 loading,
 error,
 onRefresh,
}: MarketRegimeBannerProps) {
 // ── Loading skeleton — only on first load when we have no regime yet ──
 if (loading && !marketRegimeInfo) {
 return (
 <Card className="border border-border/60 bg-muted/30 rounded-2xl">
 <CardContent className="p-4 flex items-center gap-3">
 <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
 <div className="flex-1 space-y-1">
 <p className="text-sm font-bold text-muted-foreground">جارٍ تحميل حالة السوق…</p>
 <p className="text-xs text-muted-foreground/70">يتم قراءة حالة النظام من الخادم</p>
 </div>
 </CardContent>
 </Card>
 );
 }

 // ── Backend unreachable / regime missing — NEUTRAL panel, never fabricated ──
 // Per HARD CONSTRAINT #1: if the backend doesn't supply a regime, the
 // frontend must NOT guess. We surface an honest "regime unavailable" state.
 if (!marketRegimeInfo) {
 return (
 <Card className="border border-border/60 bg-muted/30 rounded-2xl">
 <CardContent className="p-4 flex items-start gap-3">
 <Info className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
 <div className="flex-1 space-y-1">
 <p className="text-sm font-bold text-foreground">حالة السوق غير متاحة حاليًا</p>
 <p className="text-xs text-muted-foreground">
 تعذّر الحصول على حالة النظام من الخادم. لا يتم توليد أي توصية شراء من الواجهة — القرار يأتي من الخادم فقط.
 </p>
 {error ? (
 <p className="text-xs text-loss font-bold mt-1">{error}</p>
 ) : null}
 </div>
 {onRefresh ? (
 <Button
 variant="outline"
 size="sm"
 onClick={onRefresh}
 disabled={loading}
 className="h-8 text-xs font-bold gap-1 flex-shrink-0"
 >
 {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
 تحديث
 </Button>
 ) : null}
 </CardContent>
 </Card>
 );
 }

 const regime = resolveRegime(marketRegimeInfo.market_regime as string);
 const style: RegimeStyle | null = regime ? REGIME_STYLE[regime] : null;
 const Icon = style?.icon ?? Info;
 const reasons: string[] = Array.isArray(marketRegimeInfo.market_regime_reasons)
 ? marketRegimeInfo.market_regime_reasons.filter((r) => typeof r === 'string' && r.trim().length > 0)
 : [];
 const noTradeReason: string = (marketRegimeInfo.no_trade_reason || '').trim();
 const isDefensive = regime === 'DEFENSIVE' || regime === 'BEAR';

 return (
 <Card
 className={cn(
 'rounded-2xl border shadow-sm overflow-hidden',
 style?.cardClass ?? 'border-border bg-muted/30',
 )}
 >
 <CardContent className="p-4 space-y-3">
 {/* ─── Header row: regime badge + last update ─── */}
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div className="flex items-center gap-2 flex-wrap">
 <span
 className={cn(
 'inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0',
 style?.badgeClass ?? 'bg-muted text-muted-foreground border border-border',
 )}
 aria-hidden
 >
 <Icon className="w-4 h-4" />
 </span>
 <div className="flex items-center gap-1.5">
 <span className={cn('w-2 h-2 rounded-full', style?.dotClass ?? 'bg-muted-foreground')} />
 <Badge
 className={cn(
 'font-bold text-xs border',
 style?.badgeClass ?? 'bg-muted text-muted-foreground border-border',
 )}
 >
 {regime ?? 'حالة غير معروفة'}
 </Badge>
 <span className="text-xs font-bold text-foreground">
 {style?.labelAr ?? marketRegimeInfo.market_regime}
 </span>
 </div>
 {/* Source provenance — display-only; lets the user see this came from the backend */}
 {marketRegimeInfo.market_regime_source ? (
 <span className="text-[10px] text-muted-foreground/70 font-mono" dir="ltr">
 src: {marketRegimeInfo.market_regime_source}
 </span>
 ) : null}
 </div>

 <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
 <span>آخر تحديث: {formatRelativeArabic(marketRegimeInfo.market_regime_last_update)}</span>
 {onRefresh ? (
 <Button
 variant="ghost"
 size="sm"
 onClick={onRefresh}
 disabled={loading}
 className="h-6 w-6 p-0"
 aria-label="تحديث حالة السوق"
 title="تحديث حالة السوق"
 >
 {loading ? (
 <Loader2 className="w-3 h-3 animate-spin" />
 ) : (
 <RefreshCw className="w-3 h-3" />
 )}
 </Button>
 ) : null}
 </div>
 </div>

 {/* ─── Reasons list (already-localized bullets from the backend) ─── */}
 {reasons.length > 0 ? (
 <ul className="text-xs text-muted-foreground space-y-1 list-disc pr-4">
 {reasons.map((r, i) => (
 <li key={`reason-${i}`}>{r}</li>
 ))}
 </ul>
 ) : (
 <p className="text-xs text-muted-foreground/70">
 لا توجد أسباب تفصيلية مرسلة من الخادم لحالة النظام الحالية.
 </p>
 )}

 {/* ─── NO_TRADE block — only when the backend explicitly says so ─── */}
 {/* The banner itself does NOT change trading decisions. The decision is
 owned by the backend (B4). The banner just surfaces it to the user. */}
 {noTradeReason ? (
 <div
 className={cn(
 'rounded-xl border p-3 space-y-1.5',
 isDefensive
 ? 'border-warning/30 bg-warning/[0.08]'
 : 'border-border bg-muted/40',
 )}
 >
 <div className="flex items-center gap-2">
 <AlertTriangle className={cn('w-4 h-4 flex-shrink-0', isDefensive ? 'text-warning' : 'text-muted-foreground')} />
 <span
 className={cn(
 'text-sm font-black',
 isDefensive ? 'text-warning' : 'text-foreground',
 )}
 >
 لا توجد فرص شراء معتمدة اليوم
 </span>
 </div>
 <p className="text-xs font-bold text-foreground leading-relaxed">{NO_TRADE_HEADLINE_AR}</p>
 <p className="text-xs text-muted-foreground leading-relaxed">
 <span className="font-bold">السبب الفني: </span>
 <span dir="auto">{noTradeReason}</span>
 </p>
 </div>
 ) : null}
 </CardContent>
 </Card>
 );
}
