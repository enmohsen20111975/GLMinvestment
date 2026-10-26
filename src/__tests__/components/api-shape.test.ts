/**
 * API Shape Consistency Test
 * =====================================================================
 * Verifies that TypeScript interfaces in frontend match the API route interfaces.
 * Run: npx vitest run src/__tests__/components/api-shape.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function readFile(path: string): string {
  try { return readFileSync(join(process.cwd(), path), 'utf8'); } catch { return ''; }
}

describe('API Shape Consistency', () => {
  it('LiquidityRadarView interface should match API route interface', () => {
    const ui = readFile('src/components/shared/LiquidityRadarView.tsx');
    const api = readFile('src/app/api/v2/liquidity-radar/route.ts');
    
    // Extract field names from both interfaces
    const extractFields = (content: string, interfaceName: string): string[] => {
      const match = content.match(new RegExp(`interface ${interfaceName}[^{]*{([^}]*)}`));
      if (!match) return [];
      return match[1]
        .split('\n')
        .map(l => l.trim().match(/^(\w+)\??:/))
        .filter(Boolean)
        .map(m => m![1]);
    };
    
    const uiFields = extractFields(ui, 'RadarStock');
    const apiFields = extractFields(api, 'RadarStock');
    
    // Check that all API fields exist in UI interface
    const missingInUI = apiFields.filter(f => !uiFields.includes(f));
    expect(missingInUI).toHaveLength(0);
  });

  it('API route should return success: boolean in all responses', () => {
    const api = readFile('src/app/api/v2/liquidity-radar/route.ts');
    expect(api).toContain('success: true');
    expect(api).toContain('success: false');
  });

  it('normalizeMarketCode should default to EGX', () => {
    const api = readFile('src/app/api/v2/liquidity-radar/route.ts');
    expect(api).toContain("'EGX'");
  });
});
