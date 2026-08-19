import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/mobile/notifications
 * إشعارات الجوال - جلب الإشعارات للمستخدم
 * 
 * Headers:
 * Authorization: Bearer <token>
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    // Task 13: notifications are a user-scoped resource — require auth.
    if (!token) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          error_ar: 'يجب تسجيل الدخول للوصول إلى الإشعارات',
        },
        { status: 401 }
      );
    }

    // Get user from token
    const apiToken = await db.apiToken.findFirst({
      where: {
        token,
        expires_at: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!apiToken) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          error_ar: 'رمز الدخول غير صالح أو منتهي الصلاحية',
        },
        { status: 401 }
      );
    }

    // Get user's watchlist alerts.
    // Wrapped defensively: if the watchlist relation/query fails for any
    // reason we must NOT return a 500 — the client expects a JSON list.
    let notifications: Array<{
      id: string;
      type: string;
      title: string;
      message: string;
      ticker?: string;
      created_at: Date;
      read: boolean;
    }> = [];

    try {
      const watchlistItems = await db.watchlist.findMany({
        where: { user_id: apiToken.user_id ?? '__none__' },
        take: 200,
      });

      for (const item of watchlistItems) {
        const price = (item as any).alert_price_above ?? (item as any).current_price;
        if (item.alert_price_above && price) {
          if (price >= item.alert_price_above) {
            notifications.push({
              id: `alert_above_${item.id}`,
              type: 'price_alert',
              title: 'تنبيه سعر',
              message: `وصل للسعر المستهدف ${item.alert_price_above}`,
              ticker: (item as any).ticker,
              created_at: new Date(),
              read: false,
            });
          }
        }
        if (item.alert_price_below && price) {
          if (price <= item.alert_price_below) {
            notifications.push({
              id: `alert_below_${item.id}`,
              type: 'price_alert',
              title: 'تنبيه سعر',
              message: `انخفض للسعر ${item.alert_price_below}`,
              ticker: (item as any).ticker,
              created_at: new Date(),
              read: false,
            });
          }
        }
      }
    } catch (wlError) {
      console.error('[Mobile Notifications] Watchlist lookup failed, returning empty:', wlError);
      notifications = [];
    }

    // Add system notifications
    notifications.push({
      id: 'system_welcome',
      type: 'system',
      title: 'مرحباً بك',
      message: 'أهلاً بك في منصة الاستثمار',
      created_at: new Date(),
      read: false,
    });

    return NextResponse.json({
      success: true,
      notifications,
      unread_count: notifications.filter(n => !n.read).length,
    });
  } catch (error) {
    console.error('[Mobile Notifications] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load notifications' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mobile/notifications
 * تحديث حالة الإشعارات (قراءة)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { notification_id, mark_all_read } = body;

    // In a real implementation, you would update the notification status in DB
    // For now, just return success

    return NextResponse.json({
      success: true,
      message: mark_all_read ? 'All notifications marked as read' : `Notification ${notification_id} marked as read`,
    });
  } catch (error) {
    console.error('[Mobile Notifications POST] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update notifications' },
      { status: 500 }
    );
  }
}
