import { NextResponse } from 'next/server';
import { ensureInitialized, getGoldPrices, getSilverPrices } from '@/lib/egx-db';

// ---------------------------------------------------------------------------
// GET /api/market/gold
// Returns gold, silver, and bullion prices.
// Triggers background sync if data is stale (cache miss or old).
// ---------------------------------------------------------------------------

export const maxDuration = 15;

// Track last sync attempt to avoid thundering herd
let lastSyncAttempt = 0;
const SYNC_COOLDOWN_MS = 60_000; // Only auto-sync every 60s max

async function triggerBackgroundSync() {
  const now = Date.now();
  if (now - lastSyncAttempt < SYNC_COOLDOWN_MS) {
    return; // Skip if too recent
  }
  lastSyncAttempt = now;

  // Fire-and-forget background sync (don't await)
  // Need absolute URL for server-side fetch
  try {
    if (typeof fetch !== 'undefined') {
      // Build absolute URL from environment or default to localhost
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'http://localhost:3000';
      const syncUrl = `${baseUrl}/api/market/gold/sync`;
      fetch(syncUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      }).catch((err) => {
        console.log('[Gold Sync] Background sync failed:', err);
      });
    }
  } catch (err) {
    // Ignore - background sync is best-effort
  }
}

export async function GET() {
  try {
    await ensureInitialized();
    const rows = getGoldPrices();
    const silverRows = getSilverPrices();

    if (!rows || rows.length === 0) {
      // No data — trigger sync and return error
      triggerBackgroundSync();
      return NextResponse.json({
        success: false,
        source: 'database',
        error: 'لا توجد بيانات ذهب متاحة في قاعدة البيانات',
        fetched_at: new Date().toISOString(),
      });
    }

    // Check if data is stale (older than 15 minutes)
    const lastUpdated = rows.reduce((latest: string, r) => {
      const t = r.updated_at as string;
      return t > latest ? t : latest;
    }, '');

    const lastUpdatedTime = new Date(lastUpdated).getTime();
    const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
    
    if (isNaN(lastUpdatedTime) || (Date.now() - lastUpdatedTime > STALE_THRESHOLD_MS)) {
      // Data is stale — trigger background sync, but return what we have
      triggerBackgroundSync();
    }

    // Helper
    const findKarat = (karat: string) => {
      const r = rows.find((row) => row.karat === karat);
      if (!r) return null;
      return {
        price_per_gram: Number(r.price_per_gram),
        change: r.change !== null ? Number(r.change) : null,
        currency: (r.currency as string) || 'EGP',
        name_ar: (r.name_ar as string) || karat,
      };
    };

    // Get all gold karats
    const allKarats: Array<{ key: string; name_ar: string; price_per_gram: number; change: number | null; currency: string }> = [];
    for (const k of ['24', '22', '21', '18', '16', '14', '12', '10', '8']) {
      const d = findKarat(k);
      if (d && d.price_per_gram > 0) {
        allKarats.push({ key: k, name_ar: d.name_ar, price_per_gram: d.price_per_gram, change: d.change, currency: d.currency });
      }
    }

    // Ounce
    const ounce = findKarat('ounce');

    // Silver
    const silver = silverRows.find((r) => r.karat === 'silver');
    const silverOunce = silverRows.find((r) => r.karat === 'silver_ounce');

    // Bullion
    const bullion: Array<{ key: string; name_ar: string; price: number; change: number | null }> = [];
    for (const k of ['bullion_1g', 'bullion_5g', 'bullion_10g', 'bullion_50g', 'bullion_100g', 'bullion_1oz', 'gold_pound']) {
      const d = findKarat(k);
      if (d && d.price_per_gram > 0) {
        bullion.push({ key: k, name_ar: d.name_ar, price: d.price_per_gram, change: d.change });
      }
    }

    const now = new Date().toISOString();
    return NextResponse.json({
      success: true,
      source: 'database',
      fetched_at: now,
      last_updated: lastUpdated || now,
      prices: {
        karats: allKarats,
        ounce: ounce
          ? {
              price: Number(ounce.price_per_gram),
              change: ounce.change !== null ? Number(ounce.change) : null,
              currency: (ounce.currency as string) || 'USD',
              name_ar: (ounce.name_ar as string) || 'الأونصة',
            }
          : null,
        silver: silver
          ? {
              price_per_gram: Number(silver.price_per_gram),
              change: silver.change !== null ? Number(silver.change) : null,
              currency: (silver.currency as string) || 'EGP',
              name_ar: (silver.name_ar as string) || 'فضة',
            }
          : null,
        silver_ounce: silverOunce
          ? {
              price: Number(silverOunce.price_per_gram),
              change: silverOunce.change !== null ? Number(silverOunce.change) : null,
              currency: (silverOunce.currency as string) || 'EGP',
              name_ar: (silverOunce.name_ar as string) || 'أونصة فضة',
            }
          : null,
        bullion,
      },
    });
  } catch (error) {
    console.error('[GET /api/market/gold] Error:', error);
    return NextResponse.json(
      {
        success: false,
        source: 'database',
        error: 'حدث خطأ أثناء قراءة بيانات الذهب',
        fetched_at: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
