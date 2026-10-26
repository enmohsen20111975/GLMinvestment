/**
 * prediction-dashboard/DailyPicksPanel.tsx
 * =========================================
 * Task 4-b (Alpha A4) — Today's Daily Picks panel.
 *
 * Renders the picks returned by `/api/predictions/daily-picks` (one of the 3
 * endpoints B4 / Task 1-c / Bravo updated with `market_regime_info`).
 *
 * Behavior (per owner's HARD CONSTRAINTS):
 *  - When the backend returns 0 picks AND regime is DEFENSIVE/BEAR:
 *    show a clear NO_TRADE panel (NOT an empty table) with the suggested
 *    Arabic copy + the backend's `no_trade_reason`. Never fabricate picks.
 *  - When the backend returns picks (even during DEFENSIVE — a real approved
 *    exception): render them. Each pick shows its `decision` field
 *    transparently. NO_TRADE picks are NOT hidden — they render in a muted
 *    row with a "NO_TRADE" badge so the user sees what was considered but
 *    rejected (per owner's spec #5: transparency matters).
 *  - The frontend NEVER independently generates picks. Every pick rendered
 *    here came from the backend.
 *
 * UI structure:
 *  - Card header: title + date + count
 *  - Empty state (0 picks): NO_TRADE panel
 *  - Non-empty: compact responsive list (mobile + desktop)
 */

'use client';

import React from 'react';
import { Ban, Info, Loader2, RefreshCw, ShieldOff, Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, fmtPrice } from '@/lib/utils';
import type {
  DailyPickInfo,
  MarketRegimeInfo,
  PickDecision,
} from './types';

interface DailyPicksPanelProps {
 dailyPicks: DailyPickInfo[];
 marketRegimeInfo: MarketRegimeInfo | null;
 loading: boolean;
 error: string | null;
 date: string | null;
 onRefresh?: () => void;
}

// ── Per-pick decision styling ────────────────────────────────────────────────
// The `decision` field is set by the backend (B4 / Task 1-c). The frontend
// maps each known decision to a colored badge + Arabic label. Unknown values
// fall back to a neutral badge — they are never fabricated.
//
// NO indigo/blue. Palette: profit (green) / whale (teal) / warning (amber) /
// loss (red) / muted (neutral).
interface DecisionStyle {
 labelAr: string;
 badge: string; // bg + text + border classes
 rowAccent: string; // extra row styling for muted rows (NO_TRADE / HOLD)
}

const DECISION_STYLE: Record<PickDecision, DecisionStyle> = {
 BUY: {
 labelAr: 'شراء',
 badge: 'bg-profit/15 text-profit border-profit/30',
 rowAccent: '',
 },
 STRONG_BUY: {
 labelAr: 'شراء قوي',
 badge: 'bg-profit/20 text-profit border-profit/40 font-extrabold',
 rowAccent: 'bg-profit/[0.04]',
 },
 ACCUMULATE: {
 labelAr: 'تجميع',
 badge: 'bg-whale/15 text-whale border-whale/30',
 rowAccent: '',
 },
 HOLD: {
 labelAr: 'انتظار',
 badge: 'bg-muted text-muted-foreground border-border',
 rowAccent: 'opacity-70',
 },
 NO_TRADE: {
 labelAr: 'لا تداول',
 badge: 'bg-warning/15 text-warning border-warning/30',
 // Muted row — transparency: the pick was considered but the regime rejected it.
 rowAccent: 'opacity-60 bg-muted/20',
 },
 SELL: {
 labelAr: 'بيع',
 badge: 'bg-loss/15 text-loss border-loss/30',
 rowAccent: '',
 },
 STRONG_SELL: {
 labelAr: 'بيع قوي',
 badge: 'bg-loss/20 text-loss border-loss/40 font-extrabold',
 rowAccent: '',
 },
};

function resolveDecision(raw: string | undefined): PickDecision | null {
 if (!raw) return null;
 const r = raw.toString().toUpperCase().trim();
 if (r in DECISION_STYLE) return r as PickDecision;
 return null;
}

function isDefensiveRegime(info: MarketRegimeInfo | null): boolean {
 if (!info) return false;
 const r = (info.market_regime as string | undefined)?.toString().toUpperCase().trim();
 return r === 'DEFENSIVE' || r === 'BEAR';
}

// Suggested Arabic copy (owner's spec #7) — same as MarketRegimeBanner, kept
// in sync. Shown verbatim when there are 0 picks.
const NO_TRADE_HEADLINE_AR =
 'لا توجد فرص شراء مستوفية لشروط النظام حاليًا. الحفاظ على السيولة هو القرار المعتمد في هذه الحالة.';

