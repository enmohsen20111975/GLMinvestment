'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import {
  TrendingUp, TrendingDown, Clock, Calendar,
  BarChart3, Target, AlertTriangle, CheckCircle,
  Activity, ArrowUpRight, ArrowDownRight, Info,
  RefreshCw, Moon, Copy, Share2, ShieldCheck, ShieldX, Crosshair, Gauge, Facebook, ArrowRight, ArrowLeft,
  Bitcoin, Zap, Download, Image as ImageIcon, FileText, Camera, Loader2, X, Layers, Send
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { Radio, Radar } from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { cn, getRRVerdict, getStockRiskAlert, safeToFixed, verdictStyle, computeRR, rrColor, scoreColor, fmtPrice, formatNumber } from '@/lib/utils';
import { useAppStore, MARKET_NAMES_AR, MARKET_CURRENCY_LABEL, MarketType } from '@/lib/store';
import { useAnalysisStore } from '@/lib/analysis-store';
import { toast } from 'sonner';
import { OFFICIAL_LINKS_BLOCK, OFFICIAL_LINKS } from '@/modules/publishing/lib/official-links';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog';

import { isBuySignalLabel, isSellSignalLabel } from '@/lib/signal-utils';
import { PersonaImageCard, PersonaPick } from '@/components/market/PersonaImageCard';
import { ExpertPredictionsImageCard } from '@/components/market/ExpertPredictionsImageCard';
import { PredictionsImageCard } from '@/components/market/PredictionsImageCard';
import { ImageCardExport } from '@/components/market/ImageCardExport';
import { MarketStatusExport } from '@/components/market/MarketStatusExport';
import { MarketSelector } from '@/components/shared/MarketSelector';
import { RefreshAnalyticsButton } from '@/components/recommendations/RefreshAnalyticsButton';
import { ExpertRecommendationsPanel } from '@/modules/market-analysis/components/ExpertRecommendationsPanel';
import { ExpertIntelligencePanel } from '@/components/shared/ExpertIntelligencePanel';
import { DailyPicksPoster } from '@/components/daily-picks/DailyPicksPoster';
import type {
  StockData,
  LifecycleStatus,
  StatusBadgeStyle,
  PreviousPrediction,
  PersonaData,
  AnalysisJson,
  StoredAnalysisItem,
  NameMap,
  CryptoPrediction,
  CryptoPredictionsResponse,
  SectorTrackingStock,
  SectorTrackingEntry,
  SectorTrackingResponse,
  SectorSortField,
  SectorStockSortField,
  MorningBellStock,
  PredictionRow,
} from './types';
import {
  pickValidPrice,
  getStatusBadge,
  pnlColorClass,
  formatPnl,
  formatChangePct,
  formatDateShort,
  mapPredictionToStockData,
  MARKET_CODES,
  isMarketClosedNow,
  getNextTradingDay,
  formatDateLabel,
  formatAllPredictionsText,
  formatSinglePredictionText,
  formatSinglePersonaPickText,
  formatAllPersonaPicksText,
  formatComprehensiveStockText,
  formatSingleExpertPredictionText,
  formatAllExpertPredictionsText,
  isTraderPrediction,
  evalPrediction,
  buildNameMap,
  enrichItems,
  pickPersonaMix,
  pickPersonaDiverged,
  getVerdictColor,
  getScoreColor,
  PERSONA_DISPLAY_LIMIT,
  PERSONA_PAGE_SIZE,
  usdCurrencyFmt,
  arDateTimeFmt,
  cryptoSignalStyle,
  cryptoSignalLabelAr,
  cryptoSymbolMeta,
  HEAT_LEVEL_STYLE,
  formatVolumeShort,
  formatEGPShort,
  avgChangeHeatClass,
  stockChangeHeatClass,
  _isEgxIntradayNow,
} from './helpers';


