'use client';

import React, { useState, useEffect } from 'react';
import {
  Bell,
  BellRing,
  TrendingUp,
  TrendingDown,
  Target,
  AlertTriangle,
  Settings,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  RefreshCw,
  Zap,
  Clock,
  Volume2,
  VolumeX,
  Shield,
  Activity,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Header } from '@/components/layout/Header';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

interface AlertSetting {
  id: string;
  ticker: string;
  name_ar: string;
  type: 'price_above' | 'price_below' | 'change_percent' | 'rsi_overbought' | 'rsi_oversold' | 'signal';
  target_value: number;
  current_value: number;
  is_active: boolean;
  notify_push: boolean;
  notify_email: boolean;
  created_at: string;
  triggered_at: string | null;
}

interface TriggeredAlert {
  id: string;
  ticker: string;
  name_ar: string;
  type: string;
  target_value: number;
  triggered_value: number;
  triggered_at: string;
  message: string;
  is_read: boolean;
}

interface AlertsData {
  settings: AlertSetting[];
  triggered: TriggeredAlert[];
  unread_count: number;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + ' ج.م';
}

function getAlertTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    price_above: 'السعر فوق',
    price_below: 'السعر تحت',
    change_percent: 'نسبة التغير',
    rsi_overbought: 'RSI تشبع شراء',
    rsi_oversold: 'RSI تشبع بيع',
    signal: 'إشارة تداول',
  };
  return labels[type] || type;
}

function getAlertTypeIcon(type: string) {
  switch (type) {
    case 'price_above':
      return <TrendingUp className="w-4 h-4 text-emerald-500" />;
    case 'price_below':
      return <TrendingDown className="w-4 h-4 text-red-500" />;
    case 'change_percent':
      return <Activity className="w-4 h-4 text-blue-500" />;
    case 'rsi_overbought':
      return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    case 'rsi_oversold':
      return <Zap className="w-4 h-4 text-purple-500" />;
    case 'signal':
      return <Target className="w-4 h-4 text-cyan-500" />;
    default:
      return <Bell className="w-4 h-4" />;
  }
}

