/**
 * 🔗 الروابط الرسمية لمنصة دليل الاستثمار
 * ============================================
 * هذا الملف هو المصدر الوحيد للروابط الرسمية.
 * كل نص بيتنسخ أو بيتشار لازم يضمّن OFFICIAL_LINKS_BLOCK.
 */

export const OFFICIAL_LINKS = {
  website: 'https://invist.m2y.net',
  android: 'https://play.google.com/store/apps/details?id=com.egx.investment',
  facebook: 'https://www.facebook.com/profile.php?id=61590600300048',
  telegram: 'https://t.me/Arabian_investment_guide',
  whatsapp: 'https://chat.whatsapp.com/L9hjEpJloAZAUvwMzB10Tc',
};

/**
 * رسالة المجتمع Intro المطلوبة في كل نص منشور أو منسوخ
 */
export const COMMUNITY_PROMPT = 'انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈';

/**
 * بلوك الروابط الرسمية كامل - يُضاف لأي نص بيتنسخ أو بيتشار
 */
export const OFFICIAL_LINKS_BLOCK = `
${COMMUNITY_PROMPT}

🔗 روابطنا الرسمية:
🌐 الموقع الإلكتروني: ${OFFICIAL_LINKS.website}
📱 تطبيق أندرويد: ${OFFICIAL_LINKS.android}
📘 فيسبوك: ${OFFICIAL_LINKS.facebook}
✈️ تليجرام: ${OFFICIAL_LINKS.telegram}
💬 واتساب: ${OFFICIAL_LINKS.whatsapp}`;

/**
 * نسخة مختصرة للنصوص القصيرة (سطر واحد)
 */
export const OFFICIAL_LINKS_SHORT = `🔗 ${OFFICIAL_LINKS.website} | ✈️ ${OFFICIAL_LINKS.telegram} | 💬 ${OFFICIAL_LINKS.whatsapp}`;

/**
 * دالة مساعدة: إضافة بلوك الروابط لأي نص
 */
export function withOfficialLinks(text: string): string {
  return `${text}${OFFICIAL_LINKS_BLOCK}`;
}
