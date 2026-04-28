'use client';

import React from 'react';
import { Bell, X } from 'lucide-react';
import { useNotificationStore } from '@/lib/notification-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  TrendingUp,
  TrendingDown,
  Briefcase,
  Info,
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
      return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30';
    case 'portfolio_update':
      return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30';
    case 'market_event':
      return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30';
    case 'system':
      return 'text-muted-foreground bg-muted';
    default:
      return 'text-muted-foreground bg-muted';
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

interface NotificationBellProps {
  onOpenPanel: () => void;
}

export function NotificationBell({ onOpenPanel }: NotificationBellProps) {
  const { notifications, unreadCount, markAsRead } = useNotificationStore();
  const [open, setOpen] = React.useState(false);

  const recentNotifications = notifications.slice(0, 5);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm',
            'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
          aria-label="الإشعارات"
        >
          <div className="relative">
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <Badge className="absolute -top-1.5 -left-1.5 h-4 min-w-4 px-1 text-[10px] bg-red-500 text-white border-0 animate-pulse">
                {unreadCount > 99 ? '99+' : unreadCount}
              </Badge>
            )}
          </div>
          <span>الإشعارات</span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="left"
        align="end"
        sideOffset={8}
        className="w-80 sm:w-96 p-0 overflow-hidden z-[70] rounded-xl shadow-xl"
        dir="rtl"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Dropdown header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-bold text-foreground">آخر الإشعارات</h3>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded-md hover:bg-muted transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Notifications list */}
        <div className="max-h-80 overflow-y-auto">
          {recentNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 px-4">
              <Bell className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">لا توجد إشعارات</p>
            </div>
          ) : (
            recentNotifications.map((notification) => {
              const colorClass = getNotificationColor(notification.type);

              return (
                <button
                  key={notification.id}
                  onClick={() => {
                    if (!notification.read) {
                      markAsRead(notification.id);
                    }
                  }}
                  className={cn(
                    'w-full flex items-start gap-3 px-4 py-3 text-right transition-colors hover:bg-muted/50 border-b border-border/50 last:border-b-0',
                    !notification.read && 'bg-primary/5'
                  )}
                >
                  <div className={cn('flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5', colorClass)}>
                    {getNotificationIconElement(notification.type, 'w-4 h-4')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className={cn('text-xs font-semibold truncate', !notification.read && 'text-foreground')}>
                        {notification.title_ar}
                      </p>
                      {!notification.read && (
                        <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {notification.message_ar}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {formatTimestamp(notification.created_at)}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* View all button */}
        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            className="w-full text-xs text-primary hover:text-primary/80"
            onClick={() => {
              setOpen(false);
              onOpenPanel();
            }}
          >
            عرض جميع الإشعارات
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
