/**
 * tts.ts — تحويل النص إلى صوت محلي بالكامل (Piper TTS)
 * ===========================================================
 *
 * بديل z-ai-web-dev-sdk.audio.tts (Z.ai) اللي كان بيحتاج اشتراك.
 * Piper بيشتغل offline بالكامل بـ ONNX، من غير API ولا مفتاح.
 *
 * الـ binary:  .venv/bin/piper        (pip install piper-tts)
 * الأصوات:     voices/<locale>/<name>/<quality>/*.onnx + *.onnx.json
 *
 * مفيش ffmpeg ولا CUDA لازم — الموديل بيشتغل على CPU.
 */

import { execFile } from 'child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import path from 'path';

// ============================================================
// 1. سجل الأصوات
// ============================================================

export interface LocalVoice {
  id: string;
  label: string;
  locale: string;
  gender: 'male' | 'female';
  /** المسار النسبي للملف .onnx جوه مجلد voices/ */
  modelRelPath: string;
  quality: 'low' | 'medium' | 'high';
  /** مدّةSynthesis تقريبية للحرف بالثواني — للعرض في الـ UI. */
  note?: string;
}

/**
 * كل الأصوات العربية المتاحة محلياً.
 *
 * Piper بيوفّر صوت عربي واحد بس (kareem — عربي أردني، ذكر).
 * لو نزّلنا أكتر voices.json من rhasspy/piper-voices ضيف هنا.
 *
 * ملاحظة على الجودة: دي موديل medium/22050Hz. جودته أعلى بكتير من
 * espeak، بس **مش** على مستوى Z.ai. للإعلانات القصيرة (10-15 ثانية)
 *-output مقبول، بس لو عايز صوت تجاري محترف هتحتاج ElevenLabs/Google
 * TTS — وده مدفوع، مش من ضمن Local.
 */
export const LOCAL_VOICES: LocalVoice[] = [
  {
    id: 'ar_JO-kareem-medium',
    label: 'كريم (عربي — متوسط)',
    locale: 'ar',
    gender: 'male',
    modelRelPath: 'ar_JO/kareem/medium/ar_JO-kareem-medium.onnx',
    quality: 'medium',
    note: 'صوت عربي محلي بالكامل — 22kHz',
  },
  {
    id: 'ar_JO-kareem-low',
    label: 'كريم (عربي — سريع)',
    locale: 'ar',
    gender: 'male',
    modelRelPath: 'ar_JO/kareem/low/ar_JO-kareem-low.onnx',
    quality: 'low',
    note: 'نفس الصوت بإعدادات أخف',
  },
];

export const DEFAULT_VOICE_ID = process.env.TTS_VOICE || LOCAL_VOICES[0].id;

const PROJECT_ROOT = process.cwd();
const VOICES_DIR = path.join(PROJECT_ROOT, 'voices');
const PIPER_BIN = path.join(PROJECT_ROOT, '.venv', 'bin', 'piper');

export function getVoice(id: string): LocalVoice {
  return LOCAL_VOICES.find((v) => v.id === id) || LOCAL_VOICES[0];
}

/** هل الـ TTS جاهز فعلاً؟ (باستخدمه في /api/ai/models كـ status) */
export function isTtsAvailable(): boolean {
  if (!existsSync(PIPER_BIN)) return false;
  return LOCAL_VOICES.some((v) => existsSync(path.join(VOICES_DIR, v.modelRelPath)));
}

/** الأصوات اللي ملفاتها موجودة على القرص دلوقتي. */
export function availableVoices(): LocalVoice[] {
  return LOCAL_VOICES.filter((v) => existsSync(path.join(VOICES_DIR, v.modelRelPath)));
}

// ============================================================
// 2. التوليد
// ============================================================

export class TtsUnavailableError extends Error {
  constructor() {
    super(
      'محرك الصوت المحلي (Piper) مش مثبّت. ' +
        'شغّل: pip install piper-tts && نزّل voice model في voices/'
    );
    this.name = 'TtsUnavailableError';
  }
}

/**
 * حوّل speed من مقياس الواجهة (0.5-2.0، 1 = طبيعي) لـ length-scale بتاع Piper.
 *
 * Piper: length_scale أعلى = أبطأ. relationship مقلوب:
 *   speed 0.5 → length_scale 2.0
 *   speed 1.0 → length_scale 1.0
 *   speed 2.0 → length_scale 0.5
 */
function speedToLengthScale(speed: number): number {
  const clamped = Math.min(2, Math.max(0.5, speed || 1));
  return Number((1 / clamped).toFixed(3));
}

export interface SynthesizeOptions {
  text: string;
  voiceId?: string;
  /** 0.5 (بطيء) .. 2.0 (سريع)، 1.0 = طبيعي */
  speed?: number;
}

