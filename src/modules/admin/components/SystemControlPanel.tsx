'use client';

/**
 * SystemControlPanel — لوحة التحكم الشاملة
 * ==========================================
 * تحكم ومراقبة كاملة لكل جوانب المشروع:
 * - قواعد البيانات (حالة + ضغط)
 * - الخدمات (إعادة تشغيل)
 * - المحركات (تحكم)
 * - الأسعار (تحديث + فحص)
 * - التوقعات (إحصائيات + إغلاق)
 * - السجلات (مباشر)
 * - إجراءات سريعة
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database, Server, Cpu, HardDrive, Activity, Zap, RefreshCw,
  Play, Trash2, AlertCircle, CheckCircle2, Loader2,
  TrendingUp, Brain, Clock, Bell, Terminal, Power, Settings
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

type Tab = 'overview' | 'databases' | 'services' | 'engines' | 'prices' | 'predictions' | 'logs';

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'overview', label: 'نظرة عامة', icon: Activity },
  { id: 'databases', label: 'قواعد البيانات', icon: Database },
  { id: 'services', label: 'الخدمات', icon: Server },
  { id: 'engines', label: 'المحركات', icon: Brain },
  { id: 'prices', label: 'الأسعار', icon: TrendingUp },
  { id: 'predictions', label: 'التوقعات', icon: Zap },
  { id: 'logs', label: 'السجلات', icon: Terminal },
];

export function SystemControlPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/system-control?section=${activeTab}`);
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch (e) {
      console.error('[SystemControl] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const runAction = async (action: string, body?: any) => {
    setActionLoading(action);
    try {
      const res = await fetch(`/api/system-control?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (json.success) {
        await fetchData();
      }
    } catch (e) {
      console.error('[SystemControl] action error:', e);
    }
    setActionLoading(null);
  };

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white" dir="rtl">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#0a0e17]/95 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm font-bold">لوحة التحكم الشاملة</h2>
            <Badge variant="outline" className="text-cyan-400 border-cyan-500/30 text-[10px]">
              {data?.system ? 'مباشر' : '...'}
            </Badge>
          </div>
          <Button variant="ghost" size="icon" onClick={fetchData} className="h-8 w-8">
            <RefreshCw className={cn('w-4 h-4 text-gray-400', loading && 'animate-spin')} />
          </Button>
        </div>

        {/* Tabs — horizontal scroll on mobile */}
        <div className="flex gap-1 px-2 pb-2 overflow-x-auto scrollbar-hide-mobile">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all min-h-[40px] whitespace-nowrap',
                  activeTab === tab.id
                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="p-3 pb-20">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {loading && !data ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
              </div>
            ) : (
              <>
                {activeTab === 'overview' && <OverviewTab data={data} />}
                {activeTab === 'databases' && <DatabasesTab data={data} runAction={runAction} actionLoading={actionLoading} />}
                {activeTab === 'services' && <ServicesTab data={data} runAction={runAction} actionLoading={actionLoading} />}
                {activeTab === 'engines' && <EnginesTab data={data} />}
                {activeTab === 'prices' && <PricesTab data={data} runAction={runAction} actionLoading={actionLoading} />}
                {activeTab === 'predictions' && <PredictionsTab data={data} runAction={runAction} actionLoading={actionLoading} />}
                {activeTab === 'logs' && <LogsTab data={data} />}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Quick Actions Bar — fixed bottom */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#0a0e17]/95 backdrop-blur-xl border-t border-white/5 p-2" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex gap-2 overflow-x-auto scrollbar-hide-mobile">
          <QuickButton icon={RefreshCw} label="تحديث الأسعار" loading={actionLoading === 'update-prices'} onClick={() => runAction('update-prices')} color="emerald" />
          <QuickButton icon={CheckCircle2} label="إغلاق التوقعات" loading={actionLoading === 'run-daily-closer'} onClick={() => runAction('run-daily-closer')} color="amber" />
          <QuickButton icon={TrendingUp} label="لقطة الثروة" loading={actionLoading === 'run-wealth-snapshot'} onClick={() => runAction('run-wealth-snapshot')} color="purple" />
          <QuickButton icon={Trash2} label="مسح الكاش" loading={actionLoading === 'clear-cache'} onClick={() => runAction('clear-cache')} color="red" />
        </div>
      </div>
    </div>
  );
}

