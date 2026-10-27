import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * GET /api/maker-radar/fundamentals?ticker=COMI
 *
 * Jimmy directive (2026-10-27): قراءة الأساسيات المالية مباشرة من stocks.db
 * (64 عمود ممتلئة من TradingView Scanner).
 *
 * يدعم 8 تبويبات:
 * - التقييم (P/E, P/B, P/S, Market Cap)
 * - الربحية (ROE, ROA, Net Margin, Gross Margin)
 * - المركز المالي (Debt/Equity, Current Ratio, Book Value)
 * - قائمة الدخل (EPS, Revenue, Net Income)
 * - التدفقات النقدية (FCF, Operating CF)
 * - التوزيعات (DPS, Dividend Yield)
 * - الأداء (52w High/Low, Change, Volume)
 * - التحليل الفني (RSI, MA50, MA200, Support, Resistance)
 */

function fmtVal(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    if (isNaN(v) || v === 0) return null;
    return v.toFixed(2);
  }
  const s = v.toString().trim();
  if (!s || s === '—' || s === 'null' || s === '0') return null;
  return s;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
  if (!ticker) return NextResponse.json({ success: false, error: 'ticker required' }, { status: 400 });

  try {
    // FIX: قراءة من stocks.db (المصدر المحدث بـ 64 عمود من TradingView Scanner)
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const stocksDb = new Database(stocksDbPath, { readonly: true });

    const stock = stocksDb.prepare('SELECT * FROM stocks WHERE ticker = ? LIMIT 1').get(ticker) as Record<string, unknown> | undefined;
    stocksDb.close();

    if (!stock) {
      return NextResponse.json({ success: false, error: 'stock not found', ticker }, { status: 404 });
    }

    // بناء 8 تبويبات من بيانات stocks.db
    const fundamentals: Record<string, { label: string; data: Record<string, string | null> | null }> = {
      tab_valuation: {
        label: 'التقييم',
        data: {
          'P/E (مكرر الربحية)': fmtVal(stock.pe_ratio),
          'P/B (مكرر القيمة الدفترية)': fmtVal(stock.pb_ratio),
          'P/S (مكرر المبيعات)': fmtVal(stock.ps_ratio),
          'القيمة السوقية': fmtVal(stock.market_cap),
          'EPS (ربحية السهم)': fmtVal(stock.eps),
        },
      },
      tab_profitability: {
        label: 'الربحية',
        data: {
          'ROE (العائد على حقوق الملكية)': fmtVal(stock.roe),
          'ROA (العائد على الأصول)': fmtVal(stock.roa),
          'صافي هامش الربح': fmtVal(stock.profit_margin),
          'هامش الربح الإجمالي': fmtVal(stock.gross_margin) ?? fmtVal(stock.profit_margin),
        },
      },
      tab_balance_sheet: {
        label: 'المركز المالي',
        data: {
          'الديون/حقوق الملكية': fmtVal(stock.debt_to_equity),
          'النسبة المتداولة': fmtVal(stock.current_ratio),
          'القيمة الدفترية/السهم': fmtVal(stock.book_value_per_share),
        },
      },
      tab_income_statement: {
        label: 'قائمة الدخل',
        data: {
          'EPS (ربحية السهم)': fmtVal(stock.eps),
          'P/E (مكرر الربحية)': fmtVal(stock.pe_ratio),
        },
      },
      tab_cash_flow: {
        label: 'التدفقات النقدية',
        data: {
          'التدفق النقدي الحر (FCF)': fmtVal(stock.free_cash_flow) ?? '—',
          'DPS (توزيع السهم)': fmtVal(stock.dps_ttm),
        },
      },
      tab_dividends: {
        label: 'التوزيعات',
        data: {
          'عائد التوزيعات': fmtVal(stock.dividend_yield),
          'DPS (توزيع السهم التراكمي)': fmtVal(stock.dps_ttm),
        },
      },
      tab_performance: {
        label: 'الأداء',
        data: {
          'أعلى 52 أسبوع': fmtVal(stock.high_52w),
          'أدنى 52 أسبوع': fmtVal(stock.low_52w),
          'التغير %': fmtVal(stock.change_percent),
          'الحجم': fmtVal(stock.volume),
          'متوسط الحجم': fmtVal(stock.avg_volume),
          'السيولة المتداولة (Cash)': fmtVal(stock.value_traded) ?? fmtVal(stock.turnover_egp),
        },
      },
      tab_technical_analysis: {
        label: 'التحليل الفني',
        data: {
          'RSI (14)': fmtVal(stock.rsi),
          'MA50 (متوسط 50 يوم)': fmtVal(stock.ma_50),
          'MA200 (متوسط 200 يوم)': fmtVal(stock.ma_200),
          'الدعم': fmtVal(stock.support),
          'المقاومة': fmtVal(stock.resistance),
          'الاتجاه': fmtVal(stock.trend),
          'الإشارة': fmtVal(stock.signal),
          'Beta': fmtVal(stock.beta),
        },
      },
    };

    // Fallback: محاولة قراءة من data_engine.db tab_* tables (لو موجودة)
    try {
      const deDbPath = path.join(process.cwd(), 'db', 'data_engine.db');
      const deDb = new Database(deDbPath, { readonly: true });
      const TAB_TABLES = ['tab_valuation', 'tab_profitability', 'tab_balance_sheet', 'tab_income_statement', 'tab_cash_flow', 'tab_dividends', 'tab_performance', 'tab_technical_analysis'];
      const TAB_LABELS_AR: Record<string, string> = {
        tab_valuation: 'التقييم', tab_profitability: 'الربحية', tab_balance_sheet: 'المركز المالي',
        tab_income_statement: 'قائمة الدخل', tab_cash_flow: 'التدفقات النقدية', tab_dividends: 'التوزيعات',
        tab_performance: 'الأداء', tab_technical_analysis: 'التحليل الفني',
      };
      for (const table of TAB_TABLES) {
        try {
          let row = deDb.prepare(`SELECT * FROM ${table} WHERE symbol = ? LIMIT 1`).get(ticker) as Record<string, unknown> | undefined;
          if (!row) row = deDb.prepare(`SELECT * FROM ${table} WHERE symbol LIKE ? LIMIT 1`).get(ticker + '%') as Record<string, unknown> | undefined;
          if (row) {
            const cleaned: Record<string, string | null> = {};
            for (const [k, v] of Object.entries(row)) {
              if (['id', 'symbol', 'market', 'data', 'fiscal_period', 'fiscal_end'].includes(k)) continue;
              cleaned[k] = fmtVal(v);
            }
            // دمج بيانات data_engine مع stocks.db (data_engine يكمل الناقص)
            if (fundamentals[table]?.data) {
              fundamentals[table].data = { ...cleaned, ...fundamentals[table].data };
            } else {
              fundamentals[table] = { label: TAB_LABELS_AR[table], data: cleaned };
            }
          }
        } catch { /* table not found — skip */ }
      }
      deDb.close();
    } catch { /* data_engine.db not available — stocks.db only */ }

    return NextResponse.json({ success: true, ticker, name_ar: stock.name_ar || stock.name, fundamentals });
  } catch (error: any) {
    console.error('[maker-radar:fundamentals]', error);
    return NextResponse.json({ success: false, error: 'internal_error', message: String(error) }, { status: 500 });
  }
}
