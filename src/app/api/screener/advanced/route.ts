import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import * as path from 'path';

/**
 * GET /api/screener/advanced
 *
 * ALL LOGIC IN PYTHON. Node = DISPLAY ONLY (Rule 20).
 * Calls Python advanced_screener directly (subprocess) — no backend needed.
 */
export const dynamic = 'force-dynamic';

const PROJECT_ROOT = process.cwd();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const params = searchParams.toString();

    // Call Python screener directly via Flask test client (no server needed)
    const pythonCode = `import sys,json; sys.path.insert(0,'.'); from api.advanced_screener_routes import advanced_screener_bp; from flask import Flask; from werkzeug.test import Client; from werkzeug.wrappers import Response; app=Flask(__name__); app.register_blueprint(advanced_screener_bp); c=Client(app,Response); resp=c.get('/api/screener/advanced?${params.replace(/'/g, "\\'").replace(/"/g, '\\"')}'); print(resp.data.decode('utf-8'))`;

    const scriptPath = path.join(PROJECT_ROOT, 'vps-service');
    const cmd = `cd ${scriptPath} && python3 -c "${pythonCode}" 2>/dev/null`;

    const stdout = execSync(cmd, {
      timeout: 60000,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const lines = stdout.trim().split('\n');
    const jsonLine = lines.reverse().find(l => l.trim().startsWith('{'));
    if (!jsonLine) {
      return NextResponse.json({
        success: false,
        error: 'No JSON from Python screener',
      }, { status: 500 });
    }

    const data = JSON.parse(jsonLine);
    return NextResponse.json(data);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({
      success: false,
      error: 'Python screener failed',
      details: errMsg,
    }, { status: 500 });
  }
}
