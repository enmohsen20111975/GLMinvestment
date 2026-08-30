import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DB_PATH = path.join(process.cwd(), 'db', 'predictions.db');

/**
 * POST /api/tomorrow-predictions/send-telegram
 *
 * بيبعت توقعات الغد على تليجرام.
 * بيستخدم TelegramNotifier من vps-service/telegram/telegram_notifier.py
 *
 * Body:
 *  - market: 'EGX' | 'CRYPTO' (default: EGX)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const market = body.market === 'CRYPTO' ? 'CRYPTO' : 'EGX';

    // 1. جلب التوقعات من DB
    const db = new Database(DB_PATH, { readonly: true });
    const sessionDate = db
      .prepare('SELECT MAX(session_date) as latest FROM tomorrow_predictions')
      .get() as { latest: string | null };

    if (!sessionDate?.latest) {
      db.close();
      return NextResponse.json(
        { success: false, error: 'مفيش توقعات متاحة. ولّد الأول.' },
        { status: 400 }
      );
    }

    const predictions = db
      .prepare(
        'SELECT * FROM tomorrow_predictions WHERE session_date = ? AND market = ? ORDER BY confidence DESC'
      )
      .all(sessionDate.latest, market) as any[];

    const watchlist = db
      .prepare(
        'SELECT * FROM tomorrow_watchlist WHERE session_date = ? AND market = ? ORDER BY CASE priority WHEN "HIGH" THEN 0 WHEN "MEDIUM" THEN 1 ELSE 2 END'
      )
      .all(sessionDate.latest, market) as any[];

    const activeStatus = db
      .prepare(
        'SELECT * FROM tomorrow_active_status WHERE session_date = ? AND market = ?'
      )
      .all(sessionDate.latest, market) as any[];

    db.close();

    if (predictions.length === 0 && watchlist.length === 0) {
      return NextResponse.json(
        { success: false, error: 'مفيش بيانات للإرسال' },
        { status: 400 }
      );
    }

    // 2. بناء رسالة تليجرام
    const message = buildTelegramMessage(
      sessionDate.latest,
      market,
      predictions,
      activeStatus,
      watchlist
    );

    // 3. إرسال عبر Python TelegramNotifier
    const result = await sendViaPython(message, market);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      session_date: sessionDate.latest,
      market,
      predictions_count: predictions.length,
      watchlist_count: watchlist.length,
      active_count: activeStatus.length,
      message_length: message.length,
    });
  } catch (e) {
    console.error('[api/tomorrow-predictions/send-telegram] error:', e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

function buildTelegramMessage(
  sessionDate: string,
  market: string,
  predictions: any[],
  activeStatus: any[],
  watchlist: any[]
): string {
  const marketName = market === 'CRYPTO' ? 'العملات الرقمية' : 'البورصة المصرية';
  const lines: string[] = [];

  lines.push(`🎯 توقعات جلسة ${sessionDate} — ${marketName}`);
  lines.push('═'.repeat(40));
  lines.push('');

  // القسم 1: التوقعات
  if (predictions.length > 0) {
    lines.push(`📊 التوقعات (${predictions.length}):`);
    lines.push('─'.repeat(40));
    for (const p of predictions) {
      const signal =
        p.signal === 'STRONG_BUY'
          ? '🟢 شراء قوي'
          : p.signal === 'BUY'
            ? '🟢 شراء'
            : p.signal === 'STRONG_SELL'
              ? '🔴 بيع قوي'
              : p.signal === 'SELL'
                ? '🔴 بيع'
                : p.signal;
      lines.push(
        `${signal} ${p.ticker} — دخول: ${p.entry_price?.toFixed(2)} | هدف: ${p.target_price?.toFixed(2)} | وقف: ${p.stop_loss?.toFixed(2)} | R/R: ${p.r_multiple?.toFixed(2)} | ثقة: ${p.confidence?.toFixed(0)}%`
      );
    }
    lines.push('');
  }

  // القسم 2: حالة الأسهم النشطة
  if (activeStatus.length > 0) {
    lines.push(`📈 الأسهم النشطة (${activeStatus.length}):`);
    lines.push('─'.repeat(40));
    for (const s of activeStatus.slice(0, 10)) {
      // أهم 10 بس
      lines.push(
        `${s.ticker} — ${s.original_signal} | الحالي: ${s.current_price?.toFixed(2)} | التقدم: ${s.progress_percent?.toFixed(1)}% | ${s.expected_action}`
      );
    }
    lines.push('');
  }

  // القسم 3: أسهم تحت المراقبة
  if (watchlist.length > 0) {
    const highPriority = watchlist.filter((w) => w.priority === 'HIGH');
    if (highPriority.length > 0) {
      lines.push(`👁️ تحت المراقبة — أولوية عالية (${highPriority.length}):`);
      lines.push('─'.repeat(40));
      for (const w of highPriority.slice(0, 10)) {
        lines.push(
          `${w.ticker} — ${w.watch_type} | ${w.change_percent >= 0 ? '+' : ''}${w.change_percent?.toFixed(2)}% | ${w.watch_reason}`
        );
      }
      lines.push('');
    }
  }

  // إخلاء المسؤولية
  lines.push('═'.repeat(40));
  lines.push('⚠️ إخلاء مسؤولية: هذه التوقعات رأي آلي تعليمي وليست توصية استثمارية. القرار مسؤولية العميل.');
  lines.push('لا يوجد ضمان للنتائج. استشر مستشاراً مالياً مرخصاً.');

  return lines.join('\n');
}

async function sendViaPython(
  message: string,
  market: string
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const scriptPath = path.join(
      process.cwd(),
      'vps-service',
      'telegram',
      'send_message.py'
    );

    // بنبعت الرسالة كـ stdin للـ Python script
    const pythonProcess = spawn('python3', [scriptPath, '--market', market], {
      cwd: process.cwd(),
      env: { ...process.env },
    });

    let stderr = '';

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // ابع الرسالة عبر stdin
    pythonProcess.stdin.write(message);
    pythonProcess.stdin.end();

    const timeout = setTimeout(() => {
      pythonProcess.kill('SIGTERM');
      resolve({ success: false, error: 'timeout' });
    }, 30000);

    pythonProcess.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({
          success: false,
          error: `Python exit code ${code}: ${stderr.slice(-300)}`,
        });
      }
    });

    pythonProcess.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });
  });
}
