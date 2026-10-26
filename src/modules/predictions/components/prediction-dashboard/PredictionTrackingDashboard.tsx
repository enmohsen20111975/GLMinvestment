/**
 * prediction-dashboard/PredictionTrackingDashboard.tsx (container)
 * ===============================================================
 * Thin orchestrator. Owns:
 *  - The `usePredictionTrackingState(market)` hook call (delegates all state
 *    + fetches + derived memos).
 *  - The "verify pending" async handler (calls /api/predictions/honest-tracking/verify-pending).
 *  - The render layout: <HeaderBar /> + <KpiCards /> + <PersonaCards /> +
 *    <FocusStocksBanner /> + <CumulativeProfitChart /> + <ProofTableCard /> +
 *    <ProofModal />.
 *
 * Sub-modules live in this folder:
 *  - types.ts                          (all interfaces + union types)
 *  - constants.ts                      (PERSONA_CONFIG, OUTCOME_CONFIG, etc.)
 *  - helpers.ts                        (format/compute/generate utilities)
 *  - usePredictionTrackingState.ts     (the big state hook)
 *  - desktopColumns.tsx                (UnifiedTable column factory)
 *  - HeaderBar.tsx                     (luxury header + filters)
 *  - KpiCards.tsx                      (5 hero KPI cards)
 *  - PersonaCards.tsx                  (persona breakdown cards)
 *  - FocusStocksBanner.tsx             (focus tickers banner)
 *  - CumulativeProfitChart.tsx         (recharts BarChart)
 *  - MobilePredictionCard.tsx          (mobile card row)
 *  - ProofTableCard.tsx                (table card with toolbar + table/mobile)
 *  - ProofModal.tsx                    (proof modal dialog)
 *
 * Total container LOC: ~135 (well under the <500 LOC constraint).
 */

'use client';

/**
 * PredictionTrackingDashboard (متابعة التوقعات وإثبات صحة الصفقات)
 * -----------------------------------------------------------------------------
 * لوحة تحكم تعتمد على بيانات حقيقية وموثقة من Python backend.
 * توفر إثباتات شفافة ومباشرة على صحة صفقات المنصة.
 */

import React, { useCallback } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { usePredictionTrackingState } from './usePredictionTrackingState';
import { HeaderBar } from './HeaderBar';
import { KpiCards } from './KpiCards';
import { PersonaCards } from './PersonaCards';
import { FocusStocksBanner } from './FocusStocksBanner';
import { CumulativeProfitChart } from './CumulativeProfitChart';
import { ProofTableCard } from './ProofTableCard';
import { ProofModal } from './ProofModal';
import type { PredictionTrackingDashboardProps } from './types';

