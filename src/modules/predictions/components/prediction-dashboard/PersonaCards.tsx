/**
 * prediction-dashboard/PersonaCards.tsx
 * ===================================
 * Persona breakdown cards showcase (UNIFIED — balanced only).
 *
 * KILL-MAESTRO (2026-08-31): V40.2 = balanced فقط — لا كروت للمضارب/المستثمر.
 * Only renders the 'balanced' persona card with its stats. Clicking the card
 * toggles `selectedPersona` between 'all' and 'balanced' (used to filter the
 * historical predictions table below).
 *
 * Originally inlined at lines 1401-1458 of PredictionTrackingDashboard.tsx
 * (~58 LOC).
 */

'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PERSONA_CONFIG } from './constants';
import type { PersonaId, PersonaStats } from './types';

interface PersonaCardsProps {
 selectedPersona: PersonaId;
 setSelectedPersona: React.Dispatch<React.SetStateAction<PersonaId>>;
 computedStatsByPersona: Record<'gambler' | 'balanced' | 'conservative', PersonaStats>;
}

export function PersonaCards({
 selectedPersona,
 setSelectedPersona,
 computedStatsByPersona,
}: PersonaCardsProps) {
 return (
 <div className="grid grid-cols-1 gap-4">
 {(['balanced'] as const).map((pId) => {
 const cfg = PERSONA_CONFIG[pId];
 const pStats = computedStatsByPersona[pId];
 const Icon = cfg.icon; // preserved from original (lucide-react icon reference)
 void Icon;
 const isSelected = selectedPersona === pId;

 return (
 <button
 key={`persona-card-${pId}`}
 onClick={() => setSelectedPersona(isSelected ? 'all' : pId)}
 className={cn(
 'text-right p-4 rounded-2xl border transition-all duration-200 relative overflow-hidden bg-card flex flex-col justify-between group',
 cfg.border,
 isSelected ? 'ring-2 ring-profit shadow-lg shadow-emerald-500/10 bg-profit/5' : 'hover:shadow-md'
 )}
 >
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <span className="text-2xl">{cfg.emoji}</span>
 <div>
 <h3 className="font-black text-base text-foreground flex items-center gap-1.5">
 {cfg.nameAr}
 </h3>
 <p className="text-xs text-muted-foreground">{cfg.horizonAr}</p>
 </div>
 </div>
 <Badge variant="outline" className={cn('text-xs font-bold', cfg.badgeBg)}>
 {(pStats.winRate ?? 0).toFixed(1)}% نجاح
 </Badge>
 </div>

 {/* Persona Stats Grid */}
 <div className="grid grid-cols-3 gap-2 text-center my-2 p-2 bg-muted/40 rounded-xl border border-border/50">
 <div>
 <div className="text-xs text-muted-foreground">التوقعات</div>
 <div className="font-mono font-bold text-xs">{pStats.total}</div>
 </div>
 <div>
 <div className="text-xs text-muted-foreground">صفقات ناجحة</div>
 <div className="font-mono font-bold text-xs text-profit ">{pStats.wins}</div>
 </div>
 <div>
 <div className="text-xs text-muted-foreground">صفقات معلقة</div>
 <div className="font-mono font-bold text-xs text-warning ">{pStats.pending}</div>
 </div>
 </div>

 <div className="flex items-center justify-between text-xs font-bold text-muted-foreground pt-1 border-t border-border/40 mt-1">
 <span>متوسط الربح: <strong className="text-profit ">+{(pStats.avgWinPct ?? 0).toFixed(1)}%</strong></span>
 <span>تصفية بالجدول ↓</span>
 </div>
 </button>
 );
 })}
 </div>
 );
}
