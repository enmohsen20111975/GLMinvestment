'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TrendingUp, AlertTriangle, RefreshCw, Target,
  Shield, Activity, ChevronDown, ChevronUp, Zap, Award, Clock, Calendar,
  ExternalLink, Copy, Check, Send, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore, MARKET_NAMES_AR } from '@/lib/store';
import { formatPickForSharing } from '@/lib/pick-formatter';

// ============================================================================
// HunterPickV2 — نوع بيانات الصياد الجديد
// ============================================================================

interface HunterPickV2 {
  ticker: string;
  name: string;
  name_ar: string;
  sector: string;
  market: string;
  price: number;
  entry: number;
  entry_trigger: string;
  stop_loss: number;
  stop_pct: number;
  target: number;
  target_pct: number;
  risk_reward: number;
  timeframe: string;
  reason: string;
  narrative: string[];
  personas: {
    hunter: number;
    hunter_verdict?: string;
    momentum: number;
    momentum_verdict?: string;
    value: number;
    value_verdict?: string;
  };
  support: number;
  resistance: number;
  volume_ratio: number;
  change_1d: number;
  market_regime: string;
}

interface HunterViewV2Props {
  picks: HunterPickV2[];
  loading: boolean;
  error: string | null;
  meta: {
    date: string;
    elapsedMs: number;
    stage1Count: number;
    stage2Count: number;
    stage3Count: number;
    maestroAvailable: boolean;
  } | null;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  onRetry: () => void;
}

// ============================================================================
// HunterView — الواجهة الرئيسية (V2 فقط)
// ============================================================================

