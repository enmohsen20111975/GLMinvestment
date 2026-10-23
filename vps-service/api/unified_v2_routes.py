"""
Unified Analysis API Routes v2
================================
مسارات API للمحرك الموحد الجديد

Endpoints:
  POST /api/v2/unified/analyze          ← تحليل سهم واحد
  POST /api/v2/unified/scan             ← فحص سوق كامل
  GET  /api/v2/unified/markets          ← قائمة الأسواق + إعداداتها
  GET  /api/v2/unified/personas         ← قائمة الشخصيات
  GET  /api/v2/unified/config           ← الإعداد المدمج لسوق+شخصية
  POST /api/v2/unified/backtest-config  ← معاينة إعدادات قبل تطبيقها

@version 2.0.0
"""

from flask import Blueprint, request, jsonify
from core.auth_middleware import require_admin
import sys
import os
import sqlite3
import json
from datetime import datetime
from typing import List, Dict, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analyzers.core_scoring_engine import CoreScoringEngine, BatchAnalyzer, get_engine
from config.unified_config import (
    get_unified_config, list_markets, list_personas,
    get_all_configs_summary, MARKET_PROFILES, PERSONA_PROFILES,
    translate_signal,
)

# Import parse_volume helper
try:
    from utils.helpers import parse_volume
except ImportError:
    # Fallback definition
    def parse_volume(value) -> int:
        if value is None:
            return 0
        if isinstance(value, (int, float)):
            return int(value)
        value_str = str(value).strip().upper().replace('\u202f', '').replace(' ', '')
        multipliers = {'K': 1_000, 'M': 1_000_000, 'B': 1_000_000_000}
        for suffix, multiplier in multipliers.items():
            if value_str.endswith(suffix):
                try:
                    return int(float(value_str[:-1]) * multiplier)
                except ValueError:
                    return 0
        try:
            return int(float(value_str))
        except (ValueError, TypeError):
            return 0

# ─── Blueprint ────────────────────────────────────────────────────────────────
unified_v2_bp = Blueprint("unified_v2", __name__)

# ─── DB Path (من متغير البيئة أو الافتراضي) ──────────────────────────────────
try:
    from config import DATABASE_PATH, PRICE_HISTORY_DB_PATH
except ImportError:
    # Fallback
    _base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    DATABASE_PATH = os.environ.get("DATABASE_PATH", os.path.join(os.path.dirname(_base_dir), "db", "stocks.db"))
    PRICE_HISTORY_DB_PATH = os.path.join(os.path.dirname(_base_dir), "db", "price_history.db")

