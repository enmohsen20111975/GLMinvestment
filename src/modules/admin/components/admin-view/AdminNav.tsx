/**
 * admin-view/AdminNav.tsx
 * ======================
 * Mobile + Desktop collapsible hub navigation. Renders the 5-6 hub cards
 * (health / maestro / data / users / telegram) with their nested tab list.
 *
 * Mobile (md:hidden): grid-cols-2 plastic cards with large icons + short labels;
 * expanded hub spans col-span-2 and reveals a 2-col tab grid.
 *
 * Desktop (md+): grid-cols-2 lg:grid-cols-3 cards with full labels + tab descriptions.
 *
 * Originally inlined inside AdminView's return JSX (lines ~1216-1362, ~146 LOC).
 */

'use client';

import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AdminTab, HubId, AdminHub } from './types';

interface AdminNavProps {
 hubs: AdminHub[];
 expandedHub: HubId | null;
 setExpandedHub: React.Dispatch<React.SetStateAction<HubId | null>>;
 activeTab: AdminTab;
 onTabSelect: (tab: AdminTab, hub: HubId) => void;
}

export function AdminNav({
 hubs,
 expandedHub,
 setExpandedHub,
 activeTab,
 onTabSelect,
}: AdminNavProps) {
 return (
 <div className="mb-6">
 {/* Mobile: Plastic cards grid (2 cols) */}
 <div className="md:hidden grid grid-cols-2 gap-2.5">
 {hubs.map(hub => {
 const isExpanded = expandedHub === hub.id;
 const hasActive = hub.tabs.some(t => t.id === activeTab);
 return (
 <div
 key={hub.id}
 className={cn(
 'rounded-2xl border-2 transition-all overflow-hidden shadow-sm',
 hub.accent,
 hasActive && 'ring-2 ring-primary/50 shadow-md',
 isExpanded && 'col-span-2'
 )}
 >
 <button
 type="button"
 onClick={() => setExpandedHub(prev => (prev === hub.id && !hasActive ? null : hub.id))}
 className="w-full flex items-center gap-2.5 px-3 py-3 text-right active:scale-[0.98] transition-transform"
 >
 <div className={cn(
 'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
 hasActive ? 'bg-primary text-primary-foreground' : 'bg-background/60'
 )}>
 {hub.icon}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-1.5">
 <span className="text-xs font-bold text-foreground truncate">{hub.shortLabel}</span>
 {hasActive && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />}
 </div>
 <span className="text-xs text-muted-foreground truncate block">{hub.tabs.length} أدوات</span>
 </div>
 {isExpanded
 ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
 : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
 </button>
 {isExpanded && (
 <div className="grid grid-cols-2 gap-1.5 p-2.5 pt-1 border-t border-border/30 bg-background/40">
 {hub.tabs.map(tab => (
 <button
 key={tab.id}
 onClick={() => onTabSelect(tab.id, hub.id)}
 className={cn(
 'flex flex-col items-start gap-1 p-2.5 rounded-xl text-right transition-all active:scale-95',
 activeTab === tab.id
 ? 'bg-primary text-primary-foreground shadow-sm'
 : 'bg-background/60 hover:bg-background border border-border/40'
 )}
 >
 <div className="flex items-center gap-1.5 w-full">
 {tab.icon}
 <span className="text-xs font-bold truncate">{tab.label}</span>
 {tab.count !== undefined && tab.count > 0 && (
 <span className="mr-auto bg-loss text-white rounded-full text-xs w-4 h-4 flex items-center justify-center font-bold shrink-0">
 {tab.count}
 </span>
 )}
 </div>
 {tab.desc && (
 <span className={cn(
 'text-xs leading-tight line-clamp-2',
 activeTab === tab.id ? 'text-primary-foreground/80' : 'text-muted-foreground'
 )}>
 {tab.desc}
 </span>
 )}
 </button>
 ))}
 </div>
 )}
 </div>
 );
 })}
 </div>

 {/* Desktop: Hubs with detailed tab cards */}
 <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 gap-3">
 {hubs.map(hub => {
 const isExpanded = expandedHub === hub.id;
 const hasActive = hub.tabs.some(t => t.id === activeTab);
 return (
 <div
 key={hub.id}
 className={cn(
 'rounded-xl border transition-all',
 hub.accent,
 hasActive && 'ring-1 ring-primary/40 shadow-sm'
 )}
 >
 <button
 type="button"
 onClick={() => setExpandedHub(prev => (prev === hub.id && !hasActive ? null : hub.id))}
 className="w-full flex items-center justify-between px-3.5 py-2.5 text-right hover:bg-accent/30 rounded-t-xl"
 >
 <span className="flex items-center gap-2 text-sm font-bold text-foreground">
 {hub.icon}
 {hub.label}
 {hasActive && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
 </span>
 <div className="flex items-center gap-2">
 <Badge variant="outline" className="text-xs py-0 h-4">{hub.tabs.length}</Badge>
 {isExpanded
 ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
 : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
 </div>
 </button>
 {isExpanded && (
 <div className="grid grid-cols-2 gap-1.5 p-2.5 pt-1.5 border-t border-border/30">
 {hub.tabs.map(tab => (
 <button
 key={tab.id}
 onClick={() => onTabSelect(tab.id, hub.id)}
 className={cn(
 'flex flex-col items-start gap-0.5 p-2 rounded-lg text-right transition-all',
 activeTab === tab.id
 ? 'bg-primary text-primary-foreground shadow-sm'
 : 'hover:bg-accent/40 border border-transparent hover:border-border/40'
 )}
 >
 <div className="flex items-center gap-1.5 w-full">
 {tab.icon}
 <span className="text-xs font-semibold truncate">{tab.label}</span>
 {tab.count !== undefined && tab.count > 0 && (
 <span className="mr-auto bg-loss text-white rounded-full text-xs w-4 h-4 flex items-center justify-center font-bold">
 {tab.count}
 </span>
 )}
 </div>
 {tab.desc && (
 <span className={cn(
 'text-xs leading-tight',
 activeTab === tab.id ? 'text-primary-foreground/80' : 'text-muted-foreground'
 )}>
 {tab.desc}
 </span>
 )}
 </button>
 ))}
 </div>
 )}
 </div>
 );
 })}
 </div>
 </div>
 );
}
