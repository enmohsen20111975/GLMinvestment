'use client';

import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

// TextFilterContent — extracted (Phase 3)

interface TextFilterContentProps {
 colKey: string;
 distinctValues: string[];
 selectedSet?: Set<string>;
 onToggleValue: (colKey: string, value: string) => void;
 onSelectAll: (colKey: string, values: string[]) => void;
 onClearAll: (colKey: string) => void;
}

function TextFilterContent({
 colKey, distinctValues, selectedSet,
 onToggleValue, onSelectAll, onClearAll,
}: TextFilterContentProps) {
 const [search, setSearch] = useState('');
 const filteredValues = distinctValues.filter(v =>
 !search || v.toLowerCase().includes(search.toLowerCase())
 );

 return (
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
 {selectedSet && selectedSet.size > 0 && (
 <span className="text-muted-foreground mr-auto">
 {selectedSet.size} / {distinctValues.length}
 </span>
 )}
 </div>
 <div className="max-h-48 overflow-y-auto space-y-0.5 border border-border/50 rounded p-1 bg-background/50">
 {filteredValues.length === 0 ? (
 <div className="text-xs text-muted-foreground text-center py-2">لا توجد قيم مطابقة</div>
 ) : filteredValues.map(v => {
 const checked = selectedSet?.has(v) ?? false;
 return (
 <label key={v} className="flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-muted/40 cursor-pointer text-xs">
 <Checkbox
 checked={checked}
 onCheckedChange={() => onToggleValue(colKey, v)}
 className="w-3 h-3"
 />
 <span className="truncate">{v}</span>
 </label>
 );
 })}
 </div>
 </>
 );
}

export default TextFilterContent;
