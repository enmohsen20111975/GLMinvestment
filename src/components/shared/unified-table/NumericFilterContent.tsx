'use client';

import React from 'react';

// NumericFilterContent — extracted (Phase 3)

interface NumericFilterContentProps {
 colKey: string;
 distinctValues: string[];
 selectedSet?: Set<string>;
 rangeFilter?: RangeFilter;
 rangeDraft?: { min: string; max: string };
 onToggleValue: (colKey: string, value: string) => void;
 onSelectAll: (colKey: string, values: string[]) => void;
 onClearAll: (colKey: string) => void;
 onRangeDraftChange: (min: string, max: string) => void;
 onApplyRange: (colKey: string) => void;
}

type FilterMode = 'values' | 'range';

function NumericFilterContent({
 colKey, distinctValues, selectedSet, rangeFilter, rangeDraft,
 onToggleValue, onSelectAll, onClearAll, onRangeDraftChange, onApplyRange,
}: NumericFilterContentProps) {
 const [mode, setMode] = useState<FilterMode>('values');
 const [search, setSearch] = useState('');

 const filteredValues = distinctValues.filter(v =>
 !search || v.toLowerCase().includes(search.toLowerCase())
 );

 const currentDraft = rangeDraft || { min: '', max: '' };

 return (
 <>
 {/* Mode toggle */}
 <div className="flex gap-1 p-0.5 bg-muted/40 rounded text-xs">
 <button
 onClick={() => setMode('values')}
 className={cn(
 'flex-1 py-1 rounded transition-colors',
 mode === 'values' ? 'bg-background shadow-sm font-semibold' : 'text-muted-foreground'
 )}
 >
 قيم
 </button>
 <button
 onClick={() => setMode('range')}
 className={cn(
 'flex-1 py-1 rounded transition-colors',
 mode === 'range' ? 'bg-background shadow-sm font-semibold' : 'text-muted-foreground'
 )}
 >
 نطاق
 </button>
 </div>

 {rangeFilter && (rangeFilter.min != null || rangeFilter.max != null) && (
 <div className="text-xs bg-profit/10 text-profit px-2 py-1 rounded">
 فلتر النطاق نشط: {rangeFilter.min != null ? `≥ ${rangeFilter.min}` : ''} {rangeFilter.max != null ? `≤ ${rangeFilter.max}` : ''}
 </div>
 )}

 {mode === 'values' ? (
 <>
 <div className="relative">
 <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
 <input
 type="text"
 placeholder="بحث في القيم..."
 value={search}
 onChange={e => setSearch(e.target.value)}
 className="w-full h-7 pr-7 pl-2 text-xs rounded border border-border bg-background"
 />
 </div>
 <div className="flex gap-2 text-xs">
 <button onClick={() => onSelectAll(colKey, filteredValues)} className="text-primary hover:underline">
 تحديد الكل
 </button>
 <button onClick={() => onClearAll(colKey)} className="text-muted-foreground hover:text-foreground">
 إلغاء التحديد
 </button>
 </div>
 <div className="max-h-40 overflow-y-auto space-y-0.5 border border-border/50 rounded p-1 bg-background/50">
 {filteredValues.length === 0 ? (
 <div className="text-xs text-muted-foreground text-center py-2">لا توجد قيم</div>
 ) : filteredValues.map(v => {
 const checked = selectedSet?.has(v) ?? false;
 return (
 <label key={v} className="flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-muted/40 cursor-pointer text-xs">
 <Checkbox
 checked={checked}
 onCheckedChange={() => onToggleValue(colKey, v)}
 className="w-3 h-3"
 />
 <span className="font-mono truncate" dir="ltr">{v}</span>
 </label>
 );
 })}
 </div>
 </>
 ) : (
 <div className="space-y-2">
 <div className="grid grid-cols-2 gap-2">
 <div className="space-y-1">
 <Label className="text-xs text-muted-foreground">الأدنى (Min)</Label>
 <input
 type="number"
 placeholder="—"
 value={currentDraft.min}
 onChange={e => onRangeDraftChange(e.target.value, currentDraft.max)}
 className="w-full h-7 px-2 text-xs font-mono rounded border border-border bg-background"
 dir="ltr"
 />
 </div>
 <div className="space-y-1">
 <Label className="text-xs text-muted-foreground">الأعلى (Max)</Label>
 <input
 type="number"
 placeholder="—"
 value={currentDraft.max}
 onChange={e => onRangeDraftChange(currentDraft.min, e.target.value)}
 className="w-full h-7 px-2 text-xs font-mono rounded border border-border bg-background"
 dir="ltr"
 />
 </div>
 </div>
 <Button
 size="sm"
 className="w-full h-7 text-xs"
 onClick={() => onApplyRange(colKey)}
 >
 تطبيق
 </Button>
 {(currentDraft.min !== '' || currentDraft.max !== '') && (
 <div className="text-xs text-muted-foreground text-center">
 اضغط تطبيق لتفعيل النطاق
 </div>
 )}
 </div>
 )}
 </>
 );
}

