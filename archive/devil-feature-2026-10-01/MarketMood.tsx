'use client';

/**
 * 😈 مقياس السوق (Market Mood)
 *
 * بيظهر في أول الشاشة الرئيسية (فوق كل حاجة).
 * بيعرض: حرارة السوق + الصاعدين/الهابطين + السيولة + القرار
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, TrendingDown, Activity, Droplets, Thermometer } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MarketMood as MarketMoodType } from '@/lib/devil/types';

export function MarketMood({ compact = false }: { compact?: boolean }) {
  const [mood, setMood] = useState<MarketMoodType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const fetchMood = async () => {
      try {
        const resp = await fetch('/api/devil/market-mood', { cache: 'no-store' });
        if (resp.ok) {
          const data = await resp.json();
          if (mounted) {
            setMood(data);
            setLoading(false);
          }
          return;
        }
      } catch (err) {
        console.error('[MarketMood] fetch error:', err);
      }
      if (mounted) setLoading(false);
    };

    fetchMood();
    const interval = setInterval(fetchMood, 60000); // كل دقيقة

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <Card className="border-amber-500/30 bg-gradient-to-r from-amber-500/5 to-red-500/5">
        <CardContent className={cn('flex items-center gap-3', compact ? 'p-3' : 'p-4')}>
          <Thermometer className="h-5 w-5 animate-pulse text-amber-500" />
          <span className="text-sm text-muted-foreground">بيجيب حرارة السوق...</span>
        </CardContent>
      </Card>
    );
  }

  if (!mood) return null;

  // ألوان حسب المستوى
  const levelColors = {
    opportunity: 'from-green-500/10 to-emerald-500/10 border-green-500/40',
    neutral: 'from-amber-500/10 to-yellow-500/10 border-amber-500/40',
    caution: 'from-orange-500/10 to-red-500/10 border-orange-500/40',
    stay_away: 'from-red-500/15 to-rose-500/15 border-red-500/50',
  };

  const scoreColor = mood.devilScore > 20 ? 'text-green-600'
    : mood.devilScore < -20 ? 'text-red-600'
    : 'text-amber-600';

  const verdictLevelAr: Record<string, string> = {
    opportunity: '🟢 فرصة',
    neutral: '🟡 محايد',
    caution: '🟠 حذر',
    stay_away: '🔴 ابعد',
  };

  if (compact) {
    return (
      <Card className={cn('border bg-gradient-to-r', levelColors[mood.verdictLevel])}>
        <CardContent className="p-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{mood.temperatureEmoji}</span>
            <div>
              <div className="text-xs text-muted-foreground">حرارة السوق</div>
              <div className="font-bold text-sm">{mood.temperatureAr}</div>
            </div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-green-600" />
            <span className="text-sm font-bold text-green-600">{mood.gainers}</span>
            <TrendingDown className="h-4 w-4 text-red-600 mr-1" />
            <span className="text-sm font-bold text-red-600">{mood.losers}</span>
          </div>
          <div className="h-8 w-px bg-border" />
          <Badge variant="outline" className="text-xs">
            {mood.regimeAr}
          </Badge>
          <Badge variant="outline" className="text-xs">
            سيولة: {mood.liquidityAr}
          </Badge>
          <div className="mr-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">درجة الشيطان:</span>
            <span className={cn('font-bold text-sm', scoreColor)}>
              {mood.devilScore > 0 ? '+' : ''}{mood.devilScore}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('border-2 bg-gradient-to-r', levelColors[mood.verdictLevel])}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* العنوان */}
          <div className="flex items-center gap-3">
            <span className="text-4xl">{mood.temperatureEmoji}</span>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">😈 مقياس السوق</div>
              <div className="text-lg font-bold">حرارة السوق: {mood.temperatureAr}</div>
            </div>
          </div>

          {/* الإحصائيات */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="text-center">
              <div className="text-xs text-muted-foreground">EGX30</div>
              <div className={cn(
                'font-bold',
                mood.egx30Change > 0 ? 'text-green-600' : mood.egx30Change < 0 ? 'text-red-600' : 'text-muted-foreground'
              )}>
                {mood.egx30Change > 0 ? '+' : ''}{mood.egx30Change.toFixed(2)}%
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground">صاعد</div>
              <div className="font-bold text-green-600">{mood.gainers}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground">هابط</div>
              <div className="font-bold text-red-600">{mood.losers}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground">السيولة</div>
              <div className="font-bold">{mood.liquidityAr}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-foreground">الوضع</div>
              <div className="font-bold">{mood.regimeAr}</div>
            </div>
          </div>

          {/* درجة الشيطان */}
          <div className="flex flex-col items-center gap-1">
            <div className="text-xs text-muted-foreground">درجة الشيطان</div>
            <div className={cn('text-2xl font-bold', scoreColor)}>
              {mood.devilScore > 0 ? '+' : ''}{mood.devilScore}
            </div>
            <Progress
              value={((mood.devilScore + 100) / 2)}
              className="w-24 h-2"
            />
          </div>
        </div>

        {/* القرار */}
        <div className="mt-3 pt-3 border-t border-border/40">
          <div className="flex items-start gap-2">
            <Badge variant="secondary" className="shrink-0">
              {verdictLevelAr[mood.verdictLevel]}
            </Badge>
            <p className="text-sm text-foreground/90">{mood.verdict}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
