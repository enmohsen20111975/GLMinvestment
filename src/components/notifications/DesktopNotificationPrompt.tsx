'use client';

import React, { useState, useEffect } from 'react';
import { Bell, X, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getDesktopNotificationPermission,
  requestDesktopNotificationPermission,
  dispatchWhatsAppAlert,
} from '@/lib/native-notifications';

const DISMISS_KEY = 'desktop_notif_prompt_dismissed_v2';

export function DesktopNotificationPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const perm = getDesktopNotificationPermission();
    const dismissed = sessionStorage.getItem(DISMISS_KEY);

    if (perm === 'default' && !dismissed) {
      // إظهار البانر بعد ثانيتين من دخول الصفحة حتى لا يشتت العميل فوراً
      const timer = setTimeout(() => setShow(true), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleEnable = async () => {
    const granted = await requestDesktopNotificationPermission();
    setShow(false);

    if (granted) {
      // إرسال إشعار تجريبي فوري للعميل بنفس صوت وتصميم الواتساب
      dispatchWhatsAppAlert({
        title: 'تم تفعيل تنبيهات سطح المكتب بنجاح!',
        message: 'ستصلك الآن إشارات رادار الأسهم والفرص فوراً حتى لو كان الموقع مصغراً في الخلفية.',
        type: 'radar_opportunity',
        severity: 'success',
      });
    }
  };

  const handleDismiss = () => {
    setShow(false);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {}
  };

  if (!show) return null;

  return (
    <div
      dir="rtl"
      className="fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-md z-50 bg-background/95 dark:bg-zinc-900/95 border border-emerald-500/40 border-r-4 border-r-emerald-500 shadow-2xl rounded-2xl p-4 backdrop-blur-md animate-in fade-in slide-in-from-bottom-5 duration-300"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
          <Bell className="w-5 h-5 animate-bounce" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-1">
            <h4 className="text-xs sm:text-sm font-bold text-foreground flex items-center gap-1.5">
              <span>تنبيهات رادار الأسهم الفورية</span>
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
            </h4>
            <button
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground p-1 rounded-md"
              aria-label="إغلاق"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
            فعّل إشعارات المتصفح لتصلك رسائل وإنذارات الأسهم مثل الواتساب وفيسبوك تماماً، حتى لو كان الموقع مصغراً أو شغال في الخلفية.
          </p>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleEnable}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-8 px-3 shadow-md"
            >
              تفعيل إشعارات سطح المكتب
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              className="text-xs h-8 px-2 text-muted-foreground hover:text-foreground"
            >
              لاحقاً
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
