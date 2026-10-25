'use client';

/**
 * SubscriptionView.tsx — SHIM (F-Phase3-Split-Batch7)
 * ===================================================
 * The actual implementation has been split into the `subscription-view/` folder:
 *
 *   subscription-view/
 *     ├── types.ts                       — MarketPricingConfig, Plan, PlanFeature,
 *     │                                    WalletPaymentData.
 *     ├── constants.ts                   — REGIONAL_MARKETS (7 markets: EGX, Tadawul,
 *     │                                    KSE, QSE, US, Crypto, All).
 *     ├── buildPlans.tsx                 — buildPlans(market) → Plan[4] (free / premium /
 *     │                                    pro / vip_pass) with localized features.
 *     ├── TopBar.tsx                     — sticky dismiss bar + auth/login button.
 *     ├── HeroSection.tsx                — title + trust badges + markets switcher +
 *     │                                    monthly/yearly billing toggle.
 *     ├── PromoCodeCard.tsx              — promo code redemption card (input + redeem btn).
 *     ├── EnterpriseSection.tsx          — Enterprise / Developer B2B card ($99/mo).
 *     ├── PlanCard.tsx                   — per-plan pricing card (badges + price + features).
 *     ├── ComparisonTable.tsx            — 14-row features comparison table.
 *     ├── FAQItem.tsx                    — collapsible FAQ card + FAQ_ENTRIES (5 items).
 *     ├── PaymentOptionsModal.tsx        — modal: free trial + InstaPay + Paymob card/wallet.
 *     ├── DeveloperContactModal.tsx      — modal: enterprise contact form (POST to API).
 *     ├── WalletPaymentModal.tsx         — modal: Paymob wallet flow (mobile-wallet number).
 *     ├── SubscriptionView.tsx           — container (< 500 LOC, owns UI state + handlers).
 *     └── index.ts                       — barrel re-exports.
 *
 * This shim re-exports `SubscriptionView` for backward compatibility —
 * any code importing from `@/components/subscription/SubscriptionView`
 * continues to work without changes.
 *
 * Rule 75: commit + push after success. z-ai-web-dev-sdk NOT used.
 */
export { SubscriptionView } from './subscription-view';
export default SubscriptionView;
