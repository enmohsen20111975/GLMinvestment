/**
 * Stock Icon Utility
 * 
 * Returns the URL for a stock icon if it exists, otherwise returns null.
 * Icons are stored in /public/stock-icons/{ticker}.svg
 *
 * ICON-AUTO-FIX (2026-10-10): شيلنا KNOWN_ICONS hardcoded list.
 * قبل كده: أي سهم جديد كان لازم يتضاف للـ list يدوياً = maintenance burden.
 * دلوقتي: بنرجّع URL دائماً + StockIcon component بيتعامل مع 404 (onError → fallback).
 * الأيقونات بتيجي تلقائياً من stock_logo_scraper.py (Python — Rule 20).
 */

/**
 * Known stock icon filenames — DEPRECATED (ICON-AUTO-FIX 2026-10-10).
 * شيلنا الـ list دي عشان:
 *   1. كل سهم جديد كان لازم يتضاف يدوياً = bug source
 *   2. الـ scraper بـ ينزّل أيقونات جديدة تلقائياً → الـ list بتـ تبقى stale
 *   3. الـ StockIcon component بيتعامل مع 404 (onError → fallback emoji)
 * بنسيب الـ export للـ backward compat بس.
 */
const KNOWN_ICONS = new Set<string>([]);

/**
 * Get the stock icon URL if it exists
 * @param ticker - Stock ticker symbol (e.g., "CIBC", "COMI", "ABUK")
 * @returns URL string if icon likely exists, null otherwise
 *
 * ICON-AUTO-FIX (2026-10-10): بنرجّع URL دائماً (بدل KNOWN_ICONS lookup).
 * الـ StockIcon component بيتعامل مع 404 تلقائياً (onError → fallback emoji).
 * ده يخلي أي سهم جديد (حتى اللي مش في KNOWN_ICONS) يحاول يحمل الأيقونة.
 */
export function getStockIconUrl(ticker: string, logoUrl?: string | null): string | null {
  if (logoUrl && logoUrl.trim()) return logoUrl.trim();
  if (!ticker) return null;

  // ICON-AUTO-FIX: شيلنا suffixes بتاعت السوق (.CA / .SR / .KW / .AE / .BH / .QA)
  // عشان كود السوق مينفعش يكون في اسم ملف الأيقونة.
  const cleanTicker = ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/i, '').trim();
  if (!cleanTicker) return null;

  // حاول uppercase ticker أولاً (COMI.svg)
  const upper = cleanTicker.toUpperCase();
  if (upper) {
    // بنرجّع URL دائماً — الـ component هيتعامل مع 404
    return `/stock-icons/${upper}.svg`;
  }

  return null;
}

/**
 * Get a fallback icon based on sector
 */
export function getSectorIcon(sector: string | null | undefined): string {
  const sectorLower = (sector || '').toLowerCase();
  
  if (sectorLower.includes('financial') || sectorLower.includes('banks') || sectorLower.includes('banking')) {
    return '🏦';
  } else if (sectorLower.includes('real estate') || sectorLower.includes('property')) {
    return '🏢';
  } else if (sectorLower.includes('basic materials') || sectorLower.includes('mining') || sectorLower.includes('materials')) {
    return '⛏️';
  } else if (sectorLower.includes('consumer') || sectorLower.includes('food') || sectorLower.includes('retail')) {
    return '🛒';
  } else if (sectorLower.includes('healthcare') || sectorLower.includes('pharma') || sectorLower.includes('medical')) {
    return '💊';
  } else if (sectorLower.includes('technology') || sectorLower.includes('telecom') || sectorLower.includes('it')) {
    return '💻';
  } else if (sectorLower.includes('energy') || sectorLower.includes('oil') || sectorLower.includes('gas')) {
    return '⛽';
  } else if (sectorLower.includes('industrials') || sectorLower.includes('manufacturing')) {
    return '🏭';
  } else if (sectorLower.includes('construction') || sectorLower.includes('building')) {
    return '🏗️';
  } else if (sectorLower.includes('crypto') || sectorLower.includes('digital')) {
    return '₿';
  } else if (sectorLower.includes('utilities')) {
    return '💡';
  } else if (sectorLower.includes('communication') || sectorLower.includes('media')) {
    return '📡';
  } else if (sectorLower.includes('automotive') || sectorLower.includes('auto')) {
    return '🚗';
  } else if (sectorLower.includes('travel') || sectorLower.includes('tourism')) {
    return '✈️';
  } else if (sectorLower.includes('agriculture') || sectorLower.includes('farming')) {
    return '🌾';
  } else {
    return '📈';
  }
}

/**
 * Stock Icon Component Props
 */
export interface StockIconProps {
  ticker: string;
  name?: string;
  sector?: string | null;
  logoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** NEW-STOCK-DETECTION (2026-10-10): لو true → بعرض شارة "جديد" فوق الأيقونة. */
  isNew?: boolean;
}

/**
 * Default stock icon size classes
 */
export const STOCK_ICON_SIZES = {
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
};
