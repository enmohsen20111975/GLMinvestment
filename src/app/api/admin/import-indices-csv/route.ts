/**
 * POST /api/admin/import-indices-csv
 * ===============================================================================
 *
 * رفع ملف CSV يحتوي على بيانات المؤشرات التاريخية واستيراده في
 * stocks.db.market_indices_history (مع إزالة التكرارات تلقائيًا).
 *
 * الميزة:
 *   - المالك يرفع ملف CSV من لوحة الأدمن
 *   - السكربت يكتشف الرمز (EGX30/70/100) من اسم الملف أو العمود
 *   - يدعم صيغ CSV متعددة (date,value / date,close / time,OHLCV)
 *   - يزيل التكرارات تلقائيًا (UPSERT على UNIQUE(symbol, date))
 *   - يرجع تقرير: عدد الصفوف المستوردة + الفترة الزمنية
 * ===============================================================================
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAsync } from '@/lib/admin-auth-server';
import Database from 'better-sqlite3';
import path from 'path';
import { parse } from 'csv-parse/sync';

export const dynamic = 'force-dynamic';

const PROJECT_ROOT = process.cwd();
const DB_PATH = path.join(PROJECT_ROOT, 'db', 'stocks.db');

function detectSymbol(filename: string): string {
  const name = filename.toLowerCase();
  if (name.includes('egx30') || name.includes('egx_30')) return 'EGX30';
  if (name.includes('egx70') || name.includes('egx_70')) return 'EGX70';
  if (name.includes('egx100') || name.includes('egx_100')) return 'EGX100';
  if (name.includes('egx33')) return 'EGX33';
  if (name.includes('egx50')) return 'EGX50';
  return 'EGX30';
}

function toNumber(val: string | null | undefined): number | null {
  if (!val) return null;
  const cleaned = String(val).replace(/,/g, '').replace(/%/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

export async function POST(request: NextRequest) {
  // Task SECURITY-P0: admin-only — رفع CSV لـ stocks.db يحتاج صلاحية أدمن.
  // كان: بلا auth إطلاقًا — أي أحد يقدر يرفع CSV ويعدّل stocks.db.
  const adminError = await requireAdminAsync(request);
  if (adminError) return adminError;
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const symbolOverride = formData.get('symbol') as string | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'لم يتم رفع أي ملف' },
        { status: 400 }
      );
    }

    const symbol = (symbolOverride || detectSymbol(file.name)).toUpperCase();
    const filename = file.name;

    const bytes = await file.arrayBuffer();
    const content = Buffer.from(bytes).toString('utf-8').replace(/^\uFEFF/, '');

    let records: Record<string, string>[] = [];
    try {
      records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      });
    } catch (parseError) {
      return NextResponse.json(
        {
          success: false,
          error: 'فشل تحليل CSV — تأكد من الصيغة (header row مطلوب)',
          detail: parseError instanceof Error ? parseError.message : 'unknown',
        },
        { status: 400 }
      );
    }

    if (!records || records.length === 0) {
      return NextResponse.json(
        { success: false, error: 'ملف CSV فارغ أو لا يحتوي على بيانات' },
        { status: 400 }
      );
    }

    const headers = Object.keys(records[0]);
    const dateCol = headers.find((h) =>
      ['date', 'Date', 'time', 'Time', 'timestamp', 'التاريخ'].includes(h)
    );
    const valueCol = headers.find((h) =>
      ['value', 'Value', 'close', 'Close', 'last', 'Last', 'price', 'Price'].includes(h)
    );
    const changeCol = headers.find((h) =>
      ['change_percent', 'change_pct', 'change_abs', 'Change %', 'change', 'Change'].includes(h)
    );
    const highCol = headers.find((h) => ['high', 'High'].includes(h));
    const lowCol = headers.find((h) => ['low', 'Low'].includes(h));
    const volumeCol = headers.find((h) => ['volume', 'Volume', 'vol'].includes(h));

    if (!dateCol || !valueCol) {
      return NextResponse.json(
        {
          success: false,
          error: `CSV يجب أن يحتوي على عمود تاريخ (date/time) وعمود قيمة (value/close/last). الأعمدة المكتشفة: ${headers.join(', ')}`,
        },
        { status: 400 }
      );
    }

    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    db.exec(`
      CREATE TABLE IF NOT EXISTS market_indices_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        date TEXT NOT NULL,
        value REAL,
        change_percent REAL,
        high REAL,
        low REAL,
        volume REAL,
        source TEXT DEFAULT 'csv_import',
        imported_at TEXT,
        UNIQUE(symbol, date)
      )
    `);

    const upsert = db.prepare(`
      INSERT INTO market_indices_history (symbol, date, value, change_percent, high, low, volume, source, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'csv_import', datetime('now'))
      ON CONFLICT(symbol, date) DO UPDATE SET
        value = excluded.value,
        change_percent = excluded.change_percent,
        high = excluded.high,
        low = excluded.low,
        volume = excluded.volume,
        source = 'csv_import',
        imported_at = datetime('now')
    `);

    let imported = 0;
    let skipped = 0;

    const tx = db.transaction((rows: Record<string, string>[]) => {
      for (const row of rows) {
        const date = (row[dateCol] || '').trim();
        const value = toNumber(row[valueCol]);

        if (!date || value === null || value <= 0) {
          skipped++;
          continue;
        }

        const changePct = toNumber(changeCol ? row[changeCol] : null) || 0;
        const high = toNumber(highCol ? row[highCol] : null) || 0;
        const low = toNumber(lowCol ? row[lowCol] : null) || 0;
        const volume = toNumber(volumeCol ? row[volumeCol] : null) || 0;

        upsert.run(symbol, date, value, changePct, high, low, volume);
        imported++;
      }
    });

    tx(records);

    const totalCount = db
      .prepare('SELECT COUNT(*) as count FROM market_indices_history WHERE symbol = ?')
      .get(symbol) as { count: number };

    const dateRange = db
      .prepare(
        'SELECT MIN(date) as first, MAX(date) as last FROM market_indices_history WHERE symbol = ?'
      )
      .get(symbol) as { first: string; last: string };

    db.close();

    return NextResponse.json({
      success: true,
      message: `تم استيراد ${imported} صف لـ ${symbol} (${skipped} صف متخطى)`,
      details: {
        symbol,
        filename,
        records_in_csv: records.length,
        imported,
        skipped,
        total_in_db: totalCount.count,
        date_range: {
          first: dateRange.first,
          last: dateRange.last,
        },
        columns_detected: {
          date: dateCol,
          value: valueCol,
          change_percent: changeCol || '(not found)',
          high: highCol || '(not found)',
          low: lowCol || '(not found)',
          volume: volumeCol || '(not found)',
        },
      },
    });
  } catch (error) {
    console.error('[import-indices-csv]', error);
    return NextResponse.json(
      {
        success: false,
        error: 'خطأ داخلي في استيراد CSV',
        detail: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const db = new Database(DB_PATH, { readonly: true });

    try {
      const stats = db
        .prepare(`
          SELECT
            symbol,
            COUNT(*) as count,
            MIN(date) as first_date,
            MAX(date) as last_date,
            MAX(imported_at) as last_import
          FROM market_indices_history
          GROUP BY symbol
          ORDER BY symbol
        `)
        .all();

      db.close();

      return NextResponse.json({
        success: true,
        indices: stats,
      });
    } catch { // silent fallback (safe-by-design)
      db.close();
      return NextResponse.json({
        success: true,
        indices: [],
        message: 'جدول market_indices_history غير موجود بعد — ارفع ملف CSV أولاً',
      });
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'فشل قراءة قاعدة البيانات' },
      { status: 500 }
    );
  }
}
