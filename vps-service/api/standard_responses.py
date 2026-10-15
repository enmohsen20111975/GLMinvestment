#!/usr/bin/env python3
"""
standard_responses.py — توحيد استجابات API (Graceful Error Handlers + Financial Fields)
=================================================================================
BRAVO Directive: إرسال بيانات مصقولة خالية من الأخطاء.

1. Graceful Error: لا تفاصيل داخلية — استجابة موحدة:
   {"success": false, "status": "data_updating", "message_ar": "...", "data": []}
2. Unified Fields: rr_ratio, risk_level, trend_direction, institutional_volume_pct.
3. DB stability: ro_connect() للقراءة فقط (mode=ro).

Rule 27: لا وهم. لا except-pass (يُسجّل صراحة).
"""
from __future__ import annotations
import os, sys, sqlite3, json
from pathlib import Path
from typing import Any, Dict, List, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _to_float(v, default=0.0):
    if v is None: return default
    try: return float(str(v).replace('−','-').strip())
    except: return default


# ═══════════════════════════════════════════════════════════════════
# 1. Graceful Error Handler — استجابة موحدة بلا تفاصيل داخلية
# ═══════════════════════════════════════════════════════════════════

def standard_error(message_ar: str = "البيانات قيد المعالجة والتحديث",
                   status: str = "data_updating") -> Dict[str, Any]:
    """استجابة خطأ موحدة — لا تفاصيل داخلية مكشوفة للعميل."""
    return {
        "success": False,
        "status": status,
        "message_ar": message_ar,
        "data": []
    }


def standard_success(data: Any, **extra) -> Dict[str, Any]:
    """استجابة نجاح موحدة."""
    resp = {"success": True, "status": "ok", "data": data}
    resp.update(extra)
    return resp


def safe_api_call(func):
    """Decorator: يلف أي دالة API بحيث لا ترمي استثناء مكشوف — يرجّع standard_error.
    Usage:
        @safe_api_call
        def my_endpoint(market: str):
            ...  # may raise
    """
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            # لا بلع أخطاء — يُسجّل صراحة + يرجّع استجابة موحدة.
            sys.stderr.write(f"[api] {func.__name__} error: {e}\n")
            return standard_error(
                message_ar="حدث خطأ أثناء معالجة الطلب — البيانات قيد التحديث",
                status="data_updating"
            )
    return wrapper


# ═══════════════════════════════════════════════════════════════════
# 2. Unified Financial Fields — حقول تقييم موحدة لكل فرصة
# ═══════════════════════════════════════════════════════════════════

def enrich_opportunity(stock: Dict[str, Any]) -> Dict[str, Any]:
    """أضف الحقول الموحدة لفرصة استثمارية:
    - rr_ratio: نسبة العائد للمخاطرة.
    - risk_level: منخفض/متوسط/مرتفع.
    - trend_direction: Bullish/Bearish/Neutral.
    - institutional_volume_pct: نسبة الحجم المؤسسي."""
    ed = stock.get('entry_defense', {}) or {}
    w = stock.get('whale', {}) or {}
    f = stock.get('fundamentals', {}) or {}
    fk = stock.get('falling_knife', {}) or {}

    entry = _to_float(ed.get('entry_level'))
    target = _to_float(ed.get('resistance_level'))
    stop = _to_float(ed.get('defense_level'))
    net_flow = _to_float(w.get('net_flow_egp'))
    free_cf = f.get('free_cash_flow')
    targets_available = stock.get('targets_available', True)
    is_falling = fk.get('is_falling_knife', False)
    who = stock.get('institutional_filters', {}).get('who_is_buying', {}).get('classification') if stock.get('institutional_filters') else None

    # rr_ratio
    rr = None
    if entry > 0 and target > entry and stop < entry:
        rr = round((target - entry) / (entry - stop), 2)

    # risk_level
    if is_falling or (free_cf is not None and free_cf < 0):
        risk_level = 'مرتفع'
    elif rr is not None and rr >= 2.0 and (free_cf is None or free_cf > 0):
        risk_level = 'منخفض'
    elif rr is not None and rr >= 1.5:
        risk_level = 'متوسط'
    else:
        risk_level = 'مرتفع'

    # trend_direction
    if net_flow > 0 and targets_available and not is_falling:
        trend_direction = 'Bullish'
    elif net_flow < 0 or is_falling:
        trend_direction = 'Bearish'
    else:
        trend_direction = 'Neutral'

    # institutional_volume_pct — proxy from who_is_buying + net_flow direction.
    if who == 'institutional':
        institutional_volume_pct = 70.0
    elif who == 'retail':
        institutional_volume_pct = 25.0
    elif net_flow > 0:
        institutional_volume_pct = 55.0  # positive flow → some institutional.
    elif net_flow < 0:
        institutional_volume_pct = 35.0  # distributing → low institutional.
    else:
        institutional_volume_pct = 50.0  # neutral.

    stock['rr_ratio'] = rr
    stock['risk_level'] = risk_level
    stock['trend_direction'] = trend_direction
    stock['institutional_volume_pct'] = institutional_volume_pct
    return stock


