'use client';

/**
 * enhanced-portfolio/StockSearchDropdown.tsx
 * ============================================================================
 * F-Phase3-Split-Portfolio: Stock search dropdown extracted from
 * EnhancedPortfolioView.tsx (lines ~306-396). Used internally by AssetsTab's
 * add-asset dialog.
 *
 * NOTE: There is also a sibling module-level `StockSearchDropdown` at
 * `src/modules/portfolio/components/StockSearchDropdown.tsx` — that one is
 * shared with BagHolderRescuePanel and has a slightly different API
 * (placeholder prop + cache:'no-store'). This local copy preserves the
 * original behaviour verbatim (with the `if (loading) return` guard).
 * ============================================================================
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { StockSearchResult } from './types';

interface StockSearchDropdownProps {
	value: string;
	onSelect: (ticker: string, name: string, currentPrice: number) => void;
}

export function StockSearchDropdown({ value, onSelect }: StockSearchDropdownProps) {
	const [query, setQuery] = useState(value);
	const [results, setResults] = useState<StockSearchResult[]>([]);
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const searchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => { setQuery(value); }, [value]);

	const doSearch = useCallback(async (term: string) => {
		if (loading) return;
		setLoading(true);
		try {
			const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(term)}`);
			const data = await res.json();
			setResults(data.stocks || []);
		} catch {
			setResults([]);
		} finally {
			setLoading(false);
		}
	}, [loading]);

	const handleChange = (val: string) => {
		setQuery(val);
		if (searchTimer.current) clearTimeout(searchTimer.current);
		if (val.trim().length < 1) {
			setOpen(false);
			setResults([]);
			return;
		}
		searchTimer.current = setTimeout(() => {
			doSearch(val.trim());
			setOpen(true);
		}, 250);
	};

	const handleSelect = (stock: StockSearchResult) => {
		setQuery(`${stock.ticker} - ${stock.name_ar}`);
		setOpen(false);
		onSelect(stock.ticker, stock.name_ar, stock.current_price);
	};

	return (
		<div className="relative">
			<div className="relative">
				<Input
					value={query}
					onChange={(e) => handleChange(e.target.value)}
					placeholder="ابحث عن السهم بالاسم أو الرمز..."
					dir="rtl"
					onFocus={() => { if (results.length > 0) setOpen(true); }}
				/>
				{loading && (
					<div className="absolute left-2 top-1/2 -translate-y-1/2">
						<div className="w-4 h-4 border-2 border-profit border-t-transparent rounded-full animate-spin" />
					</div>
				)}
			</div>
			{open && results.length > 0 && (
				<div className="absolute z-50 w-full mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover shadow-lg">
					{results.map((stock) => (
						<button
							key={stock.id}
							type="button"
							className="w-full text-right px-3 py-2.5 hover:bg-accent flex items-center justify-between gap-2 transition-colors border-b last:border-b-0"
							onClick={() => handleSelect(stock)}
						>
							<div className="min-w-0 flex-1">
								<div className="font-medium text-sm truncate">{stock.name_ar}</div>
								<div className="text-xs text-muted-foreground" dir="ltr">{stock.ticker} | {stock.name}</div>
							</div>
							<div className="text-left flex-shrink-0">
								<div className="text-sm font-semibold" dir="ltr">{(stock.current_price ?? 0) > 0 ? (stock.current_price ?? 0).toFixed(2) : '—'}</div>
								<div className={cn('text-xs font-medium', (stock.price_change ?? 0) >= 0 ? 'text-profit ' : 'text-loss ')}>
									{(stock.price_change ?? 0) >= 0 ? '+' : ''}{(stock.price_change ?? 0).toFixed(2)}%
								</div>
							</div>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
