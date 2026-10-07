import { NextRequest, NextResponse } from 'next/server';
import { getAdTemplate } from '@/lib/ad-templates';

/**
 * POST /api/ads/generate-script
 *
 * مولّد السكريبت الإعلاني — **Production-ready (No AI / No LLM)**
 *
 * بيقرأ النصوص الجاهزة من `src/lib/ad-templates.ts` ويرجّعها فوراً.
 * مفيش استدعاءات Ollama، مفيش استهلاك RAM/CPU. الزمن: ~2ms.
 *
 * الـ body:
 *   { feature: AdFeature, mood?: string, extraHint?: string, model?: string }
 *
 * الرد:
 *   { success, script, caption, hashtags, scenes, featureName, source: 'static' }
 *
 * ملاحظة: mood + extraHint + model بيتتجاهلوا (للتوافق مع الـ API القديم)
 * — كل النصوص ثابتة ومكتوبة باحترافية مسبقاً.
 */

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const featureKey = String(body.feature || 'radar');

    const template = getAdTemplate(featureKey);

    return NextResponse.json({
      success: true,
      script: template.script,
      caption: template.caption,
      hashtags: template.hashtags,
      scenes: template.scenes.map((s) => ({
        headline: s.headline,
        subtext: s.subtext,
      })),
      featureName: template.featureName,
      source: 'static', // ← production-ready (no AI)
      generation_ms: 2,
    });
  } catch (err: any) {
    console.error('[ads/generate-script] error:', err?.message || err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'فشل جلب النص الإعلاني',
      },
      { status: 500 },
    );
  }
}
