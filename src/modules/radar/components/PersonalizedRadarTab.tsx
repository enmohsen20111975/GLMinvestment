'use client';

// ============================================================================
// PersonalizedRadarTab — مخصّص لك
// ============================================================================
// Personalized radar — radar picks filtered & ranked by the user's profile.
//
// Layout:
// ┌─────────────────────────────────────────────────────┐
// │ 🎯 الرادار المخصّص لك │
// │ بناءً على سجل صفقاتك وأذواقك │
// ├─────────────────────────────────────────────────────┤
// │ 👤 ملفك الشخصي: │
// │ 📊 القطاعات المفضلة: تكنولوجيا (45%)، مالية (30%) │
// │ 💰 نطاق السعر المفضل: متوسط (10-100) │
// │ 📅 متوسط فترة الاحتفاظ: 12 يوم (متوسط) │
// │ 🎯 ملف المخاطرة: متوازن │
// │ 📈 نسبة نجاحك: 62% │
// ├─────────────────────────────────────────────────────┤
// │ 🎯 توقعات مخصّصة لك (5): │
// │ 1. 🚀 NVDA — تكنولوجيا (قطاعك المفضل) │
// │ Score: 85 (+10 bonus من قطاعك المفضل) │
// │ 2. 🎯 COMI — مالية (قطاعك المفضل) │
// │ Score: 78 (+8 bonus من قطاعك المفضل) │
// │ 3. 🚀 AMIA — في نطاق سعرك المفضل │
// │ Score: 75 │
// ├─────────────────────────────────────────────────────┤
// │ 🚫 تم استبعاد: │
// │ • ABUK — موجود في محفظتك │
// │ • TSLA — خارج نطاق سعرك المفضل │
// └─────────────────────────────────────────────────────┘
//
// API: GET /api/radar/personalized (auth required)
//
// Features:
// - User profile card (sectors, price range, holding period, risk, win rate)
// - Personalized picks ranked by personalization score
// - Excluded list with reasons
// - "لماذا هذا السهم؟" tooltip explaining why each pick was recommended
// - Empty state CTA for new users ("ابدأ التداول")
// - Auth-required CTA when not signed in
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
 Target, Sparkles, RefreshCw, AlertTriangle, Trophy, Clock,
 Activity, TrendingUp, ShieldCheck, ShieldAlert, ShieldQuestion,
 Layers, Eye, Flame, Zap, Rocket, Ban, HelpCircle, UserX, LogIn,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
 Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
 Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';

// ─── Types (mirror API contract) ─────────────────────────────────────────

interface PreferredSector { sector: string; count: number; pct: number; }
interface PreferredTicker { ticker: string; count: number; lastTraded: string; }
interface PreferredMarket { market: string; count: number; }

interface UserProfile {
 userId: string;
 preferredSectors: PreferredSector[];
 preferredTickers: PreferredTicker[];
 riskProfile: 'conservative' | 'balanced' | 'aggressive';
 averageHoldingDays: number;
 holdingPeriodCategory: 'short' | 'medium' | 'long';
 preferredPriceRange: 'low' | 'mid' | 'high';
 preferredMarkets: PreferredMarket[];
 totalTrades: number;
 winRate: number;
 profileComputedAt: string;
 // Task 9-B Step 1: API returns hasTradeHistory=false until a real per-user
 // trade-history source is wired. When false, the profile card hides the
 // totalTrades / winRate / averageHoldingDays stat boxes so the UI never
 // shows fake-looking "0 صفقات / 0% / 0 يوم" zeros.
 hasTradeHistory?: boolean;
}

interface PersonalizedPick {
 ticker: string;
 current_price?: number;
 path?: string;
 position_size?: number;
 roc_10d?: number | null;
 reason?: string;
 base_score: number;
 personalized_score: number;
 sector: string | null;
 personalization_reasons: string[];
 adjusted_position_size: number;
 [key: string]: unknown;
}

interface ExcludedPick {
 ticker: string;
 reason: string;
 detail: string;
}

