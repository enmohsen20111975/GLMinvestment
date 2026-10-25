import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Next.js version detection ─────────────────────────────────────────────
// الـ VPS شغّال على Next 14.2.28، الـ sandbox على Next 16.1.3.
// بعض الـ config options (turbopack, allowedDevOrigins, serverExternalPackages)
// هي Next 16 فقط. لازم نكشف النسخة ونضيفهم conditionally.
const nextVersion = (() => {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'node_modules/next/package.json'), 'utf8')
    );
    return pkg.version || '14.0.0';
  } catch {
    return '14.0.0'; // fallback — assume Next 14
  }
})();
const nextMajor = parseInt(nextVersion.split('.')[0], 10);
const isNext16 = nextMajor >= 16;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE: standalone output was disabled because pm2 runs `next start` from the
  // root .next directory (ecosystem.config.js: nextjs -> "next start -p 3000").
  // output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  // Next 14: eslint.ignoreDuringBuilds مدعوم
  // Next 16: مش مدعوم (استخدم --no-lint flag بدل منه — لكن ده مش مدعوم في 16 أيضاً)
  ...( !isNext16 && {
    eslint: {
      ignoreDuringBuilds: true,
    },
  }),
  reactStrictMode: false,

  // ✅ يعمل في Next 14 و 16 — يحوّل CJS modules لـ ESM
  transpilePackages: ['next-auth', '@babel/runtime'],

  // ✅ يعمل في Next 14 و 16 (في 16 اتحطت top-level بس experimental لسه مدعوم)
  experimental: {
    // Next 14: serverComponentsExternalPackages هنا
    // Next 16: انتقلت لـ top-level serverExternalPackages (مضافة تحت بالـ isNext16)
    ...( !isNext16 && {
      serverComponentsExternalPackages: [
        "better-sqlite3",
        "sql.js",
        "@prisma/client",
        "@prisma/auth-client",
        "@prisma/predictions-client",
      ],
    }),
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
    // Next 14 فقط: outputFileTracingExcludes و outputFileTracingRoot هنا
    // Next 16: انتقلوا لـ top-level
    ...( !isNext16 && {
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
    }),
  },

  // ─── Next 16 فقط ──────────────────────────────────────────────────────────
  ...(isNext16 && {
    // Next 16: serverExternalPackages moved from experimental to top-level
    serverExternalPackages: [
      "better-sqlite3",
      "sql.js",
      "@prisma/client",
      "@prisma/auth-client",
      "@prisma/predictions-client",
    ],
    // Next 16: turbopack is the default bundler — acknowledge it
    turbopack: {
      resolveAlias: {
        '@': path.resolve(__dirname, 'src'),
        // Sandbox-only: redirect next-auth/react to our shim to bypass CJS issue
        'next-auth/react': path.resolve(__dirname, 'src/lib/next-auth-shim.ts'),
      },
    },
    // Next 16: allow cross-origin requests from preview/sandbox domains
    allowedDevOrigins: [
      '*.space-z.ai',
      'localhost',
      '127.0.0.1',
      '*.preview.com',
    ],
  }),

  // ─── مشترك ───────────────────────────────────────────────────────────────
  staticPageGenerationTimeout: 300, // 5 minutes

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
    ];
  },
};

export default nextConfig;
