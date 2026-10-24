/**
 * admin-view/AdminHeader.tsx
 * =========================
 * Top header of the admin dashboard: logo (Shield icon, color-coded by
 * healthScore) + page title + system status text + critical/warning count
 * badges + "تحديث" refresh button.
 *
 * Originally inlined inside AdminView's return JSX (lines ~1104-1152).
 */

'use client';

import React from 'react';
import { Shield, AlertTriangle, AlertCircle, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AdminHeaderProps {
 healthScore: number;
 criticalCount: number;
 warningCount: number;
 statsLoading: boolean;
 onRefresh: () => void;
}

export function AdminHeader({
 healthScore,
 criticalCount,
 warningCount,
 statsLoading,
 onRefresh,
}: AdminHeaderProps) {
 return (
 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
 <div className="flex items-center gap-3">
 <div className={cn(
 "w-12 h-12 rounded-xl flex items-center justify-center",
 healthScore >= 80 ? "bg-profit/10" :
 healthScore >= 50 ? "bg-warning/10" :
 "bg-loss/10"
 )}>
 <Shield className={cn(
 "w-6 h-6",
 healthScore >= 80 ? "text-profit" :
 healthScore >= 50 ? "text-warning" :
 "text-loss"
 )} />
 </div>
 <div>
 <h1 className="text-xl font-bold text-foreground">لوحة التحكم</h1>
 <p className="text-sm text-muted-foreground">
 حالة النظام: {healthScore >= 80 ? 'ممتاز' : healthScore >= 50 ? 'يحتاج مراجعة' : 'يوجد مشاكل'}
 </p>
 </div>
 </div>

 <div className="flex items-center gap-2">
 {criticalCount > 0 && (
 <Badge variant="destructive" className="gap-1">
 <AlertTriangle className="w-3 h-3" />
 {criticalCount} مشكلة
 </Badge>
 )}
 {warningCount > 0 && (
 <Badge variant="outline" className="gap-1 border-warning text-warning">
 <AlertCircle className="w-3 h-3" />
 {warningCount} تحذير
 </Badge>
 )}
 <Button
 variant="outline"
 size="sm"
 onClick={onRefresh}
 disabled={statsLoading}
 className="gap-1"
 >
 <RefreshCw className={cn("w-4 h-4", statsLoading && "animate-spin")} />
 تحديث
 </Button>
 </div>
 </div>
 );
}
