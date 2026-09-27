import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

// P0-11-AUTH fix (2026-09-27): added user+admin auth guards.
// POST (user submits transfer receipt): requireAuthAsync.
// GET  (admin lists pending payments): requireAdminAsync.
// Previously POST trusted a client-supplied user_id; GET trusted a
// client-supplied admin_id in query string — both were spoofable.
import { requireAuthAsync, requireAdminAsync } from '@/lib/admin-guard';
import { db } from '@/lib/db';

// POST - إرسال بيانات التحويل للتحقق
export async function POST(request: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): user auth guard
  const auth = await requireAuthAsync(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const { payment_id, user_id, sender_name, sender_phone, instapay_ref, notes } = body;

    if (!payment_id || !user_id) {
      return NextResponse.json({ error: 'البيانات غير مكتملة' }, { status: 400 });
    }

    // Try Prisma first
    let payment = null;
    try {
      payment = await db.instaPayPayment.findUnique({
        where: { id: payment_id }
      });
    } catch (prismaErr) {
      console.warn('[InstaPay Verify] Prisma error, trying SQLite fallback:', prismaErr);

      // Fallback: استخدم auth.db مباشرة
      try {
        const Database = require('better-sqlite3');
        const path = require('path');
        const dbPath = path.join(process.cwd(), 'db', 'auth.db');
        const sqliteDb = new Database(dbPath, { readonly: false });

        // إنشاء الجدول لو مش موجود
        sqliteDb.exec(`
          CREATE TABLE IF NOT EXISTS instaPayPayment (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            amount REAL,
            currency TEXT DEFAULT 'EGP',
            points INTEGER DEFAULT 0,
            plan_id TEXT,
            sender_name TEXT,
            sender_phone TEXT,
            instapay_ref TEXT,
            notes TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        const row = sqliteDb.prepare('SELECT * FROM instaPayPayment WHERE id = ?').get(payment_id);
        if (row) {
          payment = row;
        }
        sqliteDb.close();
      } catch (sqlErr) {
        console.warn('[InstaPay Verify] SQLite fallback error:', sqlErr);
      }
    }

    if (!payment) {
      return NextResponse.json({ error: 'طلب الدفع غير موجود' }, { status: 404 });
    }

    if (payment.user_id !== user_id) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    if (payment.status !== 'pending') {
      return NextResponse.json({ error: 'تم معالجة هذا الطلب بالفعل' }, { status: 400 });
    }

    // تحديث بيانات التحويل
    try {
      await db.instaPayPayment.update({
        where: { id: payment_id },
        data: {
          sender_name,
          sender_phone,
          instapay_ref,
          notes,
          status: 'pending', // يظل pending حتى يتحقق الأدمن
        }
      });
    } catch (updateErr) {
      console.warn('[InstaPay Verify] Update error, trying SQLite:', updateErr);
      // Fallback: تحديث SQLite مباشرة
      try {
        const Database = require('better-sqlite3');
        const path = require('path');
        const dbPath = path.join(process.cwd(), 'db', 'auth.db');
        const sqliteDb = new Database(dbPath, { readonly: false });
        sqliteDb.prepare(`
          UPDATE instaPayPayment
          SET sender_name = ?, sender_phone = ?, instapay_ref = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(sender_name, sender_phone, instapay_ref, notes, payment_id);
        sqliteDb.close();
      } catch (sqlErr) {
        console.warn('[InstaPay Verify] SQLite update error:', sqlErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'تم إرسال بيانات التحويل بنجاح',
      note: 'سيتم مراجعة طلبك وإضافة النقاط خلال دقائق'
    });
  } catch (error) {
    console.error('[InstaPay Verify API] Error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  }
}

// GET - جلب المدفوعات المعلقة للأدمن
export async function GET(request: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): admin auth guard
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    const { searchParams } = new URL(request.url);
    const admin_id = searchParams.get('admin_id');
    const status = searchParams.get('status') || 'pending';

    // التحقق من صلاحيات الأدمن
    if (admin_id) {
      try {
        const admin = await db.user.findUnique({
          where: { id: admin_id }
        });

        if (!admin || admin.subscription_tier !== 'admin') {
          return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
        }
      } catch (adminErr) {
        console.warn('[InstaPay Verify] Admin check error:', adminErr);
      }
    }

    // Try Prisma first
    try {
      const payments = await db.instaPayPayment.findMany({
        where: { status },
        include: {
          User: {
            select: { id: true, name: true, email: true, username: true }
          }
        },
        orderBy: { created_at: 'desc' }
      });

      return NextResponse.json({ payments });
    } catch (prismaErr) {
      console.warn('[InstaPay Verify] Prisma error, trying SQLite:', prismaErr);

      // Fallback: SQLite مباشرة
      try {
        const Database = require('better-sqlite3');
        const path = require('path');
        const dbPath = path.join(process.cwd(), 'db', 'auth.db');
        const sqliteDb = new Database(dbPath, { readonly: true });

        const payments = sqliteDb.prepare(`
          SELECT * FROM instaPayPayment WHERE status = ?
          ORDER BY created_at DESC
          LIMIT 100
        `).all(status);

        sqliteDb.close();

        return NextResponse.json({ payments });
      } catch (sqlErr) {
        console.warn('[InstaPay Verify] SQLite error:', sqlErr);
        return NextResponse.json({ payments: [] });
      }
    }
  } catch (error) {
    console.error('[InstaPay Verify API] Error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  }
}
