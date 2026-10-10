import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

const PROJECT_ROOT = process.cwd();
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'scripts', 'output');

/**
 * GET /api/radar/weekly-report/pdf?market=EGX
 *
 * Streams the latest weekly_radar_report_*.pdf file directly with the
 * `application/pdf` Content-Type so the browser displays it inline. Used
 * by the "Download PDF" button in the WeeklyReportTab component.
 *
 * If no PDF exists yet → returns 404 with a JSON error message.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const market = (url.searchParams.get('market') || 'EGX').toUpperCase();

  if (!existsSync(OUTPUT_DIR)) {
    return NextResponse.json(
      { success: false, error: 'لا توجد تقارير بعد — شغّل weekly_radar_report.py أولاً' },
      { status: 404 },
    );
  }

  // Find the most recent weekly_radar_report_*.pdf file
  const files = readdirSync(OUTPUT_DIR)
    .filter((f) => f.startsWith('weekly_radar_report_') && f.endsWith('.pdf'))
    .sort()
    .reverse();

  if (files.length === 0) {
    return NextResponse.json(
      { success: false, error: 'لا يوجد ملف PDF بعد — شغّل weekly_radar_report.py أولاً' },
      { status: 404 },
    );
  }

  // If a market filter is provided, prefer files matching it
  let pdfPath: string | null = null;
  if (market) {
    // PDF doesn't carry market info in the file — fall back to the matching
    // JSON file's market field if available
    for (const f of files) {
      const baseName = f.replace(/\.pdf$/, '.json');
      const jsonPath = path.join(OUTPUT_DIR, baseName);
      if (existsSync(jsonPath)) {
        try {
          const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
          if ((data?.market || '').toUpperCase() === market) {
            pdfPath = path.join(OUTPUT_DIR, f);
            break;
          }
        } catch { // silent fallback (safe-by-design)
          // skip malformed
        }
      }
    }
  }
  if (!pdfPath) {
    pdfPath = path.join(OUTPUT_DIR, files[0]);
  }

  if (!existsSync(pdfPath)) {
    return NextResponse.json(
      { success: false, error: 'الملف غير موجود' },
      { status: 404 },
    );
  }

  const fileBuffer = readFileSync(pdfPath);
  const filename = path.basename(pdfPath);

  return new NextResponse(fileBuffer as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
