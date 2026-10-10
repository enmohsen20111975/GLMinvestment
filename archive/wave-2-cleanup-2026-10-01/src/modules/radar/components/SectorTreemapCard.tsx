'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Layers, RefreshCw } from 'lucide-react';

// ============================================================================
// SectorTreemapCard — خريطة سيولة القطاعات (Treemap بأسلوب المربعات)
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
    avg_turnover_20d: number;
    change_pct: number;
    roc_10d: number;
  }>;
}

const DIRECTION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  inflow: { bg: 'bg-emerald-500/80', text: 'text-white', border: 'border-emerald-600' },
  outflow: { bg: 'bg-rose-500/80', text: 'text-white', border: 'border-rose-600' },
  neutral: { bg: 'bg-amber-500/70', text: 'text-white', border: 'border-amber-600' },
};

function fmtMoney(n: number): string {
  if (n >= 1e9) return `${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n/1e6).toFixed(0)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(0)}K`;
  return n?.toFixed(0) || '—';
}

export function SectorTreemapCard() {
  const [data, setData] = useState<{ sectors: SectorData[]; total_turnover: number } | null>(null);
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
      console.error('SectorTreemapCard error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Layers className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-64 w-full rounded-lg" />
      </Card>
    );
  }

  if (!data || !data.sectors || data.sectors.length === 0) {
    return (
      <Card className="p-4 border-dashed">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Layers className="h-3.5 w-3.5" />
          <span>الرادار بيتسخن — حاول تاني بعد دقيقة</span>
        </div>
      </Card>
    );
  }

  const sectors = data.sectors.slice(0, 12);
  const maxTurnover = sectors[0]?.total_turnover || 1;
  const totalTurnover = data.total_turnover || 0;

  // Treemap layout: CSS flexbox with proportional flex-basis
  // Group into rows of ~33% height each
  const rows: SectorData[][] = [];
  let currentRow: SectorData[] = [];
  let currentSum = 0;
  for (const s of sectors) {
    const pct = (s.total_turnover / maxTurnover) * 100;
    currentRow.push(s);
    currentSum += pct;
    if (currentSum >= 100 || currentRow.length >= 4) {
      rows.push(currentRow);
      currentRow = [];
      currentSum = 0;
    }
  }
  if (currentRow.length > 0) rows.push(currentRow);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <div>
            <h4 className="text-sm font-semibold">خريطة سيولة القطاعات</h4>
            <p className="text-[10px] text-muted-foreground">حجم المربع = السيولة · اللون = الاتجاه · اضغط للتفاصيل</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            إجمالي: {fmtMoney(totalTurnover)} EGP
          </span>
          <button onClick={fetchData} className="text-muted-foreground hover:text-foreground" title="تحديث">
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Treemap — flexbox squares */}
      <div className="flex flex-col gap-1 h-80 rounded-lg overflow-hidden">
        {rows.map((row, rowIdx) => (
          <div key={rowIdx} className="flex gap-1 flex-1" style={{ minHeight: '0' }}>
            {row.map((sector) => {
              const pct = maxTurnover > 0 ? (sector.total_turnover / maxTurnover) * 100 : 0;
              const dir = DIRECTION_COLORS[sector.direction] || DIRECTION_COLORS.neutral;
              const isHovered = hoveredSector === sector.sector;
              const isSelected = selectedSector === sector.sector;
              const isDimmed = hoveredSector && !isHovered;
              const chg = sector.avg_change_pct;

              return (
                <div
                  key={sector.sector}
                  className={`relative rounded-md overflow-hidden cursor-pointer transition-all duration-300 ${dir.bg} ${dir.text} ${isHovered ? 'brightness-110 ring-2 ring-white/40 z-10' : ''} ${isDimmed ? 'opacity-40' : ''} ${isSelected ? 'ring-2 ring-primary z-10' : ''}`}
                  style={{ flex: `${Math.max(1, pct)} 1 0%`, minHeight: '0' }}
                  onMouseEnter={() => setHoveredSector(sector.sector)}
                  onMouseLeave={() => setHoveredSector(null)}
                  onClick={() => setSelectedSector(isSelected ? null : sector.sector)}
                  title={`${sector.sector} · ${sector.stocks_count} سهم · ${chg >= 0 ? '+' : ''}${chg.toFixed(1)}% · ${fmtMoney(sector.total_turnover)} EGP`}
                >
                  {/* Content — only show if wide enough */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-1.5">
                    {pct > 8 && (
                      <>
                        <span className="text-[10px] font-bold truncate w-full text-center" style={{ maxWidth: '120px' }}>
                          {sector.sector.length > 12 ? sector.sector.slice(0, 12) + '…' : sector.sector}
                        </span>
                        <span className="text-xs font-bold tabular-nums mt-0.5">{fmtMoney(sector.total_turnover)}</span>
                        <span className={`text-[9px] font-mono ${chg >= 0 ? 'text-emerald-100' : 'text-rose-100'}`}>
                          {chg >= 0 ? '+' : ''}{chg.toFixed(1)}%
                        </span>
                        <span className="text-[8px] opacity-70 mt-0.5">{sector.stocks_count} سهم</span>
                      </>
                    )}
                    {pct <= 8 && pct > 3 && (
                      <span className="text-[9px] font-bold truncate">{sector.sector.slice(0, 6)}</span>
                    )}
                  </div>
                  {/* Flow indicator */}
                  {pct > 5 && (
                    <div className="absolute top-1 right-1 text-[8px] opacity-60">
                      {sector.direction === 'inflow' ? '▲' : sector.direction === 'outflow' ? '▼' : '●'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 text-[10px]">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-emerald-500/80"></div>
          <span className="text-muted-foreground">دخول سيولة</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-rose-500/80"></div>
          <span className="text-muted-foreground">خروج سيولة</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-amber-500/70"></div>
          <span className="text-muted-foreground">محايد</span>
        </div>
      </div>

      {/* Selected sector detail — show stocks */}
      {selectedSector && (() => {
        const sector = sectors.find(s => s.sector === selectedSector);
        if (!sector || !sector.top_tickers || sector.top_tickers.length === 0) return null;
        return (
          <div className="mt-3 p-3 rounded-md bg-muted/30 border border-border/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold">أسهم قطاع: {selectedSector}</span>
              <Badge variant="outline" className="text-[9px]">{sector.stocks_count} سهم</Badge>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
              {sector.top_tickers.map((t, idx) => {
                const chg = t.change_pct;
                return (
                  <div key={idx} className="flex items-center gap-1.5 p-1.5 rounded bg-background/60 text-[10px]">
                    <span className="font-mono font-bold">{t.ticker}</span>
                    <span className={`font-mono ${chg >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {chg >= 0 ? '+' : ''}{chg.toFixed(1)}%
                    </span>
                    <span className="text-muted-foreground text-[9px]">{fmtMoney(t.avg_turnover_20d)}</span>
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
