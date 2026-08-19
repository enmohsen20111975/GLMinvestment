'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Share2, Copy, Check, RefreshCw, Loader2, TrendingUp, TrendingDown,
  Target, Shield, Sparkles, Send, FileText, MessageSquare
} from 'lucide-react';
import { toast } from 'sonner';
import { OFFICIAL_LINKS_BLOCK } from '@/lib/official-links';

// Types
interface StockAnalysis {
  ticker: string;
  name_ar?: string;
  signal: string;
  signal_ar?: string;
  confidence: number;
  master_score: number;
  current_price?: number;
  risk_profile?: {
    entry_price: number;
    stop_loss_price: number;
    target_price: number;
    risk_reward_ratio: number;
  };
  persona_adjusted?: {
    adjusted_signal: string;
    original_score: number;
  };
}

interface SocialPostViewProps {
  onStockClick?: (ticker: string) => void;
}

// Signal colors and labels
const SIGNAL_CONFIG: Record<string, { color: string; bg: string; label: string; emoji: string }> = {
  STRONG_BUY: { color: 'text-emerald-600', bg: 'bg-emerald-500', label: 'شراء قوي', emoji: '🚀' },
  BUY: { color: 'text-green-600', bg: 'bg-green-500', label: 'شراء', emoji: '🟢' },
  ACCUMULATE: { color: 'text-teal-600', bg: 'bg-teal-500', label: 'تجميع', emoji: '📊' },
  HOLD: { color: 'text-gray-600', bg: 'bg-gray-500', label: 'احتفاظ', emoji: '⏸️' },
  REDUCE: { color: 'text-orange-600', bg: 'bg-orange-500', label: 'تخفيف', emoji: '📉' },
  SELL: { color: 'text-red-600', bg: 'bg-red-500', label: 'بيع', emoji: '🔴' },
  STRONG_SELL: { color: 'text-red-700', bg: 'bg-red-600', label: 'بيع قوي', emoji: '⚠️' },
};

