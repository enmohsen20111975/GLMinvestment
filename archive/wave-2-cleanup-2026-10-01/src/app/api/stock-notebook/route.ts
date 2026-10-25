import { NextRequest, NextResponse } from 'next/server';
// P0-14-ASYNC fix (2026-09-27): replaced sync fs.* calls with async fs/promises
// equivalents so GET/POST/DELETE handlers never block the event loop on the
// notebook JSON file.
import { access, readFile, writeFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

const NOTEBOOK_PATH = path.join(process.cwd(), 'data', 'stock_notebook.json');

/**
 * GET /api/stock-notebook
 * قراءة النوت بوك كامل أو لسهم محدد.
 *
 * Query params:
 *  - ticker: لو موجود، بيرجع ملاحظات سهم واحد
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get('ticker')?.toUpperCase();

    try {
      await access(NOTEBOOK_PATH);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Notebook not found' },
        { status: 404 }
      );
    }

    const raw = await readFile(NOTEBOOK_PATH, 'utf-8');
    const notebook = JSON.parse(raw);

    if (ticker) {
      const stockData = notebook.stocks?.[ticker];
      if (!stockData) {
        return NextResponse.json(
          { success: false, error: `Stock ${ticker} not in notebook` },
          { status: 404 }
        );
      }
      return NextResponse.json({
        success: true,
        ticker,
        data: stockData,
      });
    }

    return NextResponse.json({
      success: true,
      notebook,
    });
  } catch (e) {
    console.error('[api/stock-notebook] GET error:', e);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/stock-notebook
 * إضافة ملاحظة لسهم (أو تحديث بيانات السهم).
 *
 * Body:
 *  - ticker: إلزامي
 *  - note: نص الملاحظة
 *  - signal: فرصة دخول / تجنب / مراقبة / إلخ
 *  - confidence: 0-100
 *  - status: حالة السهم
 *  - trend: صاعد / هابط / عرضي
 *  - maker_activity: نشط / ضعيف / توزيع / خروج
 *  - sector_heat: صاعد / محايد / هابط
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ticker = (body.ticker || '').toUpperCase();

    if (!ticker) {
      return NextResponse.json(
        { success: false, error: 'ticker is required' },
        { status: 400 }
      );
    }

    // اقرأ النوت بوك الحالي
    let notebook: any = { stocks: {}, sector_notes: {}, lessons_learned: [] };
    try {
      await access(NOTEBOOK_PATH);
      const raw = await readFile(NOTEBOOK_PATH, 'utf-8');
      notebook = JSON.parse(raw);
    } catch {
      // notebook not present yet — use defaults
    }

    // تأكد إن stocks موجود
    if (!notebook.stocks) notebook.stocks = {};

    // لو السهم مش موجود، أنشئه
    if (!notebook.stocks[ticker]) {
      notebook.stocks[ticker] = {
        name: body.name || '',
        sector: body.sector || '',
        observations: [],
        status: '',
        trend: '',
        maker_activity: '',
        sector_heat: '',
      };
    }

    // أضف الملاحظة
    if (body.note) {
      notebook.stocks[ticker].observations.push({
        date: new Date().toISOString().slice(0, 10),
        source: body.source || 'analyst',
        note: body.note,
        signal: body.signal || 'ملاحظة',
        confidence: body.confidence || 50,
      });
    }

    // حدّث الحقول
    if (body.status) notebook.stocks[ticker].status = body.status;
    if (body.trend) notebook.stocks[ticker].trend = body.trend;
    if (body.maker_activity) notebook.stocks[ticker].maker_activity = body.maker_activity;
    if (body.sector_heat) notebook.stocks[ticker].sector_heat = body.sector_heat;
    if (body.name) notebook.stocks[ticker].name = body.name;
    if (body.sector) notebook.stocks[ticker].sector = body.sector;

    // حدّث last_updated
    if (!notebook._meta) notebook._meta = {};
    notebook._meta.last_updated = new Date().toISOString().slice(0, 10);

    // احفظ
    await writeFile(NOTEBOOK_PATH, JSON.stringify(notebook, null, 2), 'utf-8');

    return NextResponse.json({
      success: true,
      message: `Note added for ${ticker}`,
      ticker,
      data: notebook.stocks[ticker],
    });
  } catch (e) {
    console.error('[api/stock-notebook] POST error:', e);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/stock-notebook?ticker=HELI&observation_index=0
 * حذف ملاحظة محددة من سهم.
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get('ticker')?.toUpperCase();
    const obsIdx = parseInt(searchParams.get('observation_index') || '-1', 10);

    if (!ticker) {
      return NextResponse.json(
        { success: false, error: 'ticker is required' },
        { status: 400 }
      );
    }

    try {
      await access(NOTEBOOK_PATH);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Notebook not found' },
        { status: 404 }
      );
    }

    const raw = await readFile(NOTEBOOK_PATH, 'utf-8');
    const notebook = JSON.parse(raw);

    if (!notebook.stocks?.[ticker]) {
      return NextResponse.json(
        { success: false, error: `Stock ${ticker} not found` },
        { status: 404 }
      );
    }

    if (obsIdx >= 0 && notebook.stocks[ticker].observations[obsIdx]) {
      notebook.stocks[ticker].observations.splice(obsIdx, 1);
      await writeFile(NOTEBOOK_PATH, JSON.stringify(notebook, null, 2), 'utf-8');
      return NextResponse.json({
        success: true,
        message: `Observation ${obsIdx} deleted from ${ticker}`,
      });
    }

    return NextResponse.json(
      { success: false, error: 'Observation not found' },
      { status: 404 }
    );
  } catch (e) {
    console.error('[api/stock-notebook] DELETE error:', e);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 }
    );
  }
}
