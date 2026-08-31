'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import {
  Shield,
  ShieldAlert,
  Users,
  TrendingUp,
  Activity,
  FileText,
  Database,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Target,
  DollarSign,
  XCircle,
  Play,
  Brain,
  Scan,
  Coins,
  Monitor,
  Upload,
  Server,
  Clock,
  BarChart3,
  AlertCircle,
  CheckCircle,
  Zap,
  TrendingDown,
  Settings,
  ChevronDown,
  ChevronUp,
  Info,
  Wifi,
  WifiOff,
  Bug,
  Lightbulb,
  Wrench,
  Building2,
  BookOpen,
  Sparkles,
  Send,
  GraduationCap,
  History,
  Network,
  MessageSquareText,
  Star,
  Eye,
  ClipboardList,
  Ticket,
  Gauge,
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useAppStore } from '@/lib/store';
import { isAdmin, getAdminToken } from '@/lib/admin-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { LazyTabLoader } from '@/components/shared/LazyTabLoader';
import { withErrorBoundary } from '@/components/shared/ErrorBoundary';
// Stream C: dead imports removed (IterativeLearningAdmin, CryptoLearningAdmin,
// StockImportCard, RecommendationsExport, CryptoPredictionGenerator, DatabaseExplorer)
// — they were imported but never rendered in any tab block.
import { SectorClassificationAdmin } from './SectorClassificationAdmin';
import { RegimeDetectionWidget } from './RegimeDetectionWidget';
import { PlatformPerformanceView } from './platform-performance/PlatformPerformanceView';
import { BacktestTab } from './BacktestTab';

// V38 Backtest Dashboard & HistoricalPredictionsV2 — REMOVED (2026-08-13)
// Consolidated into نظام التعلم الذكي الموحد (Maestro) — single engine
import { GoldSilverTab } from './GoldSilverTab';
import { MultiMarketTab } from './MultiMarketTab';
import { ForexTab } from './ForexTab';
import { DataEngineTab } from './DataEngineTab';
import { EnginesStatusTab } from './EnginesStatusTab';
import { EngineSettingsTab } from './EngineSettingsTab';
import { TelegramTab } from './TelegramTab';
import { PromoCodesAdmin } from './PromoCodesAdmin';
import { SystemProblemsTab } from './SystemProblemsTab';
import { PurgeCacheButton } from './PurgeCacheButton';

