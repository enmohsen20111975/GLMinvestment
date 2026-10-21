/**
 * Unified Component Library — BLUEPRINT-UNIFIED-SCREENS (Phase 1)
 * ====================================================================
 * الـ unified component library. كل UI component جديد لازم يـتـbuilt هنا First.
 *
 * P0-COMPONENT-UNIFICATION (Phase 1): أضفنا الـ components الجديدة اللي
 * بـ تحل الـ duplications الـ 4 audit reports كشفتها.
 *
 * Rule 27: لا أرقام وهمية.
 * Rule 30: Emerald + Amber + Cyan (ممنوع أزرق/indigo).
 * Rule 73: SINGLE-DISPLAY-SOURCE.
 */

// Existing BLUEPRINT Phase 1 components
export { PriceDisplay, type PriceDisplayProps } from './PriceDisplay';
export { SignalBadge, type SignalBadgeProps, type SignalKind } from './SignalBadge';
export { RiskRewardBadge, type RiskRewardBadgeProps } from './RiskRewardBadge';
export { FlowPhaseTag, type FlowPhaseTagProps } from './FlowPhaseTag';
export { UnifiedEmptyState, type UnifiedEmptyStateProps } from './UnifiedEmptyState';
export { FilterDrawer, type FilterDrawerProps } from './FilterDrawer';
export { StockDetailDrawer, type StockDetailDrawerProps } from './StockDetailDrawer';
export { ActionMenu, type ActionMenuProps, type ActionMenuItem } from './ActionMenu';
// BLUEPRINT Phase 5: Live screens components
export { DeltaBadge, type DeltaBadgeProps } from './DeltaBadge';
export { LiquidityFlashCell, type LiquidityFlashCellProps } from './LiquidityFlashCell';

// P0-COMPONENT-UNIFICATION Phase 1 new components
export { LifecycleBadge, type LifecycleBadgeProps } from './LifecycleBadge';
export { StatusBadge, type StatusBadgeProps, getStatusBadgeClass, getStatusLabelAr } from './StatusBadge';
export { UnifiedPagination, type UnifiedPaginationProps } from './UnifiedPagination';
export { SkeletonRow, TabSkeleton, TableSkeleton, CardSkeleton } from './Skeleton';
export { AsyncBoundary, type AsyncBoundaryProps } from './AsyncBoundary';
export { ChangePill, type ChangePillProps } from './ChangePill';
export { PriceText, type PriceTextProps } from './PriceText';
export { SeverityBadge, type SeverityBadgeProps, getSeverityBadgeClass, type SeverityLevel } from './SeverityBadge';
export { ConfidenceMeter, type ConfidenceMeterProps } from './ConfidenceMeter';
export { PersonaEmptyState, type PersonaEmptyStateProps } from './PersonaEmptyState';
export { FinancialBadge, type FinancialBadgeProps } from './FinancialBadge';
export { TrendIndicator, type TrendIndicatorProps } from './TrendIndicator';
export { StockCard, type StockCardProps } from './StockCard';
export { MarketTable, type MarketTableColumn, type MarketTableProps } from './MarketTable';