DB_PATH = os.environ.get(
    "DB_PATH",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "predictions.db")
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _load_price_data_from_db(ticker: str, market: str, limit: int = 250) -> Optional[dict]:
    """
    جلب بيانات الأسعار من DB
    يدعم جدولي price_history و stocks
    """
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(PRICE_HISTORY_DB_PATH, writable=False).__enter__()
        cur = conn.cursor()

        # جرّب price_history أولاً
        cur.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ?
            ORDER BY date DESC
            LIMIT ?
        """, (ticker, limit))
        rows = cur.fetchall()

        if not rows and market:
            # جرّب بـ market qualifier
            cur.execute("""
                SELECT date, open_price, high_price, low_price, close_price, volume
                FROM price_history
                WHERE ticker = ? OR ticker = ?
                ORDER BY date DESC
                LIMIT ?
            """, (ticker, f"{ticker}.{market}", limit))
            rows = cur.fetchall()

        conn.close()

        if not rows:
            return None

        # ترتيب من الأقدم للأحدث
        rows = list(reversed(rows))

        return {
            "opens":   [float(r[1] or r[4]) for r in rows],
            "highs":   [float(r[2] or r[4]) for r in rows],
            "lows":    [float(r[3] or r[4]) for r in rows],
            "closes":  [float(r[4]) for r in rows],
            "volumes": [int(r[5] or 0) for r in rows],
            "dates":   [r[0] for r in rows],
        }

    except Exception as e:
        print(f"[unified_v2] DB error for {ticker}: {e}")
        return None


def _load_current_stock_from_db(ticker: str, market: str) -> Optional[dict]:
    """جلب بيانات السهم الحالية"""
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(DATABASE_PATH, writable=False).__enter__()
        cur = conn.cursor()
        cur.execute("""
            SELECT ticker, name, current_price, volume,
                   change_percent, high_price, low_price,
                   sector, market
            FROM stocks
            WHERE ticker = ?
            LIMIT 1
        """, (ticker,))
        row = cur.fetchone()
        conn.close()

        if row:
            return {
                "ticker":    row[0],
                "name":      row[1],
                "price":     float(row[2] or 0),
                "volume":    parse_volume(row[3]),
                "change":    float(row[4] or 0),
                "high":      float(row[5] or 0),
                "low":       float(row[6] or 0),
                "sector":    row[7],
                "market":    row[8],
            }
        return None
    except Exception:
        return None


def _load_all_market_tickers(market: str, limit: int = 200) -> List[str]:
    """جلب كل أسهم سوق معين"""
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(DATABASE_PATH, writable=False).__enter__()
        cur = conn.cursor()
        cur.execute("""
            SELECT DISTINCT ticker FROM stocks
            WHERE market = ?
            ORDER BY volume DESC
            LIMIT ?
        """, (market, limit))
        rows = cur.fetchall()
        conn.close()
        return [r[0] for r in rows]
    except Exception:
        return []


# ─── Routes ───────────────────────────────────────────────────────────────────

@unified_v2_bp.route("/markets", methods=["GET"])
def get_markets():
    """
    قائمة الأسواق المتاحة مع إعداداتها
    GET /api/v2/unified/markets
    """
    markets = []
    for code, profile in MARKET_PROFILES.items():
        markets.append({
            "code":        profile.market_code,
            "name":        profile.market_name,
            "name_ar":     profile.market_name_ar,
            "currency":    profile.currency,
            "strategy":    profile.default_strategy.value,
            "min_score":   profile.min_score_buy,
            "min_rr":      profile.min_rr,
            "weights":     profile.weights.to_dict(),
            "notes":       profile.notes,
        })
    return jsonify({"markets": markets, "count": len(markets)})


@unified_v2_bp.route("/personas", methods=["GET"])
def get_personas():
    """
    قائمة الشخصيات المتاحة
    GET /api/v2/unified/personas
    """
    personas = []
    for name, profile in PERSONA_PROFILES.items():
        personas.append({
            "id":               name,
            "name_ar":          profile.name_ar,
            "score_boost":      profile.score_threshold_boost,
            "max_trades":       profile.max_concurrent_trades,
            "position_pct":     profile.position_size_pct,
            "holding_days":     f"{profile.min_holding_days}-{profile.max_holding_days}",
            "min_rr":           profile.min_rr_override,
            "allowed_signals":  profile.allowed_signals,
            "strategies":       profile.allowed_strategies,
        })
    return jsonify({"personas": personas, "count": len(personas)})


@unified_v2_bp.route("/config", methods=["GET"])
def get_config():
    """
    الإعداد المدمج لسوق + شخصية
    GET /api/v2/unified/config?market=EGX&persona=trader
    """
    market  = request.args.get("market", "EGX").upper()
    persona = request.args.get("persona", "trader").lower()

    try:
        cfg = get_unified_config(market, persona)
        return jsonify({
            "config": cfg.to_summary(),
            "market_profile": {
                "weights":          cfg.market_profile.weights.to_dict(),
                "stop_method":      cfg.market_profile.stop_method.value,
                "stop_atr_mult":    cfg.market_profile.stop_atr_mult,
                "stop_min_pct":     cfg.market_profile.stop_min_pct,
                "stop_max_pct":     cfg.market_profile.stop_max_pct,
                "target_min_pct":   cfg.market_profile.target_min_pct,
                "target_max_pct":   cfg.market_profile.target_max_pct,
                "rsi_overbought":   cfg.market_profile.rsi_overbought,
                "rsi_oversold":     cfg.market_profile.rsi_oversold,
            },
            "effective": {
                "min_score_buy":   cfg.min_score_buy,
                "min_rr":          cfg.min_rr,
                "position_size":   cfg.position_size_pct,
                "max_trades":      cfg.max_concurrent_trades,
                "stop_atr_mult":   cfg.stop_atr_mult,
                "target_rr_mult":  cfg.target_rr_mult,
            }
        })
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@require_admin
@unified_v2_bp.route("/analyze", methods=["POST"])
def analyze_single():
    """
    تحليل سهم واحد
    POST /api/v2/unified/analyze

    Body:
    {
        "ticker":    "COMI",
        "market":    "EGX",
        "persona":   "trader",       ← optional, default: trader
        "support":   120.0,          ← optional
        "resistance": 145.0,         ← optional
        "price_data": {...}          ← optional (لو ما في DB)
    }
    """
    data = request.get_json() or {}

    ticker  = data.get("ticker", "").strip().upper()
    market  = data.get("market", "EGX").strip().upper()
    persona = data.get("persona", "trader").strip().lower()
    support    = data.get("support")
    resistance = data.get("resistance")

    if not ticker:
        return jsonify({"error": "يجب تحديد رمز السهم (ticker)"}), 400

    # جلب البيانات
    price_data = data.get("price_data")  # لو المستخدم أرسل البيانات مباشرة
    if not price_data:
        price_data = _load_price_data_from_db(ticker, market)

    if not price_data or len(price_data.get("closes", [])) < 5:
        # جرّب بيانات السهم الحالية فقط (بدون تاريخ)
        stock = _load_current_stock_from_db(ticker, market)
        if stock and stock["price"] > 0:
            # بيانات محدودة - استخدم السعر الحالي فقط
            p = stock["price"]
            price_data = {
                "closes":  [p],
                "opens":   [p * 0.99],
                "highs":   [p * 1.01],
                "lows":    [p * 0.98],
                "volumes": [stock["volume"]],
            }
        else:
            return jsonify({
                "error":  f"لا توجد بيانات للسهم {ticker}",
                "ticker": ticker,
                "market": market,
            }), 404

    # التحليل
    engine = get_engine()
    result = engine.analyze(
        ticker=ticker,
        price_data=price_data,
        market=market,
        persona=persona,
        support=support,
        resistance=resistance,
    )

    return jsonify({
        "success": True,
        "result":  result.to_dict(),
        "config_used": get_unified_config(market, persona).to_summary(),
    })


@require_admin
@unified_v2_bp.route("/scan", methods=["POST"])
def scan_market():
    """
    فحص سوق كامل وإرجاع أفضل الفرص
    POST /api/v2/unified/scan

    Body:
    {
        "market":    "EGX",
        "persona":   "trader",
        "top_n":     20,
        "min_score": 65
    }
    """
    data = request.get_json() or {}

    market    = data.get("market", "EGX").upper()
    persona   = data.get("persona", "trader").lower()
    top_n     = int(data.get("top_n", 20))
    min_score = data.get("min_score")

    # جلب الأسهم
    tickers = _load_all_market_tickers(market, limit=300)
    if not tickers:
        return jsonify({
            "error":  f"لا توجد أسهم للسوق {market}",
            "market": market,
        }), 404

    # تجميع البيانات
    tickers_data: Dict[str, dict] = {}
    for ticker in tickers:
        pd = _load_price_data_from_db(ticker, market)
        if pd and len(pd.get("closes", [])) >= 10:
            tickers_data[ticker] = pd

    if not tickers_data:
        return jsonify({
            "error":  "لا توجد بيانات تاريخية كافية للتحليل",
            "market": market,
            "tickers_found": len(tickers),
        }), 422

    # التحليل الجماعي
    batch = BatchAnalyzer()
    results = batch.analyze_batch(
        tickers_data, market, persona,
        min_score=min_score, top_n=top_n
    )

    stats = batch.get_summary_stats(results)

    return jsonify({
        "success":       True,
        "market":        market,
        "persona":       persona,
        "analyzed":      len(tickers_data),
        "found":         len(results),
        "stats":         stats,
        "config":        get_unified_config(market, persona).to_summary(),
        "results":       [r.to_dict() for r in results],
        "generated_at":  datetime.now().isoformat(),
    })


@require_admin
@unified_v2_bp.route("/compare-personas", methods=["POST"])
def compare_personas():
    """
    مقارنة نفس السهم عبر كل الشخصيات
    POST /api/v2/unified/compare-personas

    Body: { "ticker": "COMI", "market": "EGX" }
    """
    data    = request.get_json() or {}
    ticker  = data.get("ticker", "").upper()
    market  = data.get("market", "EGX").upper()

    if not ticker:
        return jsonify({"error": "ticker مطلوب"}), 400

    price_data = _load_price_data_from_db(ticker, market)
    if not price_data:
        return jsonify({"error": f"لا توجد بيانات للسهم {ticker}"}), 404

    engine = get_engine()
    comparison = {}

    for persona in list_personas():
        result = engine.analyze(ticker, price_data, market, persona)
        comparison[persona] = {
            "persona_ar":  PERSONA_PROFILES[persona].name_ar,
            "signal":      result.signal,
            "signal_ar":   result.signal_ar,
            "score":       result.score,
            "confidence":  result.confidence,
            "min_score":   get_unified_config(market, persona).min_score_buy,
            "stop_loss":   result.stop_loss,
            "target":      result.target_1,
            "rr":          result.risk_reward,
            "valid":       result.is_valid,
            "warnings":    result.warnings,
        }

    return jsonify({
        "ticker":     ticker,
        "market":     market,
        "comparison": comparison,
    })


@unified_v2_bp.route("/market-summary", methods=["GET"])
def market_summary():
    """
    ملخص حالة كل الأسواق
    GET /api/v2/unified/market-summary
    """
    from config.market_config import is_market_open

    summary = []
    for code, profile in MARKET_PROFILES.items():
        tickers = _load_all_market_tickers(code, limit=10)
        summary.append({
            "market":     code,
            "name_ar":    profile.market_name_ar,
            "currency":   profile.currency,
            "strategy":   profile.default_strategy.value,
            "is_open":    is_market_open(code),
            "stocks_available": len(tickers) > 0,
            "sample_tickers":   tickers[:5],
        })

    return jsonify({"markets": summary})
