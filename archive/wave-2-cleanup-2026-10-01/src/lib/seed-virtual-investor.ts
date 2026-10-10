/**
 * seed-virtual-investor.ts
 * ========================
 * بيبني مستخدم افتراضي بمحفظة كاملة فيها:
 *   - 20 سهم EGX (من 5 شهور)
 *   - ذهب (3 أونصة)
 *   - عقار (1 عقار)
 *   - ودائع بنكية (شهادة إيداع)
 *   - كريبتو (BTC + ETH)
 *
 * + يضيفهم في watchlist + radar tracking
 * + يفعّل التنبيهات عليهم
 *
 * الهدف: فحص إن المحفظة بتظهر في الشاشة الرئيسية + بتدخل في المتابعة + التنبيهات
 */

import { authDb } from './db-auth';
import path from 'path';
import { writeFile, readFile, access, mkdir } from 'fs/promises';
import Database from 'better-sqlite3';

const VIRTUAL_USER = {
  id: 'virtual-investor-test-001',
  email: 'virtual.investor@m2y.net',
  username: 'virtual_investor',
  name: 'مستثمر افتراضي',
  subscription_tier: 'premium',
  is_active: true,
  default_risk_tolerance: 'medium',
  trial_ends_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  last_login: new Date().toISOString(),
};

// 20 سهم EGX (أسعار تقريبية من 5 شهور — مايو 2026)
const STOCK_HOLDINGS = [
  { ticker: 'COMI', name: 'البنك التجاري الدولي', shares: 500, purchase_price: 125, market: 'EGX' },
  { ticker: 'HRHO', name: 'هرم للتنمية', shares: 1000, purchase_price: 28, market: 'EGX' },
  { ticker: 'TMGH', name: 'طلعت مصطفى', shares: 800, purchase_price: 22, market: 'EGX' },
  { ticker: 'ABUK', name: 'أبو قير للأسمدة', shares: 300, purchase_price: 58, market: 'EGX' },
  { ticker: 'ETEL', name: 'المصرية للاتصالات', shares: 600, purchase_price: 18, market: 'EGX' },
  { ticker: 'FWRY', name: 'فوري', shares: 1200, purchase_price: 6.5, market: 'EGX' },
  { ticker: 'SWDY', name: 'السويدي', shares: 900, purchase_price: 15, market: 'EGX' },
  { ticker: 'EFID', name: 'الدلتا للأسمدة', shares: 400, purchase_price: 42, market: 'EGX' },
  { ticker: 'ORAS', name: 'أوراسكوم', shares: 200, purchase_price: 850, market: 'EGX' },
  { ticker: 'CIEB', name: 'البنك المصري لتنمية الصادرات', shares: 700, purchase_price: 19, market: 'EGX' },
  { ticker: 'AMER', name: 'أموك', shares: 1500, purchase_price: 3.8, market: 'EGX' },
  { ticker: 'MFPC', name: 'موبكو', shares: 600, purchase_price: 22, market: 'EGX' },
  { ticker: 'EGTS', name: 'الإعمارية للسياحة', shares: 2000, purchase_price: 4.2, market: 'EGX' },
  { ticker: 'BETA', name: 'بيتك', shares: 1000, purchase_price: 15, market: 'EGX' },
  { ticker: 'EAST', name: 'الشرق للدخان', shares: 150, purchase_price: 180, market: 'EGX' },
  { ticker: 'CCAP', name: 'كابيتال', shares: 800, purchase_price: 8.5, market: 'EGX' },
  { ticker: 'HELI', name: 'هليوبوليس', shares: 500, purchase_price: 25, market: 'EGX' },
  { ticker: 'PHDC', name: 'الإعمار', shares: 2000, purchase_price: 3.5, market: 'EGX' },
  { ticker: 'ODIN', name: 'العودة', shares: 1200, purchase_price: 7.2, market: 'EGX' },
  { ticker: 'EGBE', name: 'البنك الأهلي', shares: 300, purchase_price: 65, market: 'EGX' },
];

// أصول تانية (ذهب + عقار + ودائع)
const OTHER_ASSETS = [
  { ticker: 'GOLD_OUNCE', name: 'ذهب (أونصة)', shares: 3, purchase_price: 75000, asset_class: 'gold', market: 'GOLD' },
  { ticker: 'REAL_ESTATE_CAIRO', name: 'عقار القاهرة', shares: 1, purchase_price: 5000000, asset_class: 'realestate', market: 'EGX' },
  { ticker: 'BANK_CERTIFICATE_20', name: 'شهادة إيداع 20%', shares: 1, purchase_price: 1000000, asset_class: 'deposit', market: 'EGX' },
  { ticker: 'BTC', name: 'Bitcoin', shares: 0.5, purchase_price: 95000, asset_class: 'crypto', market: 'CRYPTO' },
  { ticker: 'ETH', name: 'Ethereum', shares: 5, purchase_price: 3200, asset_class: 'crypto', market: 'CRYPTO' },
];

