import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';
import { requireAuthAsync } from '@/lib/auth-helper';

// P0-CRIT-4 FIX (2026-10-14): DELETE now requires authenticated session via requireAuthAsync().
// Removed the previous user_id query-string approach (IDOR: anyone knowing user_id could delete).

// GET - جلب منشور محدد
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
    // P0-CRIT-4 FIX: Require authenticated session (no more user_id from query string).
    const authenticatedUserId = await requireAuthAsync();
    if (!authenticatedUserId) {
      return NextResponse.json({ error: 'مطلوب تسجيل الدخول' }, { status: 401 });
    }

    const { id } = await params;

    const post = await db.userPost.findUnique({ where: { id } });
    if (!post) {
      return NextResponse.json({ error: 'المنشور غير موجود' }, { status: 404 });
    }

    // Authorization: only the owner can delete.
    if (post.user_id !== authenticatedUserId) {
      return NextResponse.json({ error: 'غير مصرح لك بحذف هذا المنشور' }, { status: 403 });
    }

    await db.userPost.delete({ where: { id } });

    return NextResponse.json({ message: 'تم حذف المنشور بنجاح' });
  } catch (error) {
    console.error('[User Post API] Error:', error);
    return NextResponse.json({ error: 'حدث خطأ في حذف المنشور' }, { status: 500 });
  }
}