// ============================================================================
// Phase 3 — Next.js Bundle Diet (Lazy Loading Heavy Components)
// ============================================================================
// The following admin sub-components are 1000-3000+ lines each. Loading them
// all eagerly into AdminView's chunk would make the Admin tab's first paint
// very slow (multi-MB JS chunk). Using `next/dynamic` with `ssr: false` +
// `loading: <LazyTabLoader>` means each component only loads when the user
// actually navigates to that tab — the rest stay as separate chunks that
// are never fetched if the user doesn't open them.
//
//  Backward compatible: the JSX usage `<MaestroCommandCenter />` etc. is
//  unchanged — only the import is replaced with a dynamic() call.
//  ============================================================================
//
//import {
//  AreaChart,
//  Area,
//  BarChart,
//  Bar,
//  PieChart,
//  Pie,
//  Cell,
//  XAxis,
//  YAxis,
//  CartesianGrid,
//  Tooltip,
//  ResponsiveContainer,
//  Legend,
//} from 'recharts';
//
//  Prediction analysis views (admin-only — for backtesting & strategy tuning)
//import { HumanRecommendationsAdmin } from './HumanRecommendationsAdmin';
//
//  ============================================================================
//  Phase 3 — Next.js Bundle Diet (Lazy Loading Heavy Components)
//  ============================================================================
//  The following admin sub-components are 1000-3000+ lines each. Loading them
//  all eagerly into AdminView's chunk would make the Admin tab's first paint
//  very slow (multi-MB JS chunk). Using `next/dynamic` with `ssr: false` +
//  `loading: <LazyTabLoader>` means each component only loads when the user
//  actually navigates to that tab — the rest stay as separate chunks that
//  are never fetched if the user doesn't open them.
// 
//  Backward compatible: the JSX usage `<MaestroCommandCenter />` etc. is
//  unchanged — only the import is replaced with a dynamic() call.
// 
//  Phase 4 Task 3 (Resilience & Observability):
//    Each heavy sub-component is wrapped with `withErrorBoundary` so that a
//    runtime error in one tab (e.g., MaestroCommandCenter's 3030-line render)
//    shows a friendly "حدث خطأ" message + Retry button instead of crashing
//    the whole AdminView. The other admin tabs keep working.
//  ============================================================================
//
//const SuperLearningSystem = withErrorBoundary(
//  dynamic(
//    () => import('./SuperLearningSystem').then(m => ({ default: m.SuperLearningSystem })),
//    { ssr: false, loading: () => <LazyTabLoader label="نظام التعلّم الموحّد" /> }
//  ),
//  'نظام التعلّم الموحّد',
//);
//
// // const MaestroDashboard = withErrorBoundary(
//   dynamic(
//     // () => import('./MaestroDashboard').then(m => ({ default: m.MaestroDashboard })),
//     { ssr: false, loading: () => <LazyTabLoader label="لوحة المحركات" /> }
//   ),
//   'لوحة المحركات',
// );
// 
// const CryptoAdminPanel = withErrorBoundary(
//   dynamic(
//     () => import('./CryptoAdminPanel').then(m => ({ default: m.CryptoAdminPanel })),
//     { ssr: false, loading: () => <LazyTabLoader label="لوحة الكريبتو" /> }
//   ),
//   'لوحة الكريبتو',
// );
// 
// const UsersManagement = withErrorBoundary(
//   dynamic(
//     () => import('./UsersManagement').then(m => ({ default: m.UsersManagement })),
//     { ssr: false, loading: () => <LazyTabLoader label="إدارة المستخدمين" /> }
//   ),
//   'إدارة المستخدمين',
// );
// 
// const DataScraperControl = withErrorBoundary(
//   dynamic(
//     () => import('./DataScraperControl').then(m => ({ default: m.DataScraperControl })),
//     { ssr: false, loading: () => <LazyTabLoader label="التحكم في سحب البيانات" /> }
//   ),
//   'التحكم في سحب البيانات',
// );
// 
// const DatabaseManagerFull = withErrorBoundary(
//   dynamic(
//     () => import('./DatabaseManagerFull').then(m => ({ default: m.DatabaseManagerFull })),
//     { ssr: false, loading: () => <LazyTabLoader label="مدير قاعدة البيانات الكامل" /> }
//   ),
//   'مدير قاعدة البيانات الكامل',
// );
// 
// // const MaestroCommandCenter = withErrorBoundary(
//   dynamic(
//     // () => import('./MaestroCommandCenter').then(m => ({ default: m.MaestroCommandCenter })),
//     { ssr: false, loading: () => <LazyTabLoader label="لوحة التحكم" /> }
//   ),
//   'لوحة التحكم',
// );
// 
// const SystemControlPanel = withErrorBoundary(
//   dynamic(
//     () => import('./SystemControlPanel').then(m => ({ default: m.SystemControlPanel })),
//     { ssr: false, loading: () => <LazyTabLoader label="لوحة تحكم النظام" /> }
//   ),
//   'لوحة تحكم النظام',
// );
// 
// // HistoricalPredictionsV2 — REMOVED (2026-08-13) — consolidated into Maestro
// 
// // ==================== ADMIN API HELPER ====================
// 
// // محاولة ضبط admin_session cookie عن طريق auto-cookie endpoint
// let _autoCookieAttempted = false;
// let _autoCookiePromise: Promise<boolean> | null = null;
// 
// async function tryAutoCookie(): Promise<boolean> {
//   if (!_autoCookiePromise) {
//     _autoCookiePromise = fetch('/api/admin/auth/auto-cookie', {
//       method: 'POST',
//       credentials: 'same-origin',
//     })
//       .then(res => {
//         if (res.ok) {
//           _autoCookieAttempted = true;
//           return true;
//         }
//         // لو فشلت (مش أدمن أو مش مسجل)، متحاولش تاني
//         _autoCookieAttempted = true;
//         return false;
//       })
//       .catch(() => {
//         // لو network error، حاول تاني بعدين (مش بنحط _autoCookieAttempted = true)
//         _autoCookiePromise = null;
//         return false;
//       });
//   }
// 
//   return _autoCookiePromise;
// }
// 
// async function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
//   // الخطوة 1: جرب الطلب الأول مع credentials: 'same-origin' (عشان الـ httpOnly cookie تترسل)
//   // لو الـ admin_session cookie موجودة (اتضبطت من login أو auto-cookie)،
//   // requireAdminAsync هتستخدمها مباشرة
//   const res = await fetch(url, {
//     ...options,
//     credentials: 'same-origin',
//   });
// 
//   // لو نجح أو فشل بسبب مشكلة مش مصادقة، رجّع النتيجة
//   if (res.status !== 401 && res.status !== 403) {
//     return res;
//   }
// 
//   // الخطوة 2: لو رجع 401/403، حاول نضبط auto-cookie الأول
//   // (ده بيفيد لو المستخدم مسجل بـ Google بس مفيش admin_session cookie)
//   const cookieSet = await tryAutoCookie();
// 
//   if (cookieSet) {
//     // الـ cookie اتضبطت، جرب الطلب تاني
//     return fetch(url, {
//       ...options,
//       credentials: 'same-origin',
//     });
//   }
// 
//   // الخطوة 3: لو auto-cookie فشلت، جرب نجيب token من /api/admin/auth/token
//   // (ده بيفيد لو المستخدم عامل login من form)
//   const token = await getAdminToken();
//   if (!token) {
//     return res; // رجّع الـ 401/403 الأصلي
//   }
// 
//   // الخطوة 4: أعد الطلب مع X-Admin-Token header
//   const headers = new Headers(options.headers);
//   headers.set('X-Admin-Token', token);
//   if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
//     headers.set('Content-Type', 'application/json');
//   }
//   return fetch(url, { ...options, headers, credentials: 'same-origin' });
// }
// 
// // ==================== TYPES ====================
// 
// interface AdminStats {
//   success: boolean;
//   timestamp: string;
//   users: { total: number; active: number; premium: number };
//   stocks: { total: number; active: number; sectors: number; last_update: string | null };
//   platform: { watchlist_items: number; portfolio_items: number };
// }
// 
// interface ConnectionInfo {
//   timestamp: string;
//   summary: string;
//   sources: Record<string, { available: boolean; message: string; latency_ms?: number }>;
// }
// 
// export interface SystemIssue {
//   id: string;
//   severity: 'critical' | 'warning' | 'info';
//   category: 'service' | 'data' | 'analysis' | 'system';
//   title: string;
//   description: string;
//   solution?: string;
//   timestamp: string;
//   actions?: { label: string; action: () => void }[];
// }
// 
// interface ServiceStatus {
//   name: string;
//   nameAr: string;
//   status: 'online' | 'offline' | 'degraded';
//   latency?: number;
//   lastCheck: string;
//   message: string;
// }
// 
// // Data status for each market/type
// interface DataStatusItem {
//   category: string;
//   name_ar: string;
//   count: number;
//   last_update: string | null;
//   status: 'fresh' | 'stale' | 'old' | 'error';
//   minutes_ago: number | null;
//   message: string;
// }
// 
// interface DataStatus {
//   success: boolean;
//   timestamp: string;
//   summary: {
//     total: number;
//     fresh: number;
//     stale: number;
//     old: number;
//     error: number;
//     health_score: number;
//   };
//   categories: DataStatusItem[];
// }
// 
// type AdminTab = 'dashboard' | 'problems' | 'general' | 'data-engine' | 'engine-settings' | 'learning' | 'historical-predictions' | 'backtest' | 'crypto' | 'users' | 'behavior' | 'expert-recs' | 'telegram' | 'reports' | 'educational-cards' | 'egx' | 'gold-silver' | 'multi-market' | 'forex' | 'sectors' | 'databases' | 'system-control' | 'feedback' | 'promo-codes' | 'platform-performance';
// 
// // Stream C: 6 Core Admin Hubs — consolidates the 26 flat tabs into 6 logical sectors.
// type HubId = 'health' | 'learning' | 'data' | 'users' | 'telegram';
// 
// // ==================== COMPONENT ====================
// 
// export function AdminView() {
//   const { data: session } = useSession();
//   const { user } = useAppStore();
//   const userEmail = user?.email || session?.user?.email || '';
//   const userName = user?.username || (session?.user as Record<string, unknown>)?.username as string || '';
//   const isAdminUser = isAdmin(userEmail, userName);
// 
//   // State
//   const [stats, setStats] = useState<AdminStats | null>(null);
//   const [statsLoading, setStatsLoading] = useState(true);
//   const [connections, setConnections] = useState<ConnectionInfo | null>(null);
//   const [connectionsLoading, setConnectionsLoading] = useState(false);
//   const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
//   // Stream C: which hub is expanded in the nav. Auto-syncs when a tab is clicked.
//   const [expandedHub, setExpandedHub] = useState<HubId | null>('health');
//   const [syncing, setSyncing] = useState(false);
//   const [multiMarketSyncing, setMultiMarketSyncing] = useState(false);
//   const [predictionStats, setPredictionStats] = useState<any>(null);
//   const [dataStatus, setDataStatus] = useState<DataStatus | null>(null);
//   const [dataStatusLoading, setDataStatusLoading] = useState(false);
// 
//   // Debug state
//   const [debugLogs, setDebugLogs] = useState<{ time: string; action: string; status: string; message: string; data?: any }[]>([]);
//   const [showDebug, setShowDebug] = useState(true);
//   const [pythonHealth, setPythonHealth] = useState<any>(null);
//   const [learningStats, setLearningStats] = useState<any>(null);
//   const [analyticsData, setAnalyticsData] = useState<any>(null);
//   const [analyticsLoading, setAnalyticsLoading] = useState(false);
// 
//   const addDebugLog = (action: string, status: string, message: string, data?: any) => {
//     setDebugLogs(prev => [...prev.slice(-19), { time: new Date().toLocaleTimeString(), action, status, message, data }]);
//   };
// 
//   // Direct login state
//   const [isMounted, setIsMounted] = useState(false);
//   const [directLoginUsername, setDirectLoginUsername] = useState('');
//   const [directLoginPassword, setDirectLoginPassword] = useState('');
//   const [directLoginError, setDirectLoginError] = useState('');
//   const [directLoginLoading, setDirectLoginLoading] = useState(false);
//   const [directLoggedIn, setDirectLoggedIn] = useState(false);
// 
//   // Feedback (user reports / opinions)
//   const [feedback, setFeedback] = useState<any[]>([]);
//   const [feedbackLoading, setFeedbackLoading] = useState(false);
//   const [feedbackCount, setFeedbackCount] = useState<number | undefined>(undefined);
// 
//   // User behavior analysis
//   const [userBehavior, setUserBehavior] = useState<any[]>([]);
//   const [behaviorLoading, setBehaviorLoading] = useState(false);
// 
//   // Check admin session on mount (FIX July 2026: cookie is httpOnly, verify via API)
//   // FIX v2 (July 2026): auto-set admin_session cookie for Google-logged-in admins
//   // هذا يحل مشكلة "ADMIN_AUTH_REQUIRED" للأدمن المسجل بـ Google
//   useEffect(() => {
//     const checkSession = async () => {
//       try {
//         // 1. حاول ضبط admin_session cookie تلقائياً (لو المستخدم أدمن مسجل بـ Google)
//         try {
//           await fetch('/api/admin/auth/auto-cookie', { method: 'POST' });
//         } catch {
//           // تجاهل الأخطاء — سنجرب stats بعدها
//         }
//         // 2. فحص صلاحية الأدمن
//         const res = await fetch('/api/admin/stats');
//         if (res.ok) {
//           setDirectLoggedIn(true);
//         }
//       } catch {
//         // Not authenticated — that's fine, show login form
//       }
//     };
//     checkSession();
//     setIsMounted(true);
//   }, []);
// 
//   // Track admin tab views
//   useEffect(() => {
//     const trackView = async () => {
//       try {
//         await fetch('/api/track', {
//           method: 'POST',
//           headers: { 'Content-Type': 'application/json' },
//           body: JSON.stringify({
//             type: 'page_view',
//             view: `admin:${activeTab}`,
//             action: 'tab_view',
//             detail: activeTab,
//           }),
//         });
//       } catch {
//         // ignore tracking errors
//       }
//     };
//     trackView();
//   }, [activeTab]);
// 
//   const isDirectAdmin = isMounted ? directLoggedIn : false;
//   const canAccessAdmin = isAdminUser || isDirectAdmin;
// 
//   // Fetch stats
//   const fetchStats = useCallback(async () => {
//     setStatsLoading(true);
//     addDebugLog('FETCH STATS', 'pending', '/api/admin/stats');
//     try {
//       // Use plain fetch - stats API returns data even without admin token
//       const res = await fetch('/api/admin/stats');
//       const data = await res.json();
//       if (data.success) {
//         setStats(data);
//         addDebugLog('FETCH STATS', 'success', `${data?.stocks?.total || 0} stocks, ${data?.users?.total || 0} users`, data);
//       } else {
//         addDebugLog('FETCH STATS', 'error', data.error || 'Unknown error');
//       }
//     } catch (err: any) {
//       toast.error('خطأ في الاتصال بالخادم');
//       addDebugLog('FETCH STATS', 'error', err.message);
//     } finally {
//       setStatsLoading(false);
//     }
//   }, []);
// 
//   // Check Python Backend Health - use server-side API to avoid CORS
//   const checkPythonHealth = useCallback(async () => {
//     // Use the connections API which checks VPS from server-side
//     addDebugLog('PYTHON HEALTH', 'pending', 'Checking via /api/market/connections');
//     try {
//       const res = await fetch('/api/market/connections');
//       const data = await res.json();
//       const vpsAvailable = data?.sources?.vps_python?.available === true;
//       if (vpsAvailable) {
//         setPythonHealth({ status: 'ok', latency: data?.sources?.vps_python?.latency_ms });
//         addDebugLog('PYTHON HEALTH', 'success', `Connected (${data?.sources?.vps_python?.latency_ms}ms)`, data?.sources?.vps_python);
//       } else {
//         setPythonHealth(null);
//         addDebugLog('PYTHON HEALTH', 'error', data?.sources?.vps_python?.message || 'Not available');
//       }
//     } catch (err: any) {
//       setPythonHealth(null);
//       addDebugLog('PYTHON HEALTH', 'error', err.message);
//     }
//   }, []);
// 
//   // Fetch connections
//   const fetchConnections = useCallback(async () => {
//     setConnectionsLoading(true);
//     addDebugLog('CONNECTIONS', 'pending', '/api/market/connections');
//     try {
//       const res = await fetch('/api/market/connections');
//       const data = await res.json();
//       setConnections(data);
//       addDebugLog('CONNECTIONS', 'success', `VPS: ${data?.sources?.vps_python?.available ? 'OK' : 'DOWN'}`, data?.sources);
//     } finally {
//       setConnectionsLoading(false);
//     }
//   }, []);
// 
//   // Fetch prediction stats
//   const fetchPredictionStats = useCallback(async () => {
//     try {
//       const res = await fetch('/api/prediction-performance');
//       const data = await res.json();
//       if (data.success) {
//         setPredictionStats(data.performance);
//       }
//     } catch {
//       // silent
//     }
//   }, []);
// 
//   // Fetch Learning Stats
//   const fetchLearningStats = useCallback(async () => {
//     addDebugLog('LEARNING STATS', 'pending', '/api/self-learning?action=stats');
//     try {
//       const res = await fetch('/api/self-learning?action=stats');
//       const data = await res.json();
//       setLearningStats(data);
//       addDebugLog('LEARNING STATS', 'success', `predictions: ${data?.data?.signals?.total || 0}, win_rate: ${data?.data?.outcomes?.win_rate || 0}%`, data);
//     } catch (err: any) {
//       addDebugLog('LEARNING STATS', 'error', err.message);
//     }
//   }, []);
// 
//   // Fetch Data Status (detailed status for each market)
//   const fetchDataStatus = useCallback(async () => {
//     setDataStatusLoading(true);
//     try {
//       const res = await fetch('/api/data-status');
//       const data = await res.json();
//       if (data.success) {
//         setDataStatus(data);
//         addDebugLog('DATA STATUS', 'success', `Health: ${data.summary.health_score}%`, data.summary);
//       }
//     } catch (err: any) {
//       addDebugLog('DATA STATUS', 'error', err.message);
//     } finally {
//       setDataStatusLoading(false);
//     }
//   }, []);
// 
//   // Fetch Analytics
//   const fetchAnalytics = useCallback(async () => {
//     setAnalyticsLoading(true);
//     try {
//       const res = await adminFetch('/api/admin/analytics');
//       const data = await res.json();
//       if (data.success) {
//         setAnalyticsData(data);
//       }
//     } catch (err: any) {
//       console.error('[Admin] Failed to load analytics:', err);
//     } finally {
//       setAnalyticsLoading(false);
//     }
//   }, []);
// 
//   // Fetch user feedback (reports / opinions)
//   const fetchFeedback = useCallback(async () => {
//     setFeedbackLoading(true);
//     try {
//       const res = await fetch('/api/feedback');
//       const data = await res.json();
//       if (data.success) {
//         setFeedback(data.feedback || []);
//         setFeedbackCount(data.summary?.new ?? undefined);
//       }
//     } catch {
//       /* non-critical */
//     } finally {
//       setFeedbackLoading(false);
//     }
//   }, []);
// 
//   // Fetch user behavior analysis
//   const fetchUserBehavior = useCallback(async () => {
//     setBehaviorLoading(true);
//     try {
//       const res = await adminFetch('/api/admin/analytics');
//       const data = await res.json();
//       if (data.success) {
//         setUserBehavior(data.user_behavior || []);
//       }
//     } catch (err: any) {
//       console.error('[Admin] Failed to load user behavior:', err);
//     } finally {
//       setBehaviorLoading(false);
//     }
//   }, []);
// 
//   // Fetch stats immediately on mount (no auth needed - API returns public stats)
//   useEffect(() => {
//     fetchStats();
//   }, [fetchStats]);
// 
//   // Initial fetch of other data (requires admin access)
//   useEffect(() => {
//     if (canAccessAdmin) {
//       fetchConnections();
//       fetchPredictionStats();
//       checkPythonHealth();
//       fetchLearningStats(); // Auto-fetch learning stats
//       fetchDataStatus(); // Fetch detailed data status
//       fetchFeedback();
//       fetchAnalytics(); // Fetch analytics data
//       fetchUserBehavior(); // Fetch user behavior data
//     }
//   }, [canAccessAdmin, fetchConnections, fetchPredictionStats, checkPythonHealth, fetchLearningStats, fetchDataStatus, fetchFeedback, fetchAnalytics, fetchUserBehavior]);
// 
//   // Sync data
//   const handleSync = async () => {
//     setSyncing(true);
//     try {
//       const res = await fetch('/api/market/sync-live', {
//         method: 'POST',
//         headers: { 'x-force-refresh': 'true' },
//       });
//       const data = await res.json();
//       if (data.success) {
//         toast.success(`تم تحديث ${data.updated_count} سهم من ${data.source}`);
//         fetchStats();
//         fetchConnections();
//       } else {
//         toast.error(data.details?.errors?.[0] || 'فشل التحديث');
//       }
//     } catch {
//       toast.error('خطأ في التحديث');
//     } finally {
//       setSyncing(false);
//     }
//   };
// 
//   // Multi-market sync (all markets)
//   const handleMultiMarketSync = async () => {
//     setMultiMarketSyncing(true);
//     addDebugLog('MULTI-MARKET SYNC', 'pending', 'Syncing all markets...');
//     try {
//       const res = await fetch('/api/multi-market/sync', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//       });
//       const data = await res.json();
//       if (data.success) {
//         const summary = data.summary || {};
//         const totalSynced = Object.values(summary).reduce((acc: number, val: any) => acc + (val.synced || 0), 0);
//         toast.success(`تم تحديث ${totalSynced} سهم من جميع الأسواق`);
//         addDebugLog('MULTI-MARKET SYNC', 'success', `${totalSynced} stocks synced`, summary);
//         fetchStats();
//         fetchConnections();
//       } else {
//         toast.error(data.error || 'فشل التحديث');
//         addDebugLog('MULTI-MARKET SYNC', 'error', data.error || 'Unknown error');
//       }
//     } catch (err: any) {
//       toast.error('خطأ في التحديث');
//       addDebugLog('MULTI-MARKET SYNC', 'error', err.message);
//     } finally {
//       setMultiMarketSyncing(false);
//     }
//   };
// 
//   // Direct login handler
//   const handleDirectLogin = async (e: React.FormEvent) => {
//     e.preventDefault();
//     setDirectLoginLoading(true);
//     setDirectLoginError('');
// 
//     try {
//       const res = await fetch('/api/admin/auth', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ username: directLoginUsername, password: directLoginPassword }),
//       });
// 
//       const data = await res.json();
//       if (data.success) {
//         setDirectLoggedIn(true);
//         // Cookie is set by the server (httpOnly) — no client-side storage needed (FIX July 2026)
//         toast.success('تم تسجيل الدخول بنجاح');
//       } else {
//         setDirectLoginError(data.error || 'بيانات الدخول غير صحيحة');
//       }
//     } catch {
//       setDirectLoginError('خطأ في الاتصال');
//     } finally {
//       setDirectLoginLoading(false);
//     }
//   };
// 
//   // ==================== COMPUTED VALUES ====================
// 
//   const vpsStatus = connections?.sources?.vps_python;
//   const dbStatus = connections?.sources?.database;
//   const isVpsConnected = vpsStatus?.available === true;
//   const isDbOk = dbStatus?.available === true;
//   const lastUpdate = stats?.stocks?.last_update;
//   const dataAge = lastUpdate ? Date.now() - new Date(lastUpdate).getTime() : null;
//   const dataAgeMinutes = dataAge !== null ? Math.floor(dataAge / 60000) : null;
// 
//   // Compute system issues - now uses detailed data status
//   const systemIssues = useMemo<SystemIssue[]>(() => {
//     const issues: SystemIssue[] = [];
// 
//     // VPS issues
//     if (!isVpsConnected) {
//       issues.push({
//         id: 'vps-offline',
//         severity: 'critical',
//         category: 'service',
//         title: 'VPS Python غير متصل',
//         description: 'خدمة التحليلات المتقدمة غير متاحة',
//         solution: 'تأكد من تشغيل الخدمة على port 8010',
//         timestamp: new Date().toISOString(),
//       });
//     }
// 
//     // Database issues
//     if (!isDbOk) {
//       issues.push({
//         id: 'db-offline',
//         severity: 'critical',
//         category: 'service',
//         title: 'قاعدة البيانات غير متاحة',
//         description: 'لا يمكن الوصول لقاعدة البيانات',
//         solution: 'تحقق من اتصال قاعدة البيانات',
//         timestamp: new Date().toISOString(),
//       });
//     }
// 
//     // Detailed data issues from new API
//     if (dataStatus?.categories) {
//       for (const cat of dataStatus.categories) {
//         // Only show issues for old/error status (not stale - that's expected for closed markets)
//         if (cat.status === 'old') {
//           const isStocks = cat.category.startsWith('stocks_');
//           const dayOfWeek = new Date().getDay(); // 0=Sunday, 5=Friday, 6=Saturday
//           const isWeekend = dayOfWeek === 5; // Friday in Arab markets
// 
//           // Don't show stocks as issue on weekend
//           if (isStocks && isWeekend) continue;
// 
//           issues.push({
//             id: `stale-${cat.category}`,
//             severity: 'warning',
//             category: 'data',
//             title: `${cat.name_ar} - بيانات قديمة`,
//             description: cat.message,
//             solution: 'اضغط على "تحديث البيانات"',
//             timestamp: new Date().toISOString(),
//           });
//         } else if (cat.status === 'error') {
//           issues.push({
//             id: `error-${cat.category}`,
//             severity: 'critical',
//             category: 'data',
//             title: `${cat.name_ar} - خطأ`,
//             description: cat.message,
//             solution: 'تحقق من قاعدة البيانات',
//             timestamp: new Date().toISOString(),
//           });
//         }
//       }
//     }
// 
//     // Prediction performance
//     if (predictionStats && predictionStats.success_rate < 50) {
//       issues.push({
//         id: 'low-prediction-rate',
//         severity: 'warning',
//         category: 'analysis',
//         title: 'نسبة نجاح منخفضة',
//         description: `نسبة نجاح التوقعات ${predictionStats?.success_rate?.toFixed?.(1) ?? 0}%`,
//         solution: 'راجع معايير التحليل والـ thresholds',
//         timestamp: new Date().toISOString(),
//       });
//     }
// 
//     return issues;
//   }, [isVpsConnected, isDbOk, dataStatus, predictionStats]);
// 
//   // Compute services status
//   const services = useMemo<ServiceStatus[]>(() => [
//     {
//       name: 'VPS Python',
//       nameAr: 'خادم التحليلات',
//       status: isVpsConnected ? 'online' : 'offline',
//       latency: vpsStatus?.latency_ms,
//       lastCheck: connections?.timestamp || new Date().toISOString(),
//       message: vpsStatus?.message || (isVpsConnected ? 'يعمل بشكل طبيعي' : 'غير متصل'),
//     },
//     {
//       name: 'Database',
//       nameAr: 'قاعدة البيانات',
//       status: isDbOk ? 'online' : 'offline',
//       lastCheck: connections?.timestamp || new Date().toISOString(),
//       message: dbStatus?.message || (isDbOk ? 'متاحة' : 'غير متاحة'),
//     },
//     {
//       name: 'Data Freshness',
//       nameAr: 'تحديث البيانات',
//       status: dataAgeMinutes !== null && dataAgeMinutes < 30 ? 'online' : dataAgeMinutes !== null && dataAgeMinutes < 60 ? 'degraded' : 'offline',
//       lastCheck: lastUpdate || new Date().toISOString(),
//       message: lastUpdate ? `منذ ${dataAgeMinutes ?? '—'} دقيقة` : 'لا توجد بيانات',
//     },
//   ], [isVpsConnected, isDbOk, vpsStatus, dbStatus, connections, dataAgeMinutes, lastUpdate]);
// 
//   // Critical issues count
//   const criticalCount = systemIssues.filter(i => i.severity === 'critical').length;
//   const warningCount = systemIssues.filter(i => i.severity === 'warning').length;
// 
//   // System health score
//   const healthScore = useMemo(() => {
//     let score = 100;
//     if (!isVpsConnected) score -= 30;
//     if (!isDbOk) score -= 40;
//     if (dataAgeMinutes !== null && dataAgeMinutes > 60) score -= 20;
//     else if (dataAgeMinutes !== null && dataAgeMinutes > 30) score -= 10;
//     if (predictionStats && predictionStats.success_rate < 50) score -= 10;
//     return Math.max(0, score);
//   }, [isVpsConnected, isDbOk, dataAgeMinutes, predictionStats]);
// 
//   // ==================== ADMIN GUARD ====================
// 
//   if (!isMounted) {
//     return (
//       <div className="min-h-screen flex items-center justify-center" dir="rtl">
//         <div className="flex items-center gap-3">
//           <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
//           <span className="text-muted-foreground">جاري التحميل...</span>
//         </div>
//       </div>
//     );
//   }
// 
//   if (!canAccessAdmin) {
//     return (
//       <div className="min-h-screen flex items-center justify-center p-4" dir="rtl">
//         <Card className="w-full max-w-md">
//           <CardHeader className="text-center">
//             <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-100 dark:bg-emerald-950/30 flex items-center justify-center">
//               <Shield className="w-8 h-8 text-emerald-500" />
//             </div>
//             <CardTitle>دخول المدير</CardTitle>
//             <CardDescription>أدخل بيانات الدخول للوصول للوحة التحكم</CardDescription>
//           </CardHeader>
//           <CardContent>
//             <form onSubmit={handleDirectLogin} className="space-y-4">
//               <div className="space-y-2">
//                 <label className="text-sm font-medium">اسم المستخدم</label>
//                 <Input
//                   type="text"
//                   value={directLoginUsername}
//                   onChange={(e) => setDirectLoginUsername(e.target.value)}
//                   placeholder="أدخل اسم المستخدم"
//                   required
//                 />
//               </div>
//               <div className="space-y-2">
//                 <label className="text-sm font-medium">كلمة المرور</label>
//                 <Input
//                   type="password"
//                   value={directLoginPassword}
//                   onChange={(e) => setDirectLoginPassword(e.target.value)}
//                   placeholder="أدخل كلمة المرور"
//                   required
//                 />
//               </div>
//               {directLoginError && (
//                 <p className="text-sm text-red-500 text-center">{directLoginError}</p>
//               )}
//               <Button type="submit" className="w-full" disabled={directLoginLoading}>
//                 {directLoginLoading ? (
//                   <><Loader2 className="w-4 h-4 ml-2 animate-spin" /> جاري الدخول...</>
//                 ) : (
//                   <><Shield className="w-4 h-4 ml-2" /> دخول</>
//                 )}
//               </Button>
//             </form>
//           </CardContent>
//         </Card>
//       </div>
//     );
//   }
// 
//   // ==================== RENDER ====================
// 
//   // Stream C: 6 Core Admin Hubs — consolidates 26 flat tabs into 6 logical sectors.
//   // Each hub groups related tabs; clicking a tab auto-expands its hub (see expandedHub state).
//   const ADMIN_HUBS: {
//     id: HubId;
//     label: string;
//     icon: React.ReactNode;
//     accent: string;
//     tabs: { id: AdminTab; label: string; icon: React.ReactNode; count?: number }[];
//   }[] = [
//     {
//       id: 'health',
//       label: 'المراقبة وصحة النظام',
//       icon: <Activity className="w-4 h-4" />,
//       accent: 'border-emerald-500/40 bg-emerald-500/5',
//       tabs: [
//         { id: 'dashboard', label: 'لوحة التحكم', icon: <Activity className="w-3.5 h-3.5" /> },
//         { id: 'problems', label: 'مشاكل النظام', icon: <ShieldAlert className="w-3.5 h-3.5" /> },
//       ],
//     },
//     {
//       id: 'maestro',
//       label: 'المحركات',
//       icon: <Zap className="w-4 h-4" />,
//       accent: 'border-amber-500/40 bg-amber-500/5',
//       tabs: [
//         { id: 'general', label: 'المحركات', icon: <Server className="w-3.5 h-3.5" /> },
//         { id: 'engine-settings', label: 'إعدادات المحرك', icon: <Settings className="w-3.5 h-3.5" /> },
//         { id: 'data-engine', label: 'المحرك', icon: <span className="text-sm">🔥</span> },
//       ],
//     },
//     {
//       id: 'learning',
//       label: 'التعلم الذكي والتوقعات',
//       icon: <Brain className="w-4 h-4" />,
//       accent: 'border-violet-500/40 bg-violet-500/5',
//       tabs: [
//         { id: 'learning', label: 'التعلم الذكي', icon: <Brain className="w-3.5 h-3.5" /> },
//         { id: 'historical-predictions', label: 'التوقعات التاريخية', icon: <History className="w-3.5 h-3.5" /> },
//         { id: 'backtest', label: 'الباك تست', icon: <Activity className="w-3.5 h-3.5" /> },
//         { id: 'platform-performance', label: 'كفاءة المنصة', icon: <Gauge className="w-3.5 h-3.5" /> },
//       ],
//     },
//     {
//       id: 'data',
//       label: 'البيانات وقواعد البيانات',
//       icon: <Database className="w-4 h-4" />,
//       accent: 'border-sky-500/40 bg-sky-500/5',
//       tabs: [
//         { id: 'databases', label: 'قواعد البيانات', icon: <Database className="w-3.5 h-3.5" /> },
//         { id: 'system-control', label: 'تحكم شامل', icon: <Settings className="w-3.5 h-3.5" /> },
//         { id: 'crypto', label: 'الكريبتو', icon: <Coins className="w-3.5 h-3.5" /> },
//         { id: 'gold-silver', label: 'الذهب والفضة', icon: <Coins className="w-3.5 h-3.5" /> },
//         { id: 'multi-market', label: 'الأسواق المتعددة', icon: <Network className="w-3.5 h-3.5" /> },
//         { id: 'forex', label: 'الفوركس', icon: <DollarSign className="w-3.5 h-3.5" /> },
//         { id: 'sectors', label: 'القطاعات', icon: <Building2 className="w-3.5 h-3.5" /> },
//       ],
//     },
//     {
//       id: 'users',
//       label: 'المستخدمين والاشتراكات',
//       icon: <Users className="w-4 h-4" />,
//       accent: 'border-rose-500/40 bg-rose-500/5',
//       tabs: [
//         { id: 'users', label: 'المستخدمين', icon: <Users className="w-3.5 h-3.5" /> },
//         { id: 'behavior', label: 'تحليل الاستخدام', icon: <BarChart3 className="w-3.5 h-3.5" /> },
//         { id: 'promo-codes', label: 'أكواد الخصم', icon: <Ticket className="w-3.5 h-3.5" /> },
//         { id: 'feedback', label: 'آراء المستخدمين', icon: <MessageSquareText className="w-3.5 h-3.5" />, count: feedbackCount },
//       ],
//     },
//     {
//       id: 'telegram',
//       label: 'التواصل والتنبيهات',
//       icon: <Send className="w-4 h-4" />,
//       accent: 'border-teal-500/40 bg-teal-500/5',
//       tabs: [
//         { id: 'telegram', label: 'تيليجرام', icon: <Send className="w-3.5 h-3.5" /> },
//         { id: 'reports', label: 'التقارير الذكية', icon: <FileText className="w-3.5 h-3.5" /> },
//         { id: 'educational-cards', label: 'الكروت التعليمية', icon: <GraduationCap className="w-3.5 h-3.5" /> },
//         { id: 'expert-recs', label: 'توصيات الخبراء', icon: <ClipboardList className="w-3.5 h-3.5" /> },
//       ],
//     },
//   ];
// 
//   return (
//     <div className="min-h-screen p-4 md:p-6" dir="rtl">
//       {/* Header */}
//       <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
//         <div className="flex items-center gap-3">
//           <div className={cn(
//             "w-12 h-12 rounded-xl flex items-center justify-center",
//             healthScore >= 80 ? "bg-emerald-100 dark:bg-emerald-900/30" :
//               healthScore >= 50 ? "bg-amber-100 dark:bg-amber-900/30" :
//                 "bg-red-100 dark:bg-red-900/30"
//           )}>
//             <Shield className={cn(
//               "w-6 h-6",
//               healthScore >= 80 ? "text-emerald-600" :
//                 healthScore >= 50 ? "text-amber-600" :
//                   "text-red-600"
//             )} />
//           </div>
//           <div>
//             <h1 className="text-xl font-bold text-foreground">لوحة التحكم</h1>
//             <p className="text-sm text-muted-foreground">
//               حالة النظام: {healthScore >= 80 ? 'ممتاز' : healthScore >= 50 ? 'يحتاج مراجعة' : 'يوجد مشاكل'}
//             </p>
//           </div>
//         </div>
// 
//         <div className="flex items-center gap-2">
//           {criticalCount > 0 && (
//             <Badge variant="destructive" className="gap-1">
//               <AlertTriangle className="w-3 h-3" />
//               {criticalCount} مشكلة
//             </Badge>
//           )}
//           {warningCount > 0 && (
//             <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
//               <AlertCircle className="w-3 h-3" />
//               {warningCount} تحذير
//             </Badge>
//           )}
//           <Button
//             variant="outline"
//             size="sm"
//             onClick={() => { fetchStats(); fetchConnections(); fetchPredictionStats(); }}
//             disabled={statsLoading}
//             className="gap-1"
//           >
//             <RefreshCw className={cn("w-4 h-4", statsLoading && "animate-spin")} />
//             تحديث
//           </Button>
//         </div>
//       </div>
// 
//       {/* Stream C: 6 Core Admin Hubs — replaces the 26-tab flat nav.
//           Each hub is a collapsible sector. Clicking a tab auto-expands its hub. */}
//       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 mb-6">
//         {ADMIN_HUBS.map(hub => {
//           const isExpanded = expandedHub === hub.id;
//           const hasActive = hub.tabs.some(t => t.id === activeTab);
//           return (
//             <div
//               key={hub.id}
//               className={cn(
//                 'rounded-lg border transition-colors',
//                 hub.accent,
//                 hasActive && 'ring-1 ring-primary/40'
//               )}
//             >
//               <button
//                 type="button"
//                 onClick={() => setExpandedHub(prev => (prev === hub.id && !hasActive ? null : hub.id))}
//                 className="w-full flex items-center justify-between px-3 py-2 text-right hover:bg-accent/30 rounded-t-lg"
//               >
//                 <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
//                   {hub.icon}
//                   {hub.label}
//                   {hasActive && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
//                 </span>
//                 {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
//               </button>
//               {isExpanded && (
//                 <div className="flex flex-wrap gap-1.5 px-3 pb-3 pt-1.5 border-t border-border/30">
//                   {hub.tabs.map(tab => (
//                     <Button
//                       key={tab.id}
//                       variant={activeTab === tab.id ? 'default' : 'outline'}
//                       size="sm"
//                       onClick={() => { setActiveTab(tab.id); setExpandedHub(hub.id); }}
//                       className="whitespace-nowrap gap-1 h-8 text-xs"
//                     >
//                       {tab.icon}
//                       {tab.label}
//                       {tab.count !== undefined && tab.count > 0 && (
//                         <Badge variant="secondary" className="mr-1 h-5 w-5 p-0 flex items-center justify-center text-[10px]">
//                           {tab.count}
//                         </Badge>
//                       )}
//                     </Button>
//                   ))}
//                 </div>
//               )}
//             </div>
//           );
//         })}
//       </div>
// 
//       {/* ==================== DASHBOARD TAB ==================== */}
//       {activeTab === 'dashboard' && (
//         <div className="space-y-6">
//           {/* Health Score & Quick Stats */}
//           <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
//             {/* System Health */}
//             <Card className="md:col-span-1">
//               <CardContent className="p-6">
//                 <div className="text-center">
//                   <div className={cn(
//                     "w-20 h-20 mx-auto rounded-full flex items-center justify-center text-2xl font-bold",
//                     healthScore >= 80 ? "bg-emerald-100 text-emerald-600" :
//                       healthScore >= 50 ? "bg-amber-100 text-amber-600" :
//                         "bg-red-100 text-red-600"
//                   )}>
//                     {healthScore}%
//                   </div>
//                   <p className="mt-3 font-medium">صحة النظام</p>
//                   <Progress
//                     value={healthScore}
//                     className={cn(
//                       "mt-2 h-2",
//                       healthScore >= 80 ? "[&>div]:bg-emerald-500" :
//                         healthScore >= 50 ? "[&>div]:bg-amber-500" :
//                           "[&>div]:bg-red-500"
//                     )}
//                   />
//                 </div>
//               </CardContent>
//             </Card>
// 
//             {/* Quick Stats */}
//             <Card className="md:col-span-3">
//               <CardContent className="p-4">
//                 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
//                   <div className="text-center p-3 rounded-lg bg-muted/50">
//                     <Users className="w-6 h-6 mx-auto mb-2 text-blue-500" />
//                     <div className="text-2xl font-bold">{stats?.users?.total ?? 0}</div>
//                     <div className="text-xs text-muted-foreground">مستخدم</div>
//                   </div>
//                   <div className="text-center p-3 rounded-lg bg-muted/50">
//                     <TrendingUp className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
//                     <div className="text-2xl font-bold">{stats?.stocks?.active ?? 0}</div>
//                     <div className="text-xs text-muted-foreground">سهم نشط</div>
//                   </div>
//                   <div className="text-center p-3 rounded-lg bg-muted/50">
//                     <Target className="w-6 h-6 mx-auto mb-2 text-purple-500" />
//                     <div className="text-2xl font-bold">{predictionStats?.total_predictions ?? 0}</div>
//                     <div className="text-xs text-muted-foreground">توقع</div>
//                   </div>
//                   <div className="text-center p-3 rounded-lg bg-muted/50">
//                     <BarChart3 className="w-6 h-6 mx-auto mb-2 text-amber-500" />
//                     <div className="text-2xl font-bold">{predictionStats?.success_rate?.toFixed?.(0) ?? 0}%</div>
//                     <div className="text-xs text-muted-foreground">نسبة النجاح</div>
//                   </div>
//                 </div>
//               </CardContent>
//             </Card>
//           </div>
// 
//           {/* Phase 9: Purge Cache + Rebuild Predictions */}
//           <PurgeCacheButton />
// 
//           {/* Data Status by Market - جديد */}
//           <Card>
//             <CardHeader className="pb-2">
//               <div className="flex items-center justify-between">
//                 <CardTitle className="text-base flex items-center gap-2">
//                   <Database className="w-5 h-5 text-emerald-500" />
//                   حالة تحديث البيانات (تفصيلي)
//                 </CardTitle>
//                 <div className="flex items-center gap-2">
//                   {dataStatus?.summary && (
//                     <Badge variant={dataStatus.summary.health_score >= 80 ? 'default' : dataStatus.summary.health_score >= 50 ? 'outline' : 'destructive'} className="gap-1">
//                       صحة البيانات: {dataStatus.summary.health_score}%
//                     </Badge>
//                   )}
//                   <Button variant="ghost" size="sm" onClick={fetchDataStatus} disabled={dataStatusLoading}>
//                     <RefreshCw className={cn("w-4 h-4", dataStatusLoading && "animate-spin")} />
//                   </Button>
//                 </div>
//               </div>
//             </CardHeader>
//             <CardContent>
//               {dataStatusLoading && !dataStatus ? (
//                 <div className="flex items-center justify-center py-8">
//                   <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
//                 </div>
//               ) : dataStatus?.categories ? (
//                 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
//                   {dataStatus.categories.map((cat) => (
//                     <div key={cat.category} className={cn(
//                       "p-3 rounded-lg border-2",
//                       cat.status === 'fresh' ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20" :
//                         cat.status === 'stale' ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20" :
//                           cat.status === 'old' ? "border-red-300 bg-red-50 dark:bg-red-950/20" :
//                             "border-gray-300 bg-gray-50 dark:bg-gray-950/20"
//                     )}>
//                       <div className="flex items-center justify-between mb-2">
//                         <span className="font-medium text-sm">{cat.name_ar}</span>
//                         <div className={cn(
//                           "w-2.5 h-2.5 rounded-full",
//                           cat.status === 'fresh' ? "bg-emerald-500" :
//                             cat.status === 'stale' ? "bg-amber-500" :
//                               cat.status === 'old' ? "bg-red-500" :
//                                 "bg-gray-400"
//                         )} />
//                       </div>
//                       <div className="text-lg font-bold">{cat.count.toLocaleString()}</div>
//                       <div className="text-xs text-muted-foreground">{cat.message}</div>
//                     </div>
//                   ))}
//                 </div>
//               ) : (
//                 <div className="text-center py-8 text-muted-foreground">
//                   لا توجد بيانات
//                 </div>
//               )}
//             </CardContent>
//           </Card>
// 
//           {/* Quick Actions */}
//           <Card>
//             <CardHeader className="pb-2">
//               <CardTitle className="text-base flex items-center gap-2">
//                 <Zap className="w-5 h-5 text-amber-500" />
//                 إجراءات سريعة
//               </CardTitle>
//             </CardHeader>
//             <CardContent>
//               <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
//                 <Button onClick={handleSync} disabled={syncing} className="h-auto py-4 flex-col gap-2">
//                   <RefreshCw className={cn("w-6 h-6", syncing && "animate-spin")} />
//                   <span>تحديث البيانات</span>
//                   {lastUpdate && (
//                     <span className="text-[10px] opacity-70">منذ {dataAgeMinutes ?? '—'} دقيقة</span>
//                   )}
//                 </Button>
//                 <Button
//                   onClick={handleMultiMarketSync}
//                   disabled={multiMarketSyncing}
//                   variant="secondary"
//                   className="h-auto py-4 flex-col gap-2"
//                 >
//                   <RefreshCw className={cn("w-6 h-6", multiMarketSyncing && "animate-spin")} />
//                   <span>تحديث كل الأسواق</span>
//                   <span className="text-[10px] opacity-70">EGX, KSA, KSE, DFM...</span>
//                 </Button>
//                 {/* Stream C: fixed dead 'egx' button → now correctly opens the learning hub tab */}
//                 <Button variant="outline" onClick={() => { setActiveTab('learning'); setExpandedHub('learning'); }} className="h-auto py-4 flex-col gap-2">
//                   <Brain className="w-6 h-6" />
//                   <span>التعلم الذكي</span>
//                   <span className="text-[10px] opacity-70">تحسين التحليل</span>
//                 </Button>
//                 <Button variant="outline" onClick={() => setActiveTab('dashboard')} className="h-auto py-4 flex-col gap-2 relative">
//                   <Zap className="w-6 h-6" />
//                   <span>مركز القيادة</span>
//                   <span className="text-[10px] opacity-70">Maestro Command Center</span>
//                 </Button>
//                 <Button variant="outline" onClick={() => setActiveTab('data-engine')} className="h-auto py-4 flex-col gap-2">
//                   <Database className="w-6 h-6" />
//                   <span>إدارة البيانات</span>
//                   <span className="text-[10px] opacity-70">المحرك والمصادر</span>
//                 </Button>
//               </div>
//             </CardContent>
//           </Card>
// 
//           {/* Services Status Mini */}
//           <Card>
//             <CardHeader className="pb-2">
//               <div className="flex items-center justify-between">
//                 <CardTitle className="text-base flex items-center gap-2">
//                   <Server className="w-5 h-5 text-blue-500" />
//                   حالة الخدمات
//                 </CardTitle>
//                 <Button variant="ghost" size="sm" onClick={() => setActiveTab('dashboard')}>
//                   المخطط الكامل
//                 </Button>
//               </div>
//             </CardHeader>
//             <CardContent>
//               <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
//                 {services.map(service => (
//                   <div key={service.name} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
//                     <div className={cn(
//                       "w-3 h-3 rounded-full",
//                       service.status === 'online' ? "bg-emerald-500" :
//                         service.status === 'degraded' ? "bg-amber-500" :
//                           "bg-red-500"
//                     )} />
//                     <div className="flex-1 min-w-0">
//                       <div className="font-medium text-sm truncate">{service.nameAr}</div>
//                       <div className="text-xs text-muted-foreground truncate">{service.message}</div>
//                     </div>
//                     {service.latency && (
//                       <div className="text-xs text-muted-foreground">{service.latency}ms</div>
//                     )}
//                   </div>
//                 ))}
//               </div>
//             </CardContent>
//           </Card>
// 
//           {/* Mini command center preview */}
//           <Card className="border-emerald-200 dark:border-emerald-800/50">
//             <CardHeader className="pb-2">
//               <div className="flex items-center justify-between">
//                 <CardTitle className="text-base flex items-center gap-2">
//                   <Zap className="w-5 h-5 text-emerald-500" />
//                   لوحة التحكم
//                 </CardTitle>
//                 <Button variant="ghost" size="sm" onClick={() => setActiveTab('dashboard')}>
//                   عرض كامل
//                 </Button>
//               </div>
//             </CardHeader>
//             <CardContent>
//               <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
//                 <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
//                   <Server className="w-5 h-5 text-emerald-500" />
//                   <div>
//                     <div className="text-xs text-muted-foreground">المحركات</div>
//                     <div className="font-bold">
//                       <span className="text-emerald-600">{services.filter(s => s.status === 'online').length}</span>
//                       <span className="text-muted-foreground"> / {services.length}</span>
//                     </div>
//                   </div>
//                 </div>
//                 <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
//                   <Database className="w-5 h-5 text-blue-500" />
//                   <div>
//                     <div className="text-xs text-muted-foreground">قواعد البيانات</div>
//                     <div className="font-bold">
//                       <span className="text-emerald-600">{dataStatus?.categories?.filter(c => c.status === 'fresh').length || 0}</span>
//                       <span className="text-muted-foreground"> متاحة</span>
//                     </div>
//                   </div>
//                 </div>
//                 <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
//                   <Zap className="w-5 h-5 text-amber-500" />
//                   <div>
//                     <div className="text-xs text-muted-foreground">صحة النظام</div>
//                     <div className="font-bold text-emerald-600">{healthScore}%</div>
//                   </div>
//                 </div>
//                 <Button variant="outline" size="sm" onClick={() => setActiveTab('dashboard')} className="h-auto py-3">
//                   <Zap className="w-4 h-4 ml-1" />
//                   مركز القيادة
//                 </Button>
//               </div>
//             </CardContent>
//           </Card>
//         </div>
//       )}
// 
//       {/* ==================== SYSTEM PROBLEMS TAB ==================== */}
//       {activeTab === 'problems' && (
//         <SystemProblemsTab
//           issues={systemIssues}
//           criticalCount={criticalCount}
//           warningCount={warningCount}
//           onRefresh={() => {
//             fetchStats();
//             fetchConnections();
//             fetchPredictionStats();
//             fetchDataStatus();
//             checkPythonHealth();
//           }}
//           refreshing={statsLoading || dataStatusLoading || connectionsLoading}
//         />
//       )}
// 
//       {/* ==================== MAESTRO COMMAND CENTER ==================== */}
//       {false && (
//         <MaestroCommandCenter />
//       )}
// 
//       {/* ==================== GENERAL (ENGINES STATUS) TAB ==================== */}
//       {activeTab === 'general' && (
//         <EnginesStatusTab />
//       )}
// 
//       {/* ==================== ENGINE SETTINGS TAB (DYNAMIC-ADMIN-UI) ==================== */}
//       {activeTab === 'engine-settings' && (
//         <EngineSettingsTab />
//       )}
// 
//       {/* ==================== LEARNING TAB (Unified) ==================== */}
//       {activeTab === 'learning' && (
//         <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
//           <div className="lg:col-span-2">
//             <SuperLearningSystem />
//           </div>
//           <div>
//             <RegimeDetectionWidget />
//           </div>
//         </div>
//       )}
// 
//       {/* ==================== HISTORICAL PREDICTIONS TAB ==================== */}
//       {activeTab === 'historical-predictions' && (
//         <div className="w-full">
//           <iframe
//             src="/admin/honest-predictions"
//             title="التوقعات التاريخية"
//             className="w-full"
//             style={{ minHeight: '80vh', border: 'none', height: '100%' }}
//           />
//         </div>
//       )}
// 
//       {/* ==================== BACKTEST TAB (V40.2 Engine) ==================== */}
//       {activeTab === 'backtest' && (
//         <BacktestTab />
//       )}
// 
//       {/* ==================== PLATFORM PERFORMANCE TAB (Admin Only) ==================== */}
//       {activeTab === 'platform-performance' && (
//         <PlatformPerformanceView />
//       )}
// 
//       {/* ==================== MAESTRO TAB ==================== */}
//       {false && (
//         <MaestroDashboard />
//       )}
// 
//       {/* ==================== CRYPTO TAB ==================== */}
//       {activeTab === 'crypto' && (
//         <CryptoAdminPanel />
//       )}
// 
//       {/* ==================== GOLD-SILVER TAB ==================== */}
//       {activeTab === 'gold-silver' && (
//         <GoldSilverTab />
//       )}
// 
//       {/* ==================== MULTI-MARKET TAB ==================== */}
//       {activeTab === 'multi-market' && (
//         <MultiMarketTab />
//       )}
// 
//       {/* ==================== FOREX TAB ==================== */}
//       {activeTab === 'forex' && (
//         <ForexTab />
//       )}
// 
//       {/* ==================== DATA ENGINE TAB ==================== */}
//       {activeTab === 'data-engine' && (
//         <DataEngineTab />
//       )}
// 
//       {/* ==================== SECTORS TAB ==================== */}
//       {activeTab === 'sectors' && (
//         <SectorClassificationAdmin />
//       )}
// 
//       {/* ==================== USERS TAB ==================== */}
//       {activeTab === 'users' && (
//         <div className="space-y-6">
//           {analyticsData && (
//             <div className="space-y-6">
//               <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
//                 <Card>
//                   <CardContent className="p-4 text-center">
//                     <div className="text-2xl font-bold">{analyticsData.summary.today_page_views}</div>
//                     <div className="text-xs text-muted-foreground">مشاهدات اليوم</div>
//                   </CardContent>
//                 </Card>
//                 <Card>
//                   <CardContent className="p-4 text-center">
//                     <div className="text-2xl font-bold text-emerald-500">{analyticsData.summary.today_unique_users}</div>
//                     <div className="text-xs text-muted-foreground">مستخدمون نشطون</div>
//                   </CardContent>
//                 </Card>
//                 <Card>
//                   <CardContent className="p-4 text-center">
//                     <div className="text-2xl font-bold text-amber-500">{analyticsData.summary.today_events}</div>
//                     <div className="text-xs text-muted-foreground">أحداث اليوم</div>
//                   </CardContent>
//                 </Card>
//                 <Card>
//                   <CardContent className="p-4 text-center">
//                     <div className="text-2xl font-bold text-red-500">{analyticsData.summary.today_errors}</div>
//                     <div className="text-xs text-muted-foreground">أخطاء اليوم</div>
//                   </CardContent>
//                 </Card>
//               </div>
// 
//               <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
//                 <Card className="lg:col-span-2">
//                   <CardHeader>
//                     <CardTitle className="text-base flex items-center gap-2">
//                       <Activity className="w-4 h-4" />
//                       حركة المرور (30 يوم)
//                     </CardTitle>
//                   </CardHeader>
//                   <CardContent>
//                     <div className="h-64">
//                       <ResponsiveContainer width="100%" height="100%">
//                         <AreaChart data={analyticsData.daily_traffic}>
//                           <defs>
//                             <linearGradient id="colorPv" x1="0" y1="0" x2="0" y2="1">
//                               <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
//                               <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
//                             </linearGradient>
//                             <linearGradient id="colorErr" x1="0" y1="0" x2="0" y2="1">
//                               <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
//                               <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
//                             </linearGradient>
//                           </defs>
//                           <CartesianGrid strokeDasharray="3 3" />
//                           <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
//                           <YAxis tick={{ fontSize: 11 }} />
//                           <Tooltip />
//                           <Legend />
//                           <Area type="monotone" dataKey="page_views" stroke="#3b82f6" fillOpacity={1} fill="url(#colorPv)" name="مشاهدات" />
//                           <Area type="monotone" dataKey="errors" stroke="#ef4444" fillOpacity={1} fill="url(#colorErr)" name="أخطاء" />
//                         </AreaChart>
//                       </ResponsiveContainer>
//                     </div>
//                   </CardContent>
//                 </Card>
// 
//                 <Card>
//                   <CardHeader>
//                     <CardTitle className="text-base flex items-center gap-2">
//                       <Zap className="w-4 h-4" />
//                       الأقسام الأكثر زيارة
//                     </CardTitle>
//                   </CardHeader>
//                   <CardContent>
//                     <div className="space-y-2">
//                       {analyticsData.page_views_by_section.slice(0, 8).map((section: any) => (
//                         <div key={section.view} className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded">
//                           <span className="truncate ml-2">{section.view || 'غير محدد'}</span>
//                           <Badge variant="secondary" className="text-xs">{section.count}</Badge>
//                         </div>
//                       ))}
//                       {analyticsData.page_views_by_section.length === 0 && (
//                         <p className="text-xs text-muted-foreground">لا توجد بيانات</p>
//                       )}
//                     </div>
//                   </CardContent>
//                 </Card>
//               </div>
//             </div>
//           )}
//           <UsersManagement />
//         </div>
//       )}
// 
//       {/* ==================== BEHAVIOR TAB ==================== */}
//       {activeTab === 'behavior' && (
//         <div className="space-y-6">
//           <div className="flex items-center justify-between">
//             <div>
//               <h2 className="text-xl font-bold">تحليل سلوك المستخدمين</h2>
//               <p className="text-sm text-muted-foreground">معرفة الصفحات والخدمات الأكثر استخداماً لكل مستخدم</p>
//             </div>
//             <Button variant="outline" size="sm" onClick={fetchUserBehavior} disabled={behaviorLoading}>
//               <RefreshCw className={cn("w-4 h-4", behaviorLoading && "animate-spin")} />
//               تحديث
//             </Button>
//           </div>
// 
//           {behaviorLoading && userBehavior.length === 0 ? (
//             <div className="flex items-center justify-center py-12">
//               <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
//             </div>
//           ) : (
//             <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
//               <Card>
//                 <CardContent className="p-4 text-center">
//                   <div className="text-2xl font-bold">{userBehavior.length}</div>
//                   <div className="text-xs text-muted-foreground">مستخدمون نشطون (30 يوم)</div>
//                 </CardContent>
//               </Card>
//               <Card>
//                 <CardContent className="p-4 text-center">
//                   <div className="text-2xl font-bold text-blue-500">
//                     {userBehavior.reduce((acc: number, u: any) => acc + (u.page_views || 0), 0)}
//                   </div>
//                   <div className="text-xs text-muted-foreground">إجمالي مشاهدات</div>
//                 </CardContent>
//               </Card>
//               <Card>
//                 <CardContent className="p-4 text-center">
//                   <div className="text-2xl font-bold text-amber-500">
//                     {userBehavior.reduce((acc: number, u: any) => acc + (u.feature_uses || 0), 0)}
//                   </div>
//                   <div className="text-xs text-muted-foreground">إجمالي استخدام ميزات</div>
//                 </CardContent>
//               </Card>
//               <Card>
//                 <CardContent className="p-4 text-center">
//                   <div className="text-2xl font-bold text-purple-500">
//                     {userBehavior.length > 0 ? Math.round(userBehavior.reduce((acc: number, u: any) => acc + (u.page_views || 0), 0) / userBehavior.length) : 0}
//                   </div>
//                   <div className="text-xs text-muted-foreground">متوسط المشاهدات/مستخدم</div>
//                 </CardContent>
//               </Card>
//             </div>
//           )}
// 
//           {!behaviorLoading && userBehavior.length > 0 && (
//             <Card>
//               <CardHeader>
//                 <CardTitle className="text-base flex items-center gap-2">
//                   <Activity className="w-4 h-4" />
//                   تفاصيل سلوك المستخدمين
//                 </CardTitle>
//               </CardHeader>
//               <CardContent>
//                 <div className="overflow-x-auto">
//                   <table className="w-full text-sm">
//                     <thead>
//                       <tr className="border-b">
//                         <th className="text-right p-2">المستخدم</th>
//                         <th className="text-right p-2">أكثر صفحة مستخدمة</th>
//                         <th className="text-right p-2">زيارات الصفحة</th>
//                         <th className="text-right p-2">أكثر ميزة مستخدمة</th>
//                         <th className="text-right p-2">استخدام الميزة</th>
//                         <th className="text-right p-2">مشاهدات</th>
//                         <th className="text-right p-2">استخدام ميزات</th>
//                         <th className="text-right p-2">أخطاء</th>
//                         <th className="text-right p-2">آخر نشاط</th>
//                       </tr>
//                     </thead>
//                     <tbody>
//                       {userBehavior.map((user: any, idx: number) => (
//                         <tr key={idx} className="border-b hover:bg-muted/30">
//                           <td className="p-2 font-medium">{user.user_id || 'مجهول'}</td>
//                           <td className="p-2">{user.top_page || '—'}</td>
//                           <td className="p-2">{user.top_page_count || 0}</td>
//                           <td className="p-2">{user.top_feature || '—'}</td>
//                           <td className="p-2">{user.top_feature_count || 0}</td>
//                           <td className="p-2">{user.page_views || 0}</td>
//                           <td className="p-2">{user.feature_uses || 0}</td>
//                           <td className="p-2">{user.errors || 0}</td>
//                           <td className="p-2 text-xs text-muted-foreground">
//                             {user.last_seen ? new Date(user.last_seen).toLocaleString('ar-EG') : '—'}
//                           </td>
//                         </tr>
//                       ))}
//                     </tbody>
//                   </table>
//                 </div>
//               </CardContent>
//             </Card>
//           )}
// 
//           {!behaviorLoading && userBehavior.length > 0 && (
//             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
//               <Card>
//                 <CardHeader>
//                   <CardTitle className="text-base flex items-center gap-2">
//                     <Eye className="w-4 h-4" />
//                     الصفحات الأكثر استخداماً
//                   </CardTitle>
//                 </CardHeader>
//                 <CardContent>
//                   {(() => {
//                     const pageCounts = new Map<string, number>();
//                     for (const u of userBehavior) {
//                       for (const p of (u.top_pages || [])) {
//                         const key = String(p.page || '');
//                         pageCounts.set(key, (pageCounts.get(key) || 0) + Number(p.count || 0));
//                       }
//                     }
//                     const sorted = Array.from(pageCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
//                     if (sorted.length === 0) return <p className="text-xs text-muted-foreground">لا توجد بيانات</p>;
//                     return (
//                       <div className="space-y-2">
//                         {sorted.map(([page, count]) => (
//                           <div key={page} className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded">
//                             <span className="truncate ml-2">{page || 'غير محدد'}</span>
//                             <Badge variant="secondary" className="text-xs">{count}</Badge>
//                           </div>
//                         ))}
//                       </div>
//                     );
//                   })()}
//                 </CardContent>
//               </Card>
// 
//               <Card>
//                 <CardHeader>
//                   <CardTitle className="text-base flex items-center gap-2">
//                     <Zap className="w-4 h-4" />
//                     الميزات الأكثر استخداماً
//                   </CardTitle>
//                 </CardHeader>
//                 <CardContent>
//                   {(() => {
//                     const featureCounts = new Map<string, number>();
//                     for (const u of userBehavior) {
//                       for (const f of (u.top_features || [])) {
//                         const key = String(f.feature || '');
//                         featureCounts.set(key, (featureCounts.get(key) || 0) + Number(f.count || 0));
//                       }
//                     }
//                     const sorted = Array.from(featureCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
//                     if (sorted.length === 0) return <p className="text-xs text-muted-foreground">لا توجد بيانات</p>;
//                     return (
//                       <div className="space-y-2">
//                         {sorted.map(([feature, count]) => (
//                           <div key={feature} className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded">
//                             <span className="truncate ml-2">{feature || 'غير محدد'}</span>
//                             <Badge variant="secondary" className="text-xs">{count}</Badge>
//                           </div>
//                         ))}
//                       </div>
//                     );
//                   })()}
//                 </CardContent>
//               </Card>
//             </div>
//           )}
//         </div>
//       )}

      {/* historical-predictions-v2 & v38-backtest tabs REMOVED (2026-08-13) — consolidated into نظام التعلم الذكي الموحد (Maestro) */}

      {/* ==================== EXPERT RECOMMENDATIONS TAB (توصيات الخبراء) ==================== */}
