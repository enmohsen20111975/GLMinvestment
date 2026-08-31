import type { Metadata } from "next";
// Using system fonts instead of Google Fonts to avoid network issues
// import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
// FIX (Aug 2026): شيلنا Toaster القديم — Sonner هو النظام الموحد
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { Providers } from "@/components/Providers";
// DisclaimerBanner العلوي معطّل — الاكتفاء بـ Footer + LegalDisclaimerFooter (P2: توحيد)
import { FeedbackWidget } from "@/components/FeedbackWidget";

// Force dynamic rendering to prevent CDN caching stale HTML.
// Without this, Next.js prerendercaches pages with s-maxage=31536000 (1 year),
// causing Hostinger CDN to serve old HTML with outdated _next/static chunk hashes → 404 errors.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
  title: "دليل الاستثمار | تحليلات الأسهم والعملات الرقمية",
  description: "دليل الاستثمار - منصة تحليلات الأسهم والعملات الرقمية - استثمر بذكاء مع تحليلات مالية وفنية متقدمة",
  keywords: ["دليل الاستثمار", "EGX", "Egyptian Stock Exchange", "Bourse Egypte", "تحليل أسهم", "تحليلات استثمارية", "البورصة المصرية", "استثمار", "عملات رقمية"],
  authors: [{ name: "دليل الاستثمار" }],
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
    url: "https://invist.m2y.net",
    siteName: "دليل الاستثمار",
    type: "website",
    images: [{ url: "/logo-full.png", width: 1672, height: 940, alt: "دليل الاستثمار" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "دليل الاستثمار | تحليلات الأسهم والعملات الرقمية",
    description: "دليل الاستثمار - منصة تحليلات الأسهم والعملات الرقمية المتقدمة",
    images: ["/logo-full.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body
        className="antialiased bg-background text-foreground font-sans"
        suppressHydrationWarning
      >
        <Providers>
          
          {children}
          <FeedbackWidget />
          <SonnerToaster position="top-center" dir="rtl" />
        </Providers>
      </body>
    </html>
  );
}
