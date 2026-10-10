/**
 * radar-alerts-path-upgrade.test.ts — RADAR-QUICK-WINS (Priority 3)
 * =========================================================================
 *
 * الهدف: اختبار الـ isPathUpgrade + pathShortAr helpers اللي بيكشفوا ترقية
 * مسار سهم متابَع (مثلاً C_quiet_accumulation_weak → A_pre_surge).
 *
 * السيناريوهات:
 *   1. ترقية ضعيف → قوي → نرجّع نص فيه السهمين.
 *   2. ترقية ضعيف → Pre-Surge → نرجّع نص.
 *   3. ترقية Pre-Surge → انفجار حجمي → نرجّع نص.
 *   4. تنزيل (downgrade) Pre-Surge → ضعيف → نرجّع null.
 *   5. نفس المسار → null.
 *   6. مسار غير معروف → نعتبره ترقية لو الـ current معروف.
 *   7. pathShortAr بترجّع label عربي معروف لكل path.
 *
 * التشغيل:
 *   bunx vitest run src/__tests__/radar/radar-alerts-path-upgrade.test.ts
 */
import { describe, it, expect } from 'vitest';
import { isPathUpgrade, pathShortAr } from '@/lib/schedulers/radar-alerts';

describe('isPathUpgrade', () => {
  it('detects weak → strong quiet accumulation as an upgrade', () => {
    const result = isPathUpgrade('C_quiet_accumulation_weak', 'B_quiet_accumulation_strong');
    expect(result).not.toBeNull();
    expect(result).toContain('تجميع ضعيف');
    expect(result).toContain('تجميع قوي');
  });

  it('detects weak → Pre-Surge as an upgrade', () => {
    const result = isPathUpgrade('C_quiet_accumulation_weak', 'A_pre_surge');
    expect(result).not.toBeNull();
    expect(result).toContain('Pre-Surge');
  });

  it('detects Pre-Surge → explosive as an upgrade (highest tier)', () => {
    const result = isPathUpgrade('A_pre_surge', 'D_explosive_surge');
    expect(result).not.toBeNull();
    expect(result).toContain('انفجار حجمي');
  });

  it('detects early_break → pre_surge as an upgrade', () => {
    const result = isPathUpgrade('E_early_break', 'A_pre_surge');
    expect(result).not.toBeNull();
  });

  it('returns null for a downgrade (pre_surge → weak)', () => {
    expect(isPathUpgrade('A_pre_surge', 'C_quiet_accumulation_weak')).toBeNull();
  });

  it('returns null when the path is unchanged', () => {
    expect(isPathUpgrade('A_pre_surge', 'A_pre_surge')).toBeNull();
    expect(isPathUpgrade('C_quiet_accumulation_weak', 'C_quiet_accumulation_weak')).toBeNull();
  });

  it('returns null for empty / missing inputs', () => {
    expect(isPathUpgrade('', 'A_pre_surge')).toBeNull();
    expect(isPathUpgrade('A_pre_surge', '')).toBeNull();
    expect(isPathUpgrade('', '')).toBeNull();
  });

  it('treats unknown prev path as rank 0 (so any known current is an upgrade)', () => {
    const result = isPathUpgrade('UNKNOWN_PATH', 'B_quiet_accumulation_strong');
    expect(result).not.toBeNull();
  });

  it('returns null when both paths are unknown and equal', () => {
    expect(isPathUpgrade('UNKNOWN', 'UNKNOWN')).toBeNull();
  });

  it('does not flag transition to a lower-ranked path (defensive — explosion → quiet)', () => {
    expect(isPathUpgrade('D_explosive_surge', 'B_quiet_accumulation_strong')).toBeNull();
  });
});

describe('pathShortAr', () => {
  it('returns Arabic label for each known radar path', () => {
    expect(pathShortAr('A_pre_surge')).toBe('Pre-Surge');
    expect(pathShortAr('B_quiet_accumulation_strong')).toBe('تجميع قوي');
    expect(pathShortAr('C_quiet_accumulation_weak')).toBe('تجميع ضعيف');
    expect(pathShortAr('D_explosive_surge')).toBe('انفجار حجمي');
    expect(pathShortAr('E_early_break')).toBe('اختراق مبكر');
  });

  it('falls back to the raw path string when unknown', () => {
    expect(pathShortAr('XYZ_unknown')).toBe('XYZ_unknown');
  });

  it('returns the raw string for empty input', () => {
    expect(pathShortAr('')).toBe('');
  });
});
