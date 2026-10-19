'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useHeartbeat, useWhaleAlerts } from '@/lib/use-live-dashboard';
import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * BRIEF-048: Heartbeat Status Bar
 * شريط حالة "القلب النابض" - نقطة خضراء/حمراء في أعلى الصفحة
 */
export function HeartbeatStatusBar() {
  const heartbeat = useHeartbeat();

  const colors = {
    healthy: 'bg-profit',
    stale: 'bg-warning',
    error: 'bg-loss',
    loading: 'bg-whale',
  };

  const messages = {
    healthy: 'النظام يعمل لحظياً',
    stale: 'تأخر في تدفق البيانات',
    error: 'خطأ في الاتصال',
    loading: 'جاري الفحص...',
  };

  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-card/80 backdrop-blur-sm border border-border text-[10px]">
      <motion.div
        className={`w-2 h-2 rounded-full ${colors[heartbeat.status]}`}
        animate={{
          scale: heartbeat.status === 'healthy' ? [1, 1.3, 1] : 1,
          opacity: heartbeat.status === 'healthy' ? [1, 0.7, 1] : 1,
        }}
        transition={{ duration: 1.5, repeat: heartbeat.status === 'healthy' ? Infinity : 0 }}
      />
      <span className="text-muted-foreground font-medium">
        {messages[heartbeat.status]}
      </span>
      {heartbeat.lastUpdate && (
        <span className="text-muted-foreground/70 hidden sm:inline">
          • {heartbeat.lastUpdate}
        </span>
      )}
    </div>
  );
}

/**
 * BRIEF-048: Whale Alerts Toast
 * ينبه المستخدم لما الماسح يلاقي حوت جديد
 */
export function WhaleAlertListener() {
  const { newAlert, clearNewAlert } = useWhaleAlerts();

  useEffect(() => {
    if (newAlert) {
      // أظهر toast notification
      toast.success(`🐋 حوت نشط: ${newAlert.ticker}`, {
        description: newAlert.message,
        duration: 8000,
        action: {
          label: 'عرض الشارت',
          onClick: () => {
            window.location.hash = `#stocks`;
            // ممكن نحدد الـ ticker بعدين
          },
        },
      });

      // شغل صوت تنبيه خفيف
      try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFQmJOAA...');
        audio.volume = 0.3;
        audio.play().catch(() => {}); // silent fail لو المتصفح منع الصوت
      } catch {}

      clearNewAlert();
    }
  }, [newAlert, clearNewAlert]);

  return null; // component صامت - بيشتغل في الخلفية
}

/**
 * BRIEF-048: Live Dashboard Widget
 * يعرض الـ heartbeat + whale alerts + win rate في widget واحد
 */
export function LiveDashboardWidget() {
  const heartbeat = useHeartbeat();
  const { alerts } = useWhaleAlerts();

  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl bg-card border border-border">
      <h3 className="text-xs font-bold text-foreground">🔴 لوحة حية</h3>

      {/* Heartbeat */}
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">حالة النظام:</span>
        <span className={`font-bold ${heartbeat.status === 'healthy' ? 'text-profit' : 'text-loss'}`}>
          {heartbeat.message}
        </span>
      </div>

      {/* Whale Alerts */}
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">تنبيهات الحيتان:</span>
        <span className="font-bold text-purple-500">
          {alerts.length > 0 ? `${alerts.length} حوت نشط 🐋` : 'لا يوجد'}
        </span>
      </div>

      {/* Last Update */}
      {heartbeat.lastUpdate && (
        <div className="text-[9px] text-muted-foreground/70 text-center">
          آخر تحديث: {heartbeat.lastUpdate}
        </div>
      )}
    </div>
  );
}
