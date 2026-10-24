'use client';

/**
 * TopTradesImageCard — backward-compat re-export wrapper
 * ============================================================================
 * MERGE-LIST-CARDS: this file was a 208-LOC duplicate of StockLeagueImageCard
 * (same forwardRef + html-to-image + Card layout pattern, but rendered a list
 * of top trades instead of a ranked league). It now delegates to
 * StockLeagueImageCard with `mode='trades'` — one canonical implementation.
 *
 * The `TopTrade` interface and `TopTradesImageCardProps` shape are kept
 * identical so every existing importer (admin/honest-predictions/page.tsx)
 * keeps compiling without any change.
 */

export {
 StockLeagueImageCard,
 type TopTrade,
} from '@/components/market/StockLeagueImageCard';

import { StockLeagueImageCard } from '@/components/market/StockLeagueImageCard';

export interface TopTradesImageCardProps {
 trades: import('@/components/market/StockLeagueImageCard').TopTrade[];
 monthName?: string;
}

/**
 * Drop-in replacement for the old TopTradesImageCard. Renders the trades list
 * via the canonical StockLeagueImageCard in `mode='trades'`.
 */
export function TopTradesImageCard({ trades, monthName }: TopTradesImageCardProps) {
 return (
 <StockLeagueImageCard
 mode="trades"
 trades={trades}
 monthName={monthName}
 />
 );
}

export default TopTradesImageCard;
