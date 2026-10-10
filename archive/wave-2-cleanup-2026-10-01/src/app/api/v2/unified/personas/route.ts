/**
 * GET /api/v2/unified/personas
 * =============================
 * Flutter compat endpoint — قائمة الشخصيات (personas).
 *
 * - لو فيه maestro_personas table في stocks.db → اقرأها
 * - غير كده → رجّع الـ 3 personas الافتراضية: conservative / balanced / aggressive
 *   مع allocation matrix كامل لكل persona
 *
 * لاحظ: المنصة عندها personas أكثر في /api/v2/unified/config (investor/gambler/
 * swing/scalper/balanced)، لكن Flutter app بيتوقع الـ 3 الأساسية هنا.
 */

import { NextResponse } from 'next/server';
import { getFinanceDb } from '@/lib/finance-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PersonaAllocation {
  stocks: number;       // %
  gold: number;         // %
  crypto: number;       // %
  cash: number;         // %
  fixed_income: number; // % (certificates / deposits)
}

interface Persona {
  id: string;
  name: string;
  name_en: string;
  description: string;
  description_en: string;
  risk_level: 'low' | 'medium' | 'high';
  timeframe: string;
  color: string;
  min_score: number;
  default_top_n: number;
  weights: {
    technical: number;
    fundamental: number;
    macro: number;
    sentiment: number;
    confluence: number;
  };
  allocation: PersonaAllocation;
  max_position_pct: number;     // أقصى نسبة لكل صفقة
  stop_loss_pct: number;        // نسبة stop loss الافتراضية
  take_profit_pct: number;      // نسبة take profit الافتراضية
}

// ── الـ 3 personas الافتراضية ─────────────────────────────────────────
const DEFAULT_PERSONAS: Persona[] = [
  {
    id: 'conservative',
    name: 'المحافظ',
    name_en: 'Conservative',
    description: 'استثمار آمن بأقل مخاطرة ممكنة — يركز على الأسهم الكبيرة والشهادات',
    description_en: 'Safe investment with minimal risk — focus on large-cap stocks and certificates',
    risk_level: 'low',
    timeframe: 'months-year',
    color: '#10b981',
    min_score: 75,
    default_top_n: 10,
    weights: {
      technical: 0.15,
      fundamental: 0.50,
      macro: 0.20,
      sentiment: 0.05,
      confluence: 0.10,
    },
    allocation: {
      stocks: 30,
      gold: 20,
      crypto: 0,
      cash: 15,
      fixed_income: 35,
    },
    max_position_pct: 5,
    stop_loss_pct: 5,
    take_profit_pct: 15,
  },
  {
    id: 'balanced',
    name: 'المتوازن',
    name_en: 'Balanced',
    description: 'مزيج متوازن بين النمو والدخل — مناسب لأغلب المستثمرين',
    description_en: 'Balanced mix of growth and income — suitable for most investors',
    risk_level: 'medium',
    timeframe: 'weeks-months',
    color: '#8b5cf6',
    min_score: 65,
    default_top_n: 20,
    weights: {
      technical: 0.25,
      fundamental: 0.30,
      macro: 0.20,
      sentiment: 0.10,
      confluence: 0.15,
    },
    allocation: {
      stocks: 50,
      gold: 15,
      crypto: 5,
      cash: 10,
      fixed_income: 20,
    },
    max_position_pct: 10,
    stop_loss_pct: 7,
    take_profit_pct: 20,
  },
  {
    id: 'aggressive',
    name: 'العدواني',
    name_en: 'Aggressive',
    description: 'مضاربة عالية المخاطر بحثًا عن أعلى عائد ممكن',
    description_en: 'High-risk speculation seeking maximum possible returns',
    risk_level: 'high',
    timeframe: 'days-weeks',
    color: '#ef4444',
    min_score: 60,
    default_top_n: 25,
    weights: {
      technical: 0.50,
      fundamental: 0.10,
      macro: 0.05,
      sentiment: 0.15,
      confluence: 0.20,
    },
    allocation: {
      stocks: 65,
      gold: 5,
      crypto: 15,
      cash: 5,
      fixed_income: 10,
    },
    max_position_pct: 15,
    stop_loss_pct: 10,
    take_profit_pct: 30,
  },
];

