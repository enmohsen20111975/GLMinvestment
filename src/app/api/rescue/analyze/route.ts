/**
 * Rescue Clinic API — ALPHA-RESCUE-V1
 * ===================================
 *  POST /api/rescue/analyze    body: { ticker, purchase_price, quantity, total_cost? }
 *  GET  /api/rescue/analyze?ticker=COMI&buy_price=150&quantity=100  (legacy compat)
 *
 * عيادة إنقاذ الصفقات المتعثرة — تُرجع القرارات الثلاثة الصارمة:
 *   🛑 CUT_LOSS (اقطع الخسارة فوراً)
 *   🔄 AVERAGE_DOWN (برّد بحساب دقيق) — فقط لو ثبت قاع تجميعي مؤسسي
 *   ⏳ HOLD (اصبر) — فقط عند الدعم التاريخي وأساسيات ممتازة
 *
 * Rule 4  (NO FRONTEND COMPUTATION): كل القرارات من Python (bag_holder_rescue.py).
 * Rule 20 (PYTHON = BRAIN): المنطق الكامل في vps-service/analyzers/bag_holder_rescue.py.
 * Rule 27 (NO-FAKE-DATA): fallback صادق لو Python غير متاح.
 *
 * Response: { success, ticker, decision, decision_ar, verdict_badge,
 *             current_price, buy_price, loss_amount, loss_pct, invested_egp,
 *             market_value_egp, recovery_needed_pct, diagnosis, autopsy,
 *             asset_health, action_plan {options:[EXIT_FULL,PARTIAL_REDUCE,WAIT_MONITOR]},
 *             lessons_learned, decisions: [CUT_LOSS, AVERAGE_DOWN, HOLD] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ─── Helpers ──────────────────────────────────────────────────────────────

interface RescueInput {
  ticker: string;
  purchase_price: number;
  quantity: number;
  total_cost?: number;
  buy_date?: string;
}

function validateInput(body: Partial<RescueInput>): {
  ok: boolean;
  input?: RescueInput;
  error?: string;
} {
  const ticker = (body.ticker || '').toString().toUpperCase().trim();
  if (!ticker) return { ok: false, error: 'ticker مطلوب' };

  // purchase_price: optional if total_cost + quantity provided (we can derive)
  let purchasePrice = Number(body.purchase_price);
  let quantity = Number(body.quantity);

  // If total_cost provided and one of (purchase_price|quantity) missing → derive
  const totalCost = body.total_cost != null ? Number(body.total_cost) : NaN;
  if (Number.isFinite(totalCost) && totalCost > 0) {
    if ((!Number.isFinite(purchasePrice) || purchasePrice <= 0) && Number.isFinite(quantity) && quantity > 0) {
      purchasePrice = totalCost / quantity;
    }
    if ((!Number.isFinite(quantity) || quantity <= 0) && Number.isFinite(purchasePrice) && purchasePrice > 0) {
      quantity = totalCost / purchasePrice;
    }
  }

  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) {
    return { ok: false, error: 'purchase_price مطلوب ويجب أن يكون > 0 (أو اِرسل total_cost + quantity)' };
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, error: 'quantity مطلوب ويجب أن يكون > 0 (أو اِرسل total_cost + purchase_price)' };
  }

  return {
    ok: true,
    input: {
      ticker,
      purchase_price: purchasePrice,
      quantity,
      total_cost: Number.isFinite(totalCost) && totalCost > 0 ? totalCost : purchasePrice * quantity,
      buy_date: (body.buy_date || '').toString(),
    },
  };
}

/**
 * Spawn Python and call BagHolderRescue.analyze_clinic().
 * Returns the parsed payload (dict from Python) or throws on failure.
 */
