/**
 * components/StocksView.tsx (thin re-export shim)
 * ============================================================================
 * F-Phase3-Split-StocksView: the original 2,287-LOC StocksView.tsx has been
 * split into a `stocks-view/` sub-folder. This file re-exports the container
 * so existing import sites (`@/modules/stock-analysis/components/StocksView`
 * and `./StocksView`) keep working without changes.
 *
 * New code should import directly from `./stocks-view/StocksView`.
 * ============================================================================
 */

export { StocksView } from './stocks-view/StocksView';
