import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/auth-helper';

// FIX (FIX-TSC-BATCH-3): models below are not in the auth-only PrismaClient.
// Cast to any so calls compile without changing logic.
const DB = db as any;

// GET - جلب المنشورات
export async function GET(request: NextRequest) {
  try {
    // F1.2 — auth guard (IDOR fix): require session.
    const { userId: sessionUserId } = await getSessionUserId();
    if (!sessionUserId) {
      return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
    }
    const user_id = sessionUserId;

    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    const queryUserId = searchParams.get('user_id');
    const status = searchParams.get('status') || 'active';
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    const where: Record<string, unknown> = {};
    if (ticker) where.ticker = ticker;
    if (queryUserId) {
      if (queryUserId !== sessionUserId) {
        return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
      }
      where.user_id = queryUserId;
    }
    if (status !== 'all') where.status = status;

    const posts = await DB.userPost.findMany({
      where,
      include: {
        User: {
          select: {
            id: true,
            name: true,
            username: true,
            image: true,
          }
        },
        _count: {
          select: {
            PostLikes: true,
            PostComments: true,
          }
        }
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    });

    const total = await DB.userPost.count({ where });

    // جلب أسعار الأسهم الحالية
    const tickers = [...new Set(posts.map(p => p.ticker))];
    const stockPrices: Record<string, { price: number; change: number }> = {};
    
    if (tickers.length > 0) {
      const stocks = await DB.stocks.findMany({
        where: { ticker: { in: tickers } },
        select: { ticker: true, current_price: true, change_percent: true }
      });
      stocks.forEach(s => {
        stockPrices[s.ticker] = {
          price: s.current_price || 0,
          change: s.change_percent || 0
        };
      });
    }

    return NextResponse.json({
      posts: posts.map(p => ({
        ...p,
        likes: p._count.PostLikes,
        comments: p._count.PostComments,
        currentPrice: stockPrices[p.ticker]?.price || null,
        priceChange: stockPrices[p.ticker]?.change || null,
      })),
      total,
      hasMore: offset + limit < total
    });
  } catch (error) {
    console.error('[User Posts API] Error:', error);
    return NextResponse.json({ error: 'حدث خطأ في جلب المنشورات' }, { status: 500 });
  }
}

// POST - إنشاء منشور جديد
export async function POST(request: NextRequest) {
  try {
    // F1.2 — auth guard (IDOR fix): require session.
    const { userId: sessionUserId } = await getSessionUserId();
    if (!sessionUserId) {
      return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
    }
    const user_id = sessionUserId;

    const body = await request.json();
    const { ticker, direction, entry_price, target_price, stop_loss, timeframe, reasoning, confidence } = body;

    if (!ticker || !direction) {
      return NextResponse.json({ error: 'البيانات غير مكتملة' }, { status: 400 });
    }

    // التحقق من وجود المستخدم
    const user = await db.user.findUnique({ where: { id: user_id } });
    if (!user) {
      return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
    }

    // التحقق من حدود النشر المجاني
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const postsToday = await DB.userPost.count({
      where: {
        user_id,
        created_at: { gte: today }
      }
    });

    // الحصول على إعدادات النقاط
    let settings = await DB.pointsSettings.findFirst();
    if (!settings) {
      settings = await DB.pointsSettings.create({
        data: {}
      });
    }

    const maxPosts = user.subscription_tier === 'premium' 
      ? settings.premium_posts_per_day 
      : settings.free_posts_per_day;

    if (postsToday >= maxPosts) {
      return NextResponse.json({ 
        error: `لقد وصلت للحد الأقصى من المنشورات اليوم (${maxPosts})`,
        upgradeRequired: user.subscription_tier === 'free'
      }, { status: 403 });
    }

    // إنشاء المنشور
    const post = await DB.userPost.create({
      data: {
        user_id,
        ticker: ticker.toUpperCase(),
        direction,
        entry_price,
        target_price,
        stop_loss,
        timeframe,
        reasoning,
        confidence: confidence || 0.5,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 يوم
      }
    });

    // منح نقاط للنشر
    const pointsEarned = settings.points_per_post;
    await awardPoints(user_id, pointsEarned, 'post', post.id, 'نقاط لإنشاء توقع جديد');

    // تحديث نقاط المنشور
    await DB.userPost.update({
      where: { id: post.id },
      data: { points_earned: pointsEarned }
    });

    return NextResponse.json({ 
      post,
      pointsEarned,
      message: `تم نشر التوقع بنجاح! حصلت على ${pointsEarned} نقطة`
    });
  } catch (error) {
    console.error('[User Posts API] Error:', error);
    return NextResponse.json({ error: 'حدث خطأ في إنشاء المنشور' }, { status: 500 });
  }
}

// دالة منح النقاط
async function awardPoints(user_id: string, amount: number, source: string, reference_id: string | null, description: string) {
  // الحصول على أو إنشاء سجل النقاط
  let userPoints = await DB.userPoints.findUnique({ where: { user_id } });
  
  if (!userPoints) {
    userPoints = await DB.userPoints.create({
      data: { user_id }
    });
  }

  // تحديث النقاط
  const newBalance = userPoints.available_points + amount;
  const newTotal = userPoints.total_points + amount;
  
  // حساب المستوى الجديد
  const settings = await DB.pointsSettings.findFirst();
  let newLevel = 1;
  if (settings) {
    if (newTotal >= settings.level_5_threshold) newLevel = 5;
    else if (newTotal >= settings.level_4_threshold) newLevel = 4;
    else if (newTotal >= settings.level_3_threshold) newLevel = 3;
    else if (newTotal >= settings.level_2_threshold) newLevel = 2;
  }

  await DB.userPoints.update({
    where: { user_id },
    data: {
      available_points: newBalance,
      total_points: newTotal,
      level: newLevel,
      experience: newTotal,
      posts_points: source === 'post' ? userPoints.posts_points + amount : userPoints.posts_points,
      updated_at: new Date().toISOString(),
    }
  });

  // تسجيل المعاملة
  await DB.pointsTransaction.create({
    data: {
      user_id,
      amount,
      balance_after: newBalance,
      type: 'earn',
      source,
      reference_id,
      description,
    }
  });
}
