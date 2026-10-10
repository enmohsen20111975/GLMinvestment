#!/usr/bin/env python3
"""
Clean and Regenerate Predictions
================================
سكريبت لتنظيف التوقعات التالفة وإعادة توليدها ببيانات صحيحة

المشكلة:
- entry_price من سهم معين
- target_price و stop_loss من سهم تاني!
- النتيجة: نسب تغييرات خيالية (1000%+)

الحل:
1. مسح التوقعات القديمة
2. إعادة توليد التوقعات من stored_analyses بقراءة الأسعار الصحيحة
3. فلترة التوقعات غير المنطقية

Usage:
    python3 scripts/clean_and_regenerate_predictions.py [--market EGX] [--dry-run]
"""

import sqlite3
import json
import os
import sys
from datetime import datetime
from contextlib import contextmanager

# ============================================================================
# CONFIGURATION
# ============================================================================

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_DIR = os.path.join(PROJECT_ROOT, 'db')

STOCKS_DB = os.path.join(DB_DIR, 'stocks.db')
PREDICTIONS_DB = os.path.join(DB_DIR, 'predictions.db')
PRICE_HISTORY_DB = os.path.join(DB_DIR, 'price_history.db')

# التغيرات المنطقية (نسبة الربح/الخسارة)
MIN_REASONABLE_PCT = -50  # أقل نسبة خسارة منطقية
MAX_REASONABLE_PCT = 100  # أكبر نسبة ربح منطقية


