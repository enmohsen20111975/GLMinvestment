import json

with open('/home/meme/my_apps/GLMinvestment/scripts/output/maker_radar_EGX_20261013.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

print('Counts:')
for k in ['explosive_list', 'pre_surge_list', 'early_break_list', 'quiet_list', 'under_microscope']:
    items = d.get(k, [])
    print(f'  {k}: {len(items)}')

print('\nExplosive tickers:')
for s in d.get('explosive_list', []):
    print(' ', s.get('ticker'), s.get('name_ar'))

print('\nPre-surge tickers:')
for s in d.get('pre_surge_list', []):
    print(' ', s.get('ticker'), s.get('name_ar'))

print('\nQuiet tickers (first 10):')
for s in d.get('quiet_list', [])[:10]:
    print(' ', s.get('ticker'), s.get('name_ar'))
