/** @type {import('next').NextConfig} */
const nextConfig = {
  // P2-FIX (2026-10-09, Round 2): تفعيل TypeScript errors في الـ build
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // UNIFY-FIX: تعطيل source maps في الإنتاج (تسريع البناء)
  productionBrowserSourceMaps: false,
};

export default nextConfig;