@contextmanager
def get_db(db_path):
    """Get database connection"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def get_stock_price(symbol):
    """الحصول على السعر الصحيح للسهم"""
    # Try stocks.db first
    with get_db(STOCKS_DB) as conn:
        c = conn.cursor()
        c.execute("SELECT current_price, previous_close FROM stocks WHERE ticker = ?", (symbol,))
        row = c.fetchone()
        if row and row['current_price'] and row['current_price'] > 0:
            return float(row['current_price'])
    
    # Try price_history.db
    try:
        with get_db(PRICE_HISTORY_DB) as conn:
            c = conn.cursor()
            c.execute(
                "SELECT close_price FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT 1",
                (symbol,)
            )
            row = c.fetchone()
            if row and row['close_price']:
                return float(row['close_price'])
    except Exception:
        pass
    
    return None


def is_prediction_reasonable(entry_price, target_price, stop_loss, signal_type):
    """فحص إذا كان التوقع منطقي"""
    if not entry_price or entry_price <= 0:
        return False, "entry_price <= 0"
    
    if not target_price or target_price <= 0:
        return False, "target_price <= 0"
    
    if not stop_loss or stop_loss <= 0:
        return False, "stop_loss <= 0"
    
    # حساب نسب التغير
    target_pct = ((target_price - entry_price) / entry_price) * 100
    stop_pct = ((stop_loss - entry_price) / entry_price) * 100
    
    # فحص النسب المنطقية
    if target_pct < MIN_REASONABLE_PCT or target_pct > MAX_REASONABLE_PCT:
        return False, f"target_pct={target_pct:.1f}% غير منطقي"
    
    if abs(stop_pct) > 30:  # وقف الخسارة عادة 5-15%
        return False, f"stop_pct={stop_pct:.1f}% عالي جداً"
    
    # فحص منطق الإشارة
    if signal_type == 'BUY':
        if target_price <= entry_price:
            return False, "BUY لكن target <= entry"
        if stop_loss >= entry_price:
            return False, "BUY لكن stop >= entry"
    elif signal_type == 'SELL':
        if target_price >= entry_price:
            return False, "SELL لكن target >= entry"
        if stop_loss <= entry_price:
            return False, "SELL لكن stop <= entry"
    
    return True, "OK"


def clean_predictions(market=None, dry_run=False):
    """تنظيف التوقعات التالفة"""
    print("=" * 60)
    print("🧹 تنظيف التوقعات التالفة")
    print("=" * 60)
    
    with get_db(PREDICTIONS_DB) as conn:
        c = conn.cursor()
        
        # إحصائيات قبل التنظيف
        c.execute("SELECT COUNT(*) as cnt FROM aiPrediction")
        total_before = c.fetchone()['cnt']
        print(f"\n📊 إجمالي التوقعات قبل التنظيف: {total_before}")
        
        # فحص كل توقع
        c.execute("SELECT * FROM aiPrediction")
        
        all_preds = c.fetchall()
        bad_preds = []
        good_preds = []
        
        for pred in all_preds:
            is_ok, reason = is_prediction_reasonable(
                pred['entry_price'],
                pred['target_price'],
                pred['stop_loss'],
                pred['signal_type']
            )
            
            if not is_ok:
                bad_preds.append((pred['id'], pred['stock_symbol'], reason, pred))
            else:
                good_preds.append(pred)
        
        print(f"✅ توقعات صحيحة: {len(good_preds)}")
        print(f"❌ توقعات تالفة: {len(bad_preds)}")
        
        # عرض أمثلة للتوقعات التالفة
        if bad_preds:
            print("\n📋 أمثلة للتوقعات التالفة:")
            for pred_id, symbol, reason, pred in bad_preds[:5]:
                print(f"  - {symbol}: entry={pred['entry_price']} target={pred['target_price']} stop={pred['stop_loss']}")
                print(f"    السبب: {reason}")
        
        # حذف التوقعات التالفة
        if not dry_run and bad_preds:
            print(f"\n🗑️  جاري حذف {len(bad_preds)} توقع تالف...")
            for pred_id, _, _, _ in bad_preds:
                c.execute("DELETE FROM aiPrediction WHERE id = ?", (pred_id,))
            conn.commit()
            print("✅ تم الحذف")
        
        # إحصائيات بعد التنظيف
        c.execute("SELECT COUNT(*) as cnt FROM aiPrediction")
        total_after = c.fetchone()['cnt']
        print(f"\n📊 إجمالي التوقعات بعد التنظيف: {total_after}")
        
        return len(bad_preds), len(good_preds)


def regenerate_predictions(market=None, dry_run=False):
    """إعادة توليد التوقعات من stored_analyses"""
    print("\n" + "=" * 60)
    print("🔄 إعادة توليد التوقعات من stored_analyses")
    print("=" * 60)
    
    with get_db(PREDICTIONS_DB) as conn:
        c = conn.cursor()
        
        # جلب التحليلات المحفوظة
        if market:
            c.execute(
                "SELECT * FROM stored_analyses WHERE market = ? ORDER BY maestro_score DESC",
                (market,)
            )
        else:
            c.execute("SELECT * FROM stored_analyses ORDER BY maestro_score DESC")
        
        analyses = c.fetchall()
        print(f"\n📊 عدد التحليلات المحفوظة: {len(analyses)}")
        
        today = datetime.now().strftime('%Y-%m-%d')
        created = 0
        skipped = 0
        errors = 0
        
        for analysis in analyses:
            try:
                symbol = analysis['ticker']
                signal_type = analysis['recommendation']
                
                # تحويل الإشارة (البيانات في stored_analyses بأحرف صغيرة)
                signal_upper = signal_type.upper() if signal_type else ''
                if signal_upper in ['STRONG_BUY', 'BUY', 'ACCUMULATE']:
                    signal_type = 'BUY'
                elif signal_upper in ['STRONG_SELL', 'SELL', 'REDUCE']:
                    signal_type = 'SELL'
                elif signal_upper in ['NO_DATA', 'REJECTED_RR']:
                    skipped += 1
                    continue
                else:
                    # hold - نتخطاه
                    skipped += 1
                    continue
                
                # الحصول على السعر الصحيح من stocks.db أو price_history.db
                entry_price = get_stock_price(symbol)
                if not entry_price or entry_price <= 0:
                    errors += 1
                    continue
                
                # حساب target و stop_loss بشكل صحيح
                confidence = float(analysis['confidence'] or 50)
                base_percent = 0.10 if confidence >= 80 else 0.07 if confidence >= 60 else 0.05
                stop_percent = 0.05  # 5% وقف خسارة
                
                if signal_type == 'BUY':
                    target_price = entry_price * (1 + base_percent)
                    stop_loss = entry_price * (1 - stop_percent)
                else:  # SELL
                    target_price = entry_price * (1 - base_percent)
                    stop_loss = entry_price * (1 + stop_percent)
                
                # فحص المنطقية
                is_ok, _ = is_prediction_reasonable(entry_price, target_price, stop_loss, signal_type)
                if not is_ok:
                    errors += 1
                    continue
                
                # فحص عدم التكرار
                c.execute(
                    "SELECT id FROM aiPrediction WHERE stock_symbol = ? AND prediction_date = ?",
                    (symbol, today)
                )
                if c.fetchone():
                    skipped += 1
                    continue
                
                if not dry_run:
                    # إدراج التوقع الجديد
                    import uuid
                    pred_id = str(uuid.uuid4())
                    c.execute("""
                        INSERT INTO aiPrediction 
                        (id, stock_symbol, stock_name_ar, maestro_score, confidence, signal_type,
                         entry_price, target_price, stop_loss, regime, phase_scores, 
                         prediction_date, status, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        pred_id,
                        symbol,
                        analysis['ticker'],
                        float(analysis['maestro_score'] or 50),
                        confidence,
                        signal_type,
                        entry_price,
                        target_price,
                        stop_loss,
                        analysis['regime'] or 'NEUTRAL',
                        json.dumps({'source': 'regenerated'}),
                        today,
                        'PENDING',
                        datetime.now().isoformat()
                    ))
                
                created += 1
                
            except Exception as e:
                errors += 1
                if errors <= 3:
                    print(f"  ❌ خطأ: {e}")
        
        if not dry_run:
            conn.commit()
        
        print(f"\n✅ توقعات جديدة: {created}")
        print(f"⏭️  تم تخطي: {skipped}")
        print(f"❌ أخطاء: {errors}")
        
        return created


