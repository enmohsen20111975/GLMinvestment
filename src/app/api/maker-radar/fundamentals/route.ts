import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * GET /api/maker-radar/fundamentals?ticker=COMI
 *
 * (ALPHA-FUNDAMENTALS-AND-TABS، Task 1c — owner directive 2026-10-27):
 * «صحّح مسار الداتابيز ليقرأ من db/stocks.db (المحدّث بـ 66 عمود و tabs_data).
 *  ابحث بالرمز النقي (Direct WHERE symbol = ? OR ticker = ?) دون LIKE».
 *
 * يدعم 8 تبويبات تغطي تجميعة الـ owner:
 *   💵 التدفقات النقدية (التشغيلي، الاستثماري، التدفق الحر FCF)
 *   🏛️ المركز المالي (النقد، الديون، حقوق الملكية، الأصول)
 *   📈 قائمة الدخل (الإيرادات، صافي الربح، الهوامش، EPS)
 *   🎯 التقييم (P/E, P/B, P/S, EV/EBITDA, عائد التوزيعات)
 *   ⚡ الأداء والفنيات (RSI, MACD, SMA20/50/200, Support, Resistance)
 *
 * المصادر (defensive، pre/post-merge):
 *   1. stocks.db.stocks (SELECT * WHERE ticker = ?) — المصدر الرئيسي بـ 66 عمود
 *      من TradingView Scanner (يملأه برافو بعد merge).
 *   2. data_engine.db.tab_* tables (fallback) — WHERE symbol = ? مباشر (نقي، بدون LIKE).
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