export function AlertsCenterView() {
  const [data, setData] = useState<AlertsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  
  // Add alert form
  const [addTicker, setAddTicker] = useState('');
  const [addType, setAddType] = useState<string>('price_above');
  const [addTargetValue, setAddTargetValue] = useState('');
  const [addNotifyPush, setAddNotifyPush] = useState(true);
  const [addNotifyEmail, setAddNotifyEmail] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/mobile/alerts/settings');
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      }
    } catch (err) {
      console.error('Failed to load alerts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddAlert = async () => {
    if (!addTicker.trim()) {
      toast.error('يرجى إدخال رمز السهم');
      return;
    }
    if (!addTargetValue || isNaN(parseFloat(addTargetValue))) {
      toast.error('يرجى إدخال قيمة صحيحة');
      return;
    }

    try {
      const res = await fetch('/api/mobile/alerts/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: addTicker.toUpperCase(),
          type: addType,
          target_value: parseFloat(addTargetValue),
          notify_push: addNotifyPush,
          notify_email: addNotifyEmail,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم إضافة التنبيه بنجاح');
        setShowAddDialog(false);
        setAddTicker('');
        setAddType('price_above');
        setAddTargetValue('');
        loadData();
      } else {
        toast.error(json.error || 'فشل في إضافة التنبيه');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
    }
  };

  const handleToggleAlert = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch('/api/mobile/alerts/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: isActive }),
      });
      const json = await res.json();
      if (json.success) {
        loadData();
      }
    } catch {
      toast.error('فشل في تحديث التنبيه');
    }
  };

  const handleDeleteAlert = async (id: string) => {
    try {
      const res = await fetch(`/api/mobile/alerts/settings?id=${id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم حذف التنبيه');
        loadData();
      }
    } catch {
      toast.error('فشل في حذف التنبيه');
    }
  };

  const handleMarkAsRead = async (alertId: string) => {
    try {
      await fetch('/api/mobile/alerts/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: alertId, is_read: true }),
      });
      loadData();
    } catch {
      // Silent fail
    }
  };

  if (loading) {
    return (
      <div dir="rtl" className="min-h-screen bg-background">
        <Header title="مركز التنبيهات" subtitle="إدارة التنبيهات الذكية" />
        <div className="p-4 md:p-6 space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <Skeleton className="h-4 w-24 mb-2" />
                  <Skeleton className="h-8 w-32" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const settings = data?.settings || [];
  const triggered = data?.triggered || [];
  const unreadCount = data?.unread_count || 0;

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <Header title="مركز التنبيهات" subtitle="إدارة التنبيهات الذكية" />
      
      <div className="p-4 md:p-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4 gap-2">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Bell className="w-4 h-4" />
              <span className="text-xs font-medium">إجمالي التنبيهات</span>
            </div>
            <p className="text-2xl font-bold">{settings.length}</p>
          </Card>

          <Card className="p-4 gap-2 bg-gradient-to-br from-emerald-50 to-transparent dark:from-emerald-950/20">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Check className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-medium">نشط</span>
            </div>
            <p className="text-2xl font-bold text-emerald-600">
              {settings.filter(a => a.is_active).length}
            </p>
          </Card>

          <Card className="p-4 gap-2 bg-gradient-to-br from-yellow-50 to-transparent dark:from-yellow-950/20">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <BellRing className="w-4 h-4 text-yellow-500" />
              <span className="text-xs font-medium">تم تفعيلها</span>
            </div>
            <p className="text-2xl font-bold text-yellow-600">
              {triggered.length}
            </p>
          </Card>

          <Card className="p-4 gap-2 bg-gradient-to-br from-red-50 to-transparent dark:from-red-950/20">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-xs font-medium">غير مقروءة</span>
            </div>
            <p className="text-2xl font-bold text-red-600">{unreadCount}</p>
          </Card>
        </div>

        {/* Add Alert Button */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">التنبيهات النشطة</h2>
          <Button onClick={() => setShowAddDialog(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            إضافة تنبيه
          </Button>
        </div>

        {/* Triggered Alerts */}
        {triggered.length > 0 && (
          <Card className="border-yellow-200 dark:border-yellow-900/50">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <BellRing className="w-5 h-5 text-yellow-500" />
                <CardTitle className="text-base">تنبيهات مفعّلة</CardTitle>
                <Badge variant="secondary">{triggered.length}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {triggered.map((alert) => (
                  <div 
                    key={alert.id} 
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border",
                      alert.is_read ? "bg-muted/30" : "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200"
                    )}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {getAlertTypeIcon(alert.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{alert.ticker}</span>
                        <span className="text-xs text-muted-foreground">{alert.name_ar}</span>
                        {!alert.is_read && (
                          <Badge variant="default" className="text-xs">جديد</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(alert.triggered_at).toLocaleString('ar-EG')}</span>
                      </div>
                    </div>
                    {!alert.is_read && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleMarkAsRead(alert.id)}
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Alert Settings */}
        <div className="space-y-3">
          {settings.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Bell className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-4">لا توجد تنبيهات. أضف تنبيهاً جديداً لتتبع الأسهم</p>
                <Button onClick={() => setShowAddDialog(true)} variant="outline">
                  <Plus className="w-4 h-4 ml-2" />
                  إضافة تنبيه
                </Button>
              </CardContent>
            </Card>
          ) : (
            settings.map((alert) => (
              <Card key={alert.id} className={cn(
                "transition-all",
                !alert.is_active && "opacity-60"
              )}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {getAlertTypeIcon(alert.type)}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{alert.ticker}</span>
                          <span className="text-sm text-muted-foreground">{alert.name_ar}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-sm">
                          <span>{getAlertTypeLabel(alert.type)}</span>
                          <span className="font-medium">
                            {alert.type.includes('price') ? formatCurrency(alert.target_value) :
                             alert.type.includes('percent') || alert.type.includes('rsi') ? 
                             `${alert.target_value}%` : alert.target_value}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        {alert.notify_push && (
                          <Volume2 className="w-4 h-4 text-muted-foreground" />
                        )}
                        {alert.notify_email && (
                          <VolumeX className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                      <Switch
                        checked={alert.is_active}
                        onCheckedChange={(checked) => handleToggleAlert(alert.id, checked)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-red-500"
                        onClick={() => handleDeleteAlert(alert.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Add Alert Dialog */}
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent dir="rtl" className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" />
                إضافة تنبيه جديد
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>رمز السهم</Label>
                <Input 
                  placeholder="مثال: CIBC" 
                  value={addTicker} 
                  onChange={(e) => setAddTicker(e.target.value.toUpperCase())} 
                  className="mt-1" 
                />
              </div>
              <div>
                <Label>نوع التنبيه</Label>
                <Select value={addType} onValueChange={setAddType}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="price_above">السعر فوق</SelectItem>
                    <SelectItem value="price_below">السعر تحت</SelectItem>
                    <SelectItem value="change_percent">نسبة التغير</SelectItem>
                    <SelectItem value="rsi_overbought">RSI تشبع شراء</SelectItem>
                    <SelectItem value="rsi_oversold">RSI تشبع بيع</SelectItem>
                    <SelectItem value="signal">إشارة تداول</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>القيمة المستهدفة</Label>
                <Input 
                  type="number" 
                  placeholder="0.00" 
                  value={addTargetValue} 
                  onChange={(e) => setAddTargetValue(e.target.value)} 
                  className="mt-1" 
                />
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch checked={addNotifyPush} onCheckedChange={setAddNotifyPush} />
                  <Label className="text-sm">إشعار</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={addNotifyEmail} onCheckedChange={setAddNotifyEmail} />
                  <Label className="text-sm">بريد</Label>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>إلغاء</Button>
              <Button onClick={handleAddAlert}>إضافة</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
