import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';
import { ensureInitialized, getStocksDb } from '@/lib/egx-db';
// PHASE3-MARKET-SEGREGATION: canonical market normalization (TADAWUL ↔ KSA)
import { normalizeMarket, sqlMarketVariants, NO_STOCKS_MESSAGE_AR } from '@/lib/market-utils';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/stocks
// ---------------------------------------------------------------------------
// Primary source: Python backend (rich data — fair_value, change_1w/1m, etc.)
// Fallback source (P15-TASK-2): stocks.db via better-sqlite3.
//   The fallback guarantees that the Stocks view ALWAYS loads a list even if
//   the Python service is down/slow. Without it, the store's `stocks` array
//   would be empty and the in-page search bar / StockSelector would have
//   nothing to filter — making it look like "search is broken".
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const targetUrls = [
    `${PYTHON_BACKEND_URL}/api/stocks${qs ? `?${qs}` : ''}`,
    `http://127.0.0.1:8010/api/stocks${qs ? `?${qs}` : ''}`,
  ];

  for (const targetUrl of targetUrls) {
    try {
      const res = await fetch(targetUrl, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        // DEEP-MARKET-FIX: لو Python رجّع array فاضي (مش null)، نـ skip للـ fallback
        // عشان stocks.db يرجّع أسهم US اللي موجودة فعلاً.
        if (data && Array.isArray(data.data) && data.data.length > 0) {
          return NextResponse.json({
            success: true,
            stocks: data.data,
            total: data.count || data.data.length,
          });
        }
        if (data && Array.isArray(data.stocks) && data.stocks.length > 0) {
          return NextResponse.json(data);
        }
        // لو وصلنا هنا → Python رجّع array فاضي → نـ fall through للـ fallback
      }
    } catch (_err) {
      // Try next fallback URL
    }
  }

  // ── P15-TASK-2: stocks.db fallback (Python unreachable) ──
  try {
    await ensureInitialized();
    const fallback = readStocksFromLightDb(req);
    if (fallback.stocks.length > 0) {
      return NextResponse.json(fallback);
    }
  } catch (err) {
    console.error('[GET /api/stocks] stocks.db fallback failed:', err);
  }

  // PHASE3-MARKET-SEGREGATION (Task B): if we reach here it means BOTH the Python
  // backend AND stocks.db returned 0 stocks for this market. For known markets
  // without seeded data (sandbox limitation: US, CRYPTO), we return 200 + empty
  // + message instead of 503, so the UI shows a graceful empty state instead
  // of an error screen. Rule 27 (NO-FAKE-DATA): we do NOT fabricate stocks.
  const fallbackMarket = normalizeMarket(new URL(req.url).searchParams.get('market') || '');
  if (fallbackMarket) {
    return NextResponse.json({
      success: true,
      stocks: [],
      total: 0,
      source: 'stocks.db-empty',
      message: NO_STOCKS_MESSAGE_AR,
    });
  }

  // FIX (FLUTTER-PROD-5): return 200 + empty array بدل 503
  // السبب: Flutter بيتعامل مع 5xx كـ exception ويطلّع error toast
  // 'مفيش بيانات' مش = 'خطأ' — دي حالة طبيعية لو DB/Python مش متاح
  return NextResponse.json({
    success: true,
    stocks: [],
    total: 0,
    source: 'unavailable',
    message: 'لا توجد بيانات أسهم متاحة حالياً — يرجى المحاولة لاحقاً',
  });
}

// ---------------------------------------------------------------------------
// stocks.db fallback reader — mirrors the Python response shape so the store's
// `adaptStock()` works without modification.
// ---------------------------------------------------------------------------