/** يتحقق لو عمود معين موجود في جدول (defensive — pre-merge). */
function columnExists(db: Database.Database, table: string, column: string): boolean {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return info.some((c) => c.name === column);
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get('ticker') || '').toUpperCase();
  if (!ticker) return NextResponse.json({ success: false, error: 'ticker required' }, { status: 400 });

  try {
    // ─── المصدر 1: stocks.db.stocks (SELECT * WHERE ticker = ? — مباشر، نقي) ───
    const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
    const stocksDb = new Database(stocksDbPath, { readonly: true });
    stocksDb.pragma('busy_timeout = 5000');

    const stock = stocksDb.prepare('SELECT * FROM stocks WHERE ticker = ? LIMIT 1').get(ticker) as Record<string, unknown> | undefined;
    stocksDb.close();

    if (!stock) {
      return NextResponse.json({ success: false, error: 'stock not found', ticker }, { status: 404 });
    }

    // (ALPHA-FUNDAMENTALS-AND-TABS): نقرا logo_url من stocks.db لو موجود (post-merge).
    // pre-merge: logo_url مش موجود → null → الـ frontend بيـ fallback على logo-helper.
    const logo_url = fmtVal(stock.logo_url) ?? null;

    // بناء 8 تبويبات من بيانات stocks.db (66 عمود من TradingView Scanner).
    // الحقول اللي لسه مش موجودة (pre-merge) بترجع null تلقائيًا (defensive، Rule 27).
    const fundamentals: Record<string, { label: string; data: Record<string, string | null> | null }> = {
      tab_valuation: {
        label: 'التقييم',
        data: {
          'P/E (مكرر الربحية)': fmtVal(stock.pe_ratio),
          'P/B (مكرر القيمة الدفترية)': fmtVal(stock.pb_ratio),
          'P/S (مكرر المبيعات)': fmtVal(stock.ps_ratio),
          'القيمة السوقية': fmtVal(stock.market_cap),
          'EV/EBITDA': fmtVal(stock.ev_ebitda),
          'EPS (ربحية السهم)': fmtVal(stock.eps),
          'عائد التوزيعات %': fmtVal(stock.dividend_yield),
        },
      },
      tab_profitability: {
        label: 'الربحية',
        data: {
          'ROE (العائد على حقوق الملكية)': fmtVal(stock.roe),
          'ROA (العائد على الأصول)': fmtVal(stock.roa),
          'صافي هامش الربح %': fmtVal(stock.profit_margin),
          'هامش الربح الإجمالي %': fmtVal(stock.gross_margin) ?? fmtVal(stock.profit_margin),
          'هامش التشغيل %': fmtVal(stock.operating_margin),
        },
      },
      tab_balance_sheet: {
        label: 'المركز المالي',
        data: {
          'إجمالي النقد': fmtVal(stock.total_cash),
          'إجمالي الديون': fmtVal(stock.total_debt),
          'إجمالي حقوق الملكية': fmtVal(stock.total_equity),
          'إجمالي الأصول': fmtVal(stock.total_assets),
          'الديون/حقوق الملكية': fmtVal(stock.debt_to_equity),
          'النسبة المتداولة': fmtVal(stock.current_ratio),
          'القيمة الدفترية/السهم': fmtVal(stock.book_value_per_share),
        },
      },
      tab_income_statement: {
        label: 'قائمة الدخل',
        data: {
          'إجمالي الإيرادات': fmtVal(stock.total_revenue),
          'صافي الربح': fmtVal(stock.net_income),
          'EPS (ربحية السهم)': fmtVal(stock.eps),
          'هامش الربح الإجمالي %': fmtVal(stock.gross_margin),
          'هامش صافي الربح %': fmtVal(stock.profit_margin),
          'P/E (مكرر الربحية)': fmtVal(stock.pe_ratio),
        },
      },
      tab_cash_flow: {
        label: 'التدفقات النقدية',
        data: {
          'التدفق النقدي التشغيلي': fmtVal(stock.operating_cash_flow),
          'التدفق النقدي الاستثماري': fmtVal(stock.investing_cash_flow),
          'التدفق النقدي الحر (FCF)': fmtVal(stock.free_cash_flow),
          'DPS (توزيع السهم)': fmtVal(stock.dps_ttm),
        },
      },
      tab_dividends: {
        label: 'التوزيعات',
        data: {
          'عائد التوزيعات %': fmtVal(stock.dividend_yield),
          'DPS (توزيع السهم التراكمي)': fmtVal(stock.dps_ttm),
          'نسبة التوزيع (Payout)': fmtVal(stock.payout_ratio),
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
          'الحجم النسبي 10 أيام': fmtVal(stock.relative_volume_10d),
          'Beta': fmtVal(stock.beta),
        },
      },
      tab_technical_analysis: {
        label: 'التحليل الفني',
        data: {
          'RSI (14)': fmtVal(stock.rsi),
          'MACD': fmtVal(stock.macd),
          'إشارة MACD': fmtVal(stock.macd_signal),
          'SMA20 (متوسط 20 يوم)': fmtVal(stock.sma20),
          'SMA50 (متوسط 50 يوم)': fmtVal(stock.sma50),
          'SMA200 (متوسط 200 يوم)': fmtVal(stock.sma200),
          'EMA20 (متوسط أسي 20 يوم)': fmtVal(stock.ema20),
          'ATR (مدى حقيقي متوسط)': fmtVal(stock.atr),
          'الدعم': fmtVal(stock.support),
          'المقاومة': fmtVal(stock.resistance),
          'الاتجاه': fmtVal(stock.trend),
          'الإشارة': fmtVal(stock.signal),
        },
      },
    };

    // ─── المصدر 2 (fallback): data_engine.db.tab_* tables ───────────────────
    // (ALPHA-FUNDAMENTALS-AND-TABS): بحث مباشر بالـ symbol (نقي، بدون LIKE).
    // نجرّب symbol = ? لو العمود موجود، وإلا ticker = ?.
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
          // (ALPHA-FUNDAMENTALS-AND-TABS): direct WHERE — no LIKE.
          let row: Record<string, unknown> | undefined;
          if (columnExists(deDb, table, 'symbol')) {
            row = deDb.prepare(`SELECT * FROM ${table} WHERE symbol = ? LIMIT 1`).get(ticker) as Record<string, unknown> | undefined;
          } else if (columnExists(deDb, table, 'ticker')) {
            row = deDb.prepare(`SELECT * FROM ${table} WHERE ticker = ? LIMIT 1`).get(ticker) as Record<string, unknown> | undefined;
          }
          if (row) {
            const cleaned: Record<string, string | null> = {};
            for (const [k, v] of Object.entries(row)) {
              if (['id', 'symbol', 'ticker', 'market', 'data', 'fiscal_period', 'fiscal_end'].includes(k)) continue;
              cleaned[k] = fmtVal(v);
            }
            // دمج بيانات data_engine مع stocks.db (data_engine يكمل الناقص).
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

    return NextResponse.json({
      success: true,
      ticker,
      name_ar: stock.name_ar || stock.name,
      logo_url,
      fundamentals,
    });
  } catch (error: any) {
    console.error('[maker-radar:fundamentals]', error);
    return NextResponse.json({ success: false, error: 'internal_error', message: String(error) }, { status: 500 });
  }
}
