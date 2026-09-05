import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { db } from '@/lib/db';

const LEARNING_PROGRESS_TITLE = '__learning_progress_v2__';

async function getUserId() {
  const session = await getServerSession(authOptions);
  return ((session?.user as { id?: string } | undefined)?.id) || null;
}

export async function GET() {
  try {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const record = await db.post.findFirst({
      where: {
        authorId: userId,
        title: LEARNING_PROGRESS_TITLE,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    if (!record?.content) {
      return NextResponse.json({ success: true, progress: null });
    }

    return NextResponse.json({
      success: true,
      progress: JSON.parse(record.content),
      updated_at: record.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to read learning progress', detail: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const progress = body?.progress ?? body;
    const content = JSON.stringify(progress);

    const existing = await db.post.findFirst({
      where: {
        authorId: userId,
        title: LEARNING_PROGRESS_TITLE,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    const record = existing
      ? await db.post.update({
          where: { id: existing.id },
          data: { content },
        })
      : await db.post.create({
          data: {
            authorId: userId,
            title: LEARNING_PROGRESS_TITLE,
            content,
            published: false,
          },
        });

    return NextResponse.json({
      success: true,
      updated_at: record.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to save learning progress', detail: String(error) },
      { status: 500 }
    );
  }
}
