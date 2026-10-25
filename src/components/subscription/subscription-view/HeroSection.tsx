/**
 * subscription-view/HeroSection.tsx
 * ================================
 * The hero section of the SubscriptionView:
 * - Title "اختر باقتك وسوقك المفضل" + description + trust badges.
 * - Regional Markets switcher tabs (7 markets).
 * - Billing toggle (monthly / yearly).
 *
 * Rendered above the promo code + plans grid.
 */
'use client';

import React from 'react';
import { Crown, Shield, Clock, Headphones } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { REGIONAL_MARKETS } from './constants';

export interface HeroSectionProps {
  selectedMarketId: string;
  setSelectedMarketId: (id: string) => void;
  billingPeriod: 'monthly' | 'yearly';
  setBillingPeriod: (p: 'monthly' | 'yearly') => void;
}

export function HeroSection({
  selectedMarketId,
  setSelectedMarketId,
  billingPeriod,
  setBillingPeriod,
}: HeroSectionProps) {
  return (
    <div className="relative overflow-hidden">
      <div className="absolute top-20 left-10 w-72 h-72 bg-profit/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-40 right-20 w-96 h-96 bg-whale/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-4 pt-12 pb-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-profit/10 border border-profit/20 mb-6">
            <Crown className="w-10 h-10 text-foreground" />
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold text-foreground mb-4 tracking-tight">
            اختر باقتك وسوقك المفضل
          </h1>
          <p className="text-lg text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed">
            تحليلات حقيقية تعتمد على رادار صانع السوق والسيولة وأهداف التوقعات المحسوبة، مدعومة بالفاحص الشرعي ومحرك إنقاذ الأسهم.
          </p>

          {/* Trust Badges */}
          <div className="flex flex-wrap items-center justify-center gap-6 mb-10 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-profit" />
              <span>دفع مشفر وآمن 100%</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-profit" />
              <span>إلغاء الاشتراك في أي وقت</span>
            </div>
            <div className="flex items-center gap-2">
              <Headphones className="w-4 h-4 text-profit" />
              <span>دعم فني متخصص ومباشر</span>
            </div>
          </div>

          {/* Regional Markets Switcher Tabs */}
          <div className="max-w-4xl mx-auto mb-8">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 text-center">
              اختر البورصة أو السوق المالي
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 p-1.5 bg-muted/60 backdrop-blur-sm rounded-2xl border border-border/60 shadow-inner">
              {REGIONAL_MARKETS.map((m) => {
                const isSelected = selectedMarketId === m.id;
                const isVipTab = m.id === 'all';
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMarketId(m.id)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs md:text-sm font-bold transition-all duration-200 ${
                      isSelected
                        ? isVipTab
                          ? 'from-warning to-yellow-600 text-foreground shadow-lg shadow-amber-500/30 ring-2 ring-warning'
                          : 'from-profit to-whale text-foreground shadow-md shadow-emerald-600/30'
                        : 'text-muted-foreground hover:text-foreground hover:bg-background/70'
                    }`}
                  >
                    <span className="text-base">{m.flag}</span>
                    <span>{m.shortName}</span>
                    {isVipTab && (
                      <Badge className="bg-warning/10 text-warning dark:text-warning border border-warning/20 text-xs px-1.5 py-0 border-0 font-extrabold animate-pulse">
                        الأقوى
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Billing Toggle */}
          <div className="inline-flex items-center gap-3 bg-muted/70 rounded-full p-1.5 border border-border/50">
            <button
              onClick={() => setBillingPeriod('monthly')}
              className={`px-5 py-2 rounded-full text-sm font-bold transition-all ${
                billingPeriod === 'monthly'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              اشتراك شهري
            </button>
            <button
              onClick={() => setBillingPeriod('yearly')}
              className={`px-5 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-2 ${
                billingPeriod === 'yearly'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              اشتراك سنوي
              <Badge className="bg-profit text-white text-xs px-2 py-0.5 font-bold">
                وفر شهرين مجاناً 🎁
              </Badge>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
