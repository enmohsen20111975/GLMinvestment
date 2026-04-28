import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// POST /api/import
// Handles multipart/form-data file uploads for data import
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const type = formData.get('type') as string | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'لم يتم اختيار ملف' },
        { status: 400 }
      );
    }

    if (!type || !['stocks', 'watchlist'].includes(type)) {
      return NextResponse.json(
        { success: false, error: 'نوع الاستيراد غير صالح. الأنواع المدعومة: stocks, watchlist' },
        { status: 400 }
      );
    }

    const fileName = file.name.toLowerCase();
    const isCSV = fileName.endsWith('.csv');
    const isJSON = fileName.endsWith('.json');

    if (!isCSV && !isJSON) {
      return NextResponse.json(
        { success: false, error: 'صيغة الملف غير مدعومة. الصيغ المدعومة: CSV, JSON' },
        { status: 400 }
      );
    }

    // Read file content
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const content = buffer.toString('utf-8');

    // Remove BOM if present
    const cleanContent = content.replace(/^\uFEFF/, '');

    let result: Record<string, unknown>;

    if (isCSV) {
      result = parseCSVImport(cleanContent, type);
    } else {
      result = parseJSONImport(cleanContent, type);
    }

    return NextResponse.json({
      success: true,
      type,
      file_name: file.name,
      file_size: file.size,
      format: isCSV ? 'csv' : 'json',
      ...result,
    });
  } catch (error) {
    console.error('Import API error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء استيراد البيانات' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// CSV Parser
// ---------------------------------------------------------------------------

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSVImport(content: string, type: string): Record<string, unknown> {
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);

  if (lines.length < 2) {
    return {
      total_rows: 0,
      valid_rows: 0,
      invalid_rows: 0,
      message: 'الملف فارغ أو لا يحتوي على بيانات كافية',
      records: [],
    };
  }

  const headers = parseCSVLine(lines[0]);
  const dataRows = lines.slice(1);
  const records: Record<string, string>[] = [];
  let validRows = 0;
  let invalidRows = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const values = parseCSVLine(dataRows[i]);

    if (values.length === 0 || (values.length === 1 && values[0] === '')) continue;

    const record: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j] || '';
    }

    // Basic validation for stocks
    if (type === 'stocks') {
      const hasTicker = record['الرمز'] || record['ticker'] || record['Ticker'] || '';
      if (hasTicker) {
        validRows++;
        records.push(record);
      } else {
        invalidRows++;
      }
    } else {
      validRows++;
      records.push(record);
    }
  }

  return {
    total_rows: dataRows.length,
    valid_rows: validRows,
    invalid_rows: invalidRows,
    columns: headers,
    records,
    message: validRows > 0
      ? `تم تحليل ${validRows} سجل بنجاح`
      : 'لم يتم العثور على بيانات صالحة',
  };
}

// ---------------------------------------------------------------------------
// JSON Parser
// ---------------------------------------------------------------------------

function parseJSONImport(content: string, type: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      total_rows: 0,
      valid_rows: 0,
      invalid_rows: 0,
      message: 'خطأ في تحليل ملف JSON',
      records: [],
    };
  }

  // Handle arrays
  if (Array.isArray(parsed)) {
    const records: Record<string, unknown>[] = [];
    let validRows = 0;

    for (const item of parsed) {
      if (typeof item === 'object' && item !== null) {
        validRows++;
        records.push(item as Record<string, unknown>);
      }
    }

    return {
      total_rows: parsed.length,
      valid_rows: validRows,
      invalid_rows: parsed.length - validRows,
      records,
      message: validRows > 0
        ? `تم تحليل ${validRows} سجل بنجاح`
        : 'لم يتم العثور على بيانات صالحة',
    };
  }

  // Handle object with data array
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;

    // Try to find array fields
    const arrayFields = Object.entries(obj).filter(([, value]) => Array.isArray(value));

    if (arrayFields.length > 0) {
      // Use the largest array field
      const [fieldName, fieldValue] = arrayFields.sort(
        (a, b) => (b[1] as unknown[]).length - (a[1] as unknown[]).length
      )[0];

      const records = (fieldValue as unknown[]).filter(
        (item) => typeof item === 'object' && item !== null
      ) as Record<string, unknown>[];

      return {
        total_rows: records.length,
        valid_rows: records.length,
        invalid_rows: 0,
        data_field: fieldName,
        records,
        message: `تم تحليل ${records.length} سجل من الحقل "${fieldName}"`,
      };
    }

    // Single object
    return {
      total_rows: 1,
      valid_rows: 1,
      invalid_rows: 0,
      records: [obj],
      message: 'تم تحليل كائن JSON واحد',
    };
  }

  return {
    total_rows: 0,
    valid_rows: 0,
    invalid_rows: 0,
    message: 'صيغة JSON غير مدعومة',
    records: [],
  };
}