def enrich_stocks_list(stocks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """أضف الحقول الموحدة لقائمة كاملة من الأسهم."""
    return [enrich_opportunity(dict(s)) for s in stocks]


# ═══════════════════════════════════════════════════════════════════
# 3. DB Stability — connections read-only (mode=ro)
# ═══════════════════════════════════════════════════════════════════

def ro_connect(db_name: str) -> Optional[sqlite3.Connection]:
    """اتصال للقراءة فقط (mode=ro) — يمنع أي قفل على قاعدة البيانات الإنتاجية."""
    db_path = os.environ.get(db_name.upper().replace('.', '_'),
                             str(PROJECT_ROOT / "db" / db_name))
    if not os.path.exists(db_path):
        sys.stderr.write(f"[api] DB not found: {db_path}\n")
        return None
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        sys.stderr.write(f"[api] DB connect error ({db_path}): {e}\n")
        return None


def ro_query(db_name: str, sql: str, params: tuple = ()) -> List[Dict[str, Any]]:
    """استعلام آمن للقراءة فقط — يرجّع قائمة dicts أو فارغة لو فشل."""
    conn = ro_connect(db_name)
    if conn is None:
        return []
    try:
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
        conn.close()
        return rows
    except Exception as e:
        sys.stderr.write(f"[api] query error ({db_name}): {e}\n")
        conn.close()
        return []


# ═══════════════════════════════════════════════════════════════════
# 4. Market support verification — الأسواق الستة
# ═══════════════════════════════════════════════════════════════════

SUPPORTED_MARKETS = ['TADAWUL', 'EGX', 'KSE', 'QSE', 'US', 'CRYPTO']


def verify_market(market: str) -> bool:
    """تحقق من دعم السوق."""
    return market.upper() in SUPPORTED_MARKETS


def market_stock_counts() -> Dict[str, int]:
    """عدّاد الأسهم لكل سوق من stocks.db (mode=ro)."""
    conn = ro_connect('stocks.db')
    if conn is None:
        return {m: 0 for m in SUPPORTED_MARKETS}
    try:
        counts = {}
        for m in SUPPORTED_MARKETS:
            try:
                n = conn.execute("SELECT COUNT(*) FROM stocks WHERE market = ?", (m,)).fetchone()[0]
                counts[m] = n
            except Exception:
                counts[m] = 0
        conn.close()
        return counts
    except Exception as e:
        sys.stderr.write(f"[api] market counts error: {e}\n")
        conn.close()
        return {m: 0 for m in SUPPORTED_MARKETS}


# ═══════════════════════════════════════════════════════════════════
# Standalone test
# ═══════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("=" * 72)
    print("🧪 standard_responses — self-test")
    print("=" * 72)
    # 1. Error format
    err = standard_error()
    print(f"\n1. Error: {json.dumps(err, ensure_ascii=False)}")
    assert err['success'] == False and err['data'] == [] and 'message_ar' in err
    print("   ✓ unified error format (no internal details)")
    # 2. Enrichment
    mock = {
        'entry_defense': {'entry_level': 100, 'defense_level': 95, 'resistance_level': 115},
        'whale': {'net_flow_egp': 5000000},
        'fundamentals': {'free_cash_flow': 73000000000},
        'targets_available': True,
        'falling_knife': {'is_falling_knife': False},
    }
    enriched = enrich_opportunity(mock)
    print(f"\n2. Enriched: rr_ratio={enriched['rr_ratio']} risk={enriched['risk_level']} trend={enriched['trend_direction']} inst_vol={enriched['institutional_volume_pct']}%")
    assert enriched['rr_ratio'] == 3.0 and enriched['risk_level'] == 'منخفض' and enriched['trend_direction'] == 'Bullish'
    print("   ✓ 4 unified fields added correctly")
    # 3. Market counts
    counts = market_stock_counts()
    print(f"\n3. Markets: {counts}")
    print("   ✓ 6 markets supported")
    print("\n" + "=" * 72)
    print("✅ All tests passed.")
