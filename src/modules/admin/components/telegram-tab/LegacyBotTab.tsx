/**
 * telegram-tab/LegacyBotTab.tsx
 * ==============================
 * Preserved bot-based legacy features (Task F-Phase3-Split-TelegramTab).
 *
 * Sub-tabs:
 *   - channels: tracked channels management (add / remove / scrape-all)
 *   - content: per-channel scraped messages + AI clean + save as rec/news
 *   - recommendations: extracted recommendations table
 *   - news: extracted news list
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Bot, FileText, Loader2, Newspaper, Plus, RefreshCw, Reply, Sparkles,
  Trash2, TrendingUp, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

import type {
  LegacyChannel, LegacyMessage, LegacyMyChannel, LegacyNews, LegacyRec,
} from './types';
import { formatDateTime } from './helpers';
import { EmptyState } from './EmptyState';

interface LegacyBotTabProps {
  authenticated: boolean;
  onRequireAuth: () => void;
}

export function LegacyBotTab({ authenticated, onRequireAuth }: LegacyBotTabProps) {
  const [sub, setSub] = useState('channels');
  const [channels, setChannels] = useState<LegacyChannel[]>([]);
  const [myChannels, setMyChannels] = useState<LegacyMyChannel[]>([]);
  const [recommendations, setRecommendations] = useState<LegacyRec[]>([]);
  const [news, setNews] = useState<LegacyNews[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [newChannelMarket, setNewChannelMarket] = useState('egypt');
  const [newChannelType, setNewChannelType] = useState('recommendations');
  const [messages, setMessages] = useState<LegacyMessage[]>([]);
  const [selectedChannelForMessages, setSelectedChannelForMessages] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [processingMsg, setProcessingMsg] = useState<number | null>(null);
  const [cleanedTexts, setCleanedTexts] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [scraping, setScraping] = useState(false);

  const fetchMyChannels = useCallback(async () => {
    if (!authenticated) { onRequireAuth(); return; }
    setLoadingChannels(true);
    try {
      const res = await fetch('/api/telegram/channels/my');
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { onRequireAuth(); return; }
      if (data.success) setMyChannels(data.channels || []);
    } catch {
      /* silent */
    } finally {
      setLoadingChannels(false);
    }
  }, [authenticated, onRequireAuth]);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/channels/tracked');
      const data = await res.json().catch(() => ({}));
      setChannels(data.channels || []);
    } catch {
      /* silent */
    }
  }, []);

  const fetchRecs = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/recommendations?limit=20');
      const data = await res.json().catch(() => ({}));
      setRecommendations(data.recommendations || []);
    } catch {
      /* silent */
    }
  }, []);

  const fetchNewsList = useCallback(async () => {
    try {
      const res = await fetch('/api/telegram/news?limit=20');
      const data = await res.json().catch(() => ({}));
      setNews(data.news || []);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchChannels();
    fetchRecs();
    fetchNewsList();
    if (authenticated) fetchMyChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  const handleAddChannel = async () => {
    if (!selectedChannelId) { toast.error('اختر قناة من القائمة'); return; }
    const ch = myChannels.find((c) => c.channel_id === selectedChannelId);
    if (!ch) return;
    setScraping(true);
    try {
      const res = await fetch('/api/telegram/channels/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: ch.channel_id,
          channel_name: ch.channel_name,
          username: ch.username,
          market: newChannelMarket,
          content_type: newChannelType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setSelectedChannelId('');
        fetchChannels();
        toast.success('تمت إضافة القناة');
      } else {
        toast.error(data.error || 'خطأ في الإضافة');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setScraping(false);
    }
  };

  const handleRemoveChannel = async (channelId: string) => {
    try {
      const res = await fetch(`/api/telegram/channels/untrack/${channelId}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        fetchChannels();
        toast.success('تمت إزالة القناة');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    }
  };

  const handleScrape = async () => {
    setScraping(true);
    try {
      const res = await fetch('/api/telegram/scrape/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 7, limit: 100 }),
      });
      const data = await res.json().catch(() => ({}));
      toast.success(`تم سحب ${data.results?.length || 0} قناة`);
      fetchRecs();
      fetchNewsList();
    } catch {
      toast.error('خطأ في السحب');
    } finally {
      setScraping(false);
    }
  };

  const fetchMessages = async (channelId: string) => {
    if (!channelId) return;
    setLoadingMessages(true);
    setMessages([]);
    try {
      const res = await fetch('/api/telegram/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: channelId, limit: 20, days: 7 }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success && data.messages) setMessages(data.messages);
      else toast.error(data.error || 'فشل في سحب الرسائل');
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleCleanMessage = async (msgId: number, text: string) => {
    setProcessingMsg(msgId);
    try {
      const res = await fetch('/api/telegram/ai/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setCleanedTexts((prev) => ({ ...prev, [msgId]: data.text }));
        toast.success(`تم التنظيف بواسطة ${data.engine || 'AI'}`);
      } else {
        toast.error('AI غير متاح - استخدم النص الأصلي');
      }
    } catch {
      toast.error('خطأ في المعالجة');
    } finally {
      setProcessingMsg(null);
    }
  };

  const handleSaveMessage = async (msgId: number, type: 'recommendation' | 'news') => {
    const text = cleanedTexts[msgId] || messages.find((m) => m.message_id === msgId)?.text || '';
    if (!text) return;
    setSaving(true);
    try {
      const channel = channels.find((c) => c.channel_id === selectedChannelForMessages);
      const res = await fetch('/api/telegram/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          original_text: messages.find((m) => m.message_id === msgId)?.text || '',
          reasoning: text,
          channel_name: channel?.channel_name || '',
          market: channel?.market || 'egypt',
          symbol: '',
          action: 'buy',
          entry_price: 0,
          target_price: 0,
          stop_loss: 0,
          confidence: 0.5,
          title: text.substring(0, 100),
          summary: text,
          sentiment: 'neutral',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        toast.success(type === 'recommendation' ? 'تم حفظ التوقّع ✓' : 'تم حفظ الخبر ✓');
        fetchRecs();
        fetchNewsList();
      } else {
        toast.error(data.error || 'فشل الحفظ');
      }
    } catch {
      toast.error('خطأ في الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const getMarketLabel = (market: string) => {
    const labels: Record<string, string> = {
      egypt: '🇪🇬 مصر', saudi: '🇸🇦 السعودية', kuwait: '🇰🇼 الكويت',
      qatar: '🇶🇦 قطر', crypto: '₿ عملات رقمية', general: '🌍 عام',
    };
    return labels[market] || market;
  };

  const getActionBadge = (action: string) => {
    const colors: Record<string, string> = {
      buy: 'bg-profit', sell: 'bg-loss', hold: 'bg-warning',
    };
    return colors[action] || 'bg-muted';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-profit" />
          أدوات البوت القديم
        </CardTitle>
        <CardDescription>
          تتبع القنوات، سحب المحتوى، تنظيفه بالـ AI وحفظه كتوقعات/أخبار
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={sub} onValueChange={setSub}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="channels"><Users className="h-3.5 w-3.5 ml-1" />القنوات</TabsTrigger>
            <TabsTrigger value="content"><FileText className="h-3.5 w-3.5 ml-1" />المحتوى</TabsTrigger>
            <TabsTrigger value="recommendations"><TrendingUp className="h-3.5 w-3.5 ml-1" />التوقعات</TabsTrigger>
            <TabsTrigger value="news"><Newspaper className="h-3.5 w-3.5 ml-1" />الأخبار</TabsTrigger>
          </TabsList>

          {/* Channels */}
          <TabsContent value="channels" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-3">
                <p className="text-sm font-medium">إضافة قناة للمتابعة</p>
                {loadingChannels ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> جاري تحميل قنواتك...
                  </div>
                ) : myChannels.length === 0 ? (
                  <div className="text-sm text-muted-foreground p-3 border rounded bg-muted/50">
                    {authenticated ? 'لم يتم العثور على قنوات. تأكد من اشتراكك.' : 'يجب المصادقة أولاً.'}
                  </div>
                ) : (
                  <select
                    className="w-full p-2 border rounded bg-background text-sm"
                    value={selectedChannelId}
                    onChange={(e) => setSelectedChannelId(e.target.value)}
                  >
                    <option value="">-- اختر قناة --</option>
                    {myChannels.map((ch) => (
                      <option key={ch.channel_id} value={ch.channel_id}>
                        {ch.channel_name}
                        {ch.members ? ` (${ch.members.toLocaleString()} عضو)` : ''}
                        {ch.username ? ` @${ch.username}` : ''}
                      </option>
                    ))}
                  </select>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="p-2 border rounded bg-background text-sm"
                    value={newChannelMarket}
                    onChange={(e) => setNewChannelMarket(e.target.value)}
                  >
                    <option value="egypt">🇪🇬 مصر (EGX)</option>
                    <option value="saudi">🇸🇦 السعودية</option>
                    <option value="kuwait">🇰🇼 الكويت</option>
                    <option value="crypto">₿ عملات رقمية</option>
                    <option value="general">🌍 عام</option>
                  </select>
                  <select
                    className="p-2 border rounded bg-background text-sm"
                    value={newChannelType}
                    onChange={(e) => setNewChannelType(e.target.value)}
                  >
                    <option value="recommendations">توقعات</option>
                    <option value="news">أخبار</option>
                    <option value="analysis">تحليلات</option>
                    <option value="general">عام</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={fetchMyChannels} disabled={loadingChannels}>
                    <RefreshCw className={cn('h-4 w-4 ml-1', loadingChannels && 'animate-spin')} />
                    تحديث
                  </Button>
                  <Button size="sm" onClick={handleAddChannel} disabled={scraping || !selectedChannelId}>
                    <Plus className="h-4 w-4 ml-1" /> إضافة
                  </Button>
                  <Button size="sm" variant="secondary" onClick={handleScrape} disabled={scraping}>
                    {scraping ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <RefreshCw className="h-4 w-4 ml-1" />}
                    سحب الكل
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">القنوات المتابعة ({channels.length})</p>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {channels.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4 text-sm">لا توجد قنوات متابعة</p>
                  ) : (
                    channels.map((c) => (
                      <div key={c.channel_id} className="flex items-center justify-between p-2 border rounded">
                        <div>
                          <p className="font-medium text-sm">{c.channel_name}</p>
                          <div className="flex gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">{getMarketLabel(c.market)}</Badge>
                            <Badge variant="secondary" className="text-xs">{c.content_type}</Badge>
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRemoveChannel(c.channel_id)}>
                          <Trash2 className="h-3.5 w-3.5 text-loss" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Content */}
          <TabsContent value="content" className="space-y-3 mt-4">
            <div className="flex items-center gap-2">
              <select
                className="w-full p-2 border rounded bg-background text-sm"
                value={selectedChannelForMessages}
                onChange={(e) => {
                  setSelectedChannelForMessages(e.target.value);
                  if (e.target.value) fetchMessages(e.target.value);
                }}
              >
                <option value="">-- اختر قناة --</option>
                {channels.map((c) => (
                  <option key={c.channel_id} value={c.channel_id}>
                    {c.channel_name} ({getMarketLabel(c.market)})
                  </option>
                ))}
              </select>
              {selectedChannelForMessages && (
                <Button variant="outline" size="sm" onClick={() => fetchMessages(selectedChannelForMessages)} disabled={loadingMessages}>
                  <RefreshCw className={cn('h-4 w-4', loadingMessages && 'animate-spin')} />
                </Button>
              )}
            </div>
            {loadingMessages ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <EmptyState icon={<FileText className="h-10 w-10" />} text={selectedChannelForMessages ? 'لا توجد رسائل' : 'اختر قناة لعرض المحتوى'} />
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {messages.map((msg) => (
                  <Card key={msg.message_id} className={cn('border-r-4', msg.is_reply ? 'border-r-fuchsia-500' : 'border-r-emerald-500')}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-xs">
                          {formatDateTime(msg.date)}
                        </Badge>
                        <div className="flex items-center gap-2">
                          {msg.is_reply && (
                            <Badge variant="secondary" className="text-xs">
                              <Reply className="h-3 w-3 ml-1" /> رد
                            </Badge>
                          )}
                          {msg.views != null && <span className="text-xs text-muted-foreground">👁 {msg.views}</span>}
                        </div>
                      </div>
                      {msg.is_reply && msg.reply_to_text && (
                        <div className="p-2 rounded bg-fuchsia-50 dark:bg-fuchsia-950/30 border-r-2 border-fuchsia-300 text-xs">
                          <p className="line-clamp-2 text-muted-foreground">{msg.reply_to_text}</p>
                        </div>
                      )}
                      <p className="text-sm whitespace-pre-wrap line-clamp-4">{msg.text}</p>
                      {cleanedTexts[msg.message_id] && (
                        <div className="p-2 rounded bg-profit/10 border border-profit text-xs">
                          <div className="flex items-center gap-1 mb-1 text-profit ">
                            <Sparkles className="h-3 w-3" /> <span className="font-medium">بعد التنظيف</span>
                          </div>
                          <p className="whitespace-pre-wrap">{cleanedTexts[msg.message_id]}</p>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleCleanMessage(msg.message_id, msg.text)} disabled={processingMsg === msg.message_id}>
                          {processingMsg === msg.message_id ? <Loader2 className="h-3.5 w-3.5 ml-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 ml-1" />}
                          تنظيف بالـ AI
                        </Button>
                        <Button variant="outline" size="sm" className="text-profit border-profit hover:bg-profit" onClick={() => handleSaveMessage(msg.message_id, 'recommendation')} disabled={saving}>
                          <TrendingUp className="h-3.5 w-3.5 ml-1" /> حفظ كتوقعة
                        </Button>
                        <Button variant="outline" size="sm" className="text-warning border-warning hover:bg-warning" onClick={() => handleSaveMessage(msg.message_id, 'news')} disabled={saving}>
                          <Newspaper className="h-3.5 w-3.5 ml-1" /> حفظ كخبر
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Recommendations */}
          <TabsContent value="recommendations" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">التوقعات المستخرجة ({recommendations.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-right">
                        <th className="p-2">الرمز</th>
                        <th className="p-2">السوق</th>
                        <th className="p-2">الإجراء</th>
                        <th className="p-2">الدخول</th>
                        <th className="p-2">الهدف</th>
                        <th className="p-2">الوقف</th>
                        <th className="p-2">الثقة</th>
                        <th className="p-2">المصدر</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recommendations.length === 0 ? (
                        <tr><td colSpan={8} className="text-center py-4 text-muted-foreground">لا توجد توقعات</td></tr>
                      ) : (
                        recommendations.map((r) => (
                          <tr key={r.id} className="border-b">
                            <td className="p-2 font-bold">{r.symbol}</td>
                            <td className="p-2">{getMarketLabel(r.market)}</td>
                            <td className="p-2"><Badge className={cn('text-foreground', getActionBadge(r.action))}>{r.action}</Badge></td>
                            <td className="p-2">{r.entry_price || '-'}</td>
                            <td className="p-2 text-profit">{r.target_price || '-'}</td>
                            <td className="p-2 text-loss">{r.stop_loss || '-'}</td>
                            <td className="p-2">{(r.confidence * 100).toFixed(0)}%</td>
                            <td className="p-2 text-xs">{r.channel_name}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* News */}
          <TabsContent value="news" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">الأخبار المستخرجة ({news.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {news.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4 text-sm">لا توجد أخبار</p>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto">
                    {news.map((n) => (
                      <div key={n.id} className="p-3 border rounded">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm">{n.title}</p>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{n.channel_name}</span>
                        </div>
                        <div className="flex gap-2 mt-1">
                          <Badge variant="outline" className="text-xs">{getMarketLabel(n.market)}</Badge>
                          <Badge
                            variant={n.sentiment === 'positive' ? 'default' : n.sentiment === 'negative' ? 'destructive' : 'secondary'}
                            className="text-xs"
                          >
                            {n.sentiment}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
