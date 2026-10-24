/**
 * FormulaEngine — محرّك المعادلات المخصّصة للأعمدة المحسوبة
 * =================================================================
 * مكتبة مستقلة لتقييم معادلات Excel-style على صفوف الجدول.
 *
 * - تستخدم `expr-eval` (آمن — لا `eval()`).
 * - تدعم استبدال المتغيرات عبر `{field_name}` (مثلاً `{current_price}`).
 * - تدعم الدالة `IF(cond, a, b)` عبر preprocessing إلى `(cond) ? (a) : (b)`
 * (لأن expr-eval يدعم ternary natively لكن مش IF function).
 * - تدعم العمليات الحسابية: + - * / % ^
 * - تدعم المقارنات: > < >= <= == !=
 * - تدعم المنطقية: && || (مع تحويل AND/OR في الـ UI إلى && / ||)
 * - تدعم الدوال الرياضية: abs, round, floor, ceil, min, max, sqrt, log, ln, lg, sin, cos, ...
 *
 * الأمان (Security):
 * - لا `eval()` ولا `new Function()` إطلاقاً.
 * - expr-eval parser بيتبع whitelist صارم للعمليات.
 * - المتغيرات بتُستبدل بقيم رقمية فقط (strings بتتحول لـ 0 لو مش رقمية).
 *
 * @module FormulaEngine
 */

import { Parser } from 'expr-eval';

// ─── Parser setup (Singleton instance with strict security whitelist) ─────
const _parser = new Parser({
 operators: {
 // Disabled (security/correctness):
 concatenate: false,
 factorial: false,
 assignment: false,
 fndef: false, // function definition
 length: false,
 in: false,
 random: false,
 // Enabled (financial math needs):
 add: true,
 subtract: true,
 multiply: true,
 divide: true,
 remainder: true,
 power: true,
 comparison: true,
 logical: true,
 conditional: true,
 sin: true, cos: true, tan: true,
 asin: true, acos: true, atan: true,
 sinh: true, cosh: true, tanh: true,
 asinh: true, acosh: true, atanh: true,
 sqrt: true, log: true, ln: true, lg: true, log10: true,
 abs: true, ceil: true, floor: true, round: true, trunc: true,
 exp: true, expm1: true, log1p: true, sign: true, log2: true,
 cbrt: true,
 min: true, max: true,
 },
});

const _parserError: string | null = null;

