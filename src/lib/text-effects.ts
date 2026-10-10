/**
 * text-effects.ts — نظام تأثيرات نصية للفيديو (Canvas animation)
 * ====================================================================
 *
 * تأثيرات قابلة للتحكم بالكامل للمؤشر الـ progress (0..1):
 *   - fade: ظهور تدريجي
 *   - slideUp: صعود من تحت
 *   - slideRight: انزلاق من اليمين
 *   - zoomIn: تكبير من صغير لكبير
 *   - typewriter: كتابة حرف بحرف
 *   - marquee: نص متحرك أفقياً (للهاشتاجات)
 *   - bounce: نطّة عند الظهور
 *   - glow: توهج نابض
 *
 * كل تأثير ليه easing functions:
 *   - linear / easeOut / easeInOut / easeOutBounce
 */

export type TextEffect =
  | 'fade'
  | 'slideUp'
  | 'slideRight'
  | 'zoomIn'
  | 'typewriter'
  | 'marquee'
  | 'bounce'
  | 'glow';

export type Easing = 'linear' | 'easeOut' | 'easeInOut' | 'easeOutBounce';

export interface TextAnimationConfig {
  text: string;
  effect: TextEffect;
  /** مدة الظهور بالثواني (default: 0.6) */
  duration?: number;
  /** تأخير قبل البدء بالثواني (default: 0) */
  delay?: number;
  /** easing function (default: easeOut) */
  easing?: Easing;
  /** لون النص */
  color?: string;
  /** حجم الخط (px) */
  fontSize?: number;
  /** وزن الخط */
  fontWeight?: number;
  /** glow color (للـ glow effect) */
  glowColor?: string;
}

// ─── Easing functions ───

function applyEasing(t: number, easing: Easing): number {
  switch (easing) {
    case 'linear': return t;
    case 'easeOut': return 1 - Math.pow(1 - t, 3);
    case 'easeInOut': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'easeOutBounce': {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
      if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }
    default: return 1 - Math.pow(1 - t, 3);
  }
}

/**
 * حساب الـ progress المحلي (0..1) للنص ده بالظبط
 * بناءً على الـ globalProgress بتاع الـ scene كله.
 *
 * @param globalProgress تقدّم الـ scene كله (0..1)
 * @param sceneDuration مدة الـ scene بالثواني
 * @param config إعدادات النص (delay + duration)
 */
function getLocalProgress(
  globalProgress: number,
  sceneDuration: number,
  config: TextAnimationConfig,
): number {
  const delay = config.delay ?? 0;
  const duration = config.duration ?? 0.6;
  const elapsed = globalProgress * sceneDuration - delay;
  if (elapsed <= 0) return 0;
  if (elapsed >= duration) return 1;
  return applyEasing(elapsed / duration, config.easing ?? 'easeOut');
}

/**
 * رسم نص بتأثير على الـ Canvas
 *
 * @param ctx canvas context
 * @param config إعدادات النص + التأثير
 * @param x إحداثي X
 * @param y إحداثي Y
 * @param globalProgress تقدّم الـ scene (0..1)
 * @param sceneDuration مدة الـ scene بالثواني
 * @param align محاذاة النص (default: center)
 */
