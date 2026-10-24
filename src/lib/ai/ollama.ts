/**
 * ollama.ts — سجل النماذج المحلية المتاحة + عميل Ollama مشترك
 * =============================================================
 *
 * كل النماذج هنا بتشتغل 100% محلي (Ollama + Piper TTS).
 * مفيش أي API خارجي ولا API key.
 *
 * raison d'être: قبل كده مولّد الإعلانات كان بيستدعي z-ai-web-dev-sdk
 * (Z.ai) — API خارجي مدفوع. الكود ده بيوحّد كل الاستدعاءات المحلية
 * في مكان واحد عشان أي أداة في المشروع تختار النموذج بنفسها.
 *
 *_paths relative to process.cwd()_ عشان يشتغل صح على sandbox والـ
 * production server من غير تعديل.
 */

// ============================================================
// 1. Ollama
// ============================================================

export const OLLAMA_URL =
  process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';

/** النموذج الافتراضي للكتابة الإبداعية/التحليلية. */
export const DEFAULT_TEXT_MODEL = process.env.OLLAMA_MODEL || 'glm-fast';

/** مهلة الطلب بالـ ms — الموديلات الصغيرة بطيئة شوية على CPU. */
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 180_000);

export interface LocalTextModel {
  /** اسم نضيف بدون `:latest` — ده اللي الـ UI بيعرضه والـ config بيشاوره */
  name: string;
  /** الاسم الكامل كما رجّعه Ollama — ده اللي بنبعته في طلبات chat */
  display_name: string;
  params: string;
  family: string;
  sizeMb: number;
  /** قدرات الموديل: completion / tools / embedding … */
  capabilities: string[];
}

/**
 * اقرأ كل الموديلات المثبّتة فعلاً من Ollama.
 * بيرجع مصفوفة فاضية (مش بيكسر) لو Ollama مش شغال.
 */
export async function listTextModels(): Promise<LocalTextModel[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const json: any = await res.json();
    const models = Array.isArray(json?.models) ? json.models : [];
    return models.map((m: any) => ({
      // نخزّن الاسم بدون `:latest` عشان الـ UI والـ config يبقوا نضيفين،
      // وبنضيف display_name بالاسم الكامل كما رجّعه Ollama
      name: String(m?.name || '').replace(/:latest$/, ''),
      display_name: String(m?.name || ''),
      params: String(m?.details?.parameter_size || '?'),
      family: String(m?.details?.family || '?'),
      sizeMb: Math.round(Number(m?.size || 0) / 1_048_576),
      capabilities: Array.isArray(m?.capabilities) ? m.capabilities : [],
    }));
  } catch {
    return [];
  }
}

export async function isOllamaUp(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3_000);
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ollama بيسمّي الموديلات بالـ tag: `glm-fast:latest`، مش `glm-fast`.
 * الكود القديم كان قارن نصّي فكان يرفض `glm-fast` كان مثبّت فعلاً.
 * هنا بنوحّد الشكل: نحذف `:latest` ونتجاهل أي tag تاني.
 */
function canonicalName(name: string): string {
  const n = String(name || '').trim().toLowerCase();
  const bare = n.split(':')[0];
  // لو فيه tag مش latest، نخليه زي ما هو للمقارنة
  const idx = n.lastIndexOf(':');
  if (idx > 0 && n.slice(idx + 1) !== 'latest') return n;
  return bare;
}

/**
 * لوصل اسم الموديل اللي الـ user طلبه بالاسم المثبّت فعلاً.
 * يرجع الاسم الكامل (`glm-fast:latest`) اللي Ollama بيفهمه، أو null لو مش مثبّت.
 */
export async function resolveModelName(requested: string): Promise<string | null> {
  const want = canonicalName(requested);
  if (!want) return null;
  const installed = await listTextModels();
  for (const m of installed) {
    if (canonicalName(m.name) === want) return m.name;
  }
  return null;
}