function OpenTableView({ stocks }: { stocks: StockData[] }) {
  return (
    <div className="rounded-md border overflow-x-auto bg-card">
      <table className="w-full text-sm min-w-[850px]">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <th className="p-2 text-center font-medium w-10">#</th>
            <th className="p-2 text-right font-medium">الرمز</th>
            <th className="p-2 text-right font-medium">الاسم</th>
            <th className="p-2 text-center font-medium text-primary">السعر وقت التحليل</th>
            <th className="p-2 text-center font-medium">أعلى / أقل سعر</th>
            <th className="p-2 text-center font-medium">الإشارة</th>
            <th className="p-2 text-center font-medium">الدخول</th>
            <th className="p-2 text-center font-medium">الهدف</th>
            <th className="p-2 text-center font-medium">الوقف</th>
            <th className="p-2 text-center font-medium">الثقة</th>
            <th className="p-2 text-center font-medium">RSI</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((stock, idx) => {
            // FRONTEND-026: شامل لكل إشارات البيع (REDUCE, WEAK_SELL, ...) والشراء (ACCUMULATE, ...)
            const isUp = isBuySignalLabel(stock.signal);
            const isDown = isSellSignalLabel(stock.signal);
            const signalColor = isUp ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' : isDown ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400' : 'bg-muted text-muted-foreground';
            const curPrice = pickValidPrice(stock.current_price, stock.close, stock.entry_price);
            const highPrice = pickValidPrice(stock.high_price, stock.high_52w, stock.resistance);
            const lowPrice = pickValidPrice(stock.low_price, stock.low_52w, stock.support);
            return (
              <tr key={stock.id || idx} className="border-t border-border hover:bg-muted/40 transition-colors">
                <td className="p-2 text-center font-mono text-xs">{idx + 1}</td>
                <td className="p-2 font-bold text-xs">{stock.ticker}</td>
                <td className="p-2 text-xs text-muted-foreground">{stock.name_ar || stock.name || stock.ticker}</td>
                <td className="p-2 text-center font-mono text-xs font-bold text-primary">{curPrice ? (curPrice ?? 0).toFixed(2) : '—'}</td>
                <td className="p-2 text-center font-mono text-xs whitespace-nowrap">
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">▲ {highPrice ? (highPrice ?? 0).toFixed(2) : '—'}</span>
                  <span className="text-muted-foreground mx-1">/</span>
                  <span className="text-rose-600 dark:text-rose-400 font-semibold">▼ {lowPrice ? (lowPrice ?? 0).toFixed(2) : '—'}</span>
                </td>
                <td className="p-2 text-center">
                  <div className="flex items-center justify-center gap-1 flex-wrap">
                    <Badge className={cn("text-xs font-bold border-0", signalColor)}>
                      {stock.signal_ar || 'متابعة'}
                    </Badge>
                    {stock.delay_compensation_applied && (
                      <Badge
                        className="text-[10px] font-semibold border-0 cursor-help bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900 transition-colors"
                        title="بسبب تأخر بيانات السوق 5 دقائق، تم توسيع الهدف وتضييق وقف الخسارة لحماية صفقتك. ينصح بالتنفيذ عند ارتداد السعر للدعم وليس عند صعوده السريع."
                        onClick={() => toast.info('⚠️ تعويض تأخير البيانات', {
                          description: 'بسبب تأخر بيانات السوق 5 دقائق، تم توسيع الهدف (+5%) وتضييق وقف الخسارة (-15%) لحماية صفقتك. ينصح بالتنفيذ عند ارتداد السعر للدعم وليس عند صعوده السريع.',
                          duration: 6000,
                        })}
                      >
                        ⚠️ تعويض تأخير
                      </Badge>
                    )}
                    {stock.ath_breakout && (
                      <Badge
                        className="text-[10px] font-semibold border-0 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                        title="🏆 اختراق تاريخي (All-Time High) — فرصة استثنائية مسموح لها بتجاوز بوابات القناص."
                      >
                        🏆 اختراق تاريخي
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="p-2 text-center font-mono text-xs">{stock.entry_price ? (stock.entry_price ?? 0).toFixed(2) : '—'}</td>
                <td className="p-2 text-center font-mono text-xs text-emerald-600 dark:text-emerald-400">{stock.target_price ? (stock.target_price ?? 0).toFixed(2) : '—'}</td>
                <td className="p-2 text-center font-mono text-xs text-rose-600 dark:text-rose-400">{stock.stop_loss ? (stock.stop_loss ?? 0).toFixed(2) : '—'}</td>
                <td className="p-2 text-center font-mono text-xs">{stock.confidence !== undefined ? `${(stock.confidence ?? 0).toFixed(0)}%` : '—'}</td>
                <td className="p-2 text-center font-mono text-xs">{stock.rsi !== undefined ? (stock.rsi ?? 0).toFixed(0) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MarketStatusTab({ market }: { market: MarketType }) {
  const currencyLabel = MARKET_CURRENCY_LABEL[market] || 'ج.م';
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState('');
  const [now, setNow] = useState<Date>(new Date());
  // 🔥 P14 (أغسطس 2026): polling متوقف افتراضياً. كان true → كان بيحمّل الـ backend
  // كل 5 دقايق بـ 6 طلبات متوازية. دلوقتي false، والمستخدم يفعّله يدوياً بزر "مباشر".
  // الـ state ده متزامن مع useAnalysisStore.liveMode عشان كل الـ tabs تحترمه.
  const [autoRefresh, setAutoRefreshState] = useState(false);
  const setAutoRefresh = (v: boolean | ((prev: boolean) => boolean)) => {
    setAutoRefreshState((prev) => {
      const next = typeof v === 'function' ? (v as (p: boolean) => boolean)(prev) : v;
      useAnalysisStore.getState().setLiveMode(next);
      return next;
    });
  };
  // RECOMMENDATIONS-FIX-022 (يوليو 2026): state جديد للمؤشرات + ملخص السوق
  // من /api/market/status (بيرجع indices + summary + most_active من الـ backend).
  const [indices, setIndices] = useState<Array<{
    symbol: string;
    name?: string;
    current_value?: number | null;
    previous_close?: number | null;
    change?: number | null;
    change_percent?: number | null;
    last_update?: string;
  }>>([]);
  const [marketSummary, setMarketSummary] = useState<{
    total_stocks?: number;
    gainers?: number;
    losers?: number;
    unchanged?: number;
    market_breadth?: number;
  }>({});

  const CACHE_TTL = 300000;

  // RECOMMENDATIONS-FIX-022: fetch indices + summary من /api/market/status
  // (بيرجع EGX30, EGX50, EGX70, EGX100, EGX33 + counts من market_indices table).
  // ملاحظة: Next.js /api/market/status بـ proxy لـ /api/market-pulse فالبيانات
  // بتيجي ملفوفة في `data` object. بنعالج الحالتين (top-level OR data-wrapped).
  const fetchMarketStatus = useCallback(async () => {
    try {
      const marketCode = MARKET_CODES[market] === 'KSA' ? 'TADAWUL' : MARKET_CODES[market];
      const res = await fetch(`/api/market/status?market=${marketCode}&limit=10`, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        // data-wrapped (market-pulse) OR top-level (Flask blueprint)
        const payload = json.data && typeof json.data === 'object' ? json.data : json;
        const indicesArr = Array.isArray(payload.indices) ? payload.indices : Array.isArray(json.indices) ? json.indices : [];
        const summaryObj = payload.summary || json.summary || {};
        setIndices(indicesArr);
        setMarketSummary(summaryObj);
      }
    } catch (err) {
      // تجاهل — المؤشرات ليست critical للـ tab
      console.warn('[MarketStatusTab] indices fetch failed', err);
    }
  }, [market]);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const marketCode = MARKET_CODES[market];
      const cache = useAnalysisStore.getState();
      if (cache.stocks && cache.market === marketCode && Date.now() - cache.lastFetched < CACHE_TTL) {
        setStocks(cache.stocks);
        setLastUpdate(new Date().toLocaleString('ar-EG'));
        if (!silent) setLoading(false);
        return;
      }
      // Fetch stocks + market status (indices) in parallel
      const [stocksRes] = await Promise.all([
        fetch(`/api/stocks?market=${marketCode}&limit=500`, { cache: 'no-store' }).then(r => r).catch(() => null),
        fetchMarketStatus(),
      ]);
      if (stocksRes && stocksRes.ok) {
        const data = await stocksRes.json();
        const stocksList = data.stocks || [];
        setStocks(stocksList);
        setLastUpdate(new Date().toLocaleString('ar-EG'));
      } else {
        setError('فشل في تحميل البيانات');
      }
    } catch (err) {
      setError('فشل في الاتصال بالخادم');
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [market, fetchMarketStatus]);

  useEffect(() => {
    const marketCode = MARKET_CODES[market];
    const cache = useAnalysisStore.getState();
    if (cache.stocks && cache.market === marketCode && Date.now() - cache.lastFetched < CACHE_TTL) {
      setStocks(cache.stocks);
      setLastUpdate(new Date().toLocaleString('ar-EG'));
      setLoading(false);
    } else {
      fetchData();
    }
  }, [market, fetchData]);

  // ساعة حية — تحديث كل ثانية لعرض الوقت الفعلي
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // تحديث مستمر للبيانات كل 5 دقايق (مع إمكانية الإيقاف)
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => { fetchData(true); }, 300_000);
    return () => clearInterval(t);
  }, [autoRefresh, fetchData]);

  // حساب إحصائيات الأسبوع من البيانات الحقيقية
  const weekStats = React.useMemo(() => {
    if (stocks.length === 0) {
      return {
        gainers: 0,
        losers: 0,
        unchanged: 0,
        topGainers: [] as StockData[],
        topLosers: [] as StockData[],
        avgChange: 0,
        mostActive: [] as StockData[],
        topByPrice: [] as StockData[],
        sectors: {} as Record<string, number>,
        totalStocks: 0,
        avgPrice: 0,
      };
    }

    const gainers = stocks.filter(s => (s.change_percent || 0) > 0);
    const losers = stocks.filter(s => (s.change_percent || 0) < 0);
    const unchanged = stocks.filter(s => (s.change_percent || 0) === 0);

    const topGainers = [...stocks]
      .filter(s => (s.change_percent || 0) > 0)
      .sort((a, b) => (b.change_percent || 0) - (a.change_percent || 0))
      .slice(0, 5);

    const topLosers = [...stocks]
      .filter(s => (s.change_percent || 0) < 0)
      .sort((a, b) => (a.change_percent || 0) - (b.change_percent || 0))
      .slice(0, 5);

    // Most active by volume
    const mostActive = [...stocks]
      .filter(s => s.volume && s.volume !== '0' && s.volume !== '-')
      .sort((a, b) => {
        const volA = parseFloat(String(a.volume || '0').replace(/[^\d.]/g, '')) || 0;
        const volB = parseFloat(String(b.volume || '0').replace(/[^\d.]/g, '')) || 0;
        return volB - volA;
      })
      .slice(0, 5);

    // Top by price
    const topByPrice = [...stocks]
      .filter(s => (s.current_price || 0) > 0)
      .sort((a, b) => (b.current_price || 0) - (a.current_price || 0))
      .slice(0, 5);

    // Sector distribution
    const sectors: Record<string, number> = {};
    stocks.forEach(s => {
      if (s.sector) {
        sectors[s.sector] = (sectors[s.sector] || 0) + 1;
      }
    });

    const totalChange = stocks.reduce((sum, s) => sum + (s.change_percent || 0), 0);
    const avgChange = stocks.length > 0 ? totalChange / stocks.length : 0;
    const avgPrice = stocks.length > 0 
      ? stocks.reduce((sum, s) => sum + (s.current_price || 0), 0) / stocks.length 
      : 0;

    return {
      gainers: gainers.length,
      losers: losers.length,
      unchanged: unchanged.length,
      topGainers,
      topLosers,
      mostActive,
      topByPrice,
      sectors,
      avgChange,
      totalStocks: stocks.length,
      avgPrice,
    };
  }, [stocks]);

  // وصف تفصيلي لحالة السوق (وصف للى حصل ولى بيحصل) — يوليو 2026
  const marketNarrative = React.useMemo(() => {
    if (stocks.length === 0) return '';
    const gainers = weekStats.gainers;
    const losers = weekStats.losers;
    const unchanged = weekStats.unchanged;
    const breadth = gainers > losers ? 'صاعد' : gainers < losers ? 'هابط' : 'متعادل';
    const breadthEmoji = gainers > losers ? '🟢' : gainers < losers ? '🔴' : '🟡';
    const topGainer = weekStats.topGainers[0];
    const topLoser = weekStats.topLosers[0];
    const mostActive = weekStats.mostActive[0];
    const topSector = Object.entries(weekStats.sectors).sort((a, b) => b[1] - a[1])[0];

    const parts: string[] = [];
    parts.push(
      `أغلق سوق ${MARKET_NAMES_AR[market]} جلسة اليوم في حالة ${breadthEmoji} ${breadth}، حيث سجّل ${gainers} سهم ارتفاعاً مقابل ${losers} سهم انخفضت، بينما استقر ${unchanged} سهم على بلا تغيّر.`
    );
    parts.push(
      `متوسط التغير العام بلغ ${weekStats.avgChange >= 0 ? '+' : ''}${(weekStats.avgChange ?? 0).toFixed(2)}%، ومتوسط سعر الأسهم ${(weekStats.avgPrice ?? 0).toFixed(2)} ج.م عبر ${weekStats.totalStocks} سهم متداول.`
    );
    if (topGainer) {
      parts.push(
        `تصدّر قائمة الرابحين سهم ${topGainer.ticker}${topGainer.name_ar ? ` (${topGainer.name_ar})` : ''} بنسبة +${(topGainer.change_percent || 0).toFixed(2)}%.`
      );
    }
    if (topLoser) {
      parts.push(
        `وجاء سهم ${topLoser.ticker}${topLoser.name_ar ? ` (${topLoser.name_ar})` : ''} على رأس الخاسرين بنسبة ${(topLoser.change_percent || 0).toFixed(2)}%.`
      );
    }
    if (mostActive && mostActive.volume) {
      parts.push(`وسجّل سهم ${mostActive.ticker} الأعلى نشاطاً من حيث حجم التداول (${mostActive.volume}).`);
    }
    if (topSector) {
      parts.push(`وكان قطاع «${topSector[0]}» الأكثر تمثيلاً بعدد ${topSector[1]} سهم.`);
    }
    const advDec = losers > 0 ? (gainers / losers).toFixed(2) : '∞';
    parts.push(`نسبة الأسهم الرابحة إلى الخاسرة بلغت ${advDec}، ما يعكس ${breadth === 'صاعد' ? 'سيطرة للشراء' : breadth === 'هابط' ? 'ضغطاً بيعياً' : 'حالة تذبذب عرضي'}.`);
    return parts.join(' ');
  }, [stocks, weekStats, market]);

  // تحديد حالة السوق
  const getMarketStatus = () => {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0=الأحد, 6=السبت

    // السوق المصري: الأحد-الخميس، 10:00-14:30 بتوقيت مصر
    const isWorkDay = day >= 0 && day <= 4; // الأحد للخميس
    const isMarketHours = hour >= 10 && hour < 15;

    if (isWorkDay && isMarketHours) {
      return { isOpen: true, status: '🟢 مفتوح', message: 'جاري التداول' };
    } else if (isWorkDay && hour < 10) {
      return { isOpen: false, status: '🔴 مغلق', message: `يفتح الساعة 10:00 ص` };
    } else if (isWorkDay && hour >= 15) {
      return { isOpen: false, status: '🔴 مغلق', message: 'انتهى التداول اليوم' };
    } else {
      return { isOpen: false, status: '🔴 مغلق', message: `يفتح يوم الأحد` };
    }
  };

  const marketStatus = getMarketStatus();

  // 📊 إحصائيات إضافية للـ Telegram post (يوليو 2026)
  // المستخدم طلب بيانات أكتر في caption للـ Telegram
  const telegramCaption = React.useMemo(() => {
    if (stocks.length === 0) return '';
    const gainers = stocks.filter(s => (s.change_percent || 0) > 0).length;
    const losers = stocks.filter(s => (s.change_percent || 0) < 0).length;
    const unchanged = stocks.length - gainers - losers;
    const advDecRatio = losers > 0 ? (gainers / losers).toFixed(2) : '∞';
    const breadth = gainers > losers ? '🟢 صاعد' : gainers < losers ? '🔴 هابط' : '🟡 متوازن';

    const topGainer = weekStats.topGainers[0];
    const topLoser = weekStats.topLosers[0];
    const mostActive = weekStats.mostActive[0];

    const lines = [
      `📊 حالة السوق — ${MARKET_NAMES_AR[market]}`,
      `📅 ${new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
      ``,
      `${marketStatus.status} ${marketStatus.message}`,
      ``,
      `📈 إحصائيات السوق:`,
      `• الأسهم الرابحة: ${gainers} 🟢`,
      `• الأسهم الخاسرة: ${losers} 🔴`,
      `• لم يتغير: ${unchanged} ⚪`,
      `• نسبة الصعود/الهبوط: ${advDecRatio}`,
      `• الاتجاه العام: ${breadth}`,
      `• متوسط التغير: ${weekStats.avgChange >= 0 ? '+' : ''}${(weekStats.avgChange ?? 0).toFixed(2)}%`,
      ``,
    ];

    if (topGainer) {
      lines.push(`🏆 أعلى رابح: ${topGainer.ticker} (+${(topGainer.change_percent || 0).toFixed(2)}%)`);
    }
    if (topLoser) {
      lines.push(`📉 أعلى خاسر: ${topLoser.ticker} (${(topLoser.change_percent || 0).toFixed(2)}%)`);
    }
    if (mostActive) {
      lines.push(`🔥 الأكثر نشاطاً: ${mostActive.ticker} (حجم: ${mostActive.volume || '-'})`);
    }

    lines.push(``);
    lines.push(`منصة دليل الاستثمار | invist.m2y.net`);

    return lines.join('\n');
  }, [stocks, marketStatus, weekStats, market]);

  //Expose caption globally for MarketStatusExport to pick up
  React.useEffect(() => {
    if (typeof window !== 'undefined' && telegramCaption) {
      (window as any).__marketStatusCaption = telegramCaption;
    }
  }, [telegramCaption]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-4 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
          <p className="text-destructive mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 ml-2" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  // FIX-RECOMMENDATIONS (يوليو 2026): لو الـ stocks فاضية بعد انتهاء التحميل،
  // اعرض رسالة "جاري تحميل البيانات" بدل عرض كل الإحصائيات بأصفار مضللة.
  if (!loading && stocks.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <span className="text-4xl mb-3 block">⏳</span>
          <p className="text-lg font-semibold mb-1">جاري تحميل البيانات</p>
          <p className="text-sm text-muted-foreground mb-4">
            بنحضّر بيانات سوق {MARKET_NAMES_AR[market]} — حاول مرة تانية بعد ثواني.
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => fetchData()}>
              <RefreshCw className="h-4 w-4 ml-2" />
              تحديث الآن
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAutoRefresh(v => !v)}
            >
              {autoRefresh ? 'إيقاف التحديث التلقائي' : 'تشغيل التحديث التلقائي'}
            </Button>
          </div>
          {lastUpdate && (
            <p className="text-xs text-muted-foreground mt-3">
              آخر تحديث: {lastUpdate}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Feature 5 — Market Status Image (download / publish to Telegram) */}
      <MarketStatusExport />

      {/* وصف تفصيلي لحالة السوق (لى حصل ولى بيحصل) — يوليو 2026 */}
      {stocks.length > 0 && marketNarrative && (
        <Card className="border-teal-200 dark:border-teal-900 bg-blue-50/40 dark:bg-blue-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Radio className="h-4 w-4 text-teal-600" />
              التقرير اليومي للسوق
            </CardTitle>
            <CardDescription>
              وصف تفصيلي لحركة السوق — آخر تحديث: {lastUpdate || now.toLocaleString('ar-EG')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-foreground/90">{marketNarrative}</p>
          </CardContent>
        </Card>
      )}

      {/* الرسوم البيانية لحالة السوق — يوليو 2026 */}
      {stocks.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {/* اتساع السوق (Breadth) — Donut */}
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm flex items-center gap-2">
                <PieChart className="h-4 w-4 text-emerald-600" />
                اتساع السوق (Breadth)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'رابح', value: weekStats.gainers, color: '#22c55e' },
                      { name: 'خاسر', value: weekStats.losers, color: '#ef4444' },
                      { name: 'بلا تغيير', value: weekStats.unchanged, color: '#9ca3af' },
                    ]}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    label
                  >
                    {[
                      { name: 'رابح', value: weekStats.gainers, color: '#22c55e' },
                      { name: 'خاسر', value: weekStats.losers, color: '#ef4444' },
                      { name: 'بلا تغيير', value: weekStats.unchanged, color: '#9ca3af' },
                    ].map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* أبرز الرابحين والخاسرين — Bar */}
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-teal-600" />
                أبرز الرابحين والخاسرين
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={[
                    ...weekStats.topGainers.map((s) => ({ name: s.ticker, value: Number((s.change_percent || 0).toFixed(2)), fill: '#22c55e' })),
                    ...weekStats.topLosers.map((s) => ({ name: s.ticker, value: Number((s.change_percent || 0).toFixed(2)), fill: '#ef4444' })),
                  ]}
                  margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v: number) => `${v}%`} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {[
                      ...weekStats.topGainers.map((s, i) => <Cell key={`g${i}`} fill="#22c55e" />),
                      ...weekStats.topLosers.map((s, i) => <Cell key={`l${i}`} fill="#ef4444" />),
                    ]}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* توزيع القطاعات — Horizontal Bar */}
          <Card className="md:col-span-2">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-amber-600" />
                توزيع القطاعات (عدد الأسهم)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={Math.max(160, Object.keys(weekStats.sectors).length * 26)}>
                <BarChart
                  layout="vertical"
                  data={Object.entries(weekStats.sectors)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 8)
                    .map(([sector, count]) => ({ name: sector, value: count }))}
                  margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Market Status Card */}
      <Card className={cn(
        "border-2",
        marketStatus.isOpen ? "border-green-500 bg-green-50 dark:bg-green-950" : "border-red-500 bg-red-50 dark:bg-red-950"
      )}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className={cn(
                "h-5 w-5",
                marketStatus.isOpen ? "text-green-600" : "text-red-600"
              )} />
              {MARKET_NAMES_AR[market]}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge
                variant={autoRefresh ? "default" : "outline"}
                className={cn("text-xs gap-1", autoRefresh ? "bg-emerald-600 hover:bg-emerald-700" : "")}
                onClick={() => setAutoRefresh(v => !v)}
                role="button"
              >
                <span className={cn("relative flex h-2 w-2 rounded-full", autoRefresh ? "bg-white" : "bg-muted-foreground")}>
                  {autoRefresh && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                  )}
                </span>
                {autoRefresh ? 'مباشر' : 'متوقف'}
              </Badge>
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => fetchData()} title="تحديث الآن">
                <RefreshCw className={cn("h-4 w-4", loading ? "animate-spin" : "")} />
              </Button>
              <Badge variant={marketStatus.isOpen ? "default" : "destructive"} className="text-sm">
                {marketStatus.status}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">الوقت الحالي</span>
              <p className="font-bold text-lg">{now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
            </div>
            <div>
              <span className="text-muted-foreground">التاريخ</span>
              <p className="font-bold">{now.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            </div>
            <div>
              <span className="text-muted-foreground">الحالة</span>
              <p className="font-bold">{marketStatus.message}</p>
            </div>
            <div>
              <span className="text-muted-foreground">عدد الأسهم</span>
              <p className="font-bold">{stocks.length} سهم</p>
            </div>
          </div>

          {/* Market Breadth Bar (يوليو 2026) — للـ Telegram post */}
          {stocks.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center justify-between mb-2 text-sm">
                <span className="font-medium">اتساع السوق (Market Breadth)</span>
                <span className="text-muted-foreground">
                  {stocks.filter(s => (s.change_percent || 0) > 0).length} 🟢 / {' '}
                  {stocks.filter(s => (s.change_percent || 0) < 0).length} 🔴 / {' '}
                  {stocks.filter(s => (s.change_percent || 0) === 0).length} ⚪
                </span>
              </div>
              <div className="flex h-3 rounded-full overflow-hidden bg-muted">
                {(() => {
                  const gainers = stocks.filter(s => (s.change_percent || 0) > 0).length;
                  const losers = stocks.filter(s => (s.change_percent || 0) < 0).length;
                  const unchanged = stocks.length - gainers - losers;
                  const total = stocks.length || 1;
                  return (
                    <>
                      <div
                        className="bg-green-500"
                        style={{ width: `${(gainers / total) * 100}%` }}
                        title={`${gainers} رابح`}
                      />
                      <div
                        className="bg-gray-400"
                        style={{ width: `${(unchanged / total) * 100}%` }}
                        title={`${unchanged} unchanged`}
                      />
                      <div
                        className="bg-red-500"
                        style={{ width: `${(losers / total) * 100}%` }}
                        title={`${losers} خاسر`}
                      />
                    </>
                  );
                })()}
              </div>
              <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                <span>
                  نسبة الصعود/الهبوط: {
                    stocks.filter(s => (s.change_percent || 0) < 0).length > 0
                      ? (stocks.filter(s => (s.change_percent || 0) > 0).length /
                         stocks.filter(s => (s.change_percent || 0) < 0).length).toFixed(2)
                      : '∞'
                  }
                </span>
                <span>
                  الاتجاه: {
                    stocks.filter(s => (s.change_percent || 0) > 0).length >
                    stocks.filter(s => (s.change_percent || 0) < 0).length
                      ? '🟢 صاعد'
                      : stocks.filter(s => (s.change_percent || 0) > 0).length <
                        stocks.filter(s => (s.change_percent || 0) < 0).length
                      ? '🔴 هابط'
                      : '🟡 متوازن'
                  }
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* RECOMMENDATIONS-FIX-022 (يوليو 2026): مؤشرات السوق (EGX30/70/100) */}
      {indices.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              مؤشرات السوق
            </CardTitle>
            <CardDescription>
              قيم المؤشرات الرئيسية — آخر تحديث:{' '}
              {indices[0]?.last_update
                ? new Date(indices[0].last_update).toLocaleString('ar-EG')
                : lastUpdate || '—'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {indices.map((idx) => {
                const change = Number(idx.change_percent ?? 0);
                const isUp = change > 0;
                const isDown = change < 0;
                const value = Number(idx.current_value ?? 0);
                return (
                  <div
                    key={idx.symbol}
                    className={cn(
                      'p-3 rounded-lg border text-center',
                      isUp
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900'
                        : isDown
                        ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900'
                        : 'bg-muted border-border'
                    )}
                  >
                    <p className="text-xs font-bold text-muted-foreground mb-1">{idx.symbol}</p>
                    <p className="text-lg font-bold">
                      {value > 0 ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
                    </p>
                    <p
                      className={cn(
                        'text-xs font-semibold mt-1',
                        isUp
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : isDown
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-muted-foreground'
                      )}
                    >
                      {change > 0 ? '+' : ''}
                      {(change ?? 0).toFixed(2)}%
                    </p>
                  </div>
                );
              })}
            </div>
            {marketSummary && marketSummary.total_stocks != null && (
              <div className="mt-3 pt-3 border-t grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-center">
                <div>
                  <p className="text-muted-foreground">إجمالي الأسهم</p>
                  <p className="font-bold text-base">{marketSummary.total_stocks}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">الرابحة</p>
                  <p className="font-bold text-base text-emerald-600 dark:text-emerald-400">{marketSummary.gainers ?? 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">الخاسرة</p>
                  <p className="font-bold text-base text-rose-600 dark:text-rose-400">{marketSummary.losers ?? 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">لم يتغير</p>
                  <p className="font-bold text-base">{marketSummary.unchanged ?? 0}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Weekly Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            حالة السوق خلال الأسبوع
          </CardTitle>
          <CardDescription>
            آخر تحديث: {lastUpdate || new Date().toLocaleDateString('ar-EG')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 rounded-lg bg-muted">
              <p className="text-muted-foreground text-xs mb-1">متوسط التغير</p>
              <p className={cn(
                "text-xl font-bold",
                weekStats.avgChange >= 0 ? "text-green-600" : "text-red-600"
              )}>
                {weekStats.avgChange >= 0 ? '+' : ''}{(weekStats.avgChange ?? 0).toFixed(2)}%
              </p>
            </div>
            <div className="text-center p-3 rounded-lg bg-green-50 dark:bg-green-950">
              <p className="text-muted-foreground text-xs mb-1">الأسهم الرابحة</p>
              <p className="text-xl font-bold text-green-600">{weekStats.gainers}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-red-950">
              <p className="text-muted-foreground text-xs mb-1">الأسهم الخاسرة</p>
              <p className="text-xl font-bold text-red-600">{weekStats.losers}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted">
              <p className="text-muted-foreground text-xs mb-1">لم يتغير</p>
              <p className="text-xl font-bold">{weekStats.unchanged}</p>
            </div>
          </div>

          {/* Additional Stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2">
            <div className="text-center p-3 rounded-lg bg-blue-50 dark:bg-blue-950">
              <p className="text-muted-foreground text-xs mb-1">إجمالي الأسهم</p>
              <p className="text-xl font-bold text-teal-600">{weekStats.totalStocks}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-purple-50 dark:bg-purple-950">
              <p className="text-muted-foreground text-xs mb-1">متوسط السعر</p>
              {/* currencyLabel fix */}
              <p className="text-xl font-bold text-purple-600">{(weekStats.avgPrice ?? 0).toFixed(2)} {currencyLabel}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-amber-50 dark:bg-amber-950">
              <p className="text-muted-foreground text-xs mb-1">عدد القطاعات</p>
              <p className="text-xl font-bold text-amber-600">{Object.keys(weekStats.sectors).length}</p>
            </div>
          </div>

          {/* Top Gainers & Losers */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-1 text-green-600">
                <TrendingUp className="h-4 w-4" />
                أعلى الرابحين
              </h4>
              <div className="space-y-2">
                {weekStats.topGainers.length > 0 ? (
                  weekStats.topGainers.map((stock, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 rounded bg-green-50 dark:bg-green-950 cursor-pointer hover:bg-green-100 dark:hover:bg-green-900 transition-colors" onClick={() => loadStockDetail(stock.ticker)}>
                      <div className="flex items-center gap-2 min-w-0">
                        {stock.logo_url ? (
                          <img
                            src={stock.logo_url}
                            alt={stock.ticker}
                            className="w-5 h-5 rounded-full object-contain flex-shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : null}
                        <div className="min-w-0">
                          <span className="font-semibold">{stock.ticker}</span>
                          <span className="text-muted-foreground text-xs mr-2">{stock.name_ar || stock.name}</span>
                        </div>
                      </div>
                      <Badge variant="default" className="bg-green-600">
                        {formatChangePct(stock.change_percent)}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-sm p-2">لا توجد أسهم رابحة اليوم</p>
                )}
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-1 text-red-600">
                <TrendingDown className="h-4 w-4" />
                أعلى الخاسرين
              </h4>
              <div className="space-y-2">
                {weekStats.topLosers.length > 0 ? (
                  weekStats.topLosers.map((stock, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 rounded bg-red-50 dark:bg-red-950 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900 transition-colors" onClick={() => loadStockDetail(stock.ticker)}>
                      <div className="flex items-center gap-2 min-w-0">
                        {stock.logo_url ? (
                          <img
                            src={stock.logo_url}
                            alt={stock.ticker}
                            className="w-5 h-5 rounded-full object-contain flex-shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : null}
                        <div className="min-w-0">
                          <span className="font-semibold">{stock.ticker}</span>
                          <span className="text-muted-foreground text-xs mr-2">{stock.name_ar || stock.name}</span>
                        </div>
                      </div>
                      <Badge variant="destructive">
                        {formatChangePct(stock.change_percent)}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-sm p-2">لا توجد أسهم خاسرة اليوم</p>
                )}
              </div>
            </div>
          </div>

          {/* Most Active by Volume & Sector Distribution */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Most Active */}
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-1 text-teal-600">
                <Activity className="h-4 w-4" />
                الأكثر نشاطاً (حجم التداول)
              </h4>
              <div className="space-y-2">
                {weekStats.mostActive.length > 0 ? (
                  weekStats.mostActive.map((stock, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 rounded bg-blue-50 dark:bg-blue-950 cursor-pointer hover:bg-teal-100 dark:hover:bg-teal-900 transition-colors" onClick={() => loadStockDetail(stock.ticker)}>
                      <div className="flex items-center gap-2 min-w-0">
                        {stock.logo_url ? (
                          <img
                            src={stock.logo_url}
                            alt={stock.ticker}
                            className="w-5 h-5 rounded-full object-contain flex-shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : null}
                        <div className="min-w-0">
                          <span className="font-semibold">{stock.ticker}</span>
                          <span className="text-muted-foreground text-xs mr-2">{stock.name_ar || stock.name}</span>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-teal-600">
                        {stock.volume || '-'}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-sm p-2">لا توجد بيانات أحجام</p>
                )}
              </div>
            </div>

            {/* Sector Distribution */}
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-1 text-amber-600">
                <BarChart3 className="h-4 w-4" />
                توزيع القطاعات
              </h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {Object.entries(weekStats.sectors)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 8)
                  .map(([sector, count]) => (
                    <div key={sector} className="flex items-center justify-between p-2 rounded bg-amber-50 dark:bg-amber-950">
                      <span className="text-sm font-medium">{sector}</span>
                      <Badge variant="outline" className="text-amber-600">
                        {count} سهم
                      </Badge>
                    </div>
                  ))}
                {Object.keys(weekStats.sectors).length === 0 && (
                  <p className="text-muted-foreground text-sm p-2">لا توجد بيانات قطاعات</p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Predictions Tab - التحليلات
// ============================================================================

// ============================================================================
// ============================================================================
// Predictions Performance Chart - رسم بياني لمعدل الربح والخسارة بالأيام
// ============================================================================

