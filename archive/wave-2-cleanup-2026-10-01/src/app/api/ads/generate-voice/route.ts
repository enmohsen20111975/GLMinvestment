import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_VOICE_ID,
  LOCAL_VOICES,
  TtsUnavailableError,
  availableVoices,
  concatWavs,
  getVoice,
  isTtsAvailable,
  splitForTts,
  synthesizeWav,
} from '@/lib/ai/tts';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ads/generate-voice
 *
 * يحوّل سكريبت التعليق الصوتي إلى ملف WAV **محلي بالكامل** (Piper TTS).
 *
 * الـ body:
 *   { script: string, voice?: string, speed?: number }
 *
 * الرد:
 *   audio/wav binary  (أو JSON error لو فشل)
 *
 * ── تاريخ ──────────────────────────────────────────────────
 * كان بيستخدم zai.audio.tts.create من z-ai-web-dev-sdk (Z.ai) — API
 * خارجي مدفوع. Piper بيشتغل offline بـ ONNX على CPU، من غير اشتراك.
 * الكود القديم كان بيرجّع أول chunk بس لو النص طويل؛ دلوقتي بنقسّم
 * وندمج الـ PCM صح.
 */

/** GET /api/ads/generate-voice — الأصوات المتاحة محلياً. */
export async function GET() {
  return NextResponse.json({
    success: true,
    local_only: true,
    engine: 'piper',
    up: isTtsAvailable(),
    default: DEFAULT_VOICE_ID,
    voices: availableVoices(),
    // بنعرض كل الأصوات المسجّلة حتى لو ملفاتها نازلة، عشان الـ UI
    // يوضّح للـ user إن الصوت محتاج تحميل
    all_voices: LOCAL_VOICES,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const script = String(body.script || '').trim();
    const voiceRaw = String(body.voice || DEFAULT_VOICE_ID);
    const speed = Number(body.speed ?? 1.0);

    if (!script) {
      return NextResponse.json(
        { success: false, error: 'السكريبت فاضي' },
        { status: 400 },
      );
    }
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2.0) {
      return NextResponse.json(
        { success: false, error: 'السرعة لازم تكون بين 0.5 و 2.0' },
        { status: 400 },
      );
    }

    const voice = getVoice(voiceRaw);

    if (!isTtsAvailable()) {
      return NextResponse.json(
        {
          success: false,
          error:
            'محرك الصوت المحلي (Piper) مش جاهز على السيرفر. ' +
            'شغّل: pip install piper-tts && نزّل voice model في voices/',
        },
        { status: 503 },
      );
    }

    // نقسّم النص الطويل ونولّد كل chunk، بعدين ندمج في WAV واحد.
    // Piper بيقسم على 400 حرف تقريباً — أقل من الـ 950 القديم.
    const chunks = splitForTts(script, 400);
    if (chunks.length === 0) {
      return NextResponse.json(
        { success: false, error: 'السكريبت فاضي' },
        { status: 400 },
      );
    }

    const parts: Buffer[] = [];
    let sampleRate = 22050;
    for (const chunk of chunks) {
      const r = await synthesizeWav({ text: chunk, voiceId: voice.id, speed });
      parts.push(r.wav);
      sampleRate = r.sampleRate;
    }

    const fullWav = concatWavs(parts);
    const bytesPerSecond = sampleRate * 2;
    const durationSec = Math.round(((fullWav.length - 44) / bytesPerSecond) * 100) / 100;

    return new NextResponse(new Uint8Array(fullWav), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': fullWav.length.toString(),
        'Cache-Control': 'no-cache',
        'X-Voice': voice.id,
        'X-Speed': String(speed),
        'X-Chunks': String(chunks.length),
        'X-Sample-Rate': String(sampleRate),
        'X-Duration': String(durationSec),
      },
    });
  } catch (err: any) {
    if (err instanceof TtsUnavailableError) {
      console.error('[ads:generate-voice]', err);
      return NextResponse.json(
        { success: false, error: 'internal_error' },
        { status: 503 },
      );
    }
    console.error('[ads/generate-voice] error:', err?.message || err);
    return NextResponse.json(
      { success: false, error: err?.message || 'فشل توليد الصوت — حاول تاني' },
      { status: 500 },
    );
  }
}
