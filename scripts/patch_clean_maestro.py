#!/usr/bin/env python3
"""Clean Maestro customer-facing text"""

# Fix MaestroWidget.tsx
filepath = '/home/z/my-project/src/components/dashboard/MaestroWidget.tsx'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

replacements = [
    ('Maestro System', 'نظام التحليل المتكامل'),
]
count = 0
for old, new in replacements:
    n = content.count(old)
    if n > 0:
        content = content.replace(old, new)
        count += n
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print(f'MaestroWidget: {count} replacements')

# Fix MaestroCommandCenter.tsx
filepath2 = '/home/z/my-project/src/components/dashboard/MaestroCommandCenter.tsx'
with open(filepath2, 'r', encoding='utf-8') as f:
    content2 = f.read()

replacements2 = [
    # Customer-facing JSX text
    ('Maestro Command Center v{data.system.version}', 'مركز التحليل v{data.system.version}'),
    ('Maestro Orchestrator — The Conductor', 'محرك التحليل الموحد'),
]
count2 = 0
for old, new in replacements2:
    n = content2.count(old)
    if n > 0:
        content2 = content2.replace(old, new)
        count2 += n
with open(filepath2, 'w', encoding='utf-8') as f:
    f.write(content2)
print(f'MaestroCommandCenter: {count2} replacements')

print('DONE')
