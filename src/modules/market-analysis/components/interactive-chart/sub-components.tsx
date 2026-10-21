import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

export function PlanLevel({ label, value, currencyLabel, color }: {
 label: string;
 value: number | null | undefined;
 currencyLabel: string;
 color: string;
}) {
 return (
 <div className="flex flex-col items-center p-2 rounded-lg bg-card border border-border/50">
 <span className="text-xs text-muted-foreground">{label}</span>
 <span className={cn('font-mono font-bold text-sm', color)}>
 {value !== null && value !== undefined && value > 0
 ? `${(value ?? 0).toFixed(2)} ${currencyLabel}`
 : '— بيانات غير متاحة'}
 </span>
 </div>
 );
}

export function ReasonCard({ label, value, positive, negative }: {
 label: string;
 value: string;
 positive?: boolean;
 negative?: boolean;
}) {
 return (
 <div className={cn(
 'p-2 rounded-lg border text-center',
 positive
 ? 'bg-profit/10 border-profit'
 : negative
 ? 'bg-loss/10 border-loss'
 : 'bg-muted/30 border-border'
 )}>
 <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
 <div className={cn(
 'text-xs font-bold',
 positive ? 'text-profit' : negative ? 'text-loss' : 'text-foreground'
 )}>
 {value}
 </div>
 </div>
 );
}

export function DetailItem({ label, value }: { label: string; value: string | number | undefined | null }) {
 return (
 <div className="flex justify-between p-1.5 rounded bg-muted/30 border border-border/50">
 <span className="text-muted-foreground">{label}:</span>
 <span className="font-mono font-bold text-foreground">{value === undefined || value === null || value === '' ? '—' : String(value)}</span>
 </div>
 );
}

export function CollapsibleSection({
 currentIndicators,
 techScore,
 smcAnalysis,
}: {
 currentIndicators?: { rsi?: number; macd?: number; atr?: number };
 techScore?: number | null;
 smcAnalysis?: { bias_ar?: string };
}) {
 const [open, setOpen] = useState(false);
 return (
 <Collapsible open={open} onOpenChange={setOpen} className="border-t border-border rounded-xl border border-border bg-card overflow-hidden">
 <CollapsibleTrigger asChild>
 <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors">
 <div className="flex items-center gap-2">
 <Gauge className="w-4 h-4 text-muted-foreground" />
 <span className="text-xs font-bold">التفاصيل الفنية</span>
 <span className="text-xs text-muted-foreground">(للخبراء)</span>
 </div>
 <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
 </button>
 </CollapsibleTrigger>
 <CollapsibleContent>
 <div className="px-4 py-3 space-y-3 border-t border-border/50 bg-muted/20">
 {currentIndicators && (
 <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
 <DetailItem label="RSI (14)" value={currentIndicators.rsi?.toFixed(1)} />
 <DetailItem label="MACD" value={currentIndicators.macd?.toFixed(3)} />
 <DetailItem label="ATR" value={currentIndicators.atr?.toFixed(3)} />
 <DetailItem label="Tech Score" value={techScore?.toFixed(0)} />
 </div>
 )}
 {smcAnalysis?.bias_ar && (
 <div className="text-xs">
 <div className="font-bold mb-1 text-muted-foreground">تحليل SMC:</div>
 <div className="text-foreground">{smcAnalysis.bias_ar}</div>
 </div>
 )}
 {!currentIndicators && !smcAnalysis?.bias_ar && (
 <div className="text-xs text-muted-foreground">لا توجد تفاصيل فنية متاحة</div>
 )}
 </div>
 </CollapsibleContent>
 </Collapsible>
 );
}

// ─── ALPHA-CHART-MERGE-1: signal → Arabic translation (matches V40.2) ──────────
export function signalToArabic(signal: string | undefined | null): string {
 if (!signal) return '— بيانات غير متاحة';
 const s = signal.toUpperCase();
 if (s.includes('STRONG_BUY') || s.includes('INSTITUTIONAL')) return 'شراء قوي';
 if (s === 'BUY') return 'شراء';
 if (s === 'ACCUMULATE') return 'تجميع';
 if (s === 'HOLD' || s === 'WAIT') return 'انتظار';
 if (s === 'REDUCE') return 'تقليل';
 if (s === 'SELL') return 'تجنب';
 if (s === 'STRONG_SELL' || s === 'AVOID') return 'تجنب قوي';
 if (s.includes('KILL') || s.includes('REJECT')) return 'تجنب';
 return '— بيانات غير متاحة';

 return '— بيانات غير متاحة';
}
