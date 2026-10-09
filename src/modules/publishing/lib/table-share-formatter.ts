/**
 * formatTableToText — محوّل عام لأي جدول لـ نص منسّق جاهز للنشر
 * =================================================================
 *
 * بياخد أي مصفوفة بيانات + أعمدة (Column<T>[]) ويرجّع نص Markdown-ish
 * منسّق بالعربي مع الرموز التعبيرية، جاهز للّصق في تيليجرام/واتساب/فيسبوك.
 *
 * القواعد:
 *  - أول 15 صف بس (limit قابل للتعديل)
 *  - بيتخطّى أعمدة المساعدة (_idx, isTracked, _sparkline, actions)
 *  - بيكتشف تلقائياً الحقول المهمة (ticker, price, changePct, action, ...)
 *  - بيضيف هيدر بالعنوان + التاريخ + فاصل
 *  - بيضيف فوتر بعدد الصفوف الإضافية
 */

import type { Column } from '@/components/shared/UnifiedTable';

// الأعمدة اللي بتتخطّى في الـ text format (مش مفيدة للنشر)
const SKIP_KEYS = new Set([
  '_idx',
  'isTracked',
  '_sparkline',
  'actions',
  '_actions',
  'select',
  '_select',
]);

interface FormatOptions {
  /** عنوان القسم */
  title: string;
  /** أعمدة الجدول */
  columns: Column<any>[];
  /** البيانات */
  data: any[];
  /** حد الصفوف (default 15) */
  limit?: number;
  /** هاشتاجات إضافية في الفوتر */
  hashtags?: string[];
  /** ملاحظة تحت العنوان */
  subtitle?: string;
}

/** تنسيق رقم كنسبة مئوية مع إشارة */
function formatPercent(v: unknown): string | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

/** تنسيق سعر */
function formatPrice(v: unknown): string | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return n.toFixed(2);
}

/** تنسيق رقم كبير بصيغة مختصرة (مثلاً 14.2M) */
function formatLargeNumber(v: unknown): string | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}

/**
 * محوّل عام لجدول → نص منسّق
 */