// ── Main component ───────────────────────────────────────────────────────────
export function DailyPicksPanel({
 dailyPicks,
 marketRegimeInfo,
 loading,
 error,
 date,
 onRefresh,
}: DailyPicksPanelProps) {
 const defensive = isDefensiveRegime(marketRegimeInfo);
 const noTradeReason = (marketRegimeInfo?.no_trade_reason || '').trim();
 // NO_TRADE panel state — ONLY when there are 0 picks (DEFENSIVE + 0 picks,
 // or any regime + a non-empty no_trade_reason). When there ARE picks —
 // even all-NO_TRADE picks — we still render them in the list with muted
 // rows + NO_TRADE badges (transparency per owner's spec #5).
 const showNoTradeState = dailyPicks.length === 0 && (defensive || noTradeReason.length > 0);

 // ── Loading skeleton (first load only) ──
 if (loading && dailyPicks.length === 0) {
 return (
 <Card className="border border-border/60 shadow-md rounded-2xl overflow-hidden bg-card">
 <CardHeader className="p-4 border-b border-border/60">
 <div className="flex items-center justify-between gap-2">
 <CardTitle className="text-base font-black flex items-center gap-2">
 <Target className="w-5 h-5 text-profit" />
 توقعات اليوم
 </CardTitle>
 </div>
 </CardHeader>
 <CardContent className="p-4 space-y-2">
 <Skeleton className="h-12 w-full" />
 <Skeleton className="h-12 w-full" />
 <Skeleton className="h-12 w-full" />
 </CardContent>
 </Card>
 );
 }

 return (
 <Card className="border border-border/60 shadow-md rounded-2xl overflow-hidden bg-card">
 <CardHeader className="p-4 border-b border-border/60 space-y-1.5">
 <div className="flex items-center justify-between gap-2 flex-wrap">
 <CardTitle className="text-base font-black flex items-center gap-2">
 <Target className="w-5 h-5 text-profit" />
 توقعات اليوم ({dailyPicks.length})
 </CardTitle>
 <div className="flex items-center gap-2">
 {date ? (
 <span className="text-xs text-muted-foreground font-mono" dir="ltr">
 {date}
 </span>
 ) : null}
 {onRefresh ? (
 <Button
 variant="ghost"
 size="sm"
 onClick={onRefresh}
 disabled={loading}
 className="h-7 w-7 p-0"
 aria-label="تحديث توقعات اليوم"
 title="تحديث توقعات اليوم"
 >
 {loading ? (
 <Loader2 className="w-3.5 h-3.5 animate-spin" />
 ) : (
 <RefreshCw className="w-3.5 h-3.5" />
 )}
 </Button>
 ) : null}
 </div>
 </div>
 <p className="text-xs text-muted-foreground">
 مصدر التوقعات: الخادم فقط — لا يتم توليد أي توصية من الواجهة.
 </p>
 </CardHeader>

 <CardContent className="p-0">
 {showNoTradeState ? (
 // ── NO_TRADE panel (replaces the empty table) ──
 // Per owner spec: "Do NOT show fabricated picks. Do NOT show a 'loading'
 // spinner forever." We show the panel as soon as the fetch resolves with
 // 0 picks + a non-empty `no_trade_reason`.
 <NoTradePanel
 reason={noTradeReason}
 isDefensive={defensive}
 error={error}
 />
 ) : dailyPicks.length === 0 ? (
 // ── Neutral empty state (no fabricated picks) ──
 // 0 picks but no NO_TRADE signal either (e.g. regime is NORMAL but the
 // daily predictor hasn't run yet). We surface an honest empty state —
 // never a fabricated table.
 <div className="p-8 text-center space-y-2 text-muted-foreground">
 <Info className="w-8 h-8 mx-auto opacity-50" />
 <p className="text-sm font-bold text-foreground">لا توجد توقعات متاحة لليوم</p>
 <p className="text-xs">يتم تحديث التوقعات يوميًا من الخادم. حاول التحديث لاحقًا.</p>
 {error ? <p className="text-xs text-loss font-bold mt-1">{error}</p> : null}
 </div>
 ) : (
 // ── Picks list — render every pick (including NO_TRADE) transparently ──
 <DailyPicksList picks={dailyPicks} />
 )}
 </CardContent>
 </Card>
 );
}

// ── NO_TRADE panel (sub-component) ───────────────────────────────────────────
function NoTradePanel({
 reason,
 isDefensive,
 error,
}: {
 reason: string;
 isDefensive: boolean;
 error: string | null;
}) {
 return (
 <div
 className={cn(
 'p-6 space-y-3',
 isDefensive ? 'bg-warning/[0.06]' : 'bg-muted/30',
 )}
 >
 <div className="flex items-start gap-3">
 {isDefensive ? (
 <ShieldOff className="w-7 h-7 text-warning flex-shrink-0 mt-0.5" />
 ) : (
 <Ban className="w-7 h-7 text-muted-foreground flex-shrink-0 mt-0.5" />
 )}
 <div className="flex-1 space-y-2">
 <h3
 className={cn(
 'text-base font-black',
 isDefensive ? 'text-warning' : 'text-foreground',
 )}
 >
 لا توجد فرص شراء معتمدة اليوم
 </h3>
 <p className="text-sm font-bold text-foreground leading-relaxed">
 {NO_TRADE_HEADLINE_AR}
 </p>
 {reason ? (
 <div className="rounded-lg border border-border/60 bg-background/60 p-3 space-y-1">
 <span className="text-xs font-bold text-muted-foreground block">
 السبب الفني (من الخادم):
 </span>
 <p className="text-xs text-foreground leading-relaxed" dir="auto">
 {reason}
 </p>
 </div>
 ) : null}
 {error ? (
 <p className="text-xs text-loss font-bold mt-1">
 خطأ في الاتصال: {error}
 </p>
 ) : null}
 </div>
 </div>
 </div>
 );
}

