/**
 * EnhancedPortfolioView.tsx (shim)
 * ============================================================================
 * F-Phase3-Split-Portfolio: Original 3,281-LOC file split into 9 modular
 * files under enhanced-portfolio/. This file is now a re-export shim so
 * consumers (`src/modules/portfolio/index.ts`, `src/app/page.tsx`) keep
 * working unchanged.
 *
 * New structure (src/modules/portfolio/components/enhanced-portfolio/):
 *   1. types.ts                          — StockSearchResult, CryptoSearchResult,
 *                                          WealthAllocationMatrixCardProps,
 *                                          AssetsTabProps
 *   2. helpers.ts                       — inferStockMarket, formatCurrencyRaw,
 *                                          formatCurrency (EGP-only fallback),
 *                                          formatPercent, abbreviateNumber +
 *                                          8 shared constants (ASSET_TYPE_*
 *                                          FUND_TYPES, INCOME_/EXPENSE_CATEGORIES,
 *                                          OBLIGATION_TYPE/STATUS_*)
 *   3. StockSearchDropdown.tsx          — stock search dropdown (local copy
 *                                          used only by AssetsTab — the shared
 *                                          module-level version at
 *                                          `../StockSearchDropdown.tsx`
 *                                          remains for BagHolderRescuePanel)
 *   4. CryptoSearchDropdown.tsx         — crypto search dropdown (Binance coins)
 *   5. AssetsTab.tsx                     — biggest sub-component (~1300 LOC, all
 *                                          form state + WealthAllocationMatrix)
 *   6. WealthAllocationMatrixCard.tsx    — persona-aware wealth allocation matrix
 *   7. IncomeExpenseTab.tsx             — transactions + summary + expenses breakdown
 *   8. ObligationsTab.tsx               — loans/installments + payment tracking
 *   9. ReportsTab.tsx                    — financial reports + expert recommendations
 *  10. EnhancedPortfolioView.tsx        — container (~170 LOC, < 500 LOC target)
 *
 * Form state (formType, formName, etc.) stays inside AssetsTab.tsx — passed
 * down to no other sub-components (the add/edit dialogs are rendered inline
 * within AssetsTab itself).
 *
 * `usePortfolioData` hook (extracted in Phase 2) is still consumed by AssetsTab
 * — the hook owns all data-fetching + 30s visibility-aware polling + store side
 * effects (setFxRates + usePortfolioStore.updateFromCalcValues). The widget
 * remains render-only.
 *
 * WealthCharts stays a dynamic import inside the container (ssr:false) so the
 * recharts bundle only loads when the user opens the "الأموال" sub-tab.
 *
 * The local `formatCurrency` closure inside each tab (AssetsTab,
 * IncomeExpenseTab, ObligationsTab, ReportsTab) shadows the module-level
 * `formatCurrency` from helpers.ts intentionally — it uses displayCurrency
 * from the global Zustand store for EGP/USD/SAR toggle.
 * ============================================================================
 */

export { EnhancedPortfolioView, default } from './enhanced-portfolio/EnhancedPortfolioView';
