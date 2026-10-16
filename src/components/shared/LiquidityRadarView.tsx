'use client';

/**
 * LiquidityRadarView — رادار تدفق السيولة المؤسسية ونبض الحيتان
 * =================================================================
 * يستخدم UnifiedTable (الجدول الموحد) بدلاً من الكروت الطولية.
 * 10 أعمدة واضحة + MiniSparkline + UnifiedPublishButton في كل صف.
 * onRowClick → يفتح StockDetailSheet بالسهم المختار.
 *
 * Rule 4: Python = brain — كل البيانات من /api/v2/liquidity-radar
 * Rule 27: NO-FAKE-DATA
 * Rule 30: emerald/teal/rose فقط
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { StockDetailSheet } from '@/components/shared/StockDetailSheet';
import {
  Shield, RefreshCw, AlertTriangle, Activity,
  TrendingUp, TrendingDown, Layers, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';

// ============================================================================
// Types
// ============================================================================

interface WhaleInfo {
  net_flow_egp: number | null;
  whale_present: boolean | null;
  flow_strength: string | null;
  buy_pct?: number | null;
  sell_pct?: number | null;
}

interface MarketRegime {
  regime: string | null;
  change_pct: number | null;
  is_bear?: boolean | null;
  is_bull?: boolean | null;
}

interface EntryDefense {
  entry_level: number | null;
  defense_level: number | null;
  resistance_level?: number | null;
}

interface RadarStock {
  ticker: string;
  name?: string | null;
  sector?: string | number | null;
  whale: WhaleInfo;
  market_regime: MarketRegime;
  phase: string;
  phase_reason?: string | null;
  entry_defense: EntryDefense;
  reason: string | null;
  // TASK-BACKEND-BRAVO: canonical mutually-exclusive liquidity bucket
  liquidity_bucket?: string | null;
  liquidity_bucket_ar?: string | null;
  net_flow_5d?: number | null;
  volume?: number | null;
}


// ─── TASK-ALPHA-C: Tactical liquidity-bucket filters + pagination ─────────
type BucketKey = 'all' | 'whale_inflow' | 'whale_outflow' | 'bottom_absorption' | 'correction_exhaustion';
const BUCKET_FILTERS: Array<{ key: BucketKey; label: string; icon: string; cls: string }> = [
  { key: 'all', label: 'الكل', icon: '📋', cls: 'bg-muted text-muted-foreground' },
  { key: 'whale_inflow', label: 'تدفق حيتان قوي', icon: '🌊', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  { key: 'whale_outflow', label: 'تصريف صريح', icon: '🩸', cls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30' },
  { key: 'bottom_absorption', label: 'تجميع قيعان', icon: '💎', cls: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/30' },
  { key: 'correction_exhaustion', label: 'نهاية تصحيح', icon: '🛡️', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30' },
];
const PAGE_SIZE = 25;
const INACTIVE_VOLUME_THRESHOLD = 100_000; // 100K EGP — below = inactive

interface RadarResponse {
  success: boolean;
  market: string;
  market_regime: MarketRegime | null;
  scanned_count?: number;
  phases_breakdown?: Record<string, number>;
  stocks: RadarStock[];
  error?: string | null;
  message?: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

function fmtFlow(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const abs = Math.abs(Number(n));
  const sign = Number(n) >= 0 ? '+' : '-';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(2);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(2)}%`;
}

const PHASE_LABELS: Record<string, string> = {
  'بيبلع على الهادي': 'تجميع',
  'بيتحضر': 'صعود',
  'بيصرف': 'تصريف',
  'بيانات غير كافية': 'غير كافية',
};

const PHASE_COLORS: Record<string, string> = {
  'بيبلع على الهادي': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  'بيتحضر': 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20',
  'بيصرف': 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  'بيانات غير كافية': 'bg-muted text-muted-foreground border-border',
};

const MARKET_OPTIONS = [
  { code: 'EGX', label: '🇪🇬 مصر', currency: 'ج.م' },
  { code: 'TADAWUL', label: '🇸🇦 السعودية', currency: 'ر.س' },
  { code: 'KSE', label: '🇰🇼 الكويت', currency: 'د.ك' },
  { code: 'QSE', label: '🇶🇦 قطر', currency: 'ر.ق' },
  { code: 'US', label: '🇺🇸 أمريكا', currency: '$' },
  { code: 'CRYPTO', label: '🪙 كريبتو', currency: '$' },
] as const;

function marketCurrency(market: string): string {
  const found = MARKET_OPTIONS.find((m) => m.code === market);
  return found?.currency || 'ج.م';
}

// ============================================================================
// Main Component
// ============================================================================

export function LiquidityRadarView({ market: marketProp }: { market?: string }) {
  const storeMarket = useAppStore((s) => s.currentMarket);
  const [activeMarket, setActiveMarket] = useState(
    (marketProp || storeMarket || 'EGX').toUpperCase()
  );
  const market = activeMarket;

  const [data, setData] = useState<RadarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [bucketFilter, setBucketFilter] = useState<BucketKey>('all');
  const [hideInactive, setHideInactive] = useState(true);
  const [page, setPage] = useState(0);
  const currency = marketCurrency(market);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v2/liquidity-radar?market=${encodeURIComponent(market)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) { setError('تعذّر الاتصال بالخادم'); setData(null); return; }
      const json: RadarResponse = await res.json();
      if (!json.success) { setError(json.message || json.error || 'فشل المحرك'); setData(json); return; }
      setData(json);
    } catch {
      setError('تعذّر الاتصال بالخادم');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── TASK-ALPHA-C: client-side bucket + inactive filtering + pagination ───
  const filteredStocks = React.useMemo(() => {
    const list = data?.stocks ?? [];
    let out = list;
    if (bucketFilter !== 'all') {
      out = out.filter((s) => (s.liquidity_bucket || 'neutral') === bucketFilter);
    }
    if (hideInactive) {
      out = out.filter((s) => {
        const vol = Number(s.volume ?? s.whale?.net_flow_egp ?? 0);
        // Consider a stock "active" if it has meaningful volume OR net flow.
        // net_flow_5d is in EGP; volume from stocks table is share count.
        // Use whale.net_flow_egp absolute value as the turnover proxy.
        const flow = Math.abs(Number(s.whale?.net_flow_egp ?? 0));
        return flow >= INACTIVE_VOLUME_THRESHOLD || vol > 0;
      });
    }
    return out;
  }, [data, bucketFilter, hideInactive]);

  const totalPages = Math.max(1, Math.ceil(filteredStocks.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedStocks = filteredStocks.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  React.useEffect(() => { setPage(0); }, [bucketFilter, hideInactive, activeMarket]);

  // ─── Build UnifiedTable columns ───
  const columns: Column<RadarStock>[] = [
    {
      key: 'ticker',
      header: 'السهم',
      sortable: true,
      width: 'min-w-[120px]',
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-bold text-sm font-mono tabular-nums text-foreground">{row.ticker}</span>
          <span className="text-xs text-muted-foreground truncate max-w-[100px]">{row.name || ''}</span>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'السعر',
      sortable: true,
      width: 'w-20',
      align: 'center',
      render: (row) => (
        <span className="font-mono tabular-nums font-semibold text-foreground">
          {fmtPrice(row.market_regime?.change_pct != null ? row.entry_defense?.entry_level : null)}
        </span>
      ),
    },
    {
      key: 'change_pct',
      header: 'التغير%',
      sortable: true,
      width: 'w-20',
      align: 'center',
      sortValue: (row) => row.market_regime?.change_pct ?? 0,
      render: (row) => {
        const pct = row.market_regime?.change_pct;
        const isPositive = (pct ?? 0) >= 0;
        return (
          <span className={cn('font-mono tabular-nums font-semibold', isPositive ? 'text-emerald-500' : 'text-rose-500')}>
            {fmtPct(pct)}
          </span>
        );
      },
    },
    {
      key: 'sparkline',
      header: 'شارت 7 أيام',
      width: 'w-28',
      align: 'center',
      render: (row) => (
        <MiniSparkline ticker={row.ticker} height={35} width={90} showArea />
      ),
    },
    {
      key: 'whale_flow',
      header: 'صافي تدفق الحوت',
      sortable: true,
      width: 'w-28',
      align: 'center',
      sortValue: (row) => row.whale?.net_flow_egp ?? 0,
      render: (row) => {
        const flow = row.whale?.net_flow_egp;
        const isPositive = (flow ?? 0) >= 0;
        return (
          <span className={cn('font-mono tabular-nums font-bold', isPositive ? 'text-emerald-500' : 'text-rose-500')}>
            {fmtFlow(flow)}
          </span>
        );
      },
    },
    {
      key: 'phase',
      header: 'المرحلة',
      sortable: true,
      width: 'w-24',
      align: 'center',
      render: (row) => {
        const label = PHASE_LABELS[row.phase] || row.phase || '—';
        const colorClass = PHASE_COLORS[row.phase] || 'bg-muted text-muted-foreground border-border';
        return (
          <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border', colorClass)}>
            <Layers className="w-3 h-3" />
            {label}
          </span>
        );
      },
    },
    {
      key: 'entry',
      header: 'الدخول',
      width: 'w-20',
      align: 'center',
      render: (row) => (
        <span className="font-mono tabular-nums font-semibold text-emerald-500">
          {fmtPrice(row.entry_defense?.entry_level)}
        </span>
      ),
    },
    {
      key: 'defense',
      header: 'الوقف',
      width: 'w-20',
      align: 'center',
      render: (row) => (
        <span className="font-mono tabular-nums font-semibold text-rose-500">
          {fmtPrice(row.entry_defense?.defense_level)}
        </span>
      ),
    },
    {
      key: 'target',
      header: 'الهدف',
      width: 'w-20',
      align: 'center',
      render: (row) => (
        <span className="font-mono tabular-nums font-semibold text-teal-500">
          {fmtPrice(row.entry_defense?.resistance_level)}
        </span>
      ),
    },
    {
      key: 'publish',
      header: 'نشر',
      width: 'w-24',
      align: 'center',
      render: (row) => (
        <UnifiedPublishButton
          ticker={row.ticker}
          content={`📊 ${row.ticker} — ${row.name || ''}
المرحلة: ${PHASE_LABELS[row.phase] || row.phase}
الدخول: ${fmtPrice(row.entry_defense?.entry_level)}
الوقف: ${fmtPrice(row.entry_defense?.defense_level)}
الهدف: ${fmtPrice(row.entry_defense?.resistance_level)}
صافي تدفق الحوت: ${fmtFlow(row.whale?.net_flow_egp)} ${currency}

منصة دليل الاستثمار`}
          title={`${row.ticker} — ${row.name || ''}`}
          filename={`${row.ticker}-radar.png`}
          hashtags={['EGX', 'رادار', row.ticker]}
          variant="outline"
          size="sm"
        />
      ),
    },
  ];

  // ─── Loading state ───
  if (loading) {
    return (
      <div className="space-y-4 p-4" dir="rtl">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  // ─── Error / empty state ───
  if (error || !data || !data.stocks || data.stocks.length === 0) {
    return (
      <div className="space-y-4 p-4" dir="rtl">
        <MarketSelectorBar activeMarket={market} onSelect={setActiveMarket} currency={currency} />
        <PulseRibbon market={market} scannedCount={data?.scanned_count ?? 0} />
        <Card className="bg-card border-border">
          <CardContent className="p-8 text-center space-y-3">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              {error || 'لا توجد بيانات رادار متاحة حالياً'}
            </p>
            <p className="text-xs text-muted-foreground">
              المحرّك بيفحص السوق كل 5 دقائق — ستظهر الأسهم هنا فور رصدها
            </p>
            <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4" dir="rtl">
      {/* ─── Market Selector Bar ─── */}
      <MarketSelectorBar activeMarket={market} onSelect={setActiveMarket} currency={currency} />

      {/* ─── Pulse Ribbon ─── */}
      <PulseRibbon market={market} scannedCount={data.scanned_count ?? data.stocks.length} />

      {/* ─── TASK-ALPHA-C: Tactical liquidity-bucket filter bar ─── */}
      <div className="bg-card border border-border rounded-xl p-2 flex flex-wrap items-center gap-1.5">
        {BUCKET_FILTERS.map((f) => {
          const count = f.key === 'all'
            ? (data?.stocks?.length ?? 0)
            : (data?.stocks ?? []).filter((st) => (st.liquidity_bucket || 'neutral') === f.key).length;
          const active = bucketFilter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setBucketFilter(f.key)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-semibold transition-all border flex items-center gap-1',
                active
                  ? f.cls + ' shadow-sm ring-1 ring-emerald-500/20'
                  : 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted'
              )}
            >
              <span>{f.icon}</span>
              <span>{f.label}</span>
              <span className="text-[9px] opacity-70">({count})</span>
            </button>
          );
        })}
        <label className="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={hideInactive}
            onChange={(e) => setHideInactive(e.target.checked)}
            className="w-3.5 h-3.5 accent-emerald-500"
          />
          إخفاء الأسهم الخاملة (&lt;100K)
        </label>
      </div>

      {/* ─── UnifiedTable (paginated) ─── */}
      <UnifiedTable<RadarStock>
        columns={columns}
        data={pagedStocks}
        keyField="ticker"
        dense
        filterable
        columnToggle
        onRowClick={(row) => setSelectedTicker(row.ticker)}
        maxHeight="calc(100vh - 280px)"
        emptyText={bucketFilter === 'all' ? 'لا توجد أسهم مطابقة' : `لا توجد أسهم في تصنيف "${BUCKET_FILTERS.find(f => f.key === bucketFilter)?.label || ''}"`}
        className="bg-card border-border rounded-xl"
      />

      {/* ─── Pagination ─── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 bg-card border border-border rounded-xl px-3 py-2">
          <span className="text-xs text-muted-foreground">
            عرض {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filteredStocks.length)} من {filteredStocks.length} سهم
            {bucketFilter !== 'all' && ` (مُصفّى: ${BUCKET_FILTERS.find(f => f.key === bucketFilter)?.label})`}
          </span>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="h-7 gap-1 text-xs">
              <ChevronRight className="w-3.5 h-3.5" /> السابق
            </Button>
            <span className="text-xs font-mono tabular-nums text-muted-foreground px-2">
              {safePage + 1} / {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)} className="h-7 gap-1 text-xs">
              التالي <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ─── StockDetailSheet ─── */}
      <StockDetailSheet
        ticker={selectedTicker}
        onClose={() => setSelectedTicker(null)}
      />
    </div>
  );
}

