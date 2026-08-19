'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  MessageCircle, 
  Heart, 
  Send, 
  TrendingUp, 
  Bitcoin, 
  Target, 
  Sparkles, 
  FileBarChart,
  Loader2,
  Filter,
  Users,
  ExternalLink,
  Bell
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Social Media Links
const SOCIAL_LINKS = {
  telegram_channel: {
    name: 'قناة التوقعات',
    url: 'https://t.me/Arabian_investment_guide',
    description: 'توقعات وتحليلات البورصة المصرية',
    icon: Bell,
    color: 'bg-blue-500',
  },
  telegram_group: {
    name: 'جروب النقاش',
    url: 'https://t.me/Arabian_investment_guide_chat',
    description: 'نقاش وتعليقات مع المجتمع',
    icon: MessageCircle,
    color: 'bg-cyan-500',
  },
  whatsapp: {
    name: 'واتساب',
    url: 'https://wa.me/201234567890', // TODO: Update with actual number
    description: 'تواصل مباشر معنا',
    icon: Send,
    color: 'bg-green-500',
  },
  whatsapp_group: {
    name: 'جروب واتساب',
    url: 'https://chat.whatsapp.com/L9hjEpJloAZAUvwMzB10Tc',
    description: 'انضم لجروب المجتمع على واتساب',
    icon: MessageCircle,
    color: 'bg-green-600',
  },
};

// Topic/Category filter options
const TOPICS = [
  { id: 'all', label: 'الكل', icon: Users, color: 'bg-gray-500' },
  { id: 'stocks', label: 'البورصة المصرية', icon: TrendingUp, color: 'bg-emerald-500', room_id: 1 },
  { id: 'crypto', label: 'العملات الرقمية', icon: Bitcoin, color: 'bg-orange-500', room_id: 2 },
  { id: 'tips', label: 'نصائح التداول', icon: Target, color: 'bg-yellow-500', room_id: 3 },
  { id: 'success', label: 'قصص النجاح', icon: Sparkles, color: 'bg-purple-500', room_id: 4 },
  { id: 'news', label: 'أخبار السوق', icon: FileBarChart, color: 'bg-blue-500', room_id: 5 },
];

interface Post {
  id: number;
  user_id: number;
  room_id: number;
  content: string;
  likes: number;
  created_at: string;
  user_name: string;
  user_avatar: string;
  room_name: string;
}

interface Room {
  id: number;
  name: string;
  name_ar: string;
  description: string;
  icon: string;
}

interface Comment {
  id: number;
  post_id: number;
  user_id: number;
  content: string;
  created_at: string;
  user_name: string;
  user_avatar: string;
}

