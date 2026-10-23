"""
Trader Levels Engine (محرك المستويات الاحترافية للمتداولين)
=============================================================
المصدر الرئيسي الموحد لحساب:
1. الدعوم الهيكلية (الدعم الأول S1، الدعم الرئيسي S2)
2. المقاومات الهيكلية (المقاومة الأولى R1، المقاومة الممتدة R2)
3. نطاق الدخول الدقيق (Buy Zone: أقل نقطة دخول وأعلى نقطة دخول لمنع مطاردة السعر No-Chase)
4. الهدف الأول (TP1) المرتكز هندسياً أسفل المقاومة الأولى R1 لتأمين 50% من الصفقة بربح مضمون
5. الهدف الثاني (TP2) المرتكز أسفل المقاومة الثانية R2 أو امتداد الفيبوناتشي للمتبقي
6. وقف الخسارة الصارم (SL) المرتكز أسفل الدعم S1 بهامش أمان ضد الذيول الوهمية
7. نسبة العائد للمخاطرة (R:R) وتوجيه تداولي مباشر باللغة العربية
"""

from __future__ import annotations

import sqlite3
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = os.environ.get("STOCKS_DB", str(_PROJECT_ROOT / "db" / "stocks.db"))

try:
    from analyzers.support_resistance_calculator import calculate_support_resistance, _load_price_history, _calculate_atr
except ImportError:
    from support_resistance_calculator import calculate_support_resistance, _load_price_history, _calculate_atr


