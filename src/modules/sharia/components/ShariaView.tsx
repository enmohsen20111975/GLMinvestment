// ShariaView types (Phase 3)

/**
 * ShariaView.tsx (shim)
 * =====================
 * Re-export shim. The actual implementation now lives in the `sharia-view/`
 * folder as part of Task F-Phase3-FinalPush (split from 1,478 LOC).
 *
 * Sub-modules:
 *   - sharia-view/ShariaView.tsx                          (container, < 200 LOC)
 *   - sharia-view/types.ts                                (interfaces + STATUS_* constants)
 *   - sharia-view/helpers.tsx                             (IslamicPattern / GoldBorder / OrnamentDivider / Alert / formatPct / safeNumber / deriveOverallStatus)
 *   - sharia-view/ShariaStockRowCard.tsx                  (per-stock card)
 *   - sharia-view/ShariaStockDetailModal.tsx              (detail modal + body + MetricTile)
 *   - sharia-view/ShariaStocksListTab.tsx                 (list tab + StatPill)
 *   - sharia-view/SingleTradePurificationCalculator.tsx   (single-trade calc + result card)
 *   - sharia-view/PortfolioPurificationCalculator.tsx     (portfolio calc + result card)
 *
 * Backward compatible: existing import sites keep working unchanged.
 *   - src/modules/sharia/index.ts barrel (re-exports ShariaView).
 */
export { ShariaView, default } from './sharia-view/ShariaView';
