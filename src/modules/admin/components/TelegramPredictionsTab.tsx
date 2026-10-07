'use client';

/**
 * TelegramPredictionsTab
 * =====================
 * Task 28-B (Fix 7 — Fix Battalion):
 *   Telegram published predictions audit dashboard.
 *
 *   Shows:
 *     - Summary: total predictions, published count, pending count, with
 *       audit trail count (predictions with telegram_message_id)
 *     - Published predictions list (with published_at + telegram_message_id)
 *     - Pending (not published) predictions for today with manual
 *       "نشر المعلق" button that calls /api/telegram/publish-stock
 *
 *   Was P0 missing (Task 27-B audit): TelegramTab is full TG client UI,
 *   but admin had NO dedicated published-predictions audit dashboard or
 *   manual "publish pending" button for un-published predictions.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Send, RefreshCw, AlertTriangle, CheckCircle2, XCircle,
  MessageSquare, Clock, Loader2, FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface PredictionRow {
  id: number;
  ticker: string;
  signal: string | null;
  signal_type: string | null;
  market: string | null;
  prediction_date: string | null;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  master_score: number | null;
  status: string | null;
  published_at: string | null;
  telegram_message_id: number | null;
  was_published: number | null;
}

interface TelegramPredictionsResponse {
  success: boolean;
  error?: string;
  detail?: string;
  timestamp?: string;
  audit_columns_present?: boolean;
  message?: string;
  summary?: {
    total: number;
    published: number;
    pending: number;
    pending_today: number;
    with_message_id: number;
  };
  published?: PredictionRow[];
  pending_today?: PredictionRow[];
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return `منذ ${Math.floor(diffMs / 1000)} ثانية`;
  if (diffMs < 3_600_000) return `منذ ${Math.floor(diffMs / 60_000)} دقيقة`;
  if (diffMs < 86_400_000) return `منذ ${Math.floor(diffMs / 3_600_000)} ساعة`;
  return `منذ ${Math.floor(diffMs / 86_400_000)} يوم`;
}

function signalColor(signal: string | null): string {
  if (!signal) return 'border-muted text-muted-foreground';
  const s = signal.toUpperCase();
  if (s.includes('BUY') || s.includes('LONG')) return 'border-emerald-500 text-emerald-700';
  if (s.includes('SELL') || s.includes('SHORT')) return 'border-red-500 text-red-700';
  return 'border-amber-500 text-amber-700';
}

export function TelegramPredictionsTab() {
  const [data, setData] = useState<TelegramPredictionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishingTicker, setPublishingTicker] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/telegram-predictions', { credentials: 'same-origin', cache: 'no-store' });
      const json: TelegramPredictionsResponse = await res.json();
      setData(json);
      if (!json.success) {
        toast.error(json.error || 'فشل تحميل بيانات التوقعات');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const publishPrediction = async (ticker: string) => {
    setPublishingTicker(ticker);
    try {
      const res = await fetch('/api/telegram/publish-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ticker }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`تم نشر توقع ${ticker} على تيليجرام`, {
          description: json.audit_note || `message_id: ${json.message_id ?? '—'}`,
        });
        // Refresh data after a short delay so the DB has time to commit
        setTimeout(() => fetchData(), 800);
      } else {
        toast.error(json.error || 'فشل النشر على تيليجرام');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'خطأ في الاتصال');
    } finally {
      setPublishingTicker(null);
    }
  };

  const summary = data?.summary;
  const published = data?.published ?? [];
  const pendingToday = data?.pending_today ?? [];
  const auditOk = data?.audit_columns_present === true;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <Card className="border-emerald-200 dark:border-emerald-900/40">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Send className="w-5 h-5 text-emerald-600" />
                تدقيق التوقعات المنشورة على تيليجرام
              </CardTitle>
              <CardDescription className="mt-1 text-xs">
                كل توقعات اليوم مع علم published_at + telegram_message_id + زر نشر يدوي للمعلّقة.
              </CardDescription>
            </div>
            <Button onClick={fetchData} disabled={loading} variant="ghost" size="sm" className="gap-2">
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
              تحديث
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Audit columns missing alert */}
      {data && !auditOk && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-800 dark:text-amber-300">
                أعمدة التدقيق غير موجودة في predictions.db
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.message || 'الأعمدة was_published / published_at / telegram_message_id غير موجودة.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox
          label="إجمالي التوقعات"
          value={summary?.total ?? '—'}
          icon={<FileText className="w-4 h-4 text-sky-500" />}
        />
        <StatBox
          label="منشورة"
          value={summary?.published ?? '—'}
          icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
        />
        <StatBox
          label="معلّقة (غير منشورة)"
          value={summary?.pending ?? '—'}
          icon={<XCircle className="w-4 h-4 text-amber-500" />}
        />
        <StatBox
          label="معلّقة اليوم"
          value={summary?.pending_today ?? '—'}
          icon={<Clock className="w-4 h-4 text-red-500" />}
        />
      </div>

      {/* Loading */}
      {loading && !data && (
        <Card>
          <CardContent className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {!loading && data && !data.success && (
        <Card className="border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-900/40">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-red-700 dark:text-red-400">فشل تحميل بيانات التوقعات</p>
              <p className="text-xs text-muted-foreground mt-1">{data.error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending today — with manual publish button */}
      {auditOk && pendingToday.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-red-500" />
              توقعات اليوم المعلّقة ({pendingToday.length})
            </CardTitle>
            <CardDescription className="text-xs">
              توقعات اليوم اللي لم تُنشر على تيليجرام بعد. اضغط «نشر المعلّق» لنشر كل واحدة على حدة.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingToday.map((p) => (
                <div
                  key={p.id}
                  className="p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40 flex items-center gap-3 flex-wrap"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono font-bold" dir="ltr">{p.ticker}</span>
                      {p.market && <Badge variant="outline" className="text-[10px]">{p.market}</Badge>}
                      {p.signal && (
                        <Badge variant="outline" className={cn('text-[10px]', signalColor(p.signal))} dir="ltr">
                          {p.signal}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-500">
                        ⏳ معلّق
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground" dir="ltr">
                      <span>entry: {p.entry_price?.toFixed(2) ?? '—'}</span>
                      <span>target: {p.target_price?.toFixed(2) ?? '—'}</span>
                      <span>stop: {p.stop_loss?.toFixed(2) ?? '—'}</span>
                      <span>score: {p.master_score?.toFixed(1) ?? '—'}</span>
                    </div>
                    {p.prediction_date && (
                      <div className="text-[10px] text-muted-foreground mt-0.5" dir="ltr">
                        {p.prediction_date}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => publishPrediction(p.ticker)}
                    disabled={publishingTicker === p.ticker}
                    className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs"
                  >
                    {publishingTicker === p.ticker ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        جاري النشر...
                      </>
                    ) : (
                      <>
                        <Send className="w-3 h-3" />
                        نشر المعلّق
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recently published */}
      {auditOk && published.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              آخر التوقعات المنشورة ({published.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[36rem] overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="text-right border-b">
                    <th className="p-2 font-medium">الرمز</th>
                    <th className="p-2 font-medium">الإشارة</th>
                    <th className="p-2 font-medium">السعر</th>
                    <th className="p-2 font-medium">published_at</th>
                    <th className="p-2 font-medium">message_id</th>
                  </tr>
                </thead>
                <tbody>
                  {published.map((p) => (
                    <tr key={p.id} className="border-b hover:bg-muted/30">
                      <td className="p-2">
                        <div className="font-mono font-bold" dir="ltr">{p.ticker}</div>
                        {p.market && <Badge variant="outline" className="text-[9px] mt-0.5">{p.market}</Badge>}
                      </td>
                      <td className="p-2">
                        {p.signal ? (
                          <Badge variant="outline" className={cn('text-[10px]', signalColor(p.signal))} dir="ltr">
                            {p.signal}
                          </Badge>
                        ) : '—'}
                      </td>
                      <td className="p-2 font-mono" dir="ltr">
                        {p.entry_price?.toFixed(2) ?? '—'}
                      </td>
                      <td className="p-2">
                        <div className="text-[11px]">{timeAgo(p.published_at)}</div>
                        {p.published_at && (
                          <div className="text-[9px] text-muted-foreground" dir="ltr">
                            {new Date(p.published_at).toLocaleString('ar-EG')}
                          </div>
                        )}
                      </td>
                      <td className="p-2 font-mono" dir="ltr">
                        {p.telegram_message_id ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {auditOk && published.length === 0 && pendingToday.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>لا توجد توقعات في قاعدة البيانات</p>
            <p className="text-xs mt-1">شغّل V40.2 generator لإنتاج توقعات اليوم.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small presentational helper                                       */
/* ------------------------------------------------------------------ */

function StatBox({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-lg bg-muted/40 border border-border/50">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
