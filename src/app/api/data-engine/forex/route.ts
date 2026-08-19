import { NextResponse } from 'next/server';
import {
  getLatestExchangeRates,
  type DataEngineExchangeRate
} from '@/lib/data-engine-db';

export async function GET() {
  try {
    const rates = getLatestExchangeRates();

    // Currency info
    const currencyInfo: Record<string, { name: string; flag: string; country: string }> = {
      'EGP': { name: 'جنيه مصري', flag: '🇪🇬', country: 'مصر' },
      'SAR': { name: 'ريال سعودي', flag: '🇸🇦', country: 'السعودية' },
      'KWD': { name: 'دينار كويتي', flag: '🇰🇼', country: 'الكويت' },
      'QAR': { name: 'ريال قطري', flag: '🇶🇦', country: 'قطر' },
      'AED': { name: 'درهم إماراتي', flag: '🇦🇪', country: 'الإمارات' },
      'BHD': { name: 'دينار بحريني', flag: '🇧🇭', country: 'البحرين' },
      'OMR': { name: 'ريال عماني', flag: '🇴🇲', country: 'عمان' },
      'JOD': { name: 'دينار أردني', flag: '🇯🇴', country: 'الأردن' },
      'LBP': { name: 'ليرة لبنانية', flag: '🇱🇧', country: 'لبنان' },
      'IQD': { name: 'دينار عراقي', flag: '🇮🇶', country: 'العراق' },
      'MAD': { name: 'درهم مغربي', flag: '🇲🇦', country: 'المغرب' },
      'TND': { name: 'دينار تونسي', flag: '🇹🇳', country: 'تونس' },
      'DZD': { name: 'دينار جزائري', flag: '🇩🇿', country: 'الجزائر' },
      'SDG': { name: 'جنيه سوداني', flag: '🇸🇩', country: 'السودان' }
    };

    // Format rates
    const formattedRates: Record<string, {
      currency: string;
      rate_to_usd: number | null;
      name: string;
      flag: string;
      country: string;
    }> = {};

    for (const rate of rates) {
      const info = currencyInfo[rate.currency] || { name: rate.currency, flag: '💱', country: '' };
      formattedRates[rate.currency] = {
        currency: rate.currency,
        rate_to_usd: rate.rate_to_usd,
        name: info.name,
        flag: info.flag,
        country: info.country
      };
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: rates.length,
      data: {
        base: 'USD',
        rates: formattedRates
      }
    });
  } catch (error) {
    console.error('Error reading forex data:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to read forex data: ' + (error instanceof Error ? error.message : String(error))
    }, { status: 500 });
  }
}
