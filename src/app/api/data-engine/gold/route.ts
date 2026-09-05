import { NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import {
  getLatestGoldPrices,
  getGoldPricesByCountry,
  marketCodeToArabic,
  type DataEngineGoldPrice
} from '@/lib/data-engine-db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const country = searchParams.get('country');

    let prices: DataEngineGoldPrice[];

    if (country) {
      prices = getGoldPricesByCountry(country);
    } else {
      prices = getLatestGoldPrices();
    }

    // Group by country with metadata
    const countryInfo: Record<string, { currency: string; flag: string; name: string }> = {
      'مصر': { currency: 'EGP', flag: '🇪🇬', name: 'Egypt' },
      'السعودية': { currency: 'SAR', flag: '🇸🇦', name: 'Saudi Arabia' },
      'الكويت': { currency: 'KWD', flag: '🇰🇼', name: 'Kuwait' },
      'قطر': { currency: 'QAR', flag: '🇶🇦', name: 'Qatar' },
      'الإمارات': { currency: 'AED', flag: '🇦🇪', name: 'UAE' },
      'البحرين': { currency: 'BHD', flag: '🇧🇭', name: 'Bahrain' },
      'الأردن': { currency: 'JOD', flag: '🇯🇴', name: 'Jordan' },
      'لبنان': { currency: 'LBP', flag: '🇱🇧', name: 'Lebanon' },
      'العراق': { currency: 'IQD', flag: '🇮🇶', name: 'Iraq' },
      'عمان': { currency: 'OMR', flag: '🇴🇲', name: 'Oman' },
      'المغرب': { currency: 'MAD', flag: '🇲🇦', name: 'Morocco' },
      'تونس': { currency: 'TND', flag: '🇹🇳', name: 'Tunisia' },
      'الجزائر': { currency: 'DZD', flag: '🇩🇿', name: 'Algeria' },
      'السودان': { currency: 'SDG', flag: '🇸🇩', name: 'Sudan' }
    };

    // Group prices by country
    const groupedPrices: Record<string, {
      currency: string;
      flag: string;
      name: string;
      prices: { karat: string; price_per_gram: number | null; price_per_ounce: number | null }[];
    }> = {};

    for (const price of prices) {
      const info = countryInfo[price.country] || { currency: price.currency, flag: '🌍', name: price.country };

      if (!groupedPrices[price.country]) {
        groupedPrices[price.country] = {
          currency: info.currency,
          flag: info.flag,
          name: info.name,
          prices: []
        };
      }

      groupedPrices[price.country].prices.push({
        karat: price.karat,
        price_per_gram: price.price_per_gram,
        price_per_ounce: price.price_per_ounce
      });
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: prices.length,
      countries: Object.keys(groupedPrices).length,
      gold: groupedPrices
    });
  } catch (error) {
    console.error('Error reading gold data:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to read gold data: ' + (error instanceof Error ? error.message : String(error))
    }, { status: 500 });
  }
}
