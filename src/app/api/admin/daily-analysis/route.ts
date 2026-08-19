/**
 * Admin Daily Analysis API
 * =========================
 * API لإدارة التحليل اليومي - يستدعي Python Backend
 * 
 * ⚠️ للأدمن فقط - المستخدمين العاديين لا يمكنهم الوصول
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminAsync } from '@/lib/admin-auth-server';

// Python Backend URL
const PYTHON_BACKEND_URL = 'http://127.0.0.1:8010';

// ==================== Helper Functions ====================

/**
 * استدعاء Python Backend للتحليل الشامل
 */
async function callPythonScanner(config: {
  batch_size?: number;
  delay_between_batches?: number;
  min_volume?: number;
  include_dead_stocks?: boolean;
}): Promise<any> {
  const response = await fetch(`${PYTHON_BACKEND_URL}/api/advanced-scanner/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal: AbortSignal.timeout(600000) // 10 minutes timeout
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `Python Backend returned ${response.status}`);
  }

  return response.json();
}

/**
 * استدعاء Python Backend للفحص السريع
 * Uses the fast scanner endpoint for quick results
 */
async function callPythonQuickScan(limit: number = 20): Promise<any> {
  // Use the FAST scanner endpoint
  const response = await fetch(`${PYTHON_BACKEND_URL}/api/scanner/quick?limit=${limit}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000) // 15 seconds timeout (should be much faster)
  });

  if (!response.ok) {
    throw new Error(`Python Backend returned ${response.status}`);
  }

  return response.json();
}

/**
 * حفظ النتائج في قاعدة البيانات
 */
async function saveResultsToDatabase(results: any[], scanDate: string, durationMs: number) {
  // حذف النتائج القديمة لنفس اليوم
  await db.advancedAnalysisResult.deleteMany({
    where: { scan_date: scanDate }
  });

  // حفظ النتائج الجديدة
  for (const result of results) {
    try {
      await db.advancedAnalysisResult.create({
        data: {
          ticker: result.symbol,
          name: result.name,
          asset_type: 'stock',
          is_alive: result.is_alive,
          vitality_score: result.vitality_score,
          vitality_reasons: JSON.stringify([]),
          current_price: result.price,
          change_percent: result.change_percent || 0,
          volume: result.volume || 0,
          trend: result.trend,
          trend_ar: result.trend_ar,
          overall_score: result.overall_score,
          rsi: result.rsi,
          rsi_signal: result.rsi_signal,
          macd_signal: result.macd_signal,
          bollinger_position: result.bollinger_position,
          stochastic_k: result.stochastic_k,
          sma_20: result.sma_20,
          sma_50: result.sma_50,
          recommendation: result.recommendation,
          recommendation_ar: result.recommendation_ar,
          recommendation_score: result.overall_score,
          entry_price: result.entry_price,
          stop_loss: result.stop_loss,
          take_profit_1: result.take_profit_1,
          risk_level: result.risk_level,
          scan_date: scanDate,
          scan_timestamp: new Date().toISOString()
        }
      });
    } catch (e) {
      // Skip errors
    }
  }

  // حفظ الملخص
  const aliveStocks = results.filter(r => r.is_alive);
  const buyOpportunities = results.filter(r => ['BUY', 'STRONG_BUY', 'ACCUMULATE'].includes(r.recommendation));
  const sellOpportunities = results.filter(r => ['SELL', 'STRONG_SELL', 'REDUCE'].includes(r.recommendation));

  const topBuy = buyOpportunities
    .sort((a, b) => b.overall_score - a.overall_score)
    .slice(0, 10)
    .map(r => r.symbol);

  const topSell = sellOpportunities
    .sort((a, b) => a.overall_score - b.overall_score)
    .slice(0, 10)
    .map(r => r.symbol);

  const highestScoreStock = results.reduce((max, r) => r.overall_score > max.overall_score ? r : max, results[0]);

  await db.dailyAnalysisSummary.upsert({
    where: { scan_date: scanDate },
    update: {
      total_stocks: results.length,
      alive_stocks: aliveStocks.length,
      dead_stocks: results.length - aliveStocks.length,
      buy_opportunities: buyOpportunities.length,
      sell_opportunities: sellOpportunities.length,
      avg_score: results.reduce((sum, r) => sum + r.overall_score, 0) / results.length,
      highest_score: highestScoreStock?.overall_score || 0,
      highest_score_ticker: highestScoreStock?.symbol || null,
      top_buy_tickers: JSON.stringify(topBuy),
      top_sell_tickers: JSON.stringify(topSell),
      scan_timestamp: new Date().toISOString(),
      duration_ms: durationMs,
      status: 'completed'
    },
    create: {
      scan_date: scanDate,
      total_stocks: results.length,
      alive_stocks: aliveStocks.length,
      dead_stocks: results.length - aliveStocks.length,
      buy_opportunities: buyOpportunities.length,
      sell_opportunities: sellOpportunities.length,
      avg_score: results.reduce((sum, r) => sum + r.overall_score, 0) / results.length,
      highest_score: highestScoreStock?.overall_score || 0,
      highest_score_ticker: highestScoreStock?.symbol || null,
      top_buy_tickers: JSON.stringify(topBuy),
      top_sell_tickers: JSON.stringify(topSell),
      scan_timestamp: new Date().toISOString(),
      duration_ms: durationMs,
      status: 'completed'
    }
  });
}

