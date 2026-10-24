import { NextRequest, NextResponse } from 'next/server';
import {
  getLatestCryptoPrices,
  getCryptoBySymbol,
  getLastCryptoUpdateTime,
  DataEngineCrypto,
} from '@/lib/data-engine-db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/data-engine/crypto
 * يقرأ بيانات العملات الرقمية من جدول crypto_prices في data_engine.db
 * (مش Python proxy — بيانات حقيقية من قاعدة البيانات المحلية)
 *
 * Query params:
 *  - symbol: لو موجود، بيرجع عملة واحدة بأحدث snapshot
 *  - limit: عدد العملات في أحدث snapshot (default 50)
 *  - all: لو "1"، بيرجع كل الصفوف (للتاريخ)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get('symbol');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const all = searchParams.get('all') === '1';

    // حالة: عملة واحدة
    if (symbol) {
      const coin = getCryptoBySymbol(symbol);
      if (!coin) {
        return NextResponse.json(
          { success: false, error: `Coin not found: ${symbol}` },
          { status: 404 }
        );
      }
      return NextResponse.json({
        success: true,
        data: coin,
        last_update: getLastCryptoUpdateTime(),
      });
    }

    // حالة: أحدث snapshot
    const prices: DataEngineCrypto[] = getLatestCryptoPrices(limit);

    return NextResponse.json({
      success: true,
      count: prices.length,
      last_update: getLastCryptoUpdateTime(),
      data: prices,
    });
  } catch (e) {
    console.error('[api/data-engine/crypto] error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
      },
      { status: 500 }
    );
  }
}
