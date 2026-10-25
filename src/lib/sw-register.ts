/**
 * ROBO-ADVISOR-P2: Service Worker Registration Helper
 * ===================================================
 * يسجّل /sw.js عشان يدعم الإشعارات في الخلفية.
 * + helper لطلب إذن الإشعارات + إرسال SHOW_NOTIFICATION للـ SW.
 */

const SW_PATH = '/sw.js';

let _registered = false;

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  if (_registered) {
    return navigator.serviceWorker.getRegistration().catch(() => null);
  }
  try {
    const reg = await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
    _registered = true;
    // فعّل الـ SW الجديد فوراً لو لسه منتظر
    if (reg.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    return reg;
  } catch {
    return null;
  }
}

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const result = await Notification.requestPermission();
    return result as NotificationPermissionState;
  } catch {
    return 'denied';
  }
}

export function getNotificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as NotificationPermissionState;
}

/**
 * يعرض إشعار عبر الـ Service Worker (يدعم الخلفية) أو fallback للـ Notification المباشرة.
 */
export async function showPushNotification(
  title: string,
  body: string,
  options?: { icon?: string; tag?: string }
): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const reg = await registerServiceWorker();
    if (reg && 'showNotification' in reg) {
      await reg.showNotification(title, {
        body,
        icon: options?.icon || '/icon-192.png',
        tag: options?.tag || 'robo-advisor',
        renotify: true,
        badge: '/icon-192.png',
      });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: options?.icon || '/icon-192.png',
        tag: options?.tag || 'robo-advisor',
      });
    }
  } catch {
    // ساكت — الإشعار مش critical
  }
}
