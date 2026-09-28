'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  TrendingUp, TrendingDown, Target, Shield, AlertTriangle,
  CheckCircle, Loader2, RefreshCw, BarChart3,
  Activity, Zap, Info, Calculator, LineChart,
  Share2, MessageCircle, Facebook, Send, Download,
  TrendingUpIcon, MinusCircle, ArrowUpRight, ArrowDownRight,
  Crosshair, Layers, Trophy
} from 'lucide-react';
import { toast } from 'sonner';
import { OFFICIAL_LINKS_BLOCK } from '@/modules/publishing/lib/official-links';
import { useAppStore, MARKET_NAMES_AR } from '@/lib/store';
import { ExpertIntelligencePanel } from '@/components/shared/ExpertIntelligencePanel';
import { StockPublisher } from '@/modules/publishing/components/StockPublisher';
import { PredictionTrackingDashboard } from '@/modules/predictions/components/PredictionTrackingDashboard';

// ============================================================================
// Types
// ============================================================================

interface TechnicalIndicators {
  rsi: { value: number; signal: string };
  macd: { trend: string; histogram: number };
  bollinger: { upper: number; middle: number; lower: number; position: number };
  sma_20: number;
  sma_50: number;
  ema_12?: number;
  ema_26?: number;
  atr?: number;
  stochastic_k?: number;
  stochastic_d?: number;
}

interface AnalysisData {
  ticker: string;
  stock: {
    ticker: string;
    name: string;
    name_ar?: string;
    current_price: number;
    sector?: string;
  };
  analysis: {
    scores: {
      composite: number;
      technical: number;
      value: number;
      quality: number;
      momentum: number;
      risk: number;
    };
    recommendation: {
      action: string;
      action_ar: string;
      confidence: number;
      entry_price: number;
      target_price: number;
      stop_loss: number;
      risk_reward_ratio: number;
    };
    indicators: TechnicalIndicators;
    patterns: { detected: Array<{ name: string; name_ar: string; type: string }> };
    price_levels: { support_1: number; resistance_1: number; pivot: number };
    trend: { direction: string; direction_ar: string };
    risk_metrics: { max_drawdown_percent: number; volatility_annualized: number };
  };
  data_points: number;
  generated_at: string;
  source: string;
}

// ============================================================================
// Scientific Equations Component
// ============================================================================

