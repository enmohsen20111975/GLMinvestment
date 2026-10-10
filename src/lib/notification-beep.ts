/**
 * ROBO-ADVISOR-P2: Web Audio API Beep — تنبيه صوتي عند ظهور إشارة جديدة
 * =====================================================================
 * يشغّل نغمة قصيرة (beep) زي الواتساب لما إشعار جديد يظهر.
 * الـ AudioContext بيتعمل مرة واحدة وبيتعاد استخدامه (lazy init).
 * لو المتصفح مش بيدعم Web Audio API → ساكت بدون خطأ.
 */

let _audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!_audioCtx) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return null;
      _audioCtx = new Ctx();
    }
    // بعض المتصفحات بتوقف الـ context لحد ما المستخدم يتفاعل
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume().catch(() => {});
    }
    return _audioCtx;
  } catch { // silent fallback (safe-by-design)
    return null;
  }
}

export type BeepType = 'signal' | 'alert' | 'success' | 'error';

/**
 * يشغّل beep حسب النوع:
 * - signal: نغتين تصاعديتين (إشارة جديدة) — الأخضر/الأزرق
 * - alert: نغمة واحدة طويلة (تحذير)
 * - success: 3 نغمات سريعة (نجاح)
 * - error: نغمة نازلة (خطأ)
 */
export function playBeep(type: BeepType = 'signal'): void {
  const ctx = getAudioCtx();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const presets: Record<BeepType, { freq: number; dur: number; vol: number }[]> = {
      // نغتين تصاعديتين: 880Hz ثم 1320Hz (إشارة شراء/بيع قوية)
      signal: [
        { freq: 880, dur: 0.12, vol: 0.18 },
        { freq: 1320, dur: 0.18, vol: 0.18 },
      ],
      // نغمة طويلة واحدة: 660Hz (تحذير)
      alert: [{ freq: 660, dur: 0.35, vol: 0.22 }],
      // 3 نغمات سريعة: 880, 1100, 1320 (نجاح — وصل الهدف)
      success: [
        { freq: 880, dur: 0.08, vol: 0.16 },
        { freq: 1100, dur: 0.08, vol: 0.16 },
        { freq: 1320, dur: 0.14, vol: 0.18 },
      ],
      // نغمة نازلة: 660Hz ثم 440Hz (خطأ — ضرب وقف)
      error: [
        { freq: 660, dur: 0.14, vol: 0.2 },
        { freq: 440, dur: 0.22, vol: 0.2 },
      ],
    };

    let offset = 0;
    for (const note of presets[type]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.freq;
      // Envelope: attack + decay سلس (بدون طقطقة)
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(note.vol, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + note.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + note.dur + 0.02);
      offset += note.dur * 0.9; // تداخل بسيط بين النغمات
    }
  } catch { // silent fallback (safe-by-design)
    // ساكت لو أي حاجة فشلت — الصوت مش critical
  }
}

/**
 * يفعّل الـ AudioContext بعد أول تفاعل من المستخدم (click/tap).
 * لازم عشان سياسات autoplay في المتصفحات الحديثة.
 */
export function primeAudioOnUserGesture(): void {
  if (typeof window === 'undefined') return;
  const prime = () => {
    getAudioCtx();
  };
  window.addEventListener('click', prime, { once: true });
  window.addEventListener('touchstart', prime, { once: true });
  window.addEventListener('keydown', prime, { once: true });
}
