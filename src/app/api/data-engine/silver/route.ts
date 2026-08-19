import { NextResponse } from 'next/server';
import {
  getLatestSilverPrices,
  type DataEngineSilverPrice
} from '@/lib/data-engine-db';

export async function GET() {
  try {
    const prices = getLatestSilverPrices();

    // Group by country with metadata
    const countryInfo: Record<string, { currency: string; flag: string; name: string }> = {
      'مصر': { currency: 'EGP', flag: '🇪🇬', name: 'Egypt' },
      'السعودية': { currency: 'SAR', flag: '🇸🇦', name: 'Saudi Arabia' },
      'الكويت': { currency: 'KWD', flag: '🇰🇼', name: 'Kuwait' },
      'قطر': { currency: 'QAR', flag: '🇶🇦', name: 'Qatar' },
      'الإمارات': { currency: 'AED', flag: '🇦🇪', name: 'UAE' }
    };

    // Format prices
    const formattedPrices = prices.map(price => {
      const info = countryInfo[price.country] || { currency: price.currency, flag: '🌍', name: price.country };
      return {
        country: price.country,
        currency: price.currency,
        flag: info.flag,
        name: info.name,
        price_per_gram: price.price_per_gram,
        price_per_ounce: price.price_per_ounce,
        timestamp: price.timestamp
      };
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: prices.length,
      silver: formattedPrices
    });
  } catch (error) {
    console.error('Error reading silver data:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to read silver data: ' + (error instanceof Error ? error.message : String(error))
    }, { status: 500 });
  }
}
