'use client';

import React, { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { 
 TrendingUp, TrendingDown, Minus, Star, Eye, Heart, MessageCircle, 
 Coins, Trophy, Target, Zap, Gift, CreditCard, ExternalLink, 
 CheckCircle, XCircle, Clock, Users, Crown, Medal, Award
} from 'lucide-react';
import { toast } from 'sonner';

interface UserPost {
 id: string;
 user_id: string;
 ticker: string;
 direction: string;
 entry_price: number | null;
 target_price: number | null;
 stop_loss: number | null;
 timeframe: string | null;
 reasoning: string | null;
 confidence: number;
 status: string;
 outcome: string | null;
 actual_result: number | null;
 views: number;
 likes: number;
 points_earned: number;
 created_at: string;
 User: {
 id: string;
 name: string | null;
 username: string | null;
 image: string | null;
 };
 currentPrice?: number | null;
 priceChange?: number | null;
}

interface PointsPackage {
 id: string;
 name: string;
 name_ar: string;
 points: number;
 price_egp: number;
 bonus_points: number;
}

interface UserPoints {
 id: string;
 total_points: number;
 available_points: number;
 level: number;
 posts_points: number;
 purchase_points: number;
}

export function UserPublishingView() {
 const user = useAppStore((s) => s.user);
 const [activeTab, setActiveTab] = useState('feed');
 const [posts, setPosts] = useState<UserPost[]>([]);
 const [userPoints, setUserPoints] = useState<UserPoints | null>(null);
 const [packages, setPackages] = useState<PointsPackage[]>([]);
 const [loading, setLoading] = useState(true);
 const [submitting, setSubmitting] = useState(false);
 
 // Form state
 const [ticker, setTicker] = useState('');
 const [direction, setDirection] = useState('buy');
 const [entryPrice, setEntryPrice] = useState('');
 const [targetPrice, setTargetPrice] = useState('');
 const [stopLoss, setStopLoss] = useState('');
 const [timeframe, setTimeframe] = useState('medium');
 const [reasoning, setReasoning] = useState('');
 const [confidence, setConfidence] = useState(70);

 useEffect(() => {
 loadData();
 }, [user]);

 const loadData = async () => {
 setLoading(true);
 try {
 // Load posts
 const postsRes = await fetch('/api/user-posts?limit=20');
 if (postsRes.ok) {
 const data = await postsRes.json();
 setPosts(data.posts);
 }

 // Load user points
 if (user?.id) {
 const pointsRes = await fetch(`/api/points?user_id=${user.id}`);
 if (pointsRes.ok) {
 const data = await pointsRes.json();
 setUserPoints(data.points);
 setPackages(data.packages);
 }
 }
 } catch (error) {
 console.error('Error loading data:', error);
 } finally {
 setLoading(false);
 }
 };

 const handleSubmitPost = async () => {
 if (!user?.id) {
 toast.error('يجب تسجيل الدخول أولاً');
 return;
 }

 if (!ticker || !direction) {
 toast.error('يرجى ملء جميع الحقول المطلوبة');
 return;
 }

 setSubmitting(true);
 try {
 const res = await fetch('/api/user-posts', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 user_id: user.id,
 ticker: ticker.toUpperCase(),
 direction,
 entry_price: entryPrice ? parseFloat(entryPrice) : null,
 target_price: targetPrice ? parseFloat(targetPrice) : null,
 stop_loss: stopLoss ? parseFloat(stopLoss) : null,
 timeframe,
 reasoning,
 confidence: confidence / 100,
 }),
 });

 const data = await res.json();
 if (res.ok) {
 toast.success(data.message);
 setTicker('');
 setEntryPrice('');
 setTargetPrice('');
 setStopLoss('');
 setReasoning('');
 loadData();
 setActiveTab('feed');
 } else {
 toast.error(data.error || 'حدث خطأ');
 }
 } catch (error) {
 toast.error('حدث خطأ في النشر');
 } finally {
 setSubmitting(false);
 }
 };

 const handleLike = async (postId: string) => {
 if (!user?.id) return;
 
 try {
 const res = await fetch(`/api/user-posts/${postId}/like`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ user_id: user.id }),
 });
 
 if (res.ok) {
 loadData(); // Refresh to show updated likes
 }
 } catch (error) {
 console.error('Error liking post:', error);
 }
 };

 const handleBuyPoints = async (pkg: PointsPackage) => {
 if (!user?.id) {
 toast.error('يجب تسجيل الدخول أولاً');
 return;
 }

 try {
 const res = await fetch('/api/instapay', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 user_id: user.id,
 package_id: pkg.id,
 }),
 });

 const data = await res.json();
 if (res.ok) {
 // Open InstaPay link
 window.open(data.instapay_link, '_blank');
 toast.success('تم إنشاء طلب الدفع، أكمل التحويل عبر InstaPay');
 } else {
 toast.error(data.error || 'حدث خطأ');
 }
 } catch (error) {
 toast.error('حدث خطأ في إنشاء طلب الدفع');
 }
 };

 const getDirectionIcon = (dir: string) => {
 switch (dir) {
 case 'buy': return <TrendingUp className="w-5 h-5 text-success" />;
 case 'sell': return <TrendingDown className="w-5 h-5 text-loss" />;
 default: return <Minus className="w-5 h-5 text-warning" />;
 }
 };

 const getDirectionColor = (dir: string) => {
 switch (dir) {
 case 'buy': return 'text-success';
 case 'sell': return 'text-loss';
 default: return 'text-warning';
 }
 };

 const getLevelName = (level: number) => {
 const names = ['', 'مبتدئ', 'متعلم', 'محلل', 'خبير', 'مايسترو'];
 return names[level] || 'مبتدئ';
 };

 const getLevelIcon = (level: number) => {
 if (level >= 5) return <Crown className="w-5 h-5 text-warning" />;
 if (level >= 4) return <Trophy className="w-5 h-5 text-primary" />;
 if (level >= 3) return <Award className="w-5 h-5 text-whale" />;
 if (level >= 2) return <Medal className="w-5 h-5 text-success" />;
 return <Star className="w-5 h-5 text-muted-foreground" />;
 };

 if (loading) {
 return (
 <div className="flex items-center justify-center min-h-[60vh]">
 <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
 </div>
 );
 }

 return (
 <div className="container mx-auto px-4 py-6 max-w-6xl" dir="rtl">
 {/* Header with Points */}
 <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
 <div>
 <h1 className="text-2xl font-bold">🌐 منصة التوقعات</h1>
 <p className="text-muted-foreground">شارك توقعاتك واكسب النقاط</p>
 </div>
 
 {userPoints && (
 <Card className="bg-gradient-to-l from-warning/10 to-yellow-500/10 border-warning ">
 <CardContent className="p-4 flex items-center gap-4">
 <div className="flex items-center gap-2">
 {getLevelIcon(userPoints.level)}
 <div>
 <div className="text-sm text-muted-foreground">مستواك</div>
 <div className="font-bold">{getLevelName(userPoints.level)}</div>
 </div>
 </div>
 <div className="h-8 w-px bg-border" />
 <div className="flex items-center gap-2">
 <Coins className="w-5 h-5 text-warning" />
 <div>
 <div className="text-sm text-muted-foreground">نقاطك</div>
 <div className="font-bold">{userPoints.available_points.toLocaleString()}</div>
 </div>
 </div>
 </CardContent>
 </Card>
 )}
 </div>

 <Tabs value={activeTab} onValueChange={setActiveTab}>
 <TabsList className="grid grid-cols-4 mb-6">
 <TabsTrigger value="feed">التوقعات</TabsTrigger>
 <TabsTrigger value="create">نشر توقع</TabsTrigger>
 <TabsTrigger value="points">النقاط</TabsTrigger>
 <TabsTrigger value="leaderboard">المتصدرين</TabsTrigger>
 </TabsList>

 {/* Feed Tab */}
 <TabsContent value="feed" className="space-y-4">
 {posts.length === 0 ? (
 <Card>
 <CardContent className="p-8 text-center">
 <Target className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
 <h3 className="text-lg font-semibold mb-2">لا توجد توقعات بعد</h3>
 <p className="text-muted-foreground mb-4">كن أول من ينشر توقعاً!</p>
 <Button onClick={() => setActiveTab('create')}>نشر توقع جديد</Button>
 </CardContent>
 </Card>
 ) : (
 posts.map((post) => (
 <Card key={post.id} className="hover:shadow-lg transition-shadow">
 <CardContent className="p-4">
 <div className="flex justify-between items-start mb-3">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
 <span className="font-bold text-sm">{post.ticker}</span>
 </div>
 <div>
 <div className="font-semibold">{post.User.name || post.User.username || 'مستخدم'}</div>
 <div className="text-xs text-muted-foreground">
 {new Date(post.created_at).toLocaleDateString('ar-EG')}
 </div>
 </div>
 </div>
 <div className="flex items-center gap-2">
 {getDirectionIcon(post.direction)}
 <Badge variant={post.direction === 'buy' ? 'default' : post.direction === 'sell' ? 'destructive' : 'secondary'}>
 {post.direction === 'buy' ? 'شراء' : post.direction === 'sell' ? 'بيع' : 'انتظار'}
 </Badge>
 {post.outcome && (
 <Badge variant={post.outcome === 'win' ? 'default' : 'destructive'}>
 {post.outcome === 'win' ? '🎯 نجح' : '❌ فشل'}
 </Badge>
 )}
 </div>
 </div>

 <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
 {post.entry_price && (
 <div className="bg-muted/50 rounded-lg p-2 text-center">
 <div className="text-xs text-muted-foreground">سعر الدخول</div>
 <div className="font-bold">{(post.entry_price ?? 0).toFixed(2)}</div>
 </div>
 )}
 {post.target_price && (
 <div className="bg-success/10 rounded-lg p-2 text-center">
 <div className="text-xs text-success">الهدف</div>
 <div className="font-bold text-success">{(post.target_price ?? 0).toFixed(2)}</div>
 </div>
 )}
 {post.stop_loss && (
 <div className="bg-loss/10 rounded-lg p-2 text-center">
 <div className="text-xs text-loss">الوقف</div>
 <div className="font-bold text-loss">{(post.stop_loss ?? 0).toFixed(2)}</div>
 </div>
 )}
 {post.currentPrice && (
 <div className="bg-whale/10 rounded-lg p-2 text-center">
 <div className="text-xs text-whale">السعر الحالي</div>
 <div className="font-bold text-whale">
 {(post.currentPrice ?? 0).toFixed(2)}
 {post.priceChange && (
 <span className={post.priceChange >= 0 ? 'text-success mr-1' : 'text-loss mr-1'}>
 {post.priceChange >= 0 ? '+' : ''}{(post.priceChange ?? 0).toFixed(1)}%
 </span>
 )}
 </div>
 </div>
 )}
 </div>

 {post.reasoning && (
 <p className="text-sm text-muted-foreground mb-3">{post.reasoning}</p>
 )}

 <div className="flex items-center justify-between">
 <div className="flex items-center gap-4 text-sm text-muted-foreground">
 <span className="flex items-center gap-1">
 <Eye className="w-4 h-4" /> {post.views}
 </span>
 <button 
 onClick={() => handleLike(post.id)}
 className="flex items-center gap-1 hover:text-loss transition-colors"
 >
 <Heart className="w-4 h-4" /> {post.likes}
 </button>
 <span className="flex items-center gap-1">
 <Coins className="w-4 h-4 text-warning" /> +{post.points_earned}
 </span>
 </div>
 <Badge variant="outline">
 {post.timeframe === 'short' ? 'قصير المدى' : 
 post.timeframe === 'long' ? 'طويل المدى' : 'متوسط المدى'}
 </Badge>
 </div>
 </CardContent>
 </Card>
 ))
 )}
 </TabsContent>

 {/* Create Post Tab */}
 <TabsContent value="create">
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center gap-2">
 <Zap className="w-5 h-5 text-warning" />
 نشر توقع جديد
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div>
 <label className="text-sm font-medium mb-1 block">رمز السهم *</label>
 <Input
 placeholder="مثال: COMI"
 value={ticker}
 onChange={(e) => setTicker(e.target.value.toUpperCase())}
 className="uppercase"
 />
 </div>
 <div>
 <label className="text-sm font-medium mb-1 block">الاتجاه *</label>
 <div className="flex gap-2">
 <Button
 variant={direction === 'buy' ? 'default' : 'outline'}
 onClick={() => setDirection('buy')}
 className="flex-1"
 >
 <TrendingUp className="w-4 h-4 ml-1" /> شراء
 </Button>
 <Button
 variant={direction === 'sell' ? 'destructive' : 'outline'}
 onClick={() => setDirection('sell')}
 className="flex-1"
 >
 <TrendingDown className="w-4 h-4 ml-1" /> بيع
 </Button>
 <Button
 variant={direction === 'hold' ? 'secondary' : 'outline'}
 onClick={() => setDirection('hold')}
 className="flex-1"
 >
 <Minus className="w-4 h-4 ml-1" /> انتظار
 </Button>
 </div>
 </div>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 <div>
 <label className="text-sm font-medium mb-1 block">سعر الدخول</label>
 <Input
 type="number"
 placeholder="0.00"
 value={entryPrice}
 onChange={(e) => setEntryPrice(e.target.value)}
 />
 </div>
 <div>
 <label className="text-sm font-medium mb-1 block">سعر الهدف</label>
 <Input
 type="number"
 placeholder="0.00"
 value={targetPrice}
 onChange={(e) => setTargetPrice(e.target.value)}
 />
 </div>
 <div>
 <label className="text-sm font-medium mb-1 block">وقف الخسارة</label>
 <Input
 type="number"
 placeholder="0.00"
 value={stopLoss}
 onChange={(e) => setStopLoss(e.target.value)}
 />
 </div>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 <div>
 <label className="text-sm font-medium mb-1 block">الأفق الزمني</label>
 <div className="flex gap-2">
 <Button
 variant={timeframe === 'short' ? 'default' : 'outline'}
 onClick={() => setTimeframe('short')}
 className="flex-1"
 size="sm"
 >
 قصير (أيام)
 </Button>
 <Button
 variant={timeframe === 'medium' ? 'default' : 'outline'}
 onClick={() => setTimeframe('medium')}
 className="flex-1"
 size="sm"
 >
 متوسط (أسابيع)
 </Button>
 <Button
 variant={timeframe === 'long' ? 'default' : 'outline'}
 onClick={() => setTimeframe('long')}
 className="flex-1"
 size="sm"
 >
 طويل (شهور)
 </Button>
 </div>
 </div>
 <div>
 <label className="text-sm font-medium mb-1 block">الثقة: {confidence}%</label>
 <Input
 type="range"
 min="0"
 max="100"
 value={confidence}
 onChange={(e) => setConfidence(parseInt(e.target.value))}
 className="w-full"
 />
 </div>
 </div>

 <div>
 <label className="text-sm font-medium mb-1 block">التحليل والأسباب</label>
 <Textarea
 placeholder="شارك تحليلك وأسباب هذا التوقع..."
 value={reasoning}
 onChange={(e) => setReasoning(e.target.value)}
 rows={4}
 />
 </div>

 <div className="bg-warning/10 rounded-lg p-3 flex items-center gap-2">
 <Gift className="w-5 h-5 text-warning" />
 <span className="text-sm">ستحصل على <strong>10 نقاط</strong> عند نشر هذا التوقع!</span>
 </div>

 <Button 
 onClick={handleSubmitPost} 
 disabled={submitting || !ticker}
 className="w-full"
 size="lg"
 >
 {submitting ? 'جاري النشر...' : 'نشر التوقع'}
 </Button>
 </CardContent>
 </Card>
 </TabsContent>

 {/* Points Tab */}
 <TabsContent value="points" className="space-y-4">
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center gap-2">
 <Coins className="w-5 h-5 text-warning" />
 شراء النقاط
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
 {packages.map((pkg) => (
 <Card key={pkg.id} className="relative overflow-hidden hover:shadow-lg transition-shadow">
 {pkg.bonus_points > 0 && (
 <div className="absolute top-0 left-0 bg-success text-white text-xs px-2 py-1 rounded-br-lg">
 +{pkg.bonus_points} هدية!
 </div>
 )}
 <CardContent className="p-4 text-center">
 <h3 className="font-bold text-lg mb-2">{pkg.name_ar}</h3>
 <div className="text-3xl font-bold text-warning mb-2">
 {pkg.points.toLocaleString()}
 </div>
 <div className="text-sm text-muted-foreground mb-3">نقطة</div>
 <div className="text-2xl font-bold mb-4">
 {pkg.price_egp} <span className="text-sm font-normal">جنيه</span>
 </div>
 <Button 
 onClick={() => handleBuyPoints(pkg)}
 className="w-full"
 variant="outline"
 >
 <CreditCard className="w-4 h-4 ml-2" />
 شراء عبر InstaPay
 </Button>
 </CardContent>
 </Card>
 ))}
 </div>
 
 <div className="mt-6 p-4 bg-muted/50 rounded-lg">
 <h4 className="font-semibold mb-2 flex items-center gap-2">
 <ExternalLink className="w-4 h-4" />
 كيفية الدفع عبر InstaPay
 </h4>
 <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
 <li>اختر حزمة النقاط المناسبة</li>
 <li>انقر على "شراء عبر InstaPay"</li>
 <li>سيتم فتح تطبيق InstaPay</li>
 <li>أكمل عملية التحويل</li>
 <li>ارجع للتطبيق وأدخل بيانات التحويل</li>
 <li>سيتم إضافة النقاط خلال دقائق</li>
 </ol>
 </div>
 </CardContent>
 </Card>

 {/* Points History */}
 {userPoints && (
 <Card>
 <CardHeader>
 <CardTitle>سجل النقاط</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="space-y-3">
 <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
 <span>نقاط من التوقعات</span>
 <span className="font-bold text-success">+{userPoints.posts_points}</span>
 </div>
 <div className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
 <span>نقاط من الشراء</span>
 <span className="font-bold text-whale">+{userPoints.purchase_points}</span>
 </div>
 <div className="flex justify-between items-center p-3 bg-warning/10 rounded-lg border border-warning">
 <span className="font-semibold">إجمالي النقاط المتاحة</span>
 <span className="font-bold text-xl text-warning">{userPoints.available_points.toLocaleString()}</span>
 </div>
 </div>
 </CardContent>
 </Card>
 )}
 </TabsContent>

 {/* Leaderboard Tab */}
 <TabsContent value="leaderboard">
 <LeaderboardTab />
 </TabsContent>
 </Tabs>
 </div>
 );
}

