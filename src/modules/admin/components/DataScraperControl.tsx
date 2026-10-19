'use client';

import React, { useState } from 'react';
import {
 Card,
 CardContent,
 CardDescription,
 CardHeader,
 CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
 Download,
 Database,
 RefreshCw,
 CheckCircle2,
 XCircle,
 Loader2,
 Globe,
 TrendingUp,
 History,
 BarChart3,
 AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ScrapingJob {
 id: string;
 type: 'stocks' | 'history' | 'technical';
 market: string;
 status: 'pending' | 'running' | 'completed' | 'failed';
 progress: number;
 total: number;
 message: string;
 started_at?: string;
 completed_at?: string;
}

const MARKETS = [
 { code: 'EGX', name: 'البورصة المصرية', stocks: 452 },
 { code: 'TADAWUL', name: 'السوق السعودية', stocks: 386 },
 { code: 'KSE', name: 'بورصة الكويت', stocks: 131 },
 { code: 'QE', name: 'بورصة قطر', stocks: 55 },
 { code: 'ADX', name: 'بورصة أبوظبي', stocks: 70 },
 { code: 'DFM', name: 'سوق دبي المالي', stocks: 71 },
 { code: 'BSE', name: 'بورصة البحرين', stocks: 17 },
];

export function DataScraperControl() {
 const [selectedMarket, setSelectedMarket] = useState<string>('EGX');
 const [jobs, setJobs] = useState<ScrapingJob[]>([]);
 const [loading, setLoading] = useState(false);

 // تحديث الأسعار الحية من المصادر
 const syncLivePrices = async () => {
 setLoading(true);
 const jobId = `sync-${Date.now()}`;
 
 const newJob: ScrapingJob = {
 id: jobId,
 type: 'stocks',
 market: selectedMarket,
 status: 'running',
 progress: 0,
 total: 100,
 message: 'جاري تحديث الأسعار...',
 started_at: new Date().toISOString(),
 };
 
 setJobs(prev => [newJob, ...prev]);
 
 try {
 const response = await fetch('/api/market/sync-live', {
 method: 'POST',
 headers: { 'x-force-refresh': 'true' },
 });
 
 const data = await response.json();
 
 if (data.success) {
 setJobs(prev => prev.map(j => 
 j.id === jobId 
 ? { ...j, status: 'completed', progress: 100, message: `تم تحديث ${data.updated_count || 0} سهم`, completed_at: new Date().toISOString() }
 : j
 ));
 toast.success(`تم تحديث ${data.updated_count || 0} سهم من ${data.source || 'المصدر'}`);
 } else {
 throw new Error(data.error || 'فشل التحديث');
 }
 } catch (error: any) {
 setJobs(prev => prev.map(j => 
 j.id === jobId 
 ? { ...j, status: 'failed', message: error.message }
 : j
 ));
 toast.error(error.message || 'فشل تحديث البيانات');
 } finally {
 setLoading(false);
 }
 };

 // سحب البيانات من VPS
 const syncFromVPS = async () => {
 setLoading(true);
 const jobId = `vps-${Date.now()}`;
 
 const newJob: ScrapingJob = {
 id: jobId,
 type: 'stocks',
 market: selectedMarket,
 status: 'running',
 progress: 0,
 total: 100,
 message: 'جاري السحب من VPS...',
 started_at: new Date().toISOString(),
 };
 
 setJobs(prev => [newJob, ...prev]);
 
 try {
 const response = await fetch('/api/admin/sync-vps', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ market: selectedMarket }),
 });
 
 const data = await response.json();
 
 if (data.success) {
 setJobs(prev => prev.map(j => 
 j.id === jobId 
 ? { ...j, status: 'completed', progress: 100, message: `تم سحب ${data.stocks_count || 0} سهم`, completed_at: new Date().toISOString() }
 : j
 ));
 toast.success(`تم سحب ${data.stocks_count || 0} سهم من VPS`);
 } else {
 throw new Error(data.error || 'فشل السحب');
 }
 } catch (error: any) {
 setJobs(prev => prev.map(j => 
 j.id === jobId 
 ? { ...j, status: 'failed', message: error.message }
 : j
 ));
 toast.error(error.message || 'فشل السحب من VPS');
 } finally {
 setLoading(false);
 }
 };

 // سحب البيانات التاريخية
 const syncHistoricalData = async () => {
 setLoading(true);
 const jobId = `history-${Date.now()}`;
 
 const newJob: ScrapingJob = {
 id: jobId,
 type: 'history',
 market: selectedMarket,
 status: 'running',
 progress: 0,
 total: 100,
 message: 'جاري سحب البيانات التاريخية...',
 started_at: new Date().toISOString(),
 };
 
 setJobs(prev => [newJob, ...prev]);
 
 try {
 const response = await fetch('/api/sync-historical', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ market: selectedMarket, days: 30 }),
 });
 
 const data = await response.json();
 
 if (data.success) {
 setJobs(prev => prev.map(j => 
 j.id === jobId 
 ? { ...j, status: 'completed', progress: 100, message: `تم سحب ${data.records_count || 0} سجل`, completed_at: new Date().toISOString() }
 : j
 ));
 toast.success(`تم سحب ${data.records_count || 0} سجل تاريخي`);
 } else {
 throw new Error(data.error || 'فشل السحب');
 }
 } catch (error: any) {
 setJobs(prev => prev.map(j => 
 j.id === jobId 
 ? { ...j, status: 'failed', message: error.message }
 : j
 ));
 toast.error(error.message || 'فشل سحب البيانات التاريخية');
 } finally {
 setLoading(false);
 }
 };

 // مزامنة قاعدة بيانات الأسهم
 const syncStocksDB = async () => {
 setLoading(true);
 const jobId = `stocks-db-${Date.now()}`;
 
 const newJob: ScrapingJob = {
 id: jobId,
 type: 'stocks',
 market: selectedMarket,
 status: 'running',
 progress: 0,
 total: 100,
 message: 'جاري مزامنة قاعدة البيانات...',
 started_at: new Date().toISOString(),
 };
 
 setJobs(prev => [newJob, ...prev]);
 
 try {
 const response = await fetch('/api/admin/sync-stocks-db', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({}),
 });
 
 const data = await response.json();
 
 if (data.success) {
 setJobs(prev => prev.map(j => 
 j.id === jobId 
 ? { ...j, status: 'completed', progress: 100, message: `تمت المزامنة: ${data.message || 'نجاح'}`, completed_at: new Date().toISOString() }
 : j
 ));
 toast.success('تمت مزامنة قاعدة البيانات بنجاح');
 } else {
 throw new Error(data.error || 'فشلت المزامنة');
 }
 } catch (error: any) {
 setJobs(prev => prev.map(j => 
 j.id === jobId 
 ? { ...j, status: 'failed', message: error.message }
 : j
 ));
 toast.error(error.message || 'فشلت مزامنة قاعدة البيانات');
 } finally {
 setLoading(false);
 }
 };

 // مزامنة جميع الأسواق العربية (Multi-Market Sync)
 const syncMultiMarket = async () => {
 setLoading(true);
 const jobId = `multi-market-${Date.now()}`;
 
 const newJob: ScrapingJob = {
 id: jobId,
 type: 'stocks',
 market: 'ALL',
 status: 'running',
 progress: 0,
 total: 100,
 message: 'جاري تحديث جميع الأسواق العربية...',
 started_at: new Date().toISOString(),
 };
 
 setJobs(prev => [newJob, ...prev]);
 
 try {
 const response = await fetch('/api/multi-market/sync?XTransformPort=8010', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ markets: null }), // null = all markets
 });
 
 const data = await response.json();
 
 if (data.success) {
 const result = data.result || {};
 const totalUpdated = result.total_updated || 0;
 
 setJobs(prev => prev.map(j => 
 j.id === jobId 
 ? { ...j, status: 'completed', progress: 100, message: `تم تحديث ${totalUpdated} عنصر من جميع الأسواق`, completed_at: new Date().toISOString() }
 : j
 ));
 toast.success(`تم تحديث البيانات من جميع الأسواق العربية (${totalUpdated} عنصر)`);
 } else {
 throw new Error(data.error || 'فشل التحديث');
 }
 } catch (error: any) {
 setJobs(prev => prev.map(j => 
 j.id === jobId 
 ? { ...j, status: 'failed', message: error.message }
 : j
 ));
 toast.error(error.message || 'فشل تحديث الأسواق العربية');
 } finally {
 setLoading(false);
 }
 };

 // مزامنة سوق واحد
 const syncSingleMarket = async (market: string) => {
 setLoading(true);
 const jobId = `market-${market}-${Date.now()}`;
 
 const newJob: ScrapingJob = {
 id: jobId,
 type: 'stocks',
 market: market,
 status: 'running',
 progress: 0,
 total: 100,
 message: `جاري تحديث ${market}...`,
 started_at: new Date().toISOString(),
 };
 
 setJobs(prev => [newJob, ...prev]);
 
 try {
 const response = await fetch(`/api/multi-market/sync/${market}?XTransformPort=8010`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 });
 
 const data = await response.json();
 
 if (data.success) {
 const result = data.result || {};
 const totalUpdated = result.total_updated || 0;
 
 setJobs(prev => prev.map(j => 
 j.id === jobId 
 ? { ...j, status: 'completed', progress: 100, message: `تم تحديث ${totalUpdated} سهم من ${market}`, completed_at: new Date().toISOString() }
 : j
 ));
 toast.success(`تم تحديث بيانات ${market} (${totalUpdated} سهم)`);
 } else {
 throw new Error(data.error || 'فشل التحديث');
 }
 } catch (error: any) {
 setJobs(prev => prev.map(j => 
 j.id === jobId 
 ? { ...j, status: 'failed', message: error.message }
 : j
 ));
 toast.error(error.message || `فشل تحديث ${market}`);
 } finally {
 setLoading(false);
 }
 };

 return (
 <div className="space-y-6" dir="rtl">
 {/* اختيار السوق */}
 <Card>
 <CardHeader>
 <CardTitle className="flex items-center gap-2">
 <Database className="w-5 h-5 text-profit" />
 سحب وتحديث البيانات
 </CardTitle>
 <CardDescription>
 تحديث الأسعار وسحب البيانات من المصادر المتاحة
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 {/* اختيار السوق */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
 {MARKETS.map(market => (
 <Button
 key={market.code}
 variant={selectedMarket === market.code ? 'default' : 'outline'}
 size="sm"
 onClick={() => setSelectedMarket(market.code)}
 className="justify-between"
 >
 <span className="text-xs">{market.name}</span>
 <Badge variant="secondary" className="mr-2 text-xs">
 {market.stocks}
 </Badge>
 </Button>
 ))}
 </div>

 {/* أزرار التحديث */}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
 <Button
 onClick={syncLivePrices}
 disabled={loading}
 className="h-auto py-4 flex-col gap-2 bg-profit hover:bg-profit"
 >
 <RefreshCw className={cn("w-5 h-5", loading && "animate-spin")} />
 <span>تحديث الأسعار</span>
 <span className="text-xs opacity-70">سحب الأسعار الحية</span>
 </Button>
 
 <Button
 onClick={syncFromVPS}
 disabled={loading}
 variant="outline"
 className="h-auto py-4 flex-col gap-2"
 >
 <Download className="w-5 h-5" />
 <span>سحب من VPS</span>
 <span className="text-xs opacity-70">مزامنة مع السيرفر</span>
 </Button>
 
 <Button
 onClick={syncHistoricalData}
 disabled={loading}
 variant="outline"
 className="h-auto py-4 flex-col gap-2"
 >
 <History className="w-5 h-5" />
 <span>البيانات التاريخية</span>
 <span className="text-xs opacity-70">أسعار 30 يوم</span>
 </Button>
 
 <Button
 onClick={syncStocksDB}
 disabled={loading}
 variant="secondary"
 className="h-auto py-4 flex-col gap-2"
 >
 <Database className="w-5 h-5" />
 <span>مزامنة قاعدة البيانات</span>
 <span className="text-xs opacity-70">تحديث البيانات المحلية</span>
 </Button>
 
 <Button
 onClick={syncMultiMarket}
 disabled={loading}
 variant="default"
 className="h-auto py-4 flex-col gap-2 bg-primary hover:bg-primary"
 >
 <Globe className="w-5 h-5" />
 <span>تحديث الأسواق العربية</span>
 <span className="text-xs opacity-70">KSA, KSE, DFM, ADX, BSE, QSE</span>
 </Button>
 
 <Button
 onClick={() => syncSingleMarket(selectedMarket === 'EGX' ? 'KSA' : selectedMarket)}
 disabled={loading}
 variant="outline"
 className="h-auto py-4 flex-col gap-2"
 >
 <TrendingUp className="w-5 h-5" />
 <span>تحديث السوق المحدد</span>
 <span className="text-xs opacity-70">{selectedMarket}</span>
 </Button>
 </div>
 </CardContent>
 </Card>

 {/* سجل العمليات */}
 {jobs.length > 0 && (
 <Card>
 <CardHeader>
 <CardTitle className="text-base flex items-center gap-2">
 <BarChart3 className="w-5 h-5" />
 سجل العمليات
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="space-y-3 max-h-64 overflow-y-auto">
 {jobs.slice(0, 10).map(job => (
 <div
 key={job.id}
 className={cn(
 "p-3 rounded-lg border",
 job.status === 'running' && "bg-primary /20 border-primary",
 job.status === 'completed' && "bg-success /20 border-success",
 job.status === 'failed' && "bg-loss /20 border-loss"
 )}
 >
 <div className="flex items-center justify-between mb-2">
 <div className="flex items-center gap-2">
 {job.status === 'running' && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
 {job.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-success" />}
 {job.status === 'failed' && <XCircle className="w-4 h-4 text-loss" />}
 <span className="font-medium text-sm">
 {job.type === 'stocks' ? 'تحديث الأسعار' : 'البيانات التاريخية'}
 </span>
 <Badge variant="outline" className="text-xs">
 {job.market}
 </Badge>
 </div>
 <span className="text-xs text-muted-foreground">
 {job.started_at && new Date(job.started_at).toLocaleTimeString('ar-EG')}
 </span>
 </div>
 
 {job.status === 'running' && (
 <div className="space-y-1">
 <Progress value={(job.progress / job.total) * 100} className="h-2" />
 <div className="flex justify-between text-xs text-muted-foreground">
 <span>{job.message}</span>
 </div>
 </div>
 )}
 
 {(job.status === 'completed' || job.status === 'failed') && (
 <p className="text-sm text-muted-foreground">{job.message}</p>
 )}
 </div>
 ))}
 </div>
 </CardContent>
 </Card>
 )}

 {/* معلومات */}
 <Card className="bg-warning /20 border-warning">
 <CardContent className="p-4">
 <div className="flex items-start gap-3">
 <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
 <div className="text-sm">
 <p className="font-medium text-warning ">ملاحظة مهمة</p>
 <ul className="text-muted-foreground mt-1 space-y-1">
 <li>• تحديث الأسعار يعمل محلياً بدون Python Backend</li>
 <li>• السحب من VPS يتطلب اتصال بالسيرفر</li>
 <li>• البيانات التاريخية تحتاج Python Backend شغال</li>
 </ul>
 </div>
 </div>
 </CardContent>
 </Card>
 </div>
 );
}
