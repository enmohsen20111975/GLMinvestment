import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/community-db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const roomId = searchParams.get('room_id');

    let posts;
    if (roomId) {
      posts = db.prepare(`
        SELECT p.*, u.name as user_name, u.avatar as user_avatar, r.name_ar as room_name
        FROM posts p
        JOIN users u ON p.user_id = u.id
        JOIN rooms r ON p.room_id = r.id
        WHERE p.room_id = ?
        ORDER BY p.created_at DESC
        LIMIT 50
      `).all(roomId);
    } else {
      posts = db.prepare(`
        SELECT p.*, u.name as user_name, u.avatar as user_avatar, r.name_ar as room_name
        FROM posts p
        JOIN users u ON p.user_id = u.id
        JOIN rooms r ON p.room_id = r.id
        ORDER BY p.created_at DESC
        LIMIT 50
      `).all();
    }

    const rooms = db.prepare('SELECT * FROM rooms').all();

    return NextResponse.json({ success: true, posts, rooms });
  } catch (error) {
    console.error('Community API error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, room_id, content } = body;

    if (!user_id || !room_id || !content) {
      return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 });
    }

    const result = db.prepare(
      'INSERT INTO posts (user_id, room_id, content) VALUES (?, ?, ?)'
    ).run(user_id, room_id, content);

    return NextResponse.json({ success: true, post_id: result.lastInsertRowid });
  } catch (error) {
    console.error('Create post error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
