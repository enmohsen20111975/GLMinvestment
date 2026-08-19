'use client';

/**
 * 😈 تقويم الشيطان (Devil's Calendar)
 *
 * الأحداث الجاية اللي هتحرك السوق.
 * بيعرض: الأحداث + اللعب المقترح
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Calendar, Loader2, RefreshCw, AlertCircle, TrendingUp, TrendingDown, Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DevilsCalendar as DevilsCalendarType, CalendarEvent } from '@/lib/devil/types';

const categoryConfig = {
  cbe: { label: 'CBE', color: 'bg-red-500/15 text-red-700 dark:text-red-400', icon: '🏦' },
  earnings: { label: 'أرباح', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400', icon: '📊' },
  regulatory: { label: 'تنظيمي', color: 'bg-purple-500/15 text-purple-700 dark:text-purple-400', icon: '⚖️' },
  seasonality: { label: 'موسمية', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', icon: '📅' },
  macro: { label: 'ماكرو', color: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400', icon: '🌍' },
};

const importanceConfig = {
  high: { label: 'عالي', color: 'border-r-red-500' },
  medium: { label: 'متوسط', color: 'border-r-amber-500' },
  low: { label: 'منخفض', color: 'border-r-gray-400' },
};

function EventCard({ event }: { event: CalendarEvent }) {
  const cat = categoryConfig[event.category];
  const imp = importanceConfig[event.importance];

  const daysLabel = event.daysUntil === 0
    ? 'اليوم'
    : event.daysUntil > 0
    ? `بعد ${event.daysUntil} يوم`
    : `منذ ${Math.abs(event.daysUntil)} يوم`;

  return (
    <div className={cn('rounded-lg border bg-card p-3 border-r-4', imp.color)}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{cat.icon}</span>
          <Badge className={cn('text-xs', cat.color)}>{cat.label}</Badge>
          {event.importance === 'high' && (
            <Badge variant="destructive" className="text-xs">عاجل</Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{daysLabel}</span>
      </div>

      <h4 className="text-sm font-bold mb-1">{event.title}</h4>
      <p className="text-xs text-muted-foreground mb-2">{event.expectedImpact}</p>

      <div className="rounded bg-amber-500/5 border border-amber-500/20 p-2 mb-2">
        <div className="flex items-start gap-1.5">
          <Zap className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-foreground/80">{event.devilPlay}</p>
        </div>
      </div>

      {event.affectedTickers.length > 0 && event.affectedTickers[0] !== 'ALL' && (
        <div className="flex flex-wrap gap-1">
          <span className="text-xs text-muted-foreground">الأسهم المتأثرة:</span>
          {event.affectedTickers.slice(0, 6).map(t => (
            <Badge key={t} variant="outline" className="text-xs py-0">{t}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export function DevilsCalendar() {
  const [calendar, setCalendar] = useState<DevilsCalendarType | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'week' | 'month' | 'all'>('week');

  const fetchCalendar = async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/devil/calendar', { cache: 'no-store' });
      if (resp.ok) {
        const data = await resp.json();
        setCalendar(data);
      }
    } catch (err) {
      console.error('[DevilsCalendar] fetch error:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchCalendar();
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
          <span className="text-sm text-muted-foreground">بيجيب تقويم الأحداث...</span>
        </CardContent>
      </Card>
    );
  }

  if (!calendar) {
    return (
      <Card>
        <CardContent className="p-4 text-center">
          <p className="text-sm text-muted-foreground">مفيش تقويم متاح</p>
        </CardContent>
      </Card>
    );
  }

  const events = tab === 'week' ? calendar.upcomingWeek
    : tab === 'month' ? calendar.upcomingMonth
    : calendar.events;

  return (
    <Card className="border-amber-500/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5 text-amber-500" />
            😈 تقويم الشيطان
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={fetchCalendar}>
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>

        {/* التبويبات */}
        <div className="flex gap-1 mt-2">
          {([
            { key: 'week', label: 'أسبوع' },
            { key: 'month', label: 'شهر' },
            { key: 'all', label: 'الكل' },
          ] as const).map(t => (
            <Button
              key={t.key}
              size="sm"
              variant={tab === t.key ? 'default' : 'outline'}
              onClick={() => setTab(t.key)}
              className="text-xs"
            >
              {t.label}
            </Button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* اللعب المقترح */}
        {calendar.proposedPlays.length > 0 && (
          <div className="rounded-lg bg-gradient-to-r from-amber-500/10 to-red-500/10 border border-amber-500/30 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Zap className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-bold">🎯 اللعب المقترح</span>
            </div>
            <ul className="space-y-1.5">
              {calendar.proposedPlays.map((play, i) => (
                <li key={i} className="text-xs text-foreground/90">• {play}</li>
              ))}
            </ul>
          </div>
        )}

        {/* الأحداث */}
        <ScrollArea className="max-h-[500px] pr-2">
          <div className="space-y-2">
            {events.length === 0 ? (
              <div className="text-center py-8">
                <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">مفيش أحداث في الفترة دي</p>
              </div>
            ) : (
              events.map(event => <EventCard key={event.id} event={event} />)
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
