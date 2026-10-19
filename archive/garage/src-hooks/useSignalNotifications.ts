/**
 * ROBO-ADVISOR-P2: useSignalNotifications
 * =======================================
 * Hook بيـ poll الـ /api/unified/predictions كل 60 ثانية، ولما يلاقي:
 *  - إشارة STRONG_BUY / STRONG_SELL جديدة (مش شافها قبل كده)
 *  - أو توقع اتحول حالته من PENDING لـ TARGET_HIT / STOPPED
 * بيعمل:
 *  1. playBeep() — تنبيه صوتي
 *  2. showPushNotification() — إشعار على الشاشة (حتى في الخلفية)
 *  3. addNotification() — يحطه في مركز الإشعارات
 *
 * الاستخدام:
 *   const { enabled, enable, disable, permission } = useSignalNotifications();
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNotificationStore } from '@/lib/notification-store';
import { playBeep, primeAudioOnUserGesture } from '@/lib/notification-beep';
import {
  registerServiceWorker,
  requestNotificationPermission,
  getNotificationPermission,
  showPushNotification,
  type NotificationPermissionState,
} from '@/lib/sw-register';

const POLL_INTERVAL_MS = 30_000; // 30 ثانية — تقرير المالك: التحديث اللحظي لازم يكون أسرع
const STRONG_SIGNALS = new Set(['STRONG_BUY', 'STRONG_SELL']);

interface PredictionSnap {
  ticker: string;
  signal: string;
  status: string;
  name?: string;
  name_ar?: string;
  entry_price?: number;
  target_price?: number;
  stop_loss?: number;
}

export function useSignalNotifications() {
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermissionState>('default');
  const seenRef = useRef<Map<string, { signal: string; status: string }>>(new Map());
  const addNotification = useNotificationStore((s) => s.addNotification);
  const enabledRef = useRef(false);

  // مزامنة الـ ref مع الـ state (عشان الـ interval يقرا القيمة الحالية)
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // فحص الإذن عند الـ mount
  useEffect(() => {
    setPermission(getNotificationPermission());
    primeAudioOnUserGesture();
    // سجّل الـ SW في الخلفية
    registerServiceWorker();
  }, []);

  const enable = useCallback(async () => {
    const perm = await requestNotificationPermission();
    setPermission(perm);
    if (perm === 'granted') {
      await registerServiceWorker();
      setEnabled(true);
      // إشعار ترحيبي
      addNotification({
        type: 'system',
        title: 'تفعيل التنبيهات الحية ✓',
        message: 'هتوصلك إشعارات فورية عند ظهور إشارات شراء/بيع قوية أو وصول الأسهم للأهداف.',
      });
      playBeep('success');
      void showPushNotification('الروبو-أدفايزر شغال 🔔', 'التنبيهات الحية مفعّلة — هتوصلك الإشارات القوية فوراً.');
    }
  }, [addNotification]);

  const disable = useCallback(() => {
    setEnabled(false);
    addNotification({
      type: 'system',
      title: 'إيقاف التنبيهات الحية',
      message: 'التنبيهات الحية متوقفة. تقدر تفعلها تاني في أي وقت.',
    });
  }, [addNotification]);

  // الـ polling effect
  useEffect(() => {
    if (!enabled) return;

    const checkForNewSignals = async () => {
      if (!enabledRef.current) return;
      try {
        const _market = typeof window !== 'undefined'
          ? JSON.parse(localStorage.getItem('egx_current_market') || '"EGX"')
          : 'EGX';
        const res = await fetch(`/api/unified/predictions?market=${_market}&limit=50&_t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        const preds: PredictionSnap[] = data.predictions || data.active_predictions || [];
        if (!Array.isArray(preds) || preds.length === 0) return;

        const seen = seenRef.current;
        let foundNew = false;
        let foundStatusChange = false;

        for (const p of preds) {
          if (!p?.ticker) continue;
          const key = p.ticker.toUpperCase();
          const prev = seen.get(key);
          const curSignal = p.signal || '';
          const curStatus = p.status || 'PENDING';

          if (!prev) {
            // توقع جديد — نوّع بس لو إشارة قوية
            if (STRONG_SIGNALS.has(curSignal)) {
              foundNew = true;
              const isBuy = curSignal === 'STRONG_BUY';
              const title = isBuy
                ? `🟢 إشارة شراء قوية: ${p.ticker}`
                : `🔴 إشارة بيع قوية: ${p.ticker}`;
              const body = `${p.name_ar || p.name || p.ticker} — سعر الدخول: ${p.entry_price?.toFixed(2) || '—'} | الهدف: ${p.target_price?.toFixed(2) || '—'}`;
              addNotification({
                type: 'price_alert',
                title,
                message: body,
              });
              playBeep('signal');
              void showPushNotification(title, body, { tag: `signal-${key}` });
            }
            seen.set(key, { signal: curSignal, status: curStatus });
          } else {
            // توقع موجود قبل كده — فحص تغير الحالة
            if (prev.status !== curStatus && curStatus !== 'PENDING') {
              foundStatusChange = true;
              let title = '';
              let body = '';
              let beepType: 'success' | 'error' = 'success';
              if (curStatus === 'TARGET_HIT') {
                title = `🎯 وصل الهدف: ${p.ticker}`;
                body = `${p.name_ar || p.ticker} حقق سعر الهدف ${p.target_price?.toFixed(2) || ''}. وقت البيع أو تحريك الوقف.`;
                beepType = 'success';
              } else if (curStatus === 'STOPPED') {
                title = `🛑 ضرب وقف: ${p.ticker}`;
                body = `${p.name_ar || p.ticker} كسر وقف الخسارة ${p.stop_loss?.toFixed(2) || ''}. راجع مركزك.`;
                beepType = 'error';
              }
              if (title) {
                addNotification({
                  type: curStatus === 'TARGET_HIT' ? 'price_alert' : 'market_event',
                  title,
                  message: body,
                });
                playBeep(beepType);
                void showPushNotification(title, body, { tag: `status-${key}` });
              }
            }
            seen.set(key, { signal: curSignal, status: curStatus });
          }
        }

        if (foundNew || foundStatusChange) {
          // تمت إضافة الإشعارات بالفعل في الـ loop
        }
      } catch {
        // ساكت — مش كل fetch لازم ينجح
      }
    };

    // فحص فوري + interval
    checkForNewSignals();
    const interval = setInterval(checkForNewSignals, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { enabled, enable, disable, permission };
}
