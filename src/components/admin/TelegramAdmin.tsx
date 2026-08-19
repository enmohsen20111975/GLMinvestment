'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  MessageSquare, Send, RefreshCw, CheckCircle, XCircle, 
  TrendingUp, Newspaper, Users, Settings, Phone, Key, Plus, Trash2
} from 'lucide-react';

const TELEGRAM_PORT = 8010; // vps-service

interface TelegramStatus {
  success: boolean;
  connected: boolean;
  authorized: boolean;
  stats: {
    active_channels: number;
    total_messages: number;
    total_recommendations: number;
    total_news: number;
    by_market: Record<string, number>;
  };
}

interface Channel {
  channel_id: string;
  channel_name: string;
  username?: string;
  market: string;
  content_type: string;
  is_active: number;
}

interface Recommendation {
  id: number;
  symbol: string;
  market: string;
  action: string;
  entry_price?: number;
  target_price?: number;
  stop_loss?: number;
  confidence: number;
  channel_name: string;
  created_at: string;
}

interface News {
  id: number;
  title: string;
  market: string;
  sentiment: string;
  importance: number;
  channel_name: string;
  created_at: string;
}

export function TelegramAdmin() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [news, setNews] = useState<News[]>([]);
  const [loading, setLoading] = useState(false);
  const [authStep, setAuthStep] = useState<'idle' | 'code' | 'password' | 'done'>('idle');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [newChannelId, setNewChannelId] = useState('');
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelMarket, setNewChannelMarket] = useState('egypt');
  const [newChannelType, setNewChannelType] = useState('recommendations');

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/telegram/status?XTransformPort=${TELEGRAM_PORT}`);
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      console.error('Error fetching status:', error);
    }
  };

  const fetchChannels = async () => {
    try {
      const res = await fetch(`/api/telegram/channels/tracked?XTransformPort=${TELEGRAM_PORT}`);
      const data = await res.json();
      setChannels(data.channels || []);
    } catch (error) {
      console.error('Error fetching channels:', error);
    }
  };

  const fetchRecommendations = async () => {
    try {
      const res = await fetch(`/api/telegram/recommendations?XTransformPort=${TELEGRAM_PORT}&limit=20`);
      const data = await res.json();
      setRecommendations(data.recommendations || []);
    } catch (error) {
      console.error('Error fetching recommendations:', error);
    }
  };

  const fetchNews = async () => {
    try {
      const res = await fetch(`/api/telegram/news?XTransformPort=${TELEGRAM_PORT}&limit=20`);
      const data = await res.json();
      setNews(data.news || []);
    } catch (error) {
      console.error('Error fetching news:', error);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchChannels();
    fetchRecommendations();
    fetchNews();
  }, []);

  const handleConnectUser = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/telegram/auth/connect-user?XTransformPort=${TELEGRAM_PORT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      
      if (data.needs_code) {
        setAuthStep('code');
      } else if (data.authorized) {
        setAuthStep('done');
        fetchStatus();
      }
      
      alert(data.message || JSON.stringify(data));
    } catch (error) {
      alert('Error connecting');
    }
    setLoading(false);
  };

  const handleVerifyCode = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/telegram/auth/verify-code?XTransformPort=${TELEGRAM_PORT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code })
      });
      const data = await res.json();
      
      if (data.needs_password) {
        setAuthStep('password');
      } else if (data.success) {
        setAuthStep('done');
        fetchStatus();
      }
      
      alert(data.message || JSON.stringify(data));
    } catch (error) {
      alert('Error verifying code');
    }
    setLoading(false);
  };

  const handleVerifyPassword = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/telegram/auth/verify-password?XTransformPort=${TELEGRAM_PORT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      
      if (data.success) {
        setAuthStep('done');
        fetchStatus();
      }
      
      alert(data.message || JSON.stringify(data));
    } catch (error) {
      alert('Error verifying password');
    }
    setLoading(false);
  };

  const handleAddChannel = async () => {
    if (!newChannelId) return;
    
    setLoading(true);
    try {
      const res = await fetch(`/api/telegram/channels/track?XTransformPort=${TELEGRAM_PORT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: newChannelId,
          channel_name: newChannelName,
          market: newChannelMarket,
          content_type: newChannelType
        })
      });
      const data = await res.json();
      
      if (data.success) {
        setNewChannelId('');
        setNewChannelName('');
        fetchChannels();
      }
      
      alert(data.message || 'Channel added');
    } catch (error) {
      alert('Error adding channel');
    }
    setLoading(false);
  };

  const handleRemoveChannel = async (channelId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/telegram/channels/untrack/${channelId}?XTransformPort=${TELEGRAM_PORT}`, {
        method: 'POST'
      });
      const data = await res.json();
      
      if (data.success) {
        fetchChannels();
      }
    } catch (error) {
      alert('Error removing channel');
    }
    setLoading(false);
  };

  const handleScrape = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/telegram/scrape/all?XTransformPort=${TELEGRAM_PORT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 7, limit: 100 })
      });
      const data = await res.json();
      alert(`Scraped ${data.results?.length || 0} channels`);
      fetchRecommendations();
      fetchNews();
      fetchStatus();
    } catch (error) {
      alert('Error scraping');
    }
    setLoading(false);
  };

  const getMarketLabel = (market: string) => {
    const labels: Record<string, string> = {
      egypt: '🇪🇬 مصر',
      saudi: '🇸🇦 السعودية',
      kuwait: '🇰🇼 الكويت',
      qatar: '🇶🇦 قطر',
      crypto: '₿ عملات رقمية',
      general: '🌍 عام'
    };
    return labels[market] || market;
  };

  const getActionBadge = (action: string) => {
    const colors: Record<string, string> = {
      buy: 'bg-green-500',
      sell: 'bg-red-500',
      hold: 'bg-yellow-500'
    };
    return colors[action] || 'bg-gray-500';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Telegram Data Service</h2>
        <Button onClick={() => { fetchStatus(); fetchChannels(); fetchRecommendations(); fetchNews(); }}>
          <RefreshCw className="h-4 w-4 mr-2" />
          تحديث
        </Button>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">الحالة</p>
                <p className="text-lg font-bold">
                  {status?.connected ? (
                    <span className="text-green-500">متصل</span>
                  ) : (
                    <span className="text-red-500">غير متصل</span>
                  )}
                </p>
              </div>
              <MessageSquare className={`h-8 w-8 ${status?.connected ? 'text-green-500' : 'text-red-500'}`} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">القنوات النشطة</p>
                <p className="text-2xl font-bold">{status?.stats?.active_channels || 0}</p>
              </div>
              <Users className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">التوقعات</p>
                <p className="text-2xl font-bold">{status?.stats?.total_recommendations || 0}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">الأخبار</p>
                <p className="text-2xl font-bold">{status?.stats?.total_news || 0}</p>
              </div>
              <Newspaper className="h-8 w-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="auth" className="space-y-4">
        <TabsList>
          <TabsTrigger value="auth">
            <Key className="h-4 w-4 mr-2" />
            المصادقة
          </TabsTrigger>
          <TabsTrigger value="channels">
            <Users className="h-4 w-4 mr-2" />
            القنوات
          </TabsTrigger>
          <TabsTrigger value="recommendations">
            <TrendingUp className="h-4 w-4 mr-2" />
            التوقعات
          </TabsTrigger>
          <TabsTrigger value="news">
            <Newspaper className="h-4 w-4 mr-2" />
            الأخبار
          </TabsTrigger>
        </TabsList>

        {/* Auth Tab */}
        <TabsContent value="auth">
          <Card>
            <CardHeader>
              <CardTitle>المصادقة على Telegram</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {status?.authorized ? (
                <div className="flex items-center gap-2 text-green-500">
                  <CheckCircle className="h-5 w-5" />
                  <span>تم المصادقة بنجاح - يمكنك سحب البيانات</span>
                </div>
              ) : (
                <div className="space-y-4">
                  {authStep === 'idle' && (
                    <>
                      <p className="text-sm text-muted-foreground">
                        للمصادقة كمستخدم (لقراءة الرسائل)، أدخل رقم الهاتف
                      </p>
                      <div className="flex gap-2">
                        <Input
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+201234567890"
                          className="max-w-xs"
                        />
                        <Button onClick={handleConnectUser} disabled={loading}>
                          <Phone className="h-4 w-4 mr-2" />
                          إرسال رمز التحقق
                        </Button>
                      </div>
                    </>
                  )}

                  {authStep === 'code' && (
                    <>
                      <p className="text-sm text-muted-foreground">
                        تم إرسال رمز التحقق إلى Telegram. أدخل الرمز:
                      </p>
                      <div className="flex gap-2">
                        <Input
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          placeholder="12345"
                          className="max-w-xs"
                        />
                        <Button onClick={handleVerifyCode} disabled={loading}>
                          تحقق
                        </Button>
                      </div>
                    </>
                  )}

                  {authStep === 'password' && (
                    <>
                      <p className="text-sm text-muted-foreground">
                        الحساب محمي بكلمة مرور 2FA. أدخل كلمة المرور:
                      </p>
                      <div className="flex gap-2">
                        <Input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="كلمة المرور"
                          className="max-w-xs"
                        />
                        <Button onClick={handleVerifyPassword} disabled={loading}>
                          تحقق
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {status?.authorized && (
                <Button onClick={handleScrape} disabled={loading}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  سحب البيانات الآن
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Channels Tab */}
        <TabsContent value="channels">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Add Channel */}
            <Card>
              <CardHeader>
                <CardTitle>إضافة قناة جديدة</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={newChannelId}
                    onChange={(e) => setNewChannelId(e.target.value)}
                    placeholder="معرف القناة أو @username"
                  />
                  <Input
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value)}
                    placeholder="اسم القناة"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select 
                    className="p-2 border rounded"
                    value={newChannelMarket}
                    onChange={(e) => setNewChannelMarket(e.target.value)}
                  >
                    <option value="egypt">🇪🇬 مصر (EGX)</option>
                    <option value="saudi">🇸🇦 السعودية (TADAWUL)</option>
                    <option value="kuwait">🇰🇼 الكويت (KSE)</option>
                    <option value="qatar">🇶🇦 قطر (QSE)</option>
                    <option value="crypto">₿ عملات رقمية</option>
                    <option value="general">🌍 عام</option>
                  </select>
                  <select 
                    className="p-2 border rounded"
                    value={newChannelType}
                    onChange={(e) => setNewChannelType(e.target.value)}
                  >
                    <option value="recommendations">توقعات</option>
                    <option value="news">أخبار</option>
                    <option value="analysis">تحليلات</option>
                    <option value="general">عام</option>
                  </select>
                </div>
                <Button onClick={handleAddChannel} disabled={loading}>
                  <Plus className="h-4 w-4 mr-2" />
                  إضافة
                </Button>
              </CardContent>
            </Card>

            {/* Channels List */}
            <Card>
              <CardHeader>
                <CardTitle>القنوات المتابعة ({channels.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {channels.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">لا توجد قنوات متابعة</p>
                  ) : (
                    channels.map((channel) => (
                      <div key={channel.channel_id} className="flex items-center justify-between p-2 border rounded">
                        <div>
                          <p className="font-medium">{channel.channel_name}</p>
                          <div className="flex gap-2">
                            <Badge variant="outline">{getMarketLabel(channel.market)}</Badge>
                            <Badge variant="secondary">{channel.content_type}</Badge>
                          </div>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => handleRemoveChannel(channel.channel_id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Recommendations Tab */}
        <TabsContent value="recommendations">
          <Card>
            <CardHeader>
              <CardTitle>التوقعات المستخرجة ({recommendations.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-right p-2">الرمز</th>
                      <th className="text-right p-2">السوق</th>
                      <th className="text-right p-2">الإجراء</th>
                      <th className="text-right p-2">الدخول</th>
                      <th className="text-right p-2">الهدف</th>
                      <th className="text-right p-2">الوقف</th>
                      <th className="text-right p-2">الثقة</th>
                      <th className="text-right p-2">المصدر</th>
                      <th className="text-right p-2">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recommendations.map((rec) => (
                      <tr key={rec.id} className="border-b">
                        <td className="p-2 font-bold">{rec.symbol}</td>
                        <td className="p-2">{getMarketLabel(rec.market)}</td>
                        <td className="p-2">
                          <Badge className={getActionBadge(rec.action)}>{rec.action}</Badge>
                        </td>
                        <td className="p-2">{rec.entry_price || '-'}</td>
                        <td className="p-2 text-green-500">{rec.target_price || '-'}</td>
                        <td className="p-2 text-red-500">{rec.stop_loss || '-'}</td>
                        <td className="p-2">{(rec.confidence * 100).toFixed(0)}%</td>
                        <td className="p-2 text-sm">{rec.channel_name}</td>
                        <td className="p-2 text-sm">{new Date(rec.created_at).toLocaleDateString('ar-EG')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* News Tab */}
        <TabsContent value="news">
          <Card>
            <CardHeader>
              <CardTitle>الأخبار المستخرجة ({news.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {news.map((item) => (
                  <div key={item.id} className="p-3 border rounded">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">{item.title}</p>
                        <div className="flex gap-2 mt-1">
                          <Badge variant="outline">{getMarketLabel(item.market)}</Badge>
                          <Badge variant={item.sentiment === 'positive' ? 'default' : item.sentiment === 'negative' ? 'destructive' : 'secondary'}>
                            {item.sentiment}
                          </Badge>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">{item.channel_name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