export function formatTableToText({
  title,
  columns,
  data,
  limit = 15,
  hashtags = [],
  subtitle,
}: FormatOptions): string {
  if (!data || data.length === 0) {
    return `📊 **${title}**\n\nلا توجد بيانات حالياً.`;
  }

  const now = new Date().toLocaleDateString('ar-EG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let out = `📊 **${title}**\n`;
  if (subtitle) out += `📝 ${subtitle}\n`;
  out += `🗓️ ${now}\n`;
  out += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // عرض أول `limit` صفوف
  const rowsToShow = data.slice(0, limit);

  rowsToShow.forEach((row: any, idx: number) => {
    // محاولة العثور على رمز السهم
    const ticker =
      row.ticker ||
      row.symbol ||
      row.code ||
      row.tkr ||
      row.stock?.ticker ||
      `#${idx + 1}`;

    // السعر
    const price = formatPrice(
      row.current_price || row.price || row.close || row.last_price,
    );

    // نسبة التغير
    const chg = formatPercent(
      row.changePct ||
        row.change_pct ||
        row.pct_change ||
        row.change_percent ||
        row.changePctDay,
    );

    // الإشارة/الإجراء
    const action =
      row.action || row.signal || row.movement || row.decision || '';

    // بناء سطر السهم
    out += `🔹 **${idx + 1}. ${ticker}**`;
    if (price) out += ` — ${price} ج.م`;
    if (chg) {
      const emoji = chg.startsWith('+') ? '🟢' : '🔴';
      out += ` ${emoji} (${chg})`;
    }
    out += '\n';

    // المؤشرات الحيوية (اختيارية)
    const meta: string[] = [];

    // ROC
    const roc10 = formatPercent(row.roc_10d || row.roc10 || row.ROC10);
    if (roc10) meta.push(`ROC10: ${roc10}`);
    const roc20 = formatPercent(row.roc_20d || row.roc20 || row.ROC20);
    if (roc20) meta.push(`ROC20: ${roc20}`);

    // الحجم النسبي
    const volRatio = row.volume_ratio_10d_vs_20d || row.volume_ratio || row.volRatio;
    if (volRatio != null) {
      const vn = Number(volRatio);
      if (isFinite(vn)) {
        const vEmoji = vn >= 1.4 ? '📈' : vn >= 1.0 ? '➡️' : '📉';
        meta.push(`${vEmoji} حجم: ${vn.toFixed(2)}×`);
      }
    }

    // تدفّق السيولة
    const netFlow = row.net_flow_egp || row.netFlow || row.net_flow;
    if (netFlow != null) {
      const nf = formatLargeNumber(netFlow);
      if (nf) {
        const nfEmoji = Number(netFlow) >= 0 ? '💰' : '💸';
        meta.push(`${nfEmoji} Net: ${nf}`);
      }
    }

    // نسبة السيولة
    if (row.liquidity_pct != null || row.liquidityPct != null) {
      const lp = formatPercent(row.liquidity_pct ?? row.liquidityPct);
      if (lp) meta.push(`سيولة: ${lp}`);
    }

    // التوقع
    const expected = row.expected || row.expected_return || row.expectedReturn;
    if (expected) meta.push(`المتوقع: ${expected}`);

    // دورة الصعود
    const cycle = row.upcycle || row.cycle || row.stage;
    if (cycle) meta.push(`الدورة: ${cycle}`);

    // الحركة/القرار
    if (action) {
      const actionEmoji =
        action.includes('دخول') || action.includes('شراء')
          ? '🚀'
          : action.includes('مراقبة') || action.includes('انتظار')
            ? '👀'
            : action.includes('خروج') || action.includes('بيع')
              ? '🚪'
              : '⚡';
      meta.push(`${actionEmoji} ${action}`);
    }

    if (meta.length > 0) {
      out += `   ▫️ ${meta.join(' | ')}\n`;
    }
  });

  // فوتر
  if (data.length > limit) {
    out += `\n... +${data.length - limit} سهم إضافي داخل المنصة\n`;
  }

  // AUDIT-PUBLISH-QUALITY (constitution requirement): mandatory legal disclaimer.
  out += '\n━━━━━━━━━━━━━━━━━━━━\n';
  out += '⚠️ تحليل كمي بالذكاء الاصطناعي — ليس نصيحة استثمارية. إدارة رأس المال مسؤوليتك أولاً.\n';
  out += '📲 منصة استثمارية ذكية متعددة الأسواق\n';
  if (hashtags.length > 0) {
    out += hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ') + '\n';
  }

  return out;
}

/**
 * بناء نص مشاركة لسهم واحد (للـ StockDetailDrawer)
 */
export function buildStockDetailShareText(
  ticker: string,
  stockName: string | undefined,
  details: {
    price?: number;
    changePct?: number;
    entryLow?: number;
    entryHigh?: number;
    target1?: number;
    target2?: number;
    stopLoss?: number;
    rr?: number;
    accumulation?: string;
    upcycle?: string;
    signal?: string;
    notes?: string;
  } = {},
): string {
  const now = new Date().toLocaleDateString('ar-EG');
  let out = `🔍 **تحليل سهم: ${ticker}`;
  if (stockName) out += ` — ${stockName}`;
  out += `**\n`;
  out += `🗓️ ${now}\n`;
  out += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // السعر والتغير
  if (details.price != null) {
    out += `💵 السعر الحالي: ${details.price.toFixed(2)} ج.م`;
    if (details.changePct != null) {
      const chg = details.changePct;
      const emoji = chg >= 0 ? '🟢' : '🔴';
      out += ` ${emoji} (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%)`;
    }
    out += '\n';
  }

  // نطاق الدخول
  if (details.entryLow != null && details.entryHigh != null) {
    out += `🎯 نطاق الدخول: ${details.entryLow.toFixed(2)} — ${details.entryHigh.toFixed(2)} ج.م\n`;
  }

  // الأهداف
  if (details.target1 != null) {
    out += `🎯 الهدف الأول: ${details.target1.toFixed(2)} ج.م\n`;
  }
  if (details.target2 != null) {
    out += `🎯 الهدف الثاني: ${details.target2.toFixed(2)} ج.م\n`;
  }

  // وقف الخسارة
  if (details.stopLoss != null) {
    out += `🛑 وقف الخسارة: ${details.stopLoss.toFixed(2)} ج.م`;
    if (details.rr != null) {
      out += ` (نسبة مخاطرة/عائد: 1:${details.rr.toFixed(1)})`;
    }
    out += '\n';
  }

  // قراءة الميكرز
  if (details.accumulation) {
    out += `📊 التجميع: ${details.accumulation}\n`;
  }
  if (details.upcycle) {
    out += `🔄 دورة الصعود: ${details.upcycle}\n`;
  }
  if (details.signal) {
    const sigEmoji =
      details.signal.includes('دخول') || details.signal.includes('شراء')
        ? '🚀'
        : details.signal.includes('مراقبة')
          ? '👀'
          : '⚡';
    out += `${sigEmoji} الإشارة: ${details.signal}\n`;
  }

  // ملاحظات
  if (details.notes) {
    out += `\n📝 ${details.notes}\n`;
  }

  // AUDIT-PUBLISH-QUALITY (constitution requirement): mandatory legal disclaimer.
  out += '\n━━━━━━━━━━━━━━━━━━━━\n';
  out += '⚠️ تحليل كمي بالذكاء الاصطناعي — ليس نصيحة استثمارية. إدارة رأس المال مسؤوليتك أولاً.\n';
  out += '📲 منصة استثمارية ذكية — توقعات + رادار سيولة + تحليل فني\n';
  out += '#بورصة_مصر #EGX #تحليل_فني #' + ticker;

  return out;
}

/**
 * بناء نص مشاركة لملخص سوق / رادار بالكامل
 */
export function buildMarketSummaryText(
  title: string,
  highlights: {
    topGainers?: any[];
    topLosers?: any[];
    radarPicks?: any[];
    marketStatus?: string;
    notes?: string;
  } = {},
): string {
  const now = new Date().toLocaleDateString('ar-EG');
  let out = `📈 **${title}**\n`;
  out += `🗓️ ${now}\n`;
  if (highlights.marketStatus) out += `📊 حالة السوق: ${highlights.marketStatus}\n`;
  out += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (highlights.radarPicks && highlights.radarPicks.length > 0) {
    out += '🎯 **أبرز فرص الرادار:**\n';
    highlights.radarPicks.slice(0, 5).forEach((s: any, i: number) => {
      const t = s.ticker || s.symbol || `#${i + 1}`;
      const exp = s.expected || '';
      out += `${i + 1}. ${t}${exp ? ` — ${exp}` : ''}\n`;
    });
    out += '\n';
  }

  if (highlights.topGainers && highlights.topGainers.length > 0) {
    out += '🟢 **أعلى ارتفاعات:**\n';
    highlights.topGainers.slice(0, 3).forEach((s: any) => {
      const t = s.ticker || s.symbol;
      const p = formatPercent(s.changePct || s.change_pct);
      out += `• ${t} (${p})\n`;
    });
    out += '\n';
  }

  if (highlights.topLosers && highlights.topLosers.length > 0) {
    out += '🔴 **أعلى انخفاضات:**\n';
    highlights.topLosers.slice(0, 3).forEach((s: any) => {
      const t = s.ticker || s.symbol;
      const p = formatPercent(s.changePct || s.change_pct);
      out += `• ${t} (${p})\n`;
    });
    out += '\n';
  }

  if (highlights.notes) {
    out += `📝 ${highlights.notes}\n\n`;
  }

  // AUDIT-PUBLISH-QUALITY (constitution requirement): mandatory legal disclaimer.
  out += '━━━━━━━━━━━━━━━━━━━━\n';
  out += '⚠️ تحليل كمي بالذكاء الاصطناعي — ليس نصيحة استثمارية. إدارة رأس المال مسؤوليتك أولاً.\n';
  out += '📲 منصة استثمارية ذكية\n';
  out += '#بورصة_مصر #EGX #تداول #استثمار';

  return out;
}

// لإعادة استخدام الـ SKIP_KEYS في أماكن تانية
export { SKIP_KEYS as _SKIP_TABLE_KEYS };