// ============================================================================
// Pulse Ribbon
// ============================================================================

function PulseRibbon({ market, scannedCount }: { market: string; scannedCount: number }) {
  return (
    <div className="w-full bg-muted px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-sm rounded-xl border border-border">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
          <span className="font-mono text-[10px] text-emerald-500 uppercase tracking-widest">WYCKOFF-RADAR-V4</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">السوق:</span>
          <span className="font-mono font-semibold text-foreground">{market}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Shield className="w-3.5 h-3.5 text-emerald-500" />
          <span>بروتوكول Rule 80 نشط</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <span className="font-mono text-[10px] text-muted-foreground">مرقوب: {scannedCount} سهم</span>
      </div>
    </div>
  );
}

// ============================================================================
// Market Selector Bar
// ============================================================================

function MarketSelectorBar({
  activeMarket,
  onSelect,
  currency,
}: {
  activeMarket: string;
  onSelect: (m: string) => void;
  currency: string;
}) {
  return (
    <div className="w-full bg-card border border-border rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-muted-foreground shrink-0">السوق:</span>
        {MARKET_OPTIONS.map((m) => (
          <button
            key={m.code}
            onClick={() => onSelect(m.code)}
            className={cn(
              'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors',
              activeMarket === m.code
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-muted-foreground">العملة:</span>
        <span className="font-mono text-sm font-bold text-emerald-500 bg-muted px-2 py-0.5 rounded-md">
          {currency}
        </span>
      </div>
    </div>
  );
}
