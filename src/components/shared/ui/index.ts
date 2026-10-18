/**
 * Unified Component Library — BLUEPRINT-UNIFIED-SCREENS (Phase 1)
 * ====================================================================
 * الـ 8 مكونات الموحدة اللي كل الشاشات بـ تستوردها.
 * ممنوع ad-hoc per screen — كل UI component جديد يـ built هنا First.
 *
 * Rule 27: لا أرقام وهمية.
 * Rule 30: Emerald + Amber + Cyan (ممنوع أزرق/indigo).
 * Rule 73: SINGLE-DISPLAY-SOURCE.
 */

export { PriceDisplay, type PriceDisplayProps } from './PriceDisplay';
export { SignalBadge, type SignalBadgeProps, type SignalKind } from './SignalBadge';
export { RiskRewardBadge, type RiskRewardBadgeProps } from './RiskRewardBadge';
export { FlowPhaseTag, type FlowPhaseTagProps } from './FlowPhaseTag';
export { UnifiedEmptyState, type UnifiedEmptyStateProps } from './UnifiedEmptyState';
export { FilterDrawer, type FilterDrawerProps } from './FilterDrawer';
export { StockDetailDrawer, type StockDetailDrawerProps } from './StockDetailDrawer';
export { ActionMenu, type ActionMenuProps, type ActionMenuItem } from './ActionMenu';
