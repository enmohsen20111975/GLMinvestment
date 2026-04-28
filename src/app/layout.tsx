import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/Providers";
import { DisclaimerBanner } from "@/components/legal/DisclaimerBanner";

// Force dynamic rendering to prevent CDN caching stale HTML.
// Without this, Next.js prerendercaches pages with s-maxage=31536000 (1 year),
// causing Hostinger CDN to serve old HTML with outdated _next/static chunk hashes → 404 errors.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EGX Analysis Platform",
  description: "منصة تحليلات البورصة المصرية EGX - استثمر بذكاء مع تحليلات آلية ذكية مدعومة بالذكاء الاصطناعي",
  keywords: ["EGX", "Egyptian Stock Exchange", "Bourse Egypte", "تحليل أسهم", "تحليلات استثمارية", "البورصة المصرية", "استثمار"],
  authors: [{ name: "EGX Analysis" }],
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon.ico", sizes: "32x32" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "EGX Analysis Platform",
    description: "Egyptian Stock Exchange analysis and AI-powered educational analyses",
    url: "https://invist.m2y.net",
    siteName: "EGX Analysis",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "EGX Analysis Platform",
    description: "Egyptian Stock Exchange analysis and AI-powered educational analyses",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>
          <DisclaimerBanner />
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
