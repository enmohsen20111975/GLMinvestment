/**
 * specialist/LiquidityFootprintSection.tsx — §4 Liquidity Footprint.
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 606–807).
 * Renders POC + VAH/VAL + Buy/Sell + 18-level volume profile.
 *
 * UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72): canonical.accumulation +
 * canonical.money_flow from /api/stocks/[ticker]/unified take precedence over
 * locally-derived labels (single source of truth across the app).
 *
 * CANONICAL-CALCULATIONS (Task CALC-DUP-1): falls back to classifyAccumulation
 * from canonical-signal.ts when unified API label is missing (so this section's
 * thresholds match the radar + stock detail page).
 */
import { Droplets, Gauge, Layers, TrendingUp } from 'lucide-react';
import { classifyAccumulation } from '@/lib/canonical-signal';
import type { FootprintData } from './types';
import { fmtCompact, fmtNum, fmtPct, safeNum } from './helpers';
import { EmptyState, MetricRow, PriceTile, SectionCard } from './primitives';

export function LiquidityFootprintSection({
  data,
  canonicalAccumulation = null,
  canonicalMoneyFlow = null,
}: {
  data: FootprintData | null;
  // UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72)
  // canonical.accumulation from /api/stocks/[ticker]/unified — single source of truth.
  canonicalAccumulation?: string | null;
  // canonical.money_flow from the unified API — used for the flow-state display.
  canonicalMoneyFlow?: string | null;
}) {
  if (!data || !data.success) return null;

  const poc = safeNum(data.poc_price);
  const vah = safeNum(data.vah_price);
  const val = safeNum(data.val_price);
  const buyVol = safeNum(data.buy_volume);
  const sellVol = safeNum(data.sell_volume);
  const delta = safeNum(data.delta_volume);
  const ratio = safeNum(data.buy_sell_ratio);
  const totalVol = safeNum(data.total_volume);
  const vaPct = safeNum(data.value_area_volume_pct);
  const levels = (data.levels ?? []).filter(
    (l) => l && typeof l.price_mid === 'number' && Number.isFinite(l.price_mid)
  );

  if (poc == null && vah == null && val == null && buyVol == null && levels.length === 0) {
    return null;
  }

  // Color: emerald if >1.2 (strong buy), red if <0.8 (strong sell), amber otherwise.
  const ratioColor = ratio == null ? 'text-muted-foreground dark:text-muted-foreground'
    : ratio >= 1.2 ? 'text-profit'
    : ratio <= 0.8 ? 'text-loss'
    : 'text-warning';

  const totalBS = (buyVol ?? 0) + (sellVol ?? 0);
  const buyPct = totalBS > 0 && buyVol != null ? (buyVol / totalBS) * 100 : 50;
  const sellPct = 100 - buyPct;

  // For horizontal profile: find max volume for normalization.
  const maxLevelVol = levels.length > 0 ? Math.max(...levels.map((l) => l.volume ?? 0)) : 0;

  return (
    <SectionCard
      icon={<Droplets className="w-4 h-4" />}
      title="بصمة السيولة (Liquidity Footprint)"
      description={`من /api/maker-radar/footprint?ticker=${data.ticker ?? ''}&days=30 — تحليل توزيع السيولة على ${levels.length} مستوى سعر`}
      accent="emerald"
    >
      {/* Top: POC + VAH + VAL + value area % */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <PriceTile label="POC (نقطة التحكم)" value={fmtNum(poc)} color="text-warning" sub="أعلى سيولة" />
        <PriceTile label="VAH (قمة منطقة القيمة)" value={fmtNum(vah)} color="text-profit" />
        <PriceTile label="VAL (قاع منطقة القيمة)" value={fmtNum(val)} color="text-loss" />
        <PriceTile label="نسبة منطقة القيمة" value={fmtPct(vaPct)} color="text-muted-foreground dark:text-muted-foreground" sub="70% من السيولة" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Buy vs Sell visual bar */}
        <div className="p-3 bg-white rounded-lg border border-border">
          <p className="text-xs font-semibold mb-2 text-muted-foreground dark:text-slate-200 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-profit" />
            توزيع التدفق: شراء vs بيع
          </p>
          <div className="flex h-6 rounded-full overflow-hidden border border-border">
            <div
              className="bg-profit flex items-center justify-center text-xs text-foreground font-bold"
              style={{ width: `${buyPct}%` }}
            >
              {buyPct > 12 ? `${(buyPct ?? 0).toFixed(0)}%` : ''}
            </div>
            <div
              className="bg-loss flex items-center justify-center text-xs text-foreground font-bold"
              style={{ width: `${sellPct}%` }}
            >
              {sellPct > 12 ? `${(sellPct ?? 0).toFixed(0)}%` : ''}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
            <MetricRow label="حجم الشراء" value={fmtCompact(buyVol)} valueClass="text-profit" />
            <MetricRow label="حجم البيع" value={fmtCompact(sellVol)} valueClass="text-loss" />
            <MetricRow
              label="الفرق (Delta)"
              value={fmtCompact(delta)}
              valueClass={delta != null && delta >= 0 ? 'text-profit' : 'text-loss'}
            />
          </div>
        </div>

        {/* Ratio gauge */}
        <div className="p-3 bg-white rounded-lg border border-border">
          <p className="text-xs font-semibold mb-2 text-muted-foreground dark:text-slate-200 flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-warning" />
            نسبة الشراء/البيع
          </p>
          <div className="text-center">
            <p className={`text-4xl font-bold ${ratioColor}`}>{ratio != null ? ratio.toFixed(2) : '—'}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {/* ─── CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 67) ─────────── */}
              {/* قبل كده: كان labels "ضغط شرائي قوي/ضغط بيعي قوي" بـ thresholds 1.2/0.8 */}
              {/* الحل: نحسب buy_pct من buyVol/sellVol ونستخدم canonical classifyAccumulation */}
              {/* UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72) — canonical.accumulation
              from unified API takes precedence over locally-derived label. */}
              {canonicalAccumulation
                ? (canonicalAccumulation.includes('تجميع')
                  ? `✓ ${canonicalAccumulation}`
                  : canonicalAccumulation.includes('تصريف')
                  ? `⚠ ${canonicalAccumulation}`
                  : canonicalAccumulation)
                : ratio == null ? '—'
                : (() => {
                  const bV = Number(buyVol || 0);
                  const sV = Number(sellVol || 0);
                  const buyPct = (bV + sV) > 0 ? (bV / (bV + sV)) * 100 : null;
                  const label = classifyAccumulation(buyPct);
                  const isAccum = label.includes('تجميع');
                  const isDist = label.includes('تصريف');
                  return isAccum ? `✓ ${label}` : isDist ? `⚠ ${label}` : label;
                })()
              }
            </p>
            {/* UNIFIED-API — money_flow state from unified API (Rule 27: show "—" if missing) */}
            {canonicalMoneyFlow && (
              <p className="text-xs text-muted-foreground mt-1">
                <span className="font-semibold">{canonicalMoneyFlow}</span>
              </p>
            )}
          </div>
          <div className="mt-2">
            <MetricRow label="إجمالي السيولة" value={fmtCompact(totalVol)} valueClass="text-warning" />
          </div>
        </div>
      </div>

      {/* 18-level volume profile (horizontal bars) */}
      {levels.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            توزيع السيولة على مستويات السعر ({levels.length} مستوى)
          </p>
          <div className="space-y-0.5 max-h-80 overflow-y-auto pr-1">
            {/* Sort: high price at top, low at bottom (visual ladder) */}
            {[...levels].sort((a, b) => b.price_mid - a.price_mid).map((lvl, i) => {
              const isPoc = !!lvl.is_poc;
              const isInVA = !!lvl.is_value_area;
              const buyPctLvl = lvl.volume > 0 ? (lvl.buy_volume / lvl.volume) * 100 : 50;
              const sellPctLvl = 100 - buyPctLvl;
              const widthPct = maxLevelVol > 0 ? (lvl.volume / maxLevelVol) * 100 : 0;
              const isBuyDom = lvl.delta >= 0;
              return (
                <div
                  key={`lvl-${i}`}
                  className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
                    isPoc
                      ? 'bg-warning/10 border border-warning '
                      : isInVA
                      ? 'bg-slate-50/40'
                      : 'bg-transparent'
                  }`}
                >
                  <span className={`w-16 text-left font-mono ${isPoc ? 'text-warning font-bold' : 'text-muted-foreground dark:text-muted-foreground'}`}>
                    {(lvl.price_mid ?? 0).toFixed(2)}
                  </span>
                  <div className="flex-1 relative h-3 rounded-sm overflow-hidden bg-muted">
                    {/* Buy portion (left, emerald) */}
                    <div
                      className="absolute inset-y-0 right-0 bg-profit/70"
                      style={{ width: `${(widthPct * buyPctLvl) / 100}%` }}
                    />
                    {/* Sell portion (right, red) */}
                    <div
                      className="absolute inset-y-0 left-0 bg-loss/70"
                      style={{ width: `${(widthPct * sellPctLvl) / 100}%` }}
                    />
                    {isPoc && (
                      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-warning">
                        POC
                      </span>
                    )}
                  </div>
                  <span className={`w-12 text-left ${isBuyDom ? 'text-profit' : 'text-loss'}`}>
                    {isBuyDom ? '+' : ''}{fmtCompact(lvl.delta)}
                  </span>
                  <span className="w-12 text-left text-muted-foreground dark:text-muted-foreground">
                    {lvl.volume_pct != null ? `${lvl.volume_pct.toFixed(1)}%` : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
