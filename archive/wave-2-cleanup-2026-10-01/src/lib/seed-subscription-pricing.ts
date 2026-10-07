/**
 * seed-subscription-pricing.ts
 * ============================
 * يزرع جدول `market_pricing` بالأسعار المعتمدة لكل باقة × سوق × دورة.
 *
 * التسعير النهائي (متفق عليه في مذكرة #002):
 *   Premium:  مصر 99ج.م / السعودية 19ريال / عالمي \$2.99
 *   Pro:      مصر 199ج.م / السعودية 39ريال / عالمي \$5.99
 *   B2B Starter:  \$99 (يُحول للجنيه وقت الدفع)
 *   B2B Pro:      \$299
 *   B2B Enterprise: \$999
 *
 * الأسعار المحلية للعرض فقط — Paymob بيقبض priceEgp دايماً.
 *
 * التشغيل: `bun run src/lib/seed-subscription-pricing.ts`
 */

import { authDb } from './db-auth';

// معدلات تحويل تقريبية (تتحدّث كل 3 شهور يدوياً)
// 1 USD ≈ 48 EGP | 1 SAR ≈ 12.8 EGP | 1 KWD ≈ 156 EGP | 1 QAR ≈ 13.2 EGP
const FX = {
  USD_TO_EGP: 48,
  SAR_TO_EGP: 12.8,
  KWD_TO_EGP: 156,
  QAR_TO_EGP: 13.2,
};

interface PriceRow {
  tier: string;
  market: string;
  price_local: number;
  currency: string;
  billing_cycle: 'monthly' | 'yearly';
}

// القائمة الكاملة للأسعار المعتمدة
const PRICING: PriceRow[] = [
  // Premium — شهري
  { tier: 'premium', market: 'egx', price_local: 99, currency: 'EGP', billing_cycle: 'monthly' },
  { tier: 'premium', market: 'tadawul', price_local: 19, currency: 'SAR', billing_cycle: 'monthly' },
  { tier: 'premium', market: 'kse', price_local: 1.5, currency: 'KWD', billing_cycle: 'monthly' },
  { tier: 'premium', market: 'qse', price_local: 15, currency: 'QAR', billing_cycle: 'monthly' },
  { tier: 'premium', market: 'us', price_local: 2.99, currency: 'USD', billing_cycle: 'monthly' },
  { tier: 'premium', market: 'crypto', price_local: 2.99, currency: 'USD', billing_cycle: 'monthly' },
  // Premium — سنوي (شهرين مجاناً = 10 شهور)
  { tier: 'premium', market: 'egx', price_local: 990, currency: 'EGP', billing_cycle: 'yearly' },
  { tier: 'premium', market: 'tadawul', price_local: 190, currency: 'SAR', billing_cycle: 'yearly' },
  { tier: 'premium', market: 'us', price_local: 29.9, currency: 'USD', billing_cycle: 'yearly' },
  { tier: 'premium', market: 'crypto', price_local: 29.9, currency: 'USD', billing_cycle: 'yearly' },

  // Pro — شهري
  { tier: 'pro', market: 'egx', price_local: 199, currency: 'EGP', billing_cycle: 'monthly' },
  { tier: 'pro', market: 'tadawul', price_local: 39, currency: 'SAR', billing_cycle: 'monthly' },
  { tier: 'pro', market: 'kse', price_local: 2.9, currency: 'KWD', billing_cycle: 'monthly' },
  { tier: 'pro', market: 'qse', price_local: 29, currency: 'QAR', billing_cycle: 'monthly' },
  { tier: 'pro', market: 'us', price_local: 5.99, currency: 'USD', billing_cycle: 'monthly' },
  { tier: 'pro', market: 'crypto', price_local: 5.99, currency: 'USD', billing_cycle: 'monthly' },
  // Pro — سنوي
  { tier: 'pro', market: 'egx', price_local: 1990, currency: 'EGP', billing_cycle: 'yearly' },
  { tier: 'pro', market: 'tadawul', price_local: 390, currency: 'SAR', billing_cycle: 'yearly' },
  { tier: 'pro', market: 'us', price_local: 59.9, currency: 'USD', billing_cycle: 'yearly' },
  { tier: 'pro', market: 'crypto', price_local: 59.9, currency: 'USD', billing_cycle: 'yearly' },

  // B2B Starter (سنوي فقط، بالدولار)
  { tier: 'b2b_starter', market: 'all', price_local: 99, currency: 'USD', billing_cycle: 'yearly' },
  // B2B Pro
  { tier: 'b2b_pro', market: 'all', price_local: 299, currency: 'USD', billing_cycle: 'yearly' },
  // B2B Enterprise
  { tier: 'b2b_enterprise', market: 'all', price_local: 999, currency: 'USD', billing_cycle: 'yearly' },
];

function convertToEgp(priceLocal: number, currency: string): number {
  switch (currency) {
    case 'EGP': return priceLocal;
    case 'SAR': return Math.round(priceLocal * FX.SAR_TO_EGP);
    case 'KWD': return Math.round(priceLocal * FX.KWD_TO_EGP);
    case 'QAR': return Math.round(priceLocal * FX.QAR_TO_EGP);
    case 'USD': return Math.round(priceLocal * FX.USD_TO_EGP);
    default: return Math.round(priceLocal);
  }
}

async function main() {
  console.log('🌱 Seeding market_pricing table...');
  let inserted = 0;
  let skipped = 0;

  for (const row of PRICING) {
    const priceEgp = convertToEgp(row.price_local, row.currency);
    try {
      const existing = await authDb.marketPricing.findUnique({
        where: {
          tier_market_billing_cycle: {
            tier: row.tier,
            market: row.market,
            billing_cycle: row.billing_cycle,
          },
        },
      });
      if (existing) {
        // تحديث السعر لو اتغيّر
        if (existing.price_egp !== priceEgp || existing.price_local !== row.price_local) {
          await authDb.marketPricing.update({
            where: { id: existing.id },
            data: { price_egp: priceEgp, price_local: row.price_local, currency: row.currency },
          });
          console.log(`  ↻ updated ${row.tier}/${row.market}/${row.billing_cycle}: ${row.price_local} ${row.currency} (${priceEgp} EGP)`);
          inserted++;
        } else {
          skipped++;
        }
      } else {
        await authDb.marketPricing.create({
          data: {
            tier: row.tier,
            market: row.market,
            price_egp: priceEgp,
            price_local: row.price_local,
            currency: row.currency,
            billing_cycle: row.billing_cycle,
            is_active: true,
          },
        });
        console.log(`  ✚ inserted ${row.tier}/${row.market}/${row.billing_cycle}: ${row.price_local} ${row.currency} (${priceEgp} EGP)`);
        inserted++;
      }
    } catch (err: any) {
      console.error(`  ✗ failed ${row.tier}/${row.market}/${row.billing_cycle}:`, err.message);
    }
  }

  console.log(`\n✅ Done. Inserted/updated: ${inserted}, Skipped (already up-to-date): ${skipped}`);
  await authDb.$disconnect();
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
