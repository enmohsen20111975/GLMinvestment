/**
 * enhanced-portfolio/helpers.ts
 * ============================================================================
 * F-Phase3-Split-Portfolio: Pure helpers + shared constants extracted from
 * EnhancedPortfolioView.tsx. No JSX here — pure functions + value tables.
 *
 * Helpers:
 *   - inferStockMarket(ticker, stored?) — heuristically maps a ticker to a
 *     MarketType (EGX/TADAWUL/KSE/QSE/US/CRYPTO). Used by AssetsTab badge.
 *   - formatCurrencyRaw(value, currency, usdRate, sarRate) — currency-aware
 *     wealth formatter (EGP/USD/SAR). Per-row raw market prices stay EGP and
 *     use inline `toFixed(2)} ج.م` suffix (NOT this function).
 *   - formatCurrency(value) — module-level EGP-only fallback (ar-EG locale).
 *     Each tab defines its OWN local `formatCurrency` closure that calls
 *     `formatCurrencyRaw(value, displayCurrency, usdRate, sarRate)` — those
 *     closures shadow this module-level version intentionally.
 *   - formatPercent(value) — "+1.23%" / "-4.56%" / "—" for null.
 *   - abbreviateNumber(value) — "1.2K" / "3.4M" / "—" for null.
 *
 * Constants:
 *   - ASSET_TYPE_LABELS / ASSET_TYPE_COLORS — shared by AssetsTab + ReportsTab
 *   - FUND_TYPES — used by AssetsTab add-asset dialog
 *   - INCOME_CATEGORIES / EXPENSE_CATEGORIES — used by IncomeExpenseTab
 *   - OBLIGATION_TYPE_LABELS / OBLIGATION_STATUS_LABELS /
 *     OBLIGATION_STATUS_COLORS — used by ObligationsTab
 * ============================================================================
 */

import {
	Briefcase,
	Car,
	CreditCard,
	DollarSign,
	FileText,
	GraduationCap,
	Heart,
	Home,
	Plane,
	Shield,
	ShoppingCart,
	TrendingUp,
	Zap,
} from 'lucide-react';
import { MARKET_NAMES_AR, type MarketType } from '@/lib/store';
import type { AssetType } from '@/types';

// Re-export MARKET_NAMES_AR so consumers can grab it from helpers in one place.
export { MARKET_NAMES_AR };

// ==================== HELPERS ====================

// PHASE3-MARKET-SEGREGATION: portfolio assets (stocks) carry a `stock_market`
// hint when added — but legacy rows don't have it, so we also infer from the
// ticker pattern. The badge shows which market each stock belongs to so the
// user can distinguish EGX holdings from TADAWUL/KSE/QSE/US/CRYPTO.
export function inferStockMarket(ticker: string, stored?: string | null): MarketType | null {
	if (stored && stored.trim()) {
		const upper = stored.trim().toUpperCase();
		if (upper === 'EGX' || upper === 'مصر' || upper === 'EGYPT') return 'EGX';
		if (upper === 'TADAWUL' || upper === 'KSA' || upper === 'SAUDI' || upper === 'السعودية') return 'TADAWUL';
		if (upper === 'KSE' || upper === 'KUWAIT' || upper === 'الكويت') return 'KSE';
		if (upper === 'QSE' || upper === 'QATAR' || upper === 'قطر') return 'QSE';
		if (upper === 'US' || upper === 'USA') return 'US';
		if (upper === 'CRYPTO') return 'CRYPTO';
	}
	// Heuristic fallback: TADAWUL tickers are pure digits (e.g. 2222 = Aramco).
	// EGX tickers are alphabetic (COMI, ETEL, AALR). Crypto tickers usually end
	// with USDT/BTC/etc.
	if (!ticker) return null;
	if (/^\d+$/.test(ticker)) return 'TADAWUL';
	if (ticker.includes('USDT') || ticker.includes('BTC') || ticker.includes('ETH')) return 'CRYPTO';
	return 'EGX'; // default for legacy rows
}