function IndicatorEquations() {
  return (
    <Card className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Calculator className="w-5 h-5 text-teal-600" />
          المعادلات العلمية للمؤشرات
        </CardTitle>
        <CardDescription>
          المعادلات المستخدمة في التحليل الفني وكيفية حسابها
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* RSI */}
        <div className="p-4 bg-white dark:bg-slate-800 rounded-lg border">
          <h4 className="font-bold text-teal-600 mb-2">1. RSI - مؤشر القوة النسبية</h4>
          <div className="bg-slate-100 dark:bg-slate-700 p-3 rounded font-mono text-sm mb-3">
            RSI = 100 - (100 / (1 + RS))
            <br />
            RS = Average Gain / Average Loss
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p><strong>حيث:</strong></p>
            <ul className="list-disc list-inside mr-4 space-y-1">
              <li>Average Gain = متوسط الأيام الصاعدة (عادة 14 يوم)</li>
              <li>Average Loss = متوسط الأيام الهابطة (عادة 14 يوم)</li>
              <li>RSI {'<'} 30 = تشبع بيعي (فرصة شراء)</li>
              <li>RSI {'>'} 70 = تشبع شرائي (فرصة بيع)</li>
            </ul>
          </div>
        </div>

        {/* MACD */}
        <div className="p-4 bg-white dark:bg-slate-800 rounded-lg border">
          <h4 className="font-bold text-purple-600 mb-2">2. MACD - تقارب وتباعد المتوسطات</h4>
          <div className="bg-slate-100 dark:bg-slate-700 p-3 rounded font-mono text-sm mb-3">
            MACD Line = EMA(12) - EMA(26)
            <br />
            Signal Line = EMA(9) of MACD Line
            <br />
            Histogram = MACD Line - Signal Line
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p><strong>التفسير:</strong></p>
            <ul className="list-disc list-inside mr-4 space-y-1">
              <li>تقاطع MACD فوق Signal = إشارة صعود</li>
              <li>تقاطع MACD تحت Signal = إشارة هبوط</li>
              <li>Histogram موجب = زخم صاعد</li>
              <li>Histogram سالب = زخم هابط</li>
            </ul>
          </div>
        </div>

        {/* Moving Averages */}
        <div className="p-4 bg-white dark:bg-slate-800 rounded-lg border">
          <h4 className="font-bold text-green-600 mb-2">3. المتوسطات المتحركة (SMA/EMA)</h4>
          <div className="bg-slate-100 dark:bg-slate-700 p-3 rounded font-mono text-sm mb-3">
            SMA = (P1 + P2 + ... + Pn) / n
            <br />
            EMA = Price × k + EMA_prev × (1-k)
            <br />
            k = 2 / (n + 1)
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p><strong>الاستخدام:</strong></p>
            <ul className="list-disc list-inside mr-4 space-y-1">
              <li>SMA 20 فوق SMA 50 = اتجاه صاعد</li>
              <li>SMA 20 تحت SMA 50 = اتجاه هابط</li>
              <li>EMA أسرع في الاستجابة للتغيرات</li>
            </ul>
          </div>
        </div>

        {/* Fibonacci */}
        <div className="p-4 bg-white dark:bg-slate-800 rounded-lg border">
          <h4 className="font-bold text-amber-600 mb-2">4. مستويات فيبوناتشي</h4>
          <div className="bg-slate-100 dark:bg-slate-700 p-3 rounded font-mono text-sm mb-3">
            Level = High - (High - Low) × Ratio
            <br />
            Ratios: 0%, 23.6%, 38.2%, 50%, 61.8%, 78.6%, 100%
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p><strong>المستويات المهمة:</strong></p>
            <ul className="list-disc list-inside mr-4 space-y-1">
              <li><strong>61.8%</strong> (المستوى الذهبي) - أقوى مستوى دعم/مقاومة</li>
              <li><strong>38.2%</strong> - تصحيح متوسط</li>
              <li><strong>50%</strong> - مستوى نفسي مهم</li>
            </ul>
          </div>
        </div>

        {/* Bollinger Bands */}
        <div className="p-4 bg-white dark:bg-slate-800 rounded-lg border">
          <h4 className="font-bold text-cyan-600 mb-2">5. نطاقات بولينجر</h4>
          <div className="bg-slate-100 dark:bg-slate-700 p-3 rounded font-mono text-sm mb-3">
            Middle Band = SMA(20)
            <br />
            Upper Band = Middle + (2 × StdDev)
            <br />
            Lower Band = Middle - (2 × StdDev)
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p><strong>التفسير:</strong></p>
            <ul className="list-disc list-inside mr-4 space-y-1">
              <li>السعر عند Upper Band = تشبع شرائي</li>
              <li>السعر عند Lower Band = تشبع بيعي</li>
              <li>ضيق النطاق = انفجار قادم</li>
            </ul>
          </div>
        </div>

        {/* Stochastic */}
        <div className="p-4 bg-white dark:bg-slate-800 rounded-lg border">
          <h4 className="font-bold text-rose-600 mb-2">6. مؤشر ستوكاستيك</h4>
          <div className="bg-slate-100 dark:bg-slate-700 p-3 rounded font-mono text-sm mb-3">
            %K = ((Close - Lowest Low) / (Highest High - Lowest Low)) × 100
            <br />
            %D = SMA(3) of %K
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p><strong>التفسير:</strong></p>
            <ul className="list-disc list-inside mr-4 space-y-1">
              <li>%K {'<'} 20 = تشبع بيعي</li>
              <li>%K {'>'} 80 = تشبع شرائي</li>
              <li>تقاطع %K فوق %D = إشارة صعود</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Candlestick Chart Component
// ============================================================================

function CandlestickChart({ data }: { data: { open: number; high: number; low: number; close: number }[] }) {
  if (!data || data.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-muted-foreground text-center">لا توجد بيانات كافية للرسم البياني</p>
      </Card>
    );
  }

  const maxHeight = 200;
  const candleWidth = 12;
  const gap = 4;
  
  const allPrices = data.flatMap(d => [d.high, d.low]);
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const priceRange = maxPrice - minPrice;
  
  const scaleY = (price: number) => {
    return maxHeight - ((price - minPrice) / priceRange) * maxHeight;
  };

  return (
    <Card className="p-4 bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-bold text-white flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          شارت الشموع اليابانية
        </h4>
        <Badge variant="outline" className="text-white border-white/30">
          آخر 30 يوم
        </Badge>
      </div>
      
      <div className="relative overflow-x-auto">
        <svg 
          width={data.length * (candleWidth + gap) + 60} 
          height={maxHeight + 60}
          className="mx-auto"
        >
          {/* Price labels */}
          <text x="5" y="20" className="fill-slate-400 text-xs">{maxPrice.toFixed(2)}</text>
          <text x="5" y={maxHeight / 2} className="fill-slate-400 text-xs">
            {((maxPrice + minPrice) / 2).toFixed(2)}
          </text>
          <text x="5" y={maxHeight + 10} className="fill-slate-400 text-xs">{minPrice.toFixed(2)}</text>
          
          {/* Grid lines */}
          <line x1="50" y1="20" x2={data.length * (candleWidth + gap) + 50} y2="20" stroke="rgba(255,255,255,0.1)" />
          <line x1="50" y1={maxHeight / 2} x2={data.length * (candleWidth + gap) + 50} y2={maxHeight / 2} stroke="rgba(255,255,255,0.1)" />
          <line x1="50" y1={maxHeight} x2={data.length * (candleWidth + gap) + 50} y2={maxHeight} stroke="rgba(255,255,255,0.1)" />
          
          {/* Candles */}
          {data.slice(-30).map((candle, i) => {
            const isGreen = candle.close >= candle.open;
            const color = isGreen ? '#22c55e' : '#ef4444';
            const bodyTop = scaleY(Math.max(candle.open, candle.close));
            const bodyBottom = scaleY(Math.min(candle.open, candle.close));
            const bodyHeight = Math.max(bodyBottom - bodyTop, 1);
            
            return (
              <g key={i} transform={`translate(${50 + i * (candleWidth + gap)}, 20)`}>
                {/* Wick */}
                <line
                  x1={candleWidth / 2}
                  y1={scaleY(candle.high) - 20}
                  x2={candleWidth / 2}
                  y2={scaleY(candle.low) - 20}
                  stroke={color}
                  strokeWidth="1"
                />
                {/* Body */}
                <rect
                  x="0"
                  y={bodyTop - 20}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={isGreen ? color : color}
                  stroke={color}
                  strokeWidth="1"
                  rx="1"
                />
              </g>
            );
          })}
        </svg>
      </div>
      
      <div className="flex justify-center gap-6 mt-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-500 rounded"></div>
          <span className="text-green-400">صاعد</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-red-500 rounded"></div>
          <span className="text-red-400">هابط</span>
        </div>
      </div>
    </Card>
  );
}