export function CommunityView() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newPost, setNewPost] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState('all');
  const [activeFilter, setActiveFilter] = useState<'all' | 'trending' | 'recent'>('recent');
  // المستخدم الحقيقي المسجّل دخوله (إن وُجد) — ممنوع استخدام Math.random لتوليد user_id.
  const [currentUser, setCurrentUser] = useState<{ id: string; name?: string } | null>(null);

  // حالة الردود لكل منشور: المنشورات المفتوحة + تعليقاتها + نص الرد الجاري كتابته.
  const [openReplies, setOpenReplies] = useState<Record<number, boolean>>({});
  const [comments, setComments] = useState<Record<number, Comment[]>>({});
  const [replyDraft, setReplyDraft] = useState<Record<number, string>>({});
  const [replySubmitting, setReplySubmitting] = useState<Record<number, boolean>>({});

  useEffect(() => {
    // جلب المستخدم الحقيقي من /api/auth/me — إن لم يكن مسجّلاً نعرض "زائر" ونمنع النشر.
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.success && data?.user?.id) {
          setCurrentUser({ id: String(data.user.id), name: data.user.name || data.user.username });
        } else {
          setCurrentUser(null);
        }
      })
      .catch(() => setCurrentUser(null));
    fetchPosts();
  }, [selectedTopic]);

  const fetchPosts = async () => {
    setIsLoading(true);
    try {
      const topic = TOPICS.find(t => t.id === selectedTopic);
      const roomId = topic?.room_id;
      const url = roomId 
        ? `/api/community?room_id=${roomId}`
        : '/api/community?all=true';
      
      const response = await fetch(url);
      const data = await response.json();
      if (data.success) {
        let allPosts = data.posts || [];
        
        // If fetching all, sort by filter
        if (selectedTopic === 'all') {
          if (activeFilter === 'trending') {
            allPosts.sort((a: Post, b: Post) => b.likes - a.likes);
          } else {
            allPosts.sort((a: Post, b: Post) => 
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
          }
        }
        
        setPosts(allPosts);
        setRooms(data.rooms || []);
      }
    } catch (error) {
      console.error('Failed to fetch posts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreatePost = async () => {
    if (!newPost.trim() || isSubmitting) return;
    if (!currentUser) {
      // غير مسجّل الدخول — لا ننسب المنشور لمستخدم عشوائي. نطالب بتسجيل الدخول.
      alert('سجّل الدخول أولاً لتتمكن من النشر في المجتمع.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Determine room_id based on selected topic (default to stocks)
      const topic = TOPICS.find(t => t.id === selectedTopic);
      const roomId = topic?.room_id || 1;

      // استخدام الـ user_id الحقيقي من /api/auth/me (ليس قيمة عشوائية).
      const response = await fetch('/api/community', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUser.id,
          room_id: roomId,
          content: newPost.trim(),
        }),
      });

      const data = await response.json();
      if (data.success) {
        setNewPost('');
        fetchPosts();
      } else {
        console.error('Community create post error:', data?.error);
        alert('تعذّر نشر المنشور. تأكّد من تسجيل الدخول ثم حاول مجدداً.');
      }
    } catch (error) {
      console.error('Failed to create post:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const fetchComments = async (postId: number) => {
    try {
      const response = await fetch(`/api/community/posts/${postId}/comments`, { cache: 'no-store' });
      const data = await response.json();
      if (data.success) {
        setComments(prev => ({ ...prev, [postId]: data.comments || [] }));
      }
    } catch (error) {
      console.error('Failed to fetch comments:', error);
    }
  };

  const toggleReplies = (postId: number) => {
    setOpenReplies(prev => {
      const next = { ...prev, [postId]: !prev[postId] };
      if (next[postId] && !comments[postId]) {
        fetchComments(postId);
      }
      return next;
    });
  };

  const handleSendReply = async (postId: number) => {
    const content = (replyDraft[postId] || '').trim();
    if (!content || replySubmitting[postId]) return;
    if (!currentUser) {
      alert('سجّل الدخول أولاً لتتمكن من الرد على المنشورات.');
      return;
    }

    setReplySubmitting(prev => ({ ...prev, [postId]: true }));
    try {
      const response = await fetch(`/api/community/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: currentUser.id, content }),
      });
      const data = await response.json();
      if (data.success) {
        setReplyDraft(prev => ({ ...prev, [postId]: '' }));
        await fetchComments(postId);
      } else {
        console.error('Community create comment error:', data?.error);
        alert('تعذّر إرسال الرد. تأكّد من تسجيل الدخول ثم حاول مجدداً.');
      }
    } catch (error) {
      console.error('Failed to create comment:', error);
    } finally {
      setReplySubmitting(prev => ({ ...prev, [postId]: false }));
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `منذ ${days} يوم`;
    if (hours > 0) return `منذ ${hours} ساعة`;
    if (minutes > 0) return `منذ ${minutes} دقيقة`;
    return 'الآن';
  };

  const getRoomInfo = (roomId: number) => {
    const room = rooms.find(r => r.id === roomId);
    const topic = TOPICS.find(t => t.room_id === roomId);
    return {
      name: room?.name_ar || topic?.label || 'عام',
      color: topic?.color || 'bg-gray-500'
    };
  };

  return (
    <div className="min-h-screen flex flex-col bg-background" dir="rtl">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b">
        <div className="container mx-auto p-4 max-w-4xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 text-white">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">المجتمع</h1>
              <p className="text-muted-foreground text-sm">شارك وتفاعل مع المجتمع</p>
            </div>
          </div>

          {/* Social Media Links */}
          <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
            {Object.entries(SOCIAL_LINKS).map(([key, link]) => {
              const Icon = link.icon;
              return (
                <a
                  key={key}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium transition-all hover:scale-105 flex-shrink-0',
                    link.color
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span>{link.name}</span>
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </a>
              );
            })}
          </div>

          {/* Topic Filters - Horizontal Scrollable */}
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {TOPICS.map((topic) => {
              const Icon = topic.icon;
              const isActive = selectedTopic === topic.id;
              return (
                <Button
                  key={topic.id}
                  variant={isActive ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedTopic(topic.id)}
                  className={cn(
                    'gap-2 flex-shrink-0 transition-all',
                    isActive && topic.color
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {topic.label}
                </Button>
              );
            })}
          </div>

          {/* Sort Filters */}
          <div className="flex gap-2 mt-3">
            <Button
              variant={activeFilter === 'recent' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setActiveFilter('recent');
                if (selectedTopic === 'all') fetchPosts();
              }}
            >
              <MessageCircle className="w-4 h-4 ml-1" />
              الأحدث
            </Button>
            <Button
              variant={activeFilter === 'trending' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setActiveFilter('trending');
                if (selectedTopic === 'all') fetchPosts();
              }}
            >
              <TrendingUp className="w-4 h-4 ml-1" />
              الأكثر تفاعلاً
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 container mx-auto p-4 max-w-4xl">
        {/* New Post Input */}
        <Card className="mb-6 border-2 border-primary/20">
          <CardContent className="p-4">
            <div className="flex gap-3">
              <Avatar className="w-10 h-10">
                <AvatarFallback className="bg-primary text-primary-foreground">
                  {currentUser?.name?.charAt(0) || 'ز'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <Input
                  placeholder={
                    currentUser
                      ? "شارك رأيك أو سؤالك مع المجتمع..."
                      : "سجّل الدخول لتتمكن من المشاركة في المجتمع..."
                  }
                  value={newPost}
                  onChange={(e) => setNewPost(e.target.value)}
                  disabled={!currentUser}
                  className="mb-2 border-0 bg-muted/50 focus-visible:ring-2"
                />
                <div className="flex justify-between items-center">
                  <div className="flex gap-2 items-center">
                    {selectedTopic !== 'all' && (
                      <Badge variant="secondary" className="text-xs">
                        نشر في: {TOPICS.find(t => t.id === selectedTopic)?.label}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {currentUser ? `مرحباً، ${currentUser.name || 'مستخدم'}` : 'زائر — سجّل الدخول للنشر'}
                    </span>
                  </div>
                  <Button
                    onClick={handleCreatePost}
                    disabled={!newPost.trim() || isSubmitting || !currentUser}
                    size="sm"
                    className="gap-2"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        نشر
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Posts List */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : posts.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <MessageCircle className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-lg font-semibold">لا توجد منشورات بعد</p>
              <p className="text-muted-foreground">كن أول من يشارك!</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => {
              const roomInfo = getRoomInfo(post.room_id);
              return (
                <Card key={post.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex gap-3">
                      <Avatar className="w-10 h-10">
                        <AvatarImage src={post.user_avatar} alt={post.user_name} />
                        <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
                          {post.user_name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-semibold text-sm">{post.user_name}</span>
                          <Badge className={cn('text-xs text-white', roomInfo.color)}>
                            {roomInfo.name}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatTime(post.created_at)}
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap mb-3">
                          {post.content}
                        </p>
                        <div className="flex items-center gap-4">
                          <button className="flex items-center gap-1 text-muted-foreground hover:text-red-500 transition-colors group">
                            <Heart className="w-4 h-4 group-hover:scale-110 transition-transform" />
                            <span className="text-xs">{post.likes || 0}</span>
                          </button>
                          <button
                            onClick={() => toggleReplies(post.id)}
                            className={cn(
                              'flex items-center gap-1 transition-colors',
                              openReplies[post.id] ? 'text-blue-500' : 'text-muted-foreground hover:text-blue-500'
                            )}
                          >
                            <MessageCircle className="w-4 h-4" />
                            <span className="text-xs">
                              {(comments[post.id]?.length || 0) > 0
                                ? `رد (${comments[post.id].length})`
                                : 'رد'}
                            </span>
                          </button>
                        </div>
                        {openReplies[post.id] && (
                          <div className="mt-3 pt-3 border-t space-y-3">
                            {(comments[post.id] || []).map((comment) => (
                              <div key={comment.id} className="flex gap-2">
                                <Avatar className="w-7 h-7">
                                  <AvatarImage src={comment.user_avatar} alt={comment.user_name} />
                                  <AvatarFallback className="bg-gradient-to-br from-sky-500 to-indigo-600 text-white text-xs">
                                    {comment.user_name.charAt(0)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <span className="font-semibold text-xs">{comment.user_name}</span>
                                    <span className="text-[10px] text-muted-foreground">
                                      {formatTime(comment.created_at)}
                                    </span>
                                  </div>
                                  <p className="text-xs leading-relaxed whitespace-pre-wrap">
                                    {comment.content}
                                  </p>
                                </div>
                              </div>
                            ))}

                            {currentUser ? (
                              <div className="flex gap-2 items-start pt-1">
                                <Avatar className="w-7 h-7">
                                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                                    {currentUser?.name?.charAt(0) || 'ز'}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 flex gap-2">
                                  <Input
                                    placeholder="اكتب رداً..."
                                    value={replyDraft[post.id] || ''}
                                    onChange={(e) => setReplyDraft(prev => ({ ...prev, [post.id]: e.target.value }))}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSendReply(post.id);
                                      }
                                    }}
                                    className="h-9 text-xs bg-muted/50 focus-visible:ring-1"
                                  />
                                  <Button
                                    size="sm"
                                    onClick={() => handleSendReply(post.id)}
                                    disabled={!replyDraft[post.id]?.trim() || replySubmitting[post.id]}
                                    className="h-9 px-3"
                                  >
                                    {replySubmitting[post.id] ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Send className="w-4 h-4" />
                                    )}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground text-center pt-1">
                                سجّل الدخول للرد على هذا المنشور.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Export individual views for each room (for backward compatibility)
export function CommunityStocksView() {
  return <CommunityView />;
}

export function CommunityCryptoView() {
  return <CommunityView />;
}

export function CommunityTipsView() {
  return <CommunityView />;
}

export function CommunitySuccessView() {
  return <CommunityView />;
}

export function CommunityNewsView() {
  return <CommunityView />;
}
