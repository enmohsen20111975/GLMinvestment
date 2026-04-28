/**
 * Unified Scoring API
 * واجهة برمجة التطبيقات للنظام الموحد للتسجيل
 *
 * يجمع بين المحركات الثلاثة:
 * 1. analysis-engine - التحليل الفني والأساسي
 * 2. self-learning-engine - التعلّم من الصفقات الحقيقية
 * 3. market-learning-engine - التعلّم من البيانات التاريخية
 */

import { NextRequest, NextResponse } from 'next/server';
import { calculateUnifiedScore, recordRealTrade, type UnifiedScoreInput, type RealTradeResult } from '@/lib/v2/unified-scoring';
import { initialize, isInitialized } from '@/lib/sqlite-wrapper';
import { getStockByTicker, getPriceHistory } from '@/lib/egx-db';

// تهيئة عند أول استدعاء
let _initialized = false;
let _initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<boolean> {
  if (_initialized) return true;

  if (!isInitialized()) {
    if (_initPromise) {
      await _initPromise;
    } else {
      _initPromise = initialize();
      try {
        await _initPromise;
      } catch (e) {
        console.warn('[UnifiedScoring API] sql.js initialization failed:', e);
        return false;
      }
    }
  }

  _initialized = true;
  return true;
}

export async function GET(request: NextRequest) {
  const initResult = await ensureInitialized();

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'info';

  try {
    switch (action) {
      case 'info':
        return NextResponse.json({
          success: true,
          data: {
            name: 'Unified Scoring System',
            version: '1.0.0',
            description: 'يجمع بين التحليل الفني والتعلّم الذاتي والتعلّم من السوق',
            engines: [
              { name: 'analysis-engine', role: 'التحليل الفني والأساسي' },
              { name: 'self-learning-engine', role: 'التعلّم من الصفقات الحقيقية' },
              { name: 'market-learning-engine', role: 'التعلّم من البيانات التاريخية' }
            ],
            initialized: initResult
          }
        });

      case 'analyze':
        const ticker = searchParams.get('ticker');
        if (!ticker) {
          return NextResponse.json({
            success: false,
            error: 'ticker parameter required',
          }, { status: 400 });
        }

        if (!initResult) {
          return NextResponse.json({
            success: false,
            error: 'Database not initialized. Please try again in a moment.',
          }, { status: 503 });
        }

        try {
          // Get stock data
          const stock = getStockByTicker(ticker.toUpperCase());
          if (!stock) {
            return NextResponse.json({
              success: false,
              error: `Stock ${ticker} not found`,
            }, { status: 404 });
          }

          // Get price history
          const history = getPriceHistory(stock.id as number, 365);

          // Calculate unified score
          const result = await calculateUnifiedScore({
            ticker: stock.ticker as string,
            stockId: stock.id as number,
            currentPrice: stock.current_price as number,
            history: history as Array<Record<string, unknown>>,
            stockData: stock as Record<string, unknown>,
            marketADX: 25, // Default
            egx30Trend: 'neutral',
            egx30DownDays: 0,
            hasCBENews: false
          });

          return NextResponse.json({
            success: true,
            data: result
          });
        } catch (error) {
          console.error('[UnifiedScoring API] Analysis error:', error);
          return NextResponse.json({
            success: false,
            error: `Analysis failed: ${error}`,
          }, { status: 500 });
        }

      default:
        return NextResponse.json({
          success: false,
          error: `Unknown action: ${action}`,
          available_actions: ['info', 'analyze'],
        }, { status: 400 });
    }
  } catch (error) {
    console.error('[UnifiedScoring API] Error:', error);
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
      case 'analyze':
        // Analyze a stock with custom parameters
        const input = data as UnifiedScoreInput;
        const result = await calculateUnifiedScore(input);
        return NextResponse.json({
          success: true,
          data: result
        });

      case 'record-trade':
        // Record a real trade outcome for learning
        const tradeResult = data as RealTradeResult;
        recordRealTrade(tradeResult);
        return NextResponse.json({
          success: true,
          message: 'تم تسجيل الصفقة للتعلم'
        });

      default:
        return NextResponse.json({
          success: false,
          error: `Unknown action: ${action}`,
          available_actions: ['analyze', 'record-trade'],
        }, { status: 400 });
    }
  } catch (error) {
    console.error('[UnifiedScoring API] Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
    }, { status: 500 });
  }
}