// ============================================================================
// Support/Resistance Chart
// ============================================================================

function SupportResistanceChart({ 
  support, 
  resistance, 
  currentPrice,
  pivot 
}: { 
  support: number; 
  resistance: number; 
  currentPrice: number;
  pivot: number;
}) {
  const levels = [
    { price: resistance, label: 'مقاومة', labelEn: 'Resistance', color: 'bg-red-500' },
    { price: pivot, label: 'نقطة ارتكاز', labelEn: 'Pivot', color: 'bg-teal-500' },
    { price: currentPrice, label: 'السعر الحالي', labelEn: 'Current', color: 'bg-green-500' },
    { price: support, label: 'دعم', labelEn: 'Support', color: 'bg-emerald-500' },
  ].sort((a, b) => b.price - a.price);

  const maxPrice = Math.max(resistance, currentPrice) * 1.05;
  const minPrice = Math.min(support, currentPrice) * 0.95;
  const range = maxPrice - minPrice;

  return (
    <Card className="p-4">
      <h4 className="font-bold mb-4 flex items-center gap-2">
        <LineChart className="w-5 h-5 text-amber-600" />
        مستويات الدعم والمقاومة
      </h4>
      
      <div className="relative h-64 bg-gradient-to-b from-red-50 via-white to-green-50 dark:from-red-900/20 dark:via-slate-800 dark:to-green-900/20 rounded-lg p-4">
        {levels.map((level, i) => {
          const top = ((maxPrice - level.price) / range) * 100;
          return (
            <div 
              key={i}
              className="absolute right-4 left-4 flex items-center gap-3"
              style={{ top: `${top}%` }}
            >
              <div className={`w-3 h-3 rounded-full ${level.color}`}></div>
              <div className={`flex-1 h-0.5 ${level.color} opacity-50`}></div>
              <div className="text-sm font-medium">
                {level.price.toFixed(2)} - {level.label}
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="grid grid-cols-3 gap-4 mt-4 text-center text-sm">
        <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded">
          <p className="text-red-600 font-bold">{resistance.toFixed(2)}</p>
          <p className="text-muted-foreground">مقاومة</p>
        </div>
        <div className="p-2 bg-blue-50 dark:bg-teal-900/20 rounded">
          <p className="text-teal-600 font-bold">{pivot.toFixed(2)}</p>
          <p className="text-muted-foreground">نقطة ارتكاز</p>
        </div>
        <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded">
          <p className="text-green-600 font-bold">{support.toFixed(2)}</p>
          <p className="text-muted-foreground">دعم</p>
        </div>
      </div>
    </Card>
  );
}

// ============================================================================
// Social Share Buttons
// ============================================================================

function ShareButtons({ data }: { data: AnalysisData }) {
  const { ticker, stock, analysis } = data;
  const { recommendation, scores } = analysis;
  
  const shareText = `📊 تحليل سهم ${ticker} - ${stock.name_ar || stock.name}
    
🎯 التحليل: ${recommendation.action_ar}
📈 الدرجة: ${scores.composite.toFixed(0)}/100
💰 سعر الدخول: ${recommendation.entry_price}
🎯 الهدف: ${recommendation.target_price}
🛑 وقف الخسارة: ${recommendation.stop_loss}
⚖️ نسبة المخاطرة/العائد: ${recommendation.risk_reward_ratio}
${OFFICIAL_LINKS_BLOCK}

#EGX #استثمار #تحليل_فني`;

  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  
  const handleWhatsAppShare = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    window.open(url, '_blank');
  };
  
  const handleFacebookShare = () => {
    const url = `https://www.facebook.com/sharer/sharer.php?quote=${encodeURIComponent(shareText)}&u=${encodeURIComponent(shareUrl)}`;
    window.open(url, '_blank');
  };
  
  const handleTelegramShare = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;
    window.open(url, '_blank');
  };
  
  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(shareText);
    toast.success('تم نسخ التحليل!');
  };

  return (
    <Card className="p-4">
      <h4 className="font-bold mb-4 flex items-center gap-2">
        <Share2 className="w-5 h-5 text-teal-600" />
        مشاركة التحليل
      </h4>
      
      <div className="flex flex-wrap gap-3">
        <Button 
          onClick={handleWhatsAppShare}
          className="bg-green-500 hover:bg-green-600 text-white gap-2"
        >
          <MessageCircle className="w-4 h-4" />
          WhatsApp
        </Button>
        
        <Button 
          onClick={handleFacebookShare}
          className="bg-teal-600 hover:bg-teal-700 text-white gap-2"
        >
          <Facebook className="w-4 h-4" />
          Facebook
        </Button>
        
        <Button 
          onClick={handleTelegramShare}
          className="bg-sky-500 hover:bg-sky-600 text-white gap-2"
        >
          <Send className="w-4 h-4" />
          Telegram
        </Button>
        
        <Button 
          onClick={handleCopyToClipboard}
          variant="outline"
          className="gap-2"
        >
          <Download className="w-4 h-4" />
          نسخ
        </Button>
      </div>
    </Card>
  );
}

// ============================================================================
// Score Card Component
// ============================================================================

function ScoreCard({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-lg border">
      <p className={`text-2xl font-bold ${color}`}>{score.toFixed(0)}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      <Progress value={score} className="h-1 mt-2" />
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function SpecialistAnalysisView() {
  const { stocks, currentMarket, loadStocks } = useAppStore();
  const [ticker, setTicker] = useState('');
  const [loading, setLoading] = useState(false);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [candleData, setCandleData] = useState<Array<{ open: number; high: number; low: number; close: number }>>([]);
  // ⭐ Top-level tab: تحليل سهم فقط (ذكاء الخبير + مقارنة الشخصيات تم حذفهما في 2026-09-28 حسب طلب المستخدم)
  const [topTab, setTopTab] = useState<'single'>('single');
  const marketCode = currentMarket === 'KSA' ? 'TADAWUL' : currentMarket;

  useEffect(() => {
    if (stocks.length === 0) {
      loadStocks();
    }
  }, [stocks.length, loadStocks]);

  const fetchAnalysis = useCallback(async (symbol: string) => {
    if (!symbol) return;
    
    setLoading(true);
    setError(null);
    setAnalysisData(null);
    setCandleData([]);
    
    try {
      // Fetch analysis
      const response = await fetch(`/api/python/professional-analysis/${symbol}`);
      const data = await response.json();
      
      if (data.success) {
        setAnalysisData(data);
        
        // Fetch historical data for candlestick chart
        const historyResponse = await fetch(`/api/python/history/${symbol}?days=30`);
        const historyData = await historyResponse.json();
        
        if (historyData.success && historyData.data?.history) {
          // عند غياب open/high/low نستخدم close كقيمة بديلة (ممارسة مالية قياسية) — بلا أي توليد عشوائي.
          const candles = historyData.data.history.map((h: any) => ({
            open: Number(h.open ?? h.close),
            high: Number(h.high ?? h.close),
            low: Number(h.low ?? h.close),
            close: Number(h.close),
          }));
          setCandleData(candles);
        }
        
        setActiveTab('overview');
      } else {
        setError(data.error || 'فشل في تحميل التحليل');
        setAnalysisData(null);
        setCandleData([]);
      }
    } catch (err) {
      setError('حدث خطأ في الاتصال بالخادم');
      setAnalysisData(null);
      setCandleData([]);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = () => {
    if (ticker.trim()) {
      fetchAnalysis(ticker.trim().toUpperCase());
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'strong_buy': return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20';
      case 'buy': return 'text-green-600 bg-green-50 dark:bg-green-900/20';
      case 'accumulate': return 'text-teal-600 bg-teal-50 dark:bg-teal-900/20';
      case 'hold': return 'text-gray-600 bg-gray-50 dark:bg-gray-900/20';
      case 'sell': return 'text-orange-600 bg-orange-50 dark:bg-orange-900/20';
      case 'strong_sell': return 'text-red-600 bg-red-50 dark:bg-red-900/20';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-4 sm:space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 sm:w-7 sm:h-7 text-emerald-600 flex-shrink-0" />
            <span>شاشة التحليل المتقدم للمتخصصين</span>
          </h1>
          <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
            تحليل فني شامل — لمتخصصي الأسواق المالية
          </p>
        </div>
      </div>

      {/* ⭐ Top-level Tabs: 3 أقسام للمتخصصين */}
      <Tabs value={topTab} onValueChange={(v) => setTopTab(v as 'single')}>
        <TabsList className="grid w-full grid-cols-1 h-auto gap-1">
          <TabsTrigger value="single" className="flex items-center gap-1 text-xs sm:text-sm py-2">
            <BarChart3 className="h-4 w-4 flex-shrink-0" />
            <span className="hidden xs:inline sm:inline">تحليل سهم</span>
          </TabsTrigger>
        </TabsList>

        {/* ════ Tab 1: تحليل سهم فردي ════ */}
        <TabsContent value="single" className="mt-4 space-y-4">
          {/* Stock selector */}
          <div className="flex gap-2 w-full">
            <select
              value={ticker}
              onChange={(e) => {
                const val = e.target.value;
                setTicker(val);
                if (val) {
                  fetchAnalysis(val);
                }
              }}
              disabled={loading}
              className="flex-1 px-3 sm:px-4 py-2 border rounded-lg bg-background text-foreground text-sm sm:text-base min-w-0"
            >
              <option value="">اختر سهم من {MARKET_NAMES_AR[currentMarket] || currentMarket}...</option>
              {stocks.map((stock) => (
                <option key={stock.ticker} value={stock.ticker}>
                  {stock.ticker} {stock.name_ar ? `- ${stock.name_ar}` : stock.name ? `- ${stock.name}` : ''}
                </option>
              ))}
            </select>
            <Button onClick={handleSearch} disabled={loading || !ticker} className="flex-shrink-0">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
          </div>

          {/* Error */}
          {error && (
            <Card className="p-4 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
              <p className="text-red-600 text-sm">{error}</p>
            </Card>
          )}

          {/* Loading */}
          {loading && (
            <Card className="p-8">
              <div className="flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
                <p className="text-muted-foreground text-sm">جاري التحليل...</p>
              </div>
            </Card>
          )}

      {/* Analysis Results */}
      {analysisData && !loading && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex flex-wrap mb-4 gap-1">
            <TabsTrigger value="overview" className="gap-2">
              <Zap className="w-4 h-4" /> نظرة عامة
            </TabsTrigger>
            <TabsTrigger value="technical" className="gap-2">
              <BarChart3 className="w-4 h-4" /> التحليل الفني
            </TabsTrigger>
            <TabsTrigger value="equations" className="gap-2">
              <Calculator className="w-4 h-4" /> المعادلات
            </TabsTrigger>
            <TabsTrigger value="charts" className="gap-2">
              <LineChart className="w-4 h-4" /> الرسوم البيانية
            </TabsTrigger>
            <TabsTrigger value="report" className="gap-2">
              <Info className="w-4 h-4" /> التقرير
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            {/* Main Recommendation */}
            <Card className={`border-2 ${getActionColor(analysisData.analysis.recommendation.action)}`}>
              <CardContent className="pt-6">
                <div className="flex flex-col md:flex-row justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-2xl font-bold">{analysisData.ticker}</h2>
                      <Badge className="text-lg px-4 py-1">
                        {analysisData.analysis.recommendation.action_ar}
                      </Badge>
                      <StockPublisher
                        data={{
                          ticker: analysisData.ticker,
                          nameAr: analysisData.stock.name_ar,
                          nameEn: analysisData.stock.name,
                          sector: analysisData.stock.sector,
                          currentPrice: Number(analysisData.stock.current_price ?? 0),
                          entryPrice: Number(analysisData.analysis.recommendation.entry_price ?? 0) || undefined,
                          targetPrice1: Number(analysisData.analysis.recommendation.target_price ?? 0) || undefined,
                          stopLoss: Number(analysisData.analysis.recommendation.stop_loss ?? 0) || undefined,
                          riskReward: Number(analysisData.analysis.recommendation.risk_reward_ratio ?? 0) || undefined,
                          confidence: Number(analysisData.analysis.recommendation.confidence ?? 0) || undefined,
                          rsi: analysisData.analysis.indicators?.rsi?.value,
                          sma20: analysisData.analysis.indicators?.sma_20,
                          sma50: analysisData.analysis.indicators?.sma_50,
                          atr: analysisData.analysis.indicators?.atr,
                          recommendation:
                            (analysisData.analysis.recommendation.action?.includes('STRONG') && analysisData.analysis.recommendation.action?.includes('BUY'))
                              ? 'STRONG_BUY'
                              : analysisData.analysis.recommendation.action?.includes('SELL') ? 'SELL'
                              : analysisData.analysis.recommendation.action?.includes('HOLD') ? 'HOLD'
                              : analysisData.analysis.recommendation.action?.includes('BUY') ? 'BUY' : undefined,
                        }}
                        variant="icon"
                        size="sm"
                      />
                    </div>
                    <p className="text-muted-foreground">{analysisData.stock.name_ar || analysisData.stock.name}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      السعر الحالي: <span className="font-bold text-foreground">{analysisData.stock.current_price}</span>
                    </p>
                  </div>
                  <div className="text-center">
                    <div className="text-5xl font-bold">{analysisData.analysis.scores.composite.toFixed(0)}</div>
                    <p className="text-sm text-muted-foreground">الدرجة الإجمالية</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Scores Grid */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <ScoreCard label="تحليل فني" score={analysisData.analysis.scores.technical} color="text-teal-600" />
              <ScoreCard label="القيمة" score={analysisData.analysis.scores.value} color="text-purple-600" />
              <ScoreCard label="الجودة" score={analysisData.analysis.scores.quality} color="text-green-600" />
              <ScoreCard label="الزخم" score={analysisData.analysis.scores.momentum} color="text-amber-600" />
              <ScoreCard label="المخاطر" score={analysisData.analysis.scores.risk} color="text-red-600" />
              <ScoreCard label="الاتجاه" score={analysisData.analysis.scores.composite} color="text-cyan-600" />
            </div>

            {/* Recommendation Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-amber-600" />
                  تفاصيل التحليل
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <p className="text-sm text-muted-foreground">سعر الدخول</p>
                    <p className="text-2xl font-bold text-green-600">
                      {analysisData.analysis.recommendation.entry_price}
                    </p>
                  </div>
                  <div className="text-center p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <p className="text-sm text-muted-foreground">وقف الخسارة</p>
                    <p className="text-2xl font-bold text-red-600">
                      {analysisData.analysis.recommendation.stop_loss}
                    </p>
                  </div>
                  <div className="text-center p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                    <p className="text-sm text-muted-foreground">الهدف</p>
                    <p className="text-2xl font-bold text-emerald-600">
                      {analysisData.analysis.recommendation.target_price}
                    </p>
                  </div>
                  <div className="text-center p-4 bg-blue-50 dark:bg-teal-900/20 rounded-lg">
                    <p className="text-sm text-muted-foreground">مخاطرة/عائد</p>
                    <p className="text-2xl font-bold text-teal-600">
                      {analysisData.analysis.recommendation.risk_reward_ratio}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Share Buttons */}
            <ShareButtons data={analysisData} />
          </TabsContent>

          {/* Technical Analysis Tab */}
          <TabsContent value="technical" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* RSI */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">RSI - مؤشر القوة النسبية</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-3xl font-bold">
                      {analysisData.analysis.indicators.rsi.value?.toFixed(1) || 'N/A'}
                    </span>
                    <Badge variant={
                      analysisData.analysis.indicators.rsi.signal === 'OVERSOLD' ? 'default' :
                      analysisData.analysis.indicators.rsi.signal === 'OVERBOUGHT' ? 'destructive' : 'secondary'
                    }>
                      {analysisData.analysis.indicators.rsi.signal === 'OVERSOLD' ? 'تشبع بيعي' :
                       analysisData.analysis.indicators.rsi.signal === 'OVERBOUGHT' ? 'تشبع شرائي' : 'محايد'}
                    </Badge>
                  </div>
                  <div className="h-4 bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 rounded-full relative">
                    <div 
                      className="absolute w-3 h-6 bg-black rounded -top-1"
                      style={{ 
                        left: `${Math.min(Math.max((analysisData.analysis.indicators.rsi.value || 50), 0), 100)}%`,
                        transform: 'translateX(-50%)'
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-2">
                    <span>0 (تشبع بيعي)</span>
                    <span>50</span>
                    <span>100 (تشبع شرائي)</span>
                  </div>
                </CardContent>
              </Card>

              {/* MACD */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">MACD - تقارب وتباعد المتوسطات</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between mb-4">
                    <Badge variant={analysisData.analysis.indicators.macd.trend === 'BULLISH' ? 'default' : 'destructive'}>
                      {analysisData.analysis.indicators.macd.trend === 'BULLISH' ? 'صاعد' : 'هابط'}
                    </Badge>
                    <span className="text-lg font-bold">
                      Histogram: {analysisData.analysis.indicators.macd.histogram?.toFixed(4) || 'N/A'}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {analysisData.analysis.indicators.macd.trend === 'BULLISH' ? (
                      <p className="text-green-600 flex items-center gap-1">
                        <TrendingUp className="w-4 h-4" />
                        خط MACD أعلى من خط الإشارة - زخم صاعد
                      </p>
                    ) : (
                      <p className="text-red-600 flex items-center gap-1">
                        <TrendingDown className="w-4 h-4" />
                        خط MACD أسفل من خط الإشارة - زخم هابط
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Bollinger Bands */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">نطاقات بولينجر</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">النطاق العلوي</span>
                      <span className="font-bold text-red-600">
                        {analysisData.analysis.indicators.bollinger.upper?.toFixed(2) || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">المتوسط</span>
                      <span className="font-bold text-teal-600">
                        {analysisData.analysis.indicators.bollinger.middle?.toFixed(2) || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">النطاق السفلي</span>
                      <span className="font-bold text-green-600">
                        {analysisData.analysis.indicators.bollinger.lower?.toFixed(2) || 'N/A'}
                      </span>
                    </div>
                    <Separator />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">موقع السعر</span>
                      <span className="font-bold">
                        {((analysisData.analysis.indicators.bollinger.position || 0) * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Moving Averages */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">المتوسطات المتحركة</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">SMA 20</span>
                      <span className="font-bold">
                        {analysisData.analysis.indicators.sma_20?.toFixed(2) || 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">SMA 50</span>
                      <span className="font-bold">
                        {analysisData.analysis.indicators.sma_50?.toFixed(2) || 'N/A'}
                      </span>
                    </div>
                    <Separator />
                    <div className="text-sm">
                      {analysisData.analysis.indicators.sma_20 > analysisData.analysis.indicators.sma_50 ? (
                        <p className="text-green-600 flex items-center gap-1">
                          <ArrowUpRight className="w-4 h-4" />
                          SMA 20 {'>'} SMA 50 - اتجاه صاعد
                        </p>
                      ) : (
                        <p className="text-red-600 flex items-center gap-1">
                          <ArrowDownRight className="w-4 h-4" />
                          SMA 20 {'<'} SMA 50 - اتجاه هابط
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Patterns Detected */}
            {analysisData.analysis.patterns.detected.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">الأنماط السعرية المكتشفة</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {analysisData.analysis.patterns.detected.map((pattern, i) => (
                      <Badge 
                        key={i}
                        variant={pattern.type === 'bullish' ? 'default' : 'destructive'}
                        className="text-sm"
                      >
                        {pattern.name_ar}
                        {pattern.type === 'bullish' ? ' ↑' : ' ↓'}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Equations Tab */}
          <TabsContent value="equations">
            <IndicatorEquations />
          </TabsContent>

          {/* Charts Tab */}
          <TabsContent value="charts" className="space-y-4">
            <CandlestickChart data={candleData} />
            
            <SupportResistanceChart
              support={analysisData.analysis.price_levels.support_1}
              resistance={analysisData.analysis.price_levels.resistance_1}
              currentPrice={analysisData.stock.current_price}
              pivot={analysisData.analysis.price_levels.pivot}
            />
          </TabsContent>

          {/* Report Tab */}
          <TabsContent value="report" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Info className="w-5 h-5 text-teal-600" />
                  تقرير التحليل المتكامل
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Summary */}
                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <h4 className="font-bold mb-2">ملخص التحليل</h4>
                  <p className="text-sm leading-relaxed">
                    بناءً على التحليل الفني الشامل لسهم <strong>{analysisData.ticker}</strong> ({analysisData.stock.name_ar || analysisData.stock.name})،
                    يوصي النظام بـ <strong>{analysisData.analysis.recommendation.action_ar}</strong> بدرجة ثقة{' '}
                    <strong>{(analysisData.analysis.recommendation.confidence * 100).toFixed(0)}%</strong>.
                  </p>
                  <p className="text-sm leading-relaxed mt-2">
                    الدرجة الإجمالية <strong>{analysisData.analysis.scores.composite.toFixed(0)}/100</strong> تعتمد على:
                  </p>
                  <ul className="text-sm mr-4 mt-2 space-y-1">
                    <li>• التحليل الفني: {analysisData.analysis.scores.technical.toFixed(0)}%</li>
                    <li>• تقييم القيمة: {analysisData.analysis.scores.value.toFixed(0)}%</li>
                    <li>• جودة الشركة: {analysisData.analysis.scores.quality.toFixed(0)}%</li>
                    <li>• الزخم: {analysisData.analysis.scores.momentum.toFixed(0)}%</li>
                    <li>• تقييم المخاطر: {analysisData.analysis.scores.risk.toFixed(0)}%</li>
                  </ul>
                </div>

                {/* Technical Summary */}
                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <h4 className="font-bold mb-2">التحليل الفني</h4>
                  <p className="text-sm leading-relaxed">
                    <strong>الاتجاه:</strong> {analysisData.analysis.trend.direction_ar}
                  </p>
                  <p className="text-sm leading-relaxed mt-2">
                    <strong>RSI ({analysisData.analysis.indicators.rsi.value?.toFixed(1) || 'N/A'}):</strong>{' '}
                    {analysisData.analysis.indicators.rsi.signal === 'OVERSOLD' 
                      ? 'السهم في منطقة التشبع البيعي مما قد يشير إلى فرصة شراء محتملة.'
                      : analysisData.analysis.indicators.rsi.signal === 'OVERBOUGHT'
                      ? 'السهم في منطقة التشبع الشرائي مما قد يشير إلى فرصة بيع محتملة.'
                      : 'السهم في منطقة محايدة.'}
                  </p>
                  <p className="text-sm leading-relaxed mt-2">
                    <strong>MACD:</strong>{' '}
                    {analysisData.analysis.indicators.macd.trend === 'BULLISH'
                      ? 'خط MACD أعلى من خط الإشارة، مما يدعم الاتجاه الصاعد.'
                      : 'خط MACD أسفل خط الإشارة، مما يشير إلى ضعف في الزخم.'}
                  </p>
                </div>

                {/* Risk Summary */}
                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <h4 className="font-bold mb-2 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-amber-600" />
                    تقييم المخاطر
                  </h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">أقصى تراجع:</span>
                      <span className="font-bold mr-2">
                        {analysisData.analysis.risk_metrics.max_drawdown_percent?.toFixed(1) || 'N/A'}%
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">التذبذب السنوي:</span>
                      <span className="font-bold mr-2">
                        {analysisData.analysis.risk_metrics.volatility_annualized?.toFixed(1) || 'N/A'}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Disclaimer */}
                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                  <h4 className="font-bold text-yellow-700 dark:text-yellow-400 mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    إخلاء المسؤولية
                  </h4>
                  <p className="text-sm text-yellow-700 dark:text-yellow-400">
                    ⚠️ إخلاء مسؤولية: هذا التحليل رأي آلي تعليمي وليس توصية استثمارية. القرار مسؤولية العميل.
                    قرارات الاستثمار يجب أن تبنى على تقييمك الشخصي ومشورة مستشار مالي محترف.
                    الأداء السابق لا يضمن النتائج المستقبلية.
                  </p>
                </div>

                {/* Share Buttons */}
                <ShareButtons data={analysisData} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Empty State */}
      {!analysisData && !loading && !error && (
        <Card className="p-6 sm:p-8 text-center">
          <Activity className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-base sm:text-xl font-semibold mb-2">اختر رمز السهم للبدء</h3>
          <p className="text-muted-foreground text-xs sm:text-sm">
            حدد سهماً من القائمة المنسدلة أعلاه للحصول على تحليل متكامل
          </p>
        </Card>
      )}
        </TabsContent>

        {/* ════ Tab 2 + Tab 3 REMOVED 2026-09-28 per user request (ذكاء الخبير + مقارنة الشخصيات) ════ */}
      </Tabs>
    </div>
  );
}

export default SpecialistAnalysisView;
