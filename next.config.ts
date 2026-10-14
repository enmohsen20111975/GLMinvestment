import type { NextConfig } from "next";

// BOX-2 Phase 4: removed `withSentryConfig` wrapper — it was removed from
// @sentry/nextjs exports in the current version (caused TS2305). Sentry
// init() in sentry.{client,server}.config.ts is a no-op when SENTRY_DSN
// is unset, so the wrapper was a passthrough anyway.
const nextConfig: NextConfig = {
  // P2-FIX (2026-10-09, Round 2): تفعيل TypeScript errors في الـ build
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // UNIFY-FIX (2026-10-08): تعطيل standalone — يسبب مشاكل مع next start + ecosystem.config.js
  // output: 'standalone',
  // BOX-2 Phase 4: removed experimental.optimizePackageImports (expects string[]
  // in Next 14.2.28, not boolean — caused TS2322). Safe to omit.
  // UNIFY-FIX: تعطيل source maps في الإنتاج (تسريع البناء)
  productionBrowserSourceMaps: false,
};

export default nextConfig;
