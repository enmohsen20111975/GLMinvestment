'use client';

/**
 * RetroactivePredictionsAdmin
 * ===========================
 * لوحة أدمن لتوليد توقعات بأثر رجعى من أول السنة لكلا البرسونتين (المستثمر + المضارب)
 * بناءً على تحليل فنى من تاريخ الأسعار، مع تحقق تلقائى من الأسعار المستقبلية.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  History, Play, Loader2, CheckCircle, XCircle, TrendingUp,
  TrendingDown, Clock, Users, Target, Trophy, RefreshCw, Info,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface GenResult {
  success: boolean;
  message?: string;
  summary?: {
    generated: number;
    verified: number;
    target_hits: number;
    stopped: number;
    tickers_processed: number;
    tickers_skipped: number;
    days_back: number;
    personas: string[];
    markets: string[];
    by_persona: Record<string, { total: number; target_hit: number; stopped: number; pending: number }>;
    by_market: Record<string, { total: number; target_hit: number; stopped: number; pending: number; tickers: number }>;
    duration_ms: number;
  };
  error?: string;
}

export function RetroactivePredictionsAdmin() {
  const [daysBack, setDaysBack] = useState(90);
  const [maxTickers, setMaxTickers] = useState(40);
  const [includeInvestor, setIncludeInvestor] = useState(true);
  const [includeGambler, setIncludeGambler] = useState(true);
  const [clearExisting, setClearExisting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);

  const handleGenerate = async () => {
    if (!includeInvestor && !includeGambler) {
      toast.error('اختر على الأقل برسونا واحدة');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const personas: string[] = [];
      if (includeInvestor) personas.push('investor');
      if (includeGambler) personas.push('gambler');
      const res = await fetch('/api/admin/retroactive-predictions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          days_back: daysBack,
          max_tickers: maxTickers,
          personas,
          clear_existing: clearExisting,
        }),
      });
      const data: GenResult = await res.json();
      setResult(data);
      if (data.success) {
        toast.success(data.message || 'تم توليد التوقعات بنجاح');
      } else {
        toast.error(data.error || 'فشل توليد التوقعات');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('خطأ: ' + msg);
      setResult({ success: false, error: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-xl bg-amber-100 dark:bg-amber-950/40">
          <History className="w-6 h-6 text-amber-600" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">مولّد التوقعات بأثر رجعى</h2>
          <p className="text-muted-foreground text-sm">
            يولّد توقعات تاريخية لكلا البرسونتين (المستثمر 🏦 + المضارب 🎲) من تاريخ الأسعار،
            مع تحقق تلقائى من الأسعار المستقبلية وحساب الأرباح/الخسائر الفعلية
          </p>
        </div>
      </div>

      {/* Info banner */}
      <Card className="border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-950/20">
        <CardContent className="p-4 flex gap-3">
          <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <p className="font-medium">كيف يعمل المحرك (يدعم كل الأسواق):</p>
            <ul className="list-disc pr-5 space-y-0.5 text-muted-foreground">
              <li>يقرأ تاريخ أسعار آخر {daysBack} يوم لأهم {maxTickers} سهم من <b>كل الأسواق المتاحة</b> (EGX، TADAWUL، KSE، QSE...)</li>
              <li>يحسب RSI(14) و MA(5) و MA(20) لكل يوم تداول لكل سهم في كل سوق</li>
              <li>يولّد إشارة BUY عند ترند صاعد (close &gt; MA20 و MA5 &gt; MA20) أو تشبع بيعي (RSI &lt; 35)</li>
              <li>يولّد إشارة SELL عند ترند هابط أو تشبع شرائي (RSI &gt; 65)</li>
              <li><b>نظام الدعم/المقاومة + V20 Fusion:</b> الهدف = المقاومة الحقيقية (1.5R) · الهدف الاستثماري = 3.0R · الوقف = تحت الدعم · R/R ≥ 1.5 (مضارب) / 2.0 (مستثمر) — الأهداف بتتحسب من الـ ATR والـ SMC Order Blocks عبر محرك الـ V20 Fusion</li>
              <li>يتحقق من كل توقع مقابل 30 يوم مستقبلية: هل ضُرِب الهدف؟ هل ضُرِب الوقف؟ (نتائج حقيقية 100%)</li>
              <li>مصدر البيانات: <code className="text-xs bg-muted px-1 rounded">data_engine.db → historical_data</code> (قلب النظام، بعمود market)، مع fallback لـ <code className="text-xs bg-muted px-1 rounded">price_history.db</code> ثم <code className="text-xs bg-muted px-1 rounded">stocks.db</code></li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Config form */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Target className="w-5 h-5" />إعدادات التوليد</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="days-back">عدد الأيام بأثر رجعى</Label>
              <Input id="days-back" type="number" min={30} max={180} value={daysBack} onChange={(e) => setDaysBack(parseInt(e.target.value) || 90)} />
              <p className="text-xs text-muted-foreground">من 30 إلى 180 يوم (افتراضي: 90)</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-tickers">عدد الأسهم (حسب السيولة)</Label>
              <Input id="max-tickers" type="number" min={10} max={100} value={maxTickers} onChange={(e) => setMaxTickers(parseInt(e.target.value) || 40)} />
              <p className="text-xs text-muted-foreground">من 10 إلى 100 سهم (افتراضي: 40)</p>
            </div>
          </div>

          <div className="space-y-3">
            <Label>البرسونات</Label>
            <div className="flex flex-wrap gap-3">
              <label className={cn('flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors',
                includeInvestor ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30' : 'border-muted')}>
                <input type="checkbox" checked={includeInvestor} onChange={(e) => setIncludeInvestor(e.target.checked)} className="w-4 h-4" />
                <span className="text-sm font-medium">🏦 المستثمر (R/R ≥ 2.0 · هدف 3.0R)</span>
              </label>
              <label className={cn('flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors',
                includeGambler ? 'border-purple-400 bg-purple-50 dark:bg-purple-950/30' : 'border-muted')}>
                <input type="checkbox" checked={includeGambler} onChange={(e) => setIncludeGambler(e.target.checked)} className="w-4 h-4" />
                <span className="text-sm font-medium">🎲 المضارب (R/R ≥ 1.5 · هدف 1.5R)</span>
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={clearExisting} onChange={(e) => setClearExisting(e.target.checked)} className="w-4 h-4" />
              <span className="text-sm">مسح التوقعات الرجعية السابقة قبل التوليد (موصى به)</span>
            </label>
          </div>

          <Button onClick={handleGenerate} disabled={loading} size="lg" className="w-full">
            {loading ? (
              <><Loader2 className="w-5 h-5 ml-2 animate-spin" />جارى التوليد والتحقق...</>
            ) : (
              <><Play className="w-5 h-5 ml-2" />توليد التوقعات بأثر رجعى</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {result.success && result.summary ? (
              <Card className="border-emerald-200 dark:border-emerald-800/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-emerald-500" />
                    نتائج التوليد
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Card className="border-muted"><CardContent className="p-3 text-center">
                      <Users className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">إجمالي التوقعات</p>
                      <p className="text-2xl font-bold">{result.summary.generated}</p>
                    </CardContent></Card>
                    <Card className="border-muted"><CardContent className="p-3 text-center">
                      <Clock className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">متحقَّق منها</p>
                      <p className="text-2xl font-bold">{result.summary.verified}</p>
                    </CardContent></Card>
                    <Card className="border-emerald-200 dark:border-emerald-800/50"><CardContent className="p-3 text-center">
                      <Trophy className="w-4 h-4 mx-auto mb-1 text-emerald-500" />
                      <p className="text-xs text-muted-foreground">🎯 ضربت الهدف</p>
                      <p className="text-2xl font-bold text-emerald-600">{result.summary.target_hits}</p>
                    </CardContent></Card>
                    <Card className="border-red-200 dark:border-red-800/50"><CardContent className="p-3 text-center">
                      <XCircle className="w-4 h-4 mx-auto mb-1 text-red-500" />
                      <p className="text-xs text-muted-foreground">🛑 ضربت الوقف</p>
                      <p className="text-2xl font-bold text-red-600">{result.summary.stopped}</p>
                    </CardContent></Card>
                  </div>

                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <Badge variant="secondary">⏱️ {result.summary.duration_ms} مللي ثانية</Badge>
                    <Badge variant="secondary">📊 {result.summary.tickers_processed} سهم معالَج</Badge>
                    {result.summary.tickers_skipped > 0 && (
                      <Badge variant="secondary">⏭️ {result.summary.tickers_skipped} سهم متخطى (بيانات غير كافية)</Badge>
                    )}
                    <Badge variant="secondary">📅 {result.summary.days_back} يوم</Badge>
                    {result.summary.markets && result.summary.markets.length > 0 && (
                      <Badge variant="secondary">🌍 {result.summary.markets.length} سوق: {result.summary.markets.join(' · ')}</Badge>
                    )}
                  </div>

                  {/* By market breakdown */}
                  {result.summary.by_market && Object.keys(result.summary.by_market).length > 0 && (
                    <div>
                      <div className="text-sm font-medium mb-2 flex items-center gap-2">
                        <span>🌍</span> تفصيل حسب السوق
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {Object.entries(result.summary.by_market).map(([market, stats]) => {
                          const winRate = stats.target_hit + stats.stopped > 0
                            ? ((stats.target_hit / (stats.target_hit + stats.stopped)) * 100).toFixed(1)
                            : '0';
                          const marketNames: Record<string, string> = {
                            EGX: '🇪🇬 البورصة المصرية',
                            TADAWUL: '🇸🇦 السعودية (تداول)',
                            KSE: '🇰🇼 الكويت',
                            QSE: '🇶🇦 قطر',
                            DFM: '🇦🇪 دبي',
                            ADSM: '🇦🇪 أبوظبي',
                            BAHRAIN: '🇧🇭 البحرين',
                            MUSCAT: '🇴🇲 عُمان',
                          };
                          return (
                            <Card key={market} className="border-amber-200 dark:border-amber-800/50">
                              <CardContent className="p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="font-bold text-sm">{marketNames[market] || `📊 ${market}`}</span>
                                  <Badge variant="outline" className="text-[10px]">{stats.tickers} سهم</Badge>
                                </div>
                                <div className="space-y-0.5 text-xs">
                                  <div className="flex justify-between"><span className="text-muted-foreground">إجمالي</span><span className="font-bold">{stats.total}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">🎯 هدف</span><span className="font-bold text-emerald-600">{stats.target_hit}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">🛑 وقف</span><span className="font-bold text-red-600">{stats.stopped}</span></div>
                                  <div className="flex justify-between border-t pt-0.5 mt-0.5"><span className="text-muted-foreground">نسبة النجاح</span><span className="font-bold">{winRate}%</span></div>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* By persona breakdown */}
                  {result.summary.by_persona && (
                    <div>
                      <div className="text-sm font-medium mb-2 flex items-center gap-2">
                        <span>👥</span> تفصيل حسب البرسونا
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {Object.entries(result.summary.by_persona).map(([persona, stats]) => {
                          const isInvestor = persona === 'investor';
                          const winRate = stats.target_hit + stats.stopped > 0
                            ? ((stats.target_hit / (stats.target_hit + stats.stopped)) * 100).toFixed(1)
                            : '0';
                          return (
                            <Card key={persona} className={cn('border', isInvestor ? 'border-blue-200 dark:border-blue-800/50' : 'border-purple-200 dark:border-purple-800/50')}>
                              <CardContent className="p-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <span className="text-lg">{isInvestor ? '🏦' : '🎲'}</span>
                                  <span className="font-bold">{isInvestor ? 'المستثمر' : 'المضارب'}</span>
                                </div>
                                <div className="space-y-1 text-sm">
                                  <div className="flex justify-between"><span className="text-muted-foreground">إجمالي التوقعات</span><span className="font-bold">{stats.total}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">🎯 ضربت الهدف</span><span className="font-bold text-emerald-600">{stats.target_hit}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">🛑 ضربت الوقف</span><span className="font-bold text-red-600">{stats.stopped}</span></div>
                                  <div className="flex justify-between"><span className="text-muted-foreground">⏳ مفتوحة</span><span className="font-bold text-blue-600">{stats.pending}</span></div>
                                  <div className="flex justify-between border-t pt-1 mt-1"><span className="text-muted-foreground">نسبة النجاح</span><span className="font-bold">{winRate}%</span></div>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
                    💡 يمكن متابعة هذه التوقعات في صفحة <a href="/#prediction-credibility" className="text-emerald-600 underline">متابعة التوقعات</a> مع
                    فلترة حسب البرسونا (المستثمر / المضارب). سيظهر لكل توقع: أفضل سعر بعد الدخول، عدد الأيام، الربح الفعلي، والنتيجة النهائية.
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-red-200 dark:border-red-800/50">
                <CardContent className="p-4 flex items-center gap-2">
                  <XCircle className="w-5 h-5 text-red-500" />
                  <span className="text-sm">فشل: {result.error}</span>
                </CardContent>
              </Card>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default RetroactivePredictionsAdmin;
