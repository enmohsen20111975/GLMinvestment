import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const PY = process.env.EGXPY_SERVICE_URL || 'http://127.0.0.1:8010';
export const dynamic = 'force-dynamic';

function openDb(): Database.Database {
  const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
  try {
    return new Database(dbPath, { readonly: true, timeout: 3000 });
  } catch {
    return new Database(`file:${dbPath}?immutable=1`, { timeout: 3000 });
  }
}

function extractLessonsFromDb(): any[] {
  const db = openDb();
  const lessons: any[] = [];
  try {
    const overall = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN outcome_date IS NOT NULL THEN 1 ELSE 0 END) as closed
      FROM predictions
    `).get() as any;
    const closed = Number(overall?.closed || 0);
    if (closed === 0) return lessons;

    // Lesson 1: High RSI failures
    const highRsiFailed = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE outcome_date IS NOT NULL AND is_correct = 0
      AND notes LIKE '%RSI=%'
      AND CAST(SUBSTR(notes, INSTR(notes, 'RSI=') + 4, 5) AS REAL) > 70
    `).get() as any;
    if (highRsiFailed?.c > 3) {
      lessons.push({
        type: 'technical', category: 'مؤشرات فنية',
        rule: 'لا تشتري عند RSI مرتفع (>70)',
        evidence: `${highRsiFailed.c} صفقة خاسرة من ${closed} عند RSI > 70`,
        failure_rate: Math.round((Number(highRsiFailed.c) / closed) * 100),
        sample_size: Number(highRsiFailed.c),
        recommendation: 'تفعيل فلتر RSI — تجنب الشراء إذا RSI > 70 إلا في حالة Momentum Accumulation',
        created_at: new Date().toISOString(),
      });
    }

    // Lesson 2: Low RSI failures
    const lowRsiFailed = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE outcome_date IS NOT NULL AND is_correct = 0
      AND notes LIKE '%RSI=%'
      AND CAST(SUBSTR(notes, INSTR(notes, 'RSI=') + 4, 5) AS REAL) < 30
    `).get() as any;
    if (lowRsiFailed?.c > 3) {
      lessons.push({
        type: 'technical', category: 'مؤشرات فنية',
        rule: 'لا تبيع عند RSI منخفض (<30) — قد يكون ارتداد',
        evidence: `${lowRsiFailed.c} صفقة خاسرة من ${closed} عند RSI < 30`,
        failure_rate: Math.round((Number(lowRsiFailed.c) / closed) * 100),
        sample_size: Number(lowRsiFailed.c),
        recommendation: 'تفعيل فلتر — عندما RSI < 30، انتظر تأكيد انعكاس قبل الدخول',
        created_at: new Date().toISOString(),
      });
    }

    // Lesson 3: Stop loss too tight
    const stopHit = db.prepare(`
      SELECT COUNT(*) as c, AVG(actual_return) as avg_ret FROM predictions
      WHERE outcome_date IS NOT NULL AND hit_stop = 1
    `).get() as any;
    if (stopHit?.c > 5) {
      const failureRate = Math.round((Number(stopHit.c) / closed) * 100);
      lessons.push({
        type: 'risk', category: 'إدارة مخاطر',
        rule: `${stopHit.c} صفقة ضربت وقف الخسارة — قد يكون الوقف ضيق جداً`,
        evidence: `${stopHit.c} صفقة ضربت الوقف من ${closed} (${failureRate}%)`,
        failure_rate: failureRate,
        sample_size: Number(stopHit.c),
        recommendation: 'توسيع الوقف باستخدام ATR × 2.5 بدل 2.0، أو استخدام Trailing Stop',
        created_at: new Date().toISOString(),
      });
    }

    // Lesson 4: Low R:R trades
    const lowRR = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE outcome_date IS NOT NULL AND is_correct = 0
      AND target_price IS NOT NULL AND stop_loss IS NOT NULL AND entry_price > 0
      AND (target_price - entry_price) / (entry_price - stop_loss) < 1.5
    `).get() as any;
    if (lowRR?.c > 3) {
      lessons.push({
        type: 'risk', category: 'إدارة مخاطر',
        rule: 'صفقات بنسبة R:R أقل من 1.5 فشلت بنسبة عالية',
        evidence: `${lowRR.c} صفقة خاسرة من ${closed} بـ R:R < 1.5`,
        failure_rate: Math.round((Number(lowRR.c) / closed) * 100),
        sample_size: Number(lowRR.c),
        recommendation: 'رفع الحد الأدنى لـ R:R إلى 1.5 على الأقل، ويفضل 2.0',
        created_at: new Date().toISOString(),
      });
    }

    // Lesson 5: SELL signals performance
    const sellWins = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE signal_type = 'SELL' AND outcome_date IS NOT NULL AND is_correct = 1
    `).get() as any;
    const sellTotal = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE signal_type = 'SELL' AND outcome_date IS NOT NULL
    `).get() as any;
    if (sellTotal?.c > 5) {
      const sellWinRate = Math.round((Number(sellWins?.c || 0) / Number(sellTotal.c)) * 100);
      if (sellWinRate < 40) {
        lessons.push({
          type: 'strategy', category: 'استراتيجية',
          rule: `إشارات البيع أداؤها ضعيف — نسبة نجاح ${sellWinRate}%`,
          evidence: `${sellWins?.c || 0} فوز من ${sellTotal.c} صفقة بيع`,
          failure_rate: 100 - sellWinRate,
          sample_size: Number(sellTotal.c),
          recommendation: 'تجنب صفقات البيع المكشوف في الأسواق الصاعدة — ركز على الشراء فقط',
          created_at: new Date().toISOString(),
        });
      }
    }

    // Save lessons to prediction_lessons table
    const writeDb = new Database(path.join(process.cwd(), 'db', 'predictions.db'));
    writeDb.exec(`CREATE TABLE IF NOT EXISTS prediction_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, category TEXT, rule TEXT, evidence TEXT,
      failure_rate REAL, sample_size INTEGER, recommendation TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    const insert = writeDb.prepare(
      'INSERT INTO prediction_lessons (type, category, rule, evidence, failure_rate, sample_size, recommendation) VALUES (?,?,?,?,?,?,?)'
    );
    for (const l of lessons) {
      try {
        insert.run(l.type, l.category, l.rule, l.evidence, l.failure_rate, l.sample_size, l.recommendation);
      } catch {}
    }
    writeDb.close();
  } catch (e) {
    console.error('extractLessonsFromDb error:', e);
  } finally {
    db.close();
  }
  return lessons;
}

async function handle(req: NextRequest) {
  try {
    // Extract lessons from local DB first
    const localLessons = extractLessonsFromDb();

    // Also try to call Python full-cycle learning engine
    let pythonResult: any = null;
    try {
      const url = new URL(req.url);
      const qs = url.searchParams.toString();
      const targetUrl = `${PY}/api/daily/full-cycle${qs ? `?${qs}` : ''}`;
      const body = req.method !== 'GET' ? await req.text() : '{}';
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(60000),
      });
      pythonResult = await res.json();
    } catch {
      // Python engine unavailable — use local lessons only
    }

    return NextResponse.json({
      success: true,
      lessons: localLessons,
      python_feedback: pythonResult,
      message: `تم استخراج ${localLessons.length} درس من الأخطاء وتغذية نظام التعلم`,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    }, { status: 503 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
