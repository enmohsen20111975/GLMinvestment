/**
 * POST /api/devil/filter
 * ======================
 * 😈 فلتر الشيطان للتوقعات
 *
 * يفحص أي توقع قبل ما يتنشر، ويرجع:
 * - approved (هل التوقع مقبول؟)
 * - reason (ليه؟)
 * - confidenceAdjustment (تعديل الثقة)
 * - warnings (تحذيرات الشيطان)
 *
 * الاستخدام:
 *   POST /api/devil/filter
 *   {
 *     ticker: "MEPA",
 *     signal: "BUY",
 *     confidence: 70,
 *     entryPrice: 3.86,
 *     targetPrice: 4.32,
 *     stopLoss: 3.67
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { runDevilFilter } from '@/lib/devil/devil-filter';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticker, signal, confidence, entryPrice, targetPrice, stopLoss, existingPredictions } = body;

    if (!ticker || !signal) {
      return NextResponse.json(
        { success: false, error: 'ticker و signal مطلوبين' },
        { status: 400 }
      );
    }

    const result = await runDevilFilter({
      ticker: String(ticker).toUpperCase(),
      signal,
      confidence: Number(confidence) || 50,
      entryPrice: entryPrice ? Number(entryPrice) : undefined,
      targetPrice: targetPrice ? Number(targetPrice) : undefined,
      stopLoss: stopLoss ? Number(stopLoss) : undefined,
      existingPredictions: existingPredictions || [],
    });

    return NextResponse.json({
      success: true,
      ticker: String(ticker).toUpperCase(),
      ...result,
    });
  } catch (error) {
    console.error('[devil/filter] Error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل في تشغيل فلتر الشيطان' },
      { status: 500 }
    );
  }
}
