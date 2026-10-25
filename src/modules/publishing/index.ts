// ============================================================================
// modules/publishing — Public API
//
// Canonical home for stock publishing + sharing:
// • StockPublisher — full stock card with image + targets + regime
// • UnifiedPublishButton — quick-publish trigger (Telegram + share + image)
// • ShareButton — capture-any-DOM-element-to-image share button
//
// Lib helpers:
// • official-links.ts — single source of truth for invist.m2y.net /
// Telegram / Facebook / WhatsApp / Android URLs
// • stock-publish-text.ts — text formatters for publish payload
// ============================================================================

export { StockPublisher } from './components/StockPublisher';
export type {
 StockPublishData,
 StockPublisherProps,
 Recommendation,
 MarketRegime,
} from './components/StockPublisher';

// StockInfographicCard — PNG-exportable infographic for social media (INFOGRAPHIC-CARD)
export { StockInfographicCard } from './components/StockInfographicCard';
export type { StockInfographicCardProps } from './components/StockInfographicCard';
export { StockInfographicModal } from './components/StockInfographicModal';
export type { StockInfographicModalProps } from './components/StockInfographicModal';

export { UnifiedPublishButton } from './components/UnifiedPublishButton';
export type { UnifiedPublishButtonProps } from './components/UnifiedPublishButton';

export { ShareButton, ShareableCard } from './components/ShareButton';

// Re-export the lib surface so consumers can use `@/modules/publishing` as a
// single import point for official links + publish text helpers.
export {
 OFFICIAL_LINKS,
 OFFICIAL_LINKS_SHORT,
 OFFICIAL_LINKS_BLOCK,
 COMMUNITY_PROMPT,
 withOfficialLinks,
} from './lib/official-links';

export {
 RECOMMENDATION_TEXT,
 MARKET_REGIME_AR,
 generatePublishText,
 generatePublishPayload,
 escapeHtmlForTelegram,
} from './lib/stock-publish-text';
