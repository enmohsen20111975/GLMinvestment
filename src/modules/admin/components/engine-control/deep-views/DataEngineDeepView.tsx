/**
 * engine-control/deep-views/DataEngineDeepView.tsx
 * ===============================================
 * Data Engine — scraper-by-scraper status (7 scrapers shown as cards).
 *
 * Maps the logs.engines.data_engine.files array to a fixed set of 7 known
 * scrapers (TradingView, US Stocks, Multi-Market, price_updater_morning,
 * price_updater_evening, price_safetynet, regime_engine).
 */
'use client';

import React, { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EngineLogsResponse } from '@/hooks/useEngineControlRoomData';
import { statusTone, looksLikeError, timeAgoBrief } from '../helpers';

/** Data Engine — scraper-by-scraper status. */
export function DataEngineDeepView({ logs }: { logs: EngineLogsResponse | null }) {
  const scrapers = useMemo(() => {
    const fileMap: Record<string, { label: string; path: string }> = {
      'tradingview.log': { label: 'TradingView (EGX)', path: '/tmp/tradingview.log' },
      'us_scraper.log': { label: 'US Stocks (Yahoo)', path: '/tmp/us_scraper.log' },
      'multi_scraper.log': { label: 'Multi-Market', path: '/tmp/multi_scraper.log' },
      'price_updater_morning.log': { label: 'تحديث الأسعار (صباحاً)', path: '/tmp/price_updater_morning.log' },
      'price_updater_evening.log': { label: 'تحديث الأسعار (مساءً)', path: '/tmp/price_updater_evening.log' },
      'price_safetynet.log': { label: 'Safety Net (Yahoo)', path: '/tmp/price_safetynet.log' },
      'regime_engine.log': { label: 'حالة السوق', path: '/tmp/regime_engine.log' },
    };
    const files = logs?.engines?.data_engine?.files || [];
    return Object.entries(fileMap).map(([fname, meta]) => {
      const found = files.find(f => f.path === meta.path) || null;
      return {
        ...meta,
        fname,
        exists: found?.exists ?? false,
        mtime: found?.mtime ?? null,
        lines: found?.lines ?? [],
      };
    });
  }, [logs]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {scrapers.map((s) => {
          const running = s.exists && s.mtime
            ? Date.now() - new Date(s.mtime).getTime() < 60 * 60 * 1000
            : false;
          const tone = running
            ? statusTone('running')
            : s.exists
            ? statusTone('slow')
            : statusTone('stopped');
          const errCount = s.lines.filter(looksLikeError).length;
          return (
            <Card key={s.fname} className={cn('border', tone.bg)}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-sm">{s.label}</div>
                  <Badge variant="outline" className={cn('text-xs', tone.badge)}>
                    <span className={cn('w-1.5 h-1.5 rounded-full inline-block ml-1', tone.dot)} />
                    {tone.label}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">آخر تشغيل: </span>
                    <span className="font-bold">{s.mtime ? timeAgoBrief(s.mtime) : 'لم يُشغّل'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">آخر سطر: </span>
                    <code className="block truncate" dir="ltr">{s.lines[s.lines.length - 1] || '—'}</code>
                  </div>
                </div>
                {errCount > 0 && (
                  <div className="flex items-center gap-1 text-xs text-loss">
                    <AlertTriangle className="w-3 h-3" /> {errCount} خطأ في آخر 50 سطر
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
