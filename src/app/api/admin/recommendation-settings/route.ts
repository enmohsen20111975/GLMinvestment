import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateAdminToken, verifyAdminToken } from '@/lib/admin-auth-server';

interface DailyRecommendationSettings {
  egx: number;
  ksa: number;
  kse: number;
  dfm: number;
  crypto: number;
  forex: number;
}

// Default settings
const DEFAULT_SETTINGS: DailyRecommendationSettings = {
  egx: 5,
  ksa: 3,
  kse: 2,
  dfm: 2,
  crypto: 3,
  forex: 2,
};

/**
 * GET /api/admin/recommendation-settings
 * Get daily recommendation settings
 */
export async function GET(request: NextRequest) {
  try {
    // Verify admin token
    const authHeader = request.headers.get('x-admin-token');
    if (!authHeader || !verifyAdminToken(authHeader)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Try to get settings from database
    const dbAny = db as any;
    
    // Check if SystemConfig table exists
    let settings = DEFAULT_SETTINGS;
    
    try {
      const config = await dbAny.systemConfig.findUnique({
        where: { key: 'daily_recommendation_settings' }
      });
      
      if (config && config.value) {
        settings = typeof config.value === 'string' ? JSON.parse(config.value) : config.value;
      }
    } catch (dbError) {
      // Table might not exist, use defaults
      console.log('[recommendation-settings] Using default settings');
    }

    return NextResponse.json({
      success: true,
      settings,
    });
  } catch (error) {
    console.error('[recommendation-settings] Error:', error);
    return NextResponse.json({
      success: true,
      settings: DEFAULT_SETTINGS,
    });
  }
}

/**
 * POST /api/admin/recommendation-settings
 * Save daily recommendation settings
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin token
    const authHeader = request.headers.get('x-admin-token');
    if (!authHeader || !verifyAdminToken(authHeader)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { settings } = body as { settings: DailyRecommendationSettings };

    if (!settings) {
      return NextResponse.json({ success: false, error: 'No settings provided' }, { status: 400 });
    }

    // Validate settings
    const validSettings: DailyRecommendationSettings = {
      egx: Math.max(0, Math.min(20, Number(settings.egx) || 0)),
      ksa: Math.max(0, Math.min(20, Number(settings.ksa) || 0)),
      kse: Math.max(0, Math.min(20, Number(settings.kse) || 0)),
      dfm: Math.max(0, Math.min(20, Number(settings.dfm) || 0)),
      crypto: Math.max(0, Math.min(20, Number(settings.crypto) || 0)),
      forex: Math.max(0, Math.min(20, Number(settings.forex) || 0)),
    };

    // Try to save to database
    const dbAny = db as any;
    
    try {
      // Check if SystemConfig table exists by trying to query it
      await dbAny.systemConfig.upsert({
        where: { key: 'daily_recommendation_settings' },
        create: {
          key: 'daily_recommendation_settings',
          value: JSON.stringify(validSettings),
        },
        update: {
          value: JSON.stringify(validSettings),
        },
      });
    } catch (dbError) {
      // Table might not exist, save to file system as fallback
      console.log('[recommendation-settings] Database not available, using file storage');
      
      const fs = await import('fs');
      const path = await import('path');
      const settingsPath = path.join(process.cwd(), 'db', 'recommendation-settings.json');
      
      // Ensure db directory exists
      const dbDir = path.dirname(settingsPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      
      fs.writeFileSync(settingsPath, JSON.stringify(validSettings, null, 2));
    }

    return NextResponse.json({
      success: true,
      settings: validSettings,
      message: 'تم حفظ الإعدادات بنجاح',
    });
  } catch (error) {
    console.error('[recommendation-settings] Error saving:', error);
    return NextResponse.json({
      success: false,
      error: 'فشل في حفظ الإعدادات',
    }, { status: 500 });
  }
}