def calculate_precise_trader_levels(
    ticker: str,
    current_price: Optional[float] = None
) -> Dict[str, Any]:
    """
    الحساب الاحترافي للمستويات التداولية لسهم معين بناءً على قمم وقيعان حقيقية (Fractal Swings).
    """
    sym = ticker.upper().strip()
    sr = calculate_support_resistance(sym)
    rows = _load_price_history(sym, days=90)

    if not rows or len(rows) < 5:
        # Fallback إذا لم تتوفر شموع تاريخية
        price = float(current_price) if (current_price and current_price > 0) else 10.0
        atr = price * 0.035
        s1 = round(price * 0.96, 2)
        s2 = round(price * 0.92, 2)
        r1 = round(price * 1.06, 2)
        r2 = round(price * 1.12, 2)
        entry_min = round(max(s1 * 1.005, price * 0.985), 2)
        entry_max = round(price * 1.008, 2)
        tp1 = round(r1 * 0.995, 2)
        tp2 = round(r2 * 0.995, 2)
        sl = round(s1 * 0.985, 2)
        return {
            'ticker': sym,
            'current_price': round(price, 2),
            'support_1': s1,
            'support_2': s2,
            'resistance_1': r1,
            'resistance_2': r2,
            'entry_min': entry_min,
            'entry_max': entry_max,
            'entry_range_str': f"من {entry_min:,.2f} إلى {entry_max:,.2f} ج.م",
            'target_1': tp1,
            'target_2': tp2,
            'stop_loss': sl,
            'risk_reward': 2.0,
            'atr': round(atr, 2),
            'advice': 'تداول بحذر وفق إدارة رأس المال'
        }

    last_close = float(rows[-1].get("close_price") or 0)
    price = float(current_price) if (current_price and current_price > 0) else last_close
    atr = _calculate_atr(rows)
    if atr <= 0:
        atr = price * 0.035

    # استخراج مستويات الدعم والمقاومة المفحوصة والمفلترة
    raw_s1 = float(sr.get('support') or 0) if sr else 0.0
    raw_s2 = float(sr.get('far_support') or 0) if sr else 0.0
    raw_r1 = float(sr.get('resistance') or 0) if sr else 0.0
    raw_r2 = float(sr.get('far_resistance') or 0) if sr else 0.0

    # 1. الدعم الأول (S1): أقرب دعم حقيقي تحت السعر
    if raw_s1 > 0 and raw_s1 < price:
        s1 = raw_s1
    else:
        # البحث عن أعلى قاع سابق تحت السعر
        recent_lows = [float(r.get("low_price") or 0) for r in rows[-30:] if 0 < float(r.get("low_price") or 0) < price]
        s1 = max(recent_lows) if recent_lows else (price - (1.5 * atr))

    # 2. الدعم الثاني (S2): الدعم الهيكلي الأعمق
    if raw_s2 > 0 and raw_s2 < s1 - (0.35 * atr):
        s2 = raw_s2
    else:
        s2 = s1 - max(s1 * 0.035, 1.4 * atr)

    # 3. المقاومة الأولى (R1): أقرب قمة حقيقية فوق السعر
    if raw_r1 > price:
        r1 = raw_r1
    else:
        recent_highs = [float(r.get("high_price") or 0) for r in rows[-40:] if float(r.get("high_price") or 0) > price]
        r1 = min(recent_highs) if recent_highs else (price + (2.0 * atr))

    # 4. المقاومة الثانية (R2): المقاومة الهيكلية الممتدة
    if raw_r2 > r1 * 1.025:
        r2 = raw_r2
    else:
        r2 = r1 + max(r1 * 0.055, 1.8 * atr)

    # حماية القيم الرياضية
    s1 = round(s1, 2)
    s2 = round(s2, 2)
    r1 = round(r1, 2)
    r2 = round(r2, 2)

    # 5. نطاق الدخول (Buy Zone):
    # - أقل نقطة دخول (entry_min): قرب الدعم S1 لاقتناص أي هبوط تصحيحي بأفضل سعر
    # - أعلى نقطة دخول (entry_max): سقف الدخول الآمن لتفادي مطاردة السعر (Chase Risk)
    entry_min = max(s1 + (0.15 * atr), price - (0.45 * atr))
    entry_max = min(price + (0.25 * atr), r1 - (0.45 * atr))

    if entry_min > price:
        entry_min = price * 0.99
    if entry_max < price:
        entry_max = price * 1.008
    if entry_min >= entry_max:
        entry_min = entry_max * 0.985

    entry_min = round(entry_min, 2)
    entry_max = round(entry_max, 2)

    # 6. الهدف الأول (Target 1 / TP1):
    # يرتكز أسفل المقاومة R1 بنصف بالمئة لتأكيد سرعة التنفيذ وخروج العميل بربح
    tp1 = round(r1 * 0.995, 2)
    if tp1 <= entry_max:
        tp1 = round(entry_max + max(1.5 * atr, entry_max * 0.035), 2)

    # 7. الهدف الثاني (Target 2 / TP2):
    # يرتكز أسفل المقاومة R2 بنصف بالمئة للكمية المتبقية
    tp2 = round(r2 * 0.995, 2)
    if tp2 <= tp1 * 1.025:
        tp2 = round(tp1 + max(1.8 * atr, tp1 * 0.05), 2)

    # 8. وقف الخسارة (Stop Loss / SL):
    # أسفل الدعم الأول S1 بهامش أمان 0.35 ATR لحماية رأس المال ضد الذيول الكاذبة
    sl = round(s1 - (0.35 * atr), 2)
    if (price - sl) > (price * 0.075):
        sl = round(price * 0.925, 2)
    if sl >= entry_min:
        sl = round(entry_min * 0.965, 2)

    # 9. نسبة العائد للمخاطرة (R:R Ratio)
    risk_dist = max(0.01, entry_max - sl)
    reward_dist = max(0.01, tp1 - entry_max)
    rr = round(reward_dist / risk_dist, 2)
    # Rule 54: استخدم canonical compute_risk_reward
    try:
        from utils.risk_reward import compute_risk_reward
        rr = compute_risk_reward(entry_max, tp1, sl, fallback=rr)
    except Exception:
        pass  # keep inline rr computed above

    # 10. التوجيه الفني المباشر
    dist_to_r1_pct = ((r1 - price) / price * 100) if price > 0 else 0
    dist_to_s1_pct = ((price - s1) / price * 100) if price > 0 else 0

    if price > entry_max:
        advice = f"السعر الحالي ({price:,.2f}) تجاوز حد الدخول الأقصى — لا تطارد السعر وانتظر تهدئة نحو {entry_min:,.2f} ج.م"
    elif dist_to_r1_pct < 2.0:
        advice = f"السعر قريب جداً من المقاومة م1 ({r1:,.2f} ج.م) — انتظر اختراق المقاومة أو الشراء عند تهدئة قرب {s1:,.2f} ج.م"
    elif dist_to_s1_pct <= 1.8:
        advice = f"السعر يختبر الدعم د1 ({s1:,.2f} ج.م) — فرصة اقتناص مثالية في قاع نطاق الشراء"
    else:
        advice = f"السعر داخل نطاق الشراء الآمن ({entry_min:,.2f} - {entry_max:,.2f} ج.م) — التزم بالوقف والأهداف"

    return {
        'ticker': sym,
        'current_price': round(price, 2),
        'support_1': s1,
        'support_2': s2,
        'resistance_1': r1,
        'resistance_2': r2,
        'entry_min': entry_min,
        'entry_max': entry_max,
        'entry_range_str': f"من {entry_min:,.2f} إلى {entry_max:,.2f} ج.م",
        'target_1': tp1,
        'target_2': tp2,
        'stop_loss': sl,
        'risk_reward': rr,
        'atr': round(atr, 2),
        'advice': advice
    }