// P37-PHASE-2B-4A: Currency-aware formatter. All wealth values flow through
// this; per-row raw market prices (stock/gold per-gram) stay EGP and use the
// inline `toFixed(2)} ج.م` suffix instead. SAR derived from USD via fixed 3.75 peg.
export function formatCurrencyRaw(
	value: number | null | undefined,
	currency: 'EGP' | 'USD' | 'SAR',
	usdRate: number,
	sarRate: number
): string {
	// FIX (DEAL-ADVISOR-002): previously returned '0.00' for null/undefined/NaN,
	// which made the UI show fake "0.00 ج.م" for missing prices/targets/stops.
	// Now returns '—' (em dash) so the user sees "غير متاح" visually.
	if (value === null || value === undefined) return '—';
	const numValue = Number(value);
	if (!Number.isFinite(numValue)) return '—';
	let converted = numValue;
	let suffix = 'ج.م';
	if (currency === 'USD') {
		converted = numValue / (usdRate || 48.5);
		suffix = '$';
	} else if (currency === 'SAR') {
		converted = numValue / (sarRate || 181.875);
		suffix = 'ر.س';
	}
	const formatted = new Intl.NumberFormat('en-US', {
		style: 'decimal',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(converted);
	return currency === 'EGP' ? `${formatted} ${suffix}` : `${suffix}${formatted}`;
}

// EGP-only fallback formatter (kept for any module-scope helper that still
// needs raw EGP — sub-components shadow this with a currency-aware closure).
export function formatCurrency(value: number | null | undefined): string {
	// FIX (DEAL-ADVISOR-002): '0.00 ج.م' → '—' for missing values.
	if (value === null || value === undefined) return '—';
	const numValue = Number(value);
	if (!Number.isFinite(numValue)) return '—';
	return new Intl.NumberFormat('ar-EG', {
		style: 'decimal',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(numValue) + ' ج.م';
}

export function formatPercent(value: number | null | undefined): string {
	if (value === null || value === undefined) return '—';
	const numValue = Number(value);
	if (!Number.isFinite(numValue)) return '—';
	const sign = numValue >= 0 ? '+' : '';
	return `${sign}${(numValue ?? 0).toFixed(2)}%`;
}

export function abbreviateNumber(value: number | null | undefined): string {
	// FIX (DEAL-ADVISOR-002): '0' → '—' for missing values.
	if (value === null || value === undefined) return '—';
	const numValue = Number(value);
	if (!Number.isFinite(numValue)) return '—';
	if (Math.abs(numValue) >= 1_000_000) return (numValue / 1_000_000).toFixed(1) + 'M';
	if (Math.abs(numValue) >= 1_000) return (numValue / 1_000).toFixed(1) + 'K';
	return (numValue ?? 0).toFixed(2);
}

// ==================== SHARED CONSTANTS ====================

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
	stock: 'أسهم',
	gold: 'ذهب',
	bank: 'بنك',
	certificate: 'شهادات إيداع',
	fund: 'صناديق استثمار',
	crypto: 'عملات رقمية',
	real_estate: 'عقارات',
	other: 'أخرى',
};

export const ASSET_TYPE_COLORS: Record<AssetType, string> = {
	stock: 'bg-profit/10 text-profit border border-profit/20 ',
	gold: 'bg-warning/10 text-warning dark:text-warning border border-warning/20/30 ',
	bank: 'bg-whale text-whale/30 ',
	certificate: 'bg-primary text-primary/30 ',
	fund: 'bg-warning/10 text-warning dark:text-warning border border-warning/20/30 ',
	crypto: 'bg-warning/10 text-warning dark:text-warning border border-warning/20/30 ',
	real_estate: 'bg-whale text-whale/30 ',
	other: 'bg-muted text-muted-foreground /30 ',
};

// Fund types with Arabic labels
export const FUND_TYPES = [
	{ value: 'equity', label: 'صندوق أسهم' },
	{ value: 'bond', label: 'صندوق سندات' },
	{ value: 'money_market', label: 'صندوق نقدي' },
	{ value: 'fixed_income', label: 'صندوق دخل ثابت' },
	{ value: 'balanced', label: 'صندوق متوازن' },
	{ value: 'index', label: 'صندوق مؤشر' },
	{ value: 'real_estate', label: 'صندوق عقاري' },
	{ value: 'sharia', label: 'صندوق إسلامي' },
	{ value: 'other', label: 'نوع آخر' },
];

export const INCOME_CATEGORIES = [
	{ value: 'salary', label: 'راتب', icon: Briefcase },
	{ value: 'bonus', label: 'مكافآت', icon: Zap },
	{ value: 'investment_return', label: 'عوائد استثمار', icon: TrendingUp },
	{ value: 'rental', label: 'إيجار', icon: Home },
	{ value: 'business', label: 'أعمال حرة', icon: Briefcase },
	{ value: 'freelance', label: 'أعمال مستقلة', icon: FileText },
	{ value: 'other_income', label: 'أخرى', icon: DollarSign },
];

export const EXPENSE_CATEGORIES = [
	{ value: 'education', label: 'تعليم', icon: GraduationCap },
	{ value: 'housing', label: 'سكن', icon: Home },
	{ value: 'transport', label: 'مواصلات', icon: Car },
	{ value: 'food', label: 'طعام', icon: ShoppingCart },
	{ value: 'healthcare', label: 'صحة', icon: Heart },
	{ value: 'entertainment', label: 'ترفيه', icon: Plane },
	{ value: 'travel', label: 'رحلات', icon: Plane },
	{ value: 'clothing', label: 'ملابس', icon: ShoppingCart },
	{ value: 'utilities', label: 'فواتير', icon: Zap },
	{ value: 'insurance', label: 'تأمين', icon: Shield },
	{ value: 'debt_payment', label: 'أقساط', icon: CreditCard },
	{ value: 'other_expense', label: 'أخرى', icon: DollarSign },
];

export const OBLIGATION_TYPE_LABELS: Record<string, string> = {
	loan: 'قرض',
	installment: 'قسط',
	credit_card: 'بطاقة ائتمان',
	mortgage: 'رهن عقاري',
};

export const OBLIGATION_STATUS_LABELS: Record<string, string> = {
	active: 'نشط',
	paid: 'مسدد',
	overdue: 'متأخر',
};

export const OBLIGATION_STATUS_COLORS: Record<string, string> = {
	active: 'bg-profit/10 text-profit border border-profit/20 ',
	paid: 'bg-whale text-whale/30 ',
	overdue: 'bg-loss/10 text-loss border border-loss/20 ',
};