export function PredictionTrackingDashboard({
 market = 'EGX',
 className,
}: PredictionTrackingDashboardProps) {
 const s = usePredictionTrackingState(market);
 const session = s.data?.market_session;

 // A4 FIX: Market regime — إذا كان السوق هابط/دفاعي وكلش مفيش فرص، اعرض NO_TRADE
 const predictions = s.filteredPredictions ?? [];
 const isBearMarket = session?.market_regime === 'DEFENSIVE' || session?.market_regime === 'BEAR';
 const hasNoPredictions = predictions.length === 0;
 const showNoTradeBanner = isBearMarket && hasNoPredictions;

 // "تحقق من المعلقة" — POST to /api/predictions/honest-tracking/verify-pending
 // to re-evaluate pending predictions, then refresh the data.
 const handleVerifyPending = useCallback(async () => {
 try {
 const res = await fetch('/api/predictions/honest-tracking/verify-pending', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ limit: 500 }),
 });
 const result = await res.json();
 if (result.success) {
 const r = result.results;
 toast.success(`تحقق من ${r.checked} توقع: ${r.target_hits} هدف ✓ | ${r.stopped} وقف ✗ | ${r.expired} منتهي | ${r.still_pending} معلق`);
 s.fetchData(); // Refresh data after verification
 } else {
 toast.error(result.error || 'فشل التحقق');
 }
 } catch (e) {
 toast.error('فشل في التحقق من التوقعات المعلقة');
 }
 }, [s]);

 return (
 <div className={cn('space-y-5 dir-rtl', className)}>
 {/* A4 FIX: NO_TRADE Banner — يظهر لما السوق هابط ومفيش فرص */}
 {showNoTradeBanner && (
  <div className="rounded-xl border-2 border-warning/30 bg-warning/5 p-4 text-center">
   <p className="text-sm font-bold text-warning">
    لا توجد فرص شراء مستوفية لشروط النظام حاليًا.
   </p>
   <p className="text-xs text-muted-foreground mt-1">
    الحفاظ على السيولة هو القرار المعتمد في هذه الحالة.
   </p>
   {session?.market_regime && (
    <p className="text-[10px] text-muted-foreground mt-1 font-mono">
     حالة السوق: {session.market_regime} | آخر تحديث: {session.last_update || '—'}
    </p>
   )}
  </div>
 )}
 {/* ─── 1. Luxury Header & Timeframe Control Bar ─── */}
 <HeaderBar
 session={session}
 refreshing={s.refreshing}
 countdown={s.countdown}
 onRefresh={s.fetchData}
 onVerifyPending={handleVerifyPending}
 shareText={s.predictionsShareText}
 days={s.days}
 setDays={s.setDays}
 qualityMode={s.qualityMode}
 setQualityMode={s.setQualityMode}
 minConfidence={s.minConfidence}
 setMinConfidence={s.setMinConfidence}
 />

 {/* ─── 2. Hero KPI Cards Grid — ما يهم العميل: الفلوس + الحماية ─── */}
 <KpiCards activeStats={s.activeStats} />

 {/* ─── 3. Persona Breakdown Cards Showcase (UNIFIED — balanced only) ─── */}
 {/* KILL-MAESTRO (2026-08-31): V40.2 = balanced فقط — لا كروت للمضارب/المستثمر */}
 <PersonaCards
 selectedPersona={s.selectedPersona}
 setSelectedPersona={s.setSelectedPersona}
 computedStatsByPersona={s.computedStats.byPersona}
 />

 {/* ─── P0-v17: Focus Stocks Banner + Cumulative Profit Chart ─── */}
 <FocusStocksBanner
 focusTickerList={s.focusTickerList}
 focusTickers={s.focusTickers}
 onSelectTicker={s.setSearchQuery}
 />

 {/* ─── P0-v17: Cumulative Profit Movement Chart ─── */}
 <CumulativeProfitChart data={s.cumulativeProfitData} />

 {/* ─── 4. Trade Proof Table & Multi-Filter Toolbar ─── */}
 <ProofTableCard
 loading={s.loading}
 hasData={!!s.data}
 error={s.error}
 refreshing={s.refreshing}
 fetchData={s.fetchData}
 filteredPredictions={s.filteredPredictions}
 selectedOutcome={s.selectedOutcome}
 setSelectedOutcome={s.setSelectedOutcome}
 searchQuery={s.searchQuery}
 setSearchQuery={s.setSearchQuery}
 sortBy={s.sortBy}
 setSortBy={s.setSortBy}
 entryPeriod={s.entryPeriod}
 setEntryPeriod={s.setEntryPeriod}
 focusTickers={s.focusTickers}
 onSelectProof={s.setSelectedProofTrade}
 />

 {/* ─── 5. Trade Proof Modal Dialog ─── */}
 <ProofModal
 selectedProofTrade={s.selectedProofTrade}
 onClose={() => s.setSelectedProofTrade(null)}
 proofCardRef={s.proofCardRef}
 downloadingProof={s.downloadingProof}
 onExportImage={s.handleExportProofImage}
 />
 </div>
 );
}

export default PredictionTrackingDashboard;
