import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/auth-helper';

// GET - جلب منشور محدد
export async function GET(
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
    
    const post = await db.userPost.findUnique({
      where: { id },
      include: {
        User: {
          select: { id: true, name: true, username: true, image: true }
        },
        PostComments: {
          include: {
            User: {
              select: { id: true, name: true, image: true }
            }
          },
          orderBy: { created_at: 'desc' }
        },
        _count: {
          select: { PostLikes: true }
        }
      }
    });

    if (!post) {
      return NextResponse.json({ error: 'المنشور غير موجود' }, { status: 404 });
    }

    // زيادة عدد المشاهدات
    await db.userPost.update({
      where: { id },
      data: { views: { increment: 1 } }
    });

    return NextResponse.json({
      ...post,
      likes: post._count.PostLikes
    });
  } catch (error) {
    console.error('[User Post API] Error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  }
}

// DELETE - حذف منشور
export async function DELETE(
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
    const { searchParams } = new URL(request.url);
    const user_id = searchParams.get('user_id');

    if (!user_id) {
      return NextResponse.json({ error: 'مطلوب تسجيل الدخول' }, { status: 401 });
    }

    const post = await db.userPost.findUnique({ where: { id } });
    if (!post) {
      return NextResponse.json({ error: 'المنشور غير موجود' }, { status: 404 });
    }

    if (post.user_id !== user_id) {
      return NextResponse.json({ error: 'غير مصرح لك بحذف هذا المنشور' }, { status: 403 });
    }

    await db.userPost.delete({ where: { id } });

    return NextResponse.json({ message: 'تم حذف المنشور بنجاح' });
  } catch (error) {
    console.error('[User Post API] Error:', error);
    return NextResponse.json({ error: 'حدث خطأ في حذف المنشور' }, { status: 500 });
  }
}