interface PersonalizedRadarResponse {
 success: boolean;
 authenticated: boolean;
 profile: UserProfile | null;
 personalized_picks: PersonalizedPick[];
 excluded: ExcludedPick[];
 radar_status?: 'ready' | 'warming_up';
 message?: string;
 radar_generated_at?: string | null;
 radar_cache_file?: string;
 total_picks_in_cache?: number;
 served_at?: string;
 error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

const RISK_PROFILE_META: Record<string, { ar: string; icon: React.ReactNode; color: string }> = {
 conservative: { ar: 'تحفظي', icon: <ShieldAlert className="h-4 w-4" />, color: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 border-warning/20 ' },
 balanced: { ar: 'متوازن', icon: <ShieldCheck className="h-4 w-4" />, color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 border-profit/20 ' },
 aggressive: { ar: 'هجومي', icon: <ShieldQuestion className="h-4 w-4" />, color: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 border-loss/20 ' },
};

const HOLDING_PERIOD_AR: Record<string, string> = {
 short: 'قصير (<7 يوم)',
 medium: 'متوسط (7-30 يوم)',
 long: 'طويل (>30 يوم)',
};

const PRICE_RANGE_AR: Record<string, string> = {
 low: 'منخفض (<10)',
 mid: 'متوسط (10-100)',
 high: 'مرتفع (>100)',
};

const PATH_META: Record<string, { ar: string; icon: React.ReactNode; color: string }> = {
 A_pre_surge: { ar: 'Pre-Surge', icon: <Rocket className="h-3.5 w-3.5" />, color: 'text-primary ' },
 B_quiet_accumulation_strong: { ar: 'تجميع قوي', icon: <Eye className="h-3.5 w-3.5" />, color: 'text-warning ' },
 C_quiet_accumulation_weak: { ar: 'تجميع ضعيف', icon: <Eye className="h-3.5 w-3.5" />, color: 'text-warning ' },
 D_explosive_surge: { ar: 'انفجار حجمي', icon: <Flame className="h-3.5 w-3.5" />, color: 'text-loss ' },
 E_early_break: { ar: 'اختراق مبكر', icon: <Zap className="h-3.5 w-3.5" />, color: 'text-profit ' },
};

const pathLabel = (path?: string): { ar: string; icon: React.ReactNode; color: string } => {
 if (!path) return { ar: '-', icon: null, color: '' };
 return PATH_META[path] ?? { ar: path, icon: <Layers className="h-3.5 w-3.5" />, color: '' };
};

const fmtNum = (n: number | null | undefined, digits = 2): string => {
 if (n == null || isNaN(n as number)) return '-';
 const num = Number(n);
 return num.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
};

const fmtPct = (n: number | null | undefined, withSign = false): string => {
 if (n == null || isNaN(n as number)) return '-';
 const num = Number(n);
 const sign = withSign && num > 0 ? '+' : '';
 return `${sign}${(num ?? 0).toFixed(1)}%`;
};

const fmtCurrency = (n: number | null | undefined): string => {
 if (n == null || isNaN(n as number)) return '-';
 const num = Number(n);
 if (num >= 1000) return `${num.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
 return (num ?? 0).toFixed(2);
};

// ─── Component ────────────────────────────────────────────────────────────

export function PersonalizedRadarTab() {
 const [data, setData] = useState<PersonalizedRadarResponse | null>(null);
 const [loading, setLoading] = useState(true);
 const [refreshing, setRefreshing] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

 const fetchData = useCallback(async (silent = false) => {
 if (silent) setRefreshing(true); else setLoading(true);
 if (!silent) setError(null);
 try {
 const res = await fetch('/api/radar/personalized', { cache: 'no-store' });
 const json: PersonalizedRadarResponse = await res.json();
 if (json.success) {
 setData(json);
 setLastUpdated(new Date());
 } else if (res.status === 401) {
 // Not authenticated — keep the response so the UI shows login CTA
 setData({ ...json, success: true, authenticated: false, profile: null, personalized_picks: [], excluded: [] });
 } else {
 setError(json.error || 'فشل في تحميل الرادار المخصّص');
 }
 } catch (e) {
 setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
 } finally {
 if (silent) setRefreshing(false); else setLoading(false);
 }
 }, []);

 useEffect(() => {
 fetchData();
 }, [fetchData]);

 // Auto-refresh every 60s (radar cache is refreshed every 15 min on backend)
 useEffect(() => {
 const timer = setInterval(() => fetchData(true), 60 * 1000);
 return () => clearInterval(timer);
 }, [fetchData]);

 // ─── Loading state ─────────────────────────────────────────────────────
 if (loading && !data) {
 return (
 <div className="space-y-3 p-4" dir="rtl" data-testid="personalized-radar-loading">
 <Skeleton className="h-24 w-full" />
 <Skeleton className="h-64 w-full" />
 <Skeleton className="h-48 w-full" />
 </div>
 );
 }

 // ─── Error state ───────────────────────────────────────────────────────
 if (error && !data) {
 return (
 <Card className="p-6 text-center" dir="rtl" data-testid="personalized-radar-error">
 <AlertTriangle className="h-10 w-10 text-loss mx-auto mb-3" />
 <p className="text-sm text-muted-foreground mb-3">{error}</p>
 <Button size="sm" onClick={() => fetchData()}>
 <RefreshCw className="h-4 w-4 ml-1" /> إعادة المحاولة
 </Button>
 </Card>
 );
 }

 // ─── Not authenticated ─────────────────────────────────────────────────
 if (data && data.authenticated === false) {
 return (
 <Card className="p-8 text-center" dir="rtl" data-testid="personalized-radar-unauth">
 <UserX className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
 <h3 className="text-lg font-bold mb-2">سجّل دخولك الأول</h3>
 <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
 يتطلب الرادار المخصّص تسجيل الدخول لكي نتمكن من بناء ملفك الشخصي من صفقاتك
 ومحفظتك وقائمة المتابعة.
 </p>
 <Button size="sm" onClick={() => (window.location.hash = '#login')}>
 <LogIn className="h-4 w-4 ml-1" /> تسجيل الدخول
 </Button>
 </Card>
 );
 }

 // ─── Empty state (new user with no trade history) ─────────────────────
 // Per task spec: if the user has no trade history (profile === null), show
 // the "ابدأ التداول" CTA — regardless of whether the radar cache has picks.
 if (data && data.profile === null) {
 return (
 <Card className="p-8 text-center" dir="rtl" data-testid="personalized-radar-empty">
 <Sparkles className="h-12 w-12 text-profit mx-auto mb-4" />
 <h3 className="text-lg font-bold mb-2">الرادار المخصّص لسه بيتعلّم منك</h3>
 <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
 ابدأ التداول أو أضف أسهماً إلى قائمة المتابعة لكي نتمكن من تخصيص الرادار لك
 بناءً على تفضيلاتك. كلما زاد نشاطك، زادت دقة التوقعات.
 </p>
 <div className="flex items-center justify-center gap-2 flex-wrap">
 <Button size="sm" variant="outline" onClick={() => fetchData(true)}>
 <RefreshCw className="h-4 w-4 ml-1" /> إعادة المحاولة
 </Button>
 <Button size="sm" onClick={() => (window.location.hash = '#portfolio')}>
 <Target className="h-4 w-4 ml-1" /> أضف لمحفظتك
 </Button>
 </div>
 </Card>
 );
 }

 // ─── Main render ───────────────────────────────────────────────────────
 return (
 <div className="space-y-4" dir="rtl" data-testid="personalized-radar">
 <ProfileCard data={data} lastUpdated={lastUpdated} onRefresh={() => fetchData(true)} refreshing={refreshing} />
 <PersonalizedPicksCard data={data} />
 <ExcludedCard data={data} />
 <FooterCard data={data} lastUpdated={lastUpdated} />
 </div>
 );
}

// ─── Sub: Profile Card ─────────────────────────────────────────────────────

function ProfileCard({
 data,
 lastUpdated,
 onRefresh,
 refreshing,
}: {
 data: PersonalizedRadarResponse | null;
 lastUpdated: Date | null;
 onRefresh: () => void;
 refreshing: boolean;
}) {
 const profile = data?.profile;
 if (!profile) return null;

 const riskMeta = RISK_PROFILE_META[profile.riskProfile] || RISK_PROFILE_META.balanced;

 // Win rate color
 const winRateColor = profile.winRate >= 60
 ? 'text-profit '
 : profile.winRate >= 40
 ? 'text-warning '
 : 'text-loss ';

 // Task 9-B Step 1: hide trade-history stats when API says hasTradeHistory=false.
 // The API currently has no per-user trade-history source (no closed-trades
 // table), so showing 0 صفقات / 0% نجاح / 0 يوم would mislead the user.
 const hasTradeHistory = profile.hasTradeHistory !== false;

 return (
 <Card className="overflow-hidden" data-testid="profile-card">
 <div className="p-4 md:p-5 bg-profit/10">
 <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
 <div className="flex items-center gap-3">
 <div className="h-12 w-12 rounded-xl bg-background/80 /40 flex items-center justify-center">
 <Target className="h-6 w-6 text-profit" />
 </div>
 <div>
 <h3 className="text-lg md:text-xl font-bold flex items-center gap-2">
 الرادار المخصّص لك
 </h3>
 <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
 <span>بناءً على سجل صفقاتك وأذواقك</span>
 {lastUpdated && (
 <>
 <span>•</span>
 <span className="flex items-center gap-1">
 <Clock className="h-3 w-3" />
 {lastUpdated.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
 </span>
 </>
 )}
 </p>
 </div>
 </div>
 <Button
 variant="outline"
 size="sm"
 onClick={onRefresh}
 disabled={refreshing}
 className="gap-1"
 data-testid="refresh-button"
 >
 <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
 تحديث
 </Button>
 </div>

 {/* Profile stats row */}
 <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
 {hasTradeHistory && (
 <ProfileStatBox
 label="إجمالي الصفقات"
 value={String(profile.totalTrades)}
 icon={<Activity className="h-4 w-4" />}
 testId="stat-total-trades"
 />
 )}
 {hasTradeHistory && (
 <ProfileStatBox
 label="نسبة النجاح"
 value={`${fmtPct(profile.winRate)}`}
 icon={<Trophy className="h-4 w-4" />}
 valueClassName={winRateColor}
 testId="stat-win-rate"
 />
 )}
 <ProfileStatBox
 label="ملف المخاطرة"
 value={riskMeta.ar}
 icon={riskMeta.icon}
 testId="stat-risk-profile"
 />
 {hasTradeHistory && (
 <ProfileStatBox
 label="فترة الاحتفاظ"
 value={`${(profile.averageHoldingDays ?? 0).toFixed(0)} يوم`}
 sub={HOLDING_PERIOD_AR[profile.holdingPeriodCategory]}
 icon={<Clock className="h-4 w-4" />}
 testId="stat-holding-period"
 />
 )}
 <ProfileStatBox
 label="نطاق السعر"
 value={PRICE_RANGE_AR[profile.preferredPriceRange]}
 icon={<TrendingUp className="h-4 w-4" />}
 testId="stat-price-range"
 />
 </div>

 {/* Preferred sectors */}
 {profile.preferredSectors.length > 0 && (
 <div className="mt-4" data-testid="preferred-sectors">
 <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mb-2">
 <Layers className="h-3.5 w-3.5" />
 القطاعات المفضلة
 </div>
 <div className="flex flex-wrap gap-2">
 {profile.preferredSectors.map((s) => (
 <Badge
 key={s.sector}
 variant="outline"
 className="text-xs bg-background/70 /40"
 >
 <span className="font-semibold ml-1">{s.sector}</span>
 <span className="text-muted-foreground">
 {fmtPct(s.pct)} ({s.count})
 </span>
 </Badge>
 ))}
 </div>
 </div>
 )}

 {/* Preferred tickers */}
 {profile.preferredTickers.length > 0 && (
 <div className="mt-3" data-testid="preferred-tickers">
 <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mb-2">
 <Target className="h-3.5 w-3.5" />
 الأسهم المفضلة
 </div>
 <div className="flex flex-wrap gap-2">
 {profile.preferredTickers.slice(0, 8).map((t) => (
 <Badge
 key={t.ticker}
 variant="outline"
 className="text-xs font-mono bg-background/70 /40"
 data-testid={`preferred-ticker-${t.ticker}`}
 >
 {t.ticker}
 <span className="text-muted-foreground mr-1">×{t.count}</span>
 </Badge>
 ))}
 </div>
 </div>
 )}

 {/* Preferred markets */}
 {profile.preferredMarkets.length > 0 && (
 <div className="mt-3" data-testid="preferred-markets">
 <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mb-2">
 <Activity className="h-3.5 w-3.5" />
 الأسواق المفضلة
 </div>
 <div className="flex flex-wrap gap-2">
 {profile.preferredMarkets.map((m) => (
 <Badge
 key={m.market}
 variant="outline"
 className="text-xs bg-background/70 /40"
 >
 <span className="font-semibold ml-1">{m.market}</span>
 <span className="text-muted-foreground">({m.count})</span>
 </Badge>
 ))}
 </div>
 </div>
 )}
 </div>
 </Card>
 );
}

function ProfileStatBox({
 label,
 value,
 sub,
 icon,
 valueClassName = '',
 testId,
}: {
 label: string;
 value: string;
 sub?: string;
 icon?: React.ReactNode;
 valueClassName?: string;
 testId?: string;
}) {
 return (
 <div
 className="bg-background/70 /40 rounded-lg p-3 border border-border/50"
 data-testid={testId}
 >
 <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
 {icon}
 <span>{label}</span>
 </div>
 <div className={`text-base font-bold ${valueClassName}`}>{value}</div>
 {sub && (
 <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
 )}
 </div>
 );
}

// ─── Sub: Personalized Picks Card ──────────────────────────────────────────

function PersonalizedPicksCard({ data }: { data: PersonalizedRadarResponse | null }) {
 const picks = data?.personalized_picks ?? [];

 return (
 <Card data-testid="personalized-picks-card">
 <CardHeader className="pb-2">
 <CardTitle className="text-base flex items-center gap-2">
 <Sparkles className="h-4 w-4 text-profit" />
 توقعات مخصّصة لك
 {picks.length > 0 && (
 <Badge variant="secondary" className="text-xs">{picks.length}</Badge>
 )}
 </CardTitle>
 </CardHeader>
 <CardContent className="p-0">
 {picks.length === 0 ? (
 <div className="p-8 text-center text-sm text-muted-foreground">
 <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-40" />
 {data?.radar_status === 'warming_up'
 ? 'الرادار قيد التحميل — حاول مرة أخرى خلال دقيقة'
 : 'لا توجد توقعات مخصّصة متاحة حالياً'}
 </div>
 ) : (
 <Table>
 <TableHeader>
 <TableRow>
 <TableHead className="w-8">#</TableHead>
 <TableHead>السهم</TableHead>
 <TableHead>المسار</TableHead>
 <TableHead className="text-left">السعر الحالي</TableHead>
 <TableHead className="text-left">Score مخصّص</TableHead>
 <TableHead className="text-left">حجم الصفقة</TableHead>
 <TableHead className="text-left hidden md:table-cell">القطاع</TableHead>
 <TableHead className="text-center">لماذا؟</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {picks.map((p, idx) => {
 const meta = pathLabel(p.path);
 return (
 <TableRow key={p.ticker} data-testid={`personalized-pick-${p.ticker}`}>
 <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
 <TableCell>
 <span className="font-mono font-semibold text-sm">{p.ticker}</span>
 </TableCell>
 <TableCell>
 <span className={`text-xs flex items-center gap-1 ${meta.color}`}>
 {meta.icon}
 {meta.ar}
 </span>
 </TableCell>
 <TableCell className="text-left font-mono text-xs">
 {fmtCurrency(p.current_price)}
 </TableCell>
 <TableCell className="text-left">
 <div className="flex items-center gap-1.5">
 <span className="font-bold text-sm" data-testid={`pick-score-${p.ticker}`}>
 {p.personalized_score}
 </span>
 {p.personalized_score > p.base_score && (
 <Badge variant="outline" className="text-xs bg-profit/10 text-profit border-profit ">
 +{p.personalized_score - p.base_score}
 </Badge>
 )}
 </div>
 </TableCell>
 <TableCell className="text-left">
 <Badge variant="outline" className="text-xs">
 {p.adjusted_position_size}%
 </Badge>
 </TableCell>
 <TableCell className="text-left text-xs hidden md:table-cell">
 {p.sector || '-'}
 </TableCell>
 <TableCell className="text-center">
 {p.personalization_reasons.length > 0 ? (
 <TooltipProvider>
 <Tooltip>
 <TooltipTrigger asChild>
 <button
 type="button"
 className="text-profit hover:text-profit cursor-help"
 data-testid={`pick-reason-trigger-${p.ticker}`}
 aria-label="لماذا هذا السهم؟"
 >
 <HelpCircle className="h-4 w-4" />
 </button>
 </TooltipTrigger>
 <TooltipContent side="left" className="max-w-xs">
 <div className="text-xs space-y-1">
 <div className="font-bold mb-1">لماذا هذا السهم؟</div>
 {p.personalization_reasons.map((r, i) => (
 <div key={i} className="flex items-start gap-1.5">
 <span className="text-profit">•</span>
 <span>{r}</span>
 </div>
 ))}
 </div>
 </TooltipContent>
 </Tooltip>
 </TooltipProvider>
 ) : (
 <span className="text-muted-foreground text-xs">-</span>
 )}
 </TableCell>
 </TableRow>
 );
 })}
 </TableBody>
 </Table>
 )}
 </CardContent>
 </Card>
 );
}

// ─── Sub: Excluded Card ────────────────────────────────────────────────────

function ExcludedCard({ data }: { data: PersonalizedRadarResponse | null }) {
 const excluded = data?.excluded ?? [];

 return (
 <Card data-testid="excluded-card">
 <CardHeader className="pb-2">
 <CardTitle className="text-base flex items-center gap-2">
 <Ban className="h-4 w-4 text-loss" />
 تم استبعاد
 {excluded.length > 0 && (
 <Badge variant="secondary" className="text-xs">{excluded.length}</Badge>
 )}
 </CardTitle>
 </CardHeader>
 <CardContent className="p-3">
 {excluded.length === 0 ? (
 <div className="text-center text-xs text-muted-foreground py-3">
 <Ban className="h-6 w-6 mx-auto mb-1 opacity-30" />
 لا توجد أسهم تم استبعادها
 </div>
 ) : (
 <ul className="space-y-1.5">
 {excluded.map((e, idx) => (
 <li
 key={`${e.ticker}-${idx}`}
 className="flex items-center gap-2 text-xs"
 data-testid={`excluded-${e.ticker}`}
 >
 <span className="font-mono font-semibold w-16">{e.ticker}</span>
 <span className="text-muted-foreground">—</span>
 <span className="text-muted-foreground">{e.detail}</span>
 <Badge variant="outline" className="text-xs ml-auto">
 {e.reason === 'already_in_portfolio' ? 'موجود في المحفظة' : 'خارج النطاق'}
 </Badge>
 </li>
 ))}
 </ul>
 )}
 </CardContent>
 </Card>
 );
}

// ─── Sub: Footer Card ─────────────────────────────────────────────────────

function FooterCard({
 data,
 lastUpdated,
}: {
 data: PersonalizedRadarResponse | null;
 lastUpdated: Date | null;
}) {
 return (
 <Card className="bg-muted/40">
 <CardContent className="p-3 text-center text-xs text-muted-foreground">
 <div className="flex items-center justify-center gap-2 flex-wrap">
 <Clock className="h-3 w-3" />
 <span>يتم التحديث تلقائياً كل 60 ثانية</span>
 {data?.radar_cache_file && (
 <>
 <span>•</span>
 <span>المصدر: {data.radar_cache_file}</span>
 </>
 )}
 {data?.total_picks_in_cache != null && (
 <>
 <span>•</span>
 <span>إجمالي الفرص في الكاش: {data.total_picks_in_cache}</span>
 </>
 )}
 {lastUpdated && (
 <>
 <span>•</span>
 <span>آخر تحديث: {lastUpdated.toLocaleString('ar-EG')}</span>
 </>
 )}
 </div>
 </CardContent>
 </Card>
 );
}

export default PersonalizedRadarTab;
