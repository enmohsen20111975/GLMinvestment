'use client';

// ============================================================================
// RadarSection.tsx — wrapper Card around StockTable for a single radar path.
// Renders the section header (title/subtitle/icon/accent badge + publish
// button) and delegates the actual table to StockTable.
// ============================================================================

import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { StockTable } from './StockTable';
import { accentClasses, fmtNum } from './helpers';
import type { RadarSectionProps } from './types';

export const RadarSection = memo(function RadarSection({
 title, subtitle, icon, accent, stocks, market,
 sectorForTicker, changePercentForTicker, stockInfoForTicker, predictionForTicker, onSelect, onTrackToggle,
}: RadarSectionProps) {
 const a = accentClasses[accent];
 return (
 <Card className={`overflow-hidden ${a.card}`}>
 <div className={`flex items-center justify-between p-3 md:p-4 ${a.headerBg} border-b ${a.border}`}>
 <div className="flex items-center gap-2">
 <div className={`${a.iconColor}`}>{icon}</div>
 <div>
 <h4 className="text-sm md:text-base font-semibold">{title}</h4>
 <p className="text-xs text-muted-foreground">{subtitle}</p>
 </div>
 </div>
 <div className="flex items-center gap-2">
 <Badge variant="secondary" className="text-xs">
 {stocks.length} أسهم
 </Badge>
 <div className="hidden sm:inline-flex items-center gap-1.5 text-xs text-profit bg-profit/10 border border-profit/20 px-2 py-0.5 rounded-full font-medium">
 <span className="w-1.5 h-1.5 rounded-full bg-profit animate-pulse" />
 <span>بث الأسعار حي</span>
 </div>
 <UnifiedPublishButton
 variant="outline"
 size="sm"
 title={`رادار الميكرز — ${title}`}
 content={`رادار الميكرز — ${title}\n${stocks.map((s, i) => `${i + 1}. ${s.ticker} — ${fmtNum(s.current_price)} EGP${s.maker_activity ? ` — ميكرز: ${s.maker_activity}` : ''}${s.accumulation ? ` — ${s.accumulation}` : ''}`).join('\n')}`}
 filename={`maker-radar-${accent}-${Date.now()}`}
 hashtags={['EGX', 'رادار_الميكرز', 'بورصة_مصر']}
 triggerLabel="نشر الرادار"
 />
 </div>
 </div>

 <div className="p-2 md:p-3">
 <StockTable
 stocks={stocks}
 accent={accent}
 market={market}
 sectorForTicker={sectorForTicker}
 changePercentForTicker={changePercentForTicker}
 stockInfoForTicker={stockInfoForTicker}
 predictionForTicker={predictionForTicker}
 onSelect={onSelect}
 onTrackToggle={onTrackToggle}
 />
 </div>
 </Card>
 );
});
