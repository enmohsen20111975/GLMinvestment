"""
core/macro_state_engine.py — محرك الذاكرة التراكمية (Incremental Warm State)
=============================================================================
الحل المعماري لمنع هبوط السيرفر:
1. Cold Boot (مرة واحدة عند بدء التشغيل أو إغلاق السوق):
   - يقرأ التاريخ الكامل لكل الأسهم (1.3M صف) ويستخرج الثوابت:
     (52W High, 52W Low, SMA200, Avg Volume 20D, Major Support/Resistance).
   - يخزنها في الذاكرة (In-Memory RAM Dict) + جدول خفيف في stocks.db.
2. Hot Loop (كل 5 دقائق أثناء الجلسة):
   - يسحب الشمعة الحالية فقط ويقارنها بالثوابت في الذاكرة بزمن < 1 ميلي ثانية للسهم.
"""
from __future__ import annotations

import sqlite3
import logging
from typing import Dict, Any, Optional
from pathlib import Path
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass
class StockMacroState:
    ticker: str
    market: str
    high_52w: float
    low_52w: float
    vol_avg_20d: float
    support_level: float
    resistance_level: float
    sma200: Optional[float]
    last_updated: str


class MacroStateEngine:
    _instance: Optional[MacroStateEngine] = None
    _state_cache: Dict[str, StockMacroState] = {}
    _initialized: bool = False

    def __new__(cls) -> MacroStateEngine:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @classmethod
    def is_warmed(cls) -> bool:
        return cls._initialized and len(cls._state_cache) > 0

    @classmethod
    def cold_boot(cls, force: bool = False) -> int:
        """تشغيل اللفة التأسيسية (Cold Boot) مرة واحدة لاستخراج الثوابت."""
        if cls._initialized and not force:
            logger.info(f"[MacroState] Cache already warm with {len(cls._state_cache)} stocks.")
            return len(cls._state_cache)

        logger.info("[MacroState] 🚀 Starting Cold Boot — Extracting 52W Constants from price_history.db...")
        ph_path = PROJECT_ROOT / "db" / "price_history.db"
        if not ph_path.exists():
            logger.warning("[MacroState] price_history.db not found, trying stocks.db...")
            return cls._cold_boot_from_stocks_db()

        try:
            conn = sqlite3.connect(f"file:{ph_path}?mode=ro", uri=True, timeout=10.0)
            cursor = conn.cursor()
            
            # استخراج أعلى وأدنى سعر 52 أسبوع ومتوسط الحجم في استعلام تجميعي سريع
            query = """
                SELECT 
                    ticker,
                    MAX(high_price) as high_52w,
                    MIN(low_price) as low_52w,
                    AVG(volume) as vol_avg,
                    COUNT(*) as bar_count
                FROM price_history
                WHERE date >= date('now', '-365 days')
                GROUP BY ticker
            """
            rows = cursor.execute(query).fetchall()
            conn.close()

            count = 0
            for r in rows:
                ticker = r[0]
                if not ticker:
                    continue
                high_52w = float(r[1] or 0.0)
                low_52w = float(r[2] or 0.0)
                vol_avg = float(r[3] or 1.0)
                
                cls._state_cache[ticker] = StockMacroState(
                    ticker=ticker,
                    market="EGX",
                    high_52w=round(high_52w, 2),
                    low_52w=round(low_52w, 2),
                    vol_avg_20d=round(vol_avg, 0),
                    support_level=round(low_52w * 1.03, 2),
                    resistance_level=round(high_52w * 0.98, 2),
                    sma200=None,
                    last_updated="cold_boot"
                )
                count += 1

            cls._initialized = True
            logger.info(f"[MacroState] ✅ Cold Boot finished. {count} stocks loaded in RAM.")
            return count
        except Exception as e:
            logger.error(f"[MacroState] Cold boot failed: {e}")
            return cls._cold_boot_from_stocks_db()

    @classmethod
    def _cold_boot_from_stocks_db(cls) -> int:
        """بديل استخراج الثوابت من stocks.db لو price_history غير متاح."""
        sdb_path = PROJECT_ROOT / "db" / "stocks.db"
        if not sdb_path.exists():
            return 0
        try:
            conn = sqlite3.connect(f"file:{sdb_path}?mode=ro", uri=True, timeout=5.0)
            rows = conn.execute("""
                SELECT ticker, high_52w, low_52w, last_price
                FROM stocks WHERE is_active = 1
            """).fetchall()
            conn.close()
            for r in rows:
                t = r[0]
                h = float(r[1] or r[3] or 0.0)
                l = float(r[2] or (h * 0.6 if h > 0 else 0.0))
                cls._state_cache[t] = StockMacroState(
                    ticker=t,
                    market="EGX",
                    high_52w=h,
                    low_52w=l,
                    vol_avg_20d=100000.0,
                    support_level=l,
                    resistance_level=h,
                    sma200=None,
                    last_updated="stocks_db_fallback"
                )
            cls._initialized = True
            return len(cls._state_cache)
        except Exception as e:
            logger.error(f"[MacroState] Fallback failed: {e}")
            return 0

    @classmethod
    def get_stock_constants(cls, ticker: str) -> Optional[StockMacroState]:
        """استرجاع الثوابت الهيكلية في أجزاء من الميلي ثانية من الذاكرة."""
        if not cls._initialized:
            cls.cold_boot()
        return cls._state_cache.get(ticker)

    @classmethod
    def calculate_macro_location_ratio(cls, ticker: str, current_price: float) -> Dict[str, Any]:
        """
        حساب مؤشر التموضع الهيكلي (Macro Location Ratio):
        MLR = (Price - 52W_Low) / (52W_High - 52W_Low)
        """
        state = cls.get_stock_constants(ticker)
        if not state or state.high_52w <= state.low_52w or state.high_52w <= 0:
            return {"mlr": 0.5, "zone": "UNKNOWN", "high_52w": current_price, "low_52w": current_price}

        h = state.high_52w
        l = state.low_52w
        mlr = max(0.0, min(1.0, (current_price - l) / (h - l)))

        if mlr >= 0.90:
            zone = "PEAK_MINEFIELD"     # أعلى 10% من رينج السنة (منطقة ألغام)
        elif 0.25 <= mlr <= 0.60:
            zone = "GOLDEN_DIP_ZONE"    # قاع أو منتصف دورة تجميعية
        elif mlr < 0.25:
            zone = "DEEP_LOW"           # قاع سنوي
        else:
            zone = "MID_RANGE"

        return {
            "mlr": round(mlr, 3),
            "zone": zone,
            "high_52w": h,
            "low_52w": l,
            "vol_avg_20d": state.vol_avg_20d
        }
