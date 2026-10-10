/**
 * Admin API - استيراد بيانات EGX من EGXPilot
 * =============================================
 * يستورد بيانات الأسهم المصرية الحقيقية من EGXPilot API
 * ويحفظها في قاعدة البيانات
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';
import { requireAdminAsync } from '@/lib/admin-auth-server';

const EGXPILOT_API = 'https://egxpilot.com/api/stocks/all';

interface EGXPilotStock {
  StockName: string;
  Symbol: string;
  LastPrice: number;
  DailyChange: string;
  Recommendation: string;
  Daily: string;
  Weekly: string;
  Monthly: string;
  Sector?: string;
  ArabicName?: string;
  PrevClose?: number;
  OpenPrice?: number;
  High?: number;
  Low?: number;
  Volume?: number;
}

export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  const startTime = Date.now();
  
  try {
    console.log('[EGXPilot Import] Starting import...');
    
    // جلب البيانات من EGXPilot
    const response = await fetch(EGXPILOT_API, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'dalil-istithmar/1.0'
      },
      signal: AbortSignal.timeout(30000)
    });
    
    if (!response.ok) {
      throw new Error(`EGXPilot API returned ${response.status}`);
    }
    
    const data = await response.json();
    const stocks: EGXPilotStock[] = data.stocks || [];
    
    if (!stocks || stocks.length === 0) {
      throw new Error('No stocks received from EGXPilot');
    }
    
    console.log(`[EGXPilot Import] Received ${stocks.length} stocks`);
    
    // فلترة الأسهم الفعلية (استبعاد المؤشرات)
    const actualStocks = stocks.filter(s => 
      s.Symbol && 
      !s.Symbol.startsWith('.') && 
      s.LastPrice > 0
    );
    
    console.log(`[EGXPilot Import] ${actualStocks.length} actual stocks (excluded indices)`);
    
    let imported = 0;
    let updated = 0;
    let errors = 0;
    
    const now = new Date();
    
    // استيراد كل سهم
    for (const stock of actualStocks) {
      try {
        const ticker = stock.Symbol.toUpperCase();
        const name = stock.StockName || stock.ArabicName || ticker;
        const currentPrice = stock.LastPrice || 0;
        const changePercent = parseFloat(stock.DailyChange) || 0;
        
        // حساب السعر السابق
        let previousClose = stock.PrevClose || 0;
        if (!previousClose && currentPrice && changePercent) {
          previousClose = currentPrice / (1 + changePercent / 100);
        }
        
        // التحقق من وجود السهم
        const existing = await db.stocks.findUnique({
          where: { ticker }
        });
        
        const stockData = {
          ticker,
          name,
          name_ar: stock.ArabicName || name,
          current_price: currentPrice,
          previous_close: previousClose,
          open_price: stock.OpenPrice || currentPrice,
          high_price: stock.High || currentPrice,
          low_price: stock.Low || currentPrice,
          volume: stock.Volume || 0,
          sector: stock.Sector || null,
          last_update: now,
          price_change: currentPrice - previousClose,
          change_percent: changePercent
        };
        
        if (existing) {
          // تحديث السهم الموجود
          await db.stocks.update({
            where: { ticker },
            data: stockData
          });
          updated++;
        } else {
          // إنشاء سهم جديد
          await db.stocks.create({
            data: {
              id: `stock_${ticker}_${Date.now()}`,
              ...stockData
            }
          });
          imported++;
        }
        
      } catch (error) {
        errors++;
        console.error(`[EGXPilot Import] Error importing ${stock.Symbol}:`, error);
      }
    }
    
    const duration = Date.now() - startTime;
    
    console.log(`[EGXPilot Import] Completed in ${duration}ms: ${imported} imported, ${updated} updated, ${errors} errors`);
    
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      source: 'EGXPilot',
      total_received: stocks.length,
      actual_stocks: actualStocks.length,
      imported,
      updated,
      errors,
      duration_ms: duration
    });
    
  } catch (error) {
    console.error('[EGXPilot Import] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'internal_error'
    }, { status: 500 });
  }
}

/**
 * GET: فحص حالة الاستيراد
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const totalStocks = await db.stocks.count();
    const stocksWithPrice = await db.stocks.count({
      where: { 
        current_price: { gt: 0 } 
      }
    });
    
    const lastUpdate = await db.stocks.findFirst({
      orderBy: { last_update: 'desc' },
      select: { ticker: true, last_update: true, current_price: true }
    });
    
    return NextResponse.json({
      success: true,
      database_status: {
        total_stocks: totalStocks,
        stocks_with_prices: stocksWithPrice,
        last_update: lastUpdate?.last_update,
        last_updated_ticker: lastUpdate?.ticker
      },
      egxpilot_api: EGXPILOT_API
    });
    
  } catch (error) {
    console.error('[admin:import-egxpilot]', error);
    return NextResponse.json({
      success: false,
      error: 'internal_error'
    }, { status: 500 });
  }
}
