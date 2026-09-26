/**
 * Arabic-safe error message helper.
 * =================================
 * Client components frequently do:
 *   setError(e instanceof Error ? e.message : 'fallback');
 *
 * The problem: `e.message` is the raw browser/Node error string, often in
 * English ("Failed to fetch", "NetworkError when attempting to fetch
 * resource", "load failed", etc.). The QA team flagged these as
 * "English error messages exposed to client" (Rule 30 violation).
 *
 * This helper:
 *   1. Accepts unknown error (string | Error | unknown).
 *   2. Matches against a known list of English error signatures and
 *      returns a professional Arabic translation.
 *   3. Falls back to a clean Arabic message rather than the raw English.
 *
 * The raw English message is never exposed to the user.
 */

const ARABIC_NETWORK_ERROR = 'تعذّر الاتصال بالخادم. يرجى المحاولة مرة أخرى.';
const ARABIC_GENERIC_ERROR = 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.';

// Known English error signatures → Arabic translations.
// We match case-insensitively against substrings.
const ERROR_TRANSLATIONS: Array<{ match: RegExp; ar: string }> = [
  // Network-level fetch failures
  { match: /failed to fetch/i, ar: 'تعذّر الاتصال بالخادم. يرجى المحاولة مرة أخرى.' },
  { match: /fetch failed/i, ar: 'انقطع الاتصال بالشبكة' },
  { match: /networkerror/i, ar: 'انقطع الاتصال بالشبكة' },
  { match: /load failed/i, ar: 'تعذّر تحميل البيانات. يرجى المحاولة مرة أخرى.' },
  { match: /network request failed/i, ar: 'انقطع الاتصال بالشبكة' },
  { match: /network.*error/i, ar: 'انقطع الاتصال بالشبكة' },
  { match: /connection.*refused/i, ar: 'تعذّر الاتصال بالخادم. يرجى المحاولة مرة أخرى.' },
  { match: /connection.*reset/i, ar: 'انقطع الاتصال بالشبكة' },
  { match: /connection.*timeout|timeout occurred|aborted/i, ar: 'انتهت مهلة الاتصال. يرجى المحاولة مرة أخرى.' },
  { match: /dns.*fail|ename not found/i, ar: 'تعذّر الوصول إلى الخادم. تحقق من اتصالك بالإنترنت.' },

  // HTTP errors
  { match: /unauthorized|401/i, ar: 'انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.' },
  { match: /forbidden|403/i, ar: 'لا تملك صلاحية الوصول إلى هذه الصفحة.' },
  { match: /not found|404/i, ar: 'المورد المطلوب غير متوفر.' },
  { match: /internal server error|500/i, ar: 'حدث خطأ في الخادم. يرجى المحاولة مرة أخرى.' },
  { match: /service unavailable|503/i, ar: 'الخدمة غير متاحة حالياً. يرجى المحاولة لاحقاً.' },
  { match: /bad gateway|502/i, ar: 'تعذّر الاتصال بالخادم. يرجى المحاولة مرة أخرى.' },
  { match: /gateway timeout|504/i, ar: 'انتهت مهلة الاستجابة من الخادم. يرجى المحاولة مرة أخرى.' },

  // JSON parsing
  { match: /unexpected.*token.*json|invalid json|unexpected end of json/i, ar: 'استجابة غير صحيحة من الخادم.' },

  // Abort
  { match: /the operation was aborted|aborterror/i, ar: 'تم إلغاء العملية.' },
];

/**
 * Convert any error value into a safe, Arabic, client-facing message.
 *
 * @param err     The caught error (Error | string | unknown).
 * @param fallback Optional Arabic fallback when no signature matches.
 *                 Defaults to the generic network-error message.
 */
export function toArabicError(err: unknown, fallback: string = ARABIC_NETWORK_ERROR): string {
  if (err == null) return fallback;

  const raw = typeof err === 'string' ? err : (err as Error)?.message ?? String(err);
  if (!raw) return fallback;

  for (const t of ERROR_TRANSLATIONS) {
    if (t.match.test(raw)) return t.ar;
  }

  // If the message contains any English letters (a-z), do not leak it.
  // Fall back to the Arabic generic message rather than showing the raw text.
  if (/[A-Za-z]/.test(raw)) {
    return fallback;
  }

  // Looks like an already-Arabic message — return as-is.
  return raw.trim() || fallback;
}

/**
 * Returns the error message if it is already in Arabic (or a safe symbol),
 * otherwise returns the fallback Arabic message. Useful for places where the
 * caller wants to preserve server-provided Arabic messages but suppress
 * English leaks.
 */
export function preferArabicMessage(err: unknown, fallback: string = ARABIC_NETWORK_ERROR): string {
  return toArabicError(err, fallback);
}

export const ARABIC_ERRORS = {
  NETWORK: ARABIC_NETWORK_ERROR,
  GENERIC: ARABIC_GENERIC_ERROR,
  NO_DATA: 'لا توجد بيانات متاحة',
  LOADING: 'جارٍ التحميل...',
  CONNECTION_LOST: 'انقطع الاتصال بالشبكة',
} as const;
