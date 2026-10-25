/**
 * admin-view/QuickAccessBar.tsx
 * ============================
 * Quick-access shortcut bar rendered above the hub nav: contains
 * "إدارة وحذف الأخبار" (newspaper, opens news-control tab in data hub),
 * "لوحة المراقبة" (dashboard), "محرك البيانات" (data-engine),
 * "قواعد البيانات" (databases), "المستخدمين" (users).
 *
 * Originally inlined inside AdminView's return JSX (lines ~1155-1210).
 */

'use client';

import React from 'react';
import { Activity, Database, Newspaper, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AdminTab, HubId } from './types';

interface QuickAccessBarProps {
 activeTab: AdminTab;
 onSelect: (tab: AdminTab, hub: HubId) => void;
}

export function QuickAccessBar({ activeTab, onSelect }: QuickAccessBarProps) {
 return (
 <div className="flex items-center gap-2 mb-6 p-3 rounded-xl bg-card border border-border shadow-sm flex-wrap">
 <span className="text-xs font-bold text-muted-foreground ml-1">وصول مباشر:</span>
 <Button
 variant={activeTab === 'news-control' ? 'default' : 'outline'}
 size="sm"
 onClick={() => onSelect('news-control', 'data')}
 className={cn(
 "gap-2 h-9 text-xs font-bold transition-all",
 activeTab === 'news-control'
 ? "bg-primary text-primary-foreground shadow-md"
 : "border-primary/20 text-primary hover:bg-primary/10"
 )}
 >
 <Newspaper className="w-4 h-4" />
 <span>إدارة وحذف الأخبار</span>
 <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 bg-primary/20 text-primary">
 جديد
 </Badge>
 </Button>
 <Button
 variant={activeTab === 'dashboard' ? 'default' : 'ghost'}
 size="sm"
 onClick={() => onSelect('dashboard', 'health')}
 className="gap-1.5 h-9 text-xs"
 >
 <Activity className="w-3.5 h-3.5" />
 <span>لوحة المراقبة</span>
 </Button>
 <Button
 variant={activeTab === 'data-engine' ? 'default' : 'ghost'}
 size="sm"
 onClick={() => onSelect('data-engine', 'maestro')}
 className="gap-1.5 h-9 text-xs font-semibold text-profit hover:text-profit"
 >
 <Database className="w-3.5 h-3.5" />
 <span>محرك البيانات</span>
 </Button>
 <Button
 variant={activeTab === 'databases' ? 'default' : 'ghost'}
 size="sm"
 onClick={() => onSelect('databases', 'data')}
 className="gap-1.5 h-9 text-xs"
 >
 <Database className="w-3.5 h-3.5" />
 <span>قواعد البيانات</span>
 </Button>
 <Button
 variant={activeTab === 'users' ? 'default' : 'ghost'}
 size="sm"
 onClick={() => onSelect('users', 'users')}
 className="gap-1.5 h-9 text-xs"
 >
 <Users className="w-3.5 h-3.5" />
 <span>المستخدمين</span>
 </Button>
 </div>
 );
}
