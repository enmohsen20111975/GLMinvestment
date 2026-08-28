/**
 * Seed Predictions API — DISABLED (2026-08-28)
 *
 * Previously generated FAKE predictions with random prices/signals.
 * This is a financial platform — fake predictions = legal liability.
 *
 * Also: aiPrediction table was DROPPED in Phase D (dead table cleanup).
 * Use V40.2 generator (jobs/v40_2_daily_generator.py) for real predictions.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  return NextResponse.json({
    success: false,
    disabled: true,
    error: 'تم إيقاف توليد التوقعات المُصطنعة — هذا تطبيق إنتاجي',
    message: 'Prediction seeder removed. Use V40.2 generator for real predictions.',
  }, { status: 410 });
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    success: false,
    disabled: true,
    error: 'تم إيقاف توليد التوقعات المُصطنعة',
    message: 'Use /api/admin/backtest/v40/stats for real prediction stats.',
  }, { status: 410 });
}