// ==================== API Handlers ====================

/**
 * GET: الحصول على سجل الفحوصات أو حالة الفحص الحالي
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action');
    const date = searchParams.get('date');
    
    // الحصول على حالة الفحص الحالي من Python
    if (action === 'status') {
      try {
        const response = await fetch(`${PYTHON_BACKEND_URL}/api/advanced-scanner/status`, {
          signal: AbortSignal.timeout(5000)
        });
        const status = await response.json();
        return NextResponse.json(status);
      } catch {
        return NextResponse.json({
          success: false,
          error: 'Python Backend غير متاح'
        }, { status: 503 });
      }
    }
    
    // الحصول على سجل الفحوصات
    if (action === 'history') {
      const summaries = await db.dailyAnalysisSummary.findMany({
        orderBy: { scan_date: 'desc' },
        take: 30
      });
      
      return NextResponse.json({
        success: true,
        history: summaries
      });
    }
    
    // الحصول على نتائج فحص معين
    if (date) {
      const results = await db.advancedAnalysisResult.findMany({
        where: { scan_date: date },
        orderBy: { overall_score: 'desc' }
      });
      
      return NextResponse.json({
        success: true,
        date,
        count: results.length,
        results
      });
    }
    
    // الحصول على آخر فحص
    const latestSummary = await db.dailyAnalysisSummary.findFirst({
      orderBy: { scan_date: 'desc' }
    });
    
    let latestResults: any[] = [];
    if (latestSummary) {
      latestResults = await db.advancedAnalysisResult.findMany({
        where: { scan_date: latestSummary.scan_date },
        orderBy: { overall_score: 'desc' },
        take: 50
      });
    }
    
    return NextResponse.json({
      success: true,
      latest_summary: latestSummary,
      latest_results: latestResults
    });
    
  } catch (error) {
    console.error('[Daily Analysis GET] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'حدث خطأ في جلب البيانات'
    }, { status: 500 });
  }
}

/**
 * POST: تشغيل فحص يومي جديد (عبر Python Backend)
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const {
      batchSize = 10,
      delayMs = 2000,
      minVolume = 10000,
      includeDeadStocks = false,
      saveToDatabase = true
    } = body;
    
    console.log('[Daily Analysis] Starting scan via Python Backend...');
    console.log(`[Daily Analysis] Config: batch_size=${batchSize}, delay=${delayMs}ms`);
    
    // استدعاء Python Backend للتحليل
    const scanResult = await callPythonScanner({
      batch_size: batchSize,
      delay_between_batches: delayMs,
      min_volume: minVolume,
      include_dead_stocks: includeDeadStocks
    });
    
    console.log(`[Daily Analysis] Python scan completed in ${scanResult.duration_ms}ms`);
    console.log(`[Daily Analysis] Results: ${scanResult.results?.length || 0}`);
    
    // حفظ في قاعدة البيانات
    if (saveToDatabase && scanResult.results) {
      await saveResultsToDatabase(
        scanResult.results,
        scanResult.scan_date,
        scanResult.duration_ms
      );
      console.log('[Daily Analysis] Results saved to database');
    }
    
    return NextResponse.json({
      success: true,
      scan_date: scanResult.scan_date,
      scan_timestamp: scanResult.scan_timestamp,
      duration_ms: scanResult.duration_ms,
      batches_processed: scanResult.batches_processed,
      statistics: {
        total_stocks: scanResult.total_stocks,
        alive_stocks: scanResult.alive_stocks,
        dead_stocks: scanResult.dead_stocks,
        buy_opportunities: scanResult.buy_opportunities,
        sell_opportunities: scanResult.sell_opportunities
      },
      opportunities: {
        buy: scanResult.results?.filter((r: any) => 
          ['BUY', 'STRONG_BUY', 'ACCUMULATE'].includes(r.recommendation)
        ).slice(0, 20) || [],
        sell: scanResult.results?.filter((r: any) => 
          ['SELL', 'STRONG_SELL', 'REDUCE'].includes(r.recommendation)
        ).slice(0, 20) || []
      },
      top_opportunities: scanResult.top_opportunities || []
    });
    
  } catch (error) {
    console.error('[Daily Analysis POST] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'حدث خطأ في الفحص',
      details: String(error)
    }, { status: 500 });
  }
}

/**
 * DELETE: حذف نتائج فحص معين
 */
export async function DELETE(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date');
    
    if (!date) {
      return NextResponse.json({
        success: false,
        error: 'التاريخ مطلوب'
      }, { status: 400 });
    }
    
    // حذف النتائج
    const deletedResults = await db.advancedAnalysisResult.deleteMany({
      where: { scan_date: date }
    });
    
    // حذف الملخص
    try {
      await db.dailyAnalysisSummary.delete({
        where: { scan_date: date }
      });
    } catch {
      // Ignore if not found
    }
    
    return NextResponse.json({
      success: true,
      deleted_results: deletedResults.count
    });
    
  } catch (error) {
    console.error('[Daily Analysis DELETE] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'حدث خطأ في الحذف'
    }, { status: 500 });
  }
}
