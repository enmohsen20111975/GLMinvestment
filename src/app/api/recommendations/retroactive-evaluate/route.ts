import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

/**
 * Retroactive Evaluate API
 * تقييم التوقعات مقابل الأسعار التاريخية
 * 
 * يستخدم:
 * - real_predictions من predictions.db
 * - price_history.db للأسعار التاريخية
 */

export async function POST(request: NextRequest) {
  try {
    // فتح قواعد البيانات
    const predictionsDbPath = path.join(process.cwd(), 'db', 'predictions.db');
    const priceHistoryPath = path.join(process.cwd(), 'db', 'price_history.db');
    
    const predictionsDb = new Database(predictionsDbPath);
    let priceHistoryDb: Database.Database | null = null;
    
    try {
      priceHistoryDb = new Database(priceHistoryPath, { readonly: true });
    } catch (e) {
      console.error('[Retroactive] Cannot open price_history.db:', e);
    }

    const results = {
      evaluated: 0,
      hitTarget: 0,
      stoppedOut: 0,
      stillPending: 0,
      noPriceData: 0,
      errors: 0,
    };

    // جلب التوقعات المعلقة من real_predictions
    let predictions: any[] = [];
    try {
      predictions = predictionsDb.prepare(`
        SELECT * FROM real_predictions 
        WHERE hit_target = 0 AND hit_stop = 0
        ORDER BY signal_date DESC
      `).all() as any[];
    } catch {
      // جدول real_predictions غير موجود
    }

    console.log(`[Retroactive] Found ${predictions.length} pending predictions`);

    for (const pred of predictions) {
      try {
        const ticker = pred.ticker;
        
        // جلب السعر التاريخي من price_history.db
        let priceData: any[] = [];
        if (priceHistoryDb) {
          try {
            priceData = priceHistoryDb.prepare(`
              SELECT date, close, high, low
              FROM price_history 
              WHERE ticker = ? 
              ORDER BY date DESC 
              LIMIT 60
            `).all(ticker.toUpperCase()) as any[];
          } catch {
            // محاولة جدول آخر
            try {
              priceData = priceHistoryDb.prepare(`
                SELECT date, close_price as close, high_price as high, low_price as low
                FROM price_history 
                WHERE ticker = ? 
                ORDER BY date DESC 
                LIMIT 60
              `).all(ticker.toUpperCase()) as any[];
            } catch {
              // جدول مختلف
            }
          }
        }

        if (priceData.length === 0) {
          results.noPriceData++;
          continue;
        }

        // أحدث سعر
        const latestPrice = priceData[0];
        const entryPrice = pred.entry_price;
        const targetPrice = pred.target_price;
        const stopLoss = pred.stop_loss;
        const signalType = pred.signal_type;

        let hitTarget = 0;
        let hitStop = 0;
        let finalPrice: number | null = null;
        let maxProfit = 0;
        let maxLoss = 0;
        let closedAt: string | null = null;

        if (signalType === 'BUY') {
          // فحص إذا حقق الهدف أو وقف الخسارة
          for (const day of priceData) {
            if (targetPrice && day.high >= targetPrice) {
              hitTarget = 1;
              finalPrice = day.close;
              maxProfit = ((targetPrice - entryPrice) / entryPrice) * 100;
              closedAt = day.date;
              break;
            }
            if (stopLoss && day.low <= stopLoss) {
              hitStop = 1;
              finalPrice = day.close;
              maxLoss = ((stopLoss - entryPrice) / entryPrice) * 100;
              closedAt = day.date;
              break;
            }
          }
        } else if (signalType === 'SELL') {
          // للبيع: الهدف هو انخفاض السعر
          for (const day of priceData) {
            if (targetPrice && day.low <= targetPrice) {
              hitTarget = 1;
              finalPrice = day.close;
              maxProfit = ((entryPrice - targetPrice) / entryPrice) * 100;
              closedAt = day.date;
              break;
            }
            if (stopLoss && day.high >= stopLoss) {
              hitStop = 1;
              finalPrice = day.close;
              maxLoss = ((entryPrice - stopLoss) / entryPrice) * 100;
              closedAt = day.date;
              break;
            }
          }
        }

        // تحديث التوقع إذا تم الوصول للنتيجة
        if (hitTarget || hitStop) {
          results.evaluated++;
          if (hitTarget) results.hitTarget++;
          if (hitStop) results.stoppedOut++;
          
          predictionsDb.prepare(`
            UPDATE real_predictions 
            SET hit_target = ?, hit_stop = ?, final_price = ?, max_profit = ?, max_loss = ?, closed_at = ?
            WHERE id = ?
          `).run(hitTarget, hitStop, finalPrice, maxProfit, maxLoss, closedAt, pred.id);
        } else {
          results.stillPending++;
        }
      } catch (err) {
        console.error(`[Retroactive] Error processing prediction ${pred.id}:`, err);
        results.errors++;
      }
    }

    // إغلاق قواعد البيانات
    predictionsDb.close();
    if (priceHistoryDb) priceHistoryDb.close();

    return NextResponse.json({
      success: true,
      message: `تم تقييم ${results.evaluated} توقع: ${results.hitTarget} حققت الهدف، ${results.stoppedOut} وقف خسارة، ${results.stillPending} معلقة`,
      results,
    });
  } catch (error) {
    console.error('[Retroactive Evaluate] Error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
