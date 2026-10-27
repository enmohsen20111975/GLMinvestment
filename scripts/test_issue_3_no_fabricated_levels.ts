/**
 * ISSUE-3 Test: Verify no fabricated Entry/Stop/Target levels
 * =====================================================================
 * This test verifies that the codebase no longer fabricates entry/stop/target
 * levels using hardcoded multipliers (entry*0.97, entry*1.05, etc.).
 *
 * It searches all source files for the fabrication patterns and confirms
 * they are gone (except in comments explaining what was removed).
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const SRC_DIR = join(process.cwd(), 'src');
const SCRIPTS_DIR = join(process.cwd(), 'scripts');

// Patterns that indicate fabrication (entry * multiplier)
const FABRICATION_PATTERNS = [
  /entry\s*\*\s*0\.9[0-9]/,        // entry * 0.95, 0.97, etc.
  /entry\s*\*\s*1\.0[5-9]/,         // entry * 1.05, 1.07, etc.
  /entry\s*\*\s*1\.1[0-9]/,         // entry * 1.10, 1.15, etc.
  /current\s*\*\s*0\.9[0-9]/,       // current * 0.95, 0.97
  /current\s*\*\s*1\.0[3-9]/,       // current * 1.03, 1.05
  /current\s*\*\s*1\.1[0-9]/,       // current * 1.10
  /_entry\s*\*\s*0\.97/,            // _entry * 0.97 (the original bug)
  /_entry\s*\*\s*1\.0[5-9]/,        // _entry * 1.05
  /lastClose\s*\*\s*0\.9[0-9]/,     // lastClose * 0.95
  /lastClose\s*\*\s*1\.0[5-9]/,     // lastClose * 1.05
  /price\s*\*\s*0\.9[0-9]/,          // price * 0.95
  /price\s*\*\s*1\.0[5-9]/,          // price * 1.05
  /price\s*\*\s*1\.1[0-9]/,          // price * 1.10
  /s\.support\s*\*\s*0\.9[0-9]/,    // s.support * 0.97
  /s\.support\s*\*\s*1\.0[0-9]/,    // s.support * 1.02
  /1\.5\s*\*\s*_risk/,               // 1.5 * _risk (target fabrication)
  /_risk\s*>\s*0\s*\?\s*_entry\s*\+\s*1\.5/, // entry + 1.5 * risk
];

let totalFiles = 0;
let filesWithFabrication: Array<{ file: string; line: number; match: string }> = [];

function scanFile(filePath: string) {
  // Skip this test file itself
  if (filePath.includes('test_issue_3')) return;

  const ext = extname(filePath);
  if (!['.ts', '.tsx', '.js', '.jsx', '.py'].includes(ext)) return;

  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    // Skip comments (lines that start with // or * or #)
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) return;
    // Skip lines that mention "removed" or "FIX" or "ISSUE-3" (documentation of removal)
    if (/removed|FIX|ISSUE-3|Previous:|fabricat/i.test(line)) return;

    for (const pattern of FABRICATION_PATTERNS) {
      if (pattern.test(line)) {
        filesWithFabrication.push({
          file: filePath,
          line: idx + 1,
          match: line.trim(),
        });
      }
    }
  });
}

function scanDir(dir: string) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
        scanDir(fullPath);
      } else {
        totalFiles++;
        scanFile(fullPath);
      }
    } catch {
      // ignore
    }
  }
}

console.log('ISSUE-3 Test: Scanning for fabricated Entry/Stop/Target patterns...\n');
scanDir(SRC_DIR);
scanDir(SCRIPTS_DIR);

console.log(`Files scanned: ${totalFiles}`);
console.log(`Fabrication patterns found: ${filesWithFabrication.length}\n`);

if (filesWithFabrication.length > 0) {
  console.log('❌ FAIL — Fabrication patterns still exist:\n');
  for (const f of filesWithFabrication) {
    console.log(`  ${f.file}:${f.line}`);
    console.log(`    ${f.match}`);
    console.log();
  }
  process.exit(1);
} else {
  console.log('✅ PASS — No fabricated Entry/Stop/Target patterns found.');
  console.log('   All levels now come from real data (cache or stocks.db) or are NULL.');
  process.exit(0);
}
