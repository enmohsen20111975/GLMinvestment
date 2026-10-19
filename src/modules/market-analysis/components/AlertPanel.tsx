'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Bell,
  BellRing,
  Plus,
  Trash2,
  Volume2,
  VolumeX,
  Volume1,
  X,
  AlertCircle,
} from 'lucide-react';
import {
  useAlertsStore,
  ALERT_TYPE_META,
  type AlertType,
  type PriceAlert,
} from '@/lib/alerts-store';
import { playTestSound, initAudioOnUserInteraction } from '@/lib/alert-sound';
import { requestNotificationPermission } from '@/lib/use-alerts';
import { toast } from 'sonner';

/* ============================================================
   ALERTS-031: AlertPanel Component
   ============================================================
   - Add/list/toggle/delete price & score & Pine Script alerts
   - Global sound + browser notification toggles
   - Test sound button
   - Renders as a slide-in panel (right side)
   ============================================================ */

interface AlertPanelProps {
  ticker: string;
  open: boolean;
  onClose: () => void;
}

export function AlertPanel({ ticker, open, onClose }: AlertPanelProps) {
  const alerts = useAlertsStore((s) => s.alerts);
  const soundEnabled = useAlertsStore((s) => s.soundEnabled);
  const notificationsEnabled = useAlertsStore((s) => s.notificationsEnabled);
  const addAlert = useAlertsStore((s) => s.addAlert);
  const removeAlert = useAlertsStore((s) => s.removeAlert);
  const toggleAlert = useAlertsStore((s) => s.toggleAlert);
  const toggleSound = useAlertsStore((s) => s.toggleSound);
  const toggleNotifications = useAlertsStore((s) => s.toggleNotifications);

  const [selectedType, setSelectedType] = useState<AlertType>('price_above');
  const [threshold, setThreshold] = useState('');
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'default'>('default');

  // Check notification permission on mount + when panel opens
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;
    setNotifPermission(Notification.permission);
  }, [open]);

  // Filter alerts for this ticker
  const tickerAlerts = alerts.filter((a) => a.ticker === ticker.toUpperCase());

  const meta = ALERT_TYPE_META[selectedType];

  const handleAddAlert = () => {
    initAudioOnUserInteraction();

    let thresholdValue: number | undefined;
    if (meta.needsThreshold) {
      thresholdValue = parseFloat(threshold);
      if (isNaN(thresholdValue)) {
        toast.error('أدخل قيمة صحيحة');
        return;
      }
      if (selectedType === 'score_above' || selectedType === 'score_below') {
        if (thresholdValue < 0 || thresholdValue > 138) {
          toast.error('الـ Score يجب أن يكون بين 0 و 138');
          return;
        }
      }
    }

    const label = buildLabel(selectedType, thresholdValue);
    addAlert({
      ticker: ticker.toUpperCase(),
      type: selectedType,
      threshold: thresholdValue,
      label,
    });

    toast.success('تم إضافة التنبيه ✅', {
      description: label,
    });

    // Reset form
    setThreshold('');
  };

  const handleToggleNotifications = async () => {
    if (!notificationsEnabled && notifPermission !== 'granted') {
      // Request permission first
      const granted = await requestNotificationPermission();
      setNotifPermission(granted ? 'granted' : 'denied');
      if (!granted) {
        toast.error('تم رفض إذن الإشعارات', {
          description: 'فعّل الإشعارات من إعدادات المتصفح',
        });
        return;
      }
    }
    toggleNotifications();
  };

  const handleTestSound = () => {
    initAudioOnUserInteraction();
    playTestSound();
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 left-0 bottom-0 w-full max-w-md bg-[#131722] border-l border-zinc-800 z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-warning" />
            <h2 className="text-base font-bold text-foreground">التنبيهات</h2>
            <Badge className="bg-zinc-800 text-zinc-400 font-mono">{ticker}</Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 text-zinc-400 hover:text-foreground hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Global Settings */}
        <div className="p-4 border-b border-zinc-800 space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {soundEnabled ? (
                <Volume2 className="h-4 w-4 text-profit" />
              ) : (
                <VolumeX className="h-4 w-4 text-zinc-500" />
              )}
              <span className="text-sm text-zinc-300">التنبيه الصوتي</span>
            </div>
            <Switch checked={soundEnabled} onCheckedChange={toggleSound} />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-zinc-400" />
              <span className="text-sm text-zinc-300">إشعارات المتصفح</span>
              {notifPermission === 'denied' && (
                <span className="text-[10px] text-loss">(مرفوض)</span>
              )}
            </div>
            <Switch
              checked={notificationsEnabled}
              onCheckedChange={handleToggleNotifications}
              disabled={notifPermission === 'denied'}
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleTestSound}
            className="w-full h-8 text-xs border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            <Volume1 className="h-3.5 w-3.5 ml-2" />
            جرّب الصوت
          </Button>
        </div>

        {/* Add Alert Form */}
        <div className="p-4 border-b border-zinc-800 space-y-3 shrink-0">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-profit" />
            <span className="text-sm font-medium text-zinc-200">إضافة تنبيه جديد</span>
          </div>

          <Select value={selectedType} onValueChange={(v) => setSelectedType(v as AlertType)}>
            <SelectTrigger className="h-9 bg-zinc-900 border-zinc-800 text-zinc-200 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-800 max-h-64">
              {Object.entries(ALERT_TYPE_META).map(([type, m]) => (
                <SelectItem
                  key={type}
                  value={type}
                  className="text-zinc-200 focus:bg-zinc-800 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span>{m.icon}</span>
                    <span>{m.labelAr}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {meta.needsThreshold && (
            <div className="space-y-1">
              <label className="text-[11px] text-zinc-400">{meta.thresholdLabel}</label>
              <Input
                type="number"
                step="0.01"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder={meta.thresholdPlaceholder}
                className="h-9 bg-zinc-900 border-zinc-800 text-zinc-200 text-sm"
              />
            </div>
          )}

          <Button
            onClick={handleAddAlert}
            className="w-full h-9 bg-profit hover:bg-profit text-white text-sm"
          >
            <Plus className="h-4 w-4 ml-2" />
            إضافة التنبيه
          </Button>
        </div>

        {/* Alerts List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {tickerAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="h-10 w-10 text-zinc-600 mb-3" />
              <p className="text-sm text-zinc-500">لا توجد تنبيهات لهذا السهم</p>
              <p className="text-[11px] text-zinc-600 mt-1">
                أضف تنبيه выше لتصلك إشعارات لحظية
              </p>
            </div>
          ) : (
            tickerAlerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                onToggle={() => toggleAlert(alert.id)}
                onRemove={() => removeAlert(alert.id)}
              />
            ))
          )}
        </div>

        {/* Footer Info */}
        <div className="p-3 border-t border-zinc-800 bg-zinc-950/50 shrink-0">
          <p className="text-[10px] text-zinc-500 text-center leading-relaxed">
            🔔 التنبيهات بتفعّل فقط لما الشارت مفتوح وتوصّل WebSocket حي.
            <br />
            يتم كتم التنبيه نفسه لمدة 5 دقائق بعد تفعيله (debounce).
          </p>
        </div>
      </div>
    </>
  );
}

/* ============================================================
   AlertRow — single alert card in the list
   ============================================================ */

function AlertRow({
  alert,
  onToggle,
  onRemove,
}: {
  alert: PriceAlert;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const meta = ALERT_TYPE_META[alert.type];
  const recentlyFired = useAlertsStore((s) => s.recentlyFired[alert.id]);

  return (
    <div
      className={`flex items-center gap-2 p-3 rounded-lg border transition-all ${
        alert.enabled
          ? 'bg-zinc-900/60 border-zinc-700'
          : 'bg-zinc-950/40 border-zinc-800 opacity-60'
      } ${recentlyFired ? 'ring-1 ring-warning/50' : ''}`}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0"
        style={{ backgroundColor: `${meta.color}20` }}
      >
        {meta.icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-zinc-200 truncate">
            {meta.labelAr}
          </span>
          {alert.threshold !== undefined && (
            <Badge
              variant="outline"
              className="text-[9px] font-mono"
              style={{ borderColor: meta.color, color: meta.color }}
            >
              {alert.threshold}
            </Badge>
          )}
          {recentlyFired && (
            <Badge className="text-[9px] bg-warning/60 text-warning border border-warning animate-pulse">
              🔔 اشتعل
            </Badge>
          )}
        </div>
        <span className="text-[10px] text-zinc-500">
          {new Date(alert.createdAt).toLocaleString('ar-EG', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {alert.lastFired && (
            <>
              {' • آخر إطلاق: '}
              {new Date(alert.lastFired).toLocaleTimeString('ar-EG', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </>
          )}
        </span>
      </div>

      <Switch
        checked={alert.enabled}
        onCheckedChange={onToggle}
        className="shrink-0"
      />

      <Button
        variant="ghost"
        size="sm"
        onClick={onRemove}
        className="h-7 w-7 p-0 text-zinc-500 hover:text-loss hover:bg-loss/40 shrink-0"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/* ============================================================
   Helpers
   ============================================================ */

function buildLabel(type: AlertType, threshold?: number): string {
  const meta = ALERT_TYPE_META[type];
  if (meta.needsThreshold && threshold !== undefined) {
    return `${meta.labelAr} ${threshold}`;
  }
  return meta.labelAr;
}
