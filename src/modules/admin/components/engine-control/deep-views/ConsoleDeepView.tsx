/**
 * engine-control/deep-views/ConsoleDeepView.tsx
 * ===========================================
 * Console — aggregated errors from all /tmp/*.log files.
 *
 * Provides a filter (by engine) + search box + dark terminal-style list of
 * the last 100 error lines collected across all engine log files.
 */
'use client';

import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Filter, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EngineLogsResponse } from '@/hooks/useEngineControlRoomData';
import { looksLikeError, severityOf } from '../helpers';

/** Console — aggregated errors from all /tmp/*.log files. */
export function ConsoleDeepView({ logs, engineFilter, setEngineFilter, search, setSearch }: {
  logs: EngineLogsResponse | null;
  engineFilter: string;
  setEngineFilter: (s: string) => void;
  search: string;
  setSearch: (s: string) => void;
}) {
  const allErrors = useMemo(() => {
    if (!logs?.engines) return [];
    const collected: Array<{ engine: string; path: string; line: string; mtime: string | null }> = [];
    for (const [engKey, eng] of Object.entries(logs.engines)) {
      for (const f of eng.files) {
        if (!f.exists) continue;
        for (const line of f.lines) {
          if (looksLikeError(line)) {
            collected.push({ engine: engKey, path: f.path, line, mtime: f.mtime });
          }
        }
      }
    }
    return collected.reverse().slice(0, 100);
  }, [logs]);

  const filtered = allErrors.filter(e => {
    if (engineFilter !== 'all' && e.engine !== engineFilter) return false;
    if (search && !e.line.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Filter className="w-3 h-3 text-muted-foreground" />
          <select
            value={engineFilter}
            onChange={(e) => setEngineFilter(e.target.value)}
            className="text-xs border rounded px-1 py-0.5 bg-background"
          >
            <option value="all">كل المحركات</option>
            <option value="data_engine">محرك البيانات</option>
            <option value="news">محرك الأخبار</option>
            <option value="predictions">محرك التوقعات</option>
            <option value="learning">محرك التعلّم</option>
            <option value="sharia">الفحص الشرعي</option>
            <option value="cron">المهام المجدولة</option>
          </select>
        </div>
        <div className="flex items-center gap-1 flex-1 min-w-[150px]">
          <Search className="w-3 h-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث في السجلات..."
            className="h-7 text-xs"
          />
        </div>
        <Badge variant="outline" className="text-xs">
          {filtered.length} خطأ
        </Badge>
      </div>
      <div className="rounded-md bg-slate-950 text-slate-200 p-3 font-mono text-xs leading-relaxed max-h-[28rem] overflow-y-auto" dir="ltr">
        {filtered.length === 0 ? (
          <div className="text-muted-foreground text-center py-8">لا توجد أخطاء 🎉</div>
        ) : (
          filtered.map((err, i) => {
            const sev = severityOf(err.line);
            const color = sev === 'error' ? 'text-loss' : sev === 'warning' ? 'text-warning' : 'text-muted-foreground';
            return (
              <div key={i} className={cn('whitespace-pre-wrap break-all border-b border-slate-800 pb-1 mb-1', color)}>
                <span className="text-muted-foreground">[{err.engine}]</span>{' '}
                <span className="text-muted-foreground">{err.path.split('/').pop()}:</span>{' '}
                {err.line}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