// ── Daily picks list (sub-component) ─────────────────────────────────────────
function DailyPicksList({ picks }: { picks: DailyPickInfo[] }) {
 return (
 <div className="divide-y divide-border/40">
 {picks.map((pick, idx) => {
 const decision = resolveDecision(pick.decision as string);
 const style: DecisionStyle | null = decision ? DECISION_STYLE[decision] : null;
 const entryPrice = Number(pick.entry_price ?? 0);
 const targetPrice = Number(pick.target_price ?? 0);
 const stopLoss = Number(pick.stop_loss ?? 0);
 const riskReward = Number(pick.risk_reward ?? 0);
 const confidence = Number(pick.confidence ?? pick.master_score ?? 0);
 const isNoTrade = decision === 'NO_TRADE' || decision === 'HOLD';

 return (
 <div
 key={`dp-${pick.ticker}-${idx}`}
 className={cn(
 'p-3 flex items-center gap-3 hover:bg-muted/20 transition-colors',
 style?.rowAccent,
 )}
 >
 {/* Ticker + name */}
 <div className="flex-1 min-w-0 space-y-0.5">
 <div className="flex items-center gap-1.5 flex-wrap">
 <span className="font-mono font-black text-sm text-foreground">{pick.ticker}</span>
 {pick.morning_bell ? (
 <Badge className="bg-warning/20 text-warning border border-warning/20 text-[10px] py-0 px-1 font-bold">
 🔔 جرس
 </Badge>
 ) : null}
 {pick.evidence_count != null && pick.evidence_count > 0 ? (
 <Badge variant="outline" className="text-[10px] py-0 px-1 font-bold text-profit border-profit/20">
 ✅ {pick.evidence_count}/6
 </Badge>
 ) : null}
 {pick.kill_filter_result ? (
 <Badge variant="outline" className="text-[10px] py-0 px-1 font-bold text-muted-foreground border-border">
 {pick.kill_filter_result}
 </Badge>
 ) : null}
 </div>
 <p className="text-xs text-muted-foreground truncate">
 {pick.name_ar || pick.ticker}
 {pick.sector ? <span className="opacity-70"> · {pick.sector}</span> : null}
 </p>
 </div>

 {/* Prices */}
 <div className="hidden sm:flex flex-col text-xs font-mono gap-0.5 min-w-[140px]">
 <div className="flex items-center gap-2">
 <span className="text-muted-foreground">دخول:</span>
 <span className="font-bold text-foreground">{fmtPrice(entryPrice)}</span>
 </div>
 <div className="flex items-center gap-2">
 <span className="text-muted-foreground">هدف:</span>
 <span className="font-bold text-profit">{fmtPrice(targetPrice)}</span>
 <span className="text-muted-foreground">· وقف:</span>
 <span className="font-bold text-loss">{fmtPrice(stopLoss)}</span>
 </div>
 </div>

 {/* Compact: confidence + R:R (mobile-only subset) */}
 <div className="flex sm:hidden flex-col text-xs font-mono items-end gap-0.5">
 <span className="font-bold text-foreground">{fmtPrice(entryPrice)}</span>
 <span className="text-muted-foreground">R:R {riskReward.toFixed(2)}</span>
 </div>

 {/* R:R + confidence (desktop-only) */}
 <div className="hidden sm:flex flex-col items-end text-xs gap-0.5 min-w-[80px]">
 <span className="text-muted-foreground">R:R</span>
 <span className="font-bold text-foreground">{riskReward.toFixed(2)}</span>
 {confidence > 0 ? (
 <>
 <span className="text-muted-foreground">ثقة</span>
 <span className="font-bold text-foreground">{Math.round(confidence)}</span>
 </>
 ) : null}
 </div>

 {/* Decision badge — never hidden. NO_TRADE picks render in a muted row. */}
 <div className="flex-shrink-0 min-w-[90px] flex justify-end">
 <Badge
 className={cn(
 'text-xs font-bold border whitespace-nowrap',
 style?.badge ?? 'bg-muted text-muted-foreground border-border',
 )}
 title={isNoTrade ? 'لا تداول — تم اعتبار السهم لكن النظام رفضه' : undefined}
 >
 {decision ?? (pick.signal || '—')}
 {style ? ` · ${style.labelAr}` : ''}
 </Badge>
 </div>
 </div>
 );
 })}
 </div>
 );
}
