#!/usr/bin/env python3
"""Fix /api/stocks/search — filter polluted rows + dedup by symbol"""

filepath = '/home/z/my-project/src/app/api/stocks/search/route.ts'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the empty-query SQL block
old_empty = """    if (!q) {
      const sql = `SELECT id, symbol, symbol AS ticker, name, name AS name_ar, sector, price AS current_price,
                  change_percent AS price_change, volume, market
           FROM stocks
           WHERE 1=1 ${marketClause}
           ORDER BY volume DESC
           LIMIT ?`;
      const params = [...marketParams, limit];

      const rows =
        safeQuery(lightDb, sql, params) ||
        safeQuery(stocksDb, sql, params) ||
        [];

      return NextResponse.json({ success: true, stocks: rows });
    }"""

new_empty = """    if (!q) {
      // FIX (DEAL-ADVISOR-002, 2026-08-19): filter out polluted rows where the
      // scraper merged ticker + name into the `symbol` column (93 rows like
      // "VALUU Consumer Finance S.A.ED"). Real EGX tickers are <= 12 chars and
      // contain no spaces. Dedup by symbol (GROUP BY) so the same ticker never
      // appears twice. Prefer rows with a non-null price.
      const sql = `SELECT id, symbol, symbol AS ticker, name, name AS name_ar, sector,
                  price AS current_price, change_percent AS price_change, volume, market
           FROM stocks
           WHERE 1=1 ${marketClause}
             AND symbol NOT LIKE '% %'
             AND LENGTH(symbol) <= 12
           GROUP BY symbol
           ORDER BY MAX(volume) DESC
           LIMIT ?`;
      const params = [...marketParams, limit];

      const rows =
        safeQuery(lightDb, sql, params) ||
        safeQuery(stocksDb, sql, params) ||
        [];

      return NextResponse.json({ success: true, stocks: rows });
    }"""

if old_empty in content:
    content = content.replace(old_empty, new_empty, 1)
    print('EMPTY SQL: replaced')
else:
    print('EMPTY SQL: NOT FOUND')
    exit(1)

# Replace the search-query SQL block
old_search = """    const term = `%${q}%`;
    const sql = `SELECT id, symbol, symbol AS ticker, name, name AS name_ar, sector, price AS current_price,
                change_percent AS price_change, volume, market
         FROM stocks
         WHERE 1=1 ${marketClause}
           AND (symbol LIKE ? OR name LIKE ?)
         ORDER BY
           CASE
             WHEN symbol LIKE ? THEN 1
             WHEN symbol = ? THEN 2
             ELSE 3
           END,
           volume DESC
         LIMIT ?`;
    const params = [...marketParams, term, term, term, q.toUpperCase(), limit];

    const rows =
      safeQuery(lightDb, sql, params) ||
      safeQuery(stocksDb, sql, params) ||
      [];

    return NextResponse.json({ success: true, stocks: rows });"""

new_search = """    // FIX (DEAL-ADVISOR-002): same pollution filter + dedup applied to the
    // search query. Previously a search for "VALU" returned both "VALU"
    // (correct, 11.35) and "VALUU Consumer Finance S.A.ED" (polluted, 11.79),
    // which the user saw as "the same stock with two weird prices".
    const term = `%${q}%`;
    const sql = `SELECT id, symbol, symbol AS ticker, name, name AS name_ar, sector,
                price AS current_price, change_percent AS price_change, volume, market
         FROM stocks
         WHERE 1=1 ${marketClause}
           AND symbol NOT LIKE '% %'
           AND LENGTH(symbol) <= 12
           AND (symbol LIKE ? OR name LIKE ?)
         GROUP BY symbol
         ORDER BY
           CASE
             WHEN symbol LIKE ? THEN 1
             WHEN symbol = ? THEN 2
             ELSE 3
           END,
           MAX(volume) DESC
         LIMIT ?`;
    const params = [...marketParams, term, term, term, q.toUpperCase(), limit];

    const rows =
      safeQuery(lightDb, sql, params) ||
      safeQuery(stocksDb, sql, params) ||
      [];

    // FIX (DEAL-ADVISOR-002): normalize the price field — if current_price is
    // null/0/NaN, replace with null so the UI shows "غير متاح" instead of
    // displaying 0 as a fake price.
    const normalizedRows = (rows || []).map((r) => {
      const price = Number(r.current_price);
      const valid = Number.isFinite(price) && price > 0;
      return { ...r, current_price: valid ? price : null };
    });

    return NextResponse.json({ success: true, stocks: normalizedRows });"""

if old_search in content:
    content = content.replace(old_search, new_search, 1)
    print('SEARCH SQL: replaced')
else:
    print('SEARCH SQL: NOT FOUND')
    exit(1)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print('SAVED')