//       {activeTab === 'expert-recs' && (
//         <div className="bg-background rounded-lg p-2">
//           <HumanRecommendationsAdmin />
//         </div>
//       )}

      {/* ==================== TELEGRAM TAB ==================== */}
//       {activeTab === 'telegram' && (
//         <div className="bg-background rounded-lg">
//           <TelegramTab />
//         </div>
//       )}

      {/* ==================== REPORTS TAB ==================== */}
//       {activeTab === 'reports' && (
//         <div className="bg-background rounded-lg">
//           <iframe
//             src="/admin/reports"
//             className="w-full"
//             style={{ minHeight: '80vh', border: 'none' }}
//             title="التقارير الذكية"
//           />
//         </div>
//       )}

      {/* ==================== DATABASES TAB (Full Database Manager) ==================== */}
//       {activeTab === 'databases' && (
//         <DatabaseManagerFull />
//       )}

      {/* ==================== SYSTEM CONTROL TAB ==================== */}
//       {activeTab === 'system-control' && (
//         <div className="space-y-6">
//           <DataScraperControl />
//           <SystemControlPanel />
//         </div>
//       )}

      {/* ==================== EDUCATIONAL CARDS TAB ==================== */}
//       {activeTab === 'educational-cards' && (
//         <div className="bg-background rounded-lg">
//           <iframe
//             src="/admin/educational-cards"
//             className="w-full"
//             style={{ minHeight: '80vh', border: 'none' }}
//             title="الكروت التعليمية"
//           />
//         </div>
//       )}

      {/* ==================== USER FEEDBACK TAB ==================== */}
