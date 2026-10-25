/**
 * telegram-tab/SearchTab.tsx
 * ===========================
 * Global Telegram messages search across all dialogs. Clicking a result opens
 * the chat in ChatTab.
 */

'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';

import { WidgetCard } from '@/components/shared/WidgetCard';
import type { SearchResult } from './types';
import { formatDateTime } from './helpers';
import { EmptyState } from './EmptyState';
import { NotAuthBanner } from './NotAuthBanner';

interface SearchTabProps {
  authenticated: boolean;
  openDialog: (chat_id: number, title?: string) => void;
  onRequireAuth: () => void;
}

export function SearchTab({ authenticated, openDialog, onRequireAuth }: SearchTabProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) { toast.error('أدخل نص البحث'); return; }
    if (!authenticated) { onRequireAuth(); return; }
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/telegram/search?q=${encodeURIComponent(q)}&limit=50`);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (data.success) {
        setResults(Array.isArray(data.results) ? data.results : []);
        if ((data.results || []).length === 0) toast.info('لا توجد نتائج');
      } else {
        toast.error(data.error || 'فشل البحث');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  if (!authenticated) return <NotAuthBanner onRequireAuth={onRequireAuth} />;

  return (
    <WidgetCard
      title="البحث في الرسائل"
      icon={Search}
      iconColor="text-profit"
      hideRefresh
      headerClassName="pb-3"
      contentClassName="space-y-3"
    >
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          placeholder="ابحث في الرسائل..."
          className="flex-1"
        />
        <Button onClick={handleSearch} disabled={loading || !query.trim()}>
          {loading ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <Search className="h-4 w-4 ml-1" />}
          بحث
        </Button>
      </div>

      {!loading && results.length === 0 ? (
        searched ? (
          <EmptyState icon={<Search className="h-10 w-10" />} text="لا توجد نتائج" />
        ) : (
          <EmptyState icon={<Search className="h-10 w-10" />} text="ابدأ بكتابة نص للبحث" />
        )
      ) : loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 w-full rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto pr-1 -mr-1 space-y-2">
          {results.map((r) => (
            <button
              key={`${r.chat_id}-${r.id}`}
              onClick={() => openDialog(r.chat_id, `محادثة ${r.chat_id}`)}
              className="w-full text-right p-3 rounded-lg border hover:border-profit hover:bg-accent transition-colors"
            >
              <p className="text-sm line-clamp-3 whitespace-pre-wrap">{r.text}</p>
              <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                <span>محادثة #{r.chat_id}</span>
                <span>{formatDateTime(r.date)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