function runPythonRescue(projectRoot: string, input: RescueInput): Promise<Record<string, any>> {
  const script = `
import sys, json, os
sys.path.insert(0, os.path.join(${JSON.stringify(projectRoot)}, 'vps-service'))
from analyzers.bag_holder_rescue import BagHolderRescue
rescuer = BagHolderRescue()
result = rescuer.analyze_clinic(
    ticker=${JSON.stringify(input.ticker)},
    buy_price=${input.purchase_price},
    quantity=${input.quantity},
    buy_date=${JSON.stringify(input.buy_date || '')},
)
print(json.dumps(result, ensure_ascii=False, default=str))
`;

  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-c', script], {
      cwd: projectRoot,
      env: { ...process.env, PROJECT_ROOT: projectRoot },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Python subprocess timeout (15s)'));
    }, 15000);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Python exit ${code}: ${stderr.slice(0, 800)}`));
        return;
      }
      // filter stdout for the last JSON line (ignore CONFIG/INFO logs)
      const jsonLine = stdout
        .trim()
        .split('\n')
        .filter((l) => l.trim().startsWith('{'))
        .pop();
      if (!jsonLine) {
        reject(new Error('No JSON output from Python'));
        return;
      }
      try {
        resolve(JSON.parse(jsonLine));
      } catch (e: any) {
        reject(new Error(`JSON parse error: ${e.message}`));
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ─── Build the THREE decisions view (from Python's action_plan + verdict) ──

const DECISION_META: Record<
  'CUT_LOSS' | 'AVERAGE_DOWN' | 'HOLD',
  { ar_title: string; ar_when: string; icon: string }
> = {
  CUT_LOSS: {
    ar_title: '🛑 اقطع الخسارة فوراً',
    ar_when: 'شركة خاسرة + اتجاه هابط بلا قاع واضح',
    icon: 'STOP',
  },
  AVERAGE_DOWN: {
    ar_title: '🔄 برّد بحساب دقيق',
    ar_when: 'فقط لو ثبت قاع تجميعي مؤسسي فعلي',
    icon: 'CYCLE',
  },
  HOLD: {
    ar_title: '⏳ اصبر',
    ar_when: 'عند دعم تاريخي + أساسيات ممتازة',
    icon: 'WAIT',
  },
};

function buildDecisionsView(
  decision: string | null,
  actionPlan: any | null,
  assetHealth: any | null,
): Array<{
  key: 'CUT_LOSS' | 'AVERAGE_DOWN' | 'HOLD';
  ar_title: string;
  ar_when: string;
  active: boolean;
  applicable_reason: string | null;
  invalidation: string | null;
  level: string | null;
  level_price: number | null;
}> {
  const active = (decision || 'HOLD') as 'CUT_LOSS' | 'AVERAGE_DOWN' | 'HOLD';

  // Map Python's 3 options (EXIT_FULL/PARTIAL_REDUCE/WAIT_MONITOR) onto the
  // 3 user-facing decisions (CUT_LOSS/AVERAGE_DOWN/HOLD). The Python engine's
  // active option corresponds to its `decision` field already, so we keep the
  // verdict's `decision` as the source of truth (Rule 4 — Python computes).
  const optionsMap: Record<string, any> = {};
  if (Array.isArray(actionPlan?.options)) {
    for (const o of actionPlan.options) optionsMap[o.key] = o;
  }

  const cutLoss = optionsMap['EXIT_FULL'] || null;
  const avgDown = optionsMap['PARTIAL_REDUCE'] || null;
  const hold = optionsMap['WAIT_MONITOR'] || null;

  return [
    {
      key: 'CUT_LOSS',
      ...DECISION_META.CUT_LOSS,
      active: active === 'CUT_LOSS',
      applicable_reason: cutLoss?.reason ?? null,
      invalidation: cutLoss?.invalidation ?? null,
      level: cutLoss?.level ?? null,
      level_price: cutLoss?.level_price ?? null,
    },
    {
      key: 'AVERAGE_DOWN',
      ...DECISION_META.AVERAGE_DOWN,
      active: active === 'AVERAGE_DOWN',
      applicable_reason: avgDown?.reason ?? null,
      invalidation: avgDown?.invalidation ?? null,
      level: avgDown?.level ?? null,
      level_price: avgDown?.level_price ?? null,
    },
    {
      key: 'HOLD',
      ...DECISION_META.HOLD,
      active: active === 'HOLD',
      applicable_reason: hold?.reason ?? null,
      invalidation: hold?.invalidation ?? null,
      level: hold?.level ?? null,
      level_price: hold?.level_price ?? null,
    },
  ];
}

// ─── POST handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'invalid_json', message: 'JSON body مطلوب' },
      { status: 400 },
    );
  }

  const v = validateInput(body);
  if (!v.ok || !v.input) {
    return NextResponse.json(
      { success: false, error: 'invalid_input', message: v.error },
      { status: 400 },
    );
  }
  const input = v.input;
  const projectRoot = process.cwd();

  try {
    const result = await runPythonRescue(projectRoot, input);

    // Decorate with the 3-decisions view + capital recovery summary
    const decisions = buildDecisionsView(
      result.decision ?? null,
      result.action_plan ?? null,
      result.asset_health ?? null,
    );

    return NextResponse.json({
      success: true,
      ...result,
      decisions,
      input: {
        ticker: input.ticker,
        purchase_price: input.purchase_price,
        quantity: input.quantity,
        total_cost: input.total_cost ?? input.purchase_price * input.quantity,
      },
    });
  } catch (error: any) {
    console.error('[POST /api/rescue/analyze] Python failed:', error);
    // Rule 27 — honest fallback (no fabricated decisions)
    return NextResponse.json(
      {
        success: false,
        error: 'rescue_engine_unavailable',
        message:
          'محرك تحليل الإنقاذ (Python) غير متاح حالياً. تأكد من تثبيت vps-service وأن قواعد البيانات متاحة، ثم أعد المحاولة.',
        details: error?.message || String(error),
        ticker: input.ticker,
        input: {
          ticker: input.ticker,
          purchase_price: input.purchase_price,
          quantity: input.quantity,
          total_cost: input.total_cost ?? input.purchase_price * input.quantity,
        },
      },
      { status: 502 },
    );
  }
}

// ─── GET handler (legacy compatibility) ───────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') || '').toUpperCase().trim();
  const buyPrice = parseFloat(searchParams.get('buy_price') || '0');
  const quantity = parseFloat(searchParams.get('quantity') || '0');
  const totalCost = parseFloat(searchParams.get('total_cost') || '0');
  const buyDate = searchParams.get('buy_date') || '';

  const body: Partial<RescueInput> = {
    ticker,
    purchase_price: buyPrice,
    quantity,
    buy_date: buyDate,
  };
  if (Number.isFinite(totalCost) && totalCost > 0) body.total_cost = totalCost;

  // Reuse POST pipeline by validating then running
  const v = validateInput(body);
  if (!v.ok || !v.input) {
    return NextResponse.json(
      { success: false, error: 'invalid_input', message: v.error },
      { status: 400 },
    );
  }
  const input = v.input;
  const projectRoot = process.cwd();

  try {
    const result = await runPythonRescue(projectRoot, input);
    const decisions = buildDecisionsView(
      result.decision ?? null,
      result.action_plan ?? null,
      result.asset_health ?? null,
    );
    return NextResponse.json({
      success: true,
      ...result,
      decisions,
      input: {
        ticker: input.ticker,
        purchase_price: input.purchase_price,
        quantity: input.quantity,
        total_cost: input.total_cost ?? input.purchase_price * input.quantity,
      },
    });
  } catch (error: any) {
    console.error('[GET /api/rescue/analyze] Python failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'rescue_engine_unavailable',
        message:
          'محرك تحليل الإنقاذ (Python) غير متاح حالياً. تأكد من تثبيت vps-service وأن قواعد البيانات متاحة، ثم أعد المحاولة.',
        details: error?.message || String(error),
        ticker: input.ticker,
      },
      { status: 502 },
    );
  }
}
