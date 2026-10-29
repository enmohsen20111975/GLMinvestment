import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';
import { getSessionUserId } from '@/lib/auth-helper';

// GET - جلب نقاط المستخدم وإحصائياته
export async function GET(request: NextRequest) {
  try {
    // F1.2 — auth guard (IDOR fix): require session, ignore query user_id.
    const { userId: sessionUserId } = await getSessionUserId();
    if (!sessionUserId) {
      return NextResponse.json({ error: 'مطلوب تسجيل الدخول' }, { status: 401 });
    }
    // IDOR guard: use session userId only (ignore any user_id from query)
    const user_id = sessionUserId;

    // جلب نقاط المستخدم
    let userPoints = await (db as any).userPoints.findUnique({
      where: { user_id },
      include: {
        PointsHistory: {
          orderBy: { created_at: 'desc' },
          take: 20
        }
      }
    });

    if (!userPoints) {
      // إنشاء سجل نقاط جديد
      userPoints = await (db as any).userPoints.create({
        data: { user_id },
        include: { PointsHistory: true }
      });
    }

    // جلب إعدادات النقاط
    let settings = await (db as any).pointsSettings.findFirst();
    if (!settings) {
      settings = await (db as any).pointsSettings.create({ data: {} });
    }

    // جلب حزم النقاط المتاحة
    const packages = await (db as any).pointsPackage.findMany({
      where: { is_active: 1 },
      orderBy: { display_order: 'asc' }
    });

    // إحصائيات المستخدم
    const stats = await (db as any).userPost.aggregate({
      where: { user_id },
      _count: { id: true },
      _sum: { points_earned: true }
    });

    const winsCount = await (db as any).userPost.count({
      where: { user_id, outcome: 'win' }
    });

    const lossesCount = await (db as any).userPost.count({
      where: { user_id, outcome: 'loss' }
    });

    return NextResponse.json({
      points: userPoints,
      settings,
      packages: packages.length > 0 ? packages : getDefaultPackages(),
      stats: {
        totalPosts: stats._count.id || 0,
        totalPointsEarned: stats._sum.points_earned || 0,
        wins: winsCount,
        losses: lossesCount,
        winRate: winsCount + lossesCount > 0 
          ? Math.round((winsCount / (winsCount + lossesCount)) * 100) 
          : 0
      },
      levelInfo: getLevelInfo(userPoints.level as number, settings as any)
    });
  } catch (error) {
    console.error('[Points API] Error:', error);
    return NextResponse.json({ error: 'حدث خطأ في جلب النقاط' }, { status: 500 });
  }
}

function getDefaultPackages() {
  return [
    { id: 'pkg_1', name: 'Starter', name_ar: 'البداية', points: 100, price_egp: 10, bonus_points: 0 },
    { id: 'pkg_2', name: 'Basic', name_ar: 'الأساسي', points: 500, price_egp: 45, bonus_points: 50 },
    { id: 'pkg_3', name: 'Pro', name_ar: 'المحترف', points: 1000, price_egp: 85, bonus_points: 150 },
    { id: 'pkg_4', name: 'Premium', name_ar: 'المميز', points: 2500, price_egp: 200, bonus_points: 500 },
    { id: 'pkg_5', name: 'Ultimate', name_ar: 'الأقصى', points: 5000, price_egp: 380, bonus_points: 1200 },
  ];
}

function getLevelInfo(level: number, settings: { level_1_threshold: number; level_2_threshold: number; level_3_threshold: number; level_4_threshold: number; level_5_threshold: number } | null) {
  const thresholds = settings ? {
    1: settings.level_1_threshold,
    2: settings.level_2_threshold,
    3: settings.level_3_threshold,
    4: settings.level_4_threshold,
    5: settings.level_5_threshold,
  } : { 1: 0, 2: 500, 3: 1500, 4: 5000, 5: 15000 };

  const levelNames: Record<number, string> = {
    1: 'مبتدئ',
    2: 'متعلم',
    3: 'محلل',
    4: 'خبير',
    5: 'مايسترو'
  };

  return {
    current: level,
    name: levelNames[level],
    currentThreshold: thresholds[level as keyof typeof thresholds] || 0,
    nextThreshold: thresholds[(level + 1) as keyof typeof thresholds] || null,
  };
}