function readStocksFromLightDb(req: NextRequest): {
  success: boolean;
  stocks: Record<string, unknown>[];
  total: number;
  source: string;
} {
  const db = getStocksDb();

  const { searchParams } = new URL(req.url);
  const marketRaw = (searchParams.get('market') || '').trim();
  // PHASE3-MARKET-SEGREGATION: قبول أي alias للسوق السعودي (TADAWUL / KSA / السعودية)
  // + EGX aliases (مصر / EGX / Egyptian) + US aliases (USA / NYSE / NASDAQ).
  // الـ canonical value بـ يتسوى قبل أي مقارنة، فالـ SQL بـ يشتغل صح على الـ DB.
  const canonicalMarket = normalizeMarket(marketRaw);
  const market = canonicalMarket ?? marketRaw.toUpperCase(); // fallback للأصل للـ display
  // بناء قائمة variants للـ SQL filter (مثلاً TADAWUL → ['TADAWUL','KSA','السعودية']).
  // ده بيخلّي الـ query يلقط كل الصفوف بغض النظر عن الـ alias المستخدم في الـ DB.
  const marketVariants = canonicalMarket ? sqlMarketVariants(canonicalMarket) : [];
  const query = (searchParams.get('query') || searchParams.get('q') || '').trim();
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const pageSize = Math.min(
    1000,
    Math.max(1, parseInt(searchParams.get('page_size') || '500', 10) || 500)
  );
  const offset = (page - 1) * pageSize;

  const whereClauses: string[] = ['is_active = 1'];
  const params: (string | number)[] = [];

  if (marketVariants.length > 0) {
    // مثلاً: WHERE market IN ('TADAWUL', 'KSA', 'السعودية')
    const placeholders = marketVariants.map(() => '?').join(',');
    whereClauses.push(`market IN (${placeholders})`);
    params.push(...marketVariants);
  } else if (marketRaw && marketRaw.toUpperCase() !== 'ALL') {
    // Fallback: alias غير معروف — نـ filter بـ exact match (آمن مع bind param).
    whereClauses.push('market = ?');
    params.push(marketRaw);
  }

  if (query) {
    whereClauses.push('(ticker LIKE ? OR name LIKE ? OR name_ar LIKE ?)');
    const term = `%${query}%`;
    params.push(term, term, term);
  }

  const whereSQL = `WHERE ${whereClauses.join(' AND ')}`;

  const countRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM stocks ${whereSQL}`)
    .get(...params) as { cnt: number } | undefined;
  const total = countRow?.cnt ?? 0;

  const rows = db
    .prepare(
      `SELECT
         id, ticker, name, name_ar, sector, industry, market,
         current_price, previous_close, open_price, high_price, low_price,
         change_percent, volume, market_cap, pe_ratio, pb_ratio, ps_ratio,
         eps, roe, roa, debt_to_equity, current_ratio, book_value_per_share,
         ma_50, ma_200, rsi, support, resistance, signal, trend,
         dividend_yield, profit_margin, avg_volume, beta, high_52w, low_52w,
         close, change_value, is_active, is_egx30, is_egx70, is_egx100,
         dps_ttm, last_update, created_at, updated_at
       FROM stocks
       ${whereSQL}
       ORDER BY volume DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as Record<string, unknown>[];

  // Match the Python response shape: each row gets `price_change` derived from
  // `change_percent` (which stocks.db stores as a percent already).
  const stocks = rows.map((row) => {
    const prev = Number(row.previous_close) || 0;
    const curr = Number(row.current_price) || 0;
    const changePct = Number(row.change_percent) || 0;
    return {
      ...row,
      is_egx30: Number(row.is_egx30) || 0,
      is_egx70: Number(row.is_egx70) || 0,
      is_egx100: Number(row.is_egx100) || 0,
      is_active: Number(row.is_active) || 0,
      volume_int: Number(row.volume) || 0,
      // If `change_percent` is missing but previous_close > 0, derive it.
      price_change:
        changePct !== 0
          ? changePct
          : prev > 0
            ? ((curr - prev) / prev) * 100
            : 0,
      change_percent: changePct !== 0 ? changePct : prev > 0 ? ((curr - prev) / prev) * 100 : 0,
    };
  });

  return {
    success: true,
    stocks,
    total,
    source: 'stocks.db',
  };
}
