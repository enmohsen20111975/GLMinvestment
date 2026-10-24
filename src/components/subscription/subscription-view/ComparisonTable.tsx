/**
 * subscription-view/ComparisonTable.tsx
 * ======================================
 * Features comparison table — renders a row per feature (price, market count,
 * watchlist, portfolio, alerts, maker radar, predictions, exit policy, sharia,
 * screener, bagholder rescue, export data, telegram, priority support) with
 * one column per plan.
 *
 * `ComparisonRow` is the inner <tr>-rendering helper that handles string /
 * number / boolean values + the optional Check icon for boolean `true`.
 */
'use client';

import React from 'react';
import { Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { Plan, MarketPricingConfig } from './types';

export interface ComparisonTableProps {
  plans: Plan[];
  market: MarketPricingConfig;
  billingPeriod: 'monthly' | 'yearly';
}

function ComparisonRow({
  label,
  plans,
  getValue,
  isBoolean = false,
  highlight = false,
}: {
  label: string;
  plans: Plan[];
  getValue: (p: Plan) => string | number | boolean;
  isBoolean?: boolean;
  highlight?: boolean;
}) {
  return (
    <tr className={`border-b last:border-0 ${highlight ? 'bg-muted/30 font-semibold' : ''}`}>
      <td className="py-3 px-4 text-xs md:text-sm">{label}</td>
      {plans.map((p) => {
        const value = getValue(p);
        return (
          <td
            key={p.id}
            className={`text-center py-3 px-3 text-xs md:text-sm ${p.vip ? 'bg-warning/5' : ''}`}
          >
            {isBoolean ? (
              typeof value === 'string' ? (
                <span className="text-xs">{value}</span>
              ) : value ? (
                <Check className="w-4 h-4 text-profit mx-auto" />
              ) : (
                <span className="text-muted-foreground/30 mx-auto block">—</span>
              )
            ) : (
              <span>{value}</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

export function ComparisonTable({ plans, market, billingPeriod }: ComparisonTableProps) {
  return (
    <Card className="overflow-hidden border border-border/80 shadow-md">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs md:text-sm">
            <thead>
              <tr className="border-b bg-muted/60">
                <th className="text-right py-4 px-4 font-bold">الميزة / الأداة</th>
                {plans.map((p) => (
                  <th
                    key={p.id}
                    className={`text-center py-4 px-3 font-bold ${
                      p.vip
                        ? 'text-warning bg-warning/5'
                        : p.popular
                        ? 'text-profit '
                        : ''
                    }`}
                  >
                    {p.nameAr}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <ComparisonRow
                label="السعر"
                plans={plans}
                getValue={(p) =>
                  p.price === 0
                    ? 'مجاني'
                    : `${billingPeriod === 'yearly' ? p.priceYearly : p.price} ${market.currencyAr}`
                }
                highlight
              />
              <ComparisonRow
                label="تغطية الأسواق المتاحة"
                plans={plans}
                getValue={(p) => p.limits.marketCount}
                highlight
              />
              <ComparisonRow
                label="قوائم المراقبة (Watchlists)"
                plans={plans}
                getValue={(p) =>
                  typeof p.limits.watchlist === 'string' ? 'غير محدود' : `${p.limits.watchlist} أسهم`
                }
              />
              <ComparisonRow
                label="المحافظ الاستثمارية"
                plans={plans}
                getValue={(p) =>
                  typeof p.limits.portfolio === 'string' ? 'غير محدود' : `${p.limits.portfolio} محفظة`
                }
              />
              <ComparisonRow
                label="تنبيهات الأسعار"
                plans={plans}
                getValue={(p) =>
                  typeof p.limits.alerts === 'string' ? 'غير محدود' : `${p.limits.alerts} تنبيه`
                }
              />
              <ComparisonRow
                label="رادار صانع السوق والسيولة الذكية"
                plans={plans}
                getValue={(p) => p.limits.makerRadar}
                isBoolean
                highlight
              />
              <ComparisonRow
                label="أهداف التوقعات ونقاط الدخول والوقف (TP1/TP2/SL)"
                plans={plans}
                getValue={(p) => p.limits.predictions}
                isBoolean
                highlight
              />
              <ComparisonRow
                label="رادار وسياسة الخروج الاحترافية"
                plans={plans}
                getValue={(p) => p.limits.exitPolicy}
                isBoolean
              />
              <ComparisonRow
                label="الفاحص الشرعي وحساب الزكاة والتطهير"
                plans={plans}
                getValue={(p) => (p.id === 'free' ? 'محدود (3 يومياً)' : true)}
                isBoolean
              />
              <ComparisonRow
                label="فلاتر وتصفيات الأسهم المتقدمة (Stock Screener)"
                plans={plans}
                getValue={(p) => p.limits.screener}
                isBoolean
              />
              <ComparisonRow
                label="محرك إنقاذ الأسهم الخاسرة (Bagholder Rescue)"
                plans={plans}
                getValue={(p) => p.limits.bagholderRescue}
                isBoolean
                highlight
              />
              <ComparisonRow
                label="تصدير التقارير والبيانات (Excel / CSV)"
                plans={plans}
                getValue={(p) => p.limits.exportData}
                isBoolean
              />
              <ComparisonRow
                label="إشعارات وقنوات التليجرام الآلية"
                plans={plans}
                getValue={(p) => (p.vip ? 'جميع قنوات الـ 6 أسواق' : p.limits.telegram ? 'قناة السوق المختار' : false)}
                isBoolean
              />
              <ComparisonRow
                label="مستوى الدعم الفني"
                plans={plans}
                getValue={(p) => p.limits.prioritySupport}
              />
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
