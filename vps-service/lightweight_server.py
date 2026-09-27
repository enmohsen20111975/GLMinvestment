#!/usr/bin/env python3
"""
Lightweight Market Pulse Server
================================
خادم خفيف لنبض السوق - يعمل بذاكرة قليلة جداً
يقدم فقط: /api/market-pulse و /api/live-monitor
"""

import os
import sys
import json
import sqlite3
from collections import OrderedDict
from datetime import datetime
from typing import Dict, Any
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS

try:
    import pytz
    CAIRO_TZ = pytz.timezone('Africa/Cairo')
except ImportError:
    CAIRO_TZ = None

app = Flask(__name__)
CORS(app)

# Register essential Flask Blueprints
BLUEPRINTS = [
    ('api.chart_routes', 'chart_bp'),
    ('api.stock_analysis_routes', 'stock_analysis_bp'),
    ('api.public_routes', 'public_bp'),
    ('api.stored_analysis_routes', 'stored_analysis_bp'),
    # Phase P5: Sector tracking — تتبع حركة القطاعات (heatmap + rotation + stocks per sector)
    # الـ logic كله في Python (engine/flow_system.py) — Node مجرد proxy.
    ('api.sector_tracking_routes', 'sector_tracking_bp'),
    # Phase P6: Advanced screener — شاشة فلترة موحدة (TradingView-style)
    ('api.advanced_screener_routes', 'advanced_screener_bp'),
    # Phase P6: Top performers — أعلى/أدنى الأسهم في فترات متعددة (للتعلم الذاتي)
    # الـ logic كله في Python (يقرأ data_engine.db.egksco_price_history) — Node مجرد proxy.
    ('api.top_performers_routes', 'top_performers_bp'),
    # P17 Morning Bell: /api/market/morning-bell (top 3 EGX opportunities)
    ('api.stored_analysis_routes', 'market_bp'),
    ('api.v2_routes', 'v2_bp'),
    ('api.unified_v2_routes', 'unified_v2_bp'),
    ('api.confluence_routes', 'confluence_bp'),
    ('api.screener_routes', 'screener_bp'),
    ('api.ai_predictions_routes', 'ai_pred_bp'),
    ('api.prediction_tracking_routes', 'prediction_tracking_bp'),
    ('api.prediction_tracking_routes', 'tracking_bp'),
    ('api.maestro_routes', 'maestro_bp'),
    ('api.sniper_routes', 'sniper_bp'),
    ('api.reports_routes', 'reports_bp'),
    ('api.risk_routes', 'risk_bp'),
    ('api.notebook_routes', 'notebook_bp'),
    ('api.learning_routes', 'learning_bp'),
    # P1.7 (REFACTORING_REPORT §12): تسجيل unified_learning_bp لتفعيل
    # /api/unified-learning/* endpoints (25 routes، كلها كانت 404 لأن الـ blueprint
    # مش مُسجّل). الـ frontend بيستخدمها في src/lib/use-python-api.ts (12+ calls).
    # متغير `learning_bp` في unified_learning_routes.py مطابق لـ learning_routes.py
    # لكن ده مش collision — كل module بـ يستورد blueprint مختلف (url_prefix مختلف).
    ('api.unified_learning_routes', 'learning_bp'),
    # P1.6 (REFACTORING_REPORT §12): تسجيل optimizer_params_bp لتفعيل
    # /api/prediction-optimizer/* endpoints (4 routes، كلها كانت 404 لأن الـ blueprint
    # مش مُسجّل). الـ admin frontend بيستخدمها في OptimizerParamsPanel.tsx
    # (4 calls: /params GET/POST, /params/reset POST, /backtest POST).
    # `prediction_optimizer.py` (the analyzer) منفصل عن الـ route — الـ route بـ
    # يستورده بس عند الحاجة (lazy import)، فأي تعديل للـ analyzer مش هيتأثر بالـ route.
    ('api.optimizer_params_routes', 'optimizer_params_bp'),
    ('api.news_routes', 'news_bp'),
    ('api.telegram_routes', 'telegram_bp'),
    # P4-BACKEND-INFLATION: register portfolio_bp BEFORE misc_bp so its
    # /api/portfolio/bag-holder-rescue (purchase_price/shares, accepts
    # legacy buy_price/quantity too) takes priority over the older
    # misc_bp route. FastAPI's portfolio_router is mounted separately in
    # main.py and is matched first by Starlette, so overlap on /state,
    # /equity/curve, /holdings, etc. is safe — FastAPI wins those.
    ('api.portfolio_routes', 'portfolio_bp'),
    ('api.misc_routes', 'misc_bp'),
    ('api.admin_routes', 'admin_bp'),
    ('api.analytics', 'analytics_bp'),
    ('api.professional_analysis_routes', 'prof_analysis_bp'),
    ('api.stocks', 'stocks_bp'),
    ('api.regime_routes', 'regime_bp'),
    ('api.scanner_routes', 'scanner_bp'),
    ('api.persona_routes', 'persona_bp'),
    # PHASE-A4 (أغسطس 2026): تسجيل ai_bp لتفعيل /api/ai/* endpoints
    # (كانت كلها 404 لأن الـ blueprint مش مسجّل). يشمل /api/ai/premium/predictions
    # اللي بيحسب confluence_score = maestro×0.6 + ai×0.4 — أول مكان AI يؤثر فعلياً.
    ('api.ai_routes', 'ai_bp'),
    # P0-FIX (2026-09-27): v4_bp REMOVED — expert_memory_v4_routes.py was never created.
    # The registration pointed to a non-existent module, causing a warning on every boot.
    # The frontend already has a SQLite fallback at src/app/api/v4/stats/route.ts that
    # computes the same stats from the predictions table (no Python needed).
    # The expert_memory_v4.py analyzer (37KB) is still in vps-service/analyzers/ but
    # is orphaned — its logic was superseded by the V40.2 predictions pipeline.
    # If the v4 endpoints are needed in the future, create the route file OR rely on the
    # existing SQLite fallback (which is what's happening now in production).
    # ('api.expert_memory_v4_routes', 'v4_bp'),  # REMOVED — see P0 #5 fix
    # DYNAMIC-ADMIN-UI: Engine Settings (إعدادات المحرك الديناميكي) — admin tab
    # that lets the admin control all engine thresholds without touching code.
    ('api.admin_engine_settings_routes', 'admin_engine_settings_bp'),
    # HIST-PRED-V2: Heavy-development historical predictions generator — per-stock,
    # per-persona, SSE live progress. Used by /admin/honest-predictions page.
    ('api.historical_predictions_v2_routes', 'historical_preds_v2_bp'),
    # PICKS-MGMT v3.4.43: Daily Picks (Top 5) + Position Management (HOLD/TRAIL/EXIT)
    # فن إدارة التوصيات — أعلى 5 توصيات/يوم + إدارة المراكز المفتوحة
    ('api.picks_management_routes', 'picks_mgmt_bp'),
    # V38-INSTITUTIONAL: V38 Institutional Decision Engine Backtest
    # محرك القرار المؤسسي V38 — محاكاة + نتائج + إثباتات
    ('api.v38_backtest_routes', 'v38_backtest_bp'),
]

for mod_name, bp_name in BLUEPRINTS:
    try:
        mod = __import__(mod_name, fromlist=[bp_name])
        bp = getattr(mod, bp_name)
        app.register_blueprint(bp)
        print(f"✅ Registered {bp_name} from {mod_name}")
    except Exception as _e:
        print(f"⚠️ {bp_name} registration note: {_e}")

# Database path
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE_PATH = str(_PROJECT_ROOT / 'db' / 'stocks.db')

# Cache (10 seconds). Uses OrderedDict so we can evict the oldest entries
# in O(1) once the cache approaches _MAX_CACHE_SIZE. Without eviction the
# dict grew by one key per minute (market_pulse_HHMM) forever.
_cache: "OrderedDict[str, Dict]" = OrderedDict()
_CACHE_TTL = 10
_MAX_CACHE_SIZE = 1000  # hard cap; ~16h of minute-level keys is more than enough


def _cache_set(key: str, value: Dict) -> None:
    """Insert into the cache, evicting oldest entries if over the cap."""
    # Evict from the front (oldest first) until we are below the cap.
    # popitem(last=False) is O(1) on OrderedDict.
    while len(_cache) >= _MAX_CACHE_SIZE:
        try:
            _cache.popitem(last=False)
        except KeyError:
            break
    _cache[key] = value
    # Move the freshly-inserted key to the end so it is treated as newest.
    _cache.move_to_end(key)


def _cairo_now():
    if CAIRO_TZ:
        return datetime.now(CAIRO_TZ)
    return datetime.now()


def _safe_float(val):
    if val is None:
        return None
    try:
        return float(str(val).replace('−', '-').replace('،', '').strip())
    except (ValueError, TypeError):
        return None


@app.route('/api/market-pulse', methods=['GET'])
def market_pulse():
    """نبض السوق اللحظي"""
    now = datetime.now()
    cache_key = f"market_pulse_{now.strftime('%H%M')}"  # minute-level cache
    if cache_key in _cache:
        cached = _cache[cache_key]
        if (now - cached['time']).total_seconds() < _CACHE_TTL:
            return jsonify(cached['data'])

    # P19-HOTFIX: try/except محكم عشان لو أي query فشل → نرجّع status سليم
    # بدل ما الـ endpoint يقع خالص ويرجع 500.
    try:
        return _market_pulse_impl(now, cache_key)
    except Exception as e:
        import traceback as _tb
        print(f"[market_pulse] ERROR: {e}")
        _tb.print_exc()
        # رجّع response سليم بدل 500 — الـ frontend يقدر يتعامل معاه
        return jsonify({
            "success": False,
            "error": "market_pulse temporarily unavailable",
            "data": {
                "cairo_time": _cairo_now().strftime('%Y-%m-%d %H:%M:%S'),
                "is_trading_hours": False,
                "market_status": "UNKNOWN",
                "sectors": [],
                "gainers": [],
                "losers": [],
                "most_active": [],
                "signals": [],
                "breadth": {"gainers": 0, "losers": 0, "unchanged": 0, "adv_dec_ratio": 0, "total_turnover": 0, "total_turnover_bn": 0},
                "pulse": {"score": 0, "label": "محايد", "label_en": "NEUTRAL", "color": "amber"},
                "divergence": {"value": 0, "regime": "UNKNOWN", "regime_ar": "غير معروف", "action": "HOLD", "action_ar": "انتظر"},
            }
        })


