import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * GET /api/unified-analysis
 *
 * محرك واحد → نفس النتيجة في أي مكان.
 * Calls the Python unified_analysis engine directly (subprocess fallback).
 *
 * Query params:
 *  - ticker: لو موجود، بيرجع تحليل سهم واحد
 *  - market: EGX (default)
 *  - limit: max 200 (default 50)
 */
export const dynamic = 'force-dynamic';

const PROJECT_ROOT = process.cwd();
const PYTHON_SCRIPT = path.join(PROJECT_ROOT, 'vps-service', 'analyzers', 'unified_analysis.py');

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ticker = searchParams.get('ticker')?.toUpperCase().trim();
    const market = searchParams.get('market') || 'EGX';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

    if (!fs.existsSync(PYTHON_SCRIPT)) {
      return NextResponse.json({
        success: false,
        error: 'Unified analysis script not found',
        path: PYTHON_SCRIPT,
      }, { status: 500 });
    }

    // Build Python command
    const pythonCode = ticker
      ? `from analyzers.unified_analysis import analyze_stock_unified; import json; print(json.dumps(analyze_stock_unified('${ticker}'), ensure_ascii=False, default=str))`
      : `from analyzers.unified_analysis import analyze_market; import json; r=analyze_market('${market}', ${limit}); print(json.dumps({'success': True, 'count': len(r), 'analyses': r}, ensure_ascii=False, default=str))`;

    const cmd = `cd ${PROJECT_ROOT}/vps-service && python3 -c "${pythonCode.replace(/"/g, '\\"')}" 2>/dev/null`;

    const stdout = execSync(cmd, {
      timeout: 60000,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    // Parse the JSON output (last line that starts with {)
    const lines = stdout.trim().split('\n');
    const jsonLine = lines.reverse().find(l => l.trim().startsWith('{'));
    if (!jsonLine) {
      return NextResponse.json({
        success: false,
        error: 'No JSON output from Python',
        stdout: stdout.slice(-500),
      }, { status: 500 });
    }

    const data = JSON.parse(jsonLine);
    // Normalize response shape
    if (ticker) {
      // Single stock: data is the analysis dict
      return NextResponse.json({ success: true, analysis: data });
    } else {
      // Batch: data already has {success, count, analyses}
      return NextResponse.json(data);
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({
      success: false,
      error: 'Unified analysis failed',
      details: errMsg,
    }, { status: 500 });
  }
}
