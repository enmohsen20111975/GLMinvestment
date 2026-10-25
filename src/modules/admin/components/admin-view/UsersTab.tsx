/**
 * admin-view/UsersTab.tsx
 * ======================
 * The `users` tab — analytics view. Renders:
 *  - 4 KPI cards (today's page views / unique users / events / errors).
 *  - Traffic chart (30-day AreaChart with errors overlay).
 *  - "Top sections" card.
 *  - <UsersManagement /> (lazy-loaded admin panel for user CRUD).
 *
 * Originally inlined inside AdminView (lines ~1727-1819).
 */

'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Activity, Zap } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LazyTabLoader } from '@/components/shared/LazyTabLoader';
import { withErrorBoundary } from '@/components/shared/ErrorBoundary';

const UsersManagement = withErrorBoundary(
 dynamic(
 () => import('@/modules/admin/components/UsersManagement').then(m => ({ default: m.UsersManagement })),
 { ssr: false, loading: () => <LazyTabLoader label="إدارة المستخدمين" /> }
 ),
 'إدارة المستخدمين',
);

interface UsersTabProps {
 analyticsData: any;
 analyticsLoading: boolean;
}

export function UsersTab({ analyticsData, analyticsLoading }: UsersTabProps) {
 return (
 <div className="space-y-6">
 {analyticsData && (
 <div className="space-y-6">
 <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
 <Card>
 <CardContent className="p-4 text-center">
 <div className="text-lg md:text-xl lg:text-2xl font-bold">{analyticsData.summary.today_page_views}</div>
 <div className="text-xs text-muted-foreground">مشاهدات اليوم</div>
 </CardContent>
 </Card>
 <Card>
 <CardContent className="p-4 text-center">
 <div className="text-lg md:text-xl lg:text-2xl font-bold text-profit">{analyticsData.summary.today_unique_users}</div>
 <div className="text-xs text-muted-foreground">مستخدمون نشطون</div>
 </CardContent>
 </Card>
 <Card>
 <CardContent className="p-4 text-center">
 <div className="text-lg md:text-xl lg:text-2xl font-bold text-warning">{analyticsData.summary.today_events}</div>
 <div className="text-xs text-muted-foreground">أحداث اليوم</div>
 </CardContent>
 </Card>
 <Card>
 <CardContent className="p-4 text-center">
 <div className="text-lg md:text-xl lg:text-2xl font-bold text-loss">{analyticsData.summary.today_errors}</div>
 <div className="text-xs text-muted-foreground">أخطاء اليوم</div>
 </CardContent>
 </Card>
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
 <Card className="lg:col-span-2">
 <CardHeader>
 <CardTitle className="text-base flex items-center gap-2">
 <Activity className="w-4 h-4" />
 حركة المرور (30 يوم)
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="h-64">
 <ResponsiveContainer width="100%" height="100%">
 <AreaChart data={analyticsData.daily_traffic}>
 <defs>
 <linearGradient id="colorPv" x1="0" y1="0" x2="0" y2="1">
 <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
 <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
 </linearGradient>
 <linearGradient id="colorErr" x1="0" y1="0" x2="0" y2="1">
 <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
 <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
 </linearGradient>
 </defs>
 <CartesianGrid strokeDasharray="3 3" />
 <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
 <YAxis tick={{ fontSize: 11 }} />
 <Tooltip />
 <Legend />
 <Area type="monotone" dataKey="page_views" stroke="#3b82f6" fillOpacity={1} fill="url(#colorPv)" name="مشاهدات" />
 <Area type="monotone" dataKey="errors" stroke="#ef4444" fillOpacity={1} fill="url(#colorErr)" name="أخطاء" />
 </AreaChart>
 </ResponsiveContainer>
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardHeader>
 <CardTitle className="text-base flex items-center gap-2">
 <Zap className="w-4 h-4" />
 الأقسام الأكثر زيارة
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="space-y-2">
 {analyticsData.page_views_by_section.slice(0, 8).map((section: any) => (
 <div key={section.view} className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded">
 <span className="truncate ml-2">{section.view || 'غير محدد'}</span>
 <Badge variant="secondary" className="text-xs">{section.count}</Badge>
 </div>
 ))}
 {analyticsData.page_views_by_section.length === 0 && (
 <p className="text-xs text-muted-foreground">لا توجد بيانات</p>
 )}
 </div>
 </CardContent>
 </Card>
 </div>
 </div>
 )}
 <UsersManagement />
 </div>
 );
}