def _market_pulse_impl(now, cache_key):
    """P19-HOTFIX: implementation مفصولة للـ safe error handling."""
    cairo_now = _cairo_now()
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # P19-HOTFIX: schema-aware column detection — stocks.db ممكن يكون بالـ schema
    # القديم (name_ar, rsi) أو الجديد (migrator — بدون name_ar/rsi). بنفحص
    # الأعمدة الفعلية قبل الـ SELECT عشان نتجنب 'no such column: name_ar' errors
    # اللي بتسبب 500 في /api/market-pulse.
    try:
        stocks_cols = {r[1] for r in cur.execute("PRAGMA table_info(stocks)").fetchall()}
    except sqlite3.OperationalError:
        stocks_cols = set()
    _has_name_ar = 'name_ar' in stocks_cols
    _has_rsi = 'rsi' in stocks_cols
    # بناء الـ SELECT clauses بأمان — NULL لو العمود مش موجود
    _name_ar_expr = 'name_ar' if _has_name_ar else 'NULL'
    _rsi_expr = 'rsi' if _has_rsi else 'NULL'

    # EGX30 vs EGX70
    egx30_row = cur.execute("SELECT symbol, current_value, previous_close, change_percent FROM market_indices WHERE symbol = 'EGX30'").fetchone()
    egx70_row = cur.execute("SELECT symbol, current_value, previous_close, change_percent FROM market_indices WHERE symbol = 'EGX70'").fetchone()

    egx30_change = egx30_row['change_percent'] if egx30_row else 0
    egx70_change = egx70_row['change_percent'] if egx70_row else 0

    # Divergence
    divergence = egx30_change - egx70_change
    if egx30_change > 0 and egx70_change > 0:
        regime, regime_ar, action, action_ar = "HEALTHY_BULL", "صعود صحي - الكل يربح", "BUY", "اشترِ"
    elif egx30_change > 0 and egx70_change < 0:
        regime, regime_ar, action, action_ar = "DISTRIBUTION", "توزيع - كبار يسحبون من صغار", "CAUTION", "حذر"
    elif egx30_change < 0 and egx70_change > 0:
        regime, regime_ar, action, action_ar = "SPECULATION", "مضاربة - سيولة للصغار", "DANGER", "خطر"
    else:
        regime, regime_ar, action, action_ar = "BEAR", "هبوط - السوق كله ينزل", "EXIT", "اقفل"

    # Sector rotation - use CAST for bulletproof numeric handling
    sector_rows = cur.execute("""
        SELECT COALESCE(sector, 'غير محدد') as sector, COUNT(*) as stock_count,
               AVG(CAST(change_percent AS REAL)) as avg_change,
               SUM(CAST(volume AS REAL) * CAST(current_price AS REAL)) as turnover,
               SUM(CASE WHEN CAST(change_percent AS REAL) > 0 THEN 1 ELSE 0 END) as gainers,
               SUM(CASE WHEN CAST(change_percent AS REAL) < 0 THEN 1 ELSE 0 END) as losers
        FROM stocks WHERE current_price > 0 AND is_active = 1
        GROUP BY sector ORDER BY turnover DESC LIMIT 10
    """).fetchall()

    def _sf(v, d=0.0):
        if v is None: return d
        try: return float(str(v).replace('−','-').replace('،','').strip())
        except: return d

    total_turnover = sum(_sf(r['turnover']) for r in sector_rows)
    sectors = []
    for r in sector_rows:
        turnover = _sf(r['turnover'])
        avg_chg = _sf(r['avg_change'])
        sectors.append({
            'sector': r['sector'],
            'stock_count': int(_sf(r['stock_count'], 0)),
            'avg_change': round(avg_chg, 2),
            'turnover': round(turnover, 0),
            'turnover_pct': round((turnover / total_turnover * 100) if total_turnover > 0 else 0, 1),
            'gainers': int(_sf(r['gainers'], 0)),
            'losers': int(_sf(r['losers'], 0)),
            'status': 'HOT' if avg_chg > 1 else ('COLD' if avg_chg < -1 else 'NEUTRAL'),
        })

    # Market breadth
    gainers_count = cur.execute("SELECT COUNT(*) FROM stocks WHERE CAST(change_percent AS REAL) > 0 AND current_price > 0 AND is_active = 1").fetchone()[0]
    losers_count = cur.execute("SELECT COUNT(*) FROM stocks WHERE CAST(change_percent AS REAL) < 0 AND current_price > 0 AND is_active = 1").fetchone()[0]
    adv_dec_ratio = (gainers_count / losers_count) if losers_count > 0 else (gainers_count if gainers_count > 0 else 1)

    # Pulse score
    egx30_ch = _sf(egx30_change)
    egx70_ch = _sf(egx70_change)
    pulse_score = (egx30_ch * 0.30) + (egx70_ch * 0.20) + (min(adv_dec_ratio, 3) * 0.5 - 1) + (min(total_turnover / 1e9, 2) * 0.5)
    pulse_score = max(-5, min(5, pulse_score))

    if pulse_score >= 2:
        pulse_label, pulse_label_en, pulse_color = "قوي صاعد", "STRONG_BULL", "emerald"
    elif pulse_score >= 0.5:
        pulse_label, pulse_label_en, pulse_color = "صاعد", "BULL", "green"
    elif pulse_score >= -0.5:
        pulse_label, pulse_label_en, pulse_color = "محايد", "NEUTRAL", "amber"
    elif pulse_score >= -2:
        pulse_label, pulse_label_en, pulse_color = "هابط", "BEAR", "orange"
    else:
        pulse_label, pulse_label_en, pulse_color = "قوي هابط", "STRONG_BEAR", "rose"

    # Gainers/losers — P19-HOTFIX: schema-aware (name_ar/rsi might not exist)
    gainers = cur.execute(f"""
        SELECT ticker, name, {_name_ar_expr} as name_ar, current_price, change_percent, volume, sector, {_rsi_expr} as rsi, pe_ratio, market_cap
        FROM stocks WHERE change_percent IS NOT NULL AND current_price > 0 AND is_active = 1
        ORDER BY change_percent DESC LIMIT 10
    """).fetchall()

    losers = cur.execute(f"""
        SELECT ticker, name, {_name_ar_expr} as name_ar, current_price, change_percent, volume, sector, {_rsi_expr} as rsi, pe_ratio, market_cap
        FROM stocks WHERE change_percent IS NOT NULL AND current_price > 0 AND is_active = 1
        ORDER BY change_percent ASC LIMIT 10
    """).fetchall()

    most_active = cur.execute(f"""
        SELECT ticker, name, {_name_ar_expr} as name_ar, current_price, change_percent, volume, (volume * current_price) as turnover, sector
        FROM stocks WHERE volume > 0 AND current_price > 0 AND is_active = 1
        ORDER BY turnover DESC LIMIT 10
    """).fetchall()

    # Signals — P19-HOTFIX: تخطّي RSI queries بالكامل لو الـ column مش موجود
    signals = []
    if _has_rsi:
        for s in cur.execute("SELECT ticker, name_ar, current_price, change_percent, rsi FROM stocks WHERE CAST(rsi AS REAL) > 70 AND current_price > 0 AND is_active = 1 ORDER BY CAST(rsi AS REAL) DESC LIMIT 5").fetchall():
            rsi_val = _safe_float(s['rsi'])
            signals.append({'ticker': s['ticker'], 'name': s['name_ar'], 'price': s['current_price'], 'change': s['change_percent'], 'rsi': round(rsi_val, 1) if rsi_val else None, 'signal': 'OVERBOUGHT', 'signal_ar': 'تشبع شرائي', 'action': 'SELL', 'action_ar': 'بيع'})
        for s in cur.execute("SELECT ticker, name_ar, current_price, change_percent, rsi FROM stocks WHERE CAST(rsi AS REAL) < 30 AND CAST(rsi AS REAL) > 0 AND current_price > 0 AND is_active = 1 ORDER BY CAST(rsi AS REAL) ASC LIMIT 5").fetchall():
            rsi_val = _safe_float(s['rsi'])
            signals.append({'ticker': s['ticker'], 'name': s['name_ar'], 'price': s['current_price'], 'change': s['change_percent'], 'rsi': round(rsi_val, 1) if rsi_val else None, 'signal': 'OVERSOLD', 'signal_ar': 'تشبع بيعي', 'action': 'BUY', 'action_ar': 'شراء'})

    # P19-HOTFIX: latest_update — schema-aware (updated_at might not exist)
    if 'updated_at' in stocks_cols:
        latest_update = cur.execute("SELECT MAX(updated_at) as latest FROM stocks WHERE updated_at IS NOT NULL").fetchone()['latest']
    elif 'last_updated' in stocks_cols:
        latest_update = cur.execute("SELECT MAX(last_updated) as latest FROM stocks WHERE last_updated IS NOT NULL").fetchone()['latest']
    elif 'last_update' in stocks_cols:
        latest_update = cur.execute("SELECT MAX(last_update) as latest FROM stocks WHERE last_update IS NOT NULL").fetchone()['latest']
    else:
        latest_update = None
    conn.close()

    weekday = cairo_now.weekday()
    is_trading_day = weekday in (6, 0, 1, 2, 3)
    current_min = cairo_now.hour * 60 + cairo_now.minute
    is_trading_hours = is_trading_day and (600 <= current_min <= 870)

    data = {
        "success": True,
        "data": {
            "cairo_time": cairo_now.strftime('%Y-%m-%d %H:%M:%S'),
            "weekday": cairo_now.strftime('%A'),
            "is_trading_hours": is_trading_hours,
            "market_status": "OPEN" if is_trading_hours else "CLOSED",
            "latest_update": latest_update,
            "egx30": {"value": egx30_row['current_value'] if egx30_row else None, "change_percent": round(egx30_change, 2) if egx30_change else 0, "previous_close": egx30_row['previous_close'] if egx30_row else None},
            "egx70": {"value": egx70_row['current_value'] if egx70_row else None, "change_percent": round(egx70_change, 2) if egx70_change else 0, "previous_close": egx70_row['previous_close'] if egx70_row else None},
            "divergence": {"value": round(divergence, 2), "regime": regime, "regime_ar": regime_ar, "action": action, "action_ar": action_ar},
            "pulse": {"score": round(pulse_score, 2), "label": pulse_label, "label_en": pulse_label_en, "color": pulse_color},
            "sectors": sectors,
            "top_sector": sectors[0] if sectors else None,
            "gainers": [dict(g) for g in gainers],
            "losers": [dict(l) for l in losers],
            "most_active": [dict(m) for m in most_active],
            "signals": signals,
            "breadth": {"gainers": gainers_count, "losers": losers_count, "unchanged": 0, "adv_dec_ratio": round(adv_dec_ratio, 2), "total_turnover": round(total_turnover, 0), "total_turnover_bn": round(total_turnover / 1e9, 2)},
        }
    }

    _cache_set(cache_key, {'time': now, 'data': data})
    return jsonify(data)