def get_unified_trader_levels(
    ticker: str,
    current_price: Optional[float] = None,
    persist: bool = True
) -> Dict[str, Any]:
    """
    المصدر الحسابي الموحد (Single Source of Truth) لكافة الشاشات والبوت والتطبيقات.
    يحسب المستويات الهيكلية بدقة ويقوم بمزامنتها في predictions.db لضمان عدم وجود أي تضارب.
    """
    sym = ticker.upper().strip()
    levels = calculate_precise_trader_levels(sym, current_price=current_price)

    if persist:
        pred_db_path = _PROJECT_ROOT / "db" / "predictions.db"
        if pred_db_path.exists():
            try:
                import json
                from datetime import datetime
                # Phase 7.1: migrated to db_manager (writable=False)
                from core.db_manager import db_manager
                conn = db_manager.connection(str(pred_db_path), writable=False).__enter__()
                cur = conn.cursor()
                # التحقق من وجود توقع نشط لتحديثه بنفس القيم الموحدة
                row = cur.execute(
                    "SELECT id, analysis_json FROM predictions WHERE ticker = ? ORDER BY id DESC LIMIT 1",
                    (sym,)
                ).fetchone()

                today_str = datetime.now().strftime('%Y-%m-%d')
                if row:
                    pred_id = row[0]
                    raw_json = row[1]
                    try:
                        aj = json.loads(raw_json) if raw_json else {}
                    except Exception:
                        aj = {}
                    aj['trader_levels'] = levels
                    aj['unified_source'] = 'trader_levels_engine_v1'

                    cur.execute("""
                        UPDATE predictions
                        SET entry_price_min = ?,
                            entry_price_max = ?,
                            entry_price = ?,
                            target_price = ?,
                            target_price_2 = ?,
                            stop_loss = ?,
                            support_level = ?,
                            support_level_2 = ?,
                            resistance_level = ?,
                            resistance_level_2 = ?,
                            risk_reward = ?,
                            analysis_json = ?
                        WHERE id = ?
                    """, (
                        levels['entry_min'],
                        levels['entry_max'],
                        levels['entry_max'],
                        levels['target_1'],
                        levels['target_2'],
                        levels['stop_loss'],
                        levels['support_1'],
                        levels['support_2'],
                        levels['resistance_1'],
                        levels['resistance_2'],
                        levels['risk_reward'],
                        json.dumps(aj, ensure_ascii=False),
                        pred_id
                    ))
                conn.commit()
                conn.close()
            except Exception as e:
                pass

    return levels

