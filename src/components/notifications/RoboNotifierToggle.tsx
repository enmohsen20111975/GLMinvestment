'use client';

/* ============================================================
 ROBO-ADVISOR-P2: RoboNotifierToggle — زر تفعيل التنبيهات الحية
 ============================================================
 - زر جرس عائم يفعّل/يوقف نظام التنبيهات الحية
 - بيطلب إذن الإشعارات عند التفعيل
 - بيشتغل صوت تنبيه تجريبي عند التفعيل عشان المستخدم يتأكد
 ============================================================ */

import React, { useState, useEffect } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
 startRoboNotifier,
 stopRoboNotifier,
 isRoboNotifierRunning,
 requestNotificationPermission,
 resetRoboSeen,
} from '@/lib/robo-notifier';
import { playAlertSound, initAudioOnUserInteraction } from '@/lib/alert-sound';

export function RoboNotifierToggle() {
 const [running, setRunning] = useState(false);
 const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');

 useEffect(() => {
 if (typeof window === 'undefined') return;
 if (!('Notification' in window)) {
 setPermission('unsupported');
 return;
 }
 setPermission(Notification.permission);
 setRunning(isRoboNotifierRunning());
 }, []);

 const handleToggle = async () => {
 // P20-CENTRAL-ALERTS: افتح الـ Audio Context من ضمن تفاعل المستخدم
 // (متطلبات الـ autoplay policy في المتصفحات — الصوت ما يشتغلش من غير click)
 initAudioOnUserInteraction();

 if (running) {
 stopRoboNotifier();
 setRunning(false);
 // P20: أبلغ الـ CentralAlertMonitor إنه يوقف الـ polling
 window.dispatchEvent(
 new CustomEvent('robo-notifier-toggle', { detail: { enabled: false } }),
 );
 toast.success('تم إيقاف التنبيهات الحية');
 return;
 }

 // اطلب إذن الإشعارات
 const granted = await requestNotificationPermission();
 if (typeof window !== 'undefined' && 'Notification' in window) {
 setPermission(Notification.permission);
 }

 if (!granted) {
 toast.warning('لم يتم منح إذن الإشعارات', {
 description: 'التنبيهات الصوتية هتشتغل بس من غير إشعارات على الشاشة',
 duration: 5000,
 });
 }

 // امسح الـ seen cache عشان يبدأ من جديد
 resetRoboSeen();

 // شغّل الـ notifier
 startRoboNotifier();
 setRunning(true);

 // P20: أبلغ الـ CentralAlertMonitor إنه يبدأ الـ polling
 window.dispatchEvent(
 new CustomEvent('robo-notifier-toggle', { detail: { enabled: true } }),
 );

 // صوت تجريبي للتأكيد
 try {
 playAlertSound('up');
 } catch {
 // ignore
 }

 toast.success('🔔 تم تفعيل التنبيهات الحية', {
 description: 'هتوصلك إشعارات + صوت لما العقل يطلع إشارة جديدة أو سهم يوصل للهدف',
 duration: 5000,
 });
 };

 const icon = running ? <BellRing className="h-4 w-4" /> : permission === 'denied' ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />;
 const label = running ? 'التنبيهات الحية تعمل' : 'تفعيل التنبيهات الحية';
 const variant = running ? 'default' : 'outline';

 return (
 <Button
 variant={variant as any}
 size="sm"
 onClick={handleToggle}
 className={`gap-1.5 flex-shrink-0 ${running ? 'bg-profit hover:bg-profit text-white animate-pulse' : ''}`}
 aria-label={label}
 title={label}
 >
 {icon}
 <span className="hidden sm:inline">{running ? 'حي' : 'تنبيهات'}</span>
 </Button>
 );
}