async function main() {
  console.log('🚀 بناء المستثمر الافتراضي...\n');

  // 1. إنشاء المستخدم في auth.db
  console.log('1. إنشاء المستخدم...');
  try {
    await authDb.user.upsert({
      where: { id: VIRTUAL_USER.id },
      create: VIRTUAL_USER,
      update: { last_login: new Date(), is_active: true },
    });
    console.log('   ✅ المستخدم:', VIRTUAL_USER.email);
  } catch (e: any) {
    console.log('   ⚠️ User create error (might already exist):', e.message?.slice(0, 80));
  }

  // 2. إضافة الأسهم في portfolio_items (auth.db)
  console.log('\n2. إضافة الأسهم في المحفظة...');
  let stockCount = 0;
  for (const stock of STOCK_HOLDINGS) {
    try {
      await authDb.portfolioItem.upsert({
        where: { id: `pi_${VIRTUAL_USER.id}_${stock.ticker}` },
        create: {
          id: `pi_${VIRTUAL_USER.id}_${stock.ticker}`,
          user_id: VIRTUAL_USER.id,
          asset_type: 'stock',
          symbol: stock.ticker,
          name: stock.name,
          shares: stock.shares,
          purchase_price: stock.purchase_price,
          currency: 'EGP',
        },
        update: {},
      });
      stockCount++;
    } catch (e: any) {
      console.log('   ⚠️', stock.ticker, ':', e.message?.slice(0, 60));
    }
  }
  console.log(`   ✅ ${stockCount} سهم في المحفظة`);

  // 3. إضافة الأصول التانية (ذهب + عقار + ودائع + كريبتو)
  console.log('\n3. إضافة أصول متنوعة...');
  let assetCount = 0;
  for (const asset of OTHER_ASSETS) {
    try {
      await authDb.portfolioItem.upsert({
        where: { id: `pi_${VIRTUAL_USER.id}_${asset.ticker}` },
        create: {
          id: `pi_${VIRTUAL_USER.id}_${asset.ticker}`,
          user_id: VIRTUAL_USER.id,
          asset_type: asset.asset_class,
          symbol: asset.ticker,
          name: asset.name,
          shares: asset.shares,
          purchase_price: asset.purchase_price,
          currency: 'EGP',
        },
        update: {},
      });
      assetCount++;
    } catch (e: any) {
      console.log('   ⚠️', asset.ticker, ':', e.message?.slice(0, 60));
    }
  }
  console.log(`   ✅ ${assetCount} أصل متنوع (ذهب + عقار + ودائع + كريبتو)`);

  // 4. إضافة الأسهم في watchlist (auth.db)
  console.log('\n4. إضافة الأسهم في قائمة المراقبة...');
  let wlCount = 0;
  for (const stock of STOCK_HOLDINGS) {
    try {
      await authDb.watchlist.upsert({
        where: { user_id_ticker: { user_id: VIRTUAL_USER.id, ticker: stock.ticker } },
        create: {
          user_id: VIRTUAL_USER.id,
          ticker: stock.ticker,
          market: stock.market,
          alert_price_above: stock.purchase_price * 1.15,
          alert_price_below: stock.purchase_price * 0.92,
        },
        update: {},
      });
      wlCount++;
    } catch (e: any) {
      // might already exist
    }
  }
  console.log(`   ✅ ${wlCount} سهم في قائمة المراقبة`);

  // 5. إضافة الأسهم في radar tracking (JSON)
  console.log('\n5. إضافة الأسهم في تتبع الرادار...');
  const trackingFile = path.join(process.cwd(), 'db', 'maker_radar_tracking.json');
  let tracking: Record<string, any> = {};
  try {
    await access(trackingFile);
    tracking = JSON.parse(await readFile(trackingFile, 'utf-8'));
  } catch {
    // empty
  }

  let radarCount = 0;
  for (const stock of STOCK_HOLDINGS) {
    const ticker = stock.ticker.toUpperCase();
    if (!tracking[ticker]) {
      tracking[ticker] = {
        ticker,
        entryDate: '2026-05-15', // 5 شهور قبل
        entryPrice: stock.purchase_price,
        addedAt: '2026-05-15T10:00:00.000Z',
        notes: 'virtual investor portfolio',
      };
      radarCount++;
    }
  }
  await writeFile(trackingFile, JSON.stringify(tracking, null, 2));
  console.log(`   ✅ ${radarCount} سهم في تتبع الرادار`);

  // 6. ملخص
  console.log('\n══════════════════════════════════════════');
  console.log('📊 ملخص المستثمر الافتراضي:');
  console.log('  ID:', VIRTUAL_USER.id);
  console.log('  Email:', VIRTUAL_USER.email);
  console.log('  Tier:', VIRTUAL_USER.subscription_tier);
  console.log('  الأسهم:', stockCount, 'سهم');
  console.log('  أصول متنوعة:', assetCount, '(ذهب + عقار + ودائع + كريبتو)');
  console.log('  قائمة المراقبة:', wlCount, 'سهم');
  console.log('  تتبع الرادار:', radarCount, 'سهم');
  console.log('══════════════════════════════════════════');
  console.log('\n✅ جاهز للفحص! افتح المنصة وسجل بـ virtual.investor@m2y.net');

  await authDb.$disconnect();
}

main().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
});