interface MaestroPersonaRow {
  id: string | number;
  persona_id?: string;
  name?: string;
  name_en?: string;
  description?: string;
  risk_level?: string;
  timeframe?: string;
  color?: string;
  min_score?: number;
  default_top_n?: number;
  weights_json?: string;
  allocation_json?: string;
  max_position_pct?: number;
  stop_loss_pct?: number;
  take_profit_pct?: number;
}

function normalizePersonaFromDb(r: MaestroPersonaRow): Persona | null {
  const id = r.persona_id || String(r.id || '');
  if (!id) return null;

  let weights: Persona['weights'] = {
    technical: 0.25, fundamental: 0.25, macro: 0.20, sentiment: 0.15, confluence: 0.15,
  };
  if (r.weights_json) {
    try {
      const parsed = JSON.parse(r.weights_json);
      weights = { ...weights, ...parsed };
    } catch { /* keep defaults */ }
  }

  let allocation: PersonaAllocation = {
    stocks: 50, gold: 15, crypto: 5, cash: 10, fixed_income: 20,
  };
  if (r.allocation_json) {
    try {
      const parsed = JSON.parse(r.allocation_json);
      allocation = { ...allocation, ...parsed };
    } catch { /* keep defaults */ }
  }

  const risk = String(r.risk_level || 'medium').toLowerCase();
  const validRisk = risk === 'low' || risk === 'medium' || risk === 'high' ? risk : 'medium';

  return {
    id,
    name: r.name || id,
    name_en: r.name_en || r.name || id,
    description: r.description || '',
    description_en: r.description_en || '',
    risk_level: validRisk as Persona['risk_level'],
    timeframe: r.timeframe || 'weeks-months',
    color: r.color || '#8b5cf6',
    min_score: Number(r.min_score) || 65,
    default_top_n: Number(r.default_top_n) || 20,
    weights,
    allocation,
    max_position_pct: Number(r.max_position_pct) || 10,
    stop_loss_pct: Number(r.stop_loss_pct) || 7,
    take_profit_pct: Number(r.take_profit_pct) || 20,
  };
}

export async function GET() {
  try {
    let dbPersonas: Persona[] = [];
    let source = 'default';

    // جرّب maestro_personas من stocks.db
    try {
      const db = await getFinanceDb();
      const hasTable = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='maestro_personas' LIMIT 1"
      ).get() as { name?: string } | undefined;

      if (hasTable?.name) {
        const rows = db.prepare(`
          SELECT * FROM maestro_personas ORDER BY id ASC LIMIT 50
        `).all() as MaestroPersonaRow[];
        const normalized = rows.map(normalizePersonaFromDb).filter((p): p is Persona => p !== null);
        if (normalized.length > 0) {
          dbPersonas = normalized;
          source = 'stocks.db.maestro_personas';
        }
      }
    } catch (e) {
      console.warn('[v2/unified/personas] stocks.db query failed:', e);
    }

    const personas = dbPersonas.length > 0 ? dbPersonas : DEFAULT_PERSONAS;
    if (dbPersonas.length === 0) source = 'default';

    return NextResponse.json({
      success: true,
      personas,
      count: personas.length,
      source,
      // allocation matrix مفصول عشان الـ Flutter يقدر يعرضه في جدول
      allocation_matrix: personas.map(p => ({
        persona_id: p.id,
        persona_name: p.name,
        risk_level: p.risk_level,
        ...p.allocation,
      })),
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[GET /api/v2/unified/personas] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'internal_error',
        personas: DEFAULT_PERSONAS,
        count: DEFAULT_PERSONAS.length,
        source: 'default',
      },
      { status: 500 }
    );
  }
}
