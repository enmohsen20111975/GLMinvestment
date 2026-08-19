'use client';

/**
 * 😈 كارت الشيطان (Devil's Card)
 *
 * بيظهر في صفحة السهم، تحت كارت Dual Persona.
 * بيعرض رأي الخبير المخضرم المختلف عن "الخبر".
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  AlertTriangle, Shield, Target, TrendingUp, TrendingDown,
  Activity, Calendar, Zap, Eye, RefreshCw, Loader2, ChevronDown, ChevronUp
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DevilCard as DevilCardType } from '@/lib/devil/types';

interface DevilsCardProps {
  ticker: string;
}

export function DevilsCard({ ticker }: DevilsCardProps) {
  const [card, setCard] = useState<DevilCardType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchCard = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/devil/card/${ticker}`, { cache: 'no-store' });
      if (resp.ok) {
        const data = await resp.json();
        setCard(data);
      } else {
        setError('فشل في جلب كارت الشيطان');
      }
    } catch (err) {
      setError('خطأ في الاتصال');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchCard();
  }, [ticker]);

  if (loading) {
    return (
      <Card className="border-amber-500/40 bg-gradient-to-br from-amber-500/5 via-red-500/5 to-orange-500/5">
        <CardContent className="p-6 flex items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
          <span className="text-sm text-muted-foreground">الشيطان بيفكر...</span>
        </CardContent>
      </Card>
    );
  }

  if (error || !card) {
    return (
      <Card className="border-amber-500/20">
        <CardContent className="p-4 text-center">
          <p className="text-sm text-muted-foreground mb-2">{error || 'مفيش كارت شيطان متاح'}</p>
          <Button size="sm" variant="outline" onClick={fetchCard}>
            <RefreshCw className="h-3 w-3 ml-1" /> حاول تاني
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ألوان حسب المستوى
  const levelConfig = {
    opportunity: {
      bg: 'from-green-500/10 via-emerald-500/5 to-transparent',
      border: 'border-green-500/40',
      badge: 'bg-green-500/15 text-green-700 dark:text-green-400',
      emoji: '🟢',
    },
    wait: {
      bg: 'from-amber-500/10 via-yellow-500/5 to-transparent',
      border: 'border-amber-500/40',
      badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
      emoji: '🟡',
    },
    avoid: {
      bg: 'from-orange-500/10 via-red-500/5 to-transparent',
      border: 'border-orange-500/40',
      badge: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
      emoji: '🔴',
    },
    strong_avoid: {
      bg: 'from-red-500/15 via-rose-500/10 to-transparent',
      border: 'border-red-500/50',
      badge: 'bg-red-500/20 text-red-700 dark:text-red-400',
      emoji: '🔴🔴',
    },
  };

  const cfg = levelConfig[card.devilLevel];
  const scoreColor = card.devilScore > 20 ? 'text-green-600'
    : card.devilScore < -20 ? 'text-red-600'
    : 'text-amber-600';

  return (
    <Card className={cn('border-2 bg-gradient-to-br', cfg.bg, cfg.border)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="text-2xl">😈</span>
            رأي الشيطان — {card.ticker}
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {expanded ? 'أقل' : 'تفاصيل'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* الملخص */}
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <span className="text-xs font-bold text-muted-foreground shrink-0 w-20">الخبر:</span>
            <span className="text-sm">{card.headline}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-xs font-bold text-muted-foreground shrink-0 w-20">العامة:</span>
            <span className="text-sm">{card.crowdThinks}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-xs font-bold text-muted-foreground shrink-0 w-20">السوق:</span>
            <span className="text-sm font-medium">{card.marketDid}</span>
          </div>
        </div>

        <Separator />

        {/* قرار الشيطان */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Badge className={cn('text-sm py-1 px-3', cfg.badge)}>
              {cfg.emoji} {card.devilSays}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">درجة الشيطان:</span>
            <span className={cn('text-xl font-bold', scoreColor)}>
              {card.devilScore > 0 ? '+' : ''}{card.devilScore}
            </span>
          </div>
        </div>

        {/* اللعبة لكل شخصية */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Shield className="h-4 w-4 text-blue-500" />
              <span className="text-xs font-bold text-blue-600">لو مستثمر</span>
            </div>
            <p className="text-xs text-foreground/80">{card.investorPlay}</p>
          </div>
          <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Zap className="h-4 w-4 text-red-500" />
              <span className="text-xs font-bold text-red-600">لو مضارب</span>
            </div>
            <p className="text-xs text-foreground/80">{card.gamblerPlay}</p>
          </div>
        </div>

        {/* التفاصيل (مخفية افتراضياً) */}
        {expanded && (
          <div className="space-y-3 pt-2">
            <Separator />

            {/* محرك التناقض */}
            {card.divergence && card.divergence.strength !== 'none' && (
              <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-bold">محرك التناقض</span>
                  {card.divergence.divergenceType === 'distribution' && (
                    <Badge variant="destructive" className="text-xs">توزيع 🚨</Badge>
                  )}
                  {card.divergence.divergenceType === 'accumulation' && (
                    <Badge className="text-xs bg-green-500/20 text-green-700">تراكم 🟢</Badge>
                  )}
                </div>
                <p className="text-xs text-foreground/80">{card.divergence.devilVerdict}</p>
              </div>
            )}

            {/* محرك السلسلة */}
            {card.chainReaction && (
              <div className="rounded-lg bg-purple-500/5 border border-purple-500/20 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Activity className="h-4 w-4 text-purple-500" />
                  <span className="text-sm font-bold">محرك السلسلة</span>
                  <Badge variant="outline" className="text-xs">{card.chainReaction.eventDescription}</Badge>
                </div>
                <p className="text-xs text-foreground/80 mb-2">{card.chainReaction.devilVerdict}</p>

                {card.chainBeneficiaries.length > 0 && (
                  <div className="mb-2">
                    <div className="text-xs font-bold text-green-600 mb-1">🟢 المستفيدون:</div>
                    <div className="flex flex-wrap gap-1">
                      {card.chainBeneficiaries.slice(0, 5).map(b => (
                        <Badge key={b.ticker} variant="outline" className="text-xs bg-green-500/5">
                          {b.ticker} +{b.impactPercent.toFixed(1)}%
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {card.chainSufferers.length > 0 && (
                  <div>
                    <div className="text-xs font-bold text-red-600 mb-1">🔴 المتضررون:</div>
                    <div className="flex flex-wrap gap-1">
                      {card.chainSufferers.slice(0, 5).map(s => (
                        <Badge key={s.ticker} variant="outline" className="text-xs bg-red-500/5">
                          {s.ticker} {s.impactPercent.toFixed(1)}%
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* محرك اللعب قبل الحدث */}
            {card.preEvent && (
              <div className="rounded-lg bg-indigo-500/5 border border-indigo-500/20 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Calendar className="h-4 w-4 text-indigo-500" />
                  <span className="text-sm font-bold">اللعب قبل الحدث</span>
                  <Badge variant="outline" className="text-xs">
                    {card.preEvent.eventName.slice(0, 30)}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    بعد {card.preEvent.daysUntil} يوم
                  </Badge>
                </div>
                <p className="text-xs text-foreground/80 mb-2">{card.preEvent.devilVerdict}</p>
                <div className="text-xs">
                  <span className="text-muted-foreground">القيمة المتوقعة: </span>
                  <span className={cn(
                    'font-bold',
                    card.preEvent.expectedValue > 0 ? 'text-green-600' : 'text-red-600'
                  )}>
                    {card.preEvent.expectedValue > 0 ? '+' : ''}{card.preEvent.expectedValue}%
                  </span>
                </div>
              </div>
            )}

            {/* محرك العكسية */}
            {card.contrarian && card.contrarian.signal !== 'neutral' && (
              <div className="rounded-lg bg-pink-500/5 border border-pink-500/20 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Eye className="h-4 w-4 text-pink-500" />
                  <span className="text-sm font-bold">محرك العكسية</span>
                  <Badge variant="outline" className="text-xs">
                    percentile {card.contrarian.pricePercentile.toFixed(0)}%
                  </Badge>
                </div>
                <p className="text-xs text-foreground/80">{card.contrarian.devilVerdict}</p>
              </div>
            )}

            {/* محرك السياق */}
            {card.regime && (
              <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/20 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Target className="h-4 w-4 text-cyan-500" />
                  <span className="text-sm font-bold">محرك السياق</span>
                  <Badge variant="outline" className="text-xs">{card.regime.regime}</Badge>
                  <Badge variant="outline" className="text-xs">{card.regime.seasonality.factorName}</Badge>
                </div>
                <p className="text-xs text-foreground/80">{card.regime.devilVerdict}</p>
              </div>
            )}

            {/* القواعد الذهبية المفعّلة */}
            {card.goldenRules.length > 0 && (
              <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/30 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm font-bold">القواعد الذهبية المفعّلة ({card.goldenRules.length})</span>
                </div>
                <ul className="space-y-1">
                  {card.goldenRules.map((rule, i) => (
                    <li key={i} className="text-xs text-foreground/80">• {rule}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
