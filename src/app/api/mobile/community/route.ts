/**
 * Mobile Community API - Community Posts and Rooms
 * المجتمع - المنشورات والغرف
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const roomId = searchParams.get('room_id');
    const limit = parseInt(searchParams.get('limit') || '50');

    const { db } = await import('@/lib/community-db');

    let posts;
    if (roomId) {
      posts = db.prepare(`
        SELECT p.*, u.name as user_name, u.avatar as user_avatar, r.name_ar as room_name
        FROM posts p
        JOIN users u ON p.user_id = u.id
        JOIN rooms r ON p.room_id = r.id
        WHERE p.room_id = ?
        ORDER BY p.created_at DESC
        LIMIT ?
      `).all(roomId, limit);
    } else {
      posts = db.prepare(`
        SELECT p.*, u.name as user_name, u.avatar as user_avatar, r.name_ar as room_name
        FROM posts p
        JOIN users u ON p.user_id = u.id
        JOIN rooms r ON p.room_id = r.id
        ORDER BY p.created_at DESC
        LIMIT ?
      `).all(limit);
    }

    const rooms = db.prepare('SELECT * FROM rooms').all();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      posts,
      rooms,
      total_posts: posts.length,
      total_rooms: rooms.length,
    });
  } catch (error: any) {
    console.error('[Mobile Community API] Error:', error);

    // Return empty state if community DB not initialized
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      posts: [],
      rooms: [
        { id: 1, name: 'EGX Discussion', name_ar: 'نقاشات البورصة', description: 'مناقشة أسهم البورصة المصرية' },
        { id: 2, name: 'Crypto Talk', name_ar: 'حديث الكريبتو', description: 'مناقشة العملات الرقمية' },
        { id: 3, name: 'Trading Tips', name_ar: 'نصائح التداول', description: 'شارك نصائحك واستراتيجياتك' },
      ],
      total_posts: 0,
      total_rooms: 3,
      message: 'المجتمع غير مُهيأ بعد',
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, room_id, content } = body;

    if (!user_id || !room_id || !content) {
      return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 });
    }

    const { db } = await import('@/lib/community-db');
    const result = db.prepare(
      'INSERT INTO posts (user_id, room_id, content) VALUES (?, ?, ?)'
    ).run(user_id, room_id, content);

    return NextResponse.json({
      success: true,
      post_id: result.lastInsertRowid,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Mobile Community API] Create post error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