export function HunterView() {
  const currentMarket = useAppStore((s) => s.currentMarket);

  // V2 state (الصياد الجديد)
  const [v2Picks, setV2Picks] = useState<HunterPickV2[]>([]);
  const [v2Loading, setV2Loading] = useState(false);
  const [v2Error, setV2Error] = useState<string | null>(null);
  const [v2ExpandedId, setV2ExpandedId] = useState<string | null>(null);
  const [v2Meta, setV2Meta] = useState<{
    date: string;
    elapsedMs: number;
    stage1Count: number;
    stage2Count: number;
    stage3Count: number;
    maestroAvailable: boolean;
  } | null>(null);

  const fetchV2Picks = useCallback(async () => {
    setV2Loading(true);
    setV2Error(null);
    try {
      const marketCode = currentMarket === 'TADAWUL' ? 'TADAWUL' : currentMarket;
      const res = await fetch(`/api/hunter/daily-picks?market=${marketCode}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setV2Picks(data.picks || []);
          setV2Meta({
            date: data.date,
            elapsedMs: data.elapsed_ms,
            stage1Count: data.stage1_count,
            stage2Count: data.stage2_count,
            stage3Count: data.stage3_count,
            maestroAvailable: data.meta?.maestro_available ?? false,
          });
        } else {
          setV2Error(data.error || 'فشل في تحميل البيانات');
        }
      } else {
        setV2Error('فشل في الاتصال بالخادم');
      }
    } catch (err) {
      setV2Error('فشل في الاتصال بالخادم');
      console.error(err);
    } finally {
      setV2Loading(false);
    }
  }, [currentMarket]);

  useEffect(() => {
    fetchV2Picks();
  }, [fetchV2Picks]);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6 text-orange-500" />
            الصياد الجديد V2
            {v2Meta && (
              <Badge variant="secondary" className="text-xs mr-2">{v2Meta.stage3Count} فرص</Badge>
            )}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            3 مراحل: فلترة → عين الخبير → اختيار الـ Boss — أقل من 10 ثواني
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchV2Picks}
        >
          <RefreshCw className={cn("h-4 w-4 ml-1", v2Loading && "animate-spin")} />
          تحديث
        </Button>
      </div>

      {/* V2 Content — الصياد الجديد */}
      <HunterViewV2
        picks={v2Picks}
        loading={v2Loading}
        error={v2Error}
        meta={v2Meta}
        expandedId={v2ExpandedId}
        setExpandedId={setV2ExpandedId}
        onRetry={fetchV2Picks}
      />

      {/* Disclaimer */}
      <Card className="bg-red-50 dark:bg-red-950/20 border-red-200">
        <CardContent className="p-3 flex items-center gap-2">
          <Shield className="h-5 w-5 text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-600 dark:text-red-400">
            هذا المحتوى للتوعية التعليمية فقط وليس توقعة شراء أو بيع.
            إدارة رأس المال والالتزام بوقف الخسارة أهم من تحقيق الربح.
            الحد الأقصى الموصى به: 5% من رأس المال لكل صفقة.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// HunterViewV2 — واجهة الصياد الجديد V2
// ============================================================================

function HunterViewV2({
  picks,
  loading,
  error,
  meta,
  expandedId,
  setExpandedId,
  onRetry,
}: HunterViewV2Props) {
  const currentMarket = useAppStore((s) => s.currentMarket);
  // نسخ: نتتبع أي توقع اتنسخ دلوقتي عشان نبدّل الأيقونة لـ Check مؤقتاً
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // نشر: نتتبع أي توقع جارٍ نشره (loading) عشان نظهر spinner على الزر
  const [publishingId, setPublishingId] = useState<string | null>(null);

  const handleCopy = useCallback(
    async (pick: HunterPickV2, id: string) => {
      const marketName = MARKET_NAMES_AR[currentMarket] || currentMarket;
      const text = formatPickForSharing(pick, marketName);
      try {
        if (!navigator?.clipboard?.writeText) {
          throw new Error('الحافظة غير مدعومة في هذا المتصفح');
        }
        await navigator.clipboard.writeText(text);
        setCopiedId(id);
        toast.success('تم نسخ التوقع');
        setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
      } catch (err) {
        console.error('Copy failed:', err);
        toast.error('فشل النسخ');
      }
    },
    [currentMarket],
  );

  const handlePublish = useCallback(
    async (pick: HunterPickV2, id: string) => {
      setPublishingId(id);
      try {
        const res = await fetch('/api/hunter/publish-pick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticker: pick.ticker,
            name_ar: pick.name_ar,
            name: pick.name,
            market: pick.market || currentMarket,
            price: pick.price,
            entry: pick.entry,
            entry_trigger: pick.entry_trigger,
            stop_loss: pick.stop_loss,
            stop_pct: pick.stop_pct,
            target: pick.target,
            target_pct: pick.target_pct,
            risk_reward: pick.risk_reward,
            timeframe: pick.timeframe,
            reason: pick.reason,
            narrative: pick.narrative,
            personas: pick.personas,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.success) {
          toast.success('تم نشر التوقع على تيليجرام');
        } else {
          const errMsg = data?.error || data?.message || `HTTP ${res.status}`;
          toast.error(`فشل النشر: ${errMsg}`);
        }
      } catch (err) {
        console.error('Publish failed:', err);
        toast.error('فشل النشر: تعذّر الاتصال بالخادم');
      } finally {
        setPublishingId((prev) => (prev === id ? null : prev));
      }
    },
    [currentMarket],
  );

  if (loading) {
    return (
      <div className="space-y-3">
        <Card className="bg-orange-50 dark:bg-orange-950/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-5 w-5 animate-spin text-orange-500" />
              <div>
                <p className="font-medium text-orange-700 dark:text-orange-400">
                  جاري التصيّد...
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  المرحلة 1: فلترة → المرحلة 2: عين الخبير → المرحلة 3: اختيار الـ Boss
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-32 w-full" />
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
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-4 w-4 ml-2" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!picks || picks.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Zap className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-30" />
          <p className="text-muted-foreground">لا توجد فرص صياد اليوم</p>
          <p className="text-xs text-muted-foreground mt-1">
            الفلاتر صارمة — لازم R/R ≥ 3 و وقف ≥ 4% و هدف ≤ 25%
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Pipeline Stats */}
      {meta && (
        <Card className="bg-gradient-to-l from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 border-orange-200 dark:border-orange-900">
          <CardContent className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-orange-600" />
                <div>
                  <p className="font-bold text-orange-700 dark:text-orange-400">
                    نتائج الصياد — {meta.date}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    اتعمل في {meta.elapsedMs}ms • {meta.maestroAvailable ? '✓ Maestro مفعّل' : '⚠ Maestro معطّل'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300">
                  {meta.stage1Count} فلتر أولي
                </Badge>
                <span className="text-muted-foreground">←</span>
                <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  {meta.stage2Count} عين الخبير
                </Badge>
                <span className="text-muted-foreground">←</span>
                <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">
                  {meta.stage3Count} فرص حقيقية
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Picks List */}
      {picks.map((pick, idx) => {
        const pickId = `${pick.ticker}-${idx}`;
        const isExpanded = expandedId === pickId;
        const regimeColor = pick.market_regime === 'BULL'
          ? 'text-green-600 bg-green-50 dark:bg-green-950/30'
          : pick.market_regime === 'BEAR'
          ? 'text-red-600 bg-red-50 dark:bg-red-950/30'
          : 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30';
        const regimeLabel = pick.market_regime === 'BULL' ? 'سوق صاعد' : pick.market_regime === 'BEAR' ? 'سوق هابط' : 'سوق عرضي';

        return (
          <Card
            key={`${pick.ticker}-${idx}`}
            className="border-r-4 border-r-orange-500 transition-all hover:shadow-md"
          >
            <CardContent className="p-4">
              {/* Top Row */}
              <div
                className="flex items-start justify-between cursor-pointer"
                onClick={() => {
                  const newId = isExpanded ? null : pickId;
                  setExpandedId(newId);
                }}
              >
                <div className="flex-1">
                  {/* Title */}
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-lg font-bold">{idx + 1}.</span>
                    <span className="font-bold text-lg">{pick.name_ar || pick.name || pick.ticker}</span>
                    <Badge variant="secondary" className="text-xs font-mono">{pick.ticker}</Badge>
                    {pick.sector && (
                      <Badge variant="outline" className="text-xs">{pick.sector}</Badge>
                    )}
                    <Badge className={cn("text-xs", regimeColor)}>
                      {regimeLabel}
                    </Badge>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>

                  {/* Entry / Stop / Target — الأهم */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                    <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
                      <div className="flex items-center gap-1 mb-1">
                        <Target className="h-3 w-3 text-blue-600" />
                        <span className="text-xs text-blue-700 dark:text-blue-400 font-medium">الدخول</span>
                      </div>
                      <p className="text-sm font-bold text-blue-900 dark:text-blue-200">
                        {pick.entry_trigger}
                      </p>
                    </div>
                    <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
                      <div className="flex items-center gap-1 mb-1">
                        <Shield className="h-3 w-3 text-red-600" />
                        <span className="text-xs text-red-700 dark:text-red-400 font-medium">الوقف</span>
                      </div>
                      <p className="text-sm font-bold text-red-900 dark:text-red-200">
                        {pick.stop_loss.toFixed(2)} <span className="text-xs">(-{pick.stop_pct}%)</span>
                      </p>
                    </div>
                    <div className="p-2 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900">
                      <div className="flex items-center gap-1 mb-1">
                        <TrendingUp className="h-3 w-3 text-green-600" />
                        <span className="text-xs text-green-700 dark:text-green-400 font-medium">الهدف</span>
                      </div>
                      <p className="text-sm font-bold text-green-900 dark:text-green-200">
                        {pick.target.toFixed(2)} <span className="text-xs">(+{pick.target_pct}%)</span>
                      </p>
                    </div>
                  </div>

                  {/* Quick Stats */}
                  <div className="flex items-center gap-3 text-sm flex-wrap">
                    <div className="flex items-center gap-1">
                      <Award className="h-3 w-3 text-orange-500" />
                      <span className="text-muted-foreground text-xs">R/R:</span>
                      <span className="font-bold text-orange-600">1:{pick.risk_reward.toFixed(1)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-purple-500" />
                      <span className="text-muted-foreground text-xs">الوقت:</span>
                      <span className="font-medium">{pick.timeframe}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Activity className="h-3 w-3 text-blue-500" />
                      <span className="text-muted-foreground text-xs">تغير:</span>
                      <span className={cn(
                        "font-medium",
                        pick.change_1d >= 0 ? "text-green-600" : "text-red-600"
                      )}>
                        {pick.change_1d >= 0 ? '+' : ''}{pick.change_1d.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Reason */}
              {pick.reason && (
                <div className="mt-2 pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">💡 السبب:</span> {pick.reason}
                  </p>
                </div>
              )}

              {/* Feature 4: نسخ / نشر / تحليل عميق */}
              <div className="mt-3 pt-2 border-t flex items-center justify-between gap-2 flex-wrap">
                {/* نسخ + نشر */}
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="نسخ التوقع"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopy(pick, pickId);
                    }}
                    className="h-8 gap-1.5 px-2.5 text-xs"
                  >
                    {copiedId === pickId ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copiedId === pickId ? 'تم النسخ' : 'نسخ'}
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    aria-label="نشر التوقع على تيليجرام"
                    disabled={publishingId === pickId}
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePublish(pick, pickId);
                    }}
                    className="h-8 gap-1.5 px-2.5 text-xs"
                  >
                    {publishingId === pickId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    {publishingId === pickId ? 'جارٍ النشر…' : 'نشر'}
                  </Button>
                </div>
                {/* Deep Analysis Link — يفتح صفحة التحليل العميق للسهم */}
                <Link
                  href={`/stock/${encodeURIComponent(pick.ticker)}?market=${encodeURIComponent(pick.market || 'EGX')}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 transition-colors px-2 py-1 rounded hover:bg-orange-50 dark:hover:bg-orange-950/30"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3 w-3" />
                  تحليل عميق للسهم
                </Link>
              </div>

              {/* Expanded Section */}
              {isExpanded && (
                <div className="mt-4 pt-4 border-t space-y-3">
                  {/* Narrative */}
                  {pick.narrative && pick.narrative.length > 0 && (
                    <div className="bg-muted/30 rounded-lg p-3">
                      <p className="text-sm font-medium mb-2">📖 القصة</p>
                      <div className="space-y-1">
                        {pick.narrative.map((line, i) => (
                          line && (
                            <p key={i} className="text-sm text-muted-foreground">
                              {line}
                            </p>
                          )
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Personas */}
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-sm font-medium mb-2">🎯 الشخصيات (Maestro Human)</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground mb-1">🎯 الصياد</p>
                        <p className={cn(
                          "text-2xl font-bold",
                          pick.personas.hunter >= 70 ? "text-green-600"
                          : pick.personas.hunter >= 50 ? "text-yellow-600"
                          : "text-red-600"
                        )}>
                          {pick.personas.hunter}
                        </p>
                        {pick.personas.hunter_verdict && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {pick.personas.hunter_verdict}
                          </p>
                        )}
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground mb-1">⚡ الزخم</p>
                        <p className={cn(
                          "text-2xl font-bold",
                          pick.personas.momentum >= 70 ? "text-green-600"
                          : pick.personas.momentum >= 50 ? "text-yellow-600"
                          : "text-red-600"
                        )}>
                          {pick.personas.momentum}
                        </p>
                        {pick.personas.momentum_verdict && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {pick.personas.momentum_verdict}
                          </p>
                        )}
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground mb-1">💰 القيمة</p>
                        <p className={cn(
                          "text-2xl font-bold",
                          pick.personas.value >= 70 ? "text-green-600"
                          : pick.personas.value >= 50 ? "text-yellow-600"
                          : "text-red-600"
                        )}>
                          {pick.personas.value}
                        </p>
                        {pick.personas.value_verdict && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {pick.personas.value_verdict}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Detailed Stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div className="text-center p-2 rounded bg-muted">
                      <p className="text-muted-foreground text-xs">السعر الحالي</p>
                      <p className="font-semibold">{pick.price.toFixed(2)}</p>
                    </div>
                    <div className="text-center p-2 rounded bg-muted">
                      <p className="text-muted-foreground text-xs">الدعم</p>
                      <p className="font-semibold text-green-600">{pick.support.toFixed(2)}</p>
                    </div>
                    <div className="text-center p-2 rounded bg-muted">
                      <p className="text-muted-foreground text-xs">المقاومة</p>
                      <p className="font-semibold text-red-600">{pick.resistance.toFixed(2)}</p>
                    </div>
                    <div className="text-center p-2 rounded bg-muted">
                      <p className="text-muted-foreground text-xs">نسبة السيولة</p>
                      <p className="font-semibold">{pick.volume_ratio.toFixed(2)}x</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
