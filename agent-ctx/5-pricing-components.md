# Task 5 — Pricing Page Component

## Agent: Main Agent
## Status: Completed

### Work Summary

Created a comprehensive Arabic RTL pricing page for the EGX Investment Platform with the following files:

### Files Created

1. **`/home/z/my-project/src/components/pricing/PricingView.tsx`** — Main pricing view component
2. **`/home/z/my-project/src/components/pricing/PaymentDialog.tsx`** — Payment method selection dialog

### Features Implemented

#### PricingView.tsx
- **Header** using existing `Header` component with title "خطط الاشتراك" and subtitle
- **Free Trial Banner** — Gradient emerald banner with gift icon, shows only for free-tier non-trial users. Calls `/api/subscription/start-trial` on click.
- **Active Trial Indicator** — Amber warning banner for users currently in trial period
- **Billing Toggle** — Monthly/Yearly switch with "وفّر 17%" savings badge that animates in
- **4 Plan Cards** (Free, Basic, Pro, Premium) in responsive grid (1/2/4 cols):
  - Free: gray/neutral theme
  - Basic: emerald/green theme
  - Pro: amber/gold with ring-2 ring-amber-400 highlight + "الأكثر شعبية" badge
  - Premium: purple theme
  - Each card shows: icon (Lucide), name (Arabic), description, price with yearly crossed-out monthly, features list with ✅/❌ and values
  - Current plan detection with disabled "خطتك الحالية" button
- **Payment Methods Section** — 3 Egyptian methods (InstaPay, Fawry, Vodafone Cash) with colored icons
- **FAQ Section** — Accordion with 4 common questions in Arabic
- **Support CTA** — Contact/WhatsApp buttons

#### PaymentDialog.tsx
- **Price Summary** showing plan, billing cycle, price, and discount badge
- **Payment Method Selection** — 3 methods with colored backgrounds, descriptions, and checkmark for selection
- **Instructions Preview** — Copyable Arabic payment instructions for selected method
- **Confirm Payment** — Calls `/api/subscription/create-payment` with plan details
- **Success State** — Checkmark animation, full instructions, amber notice about activation timing
- **Error Handling** — Toast notifications for all error states

### Technical Details
- Both files are `'use client'` components
- Uses `useAppStore` for user data and subscription tier
- Uses `cn()` from `@/lib/utils` for conditional classes
- Fully responsive with mobile-first approach
- RTL direction set on root container
- No lint errors in new files (pre-existing errors in daemon-dev.js and ShareButton.tsx only)
- Dev server confirmed running successfully
