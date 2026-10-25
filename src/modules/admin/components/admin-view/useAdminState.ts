/**
 * admin-view/useAdminState.ts
 * ===========================
 * The single React hook that owns ALL of AdminView's state:
 *  - Raw fetched data (stats, connections, predictionStats, dataStatus,
 *    pythonHealth, learningStats, analyticsData, feedback, userBehavior).
 *  - Loading flags for each fetch.
 *  - Debug log + addDebugLog helper.
 *  - Direct-login state (username/password/error/loading/loggedIn).
 *  - UI state (activeTab, expandedHub, syncing, multiMarketSyncing, isMounted).
 *  - All fetch callbacks (fetchStats, checkPythonHealth, fetchConnections,
 *    fetchPredictionStats, fetchLearningStats, fetchDataStatus, fetchAnalytics,
 *    fetchFeedback, fetchUserBehavior).
 *  - All action handlers (handleSync, handleMultiMarketSync, handleDirectLogin).
 *  - Computed derived state: systemIssues (useMemo), services (useMemo),
 *    healthScore (useMemo), critical/warning counts, vps/db status booleans,
 *    lastUpdate, dataAge, dataAgeMinutes.
 *  - Auth detection: isAdminUser + canAccessAdmin (exposed via refs to
 *    consumers so they can render the login guard if needed).
 *
 * Originally inlined inside AdminView.tsx (lines ~438-933, ~500 LOC). Extracted
 * here so the container component stays under 500 LOC.
 */

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSession } from '@/lib/next-auth-shim';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { isAdmin } from '@/lib/admin-auth';
import { adminFetch } from './admin-fetch';
import type {
 AdminStats,
 ConnectionInfo,
 SystemIssue,
 ServiceStatus,
 DataStatus,
 AdminTab,
 HubId,
 DebugLogEntry,
} from './types';

const EMPTY_STATS: AdminStats = {
 success: false,
 timestamp: new Date().toISOString(),
 users: { total: 0, active: 0, premium: 0 },
 stocks: { total: 0, active: 0, sectors: 0, last_update: null },
 platform: { watchlist_items: 0, portfolio_items: 0 },
};

export interface UseAdminStateReturn {
 // Session + auth
 isAdminUser: boolean;
 isMounted: boolean;
 isDirectAdmin: boolean;
 canAccessAdmin: boolean;

 // UI state
 activeTab: AdminTab;
 setActiveTab: (tab: AdminTab) => void;
 expandedHub: HubId | null;
 setExpandedHub: React.Dispatch<React.SetStateAction<HubId | null>>;

 // Loading + sync flags
 statsLoading: boolean;
 connectionsLoading: boolean;
 dataStatusLoading: boolean;
 analyticsLoading: boolean;
 feedbackLoading: boolean;
 behaviorLoading: boolean;
 syncing: boolean;
 multiMarketSyncing: boolean;

 // Data
 stats: AdminStats;
 connections: ConnectionInfo | null;
 predictionStats: any;
 dataStatus: DataStatus | null;
 pythonHealth: any;
 learningStats: any;
 analyticsData: any;
 feedback: any[];
 feedbackCount: number | undefined;
 userBehavior: any[];

 // Derived computed
 isVpsConnected: boolean;
 isDbOk: boolean;
 lastUpdate: string | null;
 dataAgeMinutes: number | null;
 systemIssues: SystemIssue[];
 services: ServiceStatus[];
 criticalCount: number;
 warningCount: number;
 healthScore: number;

 // Direct login state
 directLoginUsername: string;
 setDirectLoginUsername: React.Dispatch<React.SetStateAction<string>>;
 directLoginPassword: string;
 setDirectLoginPassword: React.Dispatch<React.SetStateAction<string>>;
 directLoginError: string;
 directLoginLoading: boolean;
 directLoggedIn: boolean;

 // Actions
 handleSync: () => Promise<void>;
 handleMultiMarketSync: () => Promise<void>;
 handleDirectLogin: (e: React.FormEvent) => Promise<void>;
 refreshAll: () => void;
 fetchDataStatus: () => void;
 fetchFeedback: () => void;
 setFeedbackStatus: (id: string, status: 'new' | 'reviewed' | 'resolved') => void;
}

