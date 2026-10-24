/**
 * telegram-tab/DialogsTab.tsx
 * ===========================
 * Lists all Telegram dialogs (chats / groups / channels) for the authenticated
 * user with search + refresh.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageSquare, RefreshCw, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

import type { DialogItem } from './types';
import { colorForId, dialogTypeIcon, formatTime, initialsOf } from './helpers';
import { EmptyState } from './EmptyState';
import { NotAuthBanner } from './NotAuthBanner';

interface DialogsTabProps {
  authenticated: boolean;
  openDialog: (d: DialogItem) => void;
  onRequireAuth: () => void;
}

export function DialogsTab({ authenticated, openDialog, onRequireAuth }: DialogsTabProps) {
  const [dialogs, setDialogs] = useState<DialogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const fetchDialogs = useCallback(async () => {
    if (!authenticated) { onRequireAuth(); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/telegram/dialogs?limit=100');
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (data.success) {
        setDialogs(Array.isArray(data.dialogs) ? data.dialogs : []);
      } else {
        toast.error(data.error || 'فشل تحميل المحادثات');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, [authenticated, onRequireAuth]);

  useEffect(() => {
    if (authenticated) fetchDialogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  const filtered = dialogs.filter((d) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      d.title?.toLowerCase().includes(q) ||
      d.username?.toLowerCase().includes(q)
    );
  });

  if (!authenticated) return <NotAuthBanner onRequireAuth={onRequireAuth} />;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-profit" />
            المحادثات
          </span>
          <Button variant="outline" size="sm" onClick={fetchDialogs} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4 ml-1', loading && 'animate-spin')} />
            تحديث
          </Button>
        </CardTitle>
        <CardDescription>
          {loading ? 'جاري التحميل...' : `${filtered.length} محادثة`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو اسم المستخدم..."
            className="pr-10"
          />
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-2">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-2.5 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-10 w-10" />}
            text={search ? 'لا توجد نتائج مطابقة' : 'لا توجد محادثات'}
          />
        ) : (
          <div className="max-h-[60vh] overflow-y-auto pr-1 -mr-1 space-y-1">
            {filtered.map((d) => (
              <button
                key={d.id}
                onClick={() => openDialog(d)}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent transition-colors text-right border border-transparent hover:border-border"
              >
                <Avatar className="h-11 w-11 shrink-0">
                  <AvatarFallback className={cn('text-foreground', colorForId(d.id))}>
                    {initialsOf(d.title)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">{dialogTypeIcon(d.type)}</span>
                    <p className="font-medium truncate">{d.title || 'بدون اسم'}</p>
                    {d.username && (
                      <span className="text-xs text-muted-foreground truncate" dir="ltr">@{d.username}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {d.last_message_text || '—'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatTime(d.last_message_at)}
                  </span>
                  {d.unread_count && d.unread_count > 0 ? (
                    <Badge className="bg-loss hover:bg-loss text-white text-xs h-5 min-w-5 px-1.5 justify-center">
                      {d.unread_count > 99 ? '99+' : d.unread_count}
                    </Badge>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
