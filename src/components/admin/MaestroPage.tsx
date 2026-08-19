'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, RefreshCw, Zap, Loader2 } from 'lucide-react';
import { MaestroDashboard, MaestroResult, MaestroStatus, MaestroStats } from '@/components/admin/MaestroDashboard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface MaestroPageProps {
  defaultTab?: string;
}

interface MaestroOverview {
  totalStocks: number;
  lastAnalysis: string | null;
  marketRegime: 'bull' | 'bear' | 'range';
  regimeConfidence: number;
  recentSignals: number;
  avgScore: number;
}

export function MaestroPage({ defaultTab = 'phase1' }: MaestroPageProps) {
  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<MaestroOverview | null>(null);
  const [results, setResults] = useState<MaestroResult[]>([]);
  const [status, setStatus] = useState<MaestroStatus | null>(null);
  const [stats, setStats] = useState<MaestroStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);

  // Check backend health
  const checkBackendHealth = useCallback(async () => {
    try {
      console.log('[MaestroPage] Checking backend health...');
      const res = await fetch('/api/python/health');
      const data = await res.json();
      console.log('[MaestroPage] Health response:', data.status, data.port);
      const isHealthy = data.status === 'ok' || data.status === 'healthy';
      setBackendConnected(isHealthy);
      return isHealthy;
    } catch (e) {
      console.error('[MaestroPage] Backend health check failed:', e);
      setBackendConnected(false);
      return false;
    }
  }, []);

  // Fetch overview data
  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/maestro/overview');
      const data = await res.json();
      if (data.success) {
        setOverview(data.data);
      }
    } catch (e) {
      console.error('Error fetching overview:', e);
    }
  }, []);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/python/maestro/status');
      const data = await res.json();
      if (data.success) {
        setStatus(data.data);
      }
    } catch (e) {
      console.error('Error fetching status:', e);
    }
  }, []);

  // Fetch results
  const fetchResults = useCallback(async () => {
    try {
      const res = await fetch('/api/python/maestro/results');
      const data = await res.json();
      if (data.success) {
        setResults(data.results || []);
      }
    } catch (e) {
      console.error('Error fetching results:', e);
    }
  }, []);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/python/maestro/signals?stats=true');
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
      }
    } catch (e) {
      console.error('Error fetching stats:', e);
    }
  }, []);

  // Initial data fetch
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);

      // Check backend health first
      const isHealthy = await checkBackendHealth();
      if (!isHealthy) {
        setLoading(false);
        return;
      }

      try {
        // Fetch all data in parallel
        await Promise.all([
          fetchOverview(),
          fetchStatus(),
          fetchResults(),
          fetchStats(),
        ]);
      } catch (e) {
        setError('فشل في تحميل البيانات');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [checkBackendHealth, fetchOverview, fetchStatus, fetchResults, fetchStats]);

  // Refresh all data
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        fetchOverview(),
        fetchStatus(),
        fetchResults(),
        fetchStats(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  // Handle analysis complete
  const handleAnalysisComplete = (newResults: MaestroResult[]) => {
    setResults(newResults);
    // Refresh overview and stats
    fetchOverview();
    fetchStats();
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">جاري تحميل نظام المايسترو...</p>
      </div>
    );
  }

  // Backend disconnected state
  if (backendConnected === false) {
    return (
      <Alert variant="destructive" className="max-w-2xl mx-auto">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>⚠️ Python Backend غير متصل</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>الـ Python Backend (Port 8010) مش شغال. نظام المايسترو بيحتاج الباكند عشان يشتغل.</p>
          <div className="p-3 bg-red-950/30 rounded-lg text-sm font-mono">
            <p className="font-bold text-red-400 mb-2">لتشغيل الباكند على السيرفر:</p>
            <code className="block text-green-400">pm2 start ecosystem.config.js --only python-backend</code>
            <p className="mt-2 text-red-400">أو يدوى:</p>
            <code className="block text-green-400">cd vps-service && python3 main.py</code>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={async () => {
              const healthy = await checkBackendHealth();
              if (healthy) {
                handleRefresh();
              }
            }}
          >
            <RefreshCw className="h-4 w-4 ml-2" />
            إعادة التحقق
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // Error state
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>خطأ</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
        <Button variant="outline" size="sm" className="mt-2" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 ml-2" />
          إعادة المحاولة
        </Button>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Stats Row */}
      {overview && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">الأسهم المحللة</p>
                  <p className="text-2xl font-bold">{overview.totalStocks || 0}</p>
                </div>
                <div className="rounded-full bg-primary/10 p-2">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">حالة السوق</p>
                  <p className="text-lg font-bold flex items-center gap-2">
                    {overview.marketRegime === 'bull' && (
                      <>
                        <span className="text-green-600">صاعد</span>
                        <Badge variant="outline" className="text-xs">{overview.regimeConfidence}%</Badge>
                      </>
                    )}
                    {overview.marketRegime === 'bear' && (
                      <>
                        <span className="text-red-600">هابط</span>
                        <Badge variant="outline" className="text-xs">{overview.regimeConfidence}%</Badge>
                      </>
                    )}
                    {overview.marketRegime === 'range' && (
                      <>
                        <span className="text-yellow-600">متراوح</span>
                        <Badge variant="outline" className="text-xs">{overview.regimeConfidence}%</Badge>
                      </>
                    )}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">الإشارات الأخيرة</p>
                  <p className="text-2xl font-bold">{overview.recentSignals || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">متوسط الدرجة</p>
                  <p className="text-2xl font-bold">{Math.round(overview.avgScore || 0)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Dashboard */}
      <MaestroDashboard
        defaultTab={defaultTab}
        onAnalysisComplete={handleAnalysisComplete}
      />
    </div>
  );
}
