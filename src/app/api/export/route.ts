import { NextRequest, NextResponse } from 'next/server';
import {
  ensureInitialized,
  getStocks,
  getMarketIndices,
  getMarketOverviewStats,
  getSectorStats,
  getAllStockAnalyses,
} from '@/lib/egx-db';

// ---------------------------------------------------------------------------
// CSV helper
// ---------------------------------------------------------------------------

function generateCSV(headers: string[], rows: string[][]): string {
  const BOM = '\uFEFF'; // UTF-8 BOM for Arabic text
  const headerLine = headers.join(',');
  const dataLines = rows.map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  );
  return BOM + headerLine + '\n' + dataLines.join('\n');
}

// ---------------------------------------------------------------------------
// GET /api/export?type=stocks|recommendations|market-summary|ai-adjustment&format=csv|json
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    await ensureInitialized();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'stocks';
    const format = searchParams.get('format') || 'csv';
    const today = new Date().toISOString().split('T')[0];

    if (
      !['stocks', 'watchlist', 'portfolio', 'market-summary', 'recommendations', 'ai-adjustment'].includes(type)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            'نوع التصدير غير صالح. الأنواع المدعومة: stocks, recommendations, ai-adjustment, market-summary, watchlist, portfolio',
        },
        { status: 400 }
      );
    }

    if (!['csv', 'json'].includes(format)) {
      return NextResponse.json(
        { success: false, error: 'صيغة غير صالحة. الصيغ المدعومة: csv, json' },
        { status: 400 }
      );
    }

    let data: Record<string, unknown>;
    let csvResult: string | null = null;

    switch (type) {
      case 'stocks': {
        const { stocks } = getStocks({ page_size: 500, is_active: true });
        const mappedStocks = stocks.map((s) => ({
          ticker: s.ticker || '',
          name: s.name || '',
          name_ar: s.name_ar || '',
          sector: s.sector || '',
          current_price: Number(s.current_price) || 0,
          price_change: Number(s.price_change) || 0,
          volume: Number(s.volume) || 0,
          market_cap: Number(s.market_cap) || 0,
          pe_ratio: Number(s.pe_ratio) || 0,
          pb_ratio: Number(s.pb_ratio) || 0,
          dividend_yield: Number(s.dividend_yield) || 0,
          eps: Number(s.eps) || 0,
          roe: Number(s.roe) || 0,
          debt_to_equity: Number(s.debt_to_equity) || 0,
          rsi: Number(s.rsi) || 0,
          ma_50: Number(s.ma_50) || 0,
          ma_200: Number(s.ma_200) || 0,
          support_level: Number(s.support_level) || 0,
          resistance_level: Number(s.resistance_level) || 0,
          egx30_member: s.egx30_member === 1 ? 'نعم' : 'لا',
          egx70_member: s.egx70_member === 1 ? 'نعم' : 'لا',
          egx100_member: s.egx100_member === 1 ? 'نعم' : 'لا',
        }));

        data = {
          export_type: 'stocks',
          export_date: today,
          total_records: mappedStocks.length,
          stocks: mappedStocks,
        };

        if (format === 'csv') {
          const headers = [
            'الرمز',
            'الاسم',
            'الاسم بالعربي',
            'القطاع',
            'السعر الحالي',
            'التغير%',
            'الحجم',
            'القيمة السوقية',
            'P/E',
            'P/B',
            'عائد التوزيعات',
            'EPS',
            'ROE',
            'الدين/حقوق الملكية',
            'RSI',
            'MA50',
            'MA200',
            'الدعم',
            'المقاومة',
            'EGX30',
            'EGX70',
            'EGX100',
          ];
          const rows = mappedStocks.map((s) => [
            s.ticker,
            s.name,
            s.name_ar,
            s.sector,
            s.current_price,
            s.price_change.toFixed(2),
            s.volume,
            s.market_cap,
            s.pe_ratio,
            s.pb_ratio,
            s.dividend_yield,
            s.eps,
            s.roe,
            s.debt_to_equity,
            s.rsi,
            s.ma_50,
            s.ma_200,
            s.support_level,
            s.resistance_level,
            s.egx30_member,
            s.egx70_member,
            s.egx100_member,
          ]);
          csvResult = generateCSV(headers, rows);
        }
        break;
      }

      case 'ai-adjustment': {
        // Comprehensive export for AI readjustment
        // Includes all recommendation fields + news sentiment placeholders
        const analyses = getAllStockAnalyses();
        const mapped = analyses.map((a) => {
          const scores = a.scores as Record<string, unknown> | undefined;
          const rec = a.recommendation as Record<string, unknown> | undefined;
          const trend = a.trend as Record<string, unknown> | undefined;
          const exec = a.execution_plan as Record<string, unknown> | undefined;
          const probabilities = a.probabilities as Record<string, unknown> | undefined;
          const adminOverride = a.insights_payload
            ? (() => {
                try {
                  const payload =
                    typeof a.insights_payload === 'string'
                      ? JSON.parse(a.insights_payload)
                      : a.insights_payload;
                  return (payload as Record<string, unknown>)?.admin_override || {};
                } catch {
                  return {};
                }
              })()
            : {};

          return {
            // Required for import matching
            ticker: a.ticker || '',
            // Current market data
            name: a.name || '',
            name_ar: a.name_ar || '',
            sector: a.sector || '',
            current_price: Number(a.current_price) || 0,
            price_change: Number(a.price_change) || 0,
            // Current recommendation (AI-calculated)
            recommendation_action: (rec?.action as string) || '',
            recommendation_ar: (rec?.action_ar as string) || '',
            confidence_score: Number(rec?.confidence_score || scores?.total_score || 0),
            // Scores
            total_score: Number(scores?.total_score || 0),
            technical_score: Number(scores?.technical_score || 0),
            fundamental_score: Number(scores?.fundamental_score || 0),
            risk_score: Number(scores?.risk_score || 0),
            // Trend
            trend_direction: (trend?.direction as string) || '',
            // Price targets
            target_price: Number(rec?.target_price || exec?.target_price || 0),
            stop_loss: Number(rec?.stop_loss || exec?.stop_loss || 0),
            entry_price: Number(rec?.entry_price || exec?.entry_price || 0),
            time_horizon: (rec?.time_horizon || exec?.time_horizon || '') as string,
            // Probabilities
            probability_bullish: Number(probabilities?.bullish || 0),
            probability_bearish: Number(probabilities?.bearish || 0),
            probability_neutral: Number(probabilities?.neutral || 0),
            // News sentiment (for AI to fill)
            news_sentiment: (adminOverride.news_sentiment as string) || '',
            news_impact: (adminOverride.news_impact as string) || '',
            // Admin notes (for AI to fill)
            notes: (adminOverride.notes as string) || '',
          };
        });

        data = {
          export_type: 'ai-adjustment',
          export_date: today,
          total_records: mapped.length,
          instructions_ar:
            'ملف لتعديل التحليلات بواسطة الذكاء الاصطناعي. عدل الحقول التالية وأعد استيرادها: recommendation_action, recommendation_ar, confidence_score, total_score, technical_score, fundamental_score, risk_score, trend_direction, target_price, stop_loss, entry_price, time_horizon, news_sentiment, news_impact, notes. الحقول الإلزامية: ticker (لا تغيره).',
          instructions_en:
            'File for AI-based recommendation adjustment. Modify these fields and re-import: recommendation_action, recommendation_ar, confidence_score, total_score, technical_score, fundamental_score, risk_score, trend_direction, target_price, stop_loss, entry_price, time_horizon, news_sentiment, news_impact, notes. Required fields: ticker (do not change).',
          valid_actions: ['strong_buy', 'buy', 'accumulate', 'hold', 'sell', 'strong_sell'],
          valid_actions_ar: ['شراء قوي', 'شراء', 'تراكم', 'احتفاظ', 'بيع', 'بيع قوي'],
          valid_trends: ['bullish', 'bearish', 'neutral', 'sideways', 'uptrend', 'downtrend'],
          recommendations: mapped,
        };

        if (format === 'csv') {
          const headers = [
            'الرمز',
            'الاسم',
            'الاسم بالعربي',
            'القطاع',
            'السعر الحالي',
            'التغير%',
            // Current recommendation
            'التحليل (action)',
            'التحليل بالعربي',
            'نسبة الثقة',
            // Scores
            'الدرجة الشاملة',
            'الدرجة الفنية',
            'الدرجة الأساسية',
            'درجة المخاطر',
            // Trend
            'الاتجاه',
            // Price targets
            'سعر الهدف',
            'وقف الخسارة',
            'سعر الدخول',
            'الأفق الزمني',
            // Probabilities
            'احتمال الصعود',
            'احتمال الهبوط',
            'احتمال الاستقرار',
            // News sentiment (for AI to fill)
            'تأثير الأخبار',
            'أثر الأخبار',
            'ملاحظات',
          ];
          const rows = mapped.map((r) => [
            r.ticker,
            r.name,
            r.name_ar,
            r.sector,
            r.current_price,
            r.price_change.toFixed(2),
            r.recommendation_action,
            r.recommendation_ar,
            r.confidence_score,
            r.total_score,
            r.technical_score,
            r.fundamental_score,
            r.risk_score,
            r.trend_direction,
            r.target_price,
            r.stop_loss,
            r.entry_price,
            r.time_horizon,
            r.probability_bullish,
            r.probability_bearish,
            r.probability_neutral,
            r.news_sentiment,
            r.news_impact,
            r.notes,
          ]);
          csvResult = generateCSV(headers, rows);
        }
        break;
      }

      case 'recommendations': {
        const analyses = getAllStockAnalyses();
        const mapped = analyses.map((a) => {
          const scores = a.scores as Record<string, unknown> | undefined;
          const rec = a.recommendation as Record<string, unknown> | undefined;
          return {
            ticker: a.ticker || '',
            name: a.name || '',
            name_ar: a.name_ar || '',
            sector: a.sector || '',
            current_price: Number(a.current_price) || 0,
            price_change: Number(a.price_change) || 0,
            recommendation_action: (rec?.action as string) || '-',
            recommendation_ar: (rec?.action_ar as string) || '-',
            confidence: Number(rec?.confidence_score || scores?.total_score || 0),
            technical_score: Number(scores?.technical_score || 0),
            fundamental_score: Number(scores?.fundamental_score || 0),
            risk_score: Number(scores?.risk_score || 0),
            trend: (a.trend as Record<string, unknown>)?.direction || '-',
          };
        });

        data = {
          export_type: 'recommendations',
          export_date: today,
          total_records: mapped.length,
          recommendations: mapped,
        };

        if (format === 'csv') {
          const headers = [
            'الرمز',
            'الاسم',
            'الاسم بالعربي',
            'القطاع',
            'السعر الحالي',
            'التغير%',
            'التحليل',
            'التحليل بالعربي',
            'نسبة الثقة',
            'الدرجة الفنية',
            'الدرجة الأساسية',
            'درجة المخاطر',
            'الاتجاه',
          ];
          const rows = mapped.map((r) => [
            r.ticker,
            r.name,
            r.name_ar,
            r.sector,
            r.current_price,
            r.price_change.toFixed(2),
            r.recommendation_action,
            r.recommendation_ar,
            r.confidence,
            r.technical_score,
            r.fundamental_score,
            r.risk_score,
            r.trend,
          ]);
          csvResult = generateCSV(headers, rows);
        }
        break;
      }

      case 'market-summary': {
        const overviewStats = getMarketOverviewStats();
        const indices = getMarketIndices();
        const sectorStats = getSectorStats();

        data = {
          export_type: 'market-summary',
          export_date: today,
          overview: overviewStats,
          indices: indices,
          sectors: sectorStats,
        };

        if (format === 'csv') {
          const headers = ['المؤشر', 'القيمة'];
          const overviewRows = [
            ['إجمالي الأسهم', String(overviewStats.total_stocks)],
            ['المرتفعة', String(overviewStats.gainers)],
            ['المنخفضة', String(overviewStats.losers)],
            ['الثابتة', String(overviewStats.unchanged)],
            ['إجمالي الحجم', String(overviewStats.total_volume)],
            ['إجمالي القيمة السوقية', String(overviewStats.total_market_cap)],
            ['أسهم EGX30', String(overviewStats.egx30_count)],
            ['أسهم EGX70', String(overviewStats.egx70_count)],
            ['أسهم EGX100', String(overviewStats.egx100_count)],
            ['أكثر ارتفاعاً', String(overviewStats.top_gainer || '-')],
            ['نسبة أعلى ارتفاع', String(Number(overviewStats.top_gainer_change).toFixed(2))],
            ['أكثر انخفاضاً', String(overviewStats.top_loser || '-')],
            ['نسبة أعلى انخفاض', String(Number(overviewStats.top_loser_change).toFixed(2))],
          ];

          const indexHeaders = ['', 'المؤشر', 'القيمة', 'التغير', 'نسبة التغير%'];
          const indexRows = indices.map((idx) => [
            '',
            (idx.name_ar as string) || (idx.symbol as string) || '',
            String(idx.value || 0),
            String(idx.change || 0),
            String(Number(idx.change_percent || 0).toFixed(2)),
          ]);

          const sectorHeaders = ['', 'القطاع', 'عدد الأسهم', 'إجمالي الحجم', 'متوسط التغير%'];
          const sectorRows = sectorStats.map((s) => [
            '',
            s.sector as string || '',
            String(s.stock_count || 0),
            String(s.total_volume || 0),
            String(Number(s.avg_change || 0).toFixed(2)),
          ]);

          const allLines = [
            'ملخص السوق',
            generateCSV(headers, overviewRows),
            '\nالمؤشرات',
            generateCSV(indexHeaders, indexRows),
            '\nالقطاعات',
            generateCSV(sectorHeaders, sectorRows),
          ];
          csvResult = allLines.join('\n');
        }
        break;
      }

      case 'watchlist':
      case 'portfolio': {
        data = {
          export_type: type,
          export_date: today,
          total_records: 0,
          message: 'لا توجد بيانات متاحة حالياً. يتطلب تسجيل الدخول.',
          records: [],
        };

        if (format === 'csv') {
          csvResult = generateCSV(['رسالة'], [['لا توجد بيانات متاحة حالياً. يتطلب تسجيل الدخول.']]);
        }
        break;
      }
    }

    // Return response
    if (format === 'csv') {
      return new NextResponse(csvResult, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="egx_${type}_${today}.csv"`,
        },
      });
    }

    // JSON format
    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="egx_${type}_${today}.json"`,
      },
    });
  } catch (error) {
    console.error('Export API error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تصدير البيانات' },
      { status: 500 }
    );
  }
}
