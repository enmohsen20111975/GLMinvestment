'use client';

/**
 * enhanced-portfolio/CryptoSearchDropdown.tsx
 * ============================================================================
 * F-Phase3-Split-Portfolio: Crypto search dropdown extracted from
 * EnhancedPortfolioView.tsx (lines ~407-515). Used internally by AssetsTab's
 * add-asset dialog. Loads all coins once on first focus, filters client-side.
 * ============================================================================
 */

import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { CryptoSearchResult } from './types';

interface CryptoSearchDropdownProps {
	value: string;
	onSelect: (symbol: string, name: string, priceUsd: number) => void;
}

export function CryptoSearchDropdown({ value, onSelect }: CryptoSearchDropdownProps) {
	const [query, setQuery] = useState(value);
	const [allCoins, setAllCoins] = useState<CryptoSearchResult[]>([]);
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => { setQuery(value); }, [value]);

	// Fetch all coins once when the dropdown is first focused
	const loadCoins = useCallback(async () => {
		if (loaded) return;
		setLoading(true);
		try {
			const res = await fetch('/api/crypto/coins?limit=250');
			const data = await res.json();
			if (data.success && Array.isArray(data.all_cryptos)) {
				setAllCoins(data.all_cryptos.map((c: any) => ({
					symbol: c.symbol,
					name: c.name || c.symbol,
					price_usd: c.price_usd || 0,
					change_24h: c.change_24h || 0,
				})));
				setLoaded(true);
			}
		} catch {
			setAllCoins([]);
		} finally {
			setLoading(false);
		}
	}, [loaded]);

	const handleChange = (val: string) => {
		setQuery(val);
		if (!loaded) loadCoins();
		if (val.trim().length < 1) {
			setOpen(false);
			return;
		}
		setOpen(true);
	};

	// Client-side filter
	const filtered = open && allCoins.length > 0
		? allCoins.filter(c => {
			const q = query.toLowerCase().trim();
			return c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
		}).slice(0, 30)
		: [];

	const handleSelect = (coin: CryptoSearchResult) => {
		setQuery(`${coin.symbol} - ${coin.name}`);
		setOpen(false);
		onSelect(coin.symbol, coin.name, coin.price_usd);
	};

	return (
		<div className="relative">
			<div className="relative">
				<Input
					value={query}
					onChange={(e) => handleChange(e.target.value)}
					placeholder="ابحث عن عملة (BTC, ETH, Bitcoin...)"
					dir="rtl"
					onFocus={() => { if (!loaded) loadCoins(); if (allCoins.length > 0) setOpen(true); }}
				/>
				{loading && (
					<div className="absolute left-2 top-1/2 -translate-y-1/2">
						<div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
					</div>
				)}
			</div>
			{open && filtered.length > 0 && (
				<div className="absolute z-50 w-full mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover shadow-lg">
					{filtered.map((coin) => (
						<button
							key={coin.symbol}
							type="button"
							className="w-full text-right px-3 py-2.5 hover:bg-accent flex items-center justify-between gap-2 transition-colors border-b last:border-b-0"
							onClick={() => handleSelect(coin)}
						>
							<div className="min-w-0 flex-1">
								<div className="font-medium text-sm truncate">{coin.name}</div>
								<div className="text-xs text-muted-foreground" dir="ltr">{coin.symbol}</div>
							</div>
							<div className="text-left flex-shrink-0">
								<div className="text-sm font-semibold" dir="ltr">${coin.price_usd > 0 ? (coin.price_usd ?? 0).toFixed(2) : '—'}</div>
								<div className={cn('text-xs font-medium', coin.change_24h >= 0 ? 'text-profit ' : 'text-loss ')}>
									{coin.change_24h >= 0 ? '+' : ''}{(coin.change_24h ?? 0).toFixed(2)}%
								</div>
							</div>
						</button>
					))}
				</div>
			)}
			{open && !loading && filtered.length === 0 && allCoins.length > 0 && query.trim() && (
				<div className="absolute z-50 w-full mt-1 rounded-md border bg-popover shadow-lg p-3 text-sm text-muted-foreground text-center">
					لا توجد عملات مطابقة لـ "{query}"
				</div>
			)}
		</div>
	);
}
