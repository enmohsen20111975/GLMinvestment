import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getWritableDatabase } from '@/lib/data-sync';
import { requireAdminAsync } from '@/lib/admin-auth-server';

/**
 * POST /api/admin/import-stocks
 *
 * استيراد بيانات الأسهم من نص منسوخ من موقع البورصة المصرية (EGX)
 *
 * تنسيق EGX المتوقع (Tab-separated):
 * - العمود 0: الرمز (Ticker) - مثل: PHTV, COMI, AMES_r2
 * - العمود 1: الاسم المختصر (Name) - مثل: بيراميزا
 * - العمود 2: العملة (Currency) - مثل: EGP, USD
 * - العمود 3: آخر سعر (Last Price)
 * - العمود 6: التغيير (Change)
 * - العمود 7: نسبة التغيير (Change %)
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { data: rawData } = body;

    if (!rawData || typeof rawData !== 'string') {
      return NextResponse.json(
        { success: false, error: 'البيانات مطلوبة' },
        { status: 400 }
      );
    }

    // تحليل البيانات
    const lines = rawData.trim().split('\n');
    if (lines.length < 1) {
      return NextResponse.json(
        { success: false, error: 'البيانات غير كافية' },
        { status: 400 }
      );
    }

    const results = {
      total: 0,
      updated: 0,
      inserted: 0,
      skipped: 0,
      errors: [] as string[],
      stocks: [] as Array<{ ticker: string; name: string; price: number }>,
      debug: [] as string[]
    };

    // EGX format is always tab-separated
    const separator = '\t';
    results.debug.push('Using Tab-separated format (EGX standard)');

    const db = getWritableDatabase();

    // Skip header line (first line with Arabic column names)
    let startLine = 0;
    const firstLine = lines[0];
    const firstColumns = firstLine.split(separator);

    // Check if first line is header (contains Arabic column names)
    const firstCol = firstColumns[0]?.trim() || '';
    const isHeader = /^(الرمز|Symbol|Ticker)/i.test(firstCol) ||
                     /[\u0600-\u06FF]/.test(firstCol) && !/^\d/.test(firstColumns[3]?.trim() || '');

    if (isHeader) {
      startLine = 1;
      results.debug.push(`Header detected: "${firstCol}", starting from line 2`);
    }

    // Process each line
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        results.skipped++;
        continue;
      }

      try {
        const columns = line.split(separator).map(col => col.trim());

        // Need at least 4 columns: ticker, name, currency, price
        if (columns.length < 4) {
          results.debug.push(`Line ${i + 1}: Skipped - only ${columns.length} columns`);
          results.skipped++;
          continue;
        }

        // Column mapping for EGX format:
        // 0: الرمز (Ticker)
        // 1: الإسم المختصر (Name)
        // 2: العملة (Currency)
        // 3: آخر سعر (Last Price)
        // 6: التغيير (Change)
        // 7: نسبة التغيير (Change %)

        let ticker = columns[0]?.toUpperCase() || '';
        let nameAr = columns[1] || '';
        let currency = columns[2] || 'EGP';
        let currentPrice = parseFloat(columns[3]?.replace(/,/g, '') || '0');
        let changePercent = parseFloat(columns[7]?.replace(/,/g, '').replace('%', '') || '0');

        // Skip if ticker is empty or too short
        if (!ticker || ticker.length < 2) {
          results.debug.push(`Line ${i + 1}: Empty or short ticker`);
          results.skipped++;
          continue;
        }

        // Skip if price is invalid
        if (isNaN(currentPrice) || currentPrice <= 0) {
          results.debug.push(`Line ${i + 1}: Invalid price for ${ticker}: ${columns[3]}`);
          results.skipped++;
          continue;
        }

        // Skip rows that are clearly not stock data (like totals or empty prices)
        if (currentPrice === 0 && ticker.includes('TOTAL')) {
          results.skipped++;
          continue;
        }

        results.total++;

        // Check if stock exists
        const existingStock = db.prepare('SELECT ticker FROM stocks WHERE ticker = ?').get(ticker);

        const now = new Date().toISOString();

        if (existingStock) {
          // Update existing stock
          db.prepare(`
            UPDATE stocks SET
              name_ar = COALESCE(?, name_ar),
              current_price = ?,
              change_percent = ?,
              last_updated = ?
            WHERE ticker = ?
          `).run(
            nameAr || null,
            currentPrice,
            changePercent,
            now,
            ticker
          );
          results.updated++;
        } else {
          // Insert new stock
          db.prepare(`
            INSERT INTO stocks (
              ticker, name, name_ar, current_price, change_percent,
              is_active, last_updated
            ) VALUES (?, ?, ?, ?, ?, 1, ?)
          `).run(
            ticker,
            nameAr,
            nameAr,
            currentPrice,
            changePercent,
            now
          );
          results.inserted++;
        }

        results.stocks.push({
          ticker,
          name: nameAr,
          price: currentPrice
        });

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'خطأ غير معروف';
        results.errors.push(`خطأ في السطر ${i + 1}: ${errorMsg}`);
      }
    }

    console.log(`[import-stocks] Total: ${results.total}, Updated: ${results.updated}, Inserted: ${results.inserted}, Skipped: ${results.skipped}`);

    return NextResponse.json({
      success: true,
      message: `تم استيراد ${results.total} سهم بنجاح`,
      results: {
        total: results.total,
        updated: results.updated,
        inserted: results.inserted,
        skipped: results.skipped,
        errors: results.errors.slice(0, 20),
        stocks: results.stocks.slice(0, 50),
        debug: results.debug.slice(0, 30)
      }
    });

  } catch (error) {
    console.error('[import-stocks] Error:', error);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/import-stocks
 *
 * معاينة البيانات قبل الاستيراد
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const preview = searchParams.get('preview');

  if (!preview) {
    return NextResponse.json({
      endpoint: '/api/admin/import-stocks',
      method: 'POST',
      description: 'استيراد بيانات الأسهم من موقع البورصة المصرية',
      format: 'Tab-separated (التنسيق القياسي لموقع EGX)',
      columns: [
        'العمود 0: الرمز (Ticker)',
        'العمود 1: الاسم المختصر (Name)',
        'العمود 2: العملة (Currency)',
        'العمود 3: آخر سعر (Last Price)',
        'العمود 7: نسبة التغيير (Change %)'
      ]
    });
  }

  // Preview data
  try {
    const lines = preview.trim().split('\n');
    const previewData: any[] = [];

    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const columns = lines[i].split('\t').map(col => col.trim());

      previewData.push({
        line: i + 1,
        ticker: columns[0],
        name: columns[1],
        currency: columns[2],
        price: columns[3],
        columns: columns.length
      });
    }

    return NextResponse.json({
      success: true,
      linesFound: lines.length,
      preview: previewData
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'خطأ في تحليل البيانات' },
      { status: 400 }
    );
  }
}
