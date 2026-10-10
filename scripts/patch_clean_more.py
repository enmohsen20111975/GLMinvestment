#!/usr/bin/env python3
"""Clean more customer-facing technical text (non-admin screens only)"""

fixes = [
    # StockAdvancedAnalysisView.tsx (customer-facing)
    (
        '/home/z/my-project/src/components/stocks/StockAdvancedAnalysisView.tsx',
        [('Python MasterAnalyzer', 'التحليل الذكي للسهم')],
    ),
    # SelfLearningView.tsx (customer-facing — remove VPS IP hint)
    (
        '/home/z/my-project/src/components/self-learning/SelfLearningView.tsx',
        [('<div>Python Backend: <code className="bg-gray-200 dark:bg-gray-800 px-1 rounded">VPS YOUR_VPS_IP:8010</code></div>',
          '<div>الخدمة الخلفية للتحليل</div>')],
    ),
    # CryptoRecommendationsView.tsx (archived v404, but still customer-facing)
    (
        '/home/z/my-project/src/components/crypto/_archived_v404/CryptoRecommendationsView.tsx',
        [('Crypto Flow Engine · Python Backend', 'محرك تحليل العملات')],
    ),
]

total = 0
for filepath, replacements in fixes:
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        print(f'SKIP (not found): {filepath}')
        continue
    count = 0
    for old, new in replacements:
        n = content.count(old)
        if n > 0:
            content = content.replace(old, new)
            count += n
    if count > 0:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'{filepath.split("/")[-1]}: {count} replacements')
        total += count
    else:
        print(f'{filepath.split("/")[-1]}: no changes')

print(f'TOTAL: {total} replacements')
