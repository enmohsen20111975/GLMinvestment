<!--
P3 FIX (2026-10-14): Prisma Schema Legacy Models Documentation
================================================================

This file documents the status of each Prisma model across the 3 schemas.
See AUDIT_REPORT_FULL.md Section 6.3 (AUDIT-F) for full details.

schema.prisma (default — 2 models)
----------------------------------
- User: ⚠️ LEGACY — superseded by auth-schema.prisma User (used via authDb).
  Do not use @prisma/client for User queries. Use @/lib/db (authDb) instead.
- Post: ❌ DEAD — 0 references in code. Starter template leftover.
  Safe to remove in Phase P3+ (verify no migration depends on it first).

auth-schema.prisma (18 models)
-------------------------------
- User: ✅ ACTIVE (85+ refs) — primary user model
- Account: ✅ ACTIVE (3 refs) — NextAuth OAuth accounts
- Session: ⚠️ LOW (1 ref) — NextAuth manages
- VerificationToken: ✅ ACTIVE — NextAuth manages
- SubscriptionPlan: ✅ ACTIVE (6 refs) — but seed-subscriptions.ts is outdated
- UserSubscription: ✅ ACTIVE (31 refs)
- ApiToken: ✅ ACTIVE (10 refs) — P1 hashed tokens
- UserTelegramLink: ⚠️ DUAL — Prisma 0 refs, raw SQL 4 refs (bot-link-db.ts)
- AdvancedAnalysisResult: ✅ ACTIVE (5 refs)
- DailyAnalysisSummary: ✅ ACTIVE (4 refs)
- PromoCode: ✅ ACTIVE (13 refs)
- Watchlist: ⚠️ DUAL — Prisma 1 ref, engine reads SQLite user_stock_watchlists instead
- PortfolioItem: ⚠️ DUAL — Prisma 7 refs, engine reads portfolio_assets instead
- PortfolioHistory: ❌ DEAD — 0 refs. Safe to remove.
- MarketPricing: ✅ ACTIVE (8 refs)
- Referral: ❌ DEAD — 0 refs. Safe to remove.
- UsageDaily: ✅ ACTIVE (2 refs)
- B2bApiKey: ⚠️ LOW (1 ref)

predictions-schema.prisma (10 models)
-------------------------------------
- Prediction: ✅ ACTIVE (12 refs) — primary predictions model
- PersonaPrediction: ⚠️ DUAL — Prisma 0 refs, raw SQL 14 refs
- PredictionLog: ⚠️ DUAL — Prisma 0 refs, raw SQL 6+ refs
- ExpertRecommendation: ⚠️ DUAL — Prisma 0 refs, raw SQL
- ExpertTrackRecord: ❌ DEAD — 0 refs. Safe to remove.
- CachedAnalysis: ⚠️ DUAL — Prisma 0 refs, raw SQL 3+ refs
- StoredAnalysis: ⚠️ DUAL — Prisma 0 refs, raw SQL 3+ refs
- AnalysisJob: ❌ DEAD — 0 refs. Safe to remove.
- AnalysisEngineStatus: ⚠️ DUAL — Prisma 0 refs, raw SQL 6 refs
- TechnicalIndicator: ⚠️ DUAL — Prisma 0 refs, raw SQL

Migration plan (Phase P3+):
1. Remove confirmed dead models (Post, PortfolioHistory, Referral, ExpertTrackRecord, AnalysisJob)
2. Consolidate dual models (choose Prisma OR raw SQL — not both)
3. Update seed-subscriptions.ts to match current MarketPricing tiers
-->

# Prisma Schema Status

See comment above for detailed status of each model.

## Dead Models (safe to remove in future migration)
- schema.prisma: Post
- auth-schema.prisma: PortfolioHistory, Referral
- predictions-schema.prisma: ExpertTrackRecord, AnalysisJob

## Dual Models (Prisma + raw SQL — choose one)
- auth-schema.prisma: UserTelegramLink, Watchlist, PortfolioItem
- predictions-schema.prisma: PersonaPrediction, PredictionLog, ExpertRecommendation, CachedAnalysis, StoredAnalysis, AnalysisEngineStatus, TechnicalIndicator

## Seed Update Needed
- `prisma/seed-subscriptions.ts` creates 3 plans (free/normal/premium) but schema supports 6 tiers.
  Update seed to match MarketPricing model (free/premium/pro/b2b_starter/b2b_pro/b2b_enterprise).
