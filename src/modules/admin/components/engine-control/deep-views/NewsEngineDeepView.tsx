/**
 * engine-control/deep-views/NewsEngineDeepView.tsx
 * ===============================================
 * News Engine — source-by-source health (4 summary stats + grid of source cards).
 *
 * Each source card shows: source URL (LTR), source_type badge, article count,
 * last_fetch_human, broken_reason (if any).
 */
'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { NewsHealthResponse } from '@/hooks/useEngineControlRoomData';
import { statusTone } from '../helpers';

/** News Engine — source-by-source health. */
export function NewsEngineDeepView({ news }: { news: NewsHealthResponse | null }) {
  if (!news?.success || !news.sources) {
    return (
      <div className="text-xs text-muted-foreground italic p-4 border border-dashed rounded-md">
        {news?.error || 'فشل تحميل بيانات مصادر الأخبار.'}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">المصادر</div>
          <div className="font-bold">{news.total_sources ?? 0}</div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">المقالات</div>
          <div className="font-bold">{news.total_articles ?? 0}</div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">المعطّلة</div>
          <div className="font-bold text-loss">{news.broken_sources_count ?? 0}</div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">السليمة</div>
          <div className="font-bold text-profit">
            {(news.sources || []).filter(s => !s.is_broken).length}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {news.sources.map((src) => {
          const tone = src.is_broken
            ? statusTone('stopped')
            : statusTone(src.success_rate_label === 'healthy' ? 'running' : src.success_rate_label === 'degraded' ? 'slow' : 'stopped');
          return (
            <Card key={src.source} className={cn('border', tone.bg)}>
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-xs truncate" dir="ltr">{src.source}</div>
                  <Badge variant="outline" className={cn('text-xs', tone.badge)}>
                    <span className={cn('w-1.5 h-1.5 rounded-full inline-block ml-1', tone.dot)} />
                    {src.source_type}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {src.article_count} مقال · آخر fetch: {src.last_fetch_human || 'أبداً'}
                </div>
                {src.broken_reason && (
                  <div className="text-xs text-loss">{src.broken_reason}</div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
