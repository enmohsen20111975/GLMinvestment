/**
 * paper-trading-ws/HistoryAndPerformance.tsx
 * ===========================================
 * Tabs widget — closed-orders history table (with "load more") + equity
 * performance chart (Recharts line chart).
 *
 * Extracted from PaperTradingWorkstation.tsx (1,550 LOC) in Task F-Phase3-FinalPush.
 */

'use client';

import React from 'react';
import { Clock, TrendingUp } from 'lucide-react';
import { WidgetCard } from '@/components/shared/WidgetCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fmtPrice } from '@/lib/utils';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  ASSET_TYPE_LABELS,
  CLOSE_REASON_BADGE_CLASS,
  CLOSE_REASON_LABELS_AR,
  HISTORY_PAGE_SIZE,
  type AssetType,
  type CloseReason,
  type ClosedOrder,
  type EquityHistoryPoint,
} from './types';
import {
  dateTimeAr,
  fmtEgp,
  fmtNum,
  pnlColor,
  rowBgClass,
} from './helpers';

export interface HistoryAndPerformanceProps {
  closedOrders: ClosedOrder[];
  visibleCount: number;
  onLoadMore: () => void;
  equityHistory: EquityHistoryPoint[];
}

export function HistoryAndPerformance({
  closedOrders,
  visibleCount,
  onLoadMore,
  equityHistory,
}: HistoryAndPerformanceProps) {
  const closedSorted = [...closedOrders].sort(
    (a, b) =>
      new Date(b.closed_at ?? 0).getTime() - new Date(a.closed_at ?? 0).getTime(),
  );
  const visibleClosed = closedSorted.slice(0, visibleCount);

  return (
    <WidgetCard
      title="سجل التداول والأداء"
      icon={Clock}
      iconColor="text-profit"
      iconSize="w-4 h-4"
      titleClassName="text-base"
    >
      <Tabs defaultValue="history" className="w-full">
        <TabsList className="mb-3">
          <TabsTrigger value="history" className="text-xs">
            سجل الصفقات المغلقة
          </TabsTrigger>
          <TabsTrigger value="performance" className="text-xs">
            منحنى الأداء
          </TabsTrigger>
        </TabsList>

        {/* Trade history */}
        <TabsContent value="history" className="space-y-3">
          {closedSorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
              <Clock className="w-7 h-7 mb-2 opacity-50" />
              <p className="text-sm">لا توجد صفقات مغلقة بعد</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[720px]">
                  <thead className="bg-muted/60">
                    <tr className="border-b">
                      <th className="text-right p-2 font-medium">السهم</th>
                      <th className="text-center p-2 font-medium">النوع</th>
                      <th className="text-center p-2 font-medium">الكمية</th>
                      <th className="text-center p-2 font-medium">سعر الدخول</th>
                      <th className="text-center p-2 font-medium">سعر الإغلاق</th>
                      <th className="text-center p-2 font-medium">الربح/الخسارة</th>
                      <th className="text-center p-2 font-medium">السبب</th>
                      <th className="text-center p-2 font-medium">وقت الإغلاق</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleClosed.map((order) => {
                      const isBuy = order.order_type === 'BUY';
                      const reason = (order.close_reason ?? 'MANUAL') as CloseReason;
                      return (
                        <tr key={order.id} className={`border-b ${rowBgClass(order.pnl)}`}>
                          <td className="p-2">
                            <div className="font-mono font-semibold" dir="ltr">
                              {order.ticker}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {ASSET_TYPE_LABELS[order.asset_type as AssetType] ??
                                order.asset_type}
                            </div>
                          </td>
                          <td className="p-2 text-center">
                            <Badge
                              variant="outline"
                              className={
                                isBuy
                                  ? 'bg-profit/10 text-profit border border-profit/20 border-profit '
                                  : 'bg-loss/10 text-loss border border-loss/20 border-loss '
                              }
                            >
                              {isBuy ? 'شراء' : 'بيع'}
                            </Badge>
                          </td>
                          <td className="p-2 text-center tabular-nums">
                            {fmtNum(order.shares)}
                          </td>
                          <td className="p-2 text-center tabular-nums" dir="ltr">
                            {fmtPrice(order.entry_price)}
                          </td>
                          <td className="p-2 text-center tabular-nums" dir="ltr">
                            {fmtPrice(order.close_price)}
                          </td>
                          <td
                            className={`p-2 text-center tabular-nums font-semibold ${pnlColor(
                              order.pnl,
                            )}`}
                          >
                            {(order.pnl ?? 0) >= 0 ? '+' : ''}
                            {fmtEgp(order.pnl)}
                          </td>
                          <td className="p-2 text-center">
                            <Badge
                              variant="outline"
                              className={`text-xs ${CLOSE_REASON_BADGE_CLASS[reason]}`}
                            >
                              {CLOSE_REASON_LABELS_AR[reason]}
                            </Badge>
                          </td>
                          <td className="p-2 text-center text-xs text-muted-foreground whitespace-nowrap">
                            {dateTimeAr(order.closed_at)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {closedSorted.length > visibleCount && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onLoadMore}
                  >
                    عرض المزيد ({fmtNum(closedSorted.length - visibleCount)} متبقي)
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* Performance chart */}
        <TabsContent value="performance">
          {equityHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
              <TrendingUp className="w-7 h-7 mb-2 opacity-50" />
              <p className="text-sm">سيظهر منحنى حقوق الملكية هنا بعد عدة تحديثات للأسعار</p>
              <p className="text-xs">يتم تحديث المنحنى كل 10 ثوانٍ مع كل استطلاع للأسعار</p>
            </div>
          ) : (
            <div className="w-full h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityHistory} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10, fontFamily: 'inherit' }}
                    reversed
                  />
                  <YAxis
                    tick={{ fontSize: 10, fontFamily: 'inherit' }}
                    orientation="right"
                    domain={['auto', 'auto']}
                    tickFormatter={(v: number) =>
                      new Intl.NumberFormat('ar-EG', { notation: 'compact' }).format(v)
                    }
                  />
                  <RechartsTooltip
                    contentStyle={{
                      fontSize: '12px',
                      fontFamily: 'inherit',
                      direction: 'rtl',
                    }}
                    formatter={(value: number) => [`${fmtEgp(value)} ج.م`, 'حقوق الملكية']}
                    labelFormatter={(label: string) => `الوقت: ${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="equity"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    name="حقوق الملكية"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </WidgetCard>
  );
}

// Re-export so the container can compute page sizes without importing from types
export { HISTORY_PAGE_SIZE };
