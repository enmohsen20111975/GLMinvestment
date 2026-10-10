import type { Metadata } from 'next';

/**
 * structured-data.ts — JSON-LD structured data for Google rich results.
 *
 * FOCUS-5-TASKS — SEO Phase 1 + Phase 3 (GEO) (2026-10-01):
 *   1. Organization schema — company info (name + url + logo + social).
 *   2. WebSite schema — site info + SearchAction (enables sitelinks search box).
 *   3. LocalBusiness schema — geographic info (areaServed: EG, SA, KW, QA).
 *   4. BreadcrumbList — dynamic breadcrumbs per page.
 *
 * These scripts are injected into <head> via the StructuredData component.
 * Google uses them for rich snippets, knowledge graph, and local SEO.
 *
 * Reference: Rule 62 (GIT-PUSH-DISCIPLINE).
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://invist.m2y.net';
const SITE_NAME_AR = 'دليل الاستثمار';
const SITE_NAME_EN = 'Investment Guide';

/**
 * Organization schema — company info for Google Knowledge Graph.
 * Includes `areaServed` for GEO targeting (Egypt + Gulf + Arab world).
 */
export const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${SITE_URL}/#organization`,
  name: SITE_NAME_AR,
  alternateName: SITE_NAME_EN,
  url: SITE_URL,
  logo: {
    '@type': 'ImageObject',
    url: `${SITE_URL}/logo-full.png`,
    width: 1672,
    height: 940,
    caption: `${SITE_NAME_AR} (${SITE_NAME_EN})`,
  },
  image: `${SITE_URL}/logo-full.png`,
  description:
    'منصة استثمارية متعددة الأسواق تخدم البورصة المصرية (EGX) + السعودية (TADAWUL) + الكويت (KSE) + قطر (QSE) + الذهب + الكريبتو.',
  founder: {
    '@type': 'Person',
    name: 'Mohsen El-Sayed',
  },
  foundingDate: '2024',
  areaServed: [
    { '@type': 'Country', name: 'Egypt' },
    { '@type': 'Country', name: 'Saudi Arabia' },
    { '@type': 'Country', name: 'Kuwait' },
    { '@type': 'Country', name: 'Qatar' },
    { '@type': 'Country', name: 'United Arab Emirates' },
  ],
  knowsAbout: [
    'Stock Market Analysis',
    'Technical Analysis',
    'Fundamental Analysis',
    'Liquidity Radar',
    'Investment Predictions',
    'Egyptian Stock Exchange (EGX)',
    'Saudi Stock Exchange (TADAWUL)',
    'Cryptocurrency',
    'Gold Trading',
  ],
  sameAs: [
    SITE_URL,
  ],
};

/**
 * WebSite schema — enables Google's sitelinks search box.
 */
export const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE_URL}/#website`,
  url: SITE_URL,
  name: SITE_NAME_AR,
  alternateName: SITE_NAME_EN,
  description:
    'منصة تحليلات الأسهم والأسواق المالية — رادار السيولة، تحليلات فنية ومالية متقدمة، توقعات مبنيّة على الأدلة، وإدارة محفظة موحّدة.',
  publisher: { '@id': `${SITE_URL}/#organization` },
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${SITE_URL}/?ticker={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
  inLanguage: ['ar', 'en'],
};

/**
 * LocalBusiness schema — geographic targeting for Egyptian + Gulf users.
 * Combines FinancialService + areaServed for local SEO.
 */
export const localBusinessSchema = {
  '@context': 'https://schema.org',
  '@type': 'FinancialService',
  '@id': `${SITE_URL}/#localbusiness`,
  name: SITE_NAME_AR,
  alternateName: SITE_NAME_EN,
  url: SITE_URL,
  image: `${SITE_URL}/logo-full.png`,
  priceRange: '$$',
  currenciesAccepted: 'EGP, SAR, KWD, QAR, USD',
  paymentAccepted: 'Credit Card, Paymob',
  areaServed: [
    { '@type': 'Country', name: 'Egypt' },
    { '@type': 'Country', name: 'Saudi Arabia' },
    { '@type': 'Country', name: 'Kuwait' },
    { '@type': 'Country', name: 'Qatar' },
    { '@type': 'Country', name: 'United Arab Emirates' },
  ],
  serviceType: [
    'Stock Market Analysis',
    'Investment Recommendations',
    'Portfolio Management',
    'Risk Assessment',
    'Cryptocurrency Analysis',
    'Gold Trading Analysis',
  ],
  parentOrganization: { '@id': `${SITE_URL}/#organization` },
};

/**
 * BreadcrumbList schema — dynamic breadcrumbs for stock detail pages.
 * Usage: pass the ticker to generate the proper trail.
 */
export function breadcrumbSchema(ticker?: string, nameAr?: string) {
  const items: Array<{ '@type': string; name: string; position: number }> = [
    {
      '@type': 'ListItem',
      name: SITE_NAME_AR,
      position: 1,
    },
  ];

  if (ticker) {
    items.push({
      '@type': 'ListItem',
      name: nameAr ? `${nameAr} (${ticker})` : ticker,
      position: 2,
    });
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items,
  };
}

/**
 * Inject all structured-data scripts as a single component for the layout.
 * Renders 4 <script type="application/ld+json"> tags.
 */
export function StructuredDataScripts({ ticker, nameAr }: { ticker?: string; nameAr?: string }) {
  const schemas = [
    organizationSchema,
    websiteSchema,
    localBusinessSchema,
    breadcrumbSchema(ticker, nameAr),
  ];

  return (
    <>
      {schemas.map((schema, i) => (
        <script
          key={`schema-${i}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  );
}
