/**
 * GET /api/app/version
 * =====================
 * Flutter compat endpoint — نسخة التطبيق + force_update.
 *
 * مهم جداً لـ force_update_service في الـ Flutter app.
 *
 * Reads from env vars (override in production):
 *   - APP_MIN_VERSION     (default: '2.4.0')
 *   - APP_LATEST_VERSION  (default: '2.4.0')
 *   - APP_UPDATE_URL      (default: Play Store URL)
 *   - APP_FORCE_UPDATE     (default: 'false')
 *
 * Response:
 *   {
 *     success: true,
 *     min_version: '2.4.0',
 *     latest_version: '2.4.0',
 *     update_url: 'https://play.google.com/...',
 *     force_update: false,
 *     release_notes: { ... }
 *   }
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ReleaseNotes {
  version: string;
  features: string[];
  fixes: string[];
  breaking?: boolean;
}

const DEFAULT_RELEASE_NOTES: ReleaseNotes[] = [
  {
    version: '2.4.0',
    features: [
      'دعم Dual Track predictions',
      'شاشة WealthCharts للمحفظة',
      'تنبيهات الذهب مع الأسعار اللحظية',
    ],
    fixes: [
      'إصلاح مشكلة crash عند فتح شاشة المحفظة',
      'تحسين أداء تحميل الأخبار',
    ],
    breaking: false,
  },
];

function parseBool(v: string | undefined, fallback = false): boolean {
  if (!v) return fallback;
  const s = v.toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes';
}

export async function GET() {
  try {
    const minVersion = process.env.APP_MIN_VERSION || '2.4.0';
    const latestVersion = process.env.APP_LATEST_VERSION || '2.4.0';
    const updateUrl = process.env.APP_UPDATE_URL || 'https://play.google.com/store/apps/details?id=com.glminvestment.app';
    const forceUpdate = parseBool(process.env.APP_FORCE_UPDATE, false);

    // latest release notes
    const releaseNotes = DEFAULT_RELEASE_NOTES.find(r => r.version === latestVersion) || DEFAULT_RELEASE_NOTES[0];

    return NextResponse.json({
      success: true,
      min_version: minVersion,
      latest_version: latestVersion,
      update_url: updateUrl,
      force_update: forceUpdate,
      release_notes: releaseNotes,
      generated_at: new Date().toISOString(),
      // metadata للـ Flutter cache
      cache_ttl_seconds: 3600, // 1 ساعة
    });
  } catch (e) {
    console.error('[GET /api/app/version] Error:', e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        min_version: '2.4.0',
        latest_version: '2.4.0',
        update_url: 'https://play.google.com/store/apps/details?id=com.glminvestment.app',
        force_update: false,
      },
      { status: 500 }
    );
  }
}
