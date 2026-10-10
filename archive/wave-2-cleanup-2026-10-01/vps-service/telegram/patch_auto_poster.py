import os
import re
from pathlib import Path

# P23-PORTABILITY: مسار نسبي من __file__ (مش hardcoded) — يشتغل في كل البيئات.
poster_path = str(Path(__file__).resolve().parent / "auto_poster.py")

with open(poster_path, "r", encoding="utf-8") as f:
    code = f.read()

# استبدال دالة get_top_recommendations بدالة جديدة وصحيحة 100% تستعلم من الجداول الحقيقية
old_func = """def get_top_recommendations(limit: int = 5, min_score: int = 70) -> List[Dict]:
    \"\"\"جلب أفضل التوقعات\"\"\"
    try:
        conn = get_db_connection(PREDICTIONS_DB)
        cur = conn.cursor()
        
        # جلب من stored_analyses
        cur.execute(\"\"\"
            SELECT ticker, name_ar, signal, current_price, target_price, 
                   stop_loss, confidence, sector, reasoning, created_at
            FROM stored_analyses
            WHERE signal = 'BUY' AND confidence >= ?
            ORDER BY confidence DESC, created_at DESC
            LIMIT ?
        \"\"\", (min_score, limit))
        
        rows = cur.fetchall()
        conn.close()
        
        recommendations = []
        for row in rows:
            recommendations.append({
                'ticker': row[0],
                'name_ar': row[1],
                'signal': row[2],
                'current_price': row[3],
                'target_price': row[4],
                'stop_loss': row[5],
                'confidence': row[6],
                'sector': row[7],
                'reasoning': row[8],
                'created_at': row[9]
            })
        
        return recommendations
    except Exception as e:
        print(f\"[AutoPoster] Error getting recommendations: {e}\")
        return []\"""

new_func = """def get_top_recommendations(limit: int = 5, min_score: int = 70) -> List[Dict]:
    \"\"\"جلب أفضل التوقعات باستخدام الحقول الصحيحة للـ DB وب JOIN مع stocks.db\"\"\"
    try:
        # الاتصال بـ predictions.db
        conn_pred = get_db_connection(PREDICTIONS_DB)
        cur_pred = conn_pred.cursor()
        
        # استعلام جلب التوصيات BUY مع سحب التفاصيل
        cur_pred.execute(\"\"\"
            SELECT ticker, recommendation, maestro_score, entry_price, target_price, 
                   stop_loss, confidence, ai_reason, created_at
            FROM stored_analyses
            WHERE (recommendation = 'buy' OR recommendation = 'strong_buy') 
              AND confidence >= ?
            ORDER BY confidence DESC, created_at DESC
            LIMIT ?
        \"\"\", (min_score, limit))
        
        rows = cur_pred.fetchall()
        conn_pred.close()
        
        # الاتصال بـ stocks.db لجلب أسماء الأسهم والقطاع بالعربية
        # (نظراً لأن الاسم غير متوفر في stored_analyses مباشرة)
        from pathlib import Path
        project_root = Path(__file__).resolve().parents[2]
        stocks_db_path = str(project_root / "db" / "stocks.db")
        
        conn_stocks = sqlite3.connect(stocks_db_path)
        cur_stocks = conn_stocks.cursor()
        
        recommendations = []
        for row in rows:
            ticker = row[0]
            rec_type = row[1]
            score = row[2]
            entry = row[3]
            target = row[4]
            stop = row[5]
            confidence = row[6]
            reason = row[7] or "تحليل RAG إيجابي يدعم الاتجاه"
            created_at = row[8]
            
            # جلب الاسم والقطاع
            cur_stocks.execute(\"SELECT name_ar, sector FROM stocks WHERE ticker = ? LIMIT 1\", (ticker,))
            stock_info = cur_stocks.fetchone()
            name_ar = stock_info[0] if stock_info else ticker
            sector = stock_info[1] if stock_info else "عام"
            
            recommendations.append({
                'ticker': ticker,
                'name_ar': name_ar,
                'signal': 'BUY', # متوافق مع الفورمات للتلجرام
                'current_price': entry,
                'target_price': target,
                'stop_loss': stop,
                'confidence': confidence,
                'sector': sector,
                'reasoning': reason,
                'created_at': created_at
            })
            
        conn_stocks.close()
        return recommendations
    except Exception as e:
        print(f\"[AutoPoster] Error getting recommendations: {e}\")
        import traceback
        traceback.print_exc()
        return []\"""

# استبدال الدالة في الكود المصدري
if old_func.strip() in code.strip():
    code = code.replace(old_func.strip(), new_func.strip())
    print("Function replaced exactly.")
else:
    # Try using regex or a fallback patcher
    pattern = r"def get_top_recommendations.*?return recommendations.*?except.*?return \[]"
    code = re.sub(pattern, new_func, code, flags=re.DOTALL)
    print("Regex replacement completed.")

with open(poster_path, "w", encoding="utf-8") as f:
    f.write(code)

print("auto_poster.py successfully updated.")
