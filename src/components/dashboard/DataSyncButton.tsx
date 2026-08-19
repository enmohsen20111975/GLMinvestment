'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, XCircle, Clock, Database, Globe, AlertTriangle, Zap, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';

interface SyncResult {
  success: boolean;
  count: number;
  error?: string;
  source?: string;
}

interface SyncResponse {
  success: boolean;
  timestamp: string;
  results?: {
    stocks?: SyncResult;
    gold?: SyncResult;
    currency?: SyncResult;
    sync_light?: SyncResult;
  };
  source_health?: {
    egx_pilot: { available: boolean; last_sync: string };
    gold_api: { available: boolean };
    currency_api: { available: boolean };
  };
  message?: string;
  error?: string;
}

interface SourceInfo {
  name: string;
  nameAr: string;
  type: 'stocks' | 'gold' | 'currency';
  available: boolean;
  lastSync?: string;
}

export function DataSyncButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResponse | null>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // Check source health on mount
  useEffect(() => {
    if (isOpen) {
      fetchSourceHealth();
    }
  }, [isOpen]);

  const fetchSourceHealth = async () => {
    try {
      const response = await fetch('/api/market/sync');
      const data: SyncResponse = await response.json();

      if (data.source_health) {
        setSources([
          {
            name: 'EGX Pilot',
            nameAr: 'EGX Pilot API (الأسهم)',
            type: 'stocks',
            available: data.source_health.egx_pilot?.available ?? false,
            lastSync: data.source_health.egx_pilot?.last_sync,
          },
          {
            name: 'Gold API',
            nameAr: 'API أسعار الذهب',
            type: 'gold',
            available: data.source_health.gold_api?.available ?? false,
          },
          {
            name: 'Currency API',
            nameAr: 'API أسعار العملات',
            type: 'currency',
            available: data.source_health.currency_api?.available ?? false,
          },
        ]);
      }
    } catch (error) {
      console.error('Failed to fetch source health:', error);
    }
  };

  const handleSync = async (type: 'all' | 'stocks' | 'gold' | 'currency' | 'sync_light' = 'all') => {
    setSyncing(true);
    setSyncResult(null);

    try {
      // Sync via Next.js API
      const response = await fetch('/api/market/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, clear_cache: true }),
      });

      const data: SyncResponse = await response.json();
      setSyncResult(data);
      setLastSyncTime(data.timestamp);

      if (data.success) {
        // Check if all results are successful
        const allSuccess = Object.values(data.results || {}).every(r => r?.success);
        if (allSuccess) {
          toast.success('تم تحديث البيانات بنجاح');
        } else {
          toast.warning('تم التحديث جزئياً - تحقق من النتائج');
        }
      } else {
        toast.error('حدث خطأ أثناء التحديث');
      }
    } catch (error) {
      console.error('Sync error:', error);
      setSyncResult({
        success: false,
        timestamp: new Date().toISOString(),
        error: String(error),
      });
      toast.error('فشل الاتصال بالسيرفر');
    } finally {
      setSyncing(false);
    }
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getSourceIcon = (type: string) => {
    switch (type) {
      case 'stocks':
        return <Database className="w-4 h-4" />;
      case 'gold':
        return <span className="text-amber-500">🥇</span>;
      case 'currency':
        return <Globe className="w-4 h-4" />;
      default:
        return <Database className="w-4 h-4" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <RefreshCw className="w-4 h-4" />
          <span className="hidden sm:inline">تحديث البيانات</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5" />
            تحديث البيانات
          </DialogTitle>
          <DialogDescription>
            تحديث أسعار الأسهم والذهب والعملات من المصادر المتاحة
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4" dir="rtl">
          {/* Sources Status */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">مصادر البيانات</h4>
            <div className="space-y-1.5">
              {sources.map((source) => (
                <div
                  key={source.name}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    {getSourceIcon(source.type)}
                    <span className="text-sm">{source.nameAr}</span>
                  </div>
                  <Badge
                    variant={source.available ? 'default' : 'secondary'}
                    className={source.available ? 'bg-emerald-500' : 'bg-gray-400'}
                  >
                    {source.available ? 'متاح' : 'غير متاح'}
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">تحديث سريع</h4>
            <Button
              onClick={() => handleSync('all')}
              disabled={syncing}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
            >
              {syncing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  جارٍ التحديث...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  تحديث الكل (أسهم + ذهب + عملات)
                </>
              )}
            </Button>
          </div>

          {/* Individual Sync Buttons */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">تحديث فردي</h4>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSync('stocks')}
                disabled={syncing}
                className="gap-1.5"
              >
                <Database className="w-3.5 h-3.5" />
                الأسهم فقط
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSync('gold')}
                disabled={syncing}
                className="gap-1.5"
              >
                🥇 الذهب فقط
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSync('currency')}
                disabled={syncing}
                className="gap-1.5"
              >
                <Globe className="w-3.5 h-3.5" />
                العملات فقط
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSync('sync_light')}
                disabled={syncing}
                className="gap-1.5"
              >
                <Server className="w-3.5 h-3.5" />
                مزامنة DB
              </Button>
            </div>
          </div>

          {/* Sync Results */}
          {syncResult && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">نتيجة التحديث</h4>
              <ScrollArea className="max-h-56 rounded-lg border p-3">
                <div className="space-y-2">
                  {/* Timestamp */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    {formatTime(syncResult.timestamp)}
                  </div>

                  {/* Results by type */}
                  {syncResult.results && (
                    <>
                      {syncResult.results.stocks && (
                        <ResultItem
                          label="الأسهم"
                          result={syncResult.results.stocks}
                          icon={<Database className="w-4 h-4" />}
                        />
                      )}
                      {syncResult.results.gold && (
                        <ResultItem
                          label="الذهب"
                          result={syncResult.results.gold}
                          icon={<span>🥇</span>}
                        />
                      )}
                      {syncResult.results.currency && (
                        <ResultItem
                          label="العملات"
                          result={syncResult.results.currency}
                          icon={<Globe className="w-4 h-4" />}
                        />
                      )}
                      {syncResult.results.sync_light && (
                        <ResultItem
                          label="مزامنة قاعدة البيانات"
                          result={syncResult.results.sync_light}
                          icon={<Server className="w-4 h-4" />}
                        />
                      )}
                    </>
                  )}

                  {/* Error */}
                  {syncResult.error && (
                    <div className="flex items-start gap-2 p-2 rounded bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300">
                      <AlertTriangle className="w-4 h-4 mt-0.5" />
                      <span className="text-sm">{syncResult.error}</span>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Last Sync */}
          {lastSyncTime && (
            <p className="text-xs text-muted-foreground text-center">
              آخر تحديث: {formatTime(lastSyncTime)}
            </p>
          )}

          {/* Info */}
          <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2">
            <strong>ملاحظة:</strong> تحديث الأسهم يجلب أحدث البيانات ويحدث قاعدة البيانات تلقائياً.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResultItem({ label, result, icon }: { label: string; result: SyncResult; icon?: React.ReactNode }) {
  return (
    <div
      className={`flex items-center justify-between p-2 rounded ${
        result.success
          ? 'bg-emerald-50 dark:bg-emerald-900/20'
          : 'bg-red-50 dark:bg-red-900/20'
      }`}
    >
      <div className="flex items-center gap-2">
        {result.success ? (
          <CheckCircle className="w-4 h-4 text-emerald-500" />
        ) : (
          <XCircle className="w-4 h-4 text-red-500" />
        )}
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <div className="text-sm">
        {result.success ? (
          <span className="text-emerald-600 dark:text-emerald-400">
            {result.count} عنصر
            {result.source && (
              <span className="text-xs text-muted-foreground mr-1">
                ({result.source})
              </span>
            )}
          </span>
        ) : (
          <span className="text-red-600 dark:text-red-400 text-xs">
            {result.error || 'فشل'}
          </span>
        )}
      </div>
    </div>
  );
}

export default DataSyncButton;