export interface ChatOptions {
  model?: string;
  system: string;
  user: string;
  temperature?: number;
  /** يطلب من Ollama يرجّع JSON صالح. */
  jsonMode?: boolean;
}

/**
 * استدعاء chat واحد على Ollama.
 * بيرمي error واضح لو الموديل مش موجود.
 */
export async function chat(opts: ChatOptions): Promise<string> {
  const model = opts.model || DEFAULT_TEXT_MODEL;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: opts.jsonMode ? 'json' : undefined,
        options: {
          temperature: opts.temperature ?? 0.8,
          // الموديلات الصغيرة عندها context 32k؛ نخليه متسقة بينهم
          num_ctx: 8192,
        },
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 404 = موديل مش مثبّت — ده أشهر خطأ هنا
      if (res.status === 404) {
        throw new Error(
          `الموديل "${model}" مش مثبّت على Ollama. المتاح: ${(await listTextModels()).map(m => m.name).join(', ') || '(مفيش)'}`
        );
      }
      throw new Error(`Ollama ${res.status}: ${body.slice(0, 200)}`);
    }

    const json: any = await res.json();
    const content = json?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('الموديل رجّع رد فاضي');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * استخراج JSON من رد الموديل.
 *
 * الموديلات الصغيرة—even مع format:'json'— أحياناً بتحط ```json fences
 * أو نص قبل الـ JSON. بنجرّب 3 طرق بالترتيب:
 *   1. parse مباشر
 *   2. أول كتلة {...} في النص
 *   3. آخر {...} (لو في أكتر من واحد)
 *
 * بيرجع null لو مفيش JSON خالص.
 */
export function extractJson<T = unknown>(raw: string): T | null {
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    /* fall through */
  }

  const braceStart = cleaned.indexOf('{');
  const braceEnd = cleaned.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(cleaned.slice(braceStart, braceEnd + 1)) as T;
    } catch {
      /* fall through */
    }
  }

  return null;
}

// ============================================================
// 3. أشرطة جودة النص
// ============================================================

/**
 * الموديلات الصغيرة بتدخل في duplicating loops مع ما بتبلعش الـ format.
 * مثال حقيقي من glm-fast على طلب "5 هاشتاجات": رجّع 50 هاشتاج شبه
 * بعض متكرر لحد ما وصل الـ limit. لو رجعناها للمستخدم هيظهر junk
 * في الفيديو.
 */
export function looksDegenerate(text: string): boolean {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 8) return false;

  const counts = new Map<string, number>();
  for (const w of words) {
    const k = w.replace(/[#"'`.,!?،؛:()[\]]/g, '');
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let maxRepeat = 0;
  for (const c of counts.values()) if (c > maxRepeat) maxRepeat = c;

  // توكن واحد اتكرر أكتر من ربع النص = loop
  if (maxRepeat > words.length / 4) return true;

  // أو أغلب الأسطر متطابقة حرفياً
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 3 && new Set(lines).size / lines.length < 0.4) return true;

  return false;
}

/**
 * تنظيف نص حر راجع من موديل صغير: كتل ``` و bullet markers
 * وعلامات التنصيص اللي الموديل بيحطها حوالين النص.
 */
export function sanitizeFreeText(raw: string): string {
  let s = String(raw || '').trim();
  s = s.replace(/^\s*```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
  s = s
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•>]\s+/, '').replace(/^\s*\d+[.)]\s+/, '').trim())
    .filter(Boolean)
    .join('\n');
  s = s.replace(/^["'`«]+/, '').replace(/["'`»]+$/, '').trim();
  s = s.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  return s;
}

/**
 * يحوّل نص الموديل لمصفوفة عناصر (سطر لكل عنصر أو مفصول بفواصل)،
 * مع شيل التكرار.
 */
export function toList(raw: string, maxItems: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw || '').split(/[\n\r,،;؛]+/)) {
    const v = part
      .replace(/^\s*\d+[.)]\s*/, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim();
    if (!v) continue;
    const key = v.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= maxItems) break;
  }
  return out;
}