// === Overview Tab ===
function OverviewTab({ data }: { data: any }) {
  const sys = data?.system || {};
  const dbs = data?.databases || [];

  const healthyCount = dbs.filter((d: any) => d.status === 'healthy').length;
  const totalSize = dbs.reduce((s: number, d: any) => s + (d.size_kb || 0), 0);

  return (
    <div className="space-y-3">
      {/* System Stats */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard icon={Cpu} label="المعالج" value={sys.cpu || 'N/A'} color="cyan" />
        <StatCard icon={HardDrive} label="الذاكرة" value={sys.memory || 'N/A'} color="purple" />
        <StatCard icon={Database} label="القرص" value={sys.disk || 'N/A'} color="emerald" />
        <StatCard icon={Clock} label="التشغيل" value={sys.uptime || 'N/A'} color="amber" />
      </div>

      {/* DBs Summary */}
      <Card className="bg-white/5 border-white/10 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-300">قواعد البيانات</span>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 text-[10px]">
            {healthyCount}/{dbs.length} سليمة
          </Badge>
        </div>
        <div className="text-2xl font-bold text-white">{(totalSize / 1024).toFixed(0)} MB</div>
        <div className="text-[10px] text-gray-500 mt-1">إجمالي حجم البيانات</div>
      </Card>

      {/* DB List */}
      <div className="space-y-1.5">
        {dbs.map((db: any) => (
          <DBRow key={db.name} db={db} compact />
        ))}
      </div>
    </div>
  );
}

// === Databases Tab ===
function DatabasesTab({ data, runAction, actionLoading }: any) {
  const dbs = data?.databases || [];
  return (
    <div className="space-y-2">
      {dbs.map((db: any) => (
        <DBRow key={db.name} db={db} runAction={runAction} actionLoading={actionLoading} />
      ))}
    </div>
  );
}

function DBRow({ db, compact, runAction, actionLoading }: any) {
  const statusColor = db.status === 'healthy' ? 'text-emerald-400' : db.status === 'empty' ? 'text-amber-400' : 'text-red-400';
  const StatusIcon = db.status === 'healthy' ? CheckCircle2 : AlertCircle;

  return (
    <Card className="bg-white/5 border-white/10 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Database className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-medium text-white truncate">{db.name}</div>
            <div className="text-[10px] text-gray-500">{db.size_human} • {db.tables} جداول</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusIcon className={cn('w-4 h-4', statusColor)} />
          {!compact && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[10px] text-gray-400 hover:text-white"
              disabled={actionLoading === `vacuum-${db.name}`}
              onClick={() => runAction('vacuum-db', { db: db.name })}
            >
              {actionLoading === `vacuum-${db.name}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'ضغط'}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// === Services Tab ===
function ServicesTab({ data, runAction, actionLoading }: any) {
  const services = data || [];
  return (
    <div className="space-y-2">
      {services.map((svc: any) => (
        <Card key={svc.name} className="bg-white/5 border-white/10 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-purple-400 shrink-0" />
              <div>
                <div className="text-xs font-medium text-white">{svc.name}</div>
                <div className="text-[10px] text-gray-500">
                  {svc.memory ? `${svc.memory} • CPU ${svc.cpu}` : `port ${svc.port || '?'}`}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className={cn('w-2 h-2 rounded-full', svc.status === 'online' ? 'bg-emerald-400' : 'bg-red-400')} />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[10px] text-amber-400 hover:text-amber-300"
                disabled={actionLoading === `restart-${svc.name}`}
                onClick={() => runAction('restart-service', { service: svc.name })}
              >
                {actionLoading === `restart-${svc.name}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// === Engines Tab ===
function EnginesTab({ data }: { data: any }) {
  const engines = data || [];
  return (
    <div className="space-y-2">
      {engines.map((eng: any) => (
        <Card key={eng.id} className="bg-white/5 border-white/10 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-cyan-400 shrink-0" />
              <div>
                <div className="text-xs font-medium text-white">{eng.name}</div>
                <div className="text-[10px] text-gray-500">port {eng.port}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {eng.controllable && <Settings className="w-3 h-3 text-cyan-400" />}
              <div className={cn('w-2 h-2 rounded-full', eng.status === 'active' ? 'bg-emerald-400' : 'bg-red-400')} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// === Prices Tab ===
function PricesTab({ data, runAction, actionLoading }: any) {
  return (
    <div className="space-y-3">
      <Card className="bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 border-emerald-500/20 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            <span className="text-sm font-bold">حالة الأسعار</span>
          </div>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white h-8"
            disabled={actionLoading === 'update-prices'}
            onClick={() => runAction('update-prices')}
          >
            {actionLoading === 'update-prices' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            <span className="mr-1 text-xs">تحديث</span>
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center p-2 rounded-lg bg-black/30">
            <div className="text-2xl font-bold text-white">{data?.total_stocks || 0}</div>
            <div className="text-[10px] text-gray-400">إجمالي الأسهم</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-black/30">
            <div className="text-2xl font-bold text-emerald-400">{data?.freshness_pct || 0}%</div>
            <div className="text-[10px] text-gray-400">طازجة</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-black/30">
            <div className="text-lg font-bold text-cyan-400">{data?.egx_stocks || 0}</div>
            <div className="text-[10px] text-gray-400">أسهم EGX</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-black/30">
            <div className="text-lg font-bold text-purple-400">{(data?.price_history_rows || 0).toLocaleString()}</div>
            <div className="text-[10px] text-gray-400">سجل تاريخي</div>
          </div>
        </div>
        <div className="mt-2 text-center text-[10px] text-gray-500">
          آخر تحديث: {data?.price_history_latest || 'N/A'}
        </div>
      </Card>
    </div>
  );
}

// === Predictions Tab ===
function PredictionsTab({ data, runAction, actionLoading }: any) {
  const wr = data?.win_rate || 0;
  return (
    <div className="space-y-3">
      <Card className="bg-gradient-to-br from-purple-500/10 to-pink-500/5 border-purple-500/20 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-purple-400" />
            <span className="text-sm font-bold">التوقعات</span>
          </div>
          <Button
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white h-8"
            disabled={actionLoading === 'run-daily-closer'}
            onClick={() => runAction('run-daily-closer')}
          >
            {actionLoading === 'run-daily-closer' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            <span className="mr-1 text-xs">إغلاق</span>
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center p-2 rounded-lg bg-black/30">
            <div className="text-2xl font-bold text-white">{(data?.total || 0).toLocaleString()}</div>
            <div className="text-[10px] text-gray-400">إجمالي</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-black/30">
            <div className={cn('text-2xl font-bold', wr >= 50 ? 'text-emerald-400' : 'text-amber-400')}>{wr}%</div>
            <div className="text-[10px] text-gray-400">معدل النجاح</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-black/30">
            <div className="text-lg font-bold text-cyan-400">{(data?.closed || 0).toLocaleString()}</div>
            <div className="text-[10px] text-gray-400">مغلقة</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-black/30">
            <div className="text-lg font-bold text-amber-400">{(data?.pending || 0).toLocaleString()}</div>
            <div className="text-[10px] text-gray-400">معلقة</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// === Logs Tab ===
function LogsTab({ data }: { data: any }) {
  const logs = data || [];
  return (
    <Card className="bg-black/40 border-white/10 p-3 h-[60vh]">
      <ScrollArea className="h-full">
        <div className="space-y-0.5 font-mono text-[10px] text-gray-400" dir="ltr">
          {logs.map((log: string, i: number) => (
            <div key={i} className={cn(
              'py-0.5 px-1 rounded',
              log.includes('Error') || log.includes('error') ? 'bg-red-500/5 text-red-400' : '',
              log.includes('success') || log.includes('✅') ? 'bg-emerald-500/5 text-emerald-400' : '',
            )}>
              {log}
            </div>
          ))}
          {logs.length === 0 && <div className="text-center text-gray-600 py-8">لا توجد سجلات</div>}
        </div>
      </ScrollArea>
    </Card>
  );
}

// === Helper Components ===
function StatCard({ icon: Icon, label, value, color }: any) {
  const colors: Record<string, string> = {
    cyan: 'text-cyan-400 bg-cyan-500/5 border-cyan-500/20',
    purple: 'text-purple-400 bg-purple-500/5 border-purple-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/5 border-emerald-500/20',
    amber: 'text-amber-400 bg-amber-500/5 border-amber-500/20',
  };
  return (
    <Card className={cn('border p-3', colors[color])}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-[10px] text-gray-400">{label}</span>
      </div>
      <div className="text-xs font-bold text-white truncate">{value}</div>
    </Card>
  );
}

function QuickButton({ icon: Icon, label, onClick, loading, color }: any) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10',
    amber: 'text-amber-400 border-amber-500/30 hover:bg-amber-500/10',
    purple: 'text-purple-400 border-purple-500/30 hover:bg-purple-500/10',
    red: 'text-red-400 border-red-500/30 hover:bg-red-500/10',
  };
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all min-h-[40px] whitespace-nowrap',
        colors[color]
      )}
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
      {label}
    </button>
  );
}
