// PaperTrading types (Phase 3)

/**
 * PaperTradingWorkstation.tsx (shim)
 * ===================================
 * Re-export shim. The actual implementation now lives in the
 * `paper-trading-ws/` folder as part of Task F-Phase3-FinalPush
 * (split from 1,550 LOC).
 *
 * Sub-modules:
 *   - paper-trading-ws/PaperTradingWorkstation.tsx    (container, ~430 LOC)
 *   - paper-trading-ws/types.ts                        (interfaces + QUICK_SHARES + POLL/LIVE_PRICE/HISTORY constants + ASSET_TYPE_LABELS + CLOSE_REASON_*)
 *   - paper-trading-ws/helpers.ts                      (fmtEgp/fmtNum/fmtPct + pnlColor + rowBgClass + timeAgoAr + dateTimeAr)
 *   - paper-trading-ws/AccountHeaderBar.tsx            (stats grid + reset account dialog)
 *   - paper-trading-ws/OrderExecutionPanel.tsx         (ticker search + asset type + BUY/SELL + shares + entry/SL/TP + summary + execute)
 *   - paper-trading-ws/OpenPositionsTable.tsx          (positions table + close dialog)
 *   - paper-trading-ws/HistoryAndPerformance.tsx       (closed orders table + equity curve chart tabs)
 *
 * Backward compatible: existing import sites keep working unchanged.
 *   - src/modules/education/index.ts barrel (re-exports PaperTradingWorkstation).
 *   - src/modules/education/components/academy/AcademyView.tsx (imports + renders PaperTradingWorkstation).
 */
export { PaperTradingWorkstation, default } from './paper-trading-ws/PaperTradingWorkstation';
