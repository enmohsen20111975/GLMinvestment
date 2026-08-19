/**
 * Mobile Currency API - Exchange Rates
 * أسعار العملات
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export async function GET(request: NextRequest) {
  try {
    // 1. Try Python backend currency list
    const response = await fetch(`${PYTHON_BACKEND_URL}/api/currency/list`, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json();

      // Convert currencies object to rates array for mobile
      const currencies = data.currencies || {};
      const rates: any[] = [];

      // Common currencies with typical EGP rates
      const defaultRates: Record<string, number> = {
        'USD': 50.5,
        'EUR': 54.8,
        'GBP': 64.2,
        'SAR': 13.5,
        'AED': 13.8,
        'KWD': 165.0,
        'QAR': 13.9,
        'JPY': 0.33,
      };

      for (const [code, info] of Object.entries(currencies)) {
        const currencyInfo = info as any;
        rates.push({
          code,
          name: currencyInfo.name || code,
          name_ar: currencyInfo.name_ar || currencyInfo.name || code,
          symbol: currencyInfo.symbol || '',
          rate_to_egp: defaultRates[code] || 1,
        });
      }

      return NextResponse.json({
        success: true,
        timestamp: new Date().toISOString(),
        count: rates.length,
        rates,
        base_currency: 'EGP',
        source: 'python_backend',
      });
    }
  } catch (error) {
    console.warn('[Mobile Currency API] Python backend error:', error);
  }

  // 2. Fallback: Return static rates
  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    count: 6,
    rates: [
      { code: 'USD', name: 'US Dollar', name_ar: 'دولار أمريكي', symbol: '$', rate_to_egp: 50.5 },
      { code: 'EUR', name: 'Euro', name_ar: 'يورو', symbol: '€', rate_to_egp: 54.8 },
      { code: 'GBP', name: 'British Pound', name_ar: 'جنيه إسترليني', symbol: '£', rate_to_egp: 64.2 },
      { code: 'SAR', name: 'Saudi Riyal', name_ar: 'ريال سعودي', symbol: '﷼', rate_to_egp: 13.5 },
      { code: 'AED', name: 'UAE Dirham', name_ar: 'درهم إماراتي', symbol: 'د.إ', rate_to_egp: 13.8 },
      { code: 'KWD', name: 'Kuwaiti Dinar', name_ar: 'دينار كويتي', symbol: 'د.ك', rate_to_egp: 165.0 },
    ],
    base_currency: 'EGP',
    source: 'fallback',
  });
}
