'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Target,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  ShieldX,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  BarChart3,
  Activity,
  Share2,
  Eye,
  Crosshair,
  Gauge,
} from 'lucide-react';
import { cn, getRRVerdict, fmtPrice } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface SniperResult {
  ticker: string;
  market: string;
  sniper_score: number;
  signal: string;
  signal_ar: string;
  confidence: number;
  entry_price: number;
  stop_loss: number;
  target_price: number;
  risk_reward: number;
  rsi: number;
  support: number | null;
  resistance: number | null;
  price_vs_sr: string;
  volume_ratio: number;
  liquidity_rating: string;
  candlestick_pattern: string;
  gate_1_liquidity: boolean;
  gate_2_trend: boolean;
  gate_3_sr: boolean;
  gate_4_rr: boolean;
  gate_5_confirmation: boolean;
  gates_passed: number;
  warnings_ar: string[];
}

interface OpportunityCardProps {
  opportunity: SniperResult;
}

// ============================================================================
// Component
// ============================================================================

export function OpportunityCard({ opportunity: opp }: OpportunityCardProps) {
  const [expanded, setExpanded] = useState(false);

  const gates = [
    { label: 'السيولة', passed: opp.gate_1_liquidity },
    { label: 'الاتجاه', passed: opp.gate_2_trend },
    { label: 'الدعم/المقاومة', passed: opp.gate_3_sr },
    { label: 'المخاطرة/العائد', passed: opp.gate_4_rr },
    { label: 'التأكيد', passed: opp.gate_5_confirmation },
  ];

  return (
    <Card className={cn(
      'relative overflow-hidden transition-all duration-200 hover:shadow-md',
      opp.signal.toLowerCase() === 'strong_buy' && 'border-green-300 dark:border-green-700',
      opp.signal.toLowerCase() === 'strong_sell' && 'border-red-300 dark:border-red-700',
    )}>
      {/* Signal color strip at top */}
      <div className={cn(
        'h-1 w-full',
        opp.signal.toLowerCase() === 'strong_buy' && 'bg-green-500',
        opp.signal.toLowerCase() === 'buy' && 'bg-green-400',
        opp.signal.toLowerCase() === 'hold' && 'bg-yellow-400',
        opp.signal.toLowerCase() === 'sell' && 'bg-red-400',
        opp.signal.toLowerCase() === 'strong_sell' && 'bg-red-600',
      )} />

      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg font-bold">{opp.ticker}</CardTitle>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {opp.market}
            </Badge>
          </div>
          <Badge className={cn('text-xs font-medium border', getSignalColor(opp.signal))}>
            {opp.signal_ar}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Confidence gauge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">الثقة</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', getConfidenceBg(opp.confidence))}
                style={{ width: `${opp.confidence}%` }}
              />
            </div>
            <span className={cn('text-sm font-bold', getConfidenceColor(opp.confidence))}>
              {opp.confidence}%
            </span>
          </div>
        </div>

        {/* Price row: Entry / Target / Stop */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-muted/50 p-2">
            <div className="text-[10px] text-muted-foreground mb-0.5">الدخول</div>
            <div className="text-sm font-semibold">{fmtPrice(opp.entry_price)}</div>
          </div>
          <div className="rounded-lg bg-green-50 dark:bg-green-950/30 p-2">
            <div className="text-[10px] text-green-600 dark:text-green-400 mb-0.5">
              <Target className="h-3 w-3 inline ml-0.5" />
              الهدف
            </div>
            <div className="text-sm font-semibold text-green-700 dark:text-green-400">
              {fmtPrice(opp.target_price)}
            </div>
          </div>
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 p-2">
            <div className="text-[10px] text-red-600 dark:text-red-400 mb-0.5">
              <ShieldX className="h-3 w-3 inline ml-0.5" />
              الوقف
            </div>
            <div className="text-sm font-semibold text-red-700 dark:text-red-400">
              {fmtPrice(opp.stop_loss)}
            </div>
          </div>
        </div>

        {/* R/R Ratio - مؤشر مرئي بألوان */}
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">المخاطرة/العائد</span>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-sm font-bold',
              getRRVerdict(opp.risk_reward).badgeClass
            )}
            title={`R:R = ${opp.risk_reward.toFixed(1)} — ${getRRVerdict(opp.risk_reward).label_ar}`}
          >
            <span>{getRRVerdict(opp.risk_reward).emoji}</span>
            1:{opp.risk_reward.toFixed(1)}
            <span className="text-[10px] font-medium opacity-80">{getRRVerdict(opp.risk_reward).label_ar}</span>
          </span>
        </div>

        {/* Gates visual */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-muted-foreground">البوابات ({opp.gates_passed}/5)</span>
          </div>
          <div className="flex gap-1">
            {gates.map((gate, i) => (
              <div
                key={i}
                className={cn(
                  'flex-1 flex flex-col items-center gap-0.5 rounded-md py-1.5 px-0.5 text-[9px] transition-colors',
                  gate.passed
                    ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400'
                    : 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400'
                )}
              >
                {gate.passed ? (
                  <ShieldCheck className="h-3.5 w-3.5" />
                ) : (
                  <ShieldX className="h-3.5 w-3.5" />
                )}
                <span className="truncate w-full text-center">{gate.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Expandable details toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3 ml-1" />
              إخفاء التفاصيل
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3 ml-1" />
              عرض التفاصيل
            </>
          )}
        </Button>

        {/* Expanded details */}
        {expanded && (
          <div className="space-y-3 pt-2 border-t">
            {/* RSI */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">RSI</span>
              </div>
              <span className={cn(
                'text-sm font-semibold',
                opp.rsi > 70 ? 'text-red-600 dark:text-red-400' :
                opp.rsi < 30 ? 'text-green-600 dark:text-green-400' :
                'text-foreground'
              )}>
                {opp.rsi.toFixed(1)}
              </span>
            </div>

            {/* Volume ratio */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">نسبة الحجم</span>
              </div>
              <span className={cn(
                'text-sm font-semibold',
                opp.volume_ratio > 1.5 ? 'text-green-600 dark:text-green-400' :
                opp.volume_ratio > 1.0 ? 'text-foreground' :
                'text-yellow-600 dark:text-yellow-400'
              )}>
                {opp.volume_ratio.toFixed(2)}x
              </span>
            </div>

            {/* Support / Resistance */}
            {opp.support !== null && (
              <div className="flex items-center justify-between px-1">
                <span className="text-xs text-muted-foreground">الدعم / المقاومة</span>
                <span className="text-xs font-medium">
                  {fmtPrice(opp.support)} / {opp.resistance !== null ? fmtPrice(opp.resistance) : '—'}
                </span>
              </div>
            )}

            {/* Price vs S/R */}
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-muted-foreground">موقع السعر</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {opp.price_vs_sr}
              </Badge>
            </div>

            {/* Liquidity */}
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-muted-foreground">تقييم السيولة</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {opp.liquidity_rating}
              </Badge>
            </div>

            {/* Candlestick pattern */}
            {opp.candlestick_pattern && (
              <div className="flex items-center justify-between px-1">
                <span className="text-xs text-muted-foreground">نمط الشموع</span>
                <span className="text-xs font-medium">{opp.candlestick_pattern}</span>
              </div>
            )}

            {/* Warnings */}
            {opp.warnings_ar && opp.warnings_ar.length > 0 && (
              <div className="space-y-1 pt-2 border-t">
                <div className="flex items-center gap-1 px-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                  <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400">تحذيرات</span>
                </div>
                <ul className="space-y-0.5 pr-5">
                  {opp.warnings_ar.map((w, i) => (
                    <li key={i} className="text-[11px] text-yellow-700 dark:text-yellow-300 list-disc">
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 pt-2 border-t">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs"
            onClick={() => setExpanded(!expanded)}
          >
            <Eye className="h-3 w-3 ml-1" />
            التفاصيل
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs"
            onClick={async () => {
              try {
                await fetch(`/api/sniper/track?ticker=${opp.ticker}&market=${opp.market}&XTransformPort=8010`, {
                  method: 'POST',
                });
              } catch (e) {
                console.error('Track error:', e);
              }
            }}
          >
            <Target className="h-3 w-3 ml-1" />
            تتبع
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs"
              onClick={async () => {
                try {
                  const text = `🎯 ${opp.ticker} | ${opp.signal_ar} | دخول: ${opp.entry_price} | هدف: ${opp.target_price} | وقف: ${opp.stop_loss} | R/R: ${opp.risk_reward}

📢 انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈

🔗 روابطنا الرسمية:
🌐 الموقع الإلكتروني: https://invist.m2y.net
📱 تطبيق أندرويد: https://play.google.com/store/apps/details?id=com.egx.investment
📘 فيسبوك: https://www.facebook.com/profile.php?id=61590600300048
✈️ تليجرام: https://t.me/Arabian_investment_guide
💬 واتساب: https://chat.whatsapp.com/L9hjEpJloAZAUvwMzB10Tc`;
                  if (navigator.share) {
                  await navigator.share({ title: `توقع القناص - ${opp.ticker}`, text });
                } else {
                  await navigator.clipboard.writeText(text);
                }
              } catch (e) {
                console.error('Share error:', e);
              }
            }}
          >
            <Share2 className="h-3 w-3 ml-1" />
            مشاركة
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