def show_stats():
    """عرض إحصائيات التوقعات"""
    print("\n" + "=" * 60)
    print("📊 إحصائيات التوقعات")
    print("=" * 60)
    
    with get_db(PREDICTIONS_DB) as conn:
        c = conn.cursor()
        
        # إجمالي التوقعات
        c.execute("SELECT COUNT(*) as cnt FROM aiPrediction")
        print(f"إجمالي التوقعات: {c.fetchone()['cnt']}")
        
        # حسب التاريخ
        c.execute("""
            SELECT prediction_date, COUNT(*) as cnt 
            FROM aiPrediction 
            GROUP BY prediction_date 
            ORDER BY prediction_date DESC 
            LIMIT 5
        """)
        print("\nأحدث التوقعات:")
        for row in c.fetchall():
            print(f"  {row['prediction_date']}: {row['cnt']} توقع")
        
        # عينة من أحدث التوقعات
        c.execute("""
            SELECT stock_symbol, signal_type, entry_price, target_price, stop_loss, prediction_date
            FROM aiPrediction 
            ORDER BY prediction_date DESC, maestro_score DESC 
            LIMIT 5
        """)
        print("\nعينة من أحدث التوقعات:")
        for row in c.fetchall():
            entry = row['entry_price'] or 0
            target = row['target_price'] or 0
            pct = ((target - entry) / entry * 100) if entry > 0 else 0
            print(f"  {row['stock_symbol']}: {row['signal_type']} entry={entry} target={target} ({pct:+.1f}%) stop={row['stop_loss']}")


def main():
    import argparse
    parser = argparse.ArgumentParser(description='تنظيف وإعادة توليد التوقعات')
    parser.add_argument('--market', type=str, default=None, help='السوق المستهدف (EGX, TADAWUL, etc.)')
    parser.add_argument('--dry-run', action='store_true', help='معاينة بدون حفظ')
    args = parser.parse_args()
    
    if args.dry_run:
        print("⚠️  وضع المعاينة - لن يتم حفظ التغييرات")
    
    # 1. تنظيف التوقعات التالفة
    bad_count, good_count = clean_predictions(market=args.market, dry_run=args.dry_run)
    
    # 2. إعادة توليد التوقعات
    created = regenerate_predictions(market=args.market, dry_run=args.dry_run)
    
    # 3. عرض الإحصائيات
    show_stats()
    
    print("\n" + "=" * 60)
    print("✨ تم الانتهاء!")
    print("=" * 60)


if __name__ == '__main__':
    main()
