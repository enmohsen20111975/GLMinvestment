/**
 * subscription-view/PlanCard.tsx
 * =============================
 * PlanCard — the per-plan pricing card rendered in the plans grid.
 *
 * Shows:
 * - Top badge (most popular / VIP / Pro) when applicable.
 * - Icon (Crown / Zap / Star / Shield).
 * - Title + description.
 * - Price tag with strikethrough originalPrice + discount% badge.
 * - Features list (with check / X icons, highlighted + disabled rows).
 * - CTA button (loading state when loading === plan.id).
 */
'use client';

import React from 'react';
import {
  Check, Crown, Sparkles, Star, Zap, Shield, Rocket, Loader2, X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { Plan, MarketPricingConfig } from './types';

export interface PlanCardProps {
  plan: Plan;
  market: MarketPricingConfig;
  billingPeriod: 'monthly' | 'yearly';
  onSelect: () => void;
  loading: string | null;
}

export function PlanCard({ plan, market, billingPeriod, onSelect, loading }: PlanCardProps) {
  const displayPrice = billingPeriod === 'yearly' ? plan.priceYearly : plan.price;
  const monthlyPrice = billingPeriod === 'yearly' ? Math.round(plan.priceYearly / 12) : plan.price;
  const isLoading = loading === plan.id;

  return (
    <Card
      className={`relative flex flex-col justify-between overflow-hidden transition-all duration-300 hover:shadow-2xl ${
        plan.vip
          ? 'border-2 border-warning via-background shadow-xl shadow-amber-500/10 ring-2 ring-warning/50'
          : plan.popular
          ? 'border-2 border-profit shadow-xl shadow-emerald-500/10'
          : plan.pro
          ? 'border-2 border-purple-500 dark:border-purple-600 shadow-xl shadow-purple-500/10'
          : 'border border-border/80 hover:border-profit/20'
      }`}
    >
      {/* Top Badges */}
      {plan.popular && !plan.vip && (
        <div className="absolute -top-px left-0 right-0">
          <div className="from-profit to-whale text-foreground text-center py-1.5 text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm">
            <Sparkles className="w-3.5 h-3.5" />
            الأكثر طلباً 🔥
          </div>
        </div>
      )}

      {plan.vip && (
        <div className="absolute -top-px left-0 right-0">
          <div className="from-warning via-yellow-500 to-warning text-warning text-center py-1.5 text-xs font-black flex items-center justify-center gap-1.5 shadow-md">
            <Crown className="w-4 h-4 fill-warning" />
            الباقة الأقوى قيمة (كافة الأسواق 👑)
          </div>
        </div>
      )}

      {plan.pro && (
        <div className="absolute -top-px left-0 right-0">
          <div className="from-purple-600 to-fuchsia-600 text-foreground text-center py-1.5 text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm">
            <Rocket className="w-3.5 h-3.5" />
            للمضارب المحترف ⚡
          </div>
        </div>
      )}

      <div>
        <CardHeader className={`text-center ${plan.popular || plan.pro || plan.vip ? 'pt-11' : 'pt-6'}`}>
          <div
            className={`mx-auto w-12 h-12 rounded-2xl flex items-center justify-center mb-3 ${
              plan.vip
                ? 'from-warning to-yellow-500 text-warning shadow-lg shadow-amber-500/30'
                : plan.pro
                ? 'from-purple-500 to-fuchsia-600 text-foreground shadow-md shadow-purple-500/20'
                : plan.popular
                ? 'from-profit to-whale text-foreground shadow-md shadow-emerald-500/20'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {plan.vip ? (
              <Crown className="w-6 h-6" />
            ) : plan.pro ? (
              <Zap className="w-6 h-6" />
            ) : plan.popular ? (
              <Star className="w-6 h-6" />
            ) : (
              <Shield className="w-6 h-6" />
            )}
          </div>

          <CardTitle className="text-xl font-bold mb-1">{plan.nameAr}</CardTitle>
          <CardDescription className="text-xs min-h-[32px]">{plan.description}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Price Tag with Strikethrough & Discount Badge */}
          <div className="text-center py-2 bg-muted/40 rounded-xl border border-border/40">
            {plan.price === 0 ? (
              <div className="flex items-center justify-center gap-2">
                <span className="text-3xl font-extrabold text-foreground">مجاني</span>
                <Badge className="bg-profit text-white text-xs">للأبد</Badge>
              </div>
            ) : (
              <>
                {plan.originalPrice && (
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <span className="text-sm text-muted-foreground line-through font-mono">
                      {billingPeriod === 'yearly' ? plan.originalPrice * 10 : plan.originalPrice} {market.currencyAr}
                    </span>
                    <Badge className="bg-loss/15 text-loss border border-loss/20 text-xs font-black px-1.5 py-0">
                      وفر {plan.discountPct}% 🔥
                    </Badge>
                  </div>
                )}
                <div className="flex items-baseline justify-center gap-1.5">
                  <span className="text-3xl md:text-4xl font-black text-foreground font-mono" dir="ltr">
                    {displayPrice}
                  </span>
                  <span className="text-sm font-bold text-muted-foreground">{market.currencyAr}</span>
                  <span className="text-xs text-muted-foreground">
                    / {billingPeriod === 'yearly' ? 'سنة' : 'شهر'}
                  </span>
                </div>
                {billingPeriod === 'yearly' && (
                  <p className="text-xs text-profit font-semibold mt-1">
                    يعادل {monthlyPrice} {market.currencyAr} شهرياً
                  </p>
                )}
              </>
            )}
          </div>

          <Separator />

          {/* Features List */}
          <ul className="space-y-2.5 text-xs">
            {plan.features.map((feature, idx) => (
              <li
                key={idx}
                className={`flex items-start gap-2.5 ${
                  feature.disabled
                    ? 'text-muted-foreground/60 line-through'
                    : feature.highlighted
                    ? 'text-profit font-bold'
                    : 'text-foreground'
                }`}
              >
                <span className="flex-shrink-0 mt-0.5">
                  {feature.disabled ? (
                    <X className="w-3.5 h-3.5 text-muted-foreground/50" />
                  ) : (
                    <Check className={`w-3.5 h-3.5 ${feature.highlighted ? 'text-profit' : 'text-profit'}`} />
                  )}
                </span>
                <span className="leading-snug">{feature.text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </div>

      <div className="p-6 pt-0 mt-4">
        <Button
          className={`w-full py-5 text-sm font-bold shadow-md transition-all ${
            plan.vip
              ? 'from-warning via-yellow-500 to-warning hover:from-warning hover:to-yellow-700 text-warning font-black shadow-amber-500/25 ring-2 ring-warning'
              : plan.popular
              ? 'from-profit to-whale hover:from-profit hover:to-whale text-foreground shadow-emerald-500/25'
              : plan.pro
              ? 'from-purple-600 to-fuchsia-600 hover:from-purple-700 hover:to-fuchsia-700 text-foreground shadow-purple-500/25'
              : 'bg-muted-foreground/20 text-foreground hover:bg-muted-foreground/30'
          }`}
          onClick={onSelect}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 ml-2 animate-spin" />
          ) : (
            <>
              {plan.price === 0 && <Rocket className="w-4 h-4 ml-2" />}
              {plan.popular && !plan.vip && <Zap className="w-4 h-4 ml-2" />}
              {plan.pro && <Rocket className="w-4 h-4 ml-2" />}
              {plan.vip && <Crown className="w-4 h-4 ml-2 fill-warning" />}
            </>
          )}
          {isLoading ? 'جاري التحميل...' : plan.cta}
        </Button>
        {plan.price > 0 && (
          <p className="text-xs text-center text-muted-foreground mt-2">
            بدون التزام · إلغاء في أي وقت
          </p>
        )}
      </div>
    </Card>
  );
}
