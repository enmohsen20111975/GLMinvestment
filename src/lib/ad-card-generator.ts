/**
 * ad-card-generator.ts — مولّد كروت صور ثابتة للسوشيال ميديا
 * ====================================================================
 *
 * بيرسم كروت PNG احترافية بـ Canvas:
 *   - Instagram Post (1080×1080 — مربع)
 *   - Instagram Story / Reel Cover (1080×1920 — عمودي)
 *   - Facebook Post (1200×630 — أفقي)
 *
 * كل كارت فيه:
 *   - Brand logo/emoji
 *   - Big headline (اسم الميزة)
 *   - 3 key benefits
 *   - CTA button mockup
 *   - Brand colors
 *
 * الإخراج: PNG data URL (قابل للتحميل مباشرة)
 */

export type CardFormat = 'square' | 'story' | 'landscape';

export interface CardConfig {
  format: CardFormat;
  featureName: string;
  tagline: string;
  emoji: string;
  accent: [string, string]; // gradient stops
  benefits: string[];
  cta: string;
  market?: string;
  date?: string;
}

const FORMAT_DIMENSIONS: Record<CardFormat, { w: number; h: number }> = {
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
  landscape: { w: 1200, h: 630 },
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * توليد كارت صورة PNG واحد
 * @returns PNG data URL (base64)
 */
export function generateAdCard(config: CardConfig): string {
  const { w, h } = FORMAT_DIMENSIONS[config.format];
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const [c1, c2] = config.accent;

  // === Background gradient ===
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#0f172a');
  bg.addColorStop(0.5, '#1e1b4b');
  bg.addColorStop(1, c2);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // === Decorative orbs ===
  ctx.save();
  ctx.globalAlpha = 0.3;
  const g1 = ctx.createRadialGradient(w * 0.15, h * 0.2, 0, w * 0.15, h * 0.2, w * 0.4);
  g1.addColorStop(0, c1);
  g1.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // === Brand header ===
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(h * 0.028)}px system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('📈 منصة استثمارية ذكية', w / 2, h * 0.06);
  ctx.restore();

  // === Emoji emblem (big) ===
  const emblemY = config.format === 'landscape' ? h * 0.4 : h * 0.22;
  ctx.save();
  ctx.font = `${Math.round(w * 0.12)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(config.emoji, w / 2, emblemY);
  ctx.restore();

  // === Headline (feature name) ===
  const headlineY = config.format === 'landscape' ? h * 0.55 : h * 0.38;
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(h * 0.055)}px system-ui`;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 12;
  ctx.fillText(config.featureName, w / 2, headlineY);
  ctx.restore();

  // === Tagline ===
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${Math.round(h * 0.028)}px system-ui`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  const taglineLines = wrapText(ctx, config.tagline, w * 0.8);
  let ty = headlineY + h * 0.06;
  for (const ln of taglineLines) {
    ctx.fillText(ln, w / 2, ty);
    ty += h * 0.035;
  }
  ctx.restore();

  // === Benefits list (3 items) ===
  if (config.format !== 'landscape') {
    const benefitsY = config.format === 'story' ? h * 0.55 : h * 0.6;
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(h * 0.024)}px system-ui`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';

    config.benefits.slice(0, 3).forEach((benefit, i) => {
      const by = benefitsY + i * h * 0.045;
      // Checkmark circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(w * 0.82, by, h * 0.012, 0, Math.PI * 2);
      ctx.fillStyle = c1;
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(h * 0.02)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText('✓', w * 0.82, by + h * 0.002);
      ctx.restore();

      // Benefit text
      ctx.save();
      ctx.font = `500 ${Math.round(h * 0.024)}px system-ui`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.textAlign = 'right';
      ctx.fillText(benefit, w * 0.76, by);
      ctx.restore();
    });
    ctx.restore();
  }

  // === CTA button mockup ===
  const ctaY = config.format === 'landscape' ? h * 0.78 : h * 0.82;
  const ctaW = w * 0.6;
  const ctaH = h * 0.07;
  const ctaX = (w - ctaW) / 2;

  ctx.save();
  const ctaGrad = ctx.createLinearGradient(ctaX, ctaY, ctaX + ctaW, ctaY + ctaH);
  ctaGrad.addColorStop(0, c1);
  ctaGrad.addColorStop(1, c2);
  ctx.fillStyle = ctaGrad;
  roundRect(ctx, ctaX, ctaY, ctaW, ctaH, ctaH / 2);
  ctx.fill();

  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(h * 0.028)}px system-ui`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(config.cta, w / 2, ctaY + ctaH / 2);
  ctx.restore();

  // === Footer: URL + date ===
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${Math.round(h * 0.018)}px system-ui`;
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  const footerText = `invist.m2y.net${config.date ? ' • ' + config.date : ''}`;
  ctx.fillText(footerText, w / 2, h * 0.95);
  ctx.restore();

  // === Convert to PNG data URL ===
  return canvas.toDataURL('image/png');
}

/**
 * توليد مجموعة كروت (square + story + landscape)
 */
export function generateCardSet(config: Omit<CardConfig, 'format'>): { format: CardFormat; dataUrl: string; filename: string }[] {
  const formats: CardFormat[] = ['square', 'story', 'landscape'];
  return formats.map((format) => ({
    format,
    dataUrl: generateAdCard({ ...config, format }),
    filename: `ad-${config.featureName.replace(/\s+/g, '-')}-${format}.png`,
  }));
}
