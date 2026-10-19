'use client';

import React from 'react';
import { X, ExternalLink, TrendingUp, AlertTriangle, Flame, Activity } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';

export interface WhatsAppToastProps {
 id: string | number;
 title: string;
 message: string;
 ticker?: string;
 type?: string;
 severity?: string;
 timestamp?: string;
 onClose: () => void;
}

export function WhatsAppToast({
 id,
 title,
 message,
 ticker,
 type = 'radar_opportunity',
 severity = 'info',
 timestamp = 'الآن',
 onClose,
}: WhatsAppToastProps) {
 const { setCurrentView } = useAppStore();

 const isExit = type?.includes('exit') || severity === 'critical' || severity === 'warning';
 const isExplosive = type?.includes('explosive') || type?.includes('flare');
 const isVolume = type?.includes('volume');

 const handleOpenStock = () => {
 onClose();
 // تحويل المستخدم لعرض التوقعات أو الشارت
 setCurrentView('recommendations');
 };

 return (
 <div
 dir="rtl"
 className={cn(
 'w-full max-w-sm sm:max-w-md rounded-2xl p-3.5 shadow-2xl transition-all duration-300 pointer-events-auto',
 'bg-background/95 dark:bg-zinc-900/95 backdrop-blur-md border',
 isExit
 ? 'border-loss/40 border-r-4 border-r-rose-500 shadow-rose-500/10'
 : isExplosive
 ? 'border-warning/40 border-r-4 border-r-amber-500 shadow-amber-500/10'
 : 'border-profit/40 border-r-4 border-r-emerald-500 shadow-emerald-500/10'
 )}
 >
 {/* Top Header: Sender Bar (WhatsApp/Messenger Style) */}
 <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-border/50">
 <div className="flex items-center gap-2">
 {/* Avatar / Icon with glowing status dot */}
 <div className="relative">
 <div
 className={cn(
 'w-7 h-7 rounded-full flex items-center justify-center text-foreground shadow-sm',
 isExit
 ? 'bg-gradient-to-tr from-loss to-loss'
 : isExplosive
 ? 'bg-gradient-to-tr from-warning to-warning'
 : 'bg-gradient-to-tr from-profit to-profit'
 )}
 >
 {isExit ? (
 <AlertTriangle className="w-3.5 h-3.5" />
 ) : isExplosive ? (
 <Flame className="w-3.5 h-3.5" />
 ) : isVolume ? (
 <Activity className="w-3.5 h-3.5" />
 ) : (
 <TrendingUp className="w-3.5 h-3.5" />
 )}
 </div>
 {/* Live Green Online Dot (WhatsApp style) */}
 <span
 className={cn(
 'absolute -bottom-0.5 -left-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-background',
 isExit ? 'bg-loss' : 'bg-profit'
 )}
 />
 </div>

 <div>
 <div className="flex items-center gap-1.5">
 <span className="text-xs font-bold text-foreground">
 {isExit ? 'إنذار رادار الأسهم' : 'رادار الفرص المباشر'}
 </span>
 <span className="text-xs px-1.5 py-0.2 rounded-full bg-profit/10 text-profit font-medium">
 ✓ موثق
 </span>
 </div>
 </div>
 </div>

 <div className="flex items-center gap-2">
 <span className="text-xs text-muted-foreground font-mono">{timestamp}</span>
 <button
 onClick={onClose}
 className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
 aria-label="إغلاق"
 >
 <X className="w-3.5 h-3.5" />
 </button>
 </div>
 </div>

 {/* Main Message Body */}
 <div className="pr-1 pl-1">
 <div className="flex items-center gap-2 mb-1">
 {ticker && (
 <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-black bg-primary/10 text-primary border border-primary/20">
 {ticker}
 </span>
 )}
 <h4 className="text-xs sm:text-sm font-bold text-foreground leading-tight">
 {title}
 </h4>
 </div>
 <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mt-0.5">
 {message}
 </p>
 </div>

 {/* Actions (Quick Reply / View Stock) */}
 <div className="flex items-center justify-end gap-2 mt-2.5 pt-2 border-t border-border/40">
 <button
 onClick={onClose}
 className="text-xs px-2.5 py-1 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
 >
 تجاهل
 </button>
 <button
 onClick={handleOpenStock}
 className={cn(
 'inline-flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-lg text-foreground shadow-sm transition-all',
 isExit
 ? 'bg-loss hover:bg-loss'
 : 'bg-profit hover:bg-profit'
 )}
 >
 <ExternalLink className="w-3 h-3" />
 عرض في الرادار
 </button>
 </div>
 </div>
 );
}
