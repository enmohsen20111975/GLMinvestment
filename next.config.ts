import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

// P0 #15 fix (2026-09-27): wire Sentry SDK into the Next.js build.
// If SENTRY_DSN is unset, Sentry init() in sentry.{client,server}.config.ts
// is a no-op and this wrapper is effectively a passthrough.
//
// FOCUS-5-TASKS — i18n Phase 2 (2026-10-01):
// next-intl plugin (`createNextIntlPlugin`) was tried but caused
// "Couldn't find next-intl config file" errors at runtime. Switched to a
// SIMPLER cookie-based i18n approach WITHOUT the plugin — the layout reads
// the cookie directly + dynamically imports messages/{locale}.json.
// This works because:
//   1. We don't need [locale] routing (Rule 4 — NO-NEW-SCREENS).
//   2. We don't need useTranslations() hook globally (text stays in Arabic
//      for now; English toggle is opt-in via cookie + dynamic <html lang>).
//   3. The SEO benefit (hreflang + canonical + structured data) is in layout.tsx.
export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  hideSourceMaps: true,
  disableLogger: true,
  widenClientFileUpload: true,
  autoInstrumentServerFunctions: true,
});