export function drawAnimatedText(
  ctx: CanvasRenderingContext2D,
  config: TextAnimationConfig,
  x: number,
  y: number,
  globalProgress: number,
  sceneDuration: number,
  align: CanvasTextAlign = 'center',
): void {
  const localProgress = getLocalProgress(globalProgress, sceneDuration, config);
  if (localProgress <= 0) return;

  const fontSize = config.fontSize ?? 32;
  const fontWeight = config.fontWeight ?? 700;
  const color = config.color ?? '#ffffff';
  const text = config.text;

  ctx.save();
  ctx.font = `${fontWeight} ${fontSize}px system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  switch (config.effect) {
    case 'fade': {
      ctx.globalAlpha = localProgress;
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      break;
    }

    case 'slideUp': {
      const offsetY = (1 - localProgress) * 40;
      ctx.globalAlpha = localProgress;
      ctx.fillStyle = color;
      ctx.fillText(text, x, y + offsetY);
      break;
    }

    case 'slideRight': {
      const offsetX = (1 - localProgress) * 60;
      ctx.globalAlpha = localProgress;
      ctx.fillStyle = color;
      ctx.fillText(text, x - offsetX, y);
      break;
    }

    case 'zoomIn': {
      const scale = 0.3 + localProgress * 0.7;
      ctx.globalAlpha = localProgress;
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.fillStyle = color;
      ctx.fillText(text, 0, 0);
      break;
    }

    case 'typewriter': {
      // نعرض جزء من النص بنسبة localProgress
      const charCount = Math.floor(text.length * localProgress);
      const visibleText = text.slice(0, charCount);
      ctx.fillStyle = color;
      ctx.fillText(visibleText, x, y);
      // cursor "|" بيبقى ظاهر لحد ما النص يخلّص
      if (localProgress < 1 && Math.floor(Date.now() / 400) % 2 === 0) {
        const cursorX = x + ctx.measureText(visibleText).width * (align === 'center' ? 0.5 : 1) + 4;
        ctx.fillStyle = color;
        ctx.fillText('|', cursorX, y);
      }
      break;
    }

    case 'marquee': {
      // النص بيتحرك من اليمين لليسار
      const textWidth = ctx.measureText(text).width;
      const screenWidth = ctx.canvas.width;
      const startX = screenWidth + textWidth / 2;
      const endX = -textWidth / 2;
      const currentX = startX + (endX - startX) * localProgress;
      ctx.globalAlpha = Math.min(1, localProgress * 2) * Math.min(1, (1 - localProgress) * 2 + 0.5);
      ctx.fillStyle = color;
      ctx.fillText(text, currentX, y);
      break;
    }

    case 'bounce': {
      // bounce: بيظهر مع نطّة
      const scale = localProgress < 0.5 ? localProgress * 2 : 1 - (localProgress - 0.5) * 0.3;
      ctx.globalAlpha = Math.min(1, localProgress * 2);
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.fillStyle = color;
      ctx.fillText(text, 0, 0);
      break;
    }

    case 'glow': {
      // glow: توهج نابض
      const pulse = 0.5 + 0.5 * Math.sin(localProgress * Math.PI * 4);
      ctx.globalAlpha = localProgress;
      ctx.shadowColor = config.glowColor ?? color;
      ctx.shadowBlur = 20 + pulse * 20;
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      ctx.shadowBlur = 0;
      break;
    }

    default: {
      ctx.globalAlpha = localProgress;
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    }
  }

  ctx.restore();
}

/**
 * رسم نص متعدد الأسطر بتأثير (slide/typewriter)
 */
export function drawAnimatedMultilineText(
  ctx: CanvasRenderingContext2D,
  text: string,
  config: TextAnimationConfig,
  x: number,
  startY: number,
  lineHeight: number,
  globalProgress: number,
  sceneDuration: number,
  align: CanvasTextAlign = 'center',
): void {
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const lineConfig = { ...config, text: line, delay: (config.delay ?? 0) + i * 0.15 };
    drawAnimatedText(ctx, lineConfig, x, startY + i * lineHeight, globalProgress, sceneDuration, align);
  });
}

// ─── Presets جاهزة ───

export const EFFECT_PRESETS = {
  /** عنوان رئيسي يظهر بـ zoomIn */
  headline: { effect: 'zoomIn' as TextEffect, duration: 0.8, easing: 'easeOut' as Easing, fontWeight: 800, fontSize: 56 },
  /** نص فرعي يصعد من تحت */
  subtext: { effect: 'slideUp' as TextEffect, duration: 0.6, delay: 0.2, easing: 'easeOut' as Easing, fontWeight: 600, fontSize: 36 },
  /** نقطة رئيسية بتظهر بـ typewriter */
  bullet: { effect: 'typewriter' as TextEffect, duration: 1.0, delay: 0.4, easing: 'linear' as Easing, fontWeight: 600, fontSize: 28 },
  /** هاشتاج متحرك */
  hashtag: { effect: 'marquee' as TextEffect, duration: 3.0, easing: 'linear' as Easing, fontWeight: 500, fontSize: 24, color: '#60a5fa' },
  /** CTA بنطّة */
  cta: { effect: 'bounce' as TextEffect, duration: 0.5, delay: 0.6, easing: 'easeOutBounce' as Easing, fontWeight: 800, fontSize: 40 },
  /** رقم كبير متوهّج */
  number: { effect: 'glow' as TextEffect, duration: 1.0, easing: 'easeOut' as Easing, fontWeight: 900, fontSize: 80, glowColor: '#fbbf24' },
};

export const EFFECT_OPTIONS: { value: TextEffect; label: string; desc: string }[] = [
  { value: 'fade', label: 'تلاشي', desc: 'ظهور تدريجي' },
  { value: 'slideUp', label: 'صعود', desc: 'من تحت لفوق' },
  { value: 'slideRight', label: 'انزلاق', desc: 'من اليمين' },
  { value: 'zoomIn', label: 'تكبير', desc: 'من صغير لكبير' },
  { value: 'typewriter', label: 'آلة كاتبة', desc: 'حرف بحرف' },
  { value: 'marquee', label: 'مارquee', desc: 'متحرك أفقياً' },
  { value: 'bounce', label: 'نطّة', desc: 'ظهور بنطّة' },
  { value: 'glow', label: 'توهج', desc: 'نابض متوهّج' },
];