//       {activeTab === 'promo-codes' && <PromoCodesAdmin />}
//       {activeTab === 'feedback' && (
//         <UserFeedbackTab
//           feedback={feedback}
//           loading={feedbackLoading}
//           onRefresh={fetchFeedback}
//           onStatusChange={async (id, status) => {
            // Persist status locally only (simple review workflow)
//             setFeedback((prev) =>
//               prev.map((f) => (f.id === id ? { ...f, status } : f)),
//             );
//           }}
//         />
//       )}
//     </div>
//   );
// }

// ==================== USER FEEDBACK TAB ====================

// const FEEDBACK_TYPE_META: Record<string, { label: string; cls: string }> = {
//   bug: { label: 'مشكلة', cls: 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400' },
//   suggestion: { label: 'اقتراح', cls: 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' },
//   opinion: { label: 'رأي / ملاحظة', cls: 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400' },
//   praise: { label: 'إشادة', cls: 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' },
// };

// const FEEDBACK_STATUS_META: Record<string, { label: string; cls: string }> = {
//   new: { label: 'جديد', cls: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400' },
//   reviewed: { label: 'تمت المراجعة', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400' },
//   resolved: { label: 'تم الحل', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400' },
// };

// function UserFeedbackTab({
//   feedback,
//   loading,
//   onRefresh,
//   onStatusChange,
// }: {
//   feedback: any[];
//   loading: boolean;
//   onRefresh: () => void;
//   onStatusChange: (id: string, status: 'new' | 'reviewed' | 'resolved') => void;
// }) {
//   const total = feedback.length;
//   const byType = (t: string) => feedback.filter((f) => f.type === t).length;
//   const newCount = feedback.filter((f) => f.status === 'new').length;

