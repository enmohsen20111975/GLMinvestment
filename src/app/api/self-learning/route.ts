/**
 * API للمرحلة الثانية: نظام التعلّم الذاتي
 * Self-Learning System API
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  initializePhase2Tables,
  initializeIndicatorTrustScores,
  logSignal,
  logTrade,
  closeTrade,
  getUnexecutedSignals,
  getAllIndicatorTrustScores,
  getLearnedLessons,
  mineLessons,
  calculateExpectancy,
  detectPatterns,
  runMirrorAnalysis,
  runDailyReview,
  runWeeklyReview,
  runMonthlyReview,
  getSelfLearningStats,
  checkTradingStatus,
  resolveTradingHalt,
  logFatalError,
  adjustMonthlyWeights,
  type SignalLog,
  type TradeLog,
  type CloseReason,
  type MarketPhase,
} from '@/lib/v2/self-learning-engine';
import { initialize, isInitialized } from '@/lib/sqlite-wrapper';

// تهيئة النظام عند أول استدعاء
let initialized = false;
let _initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<boolean> {
  if (initialized) return true;
  
  // Wait for sql.js to be initialized first
  if (!isInitialized()) {
    if (_initPromise) {
      await _initPromise;
    } else {
      _initPromise = initialize();
      try {
        await _initPromise;
      } catch (e) {
        console.warn('[SelfLearning API] sql.js initialization failed:', e);
        return false;
      }
    }
  }
  
  if (!initialized) {
    try {
      initializePhase2Tables();
      initializeIndicatorTrustScores();
      initialized = true;
    } catch (e) {
      console.warn('[SelfLearning API] Could not initialize self-learning:', e);
      return false;
    }
  }
  return true;
}

export async function GET(request: NextRequest) {
  const initResult = await ensureInitialized();
  if (!initResult) {
    return NextResponse.json({
      success: false,
      error: 'Database not initialized. Please try again in a moment.',
      data: null,
    }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'stats';

  try {
    switch (action) {
      case 'stats':
        return NextResponse.json({
          success: true,
          data: getSelfLearningStats(),
        });

      case 'indicators':
        return NextResponse.json({
          success: true,
          data: getAllIndicatorTrustScores(),
        });

      case 'lessons':
        const status = searchParams.get('status') as 'testing' | 'validated' | 'rejected' | undefined;
        return NextResponse.json({
          success: true,
          data: getLearnedLessons(status),
        });

      case 'signals':
        const limit = parseInt(searchParams.get('limit') || '50');
        return NextResponse.json({
          success: true,
          data: getUnexecutedSignals(limit),
        });

      case 'expectancy':
        const regime = searchParams.get('regime') as MarketPhase | undefined;
        return NextResponse.json({
          success: true,
          data: calculateExpectancy(regime),
        });

      case 'patterns':
        const months = parseInt(searchParams.get('months') || '1');
        return NextResponse.json({
          success: true,
          data: detectPatterns(months),
        });

      case 'trading-status':
        return NextResponse.json({
          success: true,
          data: checkTradingStatus(),
        });

      default:
        return NextResponse.json({
          success: false,
          error: `Unknown action: ${action}`,
        }, { status: 400 });
    }
  } catch (error) {
    console.error('[SelfLearning API] Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const initResult = await ensureInitialized();
  if (!initResult) {
    return NextResponse.json({
      success: false,
      error: 'Database not initialized. Please try again in a moment.',
    }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { action, data } = body;

    switch (action) {
      case 'log-signal':
        const signalId = logSignal(data as Omit<SignalLog, 'id' | 'created_at'>);
        return NextResponse.json({
          success: true,
          signal_id: signalId,
          message: 'تم تسجيل الإشارة بنجاح',
        });

      case 'log-trade':
        const tradeId = logTrade(data as Omit<TradeLog, 'id' | 'created_at'>);
        return NextResponse.json({
          success: true,
          trade_id: tradeId,
          message: 'تم تسجيل الصفقة بنجاح',
        });

      case 'close-trade':
        const closeResult = closeTrade(
          data.trade_id as number,
          data.exit_price as number,
          data.close_reason as CloseReason,
          data.context
        );
        return NextResponse.json({
          success: true,
          outcome: closeResult,
          message: 'تم إغلاق الصفقة بنجاح',
        });

      case 'run-mirror':
        const analysis = runMirrorAnalysis(data.trade_id as number);
        return NextResponse.json({
          success: true,
          analysis,
        });

      case 'mine-lessons':
        const newLessons = mineLessons();
        return NextResponse.json({
          success: true,
          lessons: newLessons,
          count: newLessons.length,
          message: `تم استخراج ${newLessons.length} درس جديد`,
        });

      case 'adjust-weights':
        const adjustments = adjustMonthlyWeights();
        return NextResponse.json({
          success: true,
          ...adjustments,
          message: `تم تعديل ${adjustments.applied} وزن`,
        });

      case 'daily-review':
        const dailyResult = runDailyReview();
        return NextResponse.json({
          success: true,
          result: dailyResult,
          message: 'تم تشغيل المراجعة اليومية',
        });

      case 'weekly-review':
        const weeklyResult = runWeeklyReview();
        return NextResponse.json({
          success: true,
          result: weeklyResult,
          message: 'تم تشغيل المراجعة الأسبوعية',
        });

      case 'monthly-review':
        const monthlyResult = runMonthlyReview();
        return NextResponse.json({
          success: true,
          result: monthlyResult,
          message: 'تم تشغيل المراجعة الشهرية',
        });

      case 'fatal-error':
        const fatalResult = logFatalError(
          data.trade_id as number,
          data.loss_percent as number,
          data.capital_impact_percent as number,
          data.consecutive_losses as number
        );
        return NextResponse.json({
          success: true,
          ...fatalResult,
          message: fatalResult.halt_trading
            ? 'تم إيقاف التداول - مراجعة طوارئ مطلوبة'
            : 'تم تسجيل الغلطة',
        });

      case 'resolve-halt':
        resolveTradingHalt(data.findings as string | undefined);
        return NextResponse.json({
          success: true,
          message: 'تم إنهاء إيقاف التداول',
        });

      case 'init':
        initializePhase2Tables();
        initializeIndicatorTrustScores();
        return NextResponse.json({
          success: true,
          message: 'تم تهيئة نظام التعلّم الذاتي',
        });

      default:
        return NextResponse.json({
          success: false,
          error: `Unknown action: ${action}`,
        }, { status: 400 });
    }
  } catch (error) {
    console.error('[SelfLearning API] Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
    }, { status: 500 });
  }
}
