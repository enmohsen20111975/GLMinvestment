// src/modules/screener/components/screener-advanced/screenerColumns.tsx
// F-Phase3-Split-Screener — UnifiedTable column definitions for the screener
// results table (Tab 1 — AdvancedFiltersTab). Each column carries its own
// sortValue + filterValue + render rules.
//
// (UNIFIED-TABLE-UPGRADE) sortValue هو الـ contract بين render و sort:
// كل القيم null/0 → -1 (sorts to bottom). Rule 27: لا fabrication.

import { Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { MiniSparkline } from '@/components/ui/mini-sparkline';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { RelativeVolumeBadge } from '@/components/shared/RelativeVolumeBadge';
import { cn } from '@/lib/utils';
import type { ScreenerStock } from '@/hooks/useScreenerData';
import {
  formatNumber,
  formatVolume,
  formatEGP,
  getChangeColor,
  computeScreenerEntry,
  computeScreenerStop,
  computeScreenerTarget,
  computeScreenerRR,
  computeOpportunityQuality,
  STATE_ORDER,
} from './helpers';
import { StateBadge } from './StateBadge';
import type { TFunc } from './types';

export function buildScreenerColumns(t: TFunc): Column<ScreenerStock>[] {
  return [
    {
      key: 'ticker',
      header: t('screener.advanced.columns.stock'),
      align: 'right',
      sortable: true,
      filterable: true,
      // (UNIFIED-TABLE-UPGRADE) sortValue: ticker string (alphabetic via fallback path)
      sortValue: (s) => s.ticker || '',
      filterValue: (s) => s.ticker,
      render: (s) => (
        <div>
          <div className="font-mono font-bold text-sm">{s.ticker}</div>
          <div className="text-xs text-muted-foreground truncate max-w-[150px]">
            {s.name_ar || s.name}
          </div>
          <div className="text-xs text-muted-foreground">{s.sector}</div>
        </div>
      ),
    },
    {
      key: 'current_price',
      header: t('screener.advanced.columns.price'),
      align: 'left',
      sortable: true,
      filterable: true,
      editable: true, // (Task 37) «الجدول المتقدّم» — inline edit (local only)
      // (UNIFIED-TABLE-UPGRADE) sortValue: current_price (0/null → -1)
      sortValue: (s) => (s.current_price > 0 ? s.current_price : -1),
      render: (s) => (
        <span className="font-mono text-sm">{formatNumber(s.current_price)}</span>
      ),
    },
    {
      key: 'change_percent',
      header: t('screener.advanced.columns.changePercent'),
      align: 'left',
      sortable: true,
      filterable: true,
      editable: true, // (Task 37) «الجدول المتقدّم» — inline edit (local only)
      // (UNIFIED-TABLE-UPGRADE) sortValue: change_percent (null → -Infinity to bottom)
      sortValue: (s) => (Number.isFinite(s.change_percent) ? s.change_percent : -Infinity),
      render: (s) => (
        <span className={cn('font-mono text-sm font-medium', getChangeColor(s.change_percent))}>
          {s.change_percent > 0 ? '+' : ''}
          {formatNumber(s.change_percent)}%
        </span>
      ),
    },
    {
      key: 'sparkline',
      header: t('screener.advanced.columns.chart'),
      align: 'center',
      render: (s) => <MiniSparkline ticker={s.ticker} height={24} width={80} showArea={false} />,
    },
    // ── Owner directive: "حط أعمدة Entry / Stop / Target / R/R في المقدمة" ──
    {
      key: 'entry',
      header: 'دخول',
      align: 'left',
      sortable: true,
      // (UNIFIED-TABLE-UPGRADE) sortValue: computed entry price (-1 if invalid)
      sortValue: (s) => computeScreenerEntry(s),
      render: (s) => {
        const entry = computeScreenerEntry(s);
        return (
          <span className="font-mono text-xs font-semibold text-foreground">
            {entry > 0 ? (entry ?? 0).toFixed(2) : '—'}
          </span>
        );
      },
    },
    {
      key: 'stop',
      header: 'وقف',
      align: 'left',
      sortable: true,
      // (UNIFIED-TABLE-UPGRADE) sortValue: computed stop price (-1 if invalid)
      sortValue: (s) => computeScreenerStop(s),
      render: (s) => {
        const stop = computeScreenerStop(s);
        return (
          <span className="font-mono text-xs font-semibold text-loss ">
            {stop > 0 ? (stop ?? 0).toFixed(2) : '—'}
          </span>
        );
      },
    },
    {
      key: 'target',
      header: 'هدف',
      align: 'left',
      sortable: true,
      // (UNIFIED-TABLE-UPGRADE) sortValue: computed target price (-1 if invalid)
      sortValue: (s) => computeScreenerTarget(s),
      render: (s) => {
        const target = computeScreenerTarget(s);
        return (
          <span className="font-mono text-xs font-semibold text-profit ">
            {target > 0 ? (target ?? 0).toFixed(2) : '—'}
          </span>
        );
      },
    },
    {
      key: 'risk_reward',
      header: 'R:R',
      align: 'left',
      sortable: true,
      // (UNIFIED-TABLE-UPGRADE) sortValue: computed R:R (-1 if invalid)
      sortValue: (s) => computeScreenerRR(s),
      render: (s) => {
        const rr = computeScreenerRR(s);
        if (rr > 0) {
          const rrColor = rr >= 2 ? 'text-profit ' : rr >= 1.5 ? 'text-warning ' : 'text-loss ';
          return <span className={`font-mono text-xs font-bold ${rrColor}`}>{(rr ?? 0).toFixed(2)}</span>;
        }
        return <span className="text-muted-foreground">—</span>;
      },
    },
    {
      key: 'opportunity_quality',
      header: 'جودة',
      align: 'left',
      sortable: true,
      // (UNIFIED-TABLE-UPGRADE) sortValue: opportunity_quality score (-1 if invalid)
      sortValue: (s) => computeOpportunityQuality(s),
      render: (s) => {
        const quality = computeOpportunityQuality(s);
        const color =
          quality >= 70 ? 'text-profit ' : quality >= 50 ? 'text-warning ' : 'text-muted-foreground';
        return <span className={`font-mono text-xs font-bold ${color}`}>{quality}</span>;
      },
    },
    {
      key: 'volume',
      header: t('screener.advanced.columns.volume'),
      align: 'left',
      sortable: true,
      filterable: true,
      editable: true,
      // (UNIFIED-TABLE-UPGRADE) sortValue: volume (-1 if invalid)
      sortValue: (s) => (s.volume > 0 ? s.volume : -1),
      render: (s) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs text-muted-foreground">
            {formatVolume(s.volume)}
            {s.volume_surge && <Zap className="inline w-3 h-3 text-warning mr-1" />}
          </span>
          {/* (ALPHA-SCANNER-LIVE, Task 5): شارة الحجم النسبي > 1.2x.
              تأخذ relative_volume_10d الرسمي (برافو) أو volume_ratio_10d_vs_20d
              أو volume_surge كـ fallback. لو القيمة طبيعية → لا تظهر. */}
          <RelativeVolumeBadge
            relativeVolume10d={s.relative_volume_10d}
            volumeRatio10dVs20d={s.volume_ratio_10d_vs_20d}
            volumeSurge={s.volume_surge}
            threshold={1.2}
            size="sm"
          />
        </div>
      ),
    },
    {
      key: 'turnover_egp',
      header: t('screener.advanced.columns.liquidityEGP'),
      align: 'left',
      sortable: true,
      filterable: true,
      editable: true, // (Task 37) «الجدول المتقدّم» — inline edit (local only)
      // (UNIFIED-TABLE-UPGRADE) sortValue: turnover_egp (-1 if invalid)
      sortValue: (s) => (s.turnover_egp > 0 ? s.turnover_egp : -1),
      render: (s) => (
        <span className="font-mono text-xs text-muted-foreground">{formatEGP(s.turnover_egp)}</span>
      ),
    },
    {
      key: 'pe_ratio',
      header: t('screener.advanced.columns.peRatio'),
      align: 'left',
      sortable: true,
      filterable: true,
      editable: true, // (Task 37) «الجدول المتقدّم» — inline edit (local only)
      // (UNIFIED-TABLE-UPGRADE) sortValue: pe_ratio (-1 if null/0/15 placeholder)
      sortValue: (s) => (s.pe_ratio !== null && s.pe_ratio > 0 && s.pe_ratio !== 15.0 ? s.pe_ratio : -1),
      render: (s) => (
        <span className="font-mono text-xs">
          {s.pe_ratio !== null ? formatNumber(s.pe_ratio, 1) : '—'}
        </span>
      ),
    },
    {
      key: 'roe',
      header: 'ROE %',
      align: 'left',
      sortable: true,
      filterable: true,
      // (UNIFIED-TABLE-UPGRADE) sortValue: ROE (-1 if null/0/15 placeholder)
      sortValue: (s) =>
        s.roe !== null && s.roe !== undefined && s.roe !== 0 && s.roe !== 15.0 ? s.roe : -1,
      render: (s) => {
        // Owner directive: "متظهرش أرقام وهمية" — ROE=15.0 placeholder أو 0 = "—"
        const val = s.roe;
        const isValid = val !== null && val !== undefined && val !== 0 && val !== 15.0;
        return <span className="font-mono text-xs">{isValid ? formatNumber(val, 1) : '—'}</span>;
      },
    },
    {
      key: 'rsi',
      header: 'RSI',
      align: 'left',
      sortable: true,
      filterable: true,
      editable: true,
      // (UNIFIED-TABLE-UPGRADE) sortValue: RSI (-1 if null/0)
      sortValue: (s) => (s.rsi !== null && s.rsi !== undefined && s.rsi > 0 ? s.rsi : -1),
      render: (s) => {
        // Owner directive: "متظهرش أرقام وهمية" — RSI=0 = "—"
        const val = s.rsi;
        const isValid = val !== null && val !== undefined && val > 0;
        return <span className="font-mono text-xs">{isValid ? formatNumber(val, 0) : '—'}</span>;
      },
    },
    {
      key: 'stock_state',
      header: t('screener.advanced.columns.stockState'),
      align: 'right',
      sortable: true,
      filterable: true,
      // (UNIFIED-TABLE-UPGRADE) sortValue: STATE_ORDER rank (99 if unknown)
      sortValue: (s) => STATE_ORDER[s.stock_state] ?? 99,
      filterValue: (s) => s.stock_state,
      render: (s) => <StateBadge state={s.stock_state} reason={s.stock_state_reason} />,
    },
    {
      key: 'above_ma_50',
      header: t('screener.advanced.columns.aboveMa50'),
      align: 'center',
      sortable: true,
      filterable: true,
      // (UNIFIED-TABLE-UPGRADE) sortValue: 1 if above, 0 if below
      sortValue: (s) => (s.above_ma_50 ? 1 : 0),
      filterValue: (s) => (s.above_ma_50 ? 'above' : 'below'),
      render: (s) =>
        s.above_ma_50 ? (
          <Badge className="bg-profit/10 text-profit border border-profit/20 border-profit text-xs px-2 py-0.5">
            {t('screener.advanced.stockStateColumn.above')}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs px-2 py-0.5">
            {t('screener.advanced.stockStateColumn.below')}
          </Badge>
        ),
    },
    // ── Liquidity radar columns (linked from /api/maker-radar) ──
    {
      key: 'maker_activity',
      header: 'نشاط الميكر',
      align: 'right',
      sortable: true,
      filterable: true,
      // (UNIFIED-TABLE-UPGRADE) sortValue: 3=high, 2=med, 1=low, 0=unknown (-1 if null)
      sortValue: (s) => {
        const a = s.maker_activity;
        if (!a) return -1;
        if (a === 'عالي' || a === 'مرتفع' || a.toLowerCase() === 'high') return 3;
        if (a === 'متوسط' || a.toLowerCase() === 'medium' || a.toLowerCase() === 'moderate') return 2;
        if (a === 'منخفض' || a.toLowerCase() === 'low') return 1;
        return 0;
      },
      filterValue: (s) => s.maker_activity || '—',
      render: (s) => <span className="text-xs">{s.maker_activity || '—'}</span>,
    },
    {
      key: 'buy_pct',
      header: 'ضغط الشراء %',
      align: 'left',
      sortable: true,
      filterable: true,
      // (UNIFIED-TABLE-UPGRADE) sortValue: buy_pct (-1 if null)
      sortValue: (s) => (s.buy_pct !== null && s.buy_pct !== undefined ? s.buy_pct : -1),
      render: (s) => (
        <span
          className={cn(
            'font-mono text-xs',
            (s.buy_pct ?? 0) >= 50 ? 'text-profit ' : 'text-muted-foreground',
          )}
        >
          {s.buy_pct !== null && s.buy_pct !== undefined ? formatNumber(s.buy_pct, 1) + '%' : '—'}
        </span>
      ),
    },
    {
      key: 'net_flow_egp',
      header: 'التدفق الصافي',
      align: 'left',
      sortable: true,
      filterable: true,
      // (UNIFIED-TABLE-UPGRADE) sortValue: net_flow_egp (-Infinity if null)
      sortValue: (s) =>
        s.net_flow_egp !== null && s.net_flow_egp !== undefined && Number.isFinite(s.net_flow_egp)
          ? s.net_flow_egp
          : -Infinity,
      render: (s) => (
        <span
          className={cn(
            'font-mono text-xs',
            (s.net_flow_egp ?? 0) > 0
              ? 'text-profit '
              : (s.net_flow_egp ?? 0) < 0
                ? 'text-loss '
                : 'text-muted-foreground',
          )}
        >
          {s.net_flow_egp !== null && s.net_flow_egp !== undefined ? formatEGP(s.net_flow_egp) : '—'}
        </span>
      ),
    },
    {
      key: 'accumulation',
      header: 'التجميع',
      align: 'right',
      sortable: true,
      filterable: true,
      // (UNIFIED-TABLE-UPGRADE) sortValue: 3=قوي, 2=تجميع, 1=محايد, 0=تصريف (-1 if null)
      sortValue: (s) => {
        const a = s.accumulation;
        if (!a) return -1;
        if (a.includes('تجميع قوي')) return 4;
        if (a.includes('تجميع')) return 3;
        if (a.includes('محايد')) return 2;
        if (a.includes('تصريف')) return 1;
        return 0;
      },
      filterValue: (s) => s.accumulation || '—',
      render: (s) => <span className="text-xs">{s.accumulation || '—'}</span>,
    },
    {
      key: 'life_cycle',
      header: 'دورة الحياة',
      align: 'right',
      sortable: true,
      filterable: true,
      // (UNIFIED-TABLE-UPGRADE) sortValue: life_cycle string (alphabetic via fallback)
      sortValue: (s) => s.life_cycle || '',
      filterValue: (s) => s.life_cycle || '—',
      render: (s) => <span className="text-xs">{s.life_cycle || '—'}</span>,
    },
    {
      key: 'expected',
      header: 'المتوقع',
      align: 'right',
      sortable: false,
      // (UNIFIED-TABLE-UPGRADE) sortValue: expected string (sortable via fallback)
      sortValue: (s) => s.expected || '',
      filterValue: (s) => s.expected || '—',
      render: (s) => (
        <span className="text-xs text-muted-foreground truncate block max-w-[180px]">
          {s.expected || '—'}
        </span>
      ),
    },
    // Entry/Stop/Target/R:R/Opportunity_Quality moved to front (after sparkline)
    // — duplicates removed (Owner directive: "حط Entry/Stop/Target/R/R في المقدمة")
  ];
}
