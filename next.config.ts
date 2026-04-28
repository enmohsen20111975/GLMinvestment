import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  output: "standalone",
  // CRITICAL: Prevent Hostinger CDN from caching HTML with s-maxage=31536000 (1 year).
  // Without this, after deploying new builds, CDN serves stale HTML referencing
  // old _next/static chunk hashes that no longer exist → 404 errors for all JS/CSS/fonts.
  expireTime: 0,
  // Keep sql.js as external so webpack doesn't try to bundle it.
  // outputFileTracingIncludes + postbuild script ensure files are in standalone output.
  serverExternalPackages: ["sql.js"],
  // Include sql.js dist and db files in standalone trace output.
  // This ensures sql.js WASM runtime is available even without manual deploy scripts.
  outputFileTracingIncludes: {
    "/*": [
      "./db/**/*",
      "./node_modules/sql.js/dist/**/*",
      "./node_modules/sql.js/package.json",
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
    // Set expireTime to 0 to prevent s-maxage=31536000 cache header
    // which causes Hostinger CDN (hcdn) to cache stale HTML pages
  },
  allowedDevOrigins: [
    "preview-chat-bbb1a37c-c483-49f9-9a5e-d3a01488c30d.space.z.ai",
    "*.space.z.ai",
    "*.space.chatglm.site",
  ],
  // Ensure sql.js files are not treated as client assets
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Don't bundle sql.js — it's loaded at runtime via require
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push('sql.js');
      }
    }
    // Handle .wasm files as asset/resource to avoid bundling issues
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });
    return config;
  },
  // Turbopack config (Next.js 16 defaults to Turbopack)
  // serverExternalPackages already handles sql.js for Turbopack,
  // ensuring it's loaded at runtime rather than bundled.
  turbopack: {},

  // Prevent CDN from caching HTML responses (Hostinger hcdn issue).
  // Static assets (_next/static/*) have content hashes and are fine to cache.
  // HTML pages must be no-cache so CDN always fetches fresh HTML with latest chunk hashes.
  async headers() {
    return [
      {
        // HTML pages — no CDN caching
        source: '/',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate, s-maxage=0' },
          { key: 'Surrogate-Control', value: 'no-store' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
      {
        // Page routes (e.g. /admin, /stocks, etc.) — no CDN caching
        source: '/:path((?!_next|favicon|icons|images|api).*)*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate, s-maxage=0' },
          { key: 'Surrogate-Control', value: 'no-store' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
    ];
  },
};

export default nextConfig;
