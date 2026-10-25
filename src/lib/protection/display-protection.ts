/**
 * Display Protection — Temporary Customer-Facing Filter
 * =======================================================
 * حماية مؤقتة — تحكم في ما يُعرض للعملاء
 *
 * يقرأ التكوين من db/display_protection.json (كل 30 ثانية cache)
 * ويطبّق الفلتر على التوقعات قبل إرسالها للعميل.
 *
 * الأوضاع:
 *  - off: لا فلتر (افتراضي)
 *  - morning_bell: جرس الصباح فقط (أعلى توقع/يوم)
 *  - top_confidence: أعلى N توقعات ثقة/يوم
 *  - hide_weak: إخفاء evidence_count < threshold أو score < threshold
 *
 * التفعيل من الـ CLI:
 *   python3 vps-service/tools/toggle_protection.py morning_bell
 *
 * أو بتحرير الملف مباشرة: db/display_protection.json
 */

import path from 'path';
import fs from 'fs';

export interface ProtectionConfig {
  mode: 'off' | 'morning_bell' | 'top_confidence' | 'hide_weak';
  top_n: number;
  min_evidence: number;
  min_score: number;
  min_confidence: number;
  enabled_at: string | null;
  enabled_by: string | null;
  reason: string | null;
}

const DEFAULT_CONFIG: ProtectionConfig = {
  mode: 'off',
  top_n: 3,
  min_evidence: 4,
  min_score: 70,
  min_confidence: 70,
  enabled_at: null,
  enabled_by: null,
  reason: null,
};

const CONFIG_PATH = path.join(process.cwd(), 'db', 'display_protection.json');
const CACHE_TTL_MS = 30_000; // 30 seconds

let cachedConfig: ProtectionConfig | null = null;
let cacheTime = 0;

/**
 * Read the protection config (with 30s in-memory cache).
 * Falls back to defaults if file is missing or invalid.
 */
export function getProtectionConfig(): ProtectionConfig {
  const now = Date.now();
  if (cachedConfig && (now - cacheTime) < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      cachedConfig = { ...DEFAULT_CONFIG };
      cacheTime = now;
      return cachedConfig;
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    cachedConfig = { ...DEFAULT_CONFIG, ...parsed };
    cacheTime = now;
    return cachedConfig;
  } catch {
    // On any error, default to 'off' (no filtering — safe fallback)
    cachedConfig = { ...DEFAULT_CONFIG };
    cacheTime = now;
    return cachedConfig;
  }
}

/**
 * Force-refresh the cache (useful after CLI toggle in the same process).
 */
export function refreshProtectionCache(): void {
  cachedConfig = null;
  cacheTime = 0;
}

/**
 * Check if protection is currently active.
 */
export function isProtectionActive(): boolean {
  return getProtectionConfig().mode !== 'off';
}

export interface ProtectablePrediction {
  prediction_date?: string | null;
  morning_bell?: boolean | number | null;
  evidence_count?: number | null;
  master_score?: number | null;
  maestro_score?: number | null;
  confidence?: number | null;
  persona?: string | null;
  ticker?: string | null;
  [key: string]: unknown;
}

/**
 * Apply the protection filter to a list of predictions.
 * Returns the filtered list.
 *
 * - morning_bell: keep only morning_bell=1 predictions
 * - top_confidence: keep top-N by score per (date, persona)
 * - hide_weak: keep predictions where evidence >= min_evidence AND score >= min_score
 *             (setting a threshold to 0 disables that dimension's check)
 */
export function applyProtectionFilter<T extends ProtectablePrediction>(
  predictions: T[],
): T[] {
  const cfg = getProtectionConfig();

  if (cfg.mode === 'off' || predictions.length === 0) {
    return predictions;
  }

  if (cfg.mode === 'morning_bell') {
    return predictions.filter((p) => {
      const mb = p.morning_bell;
      return mb === true || mb === 1 || mb === '1';
    });
  }

  if (cfg.mode === 'top_confidence') {
    const n = cfg.top_n || 3;
    const groups = new Map<string, T[]>();
    for (const p of predictions) {
      const dateKey = String(p.prediction_date || '').slice(0, 10);
      const personaKey = String(p.persona || 'default');
      const key = `${dateKey}__${personaKey}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    const result: T[] = [];
    for (const group of groups.values()) {
      group.sort((a, b) => {
        const sa = Number(a.master_score ?? a.maestro_score ?? a.confidence ?? 0);
        const sb = Number(b.master_score ?? b.maestro_score ?? b.confidence ?? 0);
        return sb - sa;
      });
      result.push(...group.slice(0, n));
    }
    return result;
  }

  if (cfg.mode === 'hide_weak') {
    const minEv = cfg.min_evidence ?? 0;
    const minScore = cfg.min_score ?? 0;
    // AND logic: keep only if BOTH dimensions pass.
    // Setting a threshold to 0 effectively disables that dimension's check
    // (since any value >= 0 is true), allowing score-only or evidence-only filtering.
    return predictions.filter((p) => {
      const ev = Number(p.evidence_count ?? 0);
      const score = Number(p.master_score ?? p.maestro_score ?? p.confidence ?? 0);
      return ev >= minEv && score >= minScore;
    });
  }

  return predictions;
}

/**
 * Get a SQL WHERE clause fragment for the protection filter.
 * Useful for applying the filter directly in DB queries (more efficient).
 *
 * Returns { clause: string, params: any[] } — empty clause if protection is off.
 *
 * For 'morning_bell': WHERE morning_bell = 1
 * For 'top_confidence': no SQL clause (needs per-group ranking — use applyProtectionFilter)
 * For 'hide_weak': WHERE (evidence_count >= N OR master_score >= M)
 */
export function getProtectionSqlFilter(): { clause: string; params: unknown[] } {
  const cfg = getProtectionConfig();

  if (cfg.mode === 'off') {
    return { clause: '', params: [] };
  }

  if (cfg.mode === 'morning_bell') {
    return { clause: 'morning_bell = 1', params: [] };
  }

  if (cfg.mode === 'hide_weak') {
    const minEv = cfg.min_evidence ?? 0;
    const minScore = cfg.min_score ?? 0;
    // AND logic (matches applyProtectionFilter): keep only if BOTH dimensions pass.
    // Setting a threshold to 0 disables that dimension's check.
    return {
      clause: '(evidence_count >= ? AND master_score >= ?)',
      params: [minEv, minScore],
    };
  }

  // top_confidence: no simple SQL clause (needs per-group top-N)
  return { clause: '', params: [] };
}

/**
 * Get a human-readable description of the current protection state.
 */
export function getProtectionDescription(): string {
  const cfg = getProtectionConfig();
  switch (cfg.mode) {
    case 'off':
      return 'Protection OFF — all predictions shown';
    case 'morning_bell':
      return 'Morning bell only (top pick per day)';
    case 'top_confidence':
      return `Top ${cfg.top_n} predictions per day by confidence`;
    case 'hide_weak':
      return `Hiding weak signals (evidence<${cfg.min_evidence} OR score<${cfg.min_score}) — keeps only if both pass`;
    default:
      return `Unknown mode: ${cfg.mode}`;
  }
}