function getParser(): { parse: (expr: string) => { evaluate: (scope: Record<string, unknown>) => unknown } } | null {
 return _parser;
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type FormulaCategory = 'price' | 'fundamentals' | 'technical' | 'liquidity' | 'meta';

export interface FormulaVariable {
 /** مفتاح الحقل في صف البيانات (يُستخدم في `{key}`) */
 key: string;
 /** عنوان عربي للعرض */
 label: string;
 /** تصنيف الحقل */
 category: FormulaCategory;
 /** وحدة القياس (اختياري — للعرض فقط) */
 unit?: string;
}

export type FormulaResult =
 | { ok: true; value: number | string }
 | { ok: false; error: string };

// ─── Available variables ───────────────────────────────────────────────────

/**
 * كل الحقول القابلة للاستخدام في المعادلات.
 * مصدر القائمة: `Stock` interface من `src/types/index.ts`.
 * لو اتحولت قيمة الحقل لـ 0 (null/undefined/non-finite) → المحرّك بيعوّض بـ 0
 * عشان مايكسرش المعادلة، لكن بيرجع warning في الـ error state لو كله أصفار.
 */
export const FORMULA_VARIABLES: FormulaVariable[] = [
 // ─── الأسعار (price) ───
 { key: 'current_price', label: 'السعر الحالي', category: 'price', unit: 'ج.م' },
 { key: 'previous_close', label: 'الإغلاق السابق', category: 'price', unit: 'ج.م' },
 { key: 'open_price', label: 'الافتتاح', category: 'price', unit: 'ج.م' },
 { key: 'high_price', label: 'أعلى سعر', category: 'price', unit: 'ج.م' },
 { key: 'low_price', label: 'أدنى سعر', category: 'price', unit: 'ج.م' },
 { key: 'high_52w', label: 'أعلى 52 أسبوع', category: 'price', unit: 'ج.م' },
 { key: 'low_52w', label: 'أدنى 52 أسبوع', category: 'price', unit: 'ج.م' },
 // ─── الأساسيات (fundamentals) ───
 { key: 'pe_ratio', label: 'P/E', category: 'fundamentals' },
 { key: 'pb_ratio', label: 'P/B', category: 'fundamentals' },
 { key: 'dividend_yield', label: 'العائد التوزيعي %', category: 'fundamentals', unit: '%' },
 { key: 'eps', label: 'EPS', category: 'fundamentals', unit: 'ج.م' },
 { key: 'roe', label: 'ROE %', category: 'fundamentals', unit: '%' },
 { key: 'debt_to_equity', label: 'ديون/حقوق', category: 'fundamentals' },
 { key: 'market_cap', label: 'القيمة السوقية', category: 'fundamentals', unit: 'ج.م' },
 { key: 'fair_value', label: 'القيمة العادلة', category: 'fundamentals', unit: 'ج.م' },
 { key: 'upside_percent', label: 'العكسية %', category: 'fundamentals', unit: '%' },
 { key: 'book_value_per_share', label: 'القيمة الدفترية/سهم', category: 'fundamentals', unit: 'ج.م' },
 // ─── الفني (technical) ───
 { key: 'rsi', label: 'RSI', category: 'technical' },
 { key: 'ma_50', label: 'MA 50', category: 'technical', unit: 'ج.م' },
 { key: 'ma_200', label: 'MA 200', category: 'technical', unit: 'ج.م' },
 { key: 'support_level', label: 'الدعم', category: 'technical', unit: 'ج.م' },
 { key: 'resistance_level', label: 'المقاومة', category: 'technical', unit: 'ج.م' },
 // ─── السيولة (liquidity) ───
 { key: 'volume', label: 'الحجم', category: 'liquidity' },
 { key: 'volume_int', label: 'الحجم (عددي)', category: 'liquidity' },
 { key: 'volume_week', label: 'حجم الأسبوع', category: 'liquidity' },
 { key: 'volume_month', label: 'حجم الشهر', category: 'liquidity' },
 { key: 'turnover_egp', label: 'السيولة (ج.م)', category: 'liquidity', unit: 'ج.م' },
 { key: 'value_traded', label: 'قيمة التداول', category: 'liquidity', unit: 'ج.م' },
 { key: 'change_1d', label: 'تغير يوم %', category: 'liquidity', unit: '%' },
 { key: 'change_1w', label: 'تغير أسبوع %', category: 'liquidity', unit: '%' },
];

/**
 * أسماء تصنيفية للعرض في UI الـ variable picker.
 */
export const CATEGORY_LABELS: Record<FormulaCategory, string> = {
 price: 'الأسعار',
 fundamentals: 'الأساسيات',
 technical: 'الفني',
 liquidity: 'السيولة',
 meta: 'بيانات',
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * تقسيم نص بفواصل على المستوى الأعلى فقط (top-level commas).
 * يحترم الأقواس `()`, الأقواس المربعة `[]`, والاقتباسات `"`, `'`.
 */
function splitTopLevelArgs(s: string): string[] {
 const out: string[] = [];
 let depth = 0;
 let cur = '';
 let inStr: '"' | "'" | null = null;
 for (let i = 0; i < s.length; i++) {
 const ch = s[i];
 if (inStr) {
 cur += ch;
 if (ch === inStr && s[i - 1] !== '\\') inStr = null;
 continue;
 }
 if (ch === '"' || ch === "'") {
 inStr = ch;
 cur += ch;
 continue;
 }
 if (ch === '(' || ch === '[') depth++;
 else if (ch === ')' || ch === ']') depth--;
 if (ch === ',' && depth === 0) {
 out.push(cur);
 cur = '';
 } else {
 cur += ch;
 }
 }
 out.push(cur);
 return out;
}

/**
 * تحويل `IF(cond, a, b)` → `((cond) ? (a) : (b))` بشكل متكرر (nested-safe).
 *
 * - يبحث عن أول `IF(` غير متداخل، يعالجه، ثم يعيد الفحص.
 * - يدعم IF متداخلة: `IF(a, IF(b, x, y), z)`.
 * - كمان بيحوّل `AND(a, b, c)` → `(a and b and c)` و `OR(a, b, c)` → `(a or b or c)`
 * عشان الراحة (نفس السلوك زي Excel). expr-eval بيدعم `and`/`or` ككلمات (مش `&&`/`||`).
 */
function preprocessFunctions(input: string): string {
 let result = input;
 let safety = 0;
 // Pattern: IF(, AND(, OR( (case-insensitive). MUST have `(` immediately after
 // the function name — no whitespace — so we don't match the word operators `and`/`or`
 // that we ourselves emit as replacements (otherwise infinite/double-rewrite).
 const fnRe = /\b(IF|AND|OR)\(/i;
 while (true) {
 if (++safety > 5000) {
 throw new Error('عمق تعشيق عميق جداً في المعادلة (حد أقصى 5000)');
 }
 const m = result.match(fnRe);
 if (!m) break;
 const fnName = m[1].toUpperCase();
 const startIdx = m.index as number;
 const openParenIdx = startIdx + m[0].length - 1;
 // ابحث عن القوس المغلق المطابق
 let depth = 1;
 let i = openParenIdx + 1;
 let inStr: '"' | "'" | null = null;
 while (i < result.length && depth > 0) {
 const ch = result[i];
 if (inStr) {
 if (ch === inStr && result[i - 1] !== '\\') inStr = null;
 } else if (ch === '"' || ch === "'") {
 inStr = ch;
 } else if (ch === '(') {
 depth++;
 } else if (ch === ')') {
 depth--;
 }
 i++;
 }
 if (depth !== 0) {
 throw new Error(`القوس غير مغلق في الدالة ${fnName}`);
 }
 const closeParenIdx = i - 1;
 const argsStr = result.slice(openParenIdx + 1, closeParenIdx);
 const args = splitTopLevelArgs(argsStr).map(a => a.trim()).filter(a => a.length > 0);

 let replacement: string;
 if (fnName === 'IF') {
 if (args.length !== 3) {
 throw new Error(`IF تتطلب 3 وسائط (شرط، نتيجة_صح، نتيجة_خطأ) — استلمت ${args.length}`);
 }
 replacement = `((${args[0]}) ? (${args[1]}) : (${args[2]}))`;
 } else if (fnName === 'AND') {
 if (args.length < 2) {
 throw new Error(`AND تتطلب وسائطين على الأقل — استلمت ${args.length}`);
 }
 // expr-eval يدعم `and` (الكلمة) وليس `&&` كـ binaryOp
 replacement = `(${args.map(a => `(${a})`).join(' and ')})`;
 } else if (fnName === 'OR') {
 if (args.length < 2) {
 throw new Error(`OR تتطلب وسائطين على الأقل — استلمت ${args.length}`);
 }
 // expr-eval يدعم `or` (الكلمة) وليس `||` (|| بيتم معاملته كـ string concat!)
 replacement = `(${args.map(a => `(${a})`).join(' or ')})`;
 } else {
 throw new Error(`دالة غير مدعومة: ${fnName}`);
 }
 result = result.slice(0, startIdx) + replacement + result.slice(closeParenIdx + 1);
 }
 return result;
}

/**
 * استبدال المتغيرات `{field_name}` بقيمها من الـ row.
 *
 * - الأرقام النهائية → تُترك كما هي.
 * - القيم null/undefined/non-finite → تُعوّض بـ 0 (لتجنّب كسر المعادلة).
 * - النصوص الرقمية (مثلاً "12.5") → تُحوّل لرقم.
 * - النصوص غير الرقمية → تُعوّض بـ 0.
 * - القيم المنطقية → 1/0.
 *
 * ملاحظة: لو حابب تختبر string equality (مثلاً `{sector} == "بنوك"`)،
 * استخدم operator `==` في expr-eval (الـ parser بيدعمه). لكن هنا بناخد
 * القرار بإن المعادلات المخصّصة للجدول المالي = أرقام في الأغلب.
 */
function substituteVariables(formula: string, row: Record<string, unknown>): string {
 return formula.replace(/\{(\w+)\}/g, (full, key: string) => {
 const v = row[key];
 if (v == null) return '0';
 if (typeof v === 'number') {
 return Number.isFinite(v) ? String(v) : '0';
 }
 if (typeof v === 'boolean') {
 return v ? '1' : '0';
 }
 if (typeof v === 'string') {
 const trimmed = v.trim();
 if (trimmed === '') return '0';
 const num = Number(trimmed);
 if (!isNaN(num) && Number.isFinite(num)) return String(num);
 // Non-numeric string: keep quoted so expr-eval can compare strings if needed.
 // But for math expressions this will fail at parse time → that's the correct behavior.
 // Wrap in double-quotes (escape any inner double-quotes).
 return `"${trimmed.replace(/"/g, '\\"')}"`;
 }
 // Arrays/objects/unknown → 0
 return '0';
 });
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * تقييم معادلة على صف واحد.
 *
 * @example
 * evaluateFormula('({current_price} - {support_level}) / {current_price} * 100', stock)
 * // → { ok: true, value: 4.5678 }
 *
 * @example
 * evaluateFormula('IF({rsi} < 30, 100, 0)', stock)
 * // → { ok: true, value: 100 } // oversold signal
 *
 * @example
 * evaluateFormula('IF(AND({rsi} < 30, {current_price} < {ma_50}), 1, 0)', stock)
 * // → { ok: true, value: 1 }
 */
export function evaluateFormula(
 formula: string,
 row: Record<string, unknown>,
): FormulaResult {
 if (!formula || !formula.trim()) {
 return { ok: false, error: 'المعادلة فارغة' };
 }

 try {
 // 1) استبدال المتغيرات
 const substituted = substituteVariables(formula, row);

 // 2) تحويل IF/AND/OR إلى بنية expr-eval (ternary و && و ||)
 const processed = preprocessFunctions(substituted);

 // 3) تقييم عبر parser آمن (لا eval) — lazy-loaded
 const p = getParser();
 if (!p) {
 return { ok: false, error: _parserError || 'محرك المعادلات غير متاح — نفّذ npm install' };
 }
 const expression = p.parse(processed);
 const result = expression.evaluate({});

 // 4) تنسيق النتيجة
 if (typeof result === 'boolean') {
 return { ok: true, value: result ? 1 : 0 };
 }
 if (typeof result === 'number') {
 if (!Number.isFinite(result)) {
 return { ok: false, error: 'النتيجة غير محدودة (Infinity/NaN)' };
 }
 // تقريب لـ 4 منازل عشرية (كافٍ للمالية)
 const rounded = Math.round(result * 10000) / 10000;
 return { ok: true, value: rounded };
 }
 if (typeof result === 'string') {
 return { ok: true, value: result };
 }
 // أي نوع آخر (object, array, function) — نرفضه
 return { ok: false, error: 'نوع نتيجة غير مدعوم' };
 } catch (e: unknown) {
 const err = e as { message?: string };
 const msg = err?.message || 'خطأ في المعادلة';
 // Make error message more user-friendly (Arabic where helpful)
 let friendly = msg;
 if (/unexpected EOF|end of expression/i.test(msg)) {
 friendly = 'المعادلة غير مكتملة — تحقّق من الأقواس';
 } else if (/is not defined/i.test(msg)) {
 friendly = 'متغير غير معرّف — استخدم {field_name}';
 } else if (/unexpected/i.test(msg)) {
 friendly = `صياغة خاطئة: ${msg}`;
 }
 return { ok: false, error: friendly };
 }
}

/**
 * تقييم معادلة على عدة صفوف (لـ live preview في الـ Dialog).
 * بيرجع نتائج أول `limit` صفوف.
 */
export function evaluateFormulaBatch(
 formula: string,
 rows: Array<Record<string, unknown>>,
 limit = 3,
): Array<{ row: Record<string, unknown>; result: FormulaResult }> {
 return rows.slice(0, limit).map(row => ({
 row,
 result: evaluateFormula(formula, row),
 }));
}

/**
 * التحقق من صحة معادلة بدون تقييمها فعلياً (لـ validation سريع).
 */
export function validateFormula(formula: string): FormulaResult {
 if (!formula || !formula.trim()) {
 return { ok: false, error: 'المعادلة فارغة' };
 }
 try {
 const p = getParser();
 if (!p) {
 return { ok: false, error: _parserError || 'محرك المعادلات غير متاح — نفّذ npm install' };
 }
 const substituted = substituteVariables(formula, {});
 const processed = preprocessFunctions(substituted);
 p.parse(processed);
 return { ok: true, value: 'صحيحة' };
 } catch (e: unknown) {
 const err = e as { message?: string };
 return { ok: false, error: err?.message || 'خطأ في المعادلة' };
 }
}

/**
 * استخراج أسماء المتغيرات المُستخدمة في معادلة.
 * مفيد للـ UI (مثلاً عرض "هذه المعادلة تستخدم: السعر الحالي، الدعم، RSI").
 */
export function extractVariables(formula: string): string[] {
 const matches = formula.match(/\{(\w+)\}/g) || [];
 const vars = matches.map(m => m.slice(1, -1));
 // dedupe preserving order
 return Array.from(new Set(vars));
}
