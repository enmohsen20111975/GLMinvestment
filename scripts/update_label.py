from pathlib import Path

def update():
    target = Path('/home/meme/my_apps/GLMinvestment/src/components/analysis/MarketAnalysisView.tsx')
    if not target.exists():
        print("Target file not found!")
        return
        
    text = target.read_text(encoding='utf-8')
    
    old_1 = '<th className="p-2 text-center font-medium text-primary">السعر الحالي</th>'
    new_1 = '<th className="p-2 text-center font-medium text-primary">السعر وقت التحليل</th>'
    
    old_2 = '<p className="text-xs text-muted-foreground">السعر الحالي</p>'
    new_2 = '<p className="text-xs text-muted-foreground">السعر وقت التحليل</p>'
    
    old_3 = '<div style={{ fontSize: \'12px\', color: \'#94a3b8\' }}>السعر الحالي</div>'
    new_3 = '<div style={{ fontSize: \'12px\', color: \'#94a3b8\' }}>السعر وقت التحليل</div>'
    
    count_1 = text.count(old_1)
    count_2 = text.count(old_2)
    count_3 = text.count(old_3)
    
    text = text.replace(old_1, new_1)
    text = text.replace(old_2, new_2)
    text = text.replace(old_3, new_3)
    
    target.write_text(text, encoding='utf-8')
    print(f"Updated {count_1} th headers, {count_2} p tags, {count_3} div tags in MarketAnalysisView.tsx!")

if __name__ == '__main__':
    update()
