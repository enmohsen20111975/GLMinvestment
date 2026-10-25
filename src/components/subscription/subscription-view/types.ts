/**
 * subscription-view/types.ts
 * ==========================
 * Shared types for the SubscriptionView module.
 *
 * - MarketPricingConfig: per-market pricing (EGX, Tadawul, KSE, QSE, US, Crypto, All).
 * - PlanFeature: one bullet in the plan card's feature list.
 * - Plan: one of the 4 subscription plans (free / premium / pro / vip_pass).
 * - WalletPaymentData: payload returned by Paymob create-payment when the user
 *   picks "wallet" (vs "card" which redirects immediately).
 *
 * z-ai-web-dev-sdk NOT used. Rule 30: emerald + amber + red + slate.
 */
import type React from 'react';

export interface MarketPricingConfig {
  id: string;
  name: string;
  shortName: string;
  flag: string;
  currency: string;
  currencyAr: string;
  prices: {
    premium: { monthly: number; yearly: number; originalMonthly: number; discount: number };
    pro: { monthly: number; yearly: number; originalMonthly: number; discount: number };
    vip_pass: { monthly: number; yearly: number; originalMonthly: number; discount: number };
    developer: { monthly: number; yearly: number };
  };
}

export interface PlanFeature {
  icon: React.ReactNode;
  text: string;
  highlighted?: boolean;
  disabled?: boolean;
}

export interface Plan {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  price: number;
  priceYearly: number;
  originalPrice?: number;
  discountPct?: number;
  popular?: boolean;
  premium?: boolean;
  pro?: boolean;
  vip?: boolean;
  developer?: boolean;
  cta: string;
  features: PlanFeature[];
  limits: {
    marketCount: string;
    watchlist: number | string;
    portfolio: number | string;
    alerts: number | string;
    makerRadar: boolean;
    predictions: boolean;
    exitPolicy: boolean;
    sharia: boolean;
    screener: boolean;
    bagholderRescue: boolean;
    exportData: boolean;
    telegram: boolean;
    prioritySupport: string;
    apiAccess: boolean;
  };
}

export interface WalletPaymentData {
  paymentKey: string;
  orderId: number;
  amount: number;
  paymobUrl: string;
}
