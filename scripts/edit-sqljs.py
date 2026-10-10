#!/usr/bin/env python3
# Edit data-engine-db-sqljs.ts

with open('/home/z/my-project/src/lib/data-engine-db-sqljs.ts', 'rb') as f:
    content = f.read()

# 1. Remove _priceHistoryDb variable declaration (CRLF)
old1 = b'let _sqlJs: SqlJsStatic | null = null;\r\nlet _dataEngineDb: SqlJsDatabase | null = null;\r\nlet _priceHistoryDb: SqlJsDatabase | null = null;\r\nlet _stocksDb: SqlJsDatabase | null = null;\r\nlet _initPromise: Promise<void> | null = null;\r\n'
new1 = b'let _sqlJs: SqlJsStatic | null = null;\r\nlet _dataEngineDb: SqlJsDatabase | null = null;\r\nlet _stocksDb: SqlJsDatabase | null = null;\r\nlet _initPromise: Promise<void> | null = null;\r\n'

if old1 in content:
    content = content.replace(old1, new1)
    print('1. SUCCESS: Removed _priceHistoryDb variable')
else:
    print('1. FAIL: variable declaration not found')

# 2. Replace getPriceHistoryDbSqlJs() function
old2 = (
    b'/**\r\n'
    b' * Get price_history.db connection (read-only via sql.js)\r\n'
    b' */\r\n'
    b'export async function getPriceHistoryDbSqlJs(): Promise<SqlJsDatabase> {\r\n'
    b'    if (_priceHistoryDb) return _priceHistoryDb;\r\n'
    b'\r\n'
    b'    const dbPath = path.join(process.cwd(), \'db\', \'price_history.db\');\r\n'
    b'    if (!fs.existsSync(dbPath)) {\r\n'
    b'        throw new Error(`Price History DB not found at ${dbPath}`);\r\n'
    b'    }\r\n'
    b'\r\n'
    b'    const sqlJs = await ensureInit();\r\n'
    b'    _priceHistoryDb = openReadonly(sqlJs, dbPath);\r\n'
    b'    return _priceHistoryDb;\r\n'
    b'}\r\n'
)
new2 = (
    b'/**\r\n'
    b' * Get data_engine.db connection (read-only via sql.js) \xe2\x80\x94 also used for price history.\r\n'
    b' * (price_history.db was removed; egksco_price_history table in data_engine.db is now the source.)\r\n'
    b' */\r\n'
    b'export async function getPriceHistoryDbSqlJs(): Promise<SqlJsDatabase> {\r\n'
    b'    // Backward-compatible: route to data_engine.db connection\r\n'
    b'    return getDataEngineDbSqlJs();\r\n'
    b'}\r\n'
)

if old2 in content:
    content = content.replace(old2, new2)
    print('2. SUCCESS: Replaced getPriceHistoryDbSqlJs()')
else:
    print('2. FAIL: getPriceHistoryDbSqlJs not found')

# 3. Replace getHistoricalData()
old3 = (
    b'export async function getHistoricalData(symbol: string, limit: number = 100): Promise<PriceHistoryRecord[]> {\r\n'
    b'    const db = await _ensurePriceHistoryCompat();\r\n'
    b'    try {\r\n'
    b'        return db.prepare(\'SELECT * FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT ?\').all(symbol, limit) as PriceHistoryRecord[];\r\n'
    b'    } catch { return []; }\r\n'
    b'}\r\n'
)
new3 = (
    b'export async function getHistoricalData(symbol: string, limit: number = 100): Promise<PriceHistoryRecord[]> {\r\n'
    b'    const db = await _ensurePriceHistoryCompat();\r\n'
    b'    try {\r\n'
    b'        // egksco_price_history: id, symbol, price_date, open_price, high_price, low_price, close_price, volume, turnover\r\n'
    b'        return db.prepare(`\r\n'
    b'            SELECT \r\n'
    b'                id,\r\n'
    b'                symbol AS ticker,\r\n'
    b'                NULL AS name,\r\n'
    b'                NULL AS category,\r\n'
    b'                price_date AS date,\r\n'
    b'                open_price AS open,\r\n'
    b'                high_price AS high,\r\n'
    b'                low_price AS low,\r\n'
    b'                close_price AS close,\r\n'
    b'                volume,\r\n'
    b'                NULL AS market\r\n'
    b'            FROM egksco_price_history\r\n'
    b'            WHERE symbol = ?\r\n'
    b'            ORDER BY price_date DESC\r\n'
    b'            LIMIT ?\r\n'
    b'        `).all(symbol, limit) as PriceHistoryRecord[];\r\n'
    b'    } catch { return []; }\r\n'
    b'}\r\n'
)

if old3 in content:
    content = content.replace(old3, new3)
    print('3. SUCCESS: Replaced getHistoricalData()')
else:
    print('3. FAIL: getHistoricalData not found')

with open('/home/z/my-project/src/lib/data-engine-db-sqljs.ts', 'wb') as f:
    f.write(content)
print('Done')
