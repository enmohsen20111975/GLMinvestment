import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/community-db';

export async function GET(
  request: NextRequest,
  { params }: { params: { post_id: string } }
) {
  try {
    const postId = params.post_id;

    const comments = db.prepare(`
      SELECT c.*, u.name as user_name, u.avatar as user_avatar
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `).all(postId);

    return NextResponse.json({ success: true, comments });
  } catch (error) {
    console.error('Get comments error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { post_id: string } }
) {
  try {
    const postId = params.post_id;
    const body = await request.json();
    const { user_id, content } = body;

    if (!user_id || !content) {
      return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 });
    }

    const result = db.prepare(
      'INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)'
    ).run(postId, user_id, content);

    return NextResponse.json({ success: true, comment_id: result.lastInsertRowid });
  } catch (error) {
    console.error('Create comment error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
