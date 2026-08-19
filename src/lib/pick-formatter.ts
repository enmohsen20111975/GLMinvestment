/**
 * Pick Formatter
 * ==============
 * منسّق مشترك لتوقعات الصياد (Hunter Picks) — يُستخدم في:
 *  1) زر "نسخ" (Copy) في الواجهة الأمامية
 *  2) الـ endpoint الخلفي `/api/hunter/publish-pick` (النسخة الـ Python مستقلة لكن بنفس التنسيق)
 *
 * التنسيق باللغة العربية ومتوافق مع قناة تيليجرام (@Arabian_investment_guide).
 */

export interface ShareablePick {
  ticker: string;
  name_ar?: string;
  name?: string;
  market?: string;
  price?: number;
  entry?: number;
  entry_trigger?: string;
  stop_loss?: number;
  stop_pct?: number;
  target?: number;
  target_pct?: number;
  risk_reward?: number;
  timeframe?: string;
  reason?: string;
  narrative?: string[];
  personas?: {
    hunter?: number;
    hunter_verdict?: string;
    momentum?: number;
    momentum_verdict?: string;
    value?: number;
    value_verdict?: string;
  };
}

const SEP = '━━━━━━━━━━━━━━━━━━━━━';

/**
 * تنسيق توقع الصياد كنص عربي جاهز للنسخ أو النشر على تيليجرام.
 *
 * @param pick بيانات التوقع
 * @param marketName اسم السوق بالعربية (مثال: "البورصة المصرية")
 * @returns نص منسّق
 */
export function formatPickForSharing(
  pick: ShareablePick,
  marketName?: string,
): string {
  const market = marketName || pick.market || 'السوق';
  const name = pick.name_ar || pick.name || pick.ticker || '';
  const ticker = pick.ticker || '';

  // الأرقام — نستخدم toFixed(2) للأسعار وإلا القيمة كما هي
  const fmt = (v: number | undefined | null, digits = 2): string => {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    return Number(v).toFixed(digits);
  };

  // قيمة الدخول المعروضة: نُفضّل entry_trigger (نص) إن وُجد، وإلا entry كرقم
  const entryDisplay =
    pick.entry_trigger ||
    (pick.entry !== undefined && pick.entry !== null
      ? fmt(pick.entry)
      : '—');

  const stopPct =
    pick.stop_pct !== undefined && pick.stop_pct !== null
      ? Number(pick.stop_pct).toFixed(1)
      : '—';
  const targetPct =
    pick.target_pct !== undefined && pick.target_pct !== null
      ? Number(pick.target_pct).toFixed(1)
      : '—';
  const rr =
    pick.risk_reward !== undefined && pick.risk_reward !== null
      ? Number(pick.risk_reward).toFixed(1)
      : '—';

  const lines: string[] = [];
  lines.push(`🚀 توقعات الصياد — ${market}`);
  lines.push(SEP);
  lines.push(`📊 ${ticker}${name ? ` — ${name}` : ''}`);
  lines.push(`💰 السعر: ${fmt(pick.price)} | الدخول: ${entryDisplay}`);
  lines.push(`🛑 وقف الخسارة: ${fmt(pick.stop_loss)} (${stopPct}%)`);
  lines.push(`🎯 الهدف: ${fmt(pick.target)} (${targetPct}%)`);
  lines.push(`⚖️ العائد/المخاطرة: ${rr}`);
  if (pick.timeframe) {
    lines.push(`⏱️ الإطار الزمني: ${pick.timeframe}`);
  }
  lines.push(SEP);

  if (pick.reason) {
    lines.push(`📝 ${pick.reason}`);
  }

  const narrative = Array.isArray(pick.narrative)
    ? pick.narrative.filter((l) => l && String(l).trim())
    : [];
  if (narrative.length > 0) {
    if (pick.reason) lines.push(''); // سطر فاصل بين السبب والقصة
    lines.push(narrative.join('\n'));
  }

  lines.push(SEP);
  lines.push('📢 انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈');
  lines.push('');
  lines.push('🌐 https://invist.m2y.net');
  lines.push('📱 https://play.google.com/store/apps/details?id=com.egx.investment');
  lines.push('📘 https://www.facebook.com/profile.php?id=61590600300048');
  lines.push('✈️ https://t.me/Arabian_investment_guide');

  return lines.join('\n');
}

export default formatPickForSharing;
