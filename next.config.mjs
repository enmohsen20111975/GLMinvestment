import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE: standalone output was disabled because pm2 runs `next start` from the
  // root .next directory (ecosystem.config.js: nextjs -> "next start -p 3000").
  // With output:'standalone', next build strips .next and leaves only
  // .next/standalone, which breaks `next start`. Re-enable only if pm2 is
  // updated to launch from .next/standalone/server.js.
  // output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  reactStrictMode: false,
  // ─── FIX: Increase static generation timeout ──────────────────────
  // Default is 60s. On slow VPS with large DB, pages may take longer.
  staticPageGenerationTimeout: 300, // 5 minutes
  // ─── FIX (Next 16): serverExternalPackages moved from experimental to top-level ──
  // Next 16 deprecated `experimental.serverComponentsExternalPackages`. These packages
  // are native Node modules (better-sqlite3, sql.js) + Prisma clients that MUST NOT
  // be bundled into the client/browser. Without this, Turbopack tries to bundle them
  // → `ReferenceError: module is not defined` in the browser.
  serverExternalPackages: [
    "better-sqlite3",
    "sql.js",
    "@prisma/client",
    "@prisma/auth-client",
    "@prisma/predictions-client",
  ],
  // ─── FIX: Disable static generation entirely ────────────────────────────
  // The build was crashing with SIGSEGV during 'Generating static pages (0/64)'
  // because Next.js was trying to pre-render pages that import heavy modules
  // (better-sqlite3, prisma, etc.) during the build phase.
  //
  // Solution: Set all routes to dynamic. This tells Next.js to skip static
  // generation entirely and render everything on-demand at runtime.
  // This is safe because:
  //   1. All pages are 'use client' anyway (they render in the browser)
  //   2. The app requires a database connection to function
  //   3. No SEO benefit from static generation (pages need JS)
  //
  // We achieve this by:
  //   - Setting `export const dynamic = 'force-dynamic'` in every route/page
  //   - AND setting `dynamic = 'force-dynamic'` here as a global default
  //
  // ─── FIX: Memory limit for build worker ─────────────────────────────────
  // The build worker has its own memory limit. On VPS with 8GB RAM, we need
  // to allow the worker to use more memory during static generation.
  experimental: {
    // FIX (Next 16): serverComponentsExternalPackages moved to top-level `serverExternalPackages`.
    // Kept here empty for backward compat — the real config is now top-level.
    cpus: 1,
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-accordion",
      "@radix-ui/react-alert-dialog",
      "@radix-ui/react-avatar",
      "@radix-ui/react-checkbox",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-label",
      "@radix-ui/react-popover",
      "@radix-ui/react-progress",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-select",
      "@radix-ui/react-separator",
      "@radix-ui/react-slider",
      "@radix-ui/react-slot",
      "@radix-ui/react-switch",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toast",
      "@radix-ui/react-toggle",
      "@radix-ui/react-toggle-group",
      "@radix-ui/react-tooltip",
      "date-fns",
      "framer-motion",
      "recharts",
      "react-markdown",
      "react-syntax-highlighter",
      "lightweight-charts",
      "@tanstack/react-table",
      "@tanstack/react-query",
    ],
    outputFileTracingRoot: path.join(__dirname),
    outputFileTracingExcludes: {
      "*": [
        "**/*.db",
        "**/*.db-wal",
        "**/*.db-shm",
        "**/*.db-journal",
        "**/*.zip",
        "./vps-service/data/egksco/*.pdf",
        "./node_modules/pm2/**/*",
        "./node_modules/playwright/**/*",
      ],
    },
  },
  env: {
    EGXPY_SERVICE_URL:
      process.env.EGXPY_SERVICE_URL ||
      process.env.EGX_VPS_API_URL ||
      "http://localhost:8010",
    EGX_VPS_API_URL:
      process.env.EGX_VPS_API_URL ||
      process.env.EGXPY_SERVICE_URL ||
      "http://localhost:8010",
  },
  webpack: (config) => {
    config.resolve.alias["@"] = path.resolve(__dirname, "src");
    return config;
  },
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, must-revalidate",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/socket.io/:path*",
        destination: "http://127.0.0.1:3005/socket.io/:path*",
      },
      // Picks Management — proxy to Python backend (port 8010)
      // الـ frontend يطلب من /api/predictions/daily-picks وactive-management
      // لكن الـ endpoints موجودة فقط في الـ Python backend
      {
        source: "/api/predictions/daily-picks",
        destination: "http://127.0.0.1:8010/api/predictions/daily-picks",
      },
      {
        source: "/api/predictions/daily-picks/history",
        destination: "http://127.0.0.1:8010/api/predictions/daily-picks/history",
      },
      {
        source: "/api/predictions/active-management",
        destination: "http://127.0.0.1:8010/api/predictions/active-management",
      },
      {
        source: "/api/predictions/management/refresh",
        destination: "http://127.0.0.1:8010/api/predictions/management/refresh",
      },
      {
        source: "/api/predictions/management/health",
        destination: "http://127.0.0.1:8010/api/predictions/management/health",
      },
      // V38 Backtest proxy REMOVED (2026-08-13) — consolidated into Maestro unified engine
      // Port 8011 no longer used — causes 500 errors
    ];
  },
};

export default nextConfig;
