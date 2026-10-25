'use client';

import React from 'react';

// PriceCell component — extracted (Phase 3)

function PriceCell({
 label,
 value,
 accent,
}: {
 label: string;
 value: string;
 accent: 'emerald' | 'rose' | 'zinc';
}) {
 const accentClasses = {
 emerald: 'text-profit',
 rose: 'text-loss',
 zinc: 'text-foreground',
 } as const;
 return (
 <div className="rounded-md bg-muted/40 p-2">
 <div className="text-xs text-muted-foreground">{label}</div>
 <div className={cn('font-mono font-bold text-sm', accentClasses[accent])}>{value}</div>
 </div>
 );
}

export default ExpertRecommendationsPanel;
