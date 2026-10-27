/**
 * Deep Fabrication Scan — Issue #3 (comprehensive)
 * =====================================================================
 * يفحص كل ملفات المشروع بحثًا عن أي نمط ممكن يكون fabricated.
 * النطاق يشمل:
 *   - مضاعفات Entry/Stop/Target (entry * 0.XX, entry * 1.XX)
 *   - قيم افتراضية للسعر/المستويات (price * 0.X, price * 1.X)
 *   - fallback / placeholder / default للقيم التحليلية
 *   - دعم/مقاومة مختلقة
 *   - أحجام تداول "تقريبية"
 *   - قيم RSI/MACD/ATR hardcoded
 *   - أحجام صفقات تقريبية
 *
 * ملاحظة: النتائج تشمل كل الأنماط. التحليل اليدوي يحدد ما إذا كان
 * كل موضع fabrication حقيقي أم منطقًا مشروعًا (مثل التحقق من صحة المدخلات).
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';

const ROOT = process.cwd();
const SCAN_DIRS = [
  join(ROOT, 'src'),
  join(ROOT, 'scripts'),
  join(ROOT, 'vps-service'),
  join(ROOT, 'mini-services'),
  join(ROOT, 'telegram-events'),
  join(ROOT, 'news-agent'),
];

// ===== كل أنماط التزييف المحتملة =====
const PATTERNS: Array<{ name: string; regex: RegExp; severity: 'high' | 'medium' | 'low' }> = [
  // Entry/Stop/Target multipliers
  { name: 'entry_multiplier', regex: /entry\s*\*\s*0?\.?\d+/i, severity: 'high' },
  { name: 'entry_multiplier', regex: /entry\s*\*\s*1\.\d+/i, severity: 'high' },
  { name: 'stop_multiplier', regex: /stop\s*\*\s*0?\.?\d+/i, severity: 'high' },
  { name: 'target_multiplier', regex: /target\s*\*\s*0?\.?\d+/i, severity: 'high' },
  { name: 'target_multiplier', regex: /target\s*\*\s*1\.\d+/i, severity: 'high' },

  // Price-based fabrication
  { name: 'price_multiplier', regex: /price\s*\*\s*0?\.9\d/i, severity: 'high' },
  { name: 'price_multiplier', regex: /price\s*\*\s*1\.0[3-9]/i, severity: 'high' },
  { name: 'price_multiplier', regex: /price\s*\*\s*1\.1\d/i, severity: 'high' },
  { name: 'current_multiplier', regex: /current(?:_price)?\s*\*\s*0?\.9\d/i, severity: 'high' },
  { name: 'current_multiplier', regex: /current(?:_price)?\s*\*\s*1\.0[3-9]/i, severity: 'high' },
  { name: 'current_multiplier', regex: /current(?:_price)?\s*\*\s*1\.1\d/i, severity: 'high' },

  // Support/Resistance fabrication
  { name: 'support_fabrication', regex: /support(?:_level)?\s*\|\|\s*[^,;\n]+\*\s*0?\.9\d/i, severity: 'high' },
  { name: 'resistance_fabrication', regex: /resistance(?:_level)?\s*\|\|\s*[^,;\n]+\*\s*1\.\d+/i, severity: 'high' },

  // Fallback indicators
  { name: 'fallback_word', regex: /\/\/\s*(fallback|placeholder|default|تقريبي|افتراضي|تخمين)/i, severity: 'medium' },
  { name: 'fallback_word', regex: /#\s*(fallback|placeholder|default|تقريبي|افتراضي|تخمين)/i, severity: 'medium' },

  // Hardcoded indicator values
  { name: 'hardcoded_rsi', regex: /rsi\s*\|\|\s*(?:50|45|55|40|60)\b/i, severity: 'medium' },
  { name: 'hardcoded_atr', regex: /atr\s*\|\|\s*[^,;\n]+\*\s*0?\.0\d/i, severity: 'high' },
  { name: 'hardcoded_atr', regex: /atr\s*\|\|\s*price\s*\*\s*0?\.0\d/i, severity: 'high' },

  // Volume fabrication
  { name: 'volume_fabrication', regex: /volume\s*\|\|\s*(?:50000|100000|1000)\b/i, severity: 'medium' },
  { name: 'avg_volume_fabrication', regex: /avg[_-]?volume\s*\|\|\s*(?:50000|100000|1000)\b/i, severity: 'medium' },

  // Risk/Reward fabrication
  { name: 'rr_fabrication', regex: /1\.5\s*\*\s*risk/i, severity: 'high' },
  { name: 'rr_fabrication', regex: /2\s*\*\s*risk/i, severity: 'high' },

  // Stop loss fabrication
  { name: 'stop_loss_fabrication', regex: /stop[_-]?loss\s*\?\?\s*[^,;\n]+\*\s*0?\.9\d/i, severity: 'high' },
  { name: 'stop_loss_fabrication', regex: /stop[_-]?loss\s*\?\?\s*[^,;\n]+\*\s*0?\.0\d/i, severity: 'high' },

  // Target price fabrication
  { name: 'target_price_fabrication', regex: /target[_-]?price\s*\?\?\s*[^,;\n]+\*\s*1\.\d+/i, severity: 'high' },

  // Position size fabrication
  { name: 'position_size_fabrication', regex: /position[_-]?size\s*\*\s*0?\.0\d/i, severity: 'medium' },

  // Fair value fabrication
  { name: 'fair_value_fabrication', regex: /fair[_-]?value\s*\?\?\s*[^,;\n]+\*\s*\d/i, severity: 'high' },

  // Expected value fabrication
  { name: 'expected_fabrication', regex: /expected\s*\?\?\s*['"`]/i, severity: 'medium' },

  // Score fabrication
  { name: 'score_fabrication', regex: /score\s*\|\|\s*(?:50|45|55|60)\b/i, severity: 'medium' },
];

// تخطي التعليقات والأدلة الوصفية للإزالة
function isCommentOrDoc(line: string): boolean {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('#')) return true;
  if (t.startsWith('/*') || t.startsWith('"""') || t.startsWith("'''")) return true;
  // documentation of what was removed
  if (/removed|FIX|ISSUE-3|Previous:|was:|fabricat|no longer|deleted/i.test(line)) return true;
  return false;
}

interface Finding {
  file: string;
  line: number;
  match: string;
  patternName: string;
  severity: 'high' | 'medium' | 'low';
}

const findings: Finding[] = [];
const skippedFiles = new Set<string>([
  'test_issue_3_no_fabricated_levels.ts',
  'test_issue_3_deep_scan.ts',
]);

function scanFile(filePath: string) {
  const baseName = filePath.split('/').pop() || '';
  if (skippedFiles.has(baseName)) return;

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
    if (isCommentOrDoc(line)) return;

    for (const { name, regex, severity } of PATTERNS) {
      if (regex.test(line)) {
        findings.push({
          file: relative(ROOT, filePath),
          line: idx + 1,
          match: line.trim().slice(0, 200),
          patternName: name,
          severity,
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
    if (entry === 'node_modules' || entry === '.next' || entry === '.git' ||
        entry === '__pycache__' || entry === '.venv' || entry === 'venv' ||
        entry === 'dist' || entry === 'build') continue;
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        scanDir(fullPath);
      } else {
        scanFile(fullPath);
      }
    } catch {
      // ignore
    }
  }
}

console.log('=== Deep Fabrication Scan — Issue #3 ===\n');
console.log(`Scan dirs: ${SCAN_DIRS.length}`);
for (const d of SCAN_DIRS) scanDir(d);

console.log(`\nTotal findings: ${findings.length}\n`);

// Group by severity
const bySeverity = {
  high: findings.filter(f => f.severity === 'high'),
  medium: findings.filter(f => f.severity === 'medium'),
  low: findings.filter(f => f.severity === 'low'),
};

console.log(`🔴 HIGH:   ${bySeverity.high.length}`);
console.log(`🟡 MEDIUM: ${bySeverity.medium.length}`);
console.log(`🟢 LOW:    ${bySeverity.low.length}\n`);

// Group by file (HIGH severity only)
const byFile: Record<string, Finding[]> = {};
for (const f of bySeverity.high) {
  if (!byFile[f.file]) byFile[f.file] = [];
  byFile[f.file].push(f);
}

console.log('=== HIGH severity findings by file ===\n');
const sortedFiles = Object.keys(byFile).sort();
for (const file of sortedFiles) {
  console.log(`📄 ${file} (${byFile[file].length} matches):`);
  for (const f of byFile[file]) {
    console.log(`  L${f.line} [${f.patternName}]: ${f.match}`);
  }
  console.log();
}

// Summary
console.log('=== Summary ===');
console.log(`Files with HIGH severity: ${sortedFiles.length}`);
console.log(`Total HIGH findings: ${bySeverity.high.length}`);
console.log(`\nRecommendation: review each HIGH finding manually.`);
console.log(`Patterns to fix: multipliers on entry/stop/target/price/current/support/resistance.`);
