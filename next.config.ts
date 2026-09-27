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
export default withSentryConfig(nextConfig, {
  // Only relevant when SENTRY_AUTH_TOKEN + SENTRY_DSN are present.
  // Silent on missing token so dev environments don't fail the build.
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Hide sourcemaps from public hosting (uploaded to Sentry only)
  hideSourceMaps: true,
  // Disable tree-shaking noisy 3rd-party library instrumentation
  disableLogger: true,
  // Auto-tree-shake Sentry SDK in production builds
  widenClientFileUpload: true,
  // Skip automatic instrumentation of react routers (we have our own)
  autoInstrumentServerFunctions: true,
});
