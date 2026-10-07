'use client';

import React from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotificationStore } from '@/lib/notification-store';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import {
  Bell,
  TrendingUp,
  TrendingDown,
  Briefcase,
  Info,
  CheckCheck,
  Trash2,
} from 'lucide-react';
import type { Notification } from '@/types';

function getNotificationIconElement(type: Notification['type'], className: string) {
  switch (type) {
    case 'price_alert':
      return <TrendingUp className={className} />;
    case 'portfolio_update':
      return <Briefcase className={className} />;
    case 'market_event':
      return <TrendingDown className={className} />;
    case 'system':
      return <Info className={className} />;
    default:
      return <Bell className={className} />;
  }
}

function getNotificationColor(type: Notification['type']) {
  switch (type) {
    case 'price_alert':
      return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/40';
    case 'portfolio_update':
      return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/40';
    case 'market_event':
      return 'text-teal-600 dark:text-teal-400 bg-blue-50 dark:bg-blue-950/30 border-teal-200 dark:border-teal-800/40';
    case 'system':
      return 'text-muted-foreground bg-muted border-border';
    default:
      return 'text-muted-foreground bg-muted border-border';
  }
}

function getTypeLabel(type: Notification['type']) {
  switch (type) {
    case 'price_alert':
      return 'تنبيه سعر';
    case 'portfolio_update':
      return 'تحديث محفظة';
    case 'market_event':
      return 'حدث سوق';
    case 'system':
      return 'نظام';
    default:
      return 'إشعار';
  }
}

function formatTimestamp(dateStr: string) {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'الآن';
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  return `منذ ${diffDays} يوم`;
}

function NotificationItem({
  notification,
}: {
  notification: Notification;
}) {
  const { markAsRead, removeNotification } = useNotificationStore();
  const colorClass = getNotificationColor(notification.type);

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-4 rounded-xl border transition-all duration-200 group',
        colorClass,
        !notification.read && 'ring-1 ring-primary/20'
      )}
    >
      {/* Icon */}
      <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-background/60">
        {getNotificationIconElement(notification.type, 'w-5 h-5')}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 font-normal">
              {getTypeLabel(notification.type)}
            </Badge>
            {!notification.read && (
              <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
            )}
          </div>
          <button
            onClick={() => removeNotification(notification.id)}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-background/80 transition-all"
            aria-label="حذف الإشعار"
          >
            <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        <h4 className={cn('text-sm font-semibold mb-0.5', !notification.read ? 'text-foreground' : 'text-foreground/80')}>
          {notification.title_ar}
        </h4>
        <p className="text-xs text-muted-foreground leading-relaxed mb-2">
          {notification.message_ar}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground/60">
            {formatTimestamp(notification.created_at)}
          </span>
          {!notification.read && (
            <button
              onClick={() => markAsRead(notification.id)}
              className="text-[10px] text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition-colors"
            >
              <CheckCheck className="w-3 h-3" />
              تحديد كمقروء
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function NotificationCenter() {
  const { notifications, unreadCount, isOpen, setOpen, markAllAsRead, addNotification } = useNotificationStore();
  // Rule 67 (root-cause): نقرأ الـ currentMarket من المتجر المركزي عشان نفلتر الإشعارات
  // حسب سوق المستخدم — المصري ميشوفش تنبيهات سعودية، والعكس صحيح.
  const currentMarket = useAppStore((s) => s.currentMarket);

  const readNotifications = notifications.filter((n) => n.read);
  const unreadNotifications = notifications.filter((n) => !n.read);

  // MONEY-TIER2.6: poll /api/notifications every 60s.
  // Rule 67 (Phase 0 stability): توقفنا عن ضرب endpoint محرك التنبيهات من المتصفح —
  // محرك التنبيهات بيشغله الـ server cron (master_scheduler.py) ومش المفروض
  // كل tab يطلق الـ engine (كان بيسبب 400 req/min مع 100 مستخدم).
  // كمان بنمرر portfolio_only=1 + market=currentMarket عشان كل مستخدم يشوف
  // إشعارات محفظته/قائمة متابعته وسوقه فقط — مفيش leakage بين الأسواق.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    let active = true;
    let lastSeenId = 0;

    async function tick() {
      if (!active) return;
      try {
        // Fetch real notifications emitted by the engine — filtered by
        // portfolio + current market so we never leak cross-market alerts.
        const params = new URLSearchParams({
          limit: '20',
          portfolio_only: '1',
          market: currentMarket,
        });
        const res = await fetch(`/api/notifications?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.success) return;

        const newOnes = (data.notifications || []).filter(
          (n: any) => Number(n.id) > lastSeenId
        );
        if (newOnes.length > 0 && lastSeenId > 0) {
          // Inject into the in-memory store (so the bell badge increments).
          for (const n of newOnes) {
            const typeMap: Record<string, Notification['type']> = {
              stock_price: 'price_alert',
              gold_price: 'price_alert',
              bag_holder_warning: 'portfolio_update',
              top_up_opportunity: 'portfolio_update',
              system: 'system',
            };
            addNotification({
              type: typeMap[n.type] || 'system',
              title: n.ticker ? `${n.ticker} \u2014 ${n.type}` : n.type,
              title_ar: n.ticker ? `${n.ticker} \u2014 ${n.type}` : n.type,
              message: n.message || '',
              message_ar: n.message || '',
              data: n.payload,
            });
          }
          // Play a soft beep if sound enabled
          try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = 660;
            const gain = ctx.createGain();
            gain.gain.value = 0.06;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            setTimeout(() => { osc.stop(); ctx.close(); }, 180);
          } catch { /* ignore */ }
        }
        if (data.notifications?.length > 0) {
          lastSeenId = Math.max(...data.notifications.map((n: any) => Number(n.id)));
        }
      } catch { /* silent \u2014 poller should never crash the UI */ }
    }

    // First tick immediately, then every 60s
    tick();
    const id = setInterval(tick, 60_000);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, [addNotification, currentMarket]);


  return (
    <Sheet open={isOpen} onOpenChange={setOpen}>
      <SheetContent side="left" className="w-full sm:max-w-md p-0">
        <SheetHeader className="p-4 pb-0 border-b border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg">الإشعارات</SheetTitle>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <Badge className="bg-primary text-primary-foreground text-xs">
                  {unreadCount} جديد
                </Badge>
              )}
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7 px-2"
                  onClick={markAllAsRead}
                >
                  <CheckCheck className="w-3.5 h-3.5 ml-1" />
                  تحديد الكل
                </Button>
              )}
            </div>
          </div>
          <SheetDescription className="text-xs">
            {notifications.length > 0
              ? `${notifications.length} إشعار • ${unreadCount} غير مقروء`
              : 'لا توجد إشعارات'}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-80px)]">
          <div className="p-4 space-y-3">
            {notifications.length === 0 ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center py-16">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                  <Bell className="w-8 h-8 text-muted-foreground/30" />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1">لا توجد إشعارات</h3>
                <p className="text-xs text-muted-foreground text-center max-w-[200px]">
                  ستظهر هنا التنبيهات والأحداث المهمة من السوق
                </p>
              </div>
            ) : (
              <>
                {/* Unread section */}
                {unreadNotifications.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                      غير مقروء ({unreadNotifications.length})
                    </h3>
                    <div className="space-y-2">
                      {unreadNotifications.map((n) => (
                        <NotificationItem key={n.id} notification={n} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Read section */}
                {readNotifications.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1 mt-4">
                      مقروء ({readNotifications.length})
                    </h3>
                    <div className="space-y-2">
                      {readNotifications.map((n) => (
                        <NotificationItem key={n.id} notification={n} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
