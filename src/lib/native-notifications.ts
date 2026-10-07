'use client';

import React from 'react';
import { toast } from 'sonner';
import { playChatNotificationSound } from '@/lib/alert-sound';
import { WhatsAppToast } from '@/components/notifications/WhatsAppToast';

export interface AlertNotificationPayload {
  title: string;
  message: string;
  ticker?: string;
  type?: string;
  severity?: string;
  url?: string;
}

/**
 * فحص إذن إشعارات المتصفح
 */
export function getDesktopNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * طلب إذن إشعارات المتصفح لسطح المكتب
 */
export async function requestDesktopNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (Notification.permission === 'granted') {
    return true;
  }
  if (Notification.permission === 'denied') {
    return false;
  }

  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      // تسجيل الـ Service Worker لضمان استمرار الإشعارات
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * إطلاق إشعار مزدوج:
 * 1. إشعار نظام حقيقي على سطح المكتب/الموبايل (Native OS Push) يظهر حتى لو الموقع مصغر أو في تبويب آخر.
 * 2. بطاقة إشعار عائمة داخل الموقع بتصميم مطابق تماماً لرسائل الواتساب/فيسبوك ماسنجر.
 * 3. نغمة تنبيه شات مريحة وواضحة (WhatsApp/Messenger Chime).
 */
export function dispatchWhatsAppAlert(payload: AlertNotificationPayload): void {
  if (typeof window === 'undefined') return;

  const isExit =
    payload.type?.includes('exit') ||
    payload.severity === 'critical' ||
    payload.severity === 'warning';
  const soundVariant = isExit ? 'exit' : 'opportunity';

  // 1. تشغيل صوت الواتساب
  try {
    playChatNotificationSound(soundVariant);
  } catch {}

  // 2. إرسال إشعار سطح المكتب الحقيقي (Native Desktop Notification)
  // هذا الإشعار هو الذي يظهر للعميل على نظام ويندوز أو ماك أو أندرويد حتى لو المتصفح مصغر تماماً!
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const icon = '/icon-192.png';
      const badge = '/favicon-32x32.png';
      const titlePrefix = payload.ticker ? `[${payload.ticker}] ` : '';
      const fullTitle = `${titlePrefix}${payload.title}`;
      const options: NotificationOptions = {
        body: payload.message,
        icon,
        badge,
        tag: `stock-alert-${payload.ticker || 'market'}-${Date.now()}`,
        renotify: true,
        vibrate: [200, 100, 200],
        data: { url: payload.url || '/' },
      };

      // إذا كان الـ Service Worker مسجلاً ونشطاً، استخدمه
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.ready
          .then((reg) => {
            return reg.showNotification(fullTitle, options);
          })
          .catch(() => {
            // Fallback to standard Notification
            new Notification(fullTitle, options);
          });
      } else {
        new Notification(fullTitle, options);
      }
    } catch {
      // ignore OS notification failure
    }
  }

  // 3. عرض البطاقة العائمة داخل الموقع بتصميم الواتساب / فيسبوك ماسنجر
  try {
    toast.custom(
      (t) =>
        React.createElement(WhatsAppToast, {
          id: t,
          title: payload.title,
          message: payload.message,
          ticker: payload.ticker,
          type: payload.type,
          severity: payload.severity,
          timestamp: 'الآن',
          onClose: () => toast.dismiss(t),
        }),
      {
        duration: 8000,
        position: 'top-center',
      }
    );
  } catch {
    // fallback to standard toast
    toast.success(payload.title, { description: payload.message });
  }
}
