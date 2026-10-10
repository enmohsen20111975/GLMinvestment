import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';

// GET - لوحة المتصدرين
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const type = searchParams.get('type') || 'total'; // total, posts, accuracy

    let orderBy: Record<string, 'desc'> = { total_points: 'desc' };
    
    if (type === 'posts') {
      orderBy = { posts_points: 'desc' };
    }

    const leaderboard = await db.userPoints.findMany({
      take: limit,
      orderBy,
      include: {
        User: {
          select: {
            id: true,
            name: true,
            username: true,
            image: true,
          }
        }
      }
    });

    // إذا كان type = accuracy، نحتاج لحساب نسبة النجاح
    let result = leaderboard;
    if (type === 'accuracy') {
      const usersWithAccuracy = await Promise.all(
        leaderboard.map(async (up) => {
          const wins = await db.userPost.count({
            where: { user_id: up.user_id, outcome: 'win' }
          });
          const losses = await db.userPost.count({
            where: { user_id: up.user_id, outcome: 'loss' }
          });
          const total = wins + losses;
          const accuracy = total > 0 ? (wins / total) * 100 : 0;
          return { ...up, accuracy, wins, losses, total };
        })
      );
      result = usersWithAccuracy.sort((a, b) => b.accuracy - a.accuracy);
    }

    return NextResponse.json({
      leaderboard: result.map((item, index) => ({
        rank: index + 1,
        ...item,
        type
      }))
    });
  } catch (error) {
    console.error('[Leaderboard API] Error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  }
}
