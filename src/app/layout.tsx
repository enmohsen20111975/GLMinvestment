import type { Metadata } from "next";
<<<<<<< HEAD
// Using system fonts instead of Google Fonts to avoid network issues
// import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
// FIX (Aug 2026): شيلنا Toaster القديم — Sonner هو النظام الموحد
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { Providers } from "@/components/Providers";
// DisclaimerBanner العلوي معطّل — الاكتفاء بـ Footer + LegalDisclaimerFooter (P2: توحيد)
import { FeedbackWidget } from "@/components/FeedbackWidget";
// FOCUS-5-TASKS — SEO Phase 1 + 3 (2026-10-01): JSON-LD structured data
// for Google Knowledge Graph + rich snippets + GEO targeting.
import { StructuredDataScripts } from "@/lib/structured-data";
// FOCUS-5-TASKS — i18n Phase 2 (2026-10-01): cookie-based locale switching.
// We read the `NEXT_LOCALE` cookie directly (no next-intl plugin needed —
// simpler + more robust + doesn't require [locale] routing per Rule 4).
import { cookies } from "next/headers";

// Force dynamic rendering to prevent CDN caching stale HTML.
// Without this, Next.js prerendercaches pages with s-maxage=31536000 (1 year),
// causing Hostinger CDN to serve old HTML with outdated _next/static chunk hashes → 404 errors.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// FOCUS-5-TASKS — SEO Phase 1 (2026-10-01):
// metadataBase is REQUIRED for canonical URLs to resolve correctly.
// Without it, Next.js emits relative canonical URLs which Google ignores.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://invist.m2y.net';

// Using system fonts as fallback
// const inter = Inter({
//   variable: "--font-inter",
//   subsets: ["latin"],
// });
//
// const jetbrainsMono = JetBrains_Mono({
//   variable: "--font-jetbrains-mono",
//   subsets: ["latin"],
// });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "دليل الاستثمار | تحليلات الأسهم والعملات الرقمية",
    template: "%s | دليل الاستثمار",
  },
  description:
    "دليل الاستثمار — منصة تحليلات الأسهم والأسواق المالية. رادار السيولة، تحليلات فنية ومالية متقدمة، توقعات مبنيّة على الأدلة، وإدارة محفظة موحّدة للبورصة المصرية والأسواق الخليجية والذهب والعملات الرقمية.",
  keywords: [
    "دليل الاستثمار",
    "EGX",
    "Egyptian Stock Exchange",
    "Bourse Egypte",
    "تحليل أسهم",
    "تحليلات استثمارية",
    "البورصة المصرية",
    "استثمار",
    "عملات رقمية",
    "TADAWUL",
    "KSE",
    "QSE",
    "رادار السيولة",
    "توقعات الأسهم",
    "تحليل فني",
    "crypto",
    "gold",
  ],
  authors: [{ name: "دليل الاستثمار" }],
  creator: "دليل الاستثمار",
  publisher: "دليل الاستثمار",
  applicationName: "دليل الاستثمار",
  category: "finance",
  // FOCUS-5-TASKS — SEO Phase 1: canonical + alternates for hreflang.
  alternates: {
    canonical: "/",
    languages: {
      ar: "/",
      "en-US": "/",
      "x-default": "/",
    },
  },
  // FOCUS-5-TASKS — SEO Phase 1: explicit robots rules (mirrors src/app/robots.ts).
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "دليل الاستثمار | تحليلات الأسهم والعملات الرقمية",
    description: "دليل الاستثمار - منصة تحليلات الأسهم والعملات الرقمية المتقدمة",
    url: SITE_URL,
    siteName: "دليل الاستثمار",
    type: "website",
    locale: "ar_EG",
    alternateLocale: ["en_US", "ar_SA"],
    images: [{ url: "/logo-full.png", width: 1672, height: 940, alt: "دليل الاستثمار" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "دليل الاستثمار | تحليلات الأسهم والعملات الرقمية",
    description: "دليل الاستثمار - منصة تحليلات الأسهم والعملات الرقمية المتقدمة",
    images: ["/logo-full.png"],
  },
};

export default async function RootLayout({
=======
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Z.ai Code Scaffold - AI-Powered Development",
  description: "Modern Next.js scaffold optimized for AI-powered development with Z.ai. Built with TypeScript, Tailwind CSS, and shadcn/ui.",
  keywords: ["Z.ai", "Next.js", "TypeScript", "Tailwind CSS", "shadcn/ui", "AI development", "React"],
  authors: [{ name: "Z.ai Team" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Z.ai Code Scaffold",
    description: "AI-powered development with modern React stack",
    url: "https://chat.z.ai",
    siteName: "Z.ai",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Z.ai Code Scaffold",
    description: "AI-powered development with modern React stack",
  },
};

export default function RootLayout({
>>>>>>> 99d0ec1 (docs: CLEANUP-PLAN-1 — full cleanup plan for Alpha + Bravo)
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
<<<<<<< HEAD
  // FOCUS-5-TASKS — i18n Phase 2 (2026-10-01): read locale from cookie.
  // Default locale is 'ar'. If the user toggles to 'en' via the
  // LanguageToggle component, the cookie changes and the page re-renders
  // with the new locale + correct <html lang> + dir attribute.
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value;
  const locale =
    cookieLocale === 'en' || cookieLocale === 'ar' ? cookieLocale : 'ar';

  // Set the <html lang> + dir dynamically based on the active locale.
  // ar → rtl (right-to-left), en → ltr (left-to-right).
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        {/* FOCUS-5-TASKS — SEO Phase 1 + 3 (2026-10-01):
            JSON-LD structured data for Google Knowledge Graph +
            GEO targeting (areaServed: EG, SA, KW, QA, AE). */}
        <StructuredDataScripts />
      </head>
      <body
        className="antialiased bg-background text-foreground font-sans"
        suppressHydrationWarning
      >
        <Providers>

          {children}
          <FeedbackWidget />
          <SonnerToaster position="top-center" dir={dir} />
        </Providers>
=======
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
>>>>>>> 99d0ec1 (docs: CLEANUP-PLAN-1 — full cleanup plan for Alpha + Bravo)
      </body>
    </html>
  );
}
