'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  MessageSquare, TrendingUp, Bitcoin, Lightbulb, Trophy, Newspaper,
  ThumbsUp, Eye, MessageCircle, Share2, ChevronRight, Clock, MapPin
} from 'lucide-react';

interface CommunityRoom {
  id: string;
  name: string;
  name_ar: string;
  description_ar: string;
  icon: string;
  color: string;
  category: string;
}

interface CommunityUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_verified: number;
  is_bot: number;
}

interface CommunityPost {
  id: string;
  user_id: string;
  room_id: string;
  content: string;
  post_type: string;
  views: number;
  likes_count: number;
  comments_count: number;
  trade_ticker: string | null;
  trade_result: string | null;
  trade_profit_percent: number | null;
  created_at: string;
  user?: CommunityUser;
}

const roomIcons: Record<string, React.ElementType> = {
  'trending-up': TrendingUp,
  'bitcoin': Bitcoin,
  'lightbulb': Lightbulb,
  'trophy': Trophy,
  'newspaper': Newspaper,
};

const postTypeColors: Record<string, string> = {
  discussion: 'bg-blue-100 text-blue-800',
  trade: 'bg-green-100 text-green-800',
  tip: 'bg-purple-100 text-purple-800',
  news: 'bg-orange-100 text-orange-800',
  question: 'bg-yellow-100 text-yellow-800',
};

const postTypeLabels: Record<string, string> = {
  discussion: 'مناقشة',
  trade: 'صفقة',
  tip: 'نصيحة',
  news: 'خبر',
  question: 'سؤال',
};

export default function CommunityPage() {
  const [rooms, setRooms] = useState<CommunityRoom[]>([]);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedPost, setExpandedPost] = useState<string | null>(null);

  useEffect(() => {
    fetchCommunityData();
  }, [selectedRoom]);

  const fetchCommunityData = async () => {
    setLoading(true);
    try {
      const url = selectedRoom 
        ? `/api/community?room_id=${selectedRoom}` 
        : '/api/community';
      const res = await fetch(url);
      const data = await res.json();
      
      if (data.success) {
        setRooms(data.rooms);
        setPosts(data.posts);
      }
    } catch (error) {
      console.error('Failed to fetch community data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `من ${diffDays} يوم`;
    if (diffHours > 0) return `من ${diffHours} ساعة`;
    if (diffMins > 0) return `من ${diffMins} دقيقة`;
    return 'الآن';
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
      {/* Header */}
      <header className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white py-8 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <MessageSquare className="w-8 h-8" />
            <h1 className="text-3xl font-bold">المجتمع</h1>
          </div>
          <p className="text-emerald-100 text-lg">
            انضم للنقاشات مع المستثمرين المصريين في البورصة والعملات الرقمية
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Rooms Grid */}
        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4 text-slate-800 dark:text-white">الغرف</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {rooms.map((room) => {
              const IconComponent = roomIcons[room.icon] || MessageSquare;
              const isSelected = selectedRoom === room.id;
              
              return (
                <Card 
                  key={room.id}
                  className={`cursor-pointer transition-all hover:shadow-lg ${
                    isSelected ? 'ring-2 ring-emerald-500 shadow-lg' : ''
                  }`}
                  onClick={() => setSelectedRoom(isSelected ? null : room.id)}
                >
                  <CardContent className="p-4 text-center">
                    <div 
                      className="w-12 h-12 rounded-full mx-auto mb-2 flex items-center justify-center"
                      style={{ backgroundColor: room.color + '20' }}
                    >
                      <IconComponent className="w-6 h-6" style={{ color: room.color }} />
                    </div>
                    <h3 className="font-semibold text-sm">{room.name_ar}</h3>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Posts Feed */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-slate-800 dark:text-white">
              {selectedRoom 
                ? rooms.find(r => r.id === selectedRoom)?.name_ar 
                : 'آخر المنشورات'}
            </h2>
            {selectedRoom && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedRoom(null)}>
                عرض الكل
              </Button>
            )}
          </div>

          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="p-4">
                    <div className="h-4 bg-slate-200 rounded w-3/4 mb-2"></div>
                    <div className="h-4 bg-slate-200 rounded w-1/2"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {posts.map((post) => (
                <Card key={post.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    {/* User Info */}
                    <div className="flex items-start gap-3 mb-3">
                      <Avatar className="w-10 h-10">
                        <AvatarImage src={post.user?.avatar_url || ''} />
                        <AvatarFallback className="bg-emerald-100 text-emerald-700">
                          {post.user?.display_name?.charAt(0) || 'م'}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-800 dark:text-white">
                            {post.user?.display_name}
                          </span>
                          {post.user?.is_verified === 1 && (
                            <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">
                              موثق
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Clock className="w-3 h-3" />
                          <span>{formatTimeAgo(post.created_at)}</span>
                        </div>
                      </div>
                      <Badge className={postTypeColors[post.post_type] || ''}>
                        {postTypeLabels[post.post_type] || post.post_type}
                      </Badge>
                    </div>

                    {/* Post Content */}
                    <p className="text-slate-700 dark:text-slate-200 leading-relaxed mb-3 whitespace-pre-wrap">
                      {post.content}
                    </p>

                    {/* Trade Info */}
                    {post.post_type === 'trade' && post.trade_ticker && (
                      <div className={`p-3 rounded-lg mb-3 ${
                        post.trade_result === 'profit' 
                          ? 'bg-green-50 border border-green-200' 
                          : post.trade_result === 'loss'
                            ? 'bg-red-50 border border-red-200'
                            : 'bg-slate-50 border border-slate-200'
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold">{post.trade_ticker}</span>
                          {post.trade_profit_percent && (
                            <span className={`font-bold ${
                              post.trade_profit_percent > 0 ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {post.trade_profit_percent > 0 ? '+' : ''}{post.trade_profit_percent.toFixed(1)}%
                            </span>
                          )}
                        </div>
                        {post.trade_entry_price && (
                          <div className="text-sm text-slate-600">
                            سعر الدخول: {post.trade_entry_price} 
                            {post.trade_exit_price && ` → سعر الخروج: ${post.trade_exit_price}`}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-4 text-sm text-slate-500">
                      <button className="flex items-center gap-1 hover:text-emerald-600 transition-colors">
                        <ThumbsUp className="w-4 h-4" />
                        <span>{post.likes_count}</span>
                      </button>
                      <button className="flex items-center gap-1 hover:text-blue-600 transition-colors">
                        <MessageCircle className="w-4 h-4" />
                        <span>{post.comments_count}</span>
                      </button>
                      <button className="flex items-center gap-1 hover:text-slate-700 transition-colors">
                        <Eye className="w-4 h-4" />
                        <span>{post.views}</span>
                      </button>
                      <button className="flex items-center gap-1 hover:text-purple-600 transition-colors mr-auto">
                        <Share2 className="w-4 h-4" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {posts.length === 0 && (
                <Card>
                  <CardContent className="p-8 text-center text-slate-500">
                    <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>لا توجد منشورات حالياً</p>
                    <p className="text-sm mt-2">قم بتوليد البيانات من خلال API</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </section>

        {/* Stats Section */}
        <section className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20">
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-emerald-600">{posts.length}</div>
              <div className="text-sm text-slate-600">منشور</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-blue-600">{rooms.length}</div>
              <div className="text-sm text-slate-600">غرفة</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20">
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-purple-600">20</div>
              <div className="text-sm text-slate-600">عضو نشط</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-orange-50 to-yellow-50 dark:from-orange-900/20 dark:to-yellow-900/20">
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-orange-600">+50</div>
              <div className="text-sm text-slate-600">تعليق</div>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