export function useAdminState(): UseAdminStateReturn {
 const { data: session } = useSession();
 const { user } = useAppStore();
 const userEmail = user?.email || session?.user?.email || '';
 const userName = (user as any)?.username || (user as any)?.name || (session?.user as any)?.name || (session?.user as any)?.username || '';
 const isAdminUser =
 (user as any)?.is_admin === true ||
 (user as any)?.subscription_tier === 'admin' ||
 (session?.user as any)?.is_admin === true ||
 (session?.user as any)?.subscription_tier === 'admin' ||
 (userName && ['mohseny', 'admin'].includes(userName.toLowerCase())) ||
 (userEmail && ['mohseny@m2y.net', 'enmohsen20111975@gmail.com', 'enmohsen2011975@gmail.com', 'ceo@m2y.net'].includes(userEmail.toLowerCase())) ||
 isAdmin(userEmail, userName) ||
 isAdmin(userName, userEmail);

 // State
 const [stats, setStats] = useState<AdminStats>(EMPTY_STATS);
 const [statsLoading, setStatsLoading] = useState(true);
 const [connections, setConnections] = useState<ConnectionInfo | null>(null);
 const [connectionsLoading, setConnectionsLoading] = useState(false);
 const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
 // Stream C: which hub is expanded in the nav. Auto-syncs when a tab is clicked.
 const [expandedHub, setExpandedHub] = useState<HubId | null>('health');
 const [syncing, setSyncing] = useState(false);
 const [multiMarketSyncing, setMultiMarketSyncing] = useState(false);
 const [predictionStats, setPredictionStats] = useState<any>(null);
 const [dataStatus, setDataStatus] = useState<DataStatus | null>(null);
 const [dataStatusLoading, setDataStatusLoading] = useState(false);

 // Debug state
 const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
 const [pythonHealth, setPythonHealth] = useState<any>(null);
 const [learningStats, setLearningStats] = useState<any>(null);
 const [analyticsData, setAnalyticsData] = useState<any>(null);
 const [analyticsLoading, setAnalyticsLoading] = useState(false);

 const addDebugLog = (action: string, status: string, message: string, data?: any) => {
 setDebugLogs(prev => [...prev.slice(-19), { time: new Date().toLocaleTimeString(), action, status, message, data }]);
 };

 // Direct login state
 const [isMounted, setIsMounted] = useState(false);
 const [directLoginUsername, setDirectLoginUsername] = useState('');
 const [directLoginPassword, setDirectLoginPassword] = useState('');
 const [directLoginError, setDirectLoginError] = useState('');
 const [directLoginLoading, setDirectLoginLoading] = useState(false);
 const [directLoggedIn, setDirectLoggedIn] = useState(false);

 // Feedback (user reports / opinions)
 const [feedback, setFeedback] = useState<any[]>([]);
 const [feedbackLoading, setFeedbackLoading] = useState(false);
 const [feedbackCount, setFeedbackCount] = useState<number | undefined>(undefined);

 // User behavior analysis
 const [userBehavior, setUserBehavior] = useState<any[]>([]);
 const [behaviorLoading, setBehaviorLoading] = useState(false);

 // Check admin session on mount (FIX July 2026: cookie is httpOnly, verify via API)
 // FIX v2 (July 2026): auto-set admin_session cookie for Google-logged-in admins
 // هذا يحل مشكلة "ADMIN_AUTH_REQUIRED" للأدمن المسجل بـ Google
 useEffect(() => {
 const checkSession = async () => {
 try {
 // 1. حاول ضبط admin_session cookie تلقائياً (لو المستخدم أدمن مسجل بـ Google)
 try {
 await fetch('/api/admin/auth/auto-cookie', { method: 'POST' });
 } catch {
 // تجاهل الأخطاء — سنجرب stats بعدها
 }
 // 2. فحص صلاحية الأدمن
 const res = await fetch('/api/admin/stats');
 if (res.ok) {
 setDirectLoggedIn(true);
 }
 } catch {
 // Not authenticated — that's fine, show login form
 }
 };
 checkSession();
 setIsMounted(true);

 // فحص إذا كان الرابط يطلب تبويب معين مباشرة مثل ?tab=news أو ?tab=news-control
 if (typeof window !== 'undefined') {
 const urlParams = new URLSearchParams(window.location.search);
 const tabParam = urlParams.get('tab');
 if (tabParam === 'news' || tabParam === 'news-control') {
 setActiveTab('news-control');
 setExpandedHub('data');
 }
 }
 }, []);

 // Track admin tab views
 useEffect(() => {
 const trackView = async () => {
 try {
 await fetch('/api/track', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 type: 'page_view',
 view: `admin:${activeTab}`,
 action: 'tab_view',
 detail: activeTab,
 }),
 });
 } catch {
 // ignore tracking errors
 }
 };
 trackView();
 }, [activeTab]);

 const isDirectAdmin = isMounted ? directLoggedIn : false;
 const canAccessAdmin = isAdminUser || isDirectAdmin;

 // Fetch stats
 const fetchStats = useCallback(async () => {
 setStatsLoading(true);
 addDebugLog('FETCH STATS', 'pending', '/api/admin/stats');
 try {
 // Use plain fetch - stats API returns data even without admin token
 const res = await fetch('/api/admin/stats');
 const data = await res.json();
 if (data.success) {
 setStats(data);
 addDebugLog('FETCH STATS', 'success', `${data?.stocks?.total || 0} stocks, ${data?.users?.total || 0} users`, data);
 } else {
 addDebugLog('FETCH STATS', 'error', data.error || 'Unknown error');
 }
 } catch (err: any) {
 toast.error('خطأ في الاتصال بالخادم');
 addDebugLog('FETCH STATS', 'error', err.message);
 } finally {
 setStatsLoading(false);
 }
 }, []);

 // Check Python Backend Health - use server-side API to avoid CORS
 const checkPythonHealth = useCallback(async () => {
 // Use the connections API which checks VPS from server-side
 addDebugLog('PYTHON HEALTH', 'pending', 'Checking via /api/market/connections');
 try {
 const res = await fetch('/api/market/connections');
 const data = await res.json();
 const vpsAvailable = data?.sources?.vps_python?.available === true;
 if (vpsAvailable) {
 setPythonHealth({ status: 'ok', latency: data?.sources?.vps_python?.latency_ms });
 addDebugLog('PYTHON HEALTH', 'success', `Connected (${data?.sources?.vps_python?.latency_ms}ms)`, data?.sources?.vps_python);
 } else {
 setPythonHealth(null);
 addDebugLog('PYTHON HEALTH', 'error', data?.sources?.vps_python?.message || 'Not available');
 }
 } catch (err: any) {
 setPythonHealth(null);
 addDebugLog('PYTHON HEALTH', 'error', err.message);
 }
 }, []);

 // Fetch connections
 const fetchConnections = useCallback(async () => {
 setConnectionsLoading(true);
 addDebugLog('CONNECTIONS', 'pending', '/api/market/connections');
 try {
 const res = await fetch('/api/market/connections');
 const data = await res.json();
 setConnections(data);
 addDebugLog('CONNECTIONS', 'success', `VPS: ${data?.sources?.vps_python?.available ? 'OK' : 'DOWN'}`, data?.sources);
 } finally {
 setConnectionsLoading(false);
 }
 }, []);

 // Fetch prediction stats
 const fetchPredictionStats = useCallback(async () => {
 try {
 const res = await fetch('/api/prediction-performance');
 const data = await res.json();
 if (data.success) {
 setPredictionStats(data.performance);
 }
 } catch {
 // silent
 }
 }, []);

 // Fetch Learning Stats
 const fetchLearningStats = useCallback(async () => {
 addDebugLog('LEARNING STATS', 'pending', '/api/self-learning?action=stats');
 try {
 const res = await fetch('/api/self-learning?action=stats');
 const data = await res.json();
 setLearningStats(data);
 addDebugLog('LEARNING STATS', 'success', `predictions: ${data?.data?.signals?.total || 0}, win_rate: ${data?.data?.outcomes?.win_rate || 0}%`, data);
 } catch (err: any) {
 addDebugLog('LEARNING STATS', 'error', err.message);
 }
 }, []);

 // Fetch Data Status (detailed status for each market)
 const fetchDataStatus = useCallback(async () => {
 setDataStatusLoading(true);
 try {
 const res = await fetch('/api/data-status');
 const data = await res.json();
 if (data.success) {
 setDataStatus(data);
 addDebugLog('DATA STATUS', 'success', `Health: ${data.summary.health_score}%`, data.summary);
 }
 } catch (err: any) {
 addDebugLog('DATA STATUS', 'error', err.message);
 } finally {
 setDataStatusLoading(false);
 }
 }, []);

 // Fetch Analytics
 const fetchAnalytics = useCallback(async () => {
 setAnalyticsLoading(true);
 try {
 const res = await adminFetch('/api/admin/analytics');
 const data = await res.json();
 if (data.success) {
 setAnalyticsData(data);
 }
 } catch (err: any) {
 console.error('[Admin] Failed to load analytics:', err);
 } finally {
 setAnalyticsLoading(false);
 }
 }, []);

 // Fetch user feedback (reports / opinions)
 const fetchFeedback = useCallback(async () => {
 setFeedbackLoading(true);
 try {
 const res = await fetch('/api/feedback');
 const data = await res.json();
 if (data.success) {
 setFeedback(data.feedback || []);
 setFeedbackCount(data.summary?.new ?? undefined);
 }
 } catch {
 /* non-critical */
 } finally {
 setFeedbackLoading(false);
 }
 }, []);

 // Fetch user behavior analysis
 const fetchUserBehavior = useCallback(async () => {
 setBehaviorLoading(true);
 try {
 const res = await adminFetch('/api/admin/analytics');
 const data = await res.json();
 if (data.success) {
 setUserBehavior(data.user_behavior || []);
 }
 } catch (err: any) {
 console.error('[Admin] Failed to load user behavior:', err);
 } finally {
 setBehaviorLoading(false);
 }
 }, []);

 // Fetch stats immediately on mount (no auth needed - API returns public stats)
 useEffect(() => {
 fetchStats();
 }, [fetchStats]);

 // Initial fetch of other data (requires admin access)
 useEffect(() => {
 if (canAccessAdmin) {
 fetchConnections();
 fetchPredictionStats();
 checkPythonHealth();
 fetchLearningStats(); // Auto-fetch learning stats
 fetchDataStatus(); // Fetch detailed data status
 fetchFeedback();
 fetchAnalytics(); // Fetch analytics data
 fetchUserBehavior(); // Fetch user behavior data
 }
 }, [canAccessAdmin, fetchConnections, fetchPredictionStats, checkPythonHealth, fetchLearningStats, fetchDataStatus, fetchFeedback, fetchAnalytics, fetchUserBehavior]);

 // Sync data
 const handleSync = useCallback(async () => {
 setSyncing(true);
 try {
 const res = await fetch('/api/market/sync-live', {
 method: 'POST',
 headers: { 'x-force-refresh': 'true' },
 });
 const data = await res.json();
 if (data.success) {
 toast.success(`تم تحديث ${data.updated_count} سهم من ${data.source}`);
 fetchStats();
 fetchConnections();
 } else {
 toast.error(data.details?.errors?.[0] || 'فشل التحديث');
 }
 } catch {
 toast.error('خطأ في التحديث');
 } finally {
 setSyncing(false);
 }
 }, [fetchStats, fetchConnections]);

 // Multi-market sync (all markets)
 const handleMultiMarketSync = useCallback(async () => {
 setMultiMarketSyncing(true);
 addDebugLog('MULTI-MARKET SYNC', 'pending', 'Syncing all markets...');
 try {
 const res = await fetch('/api/multi-market/sync', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 });
 const data = await res.json();
 if (data.success) {
 const summary = data.summary || {};
 const totalSynced = Object.values(summary).reduce((acc: number, val: any) => acc + (val.synced || 0), 0);
 toast.success(`تم تحديث ${totalSynced} سهم من جميع الأسواق`);
 addDebugLog('MULTI-MARKET SYNC', 'success', `${totalSynced} stocks synced`, summary);
 fetchStats();
 fetchConnections();
 } else {
 toast.error(data.error || 'فشل التحديث');
 addDebugLog('MULTI-MARKET SYNC', 'error', data.error || 'Unknown error');
 }
 } catch (err: any) {
 toast.error('خطأ في التحديث');
 addDebugLog('MULTI-MARKET SYNC', 'error', err.message);
 } finally {
 setMultiMarketSyncing(false);
 }
 }, [fetchStats, fetchConnections]);

 // Direct login handler
 const handleDirectLogin = useCallback(async (e: React.FormEvent) => {
 e.preventDefault();
 setDirectLoginLoading(true);
 setDirectLoginError('');

 try {
 const res = await fetch('/api/admin/auth', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ username: directLoginUsername, password: directLoginPassword }),
 });

 const data = await res.json();
 if (data.success) {
 setDirectLoggedIn(true);
 // Cookie is set by the server (httpOnly) — no client-side storage needed (FIX July 2026)
 toast.success('تم تسجيل الدخول بنجاح');
 } else {
 setDirectLoginError(data.error || 'بيانات الدخول غير صحيحة');
 }
 } catch {
 setDirectLoginError('خطأ في الاتصال');
 } finally {
 setDirectLoginLoading(false);
 }
 }, [directLoginUsername, directLoginPassword]);

 // ==================== COMPUTED VALUES ====================

 const vpsStatus = connections?.sources?.vps_python;
 const dbStatus = connections?.sources?.database;
 const isVpsConnected = vpsStatus?.available === true;
 const isDbOk = dbStatus?.available === true;
 const lastUpdate = stats?.stocks?.last_update ?? null;
 const dataAge = lastUpdate ? Date.now() - new Date(lastUpdate).getTime() : null;
 const dataAgeMinutes = dataAge !== null ? Math.floor(dataAge / 60000) : null;

 // Compute system issues - now uses detailed data status
 const systemIssues = useMemo<SystemIssue[]>(() => {
 const issues: SystemIssue[] = [];

 // VPS issues
 if (!isVpsConnected) {
 issues.push({
 id: 'vps-offline',
 severity: 'critical',
 category: 'service',
 title: 'VPS Python غير متصل',
 description: 'خدمة التحليلات المتقدمة غير متاحة',
 solution: 'تأكد من تشغيل الخدمة على port 8010',
 timestamp: new Date().toISOString(),
 });
 }

 // Database issues
 if (!isDbOk) {
 issues.push({
 id: 'db-offline',
 severity: 'critical',
 category: 'service',
 title: 'قاعدة البيانات غير متاحة',
 description: 'لا يمكن الوصول لقاعدة البيانات',
 solution: 'تحقق من اتصال قاعدة البيانات',
 timestamp: new Date().toISOString(),
 });
 }

 // Detailed data issues from new API
 if (dataStatus?.categories) {
 for (const cat of dataStatus.categories) {
 // Only show issues for old/error status (not stale - that's expected for closed markets)
 if (cat.status === 'old') {
 const isStocks = cat.category.startsWith('stocks_');
 const dayOfWeek = new Date().getDay(); // 0=Sunday, 5=Friday, 6=Saturday
 const isWeekend = dayOfWeek === 5; // Friday in Arab markets

 // Don't show stocks as issue on weekend
 if (isStocks && isWeekend) continue;

 issues.push({
 id: `stale-${cat.category}`,
 severity: 'warning',
 category: 'data',
 title: `${cat.name_ar} - بيانات قديمة`,
 description: cat.message,
 solution: 'اضغط على "تحديث البيانات"',
 timestamp: new Date().toISOString(),
 });
 } else if (cat.status === 'error') {
 issues.push({
 id: `error-${cat.category}`,
 severity: 'critical',
 category: 'data',
 title: `${cat.name_ar} - خطأ`,
 description: cat.message,
 solution: 'تحقق من قاعدة البيانات',
 timestamp: new Date().toISOString(),
 });
 }
 }
 }

 // Prediction performance
 if (predictionStats && predictionStats.success_rate < 50) {
 issues.push({
 id: 'low-prediction-rate',
 severity: 'warning',
 category: 'analysis',
 title: 'نسبة نجاح منخفضة',
 description: `نسبة نجاح التوقعات ${predictionStats?.success_rate?.toFixed?.(1) ?? 0}%`,
 solution: 'راجع معايير التحليل والـ thresholds',
 timestamp: new Date().toISOString(),
 });
 }

 return issues;
 }, [isVpsConnected, isDbOk, dataStatus, predictionStats]);

 // Compute services status
 const services = useMemo<ServiceStatus[]>(() => [
 {
 name: 'VPS Python',
 nameAr: 'خادم التحليلات',
 status: isVpsConnected ? 'online' : 'offline',
 latency: vpsStatus?.latency_ms,
 lastCheck: connections?.timestamp || new Date().toISOString(),
 message: vpsStatus?.message || (isVpsConnected ? 'يعمل بشكل طبيعي' : 'غير متصل'),
 },
 {
 name: 'Database',
 nameAr: 'قاعدة البيانات',
 status: isDbOk ? 'online' : 'offline',
 lastCheck: connections?.timestamp || new Date().toISOString(),
 message: dbStatus?.message || (isDbOk ? 'متاحة' : 'غير متاحة'),
 },
 {
 name: 'Data Freshness',
 nameAr: 'تحديث البيانات',
 status: dataAgeMinutes !== null && dataAgeMinutes < 30 ? 'online' : dataAgeMinutes !== null && dataAgeMinutes < 60 ? 'degraded' : 'offline',
 lastCheck: lastUpdate || new Date().toISOString(),
 message: lastUpdate ? `منذ ${dataAgeMinutes ?? '—'} دقيقة` : 'لا توجد بيانات',
 },
 ], [isVpsConnected, isDbOk, vpsStatus, dbStatus, connections, dataAgeMinutes, lastUpdate]);

 // Critical issues count
 const criticalCount = systemIssues.filter(i => i.severity === 'critical').length;
 const warningCount = systemIssues.filter(i => i.severity === 'warning').length;

 // System health score
 const healthScore = useMemo(() => {
 let score = 100;
 if (!isVpsConnected) score -= 30;
 if (!isDbOk) score -= 40;
 if (dataAgeMinutes !== null && dataAgeMinutes > 60) score -= 20;
 else if (dataAgeMinutes !== null && dataAgeMinutes > 30) score -= 10;
 if (predictionStats && predictionStats.success_rate < 50) score -= 10;
 return Math.max(0, score);
 }, [isVpsConnected, isDbOk, dataAgeMinutes, predictionStats]);

 const refreshAll = useCallback(() => {
 fetchStats();
 fetchConnections();
 fetchPredictionStats();
 fetchDataStatus();
 checkPythonHealth();
 }, [fetchStats, fetchConnections, fetchPredictionStats, fetchDataStatus, checkPythonHealth]);

 // Local-only status update for the feedback review workflow
 // (the original AdminView updated the feedback array in-place).
 const setFeedbackStatus = useCallback((id: string, status: 'new' | 'reviewed' | 'resolved') => {
 setFeedback(prev => prev.map(f => (f.id === id ? { ...f, status } : f)));
 }, []);

 return {
 // Session + auth
 isAdminUser,
 isMounted,
 isDirectAdmin,
 canAccessAdmin,

 // UI state
 activeTab,
 setActiveTab,
 expandedHub,
 setExpandedHub,

 // Loading + sync flags
 statsLoading,
 connectionsLoading,
 dataStatusLoading,
 analyticsLoading,
 feedbackLoading,
 behaviorLoading,
 syncing,
 multiMarketSyncing,

 // Data
 stats,
 connections,
 predictionStats,
 dataStatus,
 pythonHealth,
 learningStats,
 analyticsData,
 feedback,
 feedbackCount,
 userBehavior,

 // Derived computed
 isVpsConnected,
 isDbOk,
 lastUpdate,
 dataAgeMinutes,
 systemIssues,
 services,
 criticalCount,
 warningCount,
 healthScore,

 // Direct login state
 directLoginUsername,
 setDirectLoginUsername,
 directLoginPassword,
 setDirectLoginPassword,
 directLoginError,
 directLoginLoading,
 directLoggedIn,

 // Actions
 handleSync,
 handleMultiMarketSync,
 handleDirectLogin,
 refreshAll,
 fetchDataStatus,
 fetchFeedback,
 setFeedbackStatus,
 };
}
