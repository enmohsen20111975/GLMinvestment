/**
 * GET /api/rescue/analyze?ticker=EGREF&buy_price=32.50&quantity=1000&buy_date=2026-08-01
 *
 * Task BRAVO-STANDALONE-RESCUE-CLINIC-API (Owner Directive 2026-10-13)
 *
 * عيادة إنقاذ الصفقات المتعثرة — تحليل محايد + خطة تعافي بخيارات مرتبة.
 * اتساق رقمي إلزامي، وإيقاف التوصية عند تعارض البيانات.
 *
 * Rule 20 (PYTHON = BRAIN): كل المنطق في Python (bag_holder_rescue.py).
 * Rule 27 (NO-FAKE-DATA): كل الأرقام من DBs حقيقية.
 *
 * Response: { decision, decision_ar, verdict_badge, diagnosis, autopsy,
 *   asset_health, action_plan (3 options), lessons_learned }
 *   أو { data_conflict: true, conflict_reasons } عند تعارض البيانات.
 */

import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { join } from 'path';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') || '').toUpperCase().trim();
  const buyPrice = parseFloat(searchParams.get('buy_price') || '0');
  const quantity = parseFloat(searchParams.get('quantity') || '0');
  const buyDate = searchParams.get('buy_date') || '';

  if (!ticker) {
    return NextResponse.json(
      { success: false, error: 'ticker مطلوب' },
      { status: 400 }
    );
  }
  if (!buyPrice || buyPrice <= 0) {
    return NextResponse.json(
      { success: false, error: 'buy_price مطلوب ويجب أن يكون > 0' },
      { status: 400 }
    );
  }
  if (!quantity || quantity <= 0) {
    return NextResponse.json(
      { success: false, error: 'quantity مطلوب ويجب أن يكون > 0' },
      { status: 400 }
    );
  }

  const projectRoot = process.cwd();

  // Python script — يستدعي analyze_clinic() من bag_holder_rescue.py
  const script = `
import sys, json, os
sys.path.insert(0, os.path.join(${JSON.stringify(projectRoot)}, 'vps-service'))
from analyzers.bag_holder_rescue import BagHolderRescue
rescuer = BagHolderRescue()
result = rescuer.analyze_clinic(
    ticker=${JSON.stringify(ticker)},
    buy_price=${buyPrice},
    quantity=${quantity},
    buy_date=${JSON.stringify(buyDate)},
)
print(json.dumps(result, ensure_ascii=False, default=str))
`;

  try {
    const child = spawn('python3', ['-c', script], {
      cwd: projectRoot,
      env: { ...process.env, PROJECT_ROOT: projectRoot },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Python subprocess timeout (10s)'));
      }, 10000);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Python exit ${code}: ${stderr}`));
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // filter stdout لأخذ آخر سطر JSON فقط (تجاهل CONFIG/INFO logs)
    const jsonLine = stdout.trim().split('\n').filter((l) => l.trim().startsWith('{')).pop();
    if (!jsonLine) {
      throw new Error('No JSON output from Python');
    }
    const result = JSON.parse(jsonLine);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[rescue/analyze] Python subprocess failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'rescue_analysis_failed',
        message: error.message || 'فشل تحليل عيادة الإنقاذ',
      },
      { status: 500 }
    );
  }
}
