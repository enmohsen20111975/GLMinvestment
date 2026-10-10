import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { getAdTemplate } from '@/lib/ad-templates';

/**
 * POST /api/ads/capture-screenshot
 *
 * بيستخدم Playwright لأخذ **تتابع screenshots** من المسارات الحية للميزة.
 * - بياخد: { feature: string, viewport?: 'mobile'|'desktop', refresh?: boolean }
 * - بيرجّع: { success, screenshots: [{ url, route, sceneIndex }] }
 *
 * الـ screenshots بيتخزّنوا في /public/ad-screenshots/ وبيرجّع URLs نسبية.
 * كل screenshot بيتسمّى: <feature>-<sceneIndex>-mobile.png
 *
 * Production-ready: مفيش AI، مفيش LLM — Playwright بس (headless Chromium).
 */

interface SceneScreenshot {
  url: string;
  route: string;
  sceneIndex: number;
  width: number;
  height: number;
}

interface CaptureResult {
  success: boolean;
  screenshots?: SceneScreenshot[];
  capturedAt?: string;
  error?: string;
}

// viewport ثابت للـ mobile (iPhone 12 Pro)
const MOBILE_VIEWPORT = { width: 414, height: 896 };

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const featureKey = String(body.feature || 'radar');
    const forceRefresh = Boolean(body.refresh);
    const viewportMode = String(body.viewport || 'mobile');

    const template = getAdTemplate(featureKey);
    const safeViewport = viewportMode === 'desktop' ? 'desktop' : 'mobile';

    // المسارات اللي هنبعت لها Playwright (نأخذ أول 3 scenes اللي ليها routes)
    const scenesWithRoutes = template.scenes
      .map((s, i) => ({ scene: s, index: i }))
      .filter((x) => x.scene.route);

    // لو مفيش routes (نادر)، نستخدم route افتراضي
    const routesToCapture = scenesWithRoutes.length > 0
      ? scenesWithRoutes.slice(0, 3) // max 3 screenshots
      : [{ scene: { route: '/#liquidity-radar' }, index: 0 }];

    const baseUrl = process.env.SCREENSHOT_BASE_URL || 'http://localhost:3001';
    const outputDir = path.join(process.cwd(), 'public', 'ad-screenshots');

    // فحص الكاش (لو مش refresh وكل الـ screenshots موجودة، نرجّعها فوراً)
    if (!forceRefresh) {
      const cached: SceneScreenshot[] = [];
      let allCached = true;
      for (const { scene, index } of routesToCapture) {
        const filename = `${featureKey}-${index}-${safeViewport}.png`;
        const filepath = path.join(outputDir, filename);
        try {
          const stat = await fs.stat(filepath);
          if (stat.size > 5000) {
            cached.push({
              url: `/ad-screenshots/${filename}`,
              route: scene.route!,
              sceneIndex: index,
              width: MOBILE_VIEWPORT.width,
              height: MOBILE_VIEWPORT.height,
            });
            continue;
          }
        } catch { // silent fallback (safe-by-design)
          /* file not found */
        }
        allCached = false;
        break;
      }
      if (allCached && cached.length > 0) {
        return NextResponse.json({
          success: true,
          screenshots: cached,
          capturedAt: new Date().toISOString(),
          cached: true,
        } satisfies CaptureResult & { cached: boolean });
      }
    }

    // استخدام Playwright
    const { chromium } = await import('playwright');

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      viewport: MOBILE_VIEWPORT,
      deviceScaleFactor: 2,
      locale: 'ar-EG',
      timezoneId: 'Africa/Cairo',
      isMobile: true,
      hasTouch: true,
    });

    const page = await context.newPage();

    // نأكد إن مجلد الإخراج موجود
    await fs.mkdir(outputDir, { recursive: true });

    const screenshots: SceneScreenshot[] = [];

    for (const { scene, index } of routesToCapture) {
      const fullUrl = baseUrl + scene.route;
      try {
        await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);

        // إغلاق dialogs
        try {
          await page.evaluate(() => {
            const guideClose = document.querySelector(
              '[role="dialog"] button[aria-label*="إغلاق"], [role="dialog"] button:has(svg)',
            );
            if (guideClose) (guideClose as HTMLElement).click();
            const skipBtn = Array.from(document.querySelectorAll('button')).find(
              (b) =>
                b.textContent?.includes('تخطي') || b.textContent?.includes('ابدأ'),
            );
            if (skipBtn) (skipBtn as HTMLElement).click();
          });
          await page.waitForTimeout(600);
        } catch { // silent fallback (safe-by-design)
          /* ignore */
        }

        const buffer = await page.screenshot({
          type: 'png',
          fullPage: false,
        });

        const filename = `${featureKey}-${index}-${safeViewport}.png`;
        const filepath = path.join(outputDir, filename);
        await fs.writeFile(filepath, buffer);

        screenshots.push({
          url: `/ad-screenshots/${filename}`,
          route: scene.route!,
          sceneIndex: index,
          width: MOBILE_VIEWPORT.width,
          height: MOBILE_VIEWPORT.height,
        });
      } catch (err: any) {
        console.error(`[capture-screenshot] scene ${index} (${scene.route}) failed:`, err?.message);
        // نكمّل باقي الـ scenes حتى لو واحد فشل
      }
    }

    await browser.close();

    if (screenshots.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'فشل التقاط كل الـ screenshots — تأكد إن الخادم شغال',
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      screenshots,
      capturedAt: new Date().toISOString(),
      cached: false,
    } satisfies CaptureResult & { cached: boolean });
  } catch (err: any) {
    console.error('[ads/capture-screenshot] error:', err?.message || err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'فشل التقاط الـ screenshots',
      },
      { status: 500 },
    );
  }
}
