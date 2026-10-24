'use client';

// ============================================================================
// SectorHeatStrip.tsx — horizontal scrollable sector liquidity pills.
// Visual liquidity flow bar (animated gradient) + scrollable sector detail
// chips + hovered-sector detail panel.
// ============================================================================

import { useState } from 'react';
import { Layers } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { SectorHeatStripProps } from './types';

export function SectorHeatStrip({ sectors, loading }: SectorHeatStripProps) {
 const [hoveredSector, setHoveredSector] = useState<string | null>(null);

 if (loading) {
 return (
 <Card className="p-3">
 <div className="flex items-center gap-1.5 mb-2">
 <Layers className="h-4 w-4 text-muted-foreground" />
 <Skeleton className="h-6 w-40" />
 </div>
 <Skeleton className="h-16 w-full" />
 </Card>
 );
 }

 if (sectors.length === 0) return null;

 // Sort by turnover descending for visual hierarchy
 const sorted = [...sectors].sort((a, b) => b.totalTurnover - a.totalTurnover);
 const maxTurnover = Math.max(...sorted.map(s => s.totalTurnover), 1);
 const totalTurnover = sorted.reduce((s, sec) => s + sec.totalTurnover, 0);

 return (
 <Card className="p-3 overflow-hidden">
 {/* Header */}
 <div className="flex items-center justify-between mb-2">
 <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
 <Layers className="h-4 w-4" />
 <span className="font-semibold">حركة السيولة بين القطاعات</span>
 </div>
 <div className="text-xs text-muted-foreground">
 إجمالي: {maxTurnover > 1e9 ? (totalTurnover / 1e9).toFixed(1) + 'B' : (totalTurnover / 1e6).toFixed(0) + 'M'} EGP
 </div>
 </div>

 {/* Visual liquidity flow bar — animated gradient */}
 <div className="relative h-8 rounded-lg overflow-hidden flex">
 {sorted.map((s, i) => {
 const widthPct = (s.totalTurnover / maxTurnover) * 100;
 const chg = s.avgChange;
 const isInflow = chg > 0.5;
 const isOutflow = chg < -0.5;
 const isHovered = hoveredSector === s.sector;
 const isDimmed = hoveredSector && !isHovered;

 // Gradient based on direction
 const gradient = isInflow
 ? ''
 : isOutflow
 ? ''
 : '';

 return (
 <div
 key={s.sector}
 className={`relative flex-1 min-w-[20px] ${gradient} transition-all duration-300 ${isHovered ? 'brightness-110 scale-y-110' : ''} ${isDimmed ? 'opacity-40' : ''}`}
 style={{ flexGrow: widthPct, flexBasis: '0%' }}
 onMouseEnter={() => setHoveredSector(s.sector)}
 onMouseLeave={() => setHoveredSector(null)}
 title={`${s.sector} · ${s.totalStocks} سهم · ${chg >= 0 ? '+' : ''}${(chg ?? 0).toFixed(1)}% · سيولة ${(s.totalTurnover / 1e6).toFixed(0)}M EGP`}
 >
 {/* Animated shimmer for inflow sectors */}
 {isInflow && (
 <div className="absolute inset-0 from-transparent to-transparent animate-pulse" style={{ animationDuration: '2s' }} />
 )}
 {/* Sector label (only if wide enough) */}
 {widthPct > 8 && (
 <div className="absolute inset-0 flex items-center justify-center px-1">
 <span className="text-xs font-bold text-foreground truncate" style={{ maxWidth: `${widthPct * 4}px` }}>
 {s.sector.length > 8 ? s.sector.slice(0, 8) + '…' : s.sector}
 </span>
 </div>
 )}
 {/* Flow arrow for inflow/outflow */}
 {widthPct > 5 && (
 <div className="absolute top-0.5 left-1 text-[8px] text-foreground/70">
 {isInflow ? '▲' : isOutflow ? '▼' : '●'}
 </div>
 )}
 </div>
 );
 })}
 </div>

 {/* Sector details strip — scrollable */}
 <ScrollArea className="w-full mt-2">
 <div className="flex items-center gap-1 px-0.5 pb-1 min-w-max">
 {sorted.map((s) => {
 const chg = s.avgChange;
 const isInflow = chg > 0.5;
 const isOutflow = chg < -0.5;
 const isHovered = hoveredSector === s.sector;
 const isDimmed = hoveredSector && !isHovered;

 // Color coding
 const cls =
 isInflow ? 'bg-profit/10 text-profit border border-profit/20 border-profit/20 ' :
 isOutflow ? 'bg-loss/10 text-loss border border-loss/20 border-loss/20 ' :
 'bg-warning/10 text-warning dark:text-warning border border-warning/20 border-warning/20 ';

 return (
 <div
 key={s.sector}
 className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs transition-all duration-200 ${cls} ${isHovered ? 'scale-105 shadow-md ring-1 ring-primary/20' : ''} ${isDimmed ? 'opacity-50' : ''}`}
 onMouseEnter={() => setHoveredSector(s.sector)}
 onMouseLeave={() => setHoveredSector(null)}
 >
 <span className="font-medium truncate max-w-[100px]">{s.sector}</span>
 <span className="font-mono font-bold">
 {chg > 0 ? '+' : ''}{(chg ?? 0).toFixed(1)}%
 </span>
 <span className="text-[8px] opacity-60">
 {((s.totalTurnover ?? 0) / 1e6).toFixed(0)}M
 </span>
 {/* Mini flow indicator */}
 <span className={isInflow ? 'text-profit' : isOutflow ? 'text-loss' : 'text-warning'}>
 {isInflow ? '→' : isOutflow ? '←' : '•'}
 </span>
 </div>
 );
 })}
 </div>
 </ScrollArea>

 {/* Hovered sector detail */}
 {hoveredSector && (
 <div className="mt-1.5 p-2 rounded-md bg-muted/40 text-xs flex items-center justify-between">
 {(() => {
 const s = sorted.find(sec => sec.sector === hoveredSector);
 if (!s) return null;
 const pct = totalTurnover > 0 ? ((s.totalTurnover / totalTurnover) * 100).toFixed(1) : '0';
 return (
 <>
 <span className="font-medium">{s.sector}</span>
 <span className="text-muted-foreground">
 {s.totalStocks} سهم · صاعد {s.advancers} · هابط {s.decliners} · سيولة {pct}% من السوق
 </span>
 </>
 );
 })()}
 </div>
 )}
 </Card>
 );
}
