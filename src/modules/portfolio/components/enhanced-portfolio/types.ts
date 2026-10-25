/**
 * enhanced-portfolio/types.ts
 * ============================================================================
 * F-Phase3-Split-Portfolio: Types shared across the split EnhancedPortfolioView
 * sub-components. Pure type definitions — runtime constants live in helpers.ts.
 * ============================================================================
 */

import type { WealthAllocationAlert } from '@/lib/persona-dynamic';

// ==================== STOCK SEARCH DROPDOWN ====================

export interface StockSearchResult {
	id: number;
	ticker: string;
	name: string;
	name_ar: string;
	sector: string;
	current_price: number;
	previous_close: number;
	volume: number;
	price_change: number;
}

// ==================== CRYPTO SEARCH DROPDOWN ====================

export interface CryptoSearchResult {
	symbol: string;
	name: string;
	price_usd: number;
	change_24h: number;
}

// ==================== WEALTH ALLOCATION MATRIX CARD ====================

export interface WealthAllocationMatrixCardProps {
	alerts: WealthAllocationAlert[];
	personaLabel: string;
	onRebalance: () => void;
}

// ==================== ASSETS TAB ====================

export interface AssetsTabProps {
	selectedPortfolioId?: number | 'master';
}
