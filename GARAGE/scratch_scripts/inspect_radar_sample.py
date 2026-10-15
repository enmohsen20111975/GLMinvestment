import json

with open('/home/meme/my_apps/GLMinvestment/scripts/output/maker_radar_EGX_20261013.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

for k in ['explosive_list', 'pre_surge_list', 'quiet_list']:
    items = d.get(k, [])
    if items:
        print(f'=== Sample from {k} ===')
        sample = items[0]
        for key, val in sample.items():
            print(f'  {key}: {val}')
