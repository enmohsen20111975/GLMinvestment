#!/bin/bash
# ============================================================================
# check_v402_predictions.sh — فحص توقعات V40.2 بدون sqlite3 (باستخدام Python)
# ============================================================================
# للمالك: شغّل هذا على السرفر بدل أمر sqlite3 (الذي غير مثبت لديك)
# ============================================================================

cd ~/my_apps/GLMinvestment

echo "=========================================="
echo "📊 فحص توقعات V40.2 (بدون sqlite3)"
echo "=========================================="
echo ""

python3 << 'PYEOF'
import sqlite3, os, json

db_path = 'db/predictions.db'
if not os.path.exists(db_path):
    print(f'❌ {db_path} غير موجود')
    exit(1)

try:
    c = sqlite3.connect(db_path)
    
    # 1. فحص الأعمدة الجديدة
    print('📋 [1] فحص الأعمدة الجديدة في predictions table:')
    cols = [row[1] for row in c.execute('PRAGMA table_info(predictions)').fetchall()]
    new_cols = ['risk_reward', 'who_is_buying']
    for col in new_cols:
        if col in cols:
            print(f'  ✅ {col} موجود')
        else:
            print(f'  ❌ {col} غير موجود (الـ migration لم يعمل بعد)')
    
    print()
    
    # 2. آخر 15 توقع
    print('📋 [2] آخر 15 توقع (تحقق من risk_reward + who_is_buying):')
    rows = c.execute('''
        SELECT ticker, signal, master_score, risk_reward, who_is_buying, evidence_count,
               entry_price, target_price, stop_loss, prediction_date, status
        FROM predictions
        WHERE prediction_date >= date('now', '-2 days')
        ORDER BY id DESC LIMIT 15
    ''').fetchall()
    
    if rows:
        print(f'  ✅ {len(rows)} توقع:')
        print()
        print(f'  {"Ticker":<8} {"Signal":<20} {"Score":<6} {"R:R":<6} {"Who":<30} {"Ev":<4} {"Status":<12}')
        print(f'  {"-"*8} {"-"*20} {"-"*6} {"-"*6} {"-"*30} {"-"*4} {"-"*12}')
        for r in rows:
            ticker = r[0] or '—'
            signal = r[1] or '—'
            score = f'{r[2]:.0f}' if r[2] else '—'
            rr = f'{r[3]:.2f}' if r[3] else 'NULL'
            who = (r[4] or '—')[:28]
            ev = str(r[5] or 0)
            status = r[10] or '—'
            print(f'  {ticker:<8} {signal:<20} {score:<6} {rr:<6} {who:<30} {ev:<4} {status:<12}')
    else:
        print('  ⚠️ لا توجد توقعات حديثة')
    
    print()
    
    # 3. إحصائيات
    print('📋 [3] إحصائيات التوقعات الحديثة:')
    stats = c.execute('''
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN risk_reward IS NOT NULL THEN 1 END) as has_rr,
            COUNT(CASE WHEN who_is_buying IS NOT NULL AND who_is_buying != '' THEN 1 END) as has_who,
            COUNT(CASE WHEN signal != 'HOLD' THEN 1 END) as non_hold,
            AVG(master_score) as avg_score
        FROM predictions
        WHERE prediction_date >= date('now', '-2 days')
    ''').fetchone()
    
    if stats and stats[0] > 0:
        print(f'  إجمالي التوقعات: {stats[0]}')
        print(f'  توقعات لها risk_reward: {stats[1]}/{stats[0]} ({100*stats[1]//stats[0] if stats[0] else 0}%)')
        print(f'  توقعات لها who_is_buying: {stats[2]}/{stats[0]} ({100*stats[2]//stats[0] if stats[0] else 0}%)')
        print(f'  توقعات غير HOLD: {stats[3]}/{stats[0]} ({100*stats[3]//stats[0] if stats[0] else 0}%)')
        print(f'  متوسط master_score: {stats[4]:.1f}' if stats[4] else '  متوسط master_score: —')
    else:
        print('  ⚠️ لا توجد توقعات حديثة')
    
    print()
    
    # 4. آخر 3 توقعات بتفاصيل كاملة
    print('📋 [4] آخر 3 توقعات (تفاصيل كاملة):')
    rows = c.execute('''
        SELECT ticker, signal, master_score, risk_reward, who_is_buying,
               entry_price, target_price, stop_loss, evidence_count, analysis_json,
               prediction_date
        FROM predictions
        WHERE prediction_date >= date('now', '-2 days')
        ORDER BY id DESC LIMIT 3
    ''').fetchall()
    
    for r in rows:
        print(f'  ─── {r[0]} ({r[1]}) | {r[10]} ───')
        print(f'    Score: {r[2]:.0f}/100 | R:R: {r[3] if r[3] else "NULL"} | Evidence: {r[8]}/6')
        print(f'    Entry: {r[5]} | Target: {r[6]} | Stop: {r[7]}')
        print(f'    Who is buying: {r[4] or "—"}')
        if r[9]:
            try:
                aj = json.loads(r[9])
                reason = aj.get('analysis_reason', '')
                if reason:
                    print(f'    Analysis reason: {reason[:120]}...' if len(reason) > 120 else f'    Analysis reason: {reason}')
            except:
                pass
        print()
    
    c.close()
    
    print('==========================================')
    print('✅ اكتمل الفحص — أرسل النتائج للمالك')
    print('==========================================')
    
except Exception as e:
    print(f'❌ خطأ: {e}')
PYEOF
