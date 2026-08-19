#!/usr/bin/env python3
"""Clean customer-facing technical text from AIAnalysisWidget + LiveMonitor"""

# Fix AIAnalysisWidget.tsx
filepath = '/home/z/my-project/src/components/ai/AIAnalysisWidget.tsx'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

replacements = [
    # Card titles (customer-facing)
    ('تحليل Python MasterAnalyzer', 'التحليل الذكي للسهم'),
    # Source badge
    ('Python MasterAnalyzer - المصدر الموحد', 'التحليل الآلي للسهم'),
    # Error messages (customer-facing)
    ('فشل الاتصال بخادم Python', 'فشل تحميل التحليل'),
    ('لم يتم الحصول على تحليل من Python MasterAnalyzer.', 'لا يوجد تحليل متاح لهذا السهم حالياً.'),
    ('فشل في الاتصال بخدمة Python MasterAnalyzer.', 'تعذر تحميل التحليل. حاول مرة أخرى.'),
]

count = 0
for old, new in replacements:
    n = content.count(old)
    if n > 0:
        content = content.replace(old, new)
        count += n
        print(f'  replaced {n}x: {old[:40]}...')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print(f'AIAnalysisWidget: {count} replacements')

# Fix LiveMonitor.tsx
filepath2 = '/home/z/my-project/src/components/dashboard/LiveMonitor.tsx'
with open(filepath2, 'r', encoding='utf-8') as f:
    content2 = f.read()

old2 = 'التحديث التلقائي كل {REFRESH_INTERVAL} ثوانٍ • البيانات من Python'
new2 = 'التحديث التلقائي كل {REFRESH_INTERVAL} ثوانٍ'
if old2 in content2:
    content2 = content2.replace(old2, new2, 1)
    print('LiveMonitor: 1 replacement')
    with open(filepath2, 'w', encoding='utf-8') as f:
        f.write(content2)
else:
    print('LiveMonitor: NOT FOUND (may already be fixed)')

print('DONE')
