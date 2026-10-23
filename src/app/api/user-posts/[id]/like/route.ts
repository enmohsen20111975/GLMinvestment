import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/auth-helper';

// POST - إضافة/إزالة إعجاب
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // F1.2 — auth guard (IDOR fix): require session.
    const { userId: sessionUserId } = await getSessionUserId();
    if (!sessionUserId) {
      return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
    }
    const user_id = sessionUserId;

    const { id } = await params;
    const body = await request.json();
    const { user_id } = body;

    if (!user_id) {
      return NextResponse.json({ error: 'مطلوب تسجيل الدخول' }, { status: 401 });
    }

    // التحقق من وجود المنشور
    const post = await db.userPost.findUnique({ where: { id } });
    if (!post) {
      return NextResponse.json({ error: 'المنشور غير موجود' }, { status: 404 });
    }

    // التحقق من وجود إعجاب سابق
    const existingLike = await db.postLike.findUnique({
      where: {
        post_id_user_id: { post_id: id, user_id }
      }
    });

    if (existingLike) {
      // إزالة الإعجاب
      await db.postLike.delete({ where: { id: existingLike.id } });
      await db.userPost.update({
        where: { id },
        data: { likes: { decrement: 1 } }
      });
      return NextResponse.json({ liked: false, message: 'تم إزالة الإعجاب' });
    } else {
      // إضافة إعجاب
      await db.postLike.create({
        data: { post_id: id, user_id }
      });
      await db.userPost.update({
        where: { id },
        data: { likes: { increment: 1 } }
      });
      return NextResponse.json({ liked: true, message: 'تم الإعجاب' });
    }
  } catch (error) {
    console.error('[Post Like API] Error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  }
}
