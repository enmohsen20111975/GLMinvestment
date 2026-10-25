/**
 * subscription-view/constants.ts
 * =============================
 * REGIONAL_MARKETS — the 7 market pricing configs (EGX, Tadawul, KSE, QSE,
 * US Wall St, Crypto+Gold, and the "all" VIP Pass that covers all 6 markets
 * at once).
 *
 * Each market has localized pricing for the 4 plans (premium / pro / vip_pass /
 * developer) with monthly + yearly + originalMonthly (pre-discount) + discount%.
 *
 * z-ai-web-dev-sdk NOT used.
 */
import type { MarketPricingConfig } from './types';

export const REGIONAL_MARKETS: MarketPricingConfig[] = [
  {
    id: 'egx',
    name: 'بورصة مصر (EGX)',
    shortName: 'مصر',
    flag: '🇪🇬',
    currency: 'EGP',
    currencyAr: 'ج.م',
    prices: {
      premium: { monthly: 99, yearly: 990, originalMonthly: 199, discount: 50 },
      pro: { monthly: 199, yearly: 1990, originalMonthly: 399, discount: 50 },
      vip_pass: { monthly: 249, yearly: 2490, originalMonthly: 699, discount: 65 },
      developer: { monthly: 599, yearly: 5990 },
    },
  },
  {
    id: 'tadawul',
    name: 'السوق السعودي (تداول)',
    shortName: 'السعودية',
    flag: '🇸🇦',
    currency: 'SAR',
    currencyAr: 'ر.س',
    prices: {
      premium: { monthly: 49, yearly: 490, originalMonthly: 99, discount: 50 },
      pro: { monthly: 89, yearly: 890, originalMonthly: 179, discount: 50 },
      vip_pass: { monthly: 99, yearly: 990, originalMonthly: 279, discount: 65 },
      developer: { monthly: 399, yearly: 3990 },
    },
  },
  {
    id: 'kse',
    name: 'بورصة الكويت (KSE)',
    shortName: 'الكويت',
    flag: '🇰🇼',
    currency: 'KWD',
    currencyAr: 'د.ك',
    prices: {
      premium: { monthly: 3.9, yearly: 39, originalMonthly: 7.9, discount: 50 },
      pro: { monthly: 7.5, yearly: 75, originalMonthly: 14.9, discount: 50 },
      vip_pass: { monthly: 7.9, yearly: 79, originalMonthly: 22.9, discount: 65 },
      developer: { monthly: 30, yearly: 300 },
    },
  },
  {
    id: 'qse',
    name: 'بورصة قطر (QSE)',
    shortName: 'قطر',
    flag: '🇶🇦',
    currency: 'QAR',
    currencyAr: 'ر.ق',
    prices: {
      premium: { monthly: 49, yearly: 490, originalMonthly: 99, discount: 50 },
      pro: { monthly: 89, yearly: 890, originalMonthly: 179, discount: 50 },
      vip_pass: { monthly: 99, yearly: 990, originalMonthly: 279, discount: 65 },
      developer: { monthly: 399, yearly: 3990 },
    },
  },
  {
    id: 'us',
    name: 'السوق الأمريكي (US Wall St)',
    shortName: 'أمريكا',
    flag: '🇺🇸',
    currency: 'USD',
    currencyAr: '$',
    prices: {
      premium: { monthly: 12.99, yearly: 129.99, originalMonthly: 24.99, discount: 50 },
      pro: { monthly: 24.99, yearly: 249.99, originalMonthly: 49.99, discount: 50 },
      vip_pass: { monthly: 24.99, yearly: 249.99, originalMonthly: 69.99, discount: 65 },
      developer: { monthly: 99, yearly: 990 },
    },
  },
  {
    id: 'crypto',
    name: 'العملات الرقمية والذهب',
    shortName: 'كريبتو وذهب',
    flag: '₿',
    currency: 'USD',
    currencyAr: '$',
    prices: {
      premium: { monthly: 12.99, yearly: 129.99, originalMonthly: 24.99, discount: 50 },
      pro: { monthly: 24.99, yearly: 249.99, originalMonthly: 49.99, discount: 50 },
      vip_pass: { monthly: 24.99, yearly: 249.99, originalMonthly: 69.99, discount: 65 },
      developer: { monthly: 99, yearly: 990 },
    },
  },
  {
    id: 'all',
    name: 'الباقة الشاملة VIP (كافة الأسواق الـ 6)',
    shortName: 'الباقة الشاملة VIP',
    flag: '👑',
    currency: 'USD',
    currencyAr: '$',
    prices: {
      premium: { monthly: 12.99, yearly: 129.99, originalMonthly: 24.99, discount: 50 },
      pro: { monthly: 24.99, yearly: 249.99, originalMonthly: 49.99, discount: 50 },
      vip_pass: { monthly: 24.99, yearly: 249.99, originalMonthly: 69.99, discount: 65 },
      developer: { monthly: 99, yearly: 990 },
    },
  },
];
