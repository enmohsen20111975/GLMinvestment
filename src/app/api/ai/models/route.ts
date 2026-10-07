import { NextResponse } from 'next/server';
import {
  DEFAULT_TEXT_MODEL,
  OLLAMA_URL,
  isOllamaUp,
  listTextModels,
} from '@/lib/ai/ollama';
import { DEFAULT_VOICE_ID, availableVoices, isTtsAvailable } from '@/lib/ai/tts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ai/models
 *
 * قائمة بكل النماذج المحلية المتاحة فعلياً على السيرفر.
 * الـ UI بيقرأ من هنا عشان يعرض اختيار حقيقي مش hardcoded —
 * لو نزّلت موديل Ollama جديد أو صوت Piper جديد هيظهر لوحده.
 *
 * مفيش أي API خارجي هنا.
 */
export async function GET() {
  const [ollamaUp, models] = await Promise.all([isOllamaUp(), listTextModels()]);
  const ttsUp = isTtsAvailable();
  const voices = availableVoices();

  return NextResponse.json({
    success: true,
    local_only: true,
    ollama: {
      up: ollamaUp,
      url: OLLAMA_URL,
      default: DEFAULT_TEXT_MODEL,
      models,
      // لو مفيش موديل خالص، الـ UI يقدر يعرض رسالة بدل dropdown فاضي
      hint: models.length === 0
        ? 'مفيش موديلات على Ollama. شغّل: ollama pull glm-fast'
        : undefined,
    },
    tts: {
      up: ttsUp,
      engine: 'piper',
      default: DEFAULT_VOICE_ID,
      voices,
      hint: ttsUp
        ? undefined
        : 'محرك الصوت المحلي مش جاهز. شغّل: pip install piper-tts && نزّل voice model في voices/',
    },
  });
}
