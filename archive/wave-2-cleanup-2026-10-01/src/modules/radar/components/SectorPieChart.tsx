'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PieChart as PieChartIcon, Layers } from 'lucide-react';

// ============================================================================
// SectorPieChart — خريطة قطاعات دائرية مع أسهم كل قطاع
// ============================================================================

interface SectorData {
  sector: string;
  stocks_count: number;
  total_turnover: number;
  avg_change_pct: number;
  direction: string;
  color: string;
  top_tickers: Array<{
    ticker: string;
    name_ar: string;
    change_pct: number;
    avg_turnover_20d: number;
  }>;
}

const SECTOR_COLORS = [
  '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
  '#ec4899', '#84cc16', '#f97316', '#6366f1', '#14b8a6',
  '#d946ef', '#eab308', '#3b82f6', '#22c55e', '#a855f7',
];

export function SectorPieChart() {
  const [data, setData] = useState<{ sectors: SectorData[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredSector, setHoveredSector] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/maker-radar/sector-treemap?days=30', { cache: 'no-store' });
      const json = await res.json();
      if (json.success) setData(json);
    } catch (e) {
      console.error('SectorPieChart fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <PieChartIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-48 w-full rounded-lg" />
      </Card>
    );
  }

  if (!data || !data.sectors || data.sectors.length === 0) {
    return (
      <Card className="p-4 border-dashed">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <PieChartIcon className="h-3.5 w-3.5" />
          <span>الرادار بيتسخن — حاول تاني بعد شوية</span>
        </div>
      </Card>
    );
  }

  const sectors = data.sectors.slice(0, 12);
  const totalTurnover = sectors.reduce((s, sec) => s + sec.total_turnover, 0);

  // SVG Pie Chart
  const radius = 80;
  const cx = 100;
  const cy = 100;
  let cumulativeAngle = 0;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <PieChartIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <div>
            <h4 className="text-sm font-semibold">توزيع السيولة على القطاعات</h4>
            <p className="text-[10px] text-muted-foreground">اضغط على قطاع لرؤية أسهمه</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-center">
        {/* SVG Pie Chart */}
        <div className="relative flex-shrink-0">
          <svg width="200" height="200" viewBox="0 0 200 200" className="transform -rotate-90">
            {sectors.map((sector, i) => {
              const pct = totalTurnover > 0 ? (sector.total_turnover / totalTurnover) : 0;
              const angle = pct * 360;
              const startAngle = cumulativeAngle;
              const endAngle = cumulativeAngle + angle;
              cumulativeAngle = endAngle;

              const startRad = (startAngle * Math.PI) / 180;
              const endRad = (endAngle * Math.PI) / 180;
              const x1 = cx + radius * Math.cos(startRad);
              const y1 = cy + radius * Math.sin(startRad);
              const x2 = cx + radius * Math.cos(endRad);
              const y2 = cy + radius * Math.sin(endRad);
              const largeArc = angle > 180 ? 1 : 0;

              const isHovered = hoveredSector === sector.sector;
              const isSelected = selectedSector === sector.sector;
              const opacity = hoveredSector && !isHovered ? 0.3 : 1;
              const r = isHovered || isSelected ? radius + 5 : radius;

              const sx1 = cx + r * Math.cos(startRad);
              const sy1 = cy + r * Math.sin(startRad);
              const sx2 = cx + r * Math.cos(endRad);
              const sy2 = cy + r * Math.sin(endRad);

              return (
                <path
                  key={sector.sector}
                  d={`M ${cx} ${cy} L ${sx1} ${sy1} A ${r} ${r} 0 ${largeArc} 1 ${sx2} ${sy2} Z`}
                  fill={SECTOR_COLORS[i % SECTOR_COLORS.length]}
                  opacity={opacity}
                  className="cursor-pointer transition-all duration-200"
                  style={{ filter: isHovered ? 'brightness(1.2)' : 'none' }}
                  onMouseEnter={() => setHoveredSector(sector.sector)}
                  onMouseLeave={() => setHoveredSector(null)}
                  onClick={() => setSelectedSector(isSelected ? null : sector.sector)}
                />
              );
            })}
            {/* Center circle */}
            <circle cx={cx} cy={cy} r={35} fill="white" className="dark:fill-background" />
          </svg>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[10px] text-muted-foreground">إجمالي السيولة</span>
            <span className="text-sm font-bold">
              {totalTurnover >= 1e9 ? (totalTurnover / 1e9).toFixed(1) + 'B' : (totalTurnover / 1e6).toFixed(0) + 'M'}
            </span>
            <span className="text-[9px] text-muted-foreground">EGP</span>
          </div>
        </div>

        {/* Sector list */}
        <div className="flex-1 space-y-1 max-h-48 overflow-y-auto w-full">
          {sectors.map((sector, i) => {
            const pct = totalTurnover > 0 ? (sector.total_turnover / totalTurnover * 100).toFixed(1) : '0';
            const isHovered = hoveredSector === sector.sector;
            const isSelected = selectedSector === sector.sector;
            const dirEmoji = sector.direction === 'inflow' ? '🟢' : sector.direction === 'outflow' ? '🔴' : '🟡';
            const chg = sector.avg_change_pct;

            return (
              <div
                key={sector.sector}
                className={`flex items-center justify-between p-1.5 rounded-md cursor-pointer transition-all ${isSelected ? 'bg-muted/60 ring-1 ring-primary/30' : isHovered ? 'bg-muted/40' : ''}`}
                onMouseEnter={() => setHoveredSector(sector.sector)}
                onMouseLeave={() => setHoveredSector(null)}
                onClick={() => setSelectedSector(isSelected ? null : sector.sector)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: SECTOR_COLORS[i % SECTOR_COLORS.length] }} />
                  <span className="text-xs font-medium truncate">{sector.sector}</span>
                  <span className="text-[9px] text-muted-foreground">{sector.stocks_count} سهم</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[9px] text-muted-foreground">{pct}%</span>
                  <span className={`text-[10px] font-mono font-bold ${chg >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {chg >= 0 ? '+' : ''}{chg.toFixed(1)}%
                  </span>
                  <span className="text-[10px]">{dirEmoji}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected sector detail — show stocks in that sector */}
      {selectedSector && (() => {
        const sector = sectors.find(s => s.sector === selectedSector);
        if (!sector || !sector.top_tickers || sector.top_tickers.length === 0) return null;
        return (
          <div className="mt-3 p-3 rounded-md bg-muted/30 border border-border/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold">أسهم قطاع: {selectedSector}</span>
              <Badge variant="outline" className="text-[9px]">{sector.top_tickers.length} أعلى سيولة</Badge>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
              {sector.top_tickers.map((t, idx) => {
                const color = SECTOR_COLORS[sectors.indexOf(sector) % SECTOR_COLORS.length];
                const chg = t.change_pct;
                return (
                  <div key={idx} className="flex items-center gap-1.5 p-1.5 rounded bg-background/60 text-[10px]">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="font-mono font-bold">{t.ticker}</span>
                    <span className={`font-mono ${chg >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {chg >= 0 ? '+' : ''}{chg.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </Card>
  );
}