@app.route('/api/live-monitor', methods=['GET'])
def live_monitor():
    """لوحة المراقبة الحية - نسخة خفيفة"""
    cairo_now = _cairo_now()
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    weekday = cairo_now.weekday()
    is_trading_day = weekday in (6, 0, 1, 2, 3)
    current_min = cairo_now.hour * 60 + cairo_now.minute
    is_trading_hours = is_trading_day and (600 <= current_min <= 870)

    stocks_updated = cur.execute("SELECT COUNT(*) FROM stocks WHERE updated_at >= datetime('now','-10 minutes')").fetchone()[0]
    total_stocks = cur.execute("SELECT COUNT(*) FROM stocks WHERE current_price > 0").fetchone()[0]
    latest_update = cur.execute("SELECT MAX(updated_at) as latest FROM stocks").fetchone()['latest']

    # Portfolio
    user_id = request.args.get('user_id', '').strip()
    if user_id:
        portfolio_rows = cur.execute("""
            SELECT pa.id, pa.type, pa.name, pa.stock_ticker, pa.quantity, pa.avg_buy_price, pa.total_invested, pa.current_value,
                   s.current_price as live_price, s.change_percent
            FROM portfolio_assets pa
            LEFT JOIN stocks s ON s.ticker = pa.stock_ticker OR s.ticker = UPPER(pa.stock_ticker)
            WHERE pa.user_id = ?
            ORDER BY pa.type
        """, (user_id,)).fetchall()
    else:
        portfolio_rows = cur.execute("""
            SELECT pa.id, pa.type, pa.name, pa.stock_ticker, pa.quantity, pa.avg_buy_price, pa.total_invested, pa.current_value,
                   s.current_price as live_price, s.change_percent
            FROM portfolio_assets pa
            LEFT JOIN stocks s ON s.ticker = pa.stock_ticker OR s.ticker = UPPER(pa.stock_ticker)
            ORDER BY pa.type
        """).fetchall()

    items = []
    total_invested = 0.0
    total_current = 0.0
    for r in portfolio_rows:
        item = dict(r)
        if item['type'] == 'stock' and item['live_price'] and item['quantity']:
            live_val = item['live_price'] * item['quantity']
            item['current_value'] = round(live_val, 2)
            item['gain_loss'] = round(live_val - (item['total_invested'] or 0), 2)
            inv = item['total_invested'] or 0
            item['gain_loss_pct'] = round((item['gain_loss'] / inv * 100) if inv > 0 else 0, 2)
            total_invested += inv
            total_current += live_val
        else:
            inv = item['total_invested'] or 0
            cur_v = item['current_value'] or 0
            if cur_v == 0 and inv > 0:
                cur_v = inv
                item['current_value'] = round(cur_v, 2)
            item['gain_loss'] = round(cur_v - inv, 2)
            item['gain_loss_pct'] = round(((cur_v - inv) / inv * 100) if inv > 0 else 0, 2)
            total_invested += inv
            total_current += cur_v
        items.append(item)

    conn.close()

    return jsonify({
        "success": True,
        "data": {
            "cairo_time": cairo_now.strftime('%Y-%m-%d %H:%M:%S'),
            "weekday_name": cairo_now.strftime('%A'),
            "is_trading_day": is_trading_day,
            "is_trading_hours": is_trading_hours,
            "market_status": "OPEN" if is_trading_hours else "CLOSED",
            "stocks": {"total": total_stocks, "updated_last_10min": stocks_updated, "latest_update": latest_update},
            "portfolio": {
                "items": items,
                "total_invested": round(total_invested, 2),
                "total_current_value": round(total_current, 2),
                "total_gain_loss": round(total_current - total_invested, 2),
                "total_gain_loss_pct": round(((total_current - total_invested) / total_invested * 100) if total_invested > 0 else 0, 2),
                "items_count": len(items),
            },
            "data_sources": {
                "intraday_primary": "TradingView",
                "intraday_note": "TradingView provides live intraday prices + technical indicators (RSI, SMA50) during the session",
                "stock_universe": "EGKSCO",
                "stock_universe_note": "EGKSCO provides the complete EGX stock list + recommendation PDFs (every 15 min)",
                "end_of_day": "EGXPilot",
                "end_of_day_note": "EGXPilot is used ONLY for end-of-day data, NOT for intraday updates",
            },
        }
    })


@app.route('/', methods=['GET'])
def root():
    return jsonify({"name": "Market Pulse Server (Lightweight)", "port": 8010, "endpoints": ["/api/market-pulse", "/api/live-monitor", "/api/flow/*"]})


# ============================================================================
# FLOW SYSTEM API — نظام التدفقات
# ============================================================================

