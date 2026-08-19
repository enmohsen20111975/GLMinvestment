<<<<<<< Updated upstream
#!/bin/bash
# سكريبت نقل بيانات التحليلات على VPS

echo "========================================"
echo "نقل بيانات التحليلات من stocks.db"
echo "========================================"

cd ~/GLMinvestment

# 1. سحب التحديثات
echo ""
echo "1. سحب التحديثات..."
git pull

# 2. أرقام قبل النقل
echo ""
echo "2. أرقام قبل النقل:"
echo "   prediction_logs: $(sqlite3 db/stocks.db 'SELECT COUNT(*) FROM prediction_logs' 2>/dev/null || echo 0)"
echo "   signal_logs: $(sqlite3 db/stocks.db 'SELECT COUNT(*) FROM signal_logs' 2>/dev/null || echo 0)"
echo "   outcome_logs: $(sqlite3 db/stocks.db 'SELECT COUNT(*) FROM outcome_logs' 2>/dev/null || echo 0)"
echo "   recommendations: $(sqlite3 db/stocks.db 'SELECT COUNT(*) FROM recommendations' 2>/dev/null || echo 0)"

# 3. تشغيل سكريبت النقل
echo ""
echo "3. تشغيل سكريبت النقل..."
node scripts/migrate-analysis-data.js

# 4. أرقام بعد النقل
echo ""
echo "4. أرقام بعد النقل في stocks.db:"
echo "   prediction_logs: $(sqlite3 db/stocks.db 'SELECT COUNT(*) FROM prediction_logs' 2>/dev/null || echo 0)"
echo "   signal_logs: $(sqlite3 db/stocks.db 'SELECT COUNT(*) FROM signal_logs' 2>/dev/null || echo 0)"
echo "   outcome_logs: $(sqlite3 db/stocks.db 'SELECT COUNT(*) FROM outcome_logs' 2>/dev/null || echo 0)"
echo "   learned_lessons: $(sqlite3 db/stocks.db 'SELECT COUNT(*) FROM learned_lessons' 2>/dev/null || echo 0)"

echo ""
echo "✅ تم الانتهاء!"
=======
#!/bin/bash
# سكريبت نقل بيانات التحليلات على VPS

echo "========================================"
echo "نقل بيانات التحليلات من egx_investment.db"
echo "========================================"

cd ~/GLMinvestment

# 1. سحب التحديثات
echo ""
echo "1. سحب التحديثات..."
git pull

# 2. أرقام قبل النقل
echo ""
echo "2. أرقام قبل النقل:"
echo "   prediction_logs: $(sqlite3 db/egx_investment.db 'SELECT COUNT(*) FROM prediction_logs' 2>/dev/null || echo 0)"
echo "   signal_logs: $(sqlite3 db/egx_investment.db 'SELECT COUNT(*) FROM signal_logs' 2>/dev/null || echo 0)"
echo "   outcome_logs: $(sqlite3 db/egx_investment.db 'SELECT COUNT(*) FROM outcome_logs' 2>/dev/null || echo 0)"
echo "   recommendations: $(sqlite3 db/egx_investment.db 'SELECT COUNT(*) FROM recommendations' 2>/dev/null || echo 0)"

# 3. تشغيل سكريبت النقل
echo ""
echo "3. تشغيل سكريبت النقل..."
node scripts/migrate-analysis-data.js

# 4. أرقام بعد النقل
echo ""
echo "4. أرقام بعد النقل في stocks.db:"
echo "   prediction_logs: $(sqlite3 db/stocks.db 'SELECT COUNT(*) FROM prediction_logs' 2>/dev/null || echo 0)"
echo "   signal_logs: $(sqlite3 db/stocks.db 'SELECT COUNT(*) FROM signal_logs' 2>/dev/null || echo 0)"
echo "   outcome_logs: $(sqlite3 db/stocks.db 'SELECT COUNT(*) FROM outcome_logs' 2>/dev/null || echo 0)"
echo "   learned_lessons: $(sqlite3 db/stocks.db 'SELECT COUNT(*) FROM learned_lessons' 2>/dev/null || echo 0)"

echo ""
echo "✅ تم الانتهاء!"
>>>>>>> Stashed changes
