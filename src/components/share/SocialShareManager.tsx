'use client';

import React, { useState, useCallback } from 'react';
import {
  Send,
  Copy,
  Check,
  Image as ImageIcon,
  Loader2,
  Telegram,
  MessageCircle,
  Clock,
  TrendingUp,
  Newspaper,
  Share2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { OFFICIAL_LINKS_BLOCK } from '@/lib/official-links';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface TelegramStatus {
  success: boolean;
  connected?: boolean;
  channel?: string;
  channel_name?: string;
  error?: string;
}

interface PostResult {
  success: boolean;
  message_id?: number;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────────────────────

const MESSAGE_TEMPLATES = {
  recommendation: {
    name: 'توقعة سهم',
    nameEn: 'Stock Recommendation',
    template: `📊 **تحليل سهم {ticker}**
🏦 {name_ar}

🟢 **التوقعة: شراء**
💰 **السعر الحالي:** {price} ج.م
🎯 **الهدف:** {target} ج.م
🛑 **وقف الخسارة:** {stop_loss} ج.م

📈 **مستوى الثقة:** {confidence}%
🏢 **القطاع:** {sector}

${OFFICIAL_LINKS_BLOCK}
⚠️ تحليل تلقائي - ليس نصيحة استثمارية
🚀 **دليل الاستثمار**

#البورصة_المصرية #توقعات_أسهم #EGX #الاستثمار #تداول #مصر`,
  },
  daily_summary: {
    name: 'ملخص يومي',
    nameEn: 'Daily Summary',
    template: `🌅 **تقرير صباحي - {date}**

📊 **ملخص السوق:**
• 📈 الأسهم الصاعدة: {gainers}
• 📉 الأسهم الهابطة: {losers}
• ➡️ بدون تغيير: {unchanged}

🔥 **أعلى الصاعدات:**
1. {top1_ticker} ({top1_change}%)
2. {top2_ticker} ({top2_change}%)
3. {top3_ticker} ({top3_change}%)

💡 **توقعات اليوم:**
• 🟢 {rec1_ticker} - {rec1_name}
• 🟢 {rec2_ticker} - {rec2_name}

${OFFICIAL_LINKS_BLOCK}
🚀 **دليل الاستثمار**

#البورصة_المصرية #توقعات_أسهم #EGX #الاستثمار #تداول #مصر #الاقتصاد_المصري`,
  },
  alert: {
    name: 'تنبيه سهمي',
    nameEn: 'Stock Alert',
    template: `🚀 **تنبيه سهمي - {ticker}**

🏦 {name_ar}
💰 السعر الحالي: {price} ج.م

📝 {message}

${OFFICIAL_LINKS_BLOCK}
🚀 **دليل الاستثمار**

#البورصة_المصرية #توقعات_أسهم #EGX #الاستثمار #تداول #مصر`,
  },
  market_open: {
    name: 'افتتاح السوق',
    nameEn: 'Market Open',
    template: `🔔 **السوق فتح!**

📅 {date}
⏰ جلسة التداول بدأت

💡 تابعونا للحصول على:
• تحليلات السوق المباشرة
• توقعات اليوم
• تنبيهات الأسهم المهمة

${OFFICIAL_LINKS_BLOCK}
🚀 **دليل الاستثمار**

#البورصة_المصرية #EGX #تداول #مصر #الاقتصاد_المصري`,
  },
  market_close: {
    name: 'إغلاق السوق',
    nameEn: 'Market Close',
    template: `🔔 **السوق أغلق!**

📅 {date}
⏰ انتهت جلسة التداول

📊 **ملخص الجلسة:**
• 📈 الصاعدات: {gainers}
• 📉 الهابطات: {losers}

🌅 نتمنى لكم يوماً موفقاً
نراكم غداً إن شاء الله

${OFFICIAL_LINKS_BLOCK}
🚀 **دليل الاستثمار**

#البورصة_المصرية #EGX #تداول #مصر #الاقتصاد_المصري`,
  },
  custom: {
    name: 'رسالة مخصصة',
    nameEn: 'Custom Message',
    template: '',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

interface SocialShareManagerProps {
  className?: string;
}

export function SocialShareManager({ className }: SocialShareManagerProps) {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState('telegram');

  // Message form state
  const [selectedTemplate, setSelectedTemplate] = useState('recommendation');
  const [messageText, setMessageText] = useState('');
  const [ticker, setTicker] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [price, setPrice] = useState('');
  const [target, setTarget] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [confidence, setConfidence] = useState('75');
  const [sector, setSector] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  // Check Telegram status
  const checkStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/telegram/post');
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      setStatus({ success: false, error: 'فشل الاتصال بالخادم' });
    }
  }, []);

  // Connect to Telegram
  const connectTelegram = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/telegram/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'connect' }),
      });
      const data = await response.json();
      setStatus(data);

      if (data.success) {
        toast.success('تم الاتصال بالتليجرام بنجاح');
      } else {
        toast.error(data.error || 'فشل الاتصال');
      }
    } catch (error) {
      toast.error('فشل الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, []);

  // Post message to Telegram
  const postToTelegram = useCallback(async (action: string, data?: any) => {
    setLoading(true);
    try {
      const response = await fetch('/api/telegram/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data }),
      });
      const result: PostResult = await response.json();

      if (result.success) {
        toast.success('تم النشر بنجاح!');
      } else {
        toast.error(result.error || 'فشل النشر');
      }

      return result;
    } catch (error) {
      toast.error('فشل الاتصال بالخادم');
      return { success: false, error: 'فشل الاتصال' };
    } finally {
      setLoading(false);
    }
  }, []);

  // Generate message from template
  const generateFromTemplate = useCallback(() => {
    const template = MESSAGE_TEMPLATES[selectedTemplate as keyof typeof MESSAGE_TEMPLATES];
    if (!template) return;

    let text = template.template;

    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // Replace placeholders
    text = text.replace(/{ticker}/g, ticker || 'COMI');
    text = text.replace(/{name_ar}/g, nameAr || 'البنك التجاري الدولي');
    text = text.replace(/{price}/g, price || '136.59');
    text = text.replace(/{target}/g, target || '150.00');
    text = text.replace(/{stop_loss}/g, stopLoss || '128.00');
    text = text.replace(/{confidence}/g, confidence || '75');
    text = text.replace(/{sector}/g, sector || 'البنوك');
    text = text.replace(/{message}/g, alertMessage || 'اختراق مقاومة 135');
    text = text.replace(/{date}/g, dateStr);
    text = text.replace(/{gainers}/g, '45');
    text = text.replace(/{losers}/g, '38');
    text = text.replace(/{unchanged}/g, '12');

    // Top gainers placeholders
    text = text.replace(/{top1_ticker}/g, 'COMI');
    text = text.replace(/{top1_change}/g, '+5.2');
    text = text.replace(/{top2_ticker}/g, 'ETAL');
    text = text.replace(/{top2_change}/g, '+4.1');
    text = text.replace(/{top3_ticker}/g, 'HRHO');
    text = text.replace(/{top3_change}/g, '+3.8');

    // Recommendations placeholders
    text = text.replace(/{rec1_ticker}/g, 'COMI');
    text = text.replace(/{rec1_name}/g, 'البنك التجاري الدولي');
    text = text.replace(/{rec2_ticker}/g, 'ETAL');
    text = text.replace(/{rec2_name}/g, 'إعمار للمقاولات');

    setMessageText(text);
  }, [selectedTemplate, ticker, nameAr, price, target, stopLoss, confidence, sector, alertMessage]);

  // Copy to clipboard
  const copyToClipboard = useCallback(async () => {
    if (!messageText) {
      toast.error('لا يوجد نص للنسخ');
      return;
    }

    try {
      await navigator.clipboard.writeText(messageText);
      setCopied(true);
      toast.success('تم نسخ النص');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('فشل نسخ النص');
    }
  }, [messageText]);

  // Post daily summary
  const postDailySummary = useCallback(async () => {
    await postToTelegram('daily-summary');
  }, [postToTelegram]);

  // Post market open
  const postMarketOpen = useCallback(async () => {
    await postToTelegram('market-open');
  }, [postToTelegram]);

  // Post market close
  const postMarketClose = useCallback(async () => {
    await postToTelegram('market-close', { include_summary: true });
  }, [postToTelegram]);

  // Post top recommendations
  const postTopRecommendations = useCallback(async () => {
    await postToTelegram('top-recommendations', { limit: 5, min_score: 70 });
  }, [postToTelegram]);

  // Post custom message
  const postCustomMessage = useCallback(async () => {
    if (!messageText) {
      toast.error('يرجى كتابة الرسالة أولاً');
      return;
    }
    await postToTelegram('message', { text: messageText, parse_mode: 'md' });
  }, [messageText, postToTelegram]);

  // Post recommendation
  const postRecommendation = useCallback(async () => {
    await postToTelegram('recommendation', {
      ticker,
      name_ar: nameAr,
      signal: 'BUY',
      current_price: parseFloat(price) || 0,
      target_price: parseFloat(target) || 0,
      stop_loss: parseFloat(stopLoss) || 0,
      confidence: parseInt(confidence) || 0,
      sector,
    });
  }, [ticker, nameAr, price, target, stopLoss, confidence, sector, postToTelegram]);

  React.useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className={cn('space-y-6', className)} dir="rtl">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Share2 className="h-5 w-5" />
                مركز النشر السريع
              </CardTitle>
              <CardDescription>
                نشر على التليجرام والسوشيال ميديا
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {status?.connected ? (
                <Badge variant="success" className="bg-green-500/10 text-green-600 border-green-500/20">
                  متصل بالتليجرام
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-red-500/10 text-red-600 border-red-500/20">
                  غير متصل
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={connectTelegram}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'اتصال'}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">إجراءات سريعة</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Button
              variant="outline"
              className="h-auto py-4 flex-col gap-2"
              onClick={postDailySummary}
              disabled={loading || !status?.connected}
            >
              <Newspaper className="h-5 w-5 text-blue-500" />
              <span className="text-xs">ملخص يومي</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-4 flex-col gap-2"
              onClick={postMarketOpen}
              disabled={loading || !status?.connected}
            >
              <Clock className="h-5 w-5 text-orange-500" />
              <span className="text-xs">افتتاح السوق</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-4 flex-col gap-2"
              onClick={postMarketClose}
              disabled={loading || !status?.connected}
            >
              <TrendingUp className="h-5 w-5 text-purple-500" />
              <span className="text-xs">إغلاق السوق</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-4 flex-col gap-2"
              onClick={postTopRecommendations}
              disabled={loading || !status?.connected}
            >
              <TrendingUp className="h-5 w-5 text-green-500" />
              <span className="text-xs">أفضل التوقعات</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-2 w-full max-w-md">
          <TabsTrigger value="telegram" className="gap-2">
            <Send className="h-4 w-4" />
            تليجرام
          </TabsTrigger>
          <TabsTrigger value="copy" className="gap-2">
            <Copy className="h-4 w-4" />
            نسخ للنشر
          </TabsTrigger>
        </TabsList>

        {/* Telegram Tab */}
        <TabsContent value="telegram" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">نشر توقعة</CardTitle>
              <CardDescription>أدخل بيانات التوقعة للنشر على القناة</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>رمز السهم</Label>
                  <Input
                    placeholder="COMI"
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  />
                </div>
                <div className="space-y-2">
                  <Label>اسم الشركة</Label>
                  <Input
                    placeholder="البنك التجاري الدولي"
                    value={nameAr}
                    onChange={(e) => setNameAr(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>السعر الحالي</Label>
                  <Input
                    type="number"
                    placeholder="136.59"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>السعر المستهدف</Label>
                  <Input
                    type="number"
                    placeholder="150.00"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>وقف الخسارة</Label>
                  <Input
                    type="number"
                    placeholder="128.00"
                    value={stopLoss}
                    onChange={(e) => setStopLoss(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>مستوى الثقة (%)</Label>
                  <Input
                    type="number"
                    placeholder="75"
                    value={confidence}
                    onChange={(e) => setConfidence(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>القطاع</Label>
                  <Input
                    placeholder="البنوك"
                    value={sector}
                    onChange={(e) => setSector(e.target.value)}
                  />
                </div>
              </div>

              <Button
                className="w-full"
                onClick={postRecommendation}
                disabled={loading || !status?.connected || !ticker}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin ml-2" />
                ) : (
                  <Send className="h-4 w-4 ml-2" />
                )}
                نشر التوقعة
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Copy Tab */}
        <TabsContent value="copy" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">قوالب النسخ السريع</CardTitle>
              <CardDescription>اختر قالب وانسخه للنشر على فيسبوك أو أي منصة أخرى</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Template Selection */}
              <div className="space-y-2">
                <Label>اختر القالب</Label>
                <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(MESSAGE_TEMPLATES).map(([key, value]) => (
                      <SelectItem key={key} value={key}>
                        {value.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Template-specific inputs */}
              {selectedTemplate === 'recommendation' && (
                <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                  <div className="space-y-2">
                    <Label className="text-xs">رمز السهم</Label>
                    <Input
                      placeholder="COMI"
                      value={ticker}
                      onChange={(e) => setTicker(e.target.value.toUpperCase())}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">اسم الشركة</Label>
                    <Input
                      placeholder="البنك التجاري الدولي"
                      value={nameAr}
                      onChange={(e) => setNameAr(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">السعر</Label>
                    <Input placeholder="136.59" value={price} onChange={(e) => setPrice(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">الهدف</Label>
                    <Input placeholder="150" value={target} onChange={(e) => setTarget(e.target.value)} />
                  </div>
                </div>
              )}

              {selectedTemplate === 'alert' && (
                <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
                  <Label className="text-xs">رسالة التنبيه</Label>
                  <Input
                    placeholder="اختراق مقاومة 135"
                    value={alertMessage}
                    onChange={(e) => setAlertMessage(e.target.value)}
                  />
                </div>
              )}

              {/* Generate & Preview */}
              <div className="flex gap-2">
                <Button variant="outline" onClick={generateFromTemplate} className="flex-1">
                  إنشاء من القالب
                </Button>
              </div>

              {/* Message Preview */}
              <div className="space-y-2">
                <Label>معاينة الرسالة</Label>
                <Textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="سيظهر النص هنا بعد الإنشاء..."
                  rows={10}
                  className="font-mono text-sm"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button onClick={copyToClipboard} className="flex-1" disabled={!messageText}>
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 ml-2" />
                      تم النسخ!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 ml-2" />
                      نسخ النص
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={postCustomMessage}
                  disabled={loading || !status?.connected || !messageText}
                >
                  <Send className="h-4 w-4 ml-2" />
                  نشر على تليجرام
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Tips */}
      <Card className="bg-muted/30">
        <CardContent className="py-4">
          <div className="text-sm text-muted-foreground space-y-1">
            <p>💡 <strong>نصائح:</strong></p>
            <ul className="list-disc list-inside space-y-1 mr-4">
              <li>استخدم تبويب "نسخ للنشر" للنشر على فيسبوك يدوياً</li>
              <li>التليجرام يدعم تنسيق Markdown (حدود **للعريض**)</li>
              <li>يمكنك تعديل النص قبل النسخ أو النشر</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default SocialShareManager;