@app.route('/api/flow/summary', methods=['GET'])
def flow_summary():
    """ملخص نظام التدفقات للسوق كله"""
    try:
        import sys as _fs
        _fs.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from engine.flow_system import FlowSystemEngine
        engine = FlowSystemEngine()
        result = engine.get_flow_summary()
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/flow/top', methods=['GET'])
def flow_top():
    """أعلى الأسهم في Flow Score"""
    try:
        import sys as _fs2
        _fs2.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from engine.flow_system import FlowSystemEngine
        limit = request.args.get('limit', 20, type=int)
        engine = FlowSystemEngine()
        result = engine.get_top_flow_stocks(limit)
        return jsonify({"success": True, "data": result, "count": len(result)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/flow/<ticker>', methods=['GET'])
def flow_score_ticker(ticker):
    """Flow Score لسهم واحد"""
    try:
        import sys as _fs3
        _fs3.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from engine.flow_system import FlowSystemEngine
        engine = FlowSystemEngine()
        result = engine.calculate_flow_score(ticker.upper())
        if result:
            return jsonify({"success": True, "data": result.to_dict()})
        return jsonify({"success": False, "error": "Stock not found"}), 404
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/flow/heatmap', methods=['GET'])
def flow_heatmap():
    """خريطة حرارية للقطاعات"""
    try:
        import sys as _fs4
        _fs4.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from engine.flow_system import FlowSystemEngine
        engine = FlowSystemEngine()
        result = engine.get_sector_heatmap()
        return jsonify({"success": True, "data": result, "count": len(result)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# EXPLOSIVE SCANNER API — ماسح القنابل (20%+ opportunities)
# ============================================================================

@app.route('/api/explosive/scan', methods=['GET'])
def explosive_scan():
    """فحص السوق للقنابل - الأسهم التي قد تعطي 20%+"""
    try:
        import sys as _ex_sys
        _ex_sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from engine.explosive_scanner import ExplosiveScanner
        limit = request.args.get('limit', 30, type=int)
        scanner = ExplosiveScanner()
        result = scanner.scan_market(limit)
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/explosive/top', methods=['GET'])
def explosive_top():
    """أعلى القنابل (10 أسهم)"""
    try:
        import sys as _ex_sys2
        _ex_sys2.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from engine.explosive_scanner import ExplosiveScanner
        limit = request.args.get('limit', 10, type=int)
        scanner = ExplosiveScanner()
        result = scanner.get_top_explosive(limit)
        return jsonify({"success": True, "data": result, "count": len(result)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/explosive/<ticker>', methods=['GET'])
def explosive_score_ticker(ticker):
    """Explosive Score لسهم واحد"""
    try:
        import sys as _ex_sys3
        _ex_sys3.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from engine.explosive_scanner import ExplosiveScanner
        scanner = ExplosiveScanner()
        result = scanner.calculate_explosive_score(ticker.upper())
        if result:
            return jsonify({"success": True, "data": result.to_dict()})
        return jsonify({"success": False, "error": "Stock not found"}), 404
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# P0-v13: /api/explosive/hunt — صيّاد الفرص الانفجارية (الاستباقي)
# ============================================================================
# NEW endpoint (additive — لا يؤثر على /api/explosive/top اللي بـ يستخدمه الموقع).
# بـ يشغّل explosive_opportunity_hunter.py وبـ يـ return الـ JSON الكامل:
#   - summary (scanned, total_explosive_candidates, coverage per persona)
#   - top_candidates (ticker, explosive_score, maestro_score, persona_predictions, reasons)
#
# الـ Flutter app بـ يستخدم ده بدل /api/explosive/top (اللي بـ يـ return format قديم).
# كده الموقع ما بـ يتأثرش والـ Flutter بـ يـ get الـ data اللي محتاجها.
# ============================================================================
@app.route('/api/explosive/hunt', methods=['GET'])
def explosive_hunt():
    """صيّاد الفرص الانفجارية — مسح استباقي للأسهم على وشك الطيران."""
    try:
        import sys as _hunt_sys
        _scripts_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scripts')
        if _scripts_dir not in _hunt_sys.path:
            _hunt_sys.path.insert(0, _scripts_dir)
        from explosive_opportunity_hunter import scan_market
        top_n = request.args.get('top', 20, type=int)
        market = request.args.get('market', 'EGX', type=str)
        result = scan_market(top_n=min(top_n, 100))
        return jsonify({
            "success": True,
            "summary": result.get('summary', {}),
            "top_candidates": result.get('top_candidates', []),
        })
    except Exception as e:
        import traceback
        return jsonify({
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()[-500:]
        }), 500


# ============================================================================
# P0-v16: /api/exit/notifications — تنبيهات الخروج الديناميكي
# ============================================================================
# المالك طلب: "لازم يكون فية تنبية ماتعش كمل هايطلع ونحط مستهدف أعلى ولو نزل
# بس التحلي بيقول ان لسة فية فرصة كدة لازم نكمل دة يدى مصداقية ويثبت ان الربح مضمون"
# الـ endpoint ده بـ يـ return كل تنبيهات الـ dynamic exit (HOLD_EXTEND / HOLD_RECOVER /
# BREAKEVEN_LOCK / EXIT_*) عشان الـ frontend (website + Flutter) يـ displayها للمستخدم.
@app.route('/api/exit/notifications', methods=['GET'])
def exit_notifications():
    """تنبيهات الخروج الديناميكي — "كمل / ثبّت / الوقف اتنقل / خروج".

    Query params:
        limit: عدد النتائج (default 50, max 500)
        ticker: فلتر بسهم معين (optional)
        notification_type: فلتر بنوع التنبيه (optional: HOLD_EXTEND, HOLD_RECOVER, BREAKEVEN_LOCK, EXIT_*)
    """
    try:
        limit = request.args.get('limit', 50, type=int)
        limit = max(1, min(500, limit))
        ticker_filter = request.args.get('ticker', '', type=str).strip().upper()
        type_filter = request.args.get('notification_type', '', type=str).strip().upper()

        _pred_db = os.path.join(_PROJECT_ROOT, 'db', 'predictions.db')
        import sqlite3 as _s3
        _conn = _s3.connect(_pred_db, timeout=30.0)
        _conn.row_factory = _s3.Row
        _cur = _conn.cursor()

        # Check if exit_notifications table exists
        _cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='exit_notifications'")
        if not _cur.fetchone():
            _conn.close()
            return jsonify({
                "success": True,
                "notifications": [],
                "summary": {},
                "message": "exit_notifications table not yet created (run daily_closer to generate)"
            })

        # Build query with optional filters
        _query = """
            SELECT en.id, en.prediction_id, en.ticker, en.notification_type, en.message,
                   en.current_price, en.gain_pct, en.momentum_5d, en.momentum_20d,
                   en.sma20, en.rsi, en.old_target, en.new_target, en.day_number,
                   en.created_at, p.signal, p.persona, p.entry_price
            FROM exit_notifications en
            LEFT JOIN predictions p ON p.id = en.prediction_id
            WHERE 1=1
        """
        _params = []
        if ticker_filter:
            _query += " AND en.ticker = ?"
            _params.append(ticker_filter)
        if type_filter:
            _query += " AND en.notification_type = ?"
            _params.append(type_filter)
        _query += " ORDER BY en.created_at DESC LIMIT ?"
        _params.append(limit)

        _cur.execute(_query, _params)
        _rows = _cur.fetchall()
        _notifications = [dict(r) for r in _rows]

        # Summary counts by type
        _cur.execute("""
            SELECT notification_type, COUNT(*) as cnt
            FROM exit_notifications
            GROUP BY notification_type
            ORDER BY cnt DESC
        """)
        _summary = {r['notification_type']: r['cnt'] for r in _cur.fetchall()}
        _summary['total'] = sum(_summary.values())

        _conn.close()

        return jsonify({
            "success": True,
            "notifications": _notifications,
            "summary": _summary,
            "count": len(_notifications),
        })
    except Exception as e:
        import traceback
        return jsonify({
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()[-500:]
        }), 500


# ============================================================================
# QUANT-OVERDRIVE-028: The 100ms Sniper Scan — مسح السوق اللحظي
# ============================================================================
# بدل ما الآلة تنتظر تحليل كل سهم لوحده، المسح ده بيمسح الـ 270 سهم في
# أجزاء من الثانية ويطلع الأسهم اللي فيها زخم انفجاري (volume >= 3x average)
# وكسر مقاومة. أول ما سهم يطلع حركة، الآلة بتطلعه قبل الجروبات تكتب عنه.
#
# المنطق:
#   1. اقرأ كل الأسهم النشطة من stocks.db (current_price, volume, avg_volume)
#   2. احسب volume_ratio = volume / avg_volume (لو avg_volume = 0 → skip)
#   3. فلتر: volume_ratio >= 2.0 (مضاعفين المتوسط = زخم)
#   4. احسب التغير اليومي (change_percent) — السهم الصاعد اللي فيه حجم = فرصة
#   5. احسب turnover = volume * current_price — فلتر الدماء (>= 3M EGP)
#   6. رتّب حسب volume_ratio (الأعلى زخماً الأول)
#   7. ارجع top N (default 15)
@app.route('/api/live/sniper-scan', methods=['GET'])
def live_sniper_scan():
    """🎯 المسح اللحظي للقناص — الأسهم اللي فيها زخم انفجاري قبل الجروبات.

    Query params:
        limit: عدد النتائج (default 15, max 50)
        min_vol_ratio: أدنى نسبة حجم (default 2.0)
        min_turnover: أدنى دوران بالجنيه (default 3,000,000 = فلتر الدماء)
    """
    try:
        limit = request.args.get('limit', 15, type=int)
        limit = max(1, min(50, limit))
        min_vol_ratio = request.args.get('min_vol_ratio', 2.0, type=float)
        min_turnover = request.args.get('min_turnover', 3_000_000.0, type=float)

        # Helper: يحوّل نص الحجم ("2.28 M", "559.83 K", "1.2 B") لرقم
        # جدول stocks بيخزن الحجم كـ string مع Unicode narrow no-break space (\u202f).
        def _parse_vol(val):
            if val is None:
                return 0.0
            if isinstance(val, (int, float)):
                return float(val)
            s = str(val).strip().replace('\u202f', ' ').replace('\xa0', ' ')
            # لو رقم نقي
            try:
                return float(s)
            except ValueError:
                pass
            s = s.upper()
            mult = 1.0
            if s.endswith(' B') or s.endswith('B'):
                mult = 1_000_000_000.0
                s = s.replace(' B', '').replace('B', '').strip()
            elif s.endswith(' M') or s.endswith('M'):
                mult = 1_000_000.0
                s = s.replace(' M', '').replace('M', '').strip()
            elif s.endswith(' K') or s.endswith('K'):
                mult = 1_000.0
                s = s.replace(' K', '').replace('K', '').strip()
            try:
                return float(s) * mult
            except ValueError:
                return 0.0

        conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # اقرأ كل الأسهم النشطة اللي ليها سعر وحجم
        rows = cur.execute("""
            SELECT ticker, name, name_ar, market, sector,
                   current_price, previous_close, change_percent,
                   volume, avg_volume, open_price, high_price, low_price,
                   resistance, support, rsi, signal, trend
            FROM stocks
            WHERE is_active = 1
              AND current_price IS NOT NULL AND current_price > 0
              AND volume IS NOT NULL AND volume != ''
              AND avg_volume IS NOT NULL AND avg_volume > 0
        """).fetchall()
        conn.close()

        candidates = []
        for r in rows:
            # avg_volume مخزن كـ float (في الملايين أحياناً) — نحوله للأصل
            avg_vol_raw = r['avg_volume']
            avg_vol = float(avg_vol_raw or 0)
            # لو الـ avg_volume صغير جداً (< 1000) فهو غالباً بالملايين
            # (مثلاً 174.12 = 174 مليون سهم). نوحّده لـ shares فعلية.
            if 0 < avg_vol < 1000:
                avg_vol = avg_vol * 1_000_000.0
            if avg_vol <= 0:
                continue

            today_vol = _parse_vol(r['volume'])
            if today_vol <= 0:
                continue
            vol_ratio = today_vol / avg_vol
            # CASCADING-FALLBACK-031: مانطفيش السهم هنا بسبب vol_ratio المنخفض —
            # هنطبق التدرج بعدين. فلتر الدماء (turnover) و Penny Stock هما اللي
            # بيتطفي نهائياً (القاعدة الذهبية).
            # (تم إزالة: if vol_ratio < min_vol_ratio: continue)

            price = float(r['current_price'] or 0)
            turnover = today_vol * price
            # فلتر الدماء — سيولة أقل من 3M = سهم ميت، تجاهله (دائماً شغّال)
            if turnover < min_turnover:
                continue
            # Penny Stock — سعر أقل من 1 جنيه = بنسة، تجاهله (دائماً شغّال)
            if 0 < price < 1.0:
                continue

            change_pct = float(r['change_percent'] or 0)
            resistance = float(r['resistance'] or 0)
            broke_resistance = (resistance > 0 and price >= resistance * 0.995)
            # كسر المقاومة = إشارة شراء قوية (الحيتان بتكسر المقاومة بحجم)

            # Sniper Score: يجمع الزخم + التغير + كسر المقاومة
            sniper_score = 0.0
            sniper_score += min(40.0, vol_ratio * 10.0)        # الزخم (max 40)
            sniper_score += min(30.0, max(0.0, change_pct) * 6.0)  # التغير الصاعد (max 30)
            if broke_resistance:
                sniper_score += 20.0                            # كسر مقاومة (+20)
            try:
                _rsi = float(r['rsi'] or 50)
            except (ValueError, TypeError):
                _rsi = 50.0
            if _rsi < 70:
                sniper_score += 10.0                            # مش تشبع شرائي (+10)
            else:
                sniper_score -= 10.0                            # تشبع شرائي (-10)

            candidates.append({
                'ticker': r['ticker'],
                'name': r['name'] or r['name_ar'] or r['ticker'],
                'name_ar': r['name_ar'] or r['name'] or r['ticker'],
                'market': r['market'] or '',
                'sector': r['sector'] or '',
                'current_price': round(price, 2),
                'change_percent': round(change_pct, 2),
                'volume': int(today_vol),
                'avg_volume': int(avg_vol),
                'volume_ratio': round(vol_ratio, 2),
                'turnover_egp': round(turnover, 0),
                'resistance': round(resistance, 2) if resistance else None,
                'support': round(float(r['support'] or 0), 2) if r['support'] else None,
                'rsi': round(_rsi, 1),
                'broke_resistance': broke_resistance,
                'sniper_score': round(sniper_score, 1),
                'signal': r['signal'] or '',
                'trend': r['trend'] or '',
            })

        # ─── CASCADING-FALLBACK-031: التدرج في القبول للقناص ─────────────
        # التدرج على vol_ratio (الزخم)، مع بقاء فلتر الدماء (turnover>=3M)
        # و Penny Stock (<1جنيه) شغّالين دايماً (اتطفي فوق).
        #   Tier 1 (Strict):      vol_ratio >= min_vol_ratio (default 2.0x)
        #   Tier 2 (Moderate):    vol_ratio >= 1.5x
        #   Tier 3 (Survival):    vol_ratio >= 1.2x
        #   Tier 4 (Last-Resort): vol_ratio >= 1.0x (أي سهم سيولته كويسة)
        # =================================================================
        _strict_vr = min_vol_ratio
        _moderate_vr = max(1.5, min_vol_ratio * 0.75)
        _survival_vr = max(1.2, min_vol_ratio * 0.6)
        _lastresort_vr = 1.0

        # رتّب كل المرشحين (اللي عدّوا فلتر الدماء) حسب sniper_score
        candidates.sort(key=lambda x: x['sniper_score'], reverse=True)

        selected = []
        _seen = set()
        _tier_counts = {}

        def _sniper_tier_pass(min_vr, tier_name):
            for c in candidates:
                if len(selected) >= limit:
                    break
                tkr = (c.get('ticker') or '').upper()
                if tkr in _seen:
                    continue
                if c.get('volume_ratio', 0) >= min_vr:
                    c['fallback_tier'] = tier_name
                    selected.append(c)
                    _seen.add(tkr)
                    _tier_counts[tier_name] = _tier_counts.get(tier_name, 0) + 1

        _sniper_tier_pass(_strict_vr, 'strict')
        if len(selected) < limit:
            _sniper_tier_pass(_moderate_vr, 'moderate')
        if len(selected) < limit:
            _sniper_tier_pass(_survival_vr, 'survival')
        if len(selected) < limit:
            _sniper_tier_pass(_lastresort_vr, 'last_resort')

        top = selected[:limit]
        _dominant = max(_tier_counts, key=_tier_counts.get) if _tier_counts else 'strict'

        return jsonify({
            "success": True,
            "data": top,
            "count": len(top),
            "total_scanned": len(rows),
            "total_candidates": len(candidates),
            "filters": {
                "min_vol_ratio": min_vol_ratio,
                "min_turnover_egp": min_turnover,
                "limit": limit,
            },
            "cascade": {
                "dominant_tier": _dominant,
                "tier_counts": _tier_counts,
                "tiers": {
                    "strict":      {"min_vol_ratio": _strict_vr, "label_ar": "🏆 زخم انفجاري (>=2x)"},
                    "moderate":    {"min_vol_ratio": _moderate_vr, "label_ar": "🥈 زخم متوسط (>=1.5x)"},
                    "survival":    {"min_vol_ratio": _survival_vr, "label_ar": "🥉 زخم هادي (>=1.2x)"},
                    "last_resort": {"min_vol_ratio": _lastresort_vr, "label_ar": "⚠️ أعلى المتاح (>=1x)"},
                },
            },
            "description": "🎯 القناص اللحظي — زخم + سيولة >= 3M EGP. التدرج شغّال: لو مفيش زخم 2x، بيخفف لـ 1.5x → 1.2x → 1x عشان الشاشة متفضيش. فلتر الدماء شغّال دايماً.",
            "scanned_at": _cairo_now().isoformat(),
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# EXPERT-MEMORY-032: Active Expert Recommendations for a ticker
# ============================================================================

@app.route('/api/expert-recommendations/active', methods=['GET'])
def expert_recs_active():
    """📋 التوصيات النشطة للخبراء على سهم معيّن.

    Query params:
        ticker: رمز السهم (مطلوب) — مثال: COMI, EHDR
        days: نافذة الأيام (default 60)
    """
    ticker = (request.args.get('ticker') or '').strip().upper()
    if not ticker:
        return jsonify({"success": False, "error": "ticker required"}), 400
    days = request.args.get('days', 60, type=int)
    try:
        from analyzers.expert_memory_bridge import fetch_active_expert_recs
        recs = fetch_active_expert_recs(ticker, days=days)
        return jsonify({
            "success": True,
            "ticker": ticker,
            "days": days,
            "count": len(recs),
            "recommendations": [r.__dict__ for r in recs],
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# EODHD API endpoints (lightweight versions)
# ============================================================================

@app.route('/api/eodhd/backfill-status', methods=['GET'])
def eodhd_backfill_status():
    """حالة تعبئة البيانات التاريخية"""
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        cur = conn.cursor()
        total_stocks = cur.execute("SELECT COUNT(*) FROM stocks WHERE is_active = 1").fetchone()[0]
        stocks_with_history = cur.execute("SELECT COUNT(DISTINCT ticker) FROM stock_daily_prices").fetchone()[0]
        total_records = cur.execute("SELECT COUNT(*) FROM stock_daily_prices").fetchone()[0]
        oldest = cur.execute("SELECT MIN(price_date) FROM stock_daily_prices").fetchone()[0]
        newest = cur.execute("SELECT MAX(price_date) FROM stock_daily_prices").fetchone()[0]
        conn.close()
        return jsonify({
            "success": True,
            "total_stocks": total_stocks,
            "stocks_with_history": stocks_with_history,
            "total_records": total_records,
            "oldest_date": oldest,
            "newest_date": newest,
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/eodhd/bulk-update', methods=['POST'])
def eodhd_bulk_update():
    """تحديث كل أسهم EGX من EODHD"""
    try:
        import sys as _eo
        _eo.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from data.eodhd_fetcher import EODHDFetcher
        fetcher = EODHDFetcher()
        result = fetcher.update_all_stocks_bulk()
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/eodhd/sync-stocks', methods=['POST'])
def eodhd_sync_stocks():
    """مزامنة قائمة أسهم EGX"""
    try:
        import sys as _eo2
        _eo2.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from data.eodhd_fetcher import EODHDFetcher
        fetcher = EODHDFetcher()
        result = fetcher.sync_egx_stocks_to_db()
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/eodhd/clear-and-rebuild', methods=['POST'])
def eodhd_clear_and_rebuild():
    """
    مسح كل البيانات التاريخية القديمة وإعادة تعبئتها من EODHD
    يستخدم عندما البيانات القديمة تالفة أو غير متسقة
    """
    try:
        import sys as _eo3
        _eo3.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from data.eodhd_fetcher import EODHDFetcher

        days = request.args.get('days', 730, type=int)

        # Step 1: Clear old data
        conn = sqlite3.connect(DATABASE_PATH)
        cur = conn.cursor()
        old_count = cur.execute("SELECT COUNT(*) FROM stock_daily_prices").fetchone()[0]
        cur.execute("DELETE FROM stock_daily_prices")
        conn.commit()
        conn.close()

        # Step 2: Re-backfill from EODHD
        fetcher = EODHDFetcher()
        result = fetcher.backfill_all_stocks(days=days)
        result['old_records_deleted'] = old_count
        result['action'] = 'clear_and_rebuild'

        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/eodhd/backfill', methods=['POST'])
def eodhd_backfill():
    """تعبئة البيانات التاريخية"""
    try:
        import sys as _eo4
        _eo4.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from data.eodhd_fetcher import EODHDFetcher
        days = request.args.get('days', 730, type=int)
        fetcher = EODHDFetcher()
        result = fetcher.backfill_all_stocks(days=days)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500




# ============================================================================
# STOCK FUNDAMENTALS API — البيانات الأساسية من data-engine.db
# ============================================================================

@app.route('/api/stock-profile/<ticker>', methods=['GET'])
def stock_profile(ticker):
    """الملف الكامل لسهم - يجمع stocks.db + data-engine.db (9 جداول)"""
    try:
        import sys as _sp_sys
        _sp_sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from engine.stock_fundamentals import StockFundamentals
        engine = StockFundamentals()
        result = engine.get_stock_full_profile(ticker)
        if result:
            return jsonify({"success": True, "data": result})
        return jsonify({"success": False, "error": "Stock not found"}), 404
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/market-overview', methods=['GET'])
def market_overview():
    """نظرة عامة على السوق من data-engine.db"""
    try:
        import sys as _mo_sys
        _mo_sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from engine.stock_fundamentals import StockFundamentals
        engine = StockFundamentals()
        result = engine.get_market_overview()
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/smc/analyze/<ticker>', methods=['GET'])
def smc_analyze_ticker(ticker):
    """
    تحليل Smart Money Concepts (SMC) كامل لرمز معين:
    Order Blocks + Fair Value Gaps + Liquidity Sweeps + SMC Score
    """
    try:
        from analyzers.smc_engine import SMCEngine, calculate_smc_score
        from analyzers.master_analyzer import load_merged_history

        db_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'db', 'stocks.db')
        ohlcv = load_merged_history(ticker.upper(), db_file, limit=180)

        if not ohlcv:
            return jsonify({"success": False, "error": f"No price history found for ticker {ticker}"}), 404

        current_price = ohlcv[-1]['close']
        smc = SMCEngine(ohlcv)
        smc_score_data = calculate_smc_score(
            ohlcv=ohlcv,
            current_price=current_price,
            volume_ratio=1.2,
        )

        response_data = {
            'ticker': ticker.upper(),
            'current_price': current_price,
            'smc_score': smc_score_data['score'],
            'signals': smc_score_data['signals'],
            'order_blocks': smc.get_order_blocks(),
            'fvgs': smc.get_fvg(),
            'sweeps': smc.get_liquidity_sweeps(),
            'unmitigated_obs': [ob for ob in smc.get_order_blocks() if not ob.get('mitigated', False)],
            'unmitigated_fvgs': [fvg for fvg in smc.get_fvg() if not fvg.get('mitigated', False)],
        }
        return jsonify({"success": True, "data": response_data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500




# NOTE: The `if __name__ == '__main__'` block was previously located HERE
# (line ~1126). That was a critical bug: app.run() BLOCKS, so every
# @app.route decorator defined AFTER this point (crypto routes, the
# comprehensive /api/health check, /api/health/circuits/reset) was DEAD
# CODE — never registered. The main block has been MOVED to the END of
# this file so all routes register first. Do NOT re-insert app.run() here.


# ============================================================================
# CRYPTO ENGINE API — نفس نظام الأسهم للعملات الرقمية
# ============================================================================

@app.route('/api/crypto/live', methods=['GET'])
def crypto_live():
    """لوحة مراقبة كريبتو حية - كل العملات"""
    try:
        import sys as _ce_sys
        _ce_sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from engine.crypto_engine import CryptoEngine
        engine = CryptoEngine()
        result = engine.get_live_monitor()
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/crypto/flow/top', methods=['GET'])
def crypto_flow_top():
    """أعلى العملات في Flow Score"""
    try:
        import sys as _ce_sys2
        _ce_sys2.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from engine.crypto_engine import CryptoEngine
        limit = request.args.get('limit', 20, type=int)
        engine = CryptoEngine()
        result = engine.get_top_flow(limit)
        return jsonify({"success": True, "data": result, "count": len(result)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/crypto/flow/<symbol>', methods=['GET'])
def crypto_flow_symbol(symbol):
    """Flow Score لعملة واحدة"""
    try:
        import sys as _ce_sys3
        _ce_sys3.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from engine.crypto_engine import CryptoEngine
        engine = CryptoEngine()
        result = engine.calculate_flow_score(symbol.upper())
        if result:
            return jsonify({"success": True, "data": result.to_dict()})
        return jsonify({"success": False, "error": "Not found"}), 404
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/crypto/explosive/top', methods=['GET'])
def crypto_explosive_top():
    """أعلى القنابل في الكريبتو"""
    try:
        import sys as _ce_sys4
        _ce_sys4.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from engine.crypto_engine import CryptoEngine
        limit = request.args.get('limit', 20, type=int)
        engine = CryptoEngine()
        result = engine.get_top_explosive(limit)
        return jsonify({"success": True, "data": result, "count": len(result)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/crypto/explosive/<symbol>', methods=['GET'])
def crypto_explosive_symbol(symbol):
    """Explosive Score لعملة واحدة"""
    try:
        import sys as _ce_sys5
        _ce_sys5.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from engine.crypto_engine import CryptoEngine
        engine = CryptoEngine()
        result = engine.calculate_explosive_score(symbol.upper())
        if result:
            return jsonify({"success": True, "data": result.to_dict()})
        return jsonify({"success": False, "error": "Not found"}), 404
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/ai/live/scan', methods=['GET'])
def ai_live_scan():
    """Live AI Scan — يكتشف الأسهم الساخنة ويحللها بالـ AI فوراً"""
    try:
        import sys as _ai_sys1
        _ai_sys1.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from ai.live_ai_monitor import LiveAIMonitor
        market = request.args.get('market', 'EGX')
        max_stocks = request.args.get('max_stocks', 10, type=int)
        monitor = LiveAIMonitor()
        result = monitor.scan_and_analyze(market=market, max_stocks=max_stocks)
        return jsonify({
            "success": True,
            "signals": result.get("signals", []),
            "analyzed": result.get("analyzed", 0),
            "success_count": result.get("success_count", 0),
            "failed": result.get("failed", 0),
            "skipped": result.get("skipped", 0),
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/ai/historical/generate', methods=['GET'])
def ai_historical_generate():
    """Generate Historical Trades — يولّد صفقات تاريخية للتعلم"""
    try:
        import sys as _ai_sys2
        _ai_sys2.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from ai.historical_trade_generator import HistoricalTradeGenerator
        ticker_limit = request.args.get('ticker_limit', 50, type=int)
        days_back = request.args.get('days_back', 180, type=int)
        max_trades_per_ticker = request.args.get('max_trades_per_ticker', 50, type=int)
        gen = HistoricalTradeGenerator()
        result = gen.generate_all_trades(
            days_back=days_back,
            max_trades_per_ticker=max_trades_per_ticker,
            ticker_limit=ticker_limit,
        )
        return jsonify({
            "success": True,
            "total_trades": result.get("total_trades", 0),
            "successful_tickers": result.get("successful_tickers", 0),
            "elapsed_seconds": result.get("elapsed_seconds", 0),
            "total_tickers": result.get("total_tickers", 0),
            "merged": result.get("merged", False),
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/ai/historical/feed-ai', methods=['POST'])
def ai_historical_feed():
    """Feed historical trades to AI learning"""
    try:
        import sys as _ai_sys3
        _ai_sys3.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from ai.historical_trade_generator import HistoricalTradeGenerator
        body = request.get_json(silent=True) or {}
        limit = body.get("limit", 5000)
        gen = HistoricalTradeGenerator()
        result = gen.feed_to_ai_learning(limit=limit)
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# Phase 4 Task 2: Comprehensive /api/health Endpoint (Resilience & Observability)
# ============================================================================
# الـ endpoint ده بيرجّع JSON فيه حالة الـ backend كاملة:
#   1. DBs status (WAL state, file size, integrity) — عشان الـ WAL ميمسحش
#   2. آخر مرة الـ Scheduler شغل (per-job last_run)
#   3. استهلاك CPU/Memory (psutil)
#   4. عدد الـ Cached items (analysis_cache + circuit_registry stats)
#   5. Circuit Breaker status (Phase 4 Task 1)
#
# ده هيخلي أي Tool مراقبة (زي PM2 أو Uptime Robot) يعمل Restart تلقائيي لو
# فيه مشكلة (مثلاً: DB corrupted → health=false → PM2 restart).
#
# الـ endpoint سريع (< 100ms) عشان مايبوظش الـ monitoring. كل check ليها
# timeout قصير. لو check فشل، بترجّع null + error message (مايوقفش الباقي).
# ============================================================================

def _health_check_dbs() -> Dict[str, Any]:
    """فحص صحة الـ DBs الأساسية (stocks, predictions, price_history).

    بيرجّع: {db_name: {ok, path, journal_mode, wal_size_mb, integrity, error}}
    """
    result: Dict[str, Any] = {}
    try:
        import sys as _hsys
        _vps_dir = str(Path(__file__).resolve().parent)
        if _vps_dir not in _hsys.path:
            _hsys.path.insert(0, _vps_dir)
        from core.db_manager import db_manager
        # الـ 3 DBs الأساسية اللي المستخدم طلبها + data_engine
        dbs = ['stocks', 'predictions', 'price_history', 'data_engine']
        for db_name in dbs:
            try:
                health = db_manager.health_check(db_name)
                # Add WAL file size if available
                db_path = health.get('path', '')
                wal_size_mb = None
                if db_path:
                    try:
                        wal_path = db_path + '-wal'
                        if os.path.exists(wal_path):
                            wal_size_mb = round(
                                os.path.getsize(wal_path) / (1024 * 1024), 2
                            )
                    except Exception:
                        pass
                result[db_name] = {
                    'ok': health.get('ok', False),
                    'path': db_path,
                    'journal_mode': health.get('journal_mode'),
                    'wal_size_mb': wal_size_mb,
                    'page_count': health.get('page_count'),
                    'integrity': health.get('integrity'),
                    'error': health.get('error'),
                }
            except Exception as e:
                result[db_name] = {'ok': False, 'error': str(e)[:200]}
    except ImportError as e:
        result['_error'] = f'db_manager not available: {e}'
    except Exception as e:
        result['_error'] = f'db health check failed: {e}'
    return result


def _health_check_scheduler() -> Dict[str, Any]:
    """فحص حالة الـ central SchedulerManager + آخر مرة كل job شغل."""
    try:
        import sys as _hsys
        _vps_dir = str(Path(__file__).resolve().parent)
        if _vps_dir not in _hsys.path:
            _hsys.path.insert(0, _vps_dir)
        from core.scheduler_manager import scheduler_manager
        return scheduler_manager.get_status()
    except ImportError as e:
        return {'_error': f'scheduler_manager not available: {e}'}
    except Exception as e:
        return {'_error': f'scheduler status failed: {e}'}


def _health_check_cache() -> Dict[str, Any]:
    """فحص الـ analysis cache (hits/misses/size)."""
    try:
        import sys as _hsys
        _vps_dir = str(Path(__file__).resolve().parent)
        if _vps_dir not in _hsys.path:
            _hsys.path.insert(0, _vps_dir)
        from core.cache_manager import analysis_cache
        return analysis_cache.get_stats()
    except ImportError as e:
        return {'_error': f'cache_manager not available: {e}'}
    except Exception as e:
        return {'_error': f'cache status failed: {e}'}


def _health_check_circuits() -> Dict[str, Any]:
    """فحص الـ circuit breakers (Phase 4 Task 1)."""
    try:
        import sys as _hsys
        _vps_dir = str(Path(__file__).resolve().parent)
        if _vps_dir not in _hsys.path:
            _hsys.path.insert(0, _vps_dir)
        from core.circuit_breaker import circuit_registry
        return circuit_registry.get_status()
    except ImportError as e:
        return {'_error': f'circuit_breaker not available: {e}'}
    except Exception as e:
        return {'_error': f'circuit status failed: {e}'}


def _health_check_resources() -> Dict[str, Any]:
    """استهلاك CPU/Memory + uptime (psutil)."""
    try:
        import psutil
        import time as _time
        proc = psutil.Process()
        with proc.oneshot():
            mem_info = proc.memory_info()
            cpu_pct = proc.cpu_percent(interval=0.05)  # non-blocking-ish
            create_time = proc.create_time()
            uptime_seconds = round(_time.time() - create_time, 1)
            num_threads = proc.num_threads()
            num_fds = None
            try:
                num_fds = proc.num_fds()  # Unix only
            except Exception:
                pass
        # System-wide stats
        sys_mem = psutil.virtual_memory()
        sys_cpu = psutil.cpu_percent(interval=0.05)
        return {
            'process': {
                'pid': proc.pid,
                'uptime_seconds': uptime_seconds,
                'cpu_percent': cpu_pct,
                'rss_mb': round(mem_info.rss / (1024 * 1024), 2),
                'vms_mb': round(mem_info.vms / (1024 * 1024), 2),
                'num_threads': num_threads,
                'num_fds': num_fds,
            },
            'system': {
                'cpu_percent': sys_cpu,
                'cpu_count': psutil.cpu_count(logical=True),
                'memory_total_mb': round(sys_mem.total / (1024 * 1024), 2),
                'memory_used_mb': round(sys_mem.used / (1024 * 1024), 2),
                'memory_available_mb': round(sys_mem.available / (1024 * 1024), 2),
                'memory_percent': sys_mem.percent,
            },
        }
    except ImportError:
        return {'_error': 'psutil not available'}
    except Exception as e:
        return {'_error': f'resource check failed: {e}'}


def _health_check_wal_checkpoint() -> Dict[str, Any]:
    """Phase 4 Task 4: آخر تشغيل لـ WAL checkpoint job."""
    try:
        import sys as _hsys
        _vps_dir = str(Path(__file__).resolve().parent)
        if _vps_dir not in _hsys.path:
            _hsys.path.insert(0, _vps_dir)
        from jobs.wal_checkpoint import get_last_run_status
        last = get_last_run_status()
        return {
            'last_run': last,
            'target_dbs': ['stocks', 'predictions', 'price_history', 'data_engine'],
            'interval_seconds': 3600,  # hourly
        }
    except ImportError as e:
        return {'_error': f'wal_checkpoint module not available: {e}'}
    except Exception as e:
        return {'_error': f'wal_checkpoint status failed: {e}'}


@app.route('/api/health', methods=['GET'])
def comprehensive_health_check():
    """Phase 4 Task 2: Comprehensive backend health check.

    بيرجّع JSON فيه حالة الـ backend كاملة. ده بيخلي أي Tool مراقبة (PM2،
    Uptime Robot) يعمل Restart تلقائيي لو فيه مشكلة (مثلاً DB corrupted).

    Response shape:
        {
          "status": "healthy" | "degraded" | "unhealthy",
          "service": "GLM Finance Backend",
          "version": "2.0.0",
          "timestamp": "...",
          "uptime_seconds": 1234.5,
          "dbs": {...},           # 4 DBs status
          "scheduler": {...},     # central SchedulerManager status
          "cache": {...},         # analysis cache stats
          "circuit_breakers": {...},  # Phase 4 Task 1
          "resources": {...},     # CPU/Memory (psutil)
        }

    الـ `status` بيتحدد بناءً على:
      - "healthy"   → كل الـ DBs ok + scheduler running.
      - "degraded"  → DB واحد مش ok أو scheduler مش شغّال.
      - "unhealthy" → أكتر من DB مش ok.
    """
    import time as _time

    # Run all checks (each is independent + has its own error handling)
    dbs_health = _health_check_dbs()
    scheduler_health = _health_check_scheduler()
    cache_health = _health_check_cache()
    circuits_health = _health_check_circuits()
    resources_health = _health_check_resources()
    wal_checkpoint_health = _health_check_wal_checkpoint()

    # Determine overall status
    db_errors = 0
    db_total = 0
    for db_name, db_info in dbs_health.items():
        if db_name.startswith('_'):
            continue
        db_total += 1
        if not db_info.get('ok', False):
            db_errors += 1

    scheduler_running = bool(scheduler_health.get('running', False))

    if db_errors >= 2:
        overall_status = 'unhealthy'
        http_code = 503
    elif db_errors == 1 or not scheduler_running:
        overall_status = 'degraded'
        http_code = 200  # still return 200 so monitoring doesn't alert
    else:
        overall_status = 'healthy'
        http_code = 200

    # Uptime from resources (or fallback to scheduler's cairo_now)
    uptime_seconds = None
    if isinstance(resources_health, dict):
        proc = resources_health.get('process', {})
        if isinstance(proc, dict):
            uptime_seconds = proc.get('uptime_seconds')

    response = {
        'status': overall_status,
        'service': 'GLM Finance Backend',
        'version': '2.0.0',
        'phase': 'Phase 4 — Resilience & Observability',
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'uptime_seconds': uptime_seconds,
        'dbs': dbs_health,
        'scheduler': scheduler_health,
        'cache': cache_health,
        'circuit_breakers': circuits_health,
        'wal_checkpoint': wal_checkpoint_health,
        'resources': resources_health,
    }

    return jsonify(response), http_code


@app.route('/api/health/circuits/reset', methods=['POST'])
def reset_circuit_breakers():
    """Phase 4 Task 1 admin: Reset كل الـ circuit breakers لـ CLOSED."""
    try:
        import sys as _hsys
        _vps_dir = str(Path(__file__).resolve().parent)
        if _vps_dir not in _hsys.path:
            _hsys.path.insert(0, _vps_dir)
        from core.circuit_breaker import circuit_registry
        body = request.get_json(silent=True) or {}
        target = body.get('name')  # optional: reset specific breaker
        if target:
            ok = circuit_registry.reset(target)
            return jsonify({
                'success': ok,
                'message': f'CircuitBreaker {target!r} reset to CLOSED' if ok
                           else f'CircuitBreaker {target!r} not found',
            })
        else:
            count = circuit_registry.reset_all()
            return jsonify({
                'success': True,
                'message': f'Reset {count} circuit breakers to CLOSED',
                'count': count,
            })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)[:200]}), 500


# ============================================================================
# ROOT-LEVEL HEALTH ALIASES (PRODUCTION FIX)
# ============================================================================
# The Next.js proxy at src/app/api/proxy/[...path]/route.ts special-cases the
# paths `health` and `keepalive` to be served at the backend ROOT
# (http://localhost:8010/health), NOT under /api/. Without these root aliases,
# /api/proxy/health → http://localhost:8010/health → 404, and the
# MaestroDashboard health check (fetch('/api/python/health')) fails even though
# the backend is running — producing the red "Python Backend غير متصل" screen.
# These aliases delegate to the comprehensive /api/health check above.
# ============================================================================

@app.route('/health', methods=['GET'])
def health_root():
    """Root /health alias — delegates to the comprehensive health check."""
    return comprehensive_health_check()


@app.route('/keepalive', methods=['GET'])
def keepalive_root():
    """Root /keepalive alias — lightweight liveness probe for the proxy."""
    return jsonify({
        'status': 'ok',
        'service': 'GLM Finance Backend',
        'port': 8010,
        'timestamp': datetime.utcnow().isoformat() + 'Z',
    })


# ============================================================================
# CRYPTO ENDPOINTS — الناقصة (Aug 2026 audit)
# Next.js routes بتنادي endpoints مش موجودة → 503. أضفناها هنا.
# ============================================================================

@app.route('/api/crypto/sync', methods=['POST'])
def crypto_sync():
    """Sync crypto data من CoinGecko + تخزين في crypto_prices."""
    try:
        import requests
        url = "https://api.coingecko.com/api/v3/coins/markets"
        params = {
            'vs_currency': 'usd',
            'order': 'market_cap_desc',
            'per_page': 50,
            'page': 1,
            'sparkline': False,
            'price_change_percentage': '24h,7d'
        }
        resp = requests.get(url, params=params, timeout=20)
        if not resp.ok:
            return jsonify({"success": False, "error": f"CoinGecko {resp.status_code}"}), 502
        coins = resp.json()
        # رجّع بس بدون كتابة (الكتابة بتحصل في data-engine منفصل)
        return jsonify({
            "success": True,
            "count": len(coins),
            "coins": coins[:20],  # first 20
            "timestamp": datetime.utcnow().isoformat() + 'Z'
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/crypto/analyze/<coin_id>', methods=['GET'])
def crypto_analyze(coin_id):
    """تحليل فني لعملة واحدة من CoinGecko."""
    try:
        import requests
        # OHLC آخر 30 يوم
        ohlc_url = f"https://api.coingecko.com/api/v3/coins/{coin_id}/ohlc"
        params = {'vs_currency': 'usd', 'days': '30'}
        resp = requests.get(ohlc_url, params=params, timeout=15)
        if not resp.ok:
            return jsonify({"success": False, "error": f"CoinGecko {resp.status_code}"}), 502
        ohlc = resp.json()
        # حساب RSI بسيط من closes
        closes = [c[4] for c in ohlc]
        rsi = 50.0
        if len(closes) >= 15:
            gains, losses = 0, 0
            for i in range(1, 15):
                diff = closes[i] - closes[i-1]
                if diff >= 0:
                    gains += diff
                else:
                    losses -= diff
            avg_gain = gains / 14
            avg_loss = losses / 14
            if avg_loss == 0:
                rsi = 100.0
            else:
                rs = avg_gain / avg_loss
                rsi = 100 - (100 / (1 + rs))
        last_price = closes[-1] if closes else None
        return jsonify({
            "success": True,
            "coin_id": coin_id,
            "price": last_price,
            "rsi": round(rsi, 2),
            "candles_count": len(ohlc),
            "analysis": {
                "trend": "uptrend" if len(closes) >= 2 and closes[-1] > closes[0] else "downtrend",
                "signal": "BUY" if rsi < 40 else "SELL" if rsi > 70 else "NEUTRAL",
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/crypto/<coin_id>/history', methods=['GET'])
def crypto_history(coin_id):
    """تاريخ أسعار عملة من CoinGecko."""
    try:
        import requests
        days = request.args.get('days', '30')
        url = f"https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart"
        params = {'vs_currency': 'usd', 'days': days}
        resp = requests.get(url, params=params, timeout=15)
        if not resp.ok:
            return jsonify({"success": False, "error": f"CoinGecko {resp.status_code}"}), 502
        data = resp.json()
        return jsonify({
            "success": True,
            "coin_id": coin_id,
            "prices": data.get('prices', []),
            "market_caps": data.get('market_caps', []),
            "total_volumes": data.get('total_volumes', []),
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/crypto/watchlist', methods=['GET', 'POST', 'DELETE'])
def crypto_watchlist():
    """Watchlist للكريبتو — تخزين في SQLite (crypto.db)."""
    try:
        import sqlite3
        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'db', 'crypto.db')
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS crypto_watchlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT UNIQUE NOT NULL,
            name TEXT,
            added_at TEXT DEFAULT (datetime('now'))
        )''')
        if request.method == 'GET':
            rows = c.execute('SELECT symbol, name, added_at FROM crypto_watchlist ORDER BY added_at DESC').fetchall()
            conn.close()
            return jsonify({"success": True, "data": [{"symbol": r[0], "name": r[1], "added_at": r[2]} for r in rows]})
        elif request.method == 'POST':
            body = request.get_json() or {}
            symbol = (body.get('symbol') or '').upper()
            name = body.get('name', '')
            if not symbol:
                return jsonify({"success": False, "error": "symbol required"}), 400
            c.execute('INSERT OR IGNORE INTO crypto_watchlist (symbol, name) VALUES (?, ?)', (symbol, name))
            conn.commit()
            conn.close()
            return jsonify({"success": True, "symbol": symbol})
        elif request.method == 'DELETE':
            symbol = request.args.get('symbol', '').upper()
            if not symbol:
                return jsonify({"success": False, "error": "symbol required"}), 400
            c.execute('DELETE FROM crypto_watchlist WHERE symbol = ?', (symbol,))
            conn.commit()
            conn.close()
            return jsonify({"success": True, "deleted": symbol})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/crypto/portfolio', methods=['GET', 'POST'])
def crypto_portfolio():
    """Portfolio للكريبتو — تخزين في SQLite (crypto.db)."""
    try:
        import sqlite3
        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'db', 'crypto.db')
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS crypto_portfolio (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            quantity REAL NOT NULL,
            buy_price REAL NOT NULL,
            buy_date TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )''')
        if request.method == 'GET':
            rows = c.execute('SELECT id, symbol, quantity, buy_price, buy_date FROM crypto_portfolio ORDER BY created_at DESC').fetchall()
            conn.close()
            return jsonify({"success": True, "data": [{"id": r[0], "symbol": r[1], "quantity": r[2], "buy_price": r[3], "buy_date": r[4]} for r in rows]})
        elif request.method == 'POST':
            body = request.get_json() or {}
            symbol = (body.get('symbol') or '').upper()
            quantity = float(body.get('quantity', 0))
            buy_price = float(body.get('buy_price', 0))
            buy_date = body.get('buy_date', datetime.utcnow().isoformat())
            if not symbol or quantity <= 0 or buy_price <= 0:
                return jsonify({"success": False, "error": "symbol, quantity, buy_price required"}), 400
            c.execute('INSERT INTO crypto_portfolio (symbol, quantity, buy_price, buy_date) VALUES (?, ?, ?, ?)',
                     (symbol, quantity, buy_price, buy_date))
            conn.commit()
            conn.close()
            return jsonify({"success": True, "symbol": symbol, "quantity": quantity})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/crypto/simulation/portfolio', methods=['GET'])
def crypto_simulation_portfolio():
    """محفظة المحاكاة — من نفس جدول crypto_portfolio بس بـ tag=simulation."""
    try:
        import sqlite3
        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'db', 'crypto.db')
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS crypto_simulation (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            quantity REAL NOT NULL,
            buy_price REAL NOT NULL,
            buy_date TEXT,
            status TEXT DEFAULT 'OPEN',
            created_at TEXT DEFAULT (datetime('now'))
        )''')
        rows = c.execute("SELECT id, symbol, quantity, buy_price, buy_date, status FROM crypto_simulation WHERE status = 'OPEN' ORDER BY created_at DESC").fetchall()
        conn.close()
        return jsonify({"success": True, "data": [{"id": r[0], "symbol": r[1], "quantity": r[2], "buy_price": r[3], "buy_date": r[4], "status": r[5]} for r in rows]})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/crypto/simulation/trade', methods=['POST'])
def crypto_simulation_trade():
    """تنفيذ صفقة محاكاة (BUY/SELL)."""
    try:
        import sqlite3
        body = request.get_json() or {}
        action = (body.get('action') or '').upper()
        symbol = (body.get('symbol') or '').upper()
        quantity = float(body.get('quantity', 0))
        price = float(body.get('price', 0))
        if action not in ('BUY', 'SELL') or not symbol or quantity <= 0 or price <= 0:
            return jsonify({"success": False, "error": "action (BUY/SELL), symbol, quantity, price required"}), 400
        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'db', 'crypto.db')
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS crypto_simulation (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            quantity REAL NOT NULL,
            buy_price REAL NOT NULL,
            buy_date TEXT,
            status TEXT DEFAULT 'OPEN',
            created_at TEXT DEFAULT (datetime('now'))
        )''')
        if action == 'BUY':
            c.execute('INSERT INTO crypto_simulation (symbol, quantity, buy_price, buy_date, status) VALUES (?, ?, ?, ?, ?)',
                     (symbol, quantity, price, datetime.utcnow().isoformat(), 'OPEN'))
        else:  # SELL — close any OPEN position
            c.execute("UPDATE crypto_simulation SET status = 'CLOSED' WHERE symbol = ? AND status = 'OPEN'", (symbol,))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "action": action, "symbol": symbol, "quantity": quantity, "price": price})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/crypto-phase4/events', methods=['GET'])
def crypto_events():
    """أحداث الكريبتو — من CoinGecko + status updates."""
    try:
        import requests
        limit = request.args.get('limit', 20, type=int)
        # CoinGecko status updates endpoint
        url = "https://api.coingecko.com/api/v3/status_updates"
        resp = requests.get(url, params={'per_page': limit}, timeout=15)
        if not resp.ok:
            # fallback: events من crypto_prices (أعلى تغيرات)
            import sqlite3
            de_db = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'db', 'data_engine.db')
            conn = sqlite3.connect(de_db)
            c = conn.cursor()
            rows = c.execute("""
                SELECT symbol, name, price_change_24h, price_usd, timestamp
                FROM crypto_prices
                WHERE timestamp = (SELECT MAX(timestamp) FROM crypto_prices)
                ORDER BY ABS(price_change_24h) DESC LIMIT ?
            """, (limit,)).fetchall()
            conn.close()
            events = [{
                "id": f"price-{r[0]}",
                "title": f"{r[0]} ({r[1]}): {r[2]:+.2f}%",
                "description": f"السعر: ${r[3]:,.2f}" if r[3] else "",
                "timestamp": r[4],
                "category": "price",
                "importance": "high" if abs(r[2] or 0) > 10 else "medium"
            } for r in rows]
            return jsonify({"success": True, "events": events, "count": len(events), "source": "local_db"})
        data = resp.json()
        events = data.get('status_updates', [])[:limit]
        return jsonify({"success": True, "events": events, "count": len(events), "source": "coingecko"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# MAIN ENTRY POINT — MUST BE AT END OF FILE
# All @app.route decorators above are registered at import time. app.run()
# blocks, so it MUST come AFTER every route definition. (Previously located
# at line ~1126, which silently disabled all routes defined after it.)
# ============================================================================
if __name__ == '__main__':
    print("=" * 50)
    print("Market Pulse Server (Lightweight)")
    print(f"Database: {DATABASE_PATH}")
    print("Port: 8010")
    print("=" * 50)
    app.run(host='0.0.0.0', port=8010, debug=False, threaded=True)
