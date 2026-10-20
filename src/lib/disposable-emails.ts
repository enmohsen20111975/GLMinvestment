/**
 * disposable-emails.ts
 * ----------------------------------------------------
 * قائمة حظر البريد الإلكتروني المؤقت والوهمي (Disposable Email Domains)
 * تمنع استغلال الفترة التجريبية بحسابات وهمية متكررة.
 */

// أشهر نطاقات البريد المؤقت والوهمي الشائعة عالمياً وعربياً
export const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  // Top global disposable services
  '10minutemail.com',
  '10minutemail.net',
  '10minmail.com',
  '20minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'temp-mail.io',
  'tempail.com',
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'sharklasers.com',
  'grr.la',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.net',
  'trashmail.me',
  'dispostable.com',
  'getairmail.com',
  'fakemailgenerator.com',
  'generator.email',
  'emailondeck.com',
  'burnermail.io',
  'inboxkitten.com',
  'nada.ltd',
  'getnada.com',
  'dropmail.me',
  'crazymailing.com',
  'mytemp.email',
  'tempr.email',
  'discard.email',
  'discardmail.com',
  'spambox.us',
  'mailcatch.com',
  'maildrop.cc',
  'mailnesia.com',
  'mintemail.com',
  'mohmal.com',
  'mohmal.im',
  'mohmal.in',
  'mohmal.tech',
  'kasmail.com',
  'instant-mail.com',
  'fastmail.fm',
  'jetable.org',
  'courrieltemporaire.com',
  'mytempemail.com',
  'tempinbox.com',
  'trashymail.com',
  'zoemail.org',
  'fakeinbox.com',
  'binkmail.com',
  'safetymail.info',
  'filzmail.com',
  'hidemail.de',
  'meltmail.com',
  'tempemail.co',
  'tempemail.net',
  'oneoffmail.com',
  'receivemail.net',
  'incognitomail.org',
  'anonymousemail.me',
  'zillamail.com',
  'chacuo.net',
  '0815.ru',
  '10minutemail.de',
  '10minutemail.co.uk',
  'mytrashmail.com',
  'mailslurp.com',
  ' guerrillamail.biz',
  'guerrillamail.de',
  'pokemail.net',
  'spam4.me',
  'bccto.me',
  'chacuo.com',
  'cuvox.de',
  'dayrep.com',
  'einrot.com',
  'fleckens.hu',
  'gustr.com',
  'jourrapide.com',
  'rhyta.com',
  'superrito.com',
  'teleworm.us',
  'armyspy.com',
]);

/**
 * فحص البريد الإلكتروني للتأكد مما إذا كان يتبع خدمة بريد مؤقت
 */
export function isDisposableEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return true;
  const parts = email.trim().toLowerCase().split('@');
  if (parts.length !== 2) return true;

  const domain = parts[1].trim();

  // 1. فحص في القائمة السوداء للنطاقات المؤقتة
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    return true;
  }

  // 2. كشف نطاقات فرعية لنفس الخدمات (مثل sub.yopmail.com)
  for (const blocked of DISPOSABLE_EMAIL_DOMAINS) {
    if (domain.endsWith('.' + blocked)) {
      return true;
    }
  }

  // 3. كشف الأسماء الشائعة للبريد المؤقت في اسم النطاق
  const suspiciousKeywords = ['tempmail', 'disposable', 'throwaway', 'fakeinbox', 'guerrilla', '10minute'];
  if (suspiciousKeywords.some((kw) => domain.includes(kw))) {
    return true;
  }

  return false;
}

/**
 * فحص جودة وصحة تركيب البريد الإلكتروني
 */
export function validateEmailQuality(email: string): { valid: boolean; error?: string } {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'البريد الإلكتروني مطلوب' };
  }

  const clean = email.trim().toLowerCase();
  const parts = clean.split('@');
  if (parts.length !== 2) {
    return { valid: false, error: 'صيغة البريد الإلكتروني غير صحيحة' };
  }

  const [localPart, domain] = parts;

  if (localPart.length < 2) {
    return { valid: false, error: 'اسم المستخدم في البريد الإلكتروني قصير جداً' };
  }

  if (!domain.includes('.')) {
    return { valid: false, error: 'النطاق الخاص بالبريد الإلكتروني غير صحيح' };
  }

  const domainParts = domain.split('.');
  const tld = domainParts[domainParts.length - 1];
  if (tld.length < 2) {
    return { valid: false, error: 'امتداد النطاق غير صالح' };
  }

  if (isDisposableEmail(clean)) {
    return {
      valid: false,
      error: 'عفواً، لا يُسمح باستخدام البريد الإلكتروني المؤقت أو الوهمي. يرجى استخدام بريد حقيقي (مثل Gmail أو Yahoo أو Outlook).',
    };
  }

  return { valid: true };
}