export function SocialPostView({ onStockClick }: SocialPostViewProps) {
  const [loading, setLoading] = useState(true);
  const [stocks, setStocks] = useState<StockAnalysis[]>([]);
  const [copied, setCopied] = useState(false);
  const [customText, setCustomText] = useState('');
  const [activeTab, setActiveTab] = useState('generated');

  // Fetch data from the same API as advanced-analysis
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Try saved results first
      const savedRes = await fetch(`/api/advanced-analysis/results?date=${today}`);
      const savedData = await savedRes.json();
      
      if (savedData.success && savedData.results?.length > 0) {
        const formatted: StockAnalysis[] = savedData.results.map((r: any) => ({
          ticker: r.ticker,
          name_ar: r.name_ar || r.ticker,
          signal: r.recommendation || 'HOLD',
          signal_ar: r.recommendation_ar || 'احتفاظ',
          confidence: r.overall_score || 50,
          master_score: r.overall_score || 50,
          current_price: r.current_price,
          risk_profile: {
            entry_price: r.entry_price || r.current_price,
            stop_loss_price: r.stop_loss || r.current_price * 0.95,
            target_price: r.take_profit_1 || r.current_price * 1.1,
            risk_reward_ratio: r.risk_reward_ratio || 2,
          }
        }));
        setStocks(formatted);
      } else {
        // Fallback to scanner API
        const scannerRes = await fetch('/api/python/v2/scanner/balanced?limit=50');
        const scannerData = await scannerRes.json();
        
        if (scannerData.success && scannerData.results?.length > 0) {
          setStocks(scannerData.results);
        }
      }
    } catch (err) {
      console.error('Error fetching data:', err);
      toast.error('فشل في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter actionable stocks (BUY, STRONG_BUY, ACCUMULATE)
  const actionableStocks = stocks.filter(s => {
    const signal = s.persona_adjusted?.adjusted_signal || s.signal;
    return ['STRONG_BUY', 'BUY', 'ACCUMULATE'].includes(signal);
  }).slice(0, 10);

  // Generate Facebook/WhatsApp post
  const generatePost = () => {
    const date = new Date().toLocaleDateString('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const lines: string[] = [
      '📊 توقعات البورصة المصرية 🇪🇬',
      `📅 ${date}`,
      '━'.repeat(30),
      ''
    ];

    actionableStocks.forEach((stock, idx) => {
      const config = SIGNAL_CONFIG[stock.signal] || SIGNAL_CONFIG.HOLD;
      const price = stock.current_price || stock.risk_profile?.entry_price;
      const target = stock.risk_profile?.target_price;
      const stop = stock.risk_profile?.stop_loss_price;
      const rr = stock.risk_profile?.risk_reward_ratio;

      lines.push(`${idx + 1}. ${stock.name_ar || stock.ticker} (${stock.ticker}) ${config.emoji}`);
      lines.push(`   🎯 الإشارة: ${config.label}`);
      if (price) lines.push(`   💰 سعر الدخول: ${price.toFixed(2)} جنيه`);
      if (target) lines.push(`   🎯 الهدف: ${target.toFixed(2)} جنيه`);
      if (stop) lines.push(`   🛑 الاستوب: ${stop.toFixed(2)} جنيه`);
      if (rr) lines.push(`   📊 نسبة المخاطرة/العائد: 1:${rr.toFixed(1)}`);
      lines.push(`   ⭐ الدرجة: ${stock.master_score}%`);
      lines.push('');
    });

    lines.push('━'.repeat(30));
    lines.push('⚠️ تنبيه هام:');
    lines.push('• هذه التوقعات لأغراض تعليمية فقط');
    lines.push('• أي قرار استثماري مسؤوليتك الشخصية');
    lines.push('• يجب دراسة السوق وإدارة المخاطر');
    lines.push('');
    lines.push(OFFICIAL_LINKS_BLOCK);
    lines.push('');
    lines.push('#البورصة_المصرية #توقعات #EGX #الأسهم_المصرية #استثمار');

    return lines.join('\n');
  };

  const postContent = generatePost();

  const handleCopy = async () => {
    const textToCopy = activeTab === 'custom' ? customText : postContent;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      toast.success('تم نسخ البوست');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('فشل في النسخ');
    }
  };

  return (
    <Card className="border-border/60" dir="rtl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Share2 className="w-5 h-5 text-primary" />
            بوست جاهز للنشر
            <Badge variant="outline" className="text-[10px]">واتساب / فيسبوك</Badge>
          </CardTitle>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : actionableStocks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Target className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>لا توجد أسهم للتوقعة حالياً</p>
            <p className="text-sm">قم بتشغيل التحليل من صفحة الأدمن</p>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-2 text-center">
                <p className="text-2xl font-bold text-emerald-600">{actionableStocks.filter(s => s.signal === 'STRONG_BUY').length}</p>
                <p className="text-xs text-muted-foreground">شراء قوي</p>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2 text-center">
                <p className="text-2xl font-bold text-green-600">{actionableStocks.filter(s => s.signal === 'BUY').length}</p>
                <p className="text-xs text-muted-foreground">شراء</p>
              </div>
              <div className="bg-teal-50 dark:bg-teal-900/20 rounded-lg p-2 text-center">
                <p className="text-2xl font-bold text-teal-600">{actionableStocks.filter(s => s.signal === 'ACCUMULATE').length}</p>
                <p className="text-xs text-muted-foreground">تجميع</p>
              </div>
              <div className="bg-primary/10 rounded-lg p-2 text-center">
                <p className="text-2xl font-bold text-primary">{actionableStocks.length}</p>
                <p className="text-xs text-muted-foreground">إجمالي</p>
              </div>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full">
                <TabsTrigger value="generated" className="flex-1 gap-1">
                  <Sparkles className="w-4 h-4" />
                  البوست المُنشأ
                </TabsTrigger>
                <TabsTrigger value="custom" className="flex-1 gap-1">
                  <FileText className="w-4 h-4" />
                  نص مخصص
                </TabsTrigger>
              </TabsList>

              <TabsContent value="generated" className="mt-4">
                <ScrollArea className="h-[400px] rounded-lg border bg-muted/30 p-4">
                  <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">
                    {postContent}
                  </pre>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="custom" className="mt-4">
                <Textarea
                  placeholder="الصق نص التوقعات من الواتساب أو اكتب نصك الخاص..."
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  className="min-h-[400px] text-sm leading-relaxed"
                />
              </TabsContent>
            </Tabs>

            {/* Actions */}
            <div className="flex gap-2">
              <Button onClick={handleCopy} className="flex-1 gap-2">
                {copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    تم النسخ
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    نسخ البوست
                  </>
                )}
              </Button>
              <Button variant="outline" className="gap-2">
                <Send className="w-4 h-4" />
                مشاركة
              </Button>
            </div>

            {/* Quick Stocks List */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Target className="w-4 h-4" />
                الأسهم المضمنة ({actionableStocks.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {actionableStocks.map((stock) => {
                  const config = SIGNAL_CONFIG[stock.signal] || SIGNAL_CONFIG.HOLD;
                  return (
                    <Badge
                      key={stock.ticker}
                      variant="outline"
                      className={`cursor-pointer hover:bg-muted ${config.color}`}
                      onClick={() => onStockClick?.(stock.ticker)}
                    >
                      {config.emoji} {stock.ticker}
                      <span className="mr-1 text-xs opacity-70">({stock.master_score}%)</span>
                    </Badge>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default SocialPostView;