// Leaderboard Component
function LeaderboardTab() {
 const [leaderboard, setLeaderboard] = useState<Array<{
 rank: number;
 user_id: string;
 total_points: number;
 level: number;
 User: { name: string | null; username: string | null; image: string | null };
 }>>([]);
 const [loading, setLoading] = useState(true);
 const [type, setType] = useState('total');

 useEffect(() => {
 loadLeaderboard();
 }, [type]);

 const loadLeaderboard = async () => {
 setLoading(true);
 try {
 const res = await fetch(`/api/points/leaderboard?type=${type}&limit=50`);
 if (res.ok) {
 const data = await res.json();
 setLeaderboard(data.leaderboard);
 }
 } catch (error) {
 console.error('Error loading leaderboard:', error);
 } finally {
 setLoading(false);
 }
 };

 const getRankStyle = (rank: number) => {
 if (rank === 1) return 'bg-gradient-to-l from-yellow-500/20 to-warning/20 border-yellow-400';
 if (rank === 2) return 'bg-gradient-to-l from-gray-400/20 to-slate-500/20 border-border';
 if (rank === 3) return 'bg-gradient-to-l from-orange-600/20 to-warning/20 border-orange-500';
 return '';
 };

 const getRankIcon = (rank: number) => {
 if (rank === 1) return <Crown className="w-6 h-6 text-warning" />;
 if (rank === 2) return <Medal className="w-6 h-6 text-muted-foreground" />;
 if (rank === 3) return <Award className="w-6 h-6 text-warning" />;
 return <span className="w-6 h-6 flex items-center justify-center font-bold text-muted-foreground">{rank}</span>;
 };

 return (
 <Card>
 <CardHeader>
 <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
 <CardTitle className="flex items-center gap-2">
 <Trophy className="w-5 h-5 text-warning" />
 لوحة المتصدرين
 </CardTitle>
 <div className="flex gap-2">
 <Button variant={type === 'total' ? 'default' : 'outline'} size="sm" onClick={() => setType('total')}>
 إجمالي النقاط
 </Button>
 <Button variant={type === 'posts' ? 'default' : 'outline'} size="sm" onClick={() => setType('posts')}>
 نقاط التوقعات
 </Button>
 <Button variant={type === 'accuracy' ? 'default' : 'outline'} size="sm" onClick={() => setType('accuracy')}>
 دقة التوقعات
 </Button>
 </div>
 </div>
 </CardHeader>
 <CardContent>
 {loading ? (
 <div className="flex justify-center py-8">
 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
 </div>
 ) : leaderboard.length === 0 ? (
 <div className="text-center py-8 text-muted-foreground">
 <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
 <p>لا توجد بيانات بعد</p>
 </div>
 ) : (
 <div className="space-y-2">
 {leaderboard.map((user) => (
 <div 
 key={user.user_id}
 className={`flex items-center justify-between p-3 rounded-lg border ${getRankStyle(user.rank)}`}
 >
 <div className="flex items-center gap-3">
 {getRankIcon(user.rank)}
 <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
 <span className="font-bold text-sm">
 {(user.User.name || user.User.username || 'م').charAt(0)}
 </span>
 </div>
 <div>
 <div className="font-semibold">{user.User.name || user.User.username || 'مستخدم'}</div>
 <div className="text-xs text-muted-foreground">المستوى {user.level}</div>
 </div>
 </div>
 <div className="text-left">
 <div className="font-bold text-lg">{user.total_points.toLocaleString()}</div>
 <div className="text-xs text-muted-foreground">نقطة</div>
 </div>
 </div>
 ))}
 </div>
 )}
 </CardContent>
 </Card>
 );
}

export default UserPublishingView;
