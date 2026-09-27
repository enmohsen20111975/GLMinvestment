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
import { OFFICIAL_LINKS_BLOCK, OFFICIAL_LINKS } from '@/lib/official-links';
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
import { ExpertRecommendationsPanel } from '@/components/analysis/ExpertRecommendationsPanel';
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


function ExpertPredictionsTableView({ stocks }: { stocks: StockData[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm min-w-[700px]">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <th className="p-2 text-center font-medium w-10">#</th>
            <th className="p-2 text-right font-medium">السهم</th>
            <th className="p-2 text-right font-medium">الكود</th>
            <th className="p-2 text-center font-medium">السعر</th>
            <th className="p-2 text-center font-medium">التغير</th>
            <th className="p-2 text-right font-medium">القطاع</th>
            <th className="p-2 text-center font-medium">الحجم</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((s, i) => (
            <tr key={s.id || i} className="border-t border-border hover:bg-muted/40 transition-colors cursor-pointer" onClick={() => loadStockDetail(s.ticker)}>
              <td className="p-2 text-center font-mono text-xs">{i + 1}</td>
              <td className="p-2 font-medium">{s.name_ar || s.name}</td>
              <td className="p-2 font-mono">{s.ticker}</td>
              <td className="p-2 text-center font-mono">{fmtNum(s.current_price)}</td>
              <td className={cn("p-2 text-center font-mono font-medium", (s.change_percent || 0) >= 0 ? "text-green-600" : "text-red-600")}>
                {(s.change_percent || 0) >= 0 ? '+' : ''}{(s.change_percent || 0).toFixed(2)}%
              </td>
              <td className="p-2 text-right">{s.sector || '—'}</td>
              <td className="p-2 text-center font-mono">{s.volume || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


export function ExpertPredictionsTab({ market }: { market: MarketType }) {
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'image' | 'cards' | 'table' | 'text'>('image');

  const CACHE_TTL = 300000;

  const fetchPredictions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // استخدام API الأسهم
      const marketCode = MARKET_CODES[market];
      const cache = useAnalysisStore.getState();
      if (cache.stocks && cache.market === marketCode && Date.now() - cache.lastFetched < CACHE_TTL) {
        const allStocks = cache.stocks;
        const sorted = allStocks
          .filter((s: StockData) => s.current_price > 0)
          .sort((a: StockData, b: StockData) => (b.current_price || 0) - (a.current_price || 0));
        setStocks(sorted);
        setLoading(false);
        return;
      }
      const res = await fetch(`/api/stocks?market=${MARKET_CODES[market]}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        const allStocks = data.stocks || [];
        // ترتيب حسب السعر
        const sorted = allStocks
          .filter((s: StockData) => s.current_price > 0)
          .sort((a: StockData, b: StockData) => (b.current_price || 0) - (a.current_price || 0));
        setStocks(sorted);
      } else {
        setError('فشل في تحميل البيانات');
      }
    } catch (err) {
      setError('فشل في الاتصال بالخادم');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    const marketCode = MARKET_CODES[market];
    const cache = useAnalysisStore.getState();
    if (cache.stocks && cache.market === marketCode && Date.now() - cache.lastFetched < CACHE_TTL) {
      const allStocks = cache.stocks;
      const sorted = allStocks
        .filter((s: StockData) => s.current_price > 0)
        .sort((a: StockData, b: StockData) => (b.current_price || 0) - (a.current_price || 0));
      setStocks(sorted);
      setLoading(false);
    } else {
      fetchPredictions();
    }
  }, [market, fetchPredictions]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-4 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
          <p className="text-destructive mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchPredictions}>
            <RefreshCw className="h-4 w-4 ml-2" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (stocks.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Info className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">لا توجد بيانات متاحة حالياً</p>
          <p className="text-sm text-muted-foreground mt-1">سيتم إضافة بيانات جديدة قريباً</p>
        </CardContent>
      </Card>
    );
  }

  const viewSelector = (
    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
      <div className="inline-flex rounded-md border border-border p-0.5 bg-muted/40">
        {([['image', 'صورة'], ['cards', 'كروت'], ['table', 'جدول'], ['text', 'نص']] as const).map(([m, l]) => (
          <button
            key={m}
            onClick={() => setViewMode(m)}
            className={cn(
              'px-3 py-1 text-xs rounded font-medium transition-colors',
              viewMode === m ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {l}
          </button>
        ))}
      </div>
      {viewMode === 'text' && stocks.length > 0 && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={() => {
            const text = formatAllExpertPredictionsText(stocks, market);
            navigator.clipboard.writeText(text);
            toast.success('تم نسخ جميع التوقعات ✓');
          }}>
            <Copy className="h-3.5 w-3.5" />
            نسخ الكل
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={async () => {
            const text = formatAllExpertPredictionsText(stocks, market);
            if (navigator.share) {
              try { await navigator.share({ title: 'توقعات الخبراء', text }); } catch {}
            } else {
              navigator.clipboard.writeText(text);
              toast.success('تم نسخ جميع التوقعات ✓');
            }
          }}>
            <Share2 className="h-3.5 w-3.5" />
            مشاركة
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {viewSelector}
      {/* بطاقة توقعات الخبراء القابلة للمشاركة (تحميل صورة / نشر تيليجرام) */}
      {viewMode === 'image' && (
      <ImageCardExport
        title="بطاقة توقعات الخبراء"
        description="حمّل صورة جاهزة للنشر أو انشرها مباشرة على قناة تيليجرام"
        filename={`expert-predictions-${MARKET_CODES[market]}`}
        telegramCaption={`🎯 توقعات الخبراء — ${MARKET_NAMES_AR[market]}\nقائمة الأسهم المراقبة — أداء اليوم\n\nمنصة دليل الاستثمار | invist.m2y.net`}
        telegramMarket={MARKET_CODES[market]}
        accentColor="#15803d"
        borderClass="border-green-200"
        bgClass="bg-gradient-to-br from-green-50 via-emerald-50 to-green-100/40"
        hasData={stocks.length > 0}
        emptyHint="لا توجد بيانات متاحة حالياً"
      >
        {(ref) => (
          <ExpertPredictionsImageCard
            ref={ref}
            market={market}
            stocks={stocks.map((s) => ({
              ticker: s.ticker,
              name: s.name,
              name_ar: s.name_ar,
              current_price: s.current_price,
              change_percent: s.change_percent,
              volume: s.volume,
              sector: s.sector,
            }))}
            lastUpdate={new Date().toLocaleTimeString('ar-EG')}
          />
        )}
      </ImageCardExport>
      )}

      {viewMode !== 'image' && (
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">قائمة الأسهم</h3>
        <Badge variant="secondary">{stocks.length} سهم</Badge>
      </div>
      )}

      {viewMode !== 'image' && (
      <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
        <Clock className="h-3 w-3" />
        مرتبة حسب السعر
      </div>
      )}
      
      {viewMode === 'cards' && (
      <ScrollArea className="h-[400px] pr-2">
        {stocks.map((stock, idx) => (
          <Card key={idx} className={cn(
            "mb-2 border-r-4 cursor-pointer hover:shadow-md transition-shadow",
            (stock.change_percent || 0) > 0 ? "border-r-green-500" : 
            (stock.change_percent || 0) < 0 ? "border-r-red-500" : "border-r-gray-500"
          )} onClick={() => loadStockDetail(stock.ticker)}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {stock.logo_url ? (
                    <img src={stock.logo_url} alt={stock.ticker} className="w-5 h-5 rounded-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : null}
                  <Badge variant={
                    (stock.change_percent || 0) > 0 ? "default" : 
                    (stock.change_percent || 0) < 0 ? "destructive" : "secondary"
                  } className="text-xs">
                    {(stock.change_percent || 0) > 0 ? '↑' : (stock.change_percent || 0) < 0 ? '↓' : '–'}
                  </Badge>
                  <span className="font-bold">{stock.ticker}</span>
                  <span className="text-muted-foreground text-sm">{stock.name_ar || stock.name}</span>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {new Date().toLocaleDateString('ar-EG')}
                </div>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">السعر:</span>
                  <p className="font-medium">{stock.current_price?.toFixed(2) || '-'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">التغير:</span>
                  <p className={cn(
                    "font-medium",
                    (stock.change_percent || 0) >= 0 ? "text-green-600" : "text-red-600"
                  )}>
                    {(stock.change_percent || 0) >= 0 ? '+' : ''}{(stock.change_percent || 0).toFixed(1)}%
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">القطاع:</span>
                  <p className="font-medium text-xs truncate">{stock.sector || '-'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">الحجم:</span>
                  <p className="font-medium text-xs">{stock.volume || '-'}</p>
                </div>
              </div>

              {/* أزرار النسخ والمشاركة */}
              <div className="flex gap-2 mt-3 pt-2 border-t border-border/50">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 h-7 text-xs flex-1"
                  onClick={() => {
                    const text = formatSingleExpertPredictionText(stock);
                    navigator.clipboard.writeText(text);
                    toast.success('تم نسخ التوقع ✓');
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  نسخ
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 h-7 text-xs flex-1"
                  onClick={async () => {
                    const text = formatSingleExpertPredictionText(stock);
                    if (navigator.share) {
                      try {
                        await navigator.share({ title: `توقعة ${stock.ticker}`, text });
                      } catch {}
                    } else {
                      navigator.clipboard.writeText(text);
                      toast.success('تم نسخ التوقع ✓');
                    }
                  }}
                >
                  <Share2 className="h-3.5 w-3.5" />
                  مشاركة
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 h-7 text-xs flex-1 border-teal-400 text-teal-600 hover:bg-blue-50 dark:hover:bg-blue-950/20"
                  onClick={() => {
                    const text = formatSingleExpertPredictionText(stock);
                    navigator.clipboard.writeText(text);
                    window.open('https://www.facebook.com/', '_blank');
                    toast.success('تم نسخ التوقع وجاري فتح فيسبوك لصق المنشور 💙');
                  }}
                >
                  <Facebook className="h-3.5 w-3.5" />
                  فيسبوك
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </ScrollArea>
      )}

      {viewMode === 'table' && (
        <ExpertPredictionsTableView stocks={stocks} />
      )}

      {viewMode === 'text' && (
        <div className="space-y-3">
          {stocks.map((stock, idx) => {
            const singleText = formatSingleExpertPredictionText(stock);
            return (
              <Card key={`txt-expert-${stock.ticker}-${idx}`} className="border border-border cursor-pointer hover:shadow-md transition-shadow" onClick={() => loadStockDetail(stock.ticker)}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold">{stock.ticker} - {stock.name_ar || stock.name}</span>
                    <div className="flex gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 h-7 text-xs"
                        onClick={() => {
                          navigator.clipboard.writeText(singleText);
                          toast.success('تم نسخ التحليل ✓');
                        }}
                      >
                        <Copy className="h-3 w-3" />
                        نسخ
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 h-7 text-xs"
                        onClick={async () => {
                          if (navigator.share) {
                            try { await navigator.share({ title: `تحليل ${stock.ticker}`, text: singleText }); } catch {}
                          } else {
                            navigator.clipboard.writeText(singleText);
                            toast.success('تم نسخ التحليل ✓');
                          }
                        }}
                      >
                        <Share2 className="h-3 w-3" />
                        مشاركة
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 h-7 text-xs border-teal-400 text-teal-600 hover:bg-blue-50 dark:hover:bg-blue-950/20"
                        onClick={() => {
                          navigator.clipboard.writeText(singleText);
                          window.open('https://www.facebook.com/', '_blank');
                          toast.success('تم نسخ التحليل وجاري فتح فيسبوك لصق المنشور 💙');
                        }}
                      >
                        <Facebook className="h-3 w-3" />
                        فيسبوك
                      </Button>
                    </div>
                  </div>
                  <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-foreground/90" dir="rtl">
                    {singleText}
                  </pre>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Persona Tab — "سهم واحد، وجهين" (المستثمر / المضارب)
// محرك التصطاد = العقل — يصطاد الفرص من السوق كله
// ============================================================================

