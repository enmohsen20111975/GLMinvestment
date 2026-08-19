/**
 * Seed Predictions API
 * إنشاء بيانات تجريبية للتوقعات
 */

import { NextRequest, NextResponse } from 'next/server';
import { predictionsDb } from '@/lib/db-predictions';

// بيانات الأسهم التجريبية
const SAMPLE_STOCKS = [
  { symbol: 'COMI', name: 'بنك مصر التجاري الدولي', market: 'EGX' },
  { symbol: 'ETAL', name: 'المتحدة للعقارات', market: 'EGX' },
  { symbol: 'EGX30', name: 'مؤشر EGX30', market: 'EGX' },
  { symbol: 'AMOC', name: 'الإسكندرية للمواد الغذائية', market: 'EGX' },
  { symbol: 'ESRS', name: 'الشرقية للدخان', market: 'EGX' },
  { symbol: 'HRHO', name: 'هيرميس القابضة', market: 'EGX' },
  { symbol: 'TMGH', name: 'تداول القابضة', market: 'EGX' },
  { symbol: 'FWRY', name: 'فوري', market: 'EGX' },
  // الأسهم السعودية
  { symbol: '2222.SR', name: 'أرامكو السعودية', market: 'TADAWUL' },
  { symbol: '1120.SR', name: 'بنك الراجحي', market: 'TADAWUL' },
  { symbol: '1180.SR', name: 'سامبا', market: 'TADAWUL' },
  // الأسهم الكويتية
  { symbol: 'CBK.KW', name: 'بنك الكويت المركزي', market: 'KSE' },
  { symbol: 'NBK.KW', name: 'بنك الكويت الوطني', market: 'KSE' },
  // الأسهم القطرية
  { symbol: 'QNBK.QA', name: 'بنك قطر الوطني', market: 'QSE' },
  // الأسهم الإماراتية
  { symbol: 'DFM.DFM', name: 'سوق دبي المالي', market: 'DFM' },
  { symbol: 'EMIRATES.ADX', name: 'طيران الإمارات', market: 'ADX' },
];

const SIGNAL_TYPES = ['BUY', 'SELL', 'HOLD'];
const RECOMMENDATIONS_AR = {
  'BUY': 'شراء',
  'SELL': 'بيع',
  'HOLD': 'احتفاظ'
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const count = body.count || 15;
    
    const predictions = [];
    
    for (let i = 0; i < count; i++) {
      const stock = SAMPLE_STOCKS[i % SAMPLE_STOCKS.length];
      const signal = SIGNAL_TYPES[Math.floor(Math.random() * SIGNAL_TYPES.length)];
      const entryPrice = Math.round((Math.random() * 100 + 10) * 100) / 100;
      const targetMultiplier = signal === 'BUY' ? 1.1 : signal === 'SELL' ? 0.9 : 1;
      const stopMultiplier = signal === 'BUY' ? 0.95 : signal === 'SELL' ? 1.05 : 1;
      
      const prediction = await predictionsDb.aiPrediction.create({
        data: {
          id: `pred_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 5)}`,
          stock_symbol: stock.symbol,
          stock_name_ar: stock.name,
          signal_type: signal,
          confidence: Math.round((Math.random() * 40 + 60) * 10) / 10, // 60-100%
          entry_price: entryPrice,
          target_price: Math.round(entryPrice * targetMultiplier * 100) / 100,
          stop_loss: Math.round(entryPrice * stopMultiplier * 100) / 100,
          prediction_date: new Date().toISOString().split('T')[0],
          status: 'PENDING',
          maestro_score: Math.round(Math.random() * 40 + 60), // 60-100
          regime: Math.random() > 0.5 ? 'bull' : Math.random() > 0.5 ? 'bear' : 'range',
          notes: `توقع ${RECOMMENDATIONS_AR[signal as keyof typeof RECOMMENDATIONS_AR]} للسهم ${stock.name}`,
        }
      });
      
      predictions.push(prediction);
    }
    
    return NextResponse.json({
      success: true,
      message: `تم إنشاء ${predictions.length} توقع تجريبي`,
      predictions
    });
    
  } catch (error: any) {
    console.error('Seed predictions error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  // Return current predictions count
  try {
    const count = await predictionsDb.aiPrediction.count();
    
    return NextResponse.json({
      success: true,
      count,
      message: count === 0 
        ? 'لا توجد توقعات - استخدم POST لإنشاء بيانات تجريبية'
        : `يوجد ${count} توقع في قاعدة البيانات`
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