//   if (loading && total === 0) {
//     return (
//       <Card>
//         <CardHeader>
//           <CardTitle className="flex items-center gap-2">
//             <MessageSquareText className="w-5 h-5 text-primary" />
//             آراء المستخدمين
//           </CardTitle>
//         </CardHeader>
//         <CardContent className="space-y-3">
//           {Array.from({ length: 3 }).map((_, i) => (
//             <Skeleton key={i} className="h-24 w-full" />
//           ))}
//         </CardContent>
//       </Card>
//     );
//   }

//   return (
//     <Card>
//       <CardHeader>
//         <div className="flex items-center justify-between gap-2 flex-wrap">
//           <div>
//             <CardTitle className="flex items-center gap-2">
//               <MessageSquareText className="w-5 h-5 text-primary" />
//               آراء المستخدمين
//               {newCount > 0 && (
//                 <Badge variant="destructive" className="mr-1">{newCount} جديد</Badge>
//               )}
//             </CardTitle>
//             <CardDescription className="mt-1">
//               البلاغات والآراء التي أرسلها المستخدمون من داخل المنصة.
//             </CardDescription>
//           </div>
//           <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="gap-1">
//             <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
//             تحديث
//           </Button>
//         </div>
//         {total > 0 && (
//           <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
//             {(['bug', 'suggestion', 'opinion', 'praise'] as const).map((t) => (
//               <div key={t} className={cn('rounded-lg border px-3 py-2 text-center', FEEDBACK_TYPE_META[t].cls)}>
//                 <div className="text-lg font-bold">{byType(t)}</div>
//                 <div className="text-xs">{FEEDBACK_TYPE_META[t].label}</div>
//               </div>
//             ))}
//           </div>
//         )}
//       </CardHeader>
//       <CardContent>
//         {total === 0 ? (
//           <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
//             <MessageSquareText className="w-12 h-12 mb-3 opacity-40" />
//             <p>لا توجد آراء أو بلاغات حتى الآن.</p>
//           </div>
//         ) : (
//           <div className="space-y-3 max-h-[40rem] overflow-y-auto pr-1
//                           [&::-webkit-scrollbar]:w-2
//                           [&::-webkit-scrollbar-track]:bg-transparent
//                           [&::-webkit-scrollbar-thumb]:rounded-full
//                           [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30">
//             {feedback.map((f) => {
//               const typeMeta = FEEDBACK_TYPE_META[f.type] || FEEDBACK_TYPE_META.opinion;
//               const statusMeta = FEEDBACK_STATUS_META[f.status] || FEEDBACK_STATUS_META.new;
//               return (
//                 <div key={f.id} className="rounded-lg border p-4">
//                   <div className="flex items-start justify-between gap-3 flex-wrap">
//                     <div className="flex items-center gap-2 flex-wrap">
//                       <Badge variant="outline" className={cn('text-[11px]', typeMeta.cls)}>
//                         {typeMeta.label}
//                       </Badge>
//                       <Badge className={cn('text-[11px]', statusMeta.cls)}>
//                         {statusMeta.label}
//                       </Badge>
//                       {typeof f.rating === 'number' && f.rating > 0 && (
//                         <span className="flex items-center gap-0.5 text-amber-500">
//                           {Array.from({ length: f.rating }).map((_, i) => (
//                             <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
//                           ))}
//                         </span>
//                       )}
//                     </div>
//                     <span className="text-[11px] text-muted-foreground" dir="ltr">
//                       {new Date(f.createdAt).toLocaleString('ar-EG')}
//                     </span>
//                   </div>
//                   <p className="mt-2 text-sm text-foreground leading-relaxed whitespace-pre-wrap">
//                     {f.message}
//                   </p>
//                   <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
//                     {f.contact && (
//                       <span dir="ltr">تواصل: {f.contact}</span>
//                     )}
//                     {f.page && (
//                       <span className="font-mono opacity-70" dir="ltr">صفحة: {f.page}</span>
//                     )}
//                   </div>
//                   <div className="mt-3 flex items-center gap-2">
//                     <span className="text-xs text-muted-foreground">تحديث الحالة:</span>
//                     {(['new', 'reviewed', 'resolved'] as const).map((s) => (
//                       <Button
//                         key={s}
//                         size="sm"
//                         variant={f.status === s ? 'default' : 'outline'}
//                         className="h-7 text-[11px]"
//                         onClick={() => onStatusChange(f.id, s)}
//                       >
//                         {FEEDBACK_STATUS_META[s].label}
//                       </Button>
//                     ))}
//                   </div>
//                 </div>
//               );
//             })}
//           </div>
//         )}
//       </CardContent>
//     </Card>
//   );
// }
