/**
 * Null Handling Test
 * =====================================================================
 * Verifies that null financial values are displayed as "—" not "0.00".
 *
 * Run: npx vitest run src/__tests__/components/null-handling.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Null Handling in Financial Display', () => {
  const DISPLAY_FILES = [
    'src/components/share/ShareButton.tsx',
    'src/components/publishing/UserPublishingView.tsx',
    'src/components/daily-picks/DailyPicksPoster.tsx',
    'src/components/intelligence/WatchlistIntelligenceSection.tsx',
    'src/components/journal/TradingJournalView.tsx',
  ];

  DISPLAY_FILES.forEach(file => {
    it(`${file}: should not display null financial values as 0.00`, () => {
      let content: string;
      try { content = readFileSync(join(process.cwd(), file), 'utf8'); } catch { return; }
      const lines = content.split('\n');
      const violations: string[] = [];
      lines.forEach((line, idx) => {
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
        // Check for patterns like: (value ?? 0).toFixed(2) where value is financial
        if (/\b(target_price|stop_loss|entry_price|targetPrice|stopLoss|entryPrice)\s*\?\?\s*0\)\.toFixed/.test(line)) {
          violations.push(`Line ${idx + 1}: ${line.trim()}`);
        }
      });
      expect(violations).toHaveLength(0);
    });
  });
});
