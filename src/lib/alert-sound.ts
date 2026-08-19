'use client';

/* ============================================================
   ALERTS-031: Alert Sound Generator (Web Audio API)
   ============================================================
   - Generates beep sounds without audio files
   - Different tones for different alert directions:
     * up (price above / score above / golden pullback): rising tone
     * down (price below / score below / dead cat): falling tone
     * neutral (divergence): single tone
   ============================================================ */

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContext = new AC();
    } catch {
      return null;
    }
  }
  // Resume if suspended (browser autoplay policy)
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

type AlertDirection = 'up' | 'down' | 'neutral';

interface BeepOptions {
  frequency: number;
  duration: number;
  volume?: number;
  startTime?: number;
}

function playBeep(ctx: AudioContext, opts: BeepOptions): void {
  const { frequency, duration, volume = 0.3, startTime = 0 } = opts;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.value = frequency;

  const t0 = ctx.currentTime + startTime;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(t0);
  osc.stop(t0 + duration);
}

/**
 * Play an alert sound based on the alert direction.
 * - up: rising 2-tone beep (523Hz → 784Hz) — "opportunity"
 * - down: falling 2-tone beep (440Hz → 294Hz) — "danger"
 * - neutral: single mid-tone beep (659Hz)
 */
export function playAlertSound(direction: AlertDirection = 'neutral'): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    if (direction === 'up') {
      // Rising tone: C5 (523Hz) → G5 (784Hz) — pleasant, opportunity
      playBeep(ctx, { frequency: 523.25, duration: 0.15, volume: 0.25, startTime: 0 });
      playBeep(ctx, { frequency: 783.99, duration: 0.25, volume: 0.25, startTime: 0.15 });
    } else if (direction === 'down') {
      // Falling tone: A4 (440Hz) → D4 (294Hz) — warning, danger
      playBeep(ctx, { frequency: 440.0, duration: 0.15, volume: 0.3, startTime: 0 });
      playBeep(ctx, { frequency: 293.66, duration: 0.35, volume: 0.3, startTime: 0.15 });
    } else {
      // Single mid tone: E5 (659Hz) — informational
      playBeep(ctx, { frequency: 659.25, duration: 0.3, volume: 0.25, startTime: 0 });
    }
  } catch {
    // Silent fail — audio not critical
  }
}

/**
 * Test sound button — plays a neutral beep so the user can verify
 * their volume / audio is working.
 */
export function playTestSound(): void {
  playAlertSound('neutral');
}

/**
 * Initialize audio context on first user interaction (required by
 * browser autoplay policies). Call this from a click handler.
 */
export function initAudioOnUserInteraction(): void {
  getAudioContext();
}