export interface SynthesizeResult {
  wav: Buffer;
  sampleRate: number;
  durationSec: number;
}

/**
 * ولّد WAV من نص عربي.
 * بيرمي TtsUnavailableError لو Piper مش متثبت.
 */
export async function synthesizeWav(opts: SynthesizeOptions): Promise<SynthesizeResult> {
  if (!existsSync(PIPER_BIN)) throw new TtsUnavailableError();

  const voice = getVoice(opts.voiceId || DEFAULT_VOICE_ID);
  const modelPath = path.join(VOICES_DIR, voice.modelRelPath);
  const configPath = `${modelPath}.json`;

  if (!existsSync(modelPath)) throw new TtsUnavailableError();
  if (!existsSync(configPath)) {
    throw new Error(`ملف إعدادات الصوت مش موجود: ${configPath}`);
  }

  const speed = Number(opts.speed ?? 1);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
    throw new Error('السرعة لازم تكون بين 0.5 و 2.0');
  }

  // ملفات مؤقتة لكل طلب — ضروري مع POST المتزامن
  const token = randomBytes(8).toString('hex');
  const tmpDir = path.join(PROJECT_ROOT, 'logs', 'tts-tmp');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const inFile = path.join(tmpDir, `in-${token}.txt`);
  const outFile = path.join(tmpDir, `out-${token}.wav`);

  const text = String(opts.text || '').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('النص فاضي');

  try {
    writeFileSync(inFile, text, 'utf8');

    const args = [
      '-m', modelPath,
      '-c', configPath,
      '-i', inFile,
      '-f', outFile,
      '--length_scale', String(speedToLengthScale(speed)),
    ];

    await new Promise<void>((resolve, reject) => {
      execFile(
        PIPER_BIN,
        args,
        { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          if (err) {
            reject(new Error(`Piper فشل: ${String(stderr || err.message).slice(0, 300)}`));
            return;
          }
          resolve();
        },
      );
    });

    if (!existsSync(outFile)) throw new Error('Piper ما أنتجش ملف صوت');

    const wav = readFileSync(outFile);
    if (wav.length < 45) throw new Error('ملف الصوت فاضي أو ناقص');

    // نقرأ الـ header عشان نرجّع المدة الدقيقة للـ UI
    const sampleRate = wav.readUInt32LE(24);
    const numChannels = Math.max(1, wav.readUInt16LE(22));
    const bitsPerSample = Math.max(8, wav.readUInt16LE(34));
    const bytesPerSecond = sampleRate * numChannels * (bitsPerSample / 8);
    const durationSec = bytesPerSecond > 0 ? (wav.length - 44) / bytesPerSecond : 0;

    return { wav, sampleRate, durationSec: Math.round(durationSec * 100) / 100 };
  } finally {
    for (const f of [inFile, outFile]) {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch { // silent fallback (safe-by-design)
        /* cleanup best-effort */
      }
    }
  }
}

/**
 * دمج عدة WAV chunks في WAV واحد.
 *
 * Piper بيقسم النص لو طويل، ولو رجعنا chunk واحد بس كان الصوت مقطوع.
 * كل الـ chunks من نفس الـ voice فـ sample rate واحد — نقدر ندمج PCM
 * مباشرة ونكتب header جديد.
 */
export function concatWavs(parts: Buffer[]): Buffer {
  if (parts.length === 0) throw new Error('مفيش chunks للدمج');
  if (parts.length === 1) return parts[0];

  const first = parts[0];
  const sampleRate = first.readUInt32LE(24);
  const numChannels = Math.max(1, first.readUInt16LE(22));
  const bitsPerSample = Math.max(8, first.readUInt16LE(34));

  const pcmParts = parts.map((b) => b.subarray(44));
  const totalPcm = Buffer.concat(pcmParts);
  const dataLen = totalPcm.length;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);

  return Buffer.concat([header, totalPcm]);
}

/** حد النص نقسّم عنده — Piper بيبطئ مع النص الطويل جداً. */
export function splitForTts(text: string, maxLen = 400): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean ? [clean] : [];

  const sentences = clean.match(/[^.!?؟،]+[.!?؟،]+/g) || [clean];
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length <= maxLen) {
      cur += s;
    } else {
      if (cur.trim()) chunks.push(cur.trim());
      // جملة واحدة أطول من maxLen → نقسّمها بالكلمات
      if (s.length > maxLen) {
        const words = s.split(' ');
        let piece = '';
        for (const w of words) {
          if ((piece + ' ' + w).length <= maxLen) {
            piece = piece ? piece + ' ' + w : w;
          } else {
            if (piece) chunks.push(piece);
            piece = w;
          }
        }
        cur = piece ? piece + ' ' : '';
      } else {
        cur = s;
      }
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}
