#!/usr/bin/env python3
"""
Crypto 24/7 Live Lab Scheduler — P23-CRYPTO-LAB-FUSION
========================================================
مختبر العملات الرقمية الحي (24/7 Live Lab).

الهدف:
  - يحلل BTC + ETH كل 15 دقيقة على مدار الساعة (24/7) — مش gated بجلسة EGX.
  - يستخدم نفس منطق LiveIndicatorEngine (محرك التحديث اللحظي) + FusionEngineV20
    (محرك الاندماج V20 — LuxAlgo + BigBeluga + SMC).
  - يسجّل كل توقع في جدول `crypto_predictions_log` داخل `/home/z/my-project/db/predictions.db`.

المصادر:
  1. CoinGecko API (أساسي) — OHLC + 24h volume + current price عبر `CryptoDataFetcher`.
  2. data_engine.db.crypto_prices (احتياطي) — لو CoinGecko rate-limited أو غير متاح.

التكامل:
  - ممكن يشتغل standalone (thread مع time.sleep).
  - ممكن يتسجّل في SchedulerManager المركزي (APScheduler) عبر `register_interval`.
  - ممكن يتندّى من MarketScheduler.tick() عبر method `run_crypto_lab()`.

Error Handling:
  - لو البيانات مش متاحة (CoinGecko rate-limited + DB فاضي) → WARNING + skip.
  - لو الـ fusion engine فشل → WARNING + skip.
  - أي خطأ بيتسجّل في الـ logger من غير ما يوقع الـ scheduler.

Author: M2y Platform — P23-CRYPTO-LAB-FUSION
"""
from __future__ import annotations

import os
import sys
import json
import time
import sqlite3
import logging
import threading
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

# Ensure vps-service is on sys.path (so `from analyzers...` works even when
# the module is imported from outside the vps-service directory).
_VPS_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _VPS_ROOT not in sys.path:
    sys.path.insert(0, _VPS_ROOT)

logger = logging.getLogger(__name__)

# ── Database paths ────────────────────────────────────────────────────────
_PROJECT_ROOT = Path(_VPS_ROOT).parent
PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')
DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')

# ── Default coins (fallback only) ─────────────────────────────────────────
# Used when both data_engine.db and CoinGecko discovery fail. The scheduler
# normally iterates over the dynamic list returned by get_crypto_lab_coins().
CRYPTO_LAB_COINS: Dict[str, str] = {
    'bitcoin': 'BTC',
    'ethereum': 'ETH',
}

# ── Schedule cadence ──────────────────────────────────────────────────────
# V40.4 §4.2: المجدول اللحظي المستمر — كل 5 دقائق على مدار الساعة (24/7)
CRYPTO_LAB_INTERVAL_SECONDS = 5 * 60  # كل 5 دقائق (24/7 Event-Driven)

# ── V40.4 §4.2: 24/7 Execution parameters ──────────────────────────────────
# معاملات التتبع اللحيني وإدارة المخاطر لصفقات الكريبتو المفتوحة
CRYPTO_HARD_LOSS_CEILING_PCT = -10.0   # سقف الخسارة الصارم (حزام أمان)
CRYPTO_PARTIAL_EXIT_R = 1.8            # الخروج الجزئي عند 1.8R
CRYPTO_PARTIAL_EXIT_PCT = 0.50         # 50% من المركز عند الخروج الجزئي
CRYPTO_TRAILING_ATR_MULT = 2.0         # Trailing Stop = Highest - 2.0 * ATR
CRYPTO_BREAKEVEN_AFTER_PARTIAL = True  # رفع الوقف لنقطة الدخول بعد الهدف الأول

# ── Mass-scale coin discovery (MASS-SCALE) ────────────────────────────────
# Instead of hardcoding BTC+ETH only, we now discover ALL available coins:
#   1. Primary: CoinGecko /coins/markets top 50 (by market cap) — gives both
#      `coin_id` (e.g. 'bitcoin') and `symbol` (e.g. 'BTC').
#   2. Fallback: read distinct symbols from data_engine.db.crypto_prices (if the
#      table exists and has data) and reverse-map to coin_ids via a known map.
#   3. Last resort: the hardcoded CRYPTO_LAB_COINS (BTC + ETH).
# The result is cached for COINS_CACHE_TTL_SECONDS to avoid re-fetching every
# 15-minute cycle.
COINS_CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours
_COINS_CACHE: Optional[Dict[str, Dict[str, Any]]] = None  # {coin_id: {'symbol','name'}}
_COINS_CACHE_AT: float = 0.0

# Known symbol → CoinGecko coin_id mappings (used when discovering from
# data_engine.db which only stores symbols like 'BTC', not coin_ids).
_SYMBOL_TO_COINGECKO_ID: Dict[str, str] = {
    'BTC': 'bitcoin', 'ETH': 'ethereum', 'BNB': 'binancecoin',
    'SOL': 'solana', 'XRP': 'ripple', 'ADA': 'cardano',
    'DOGE': 'dogecoin', 'AVAX': 'avalanche-2', 'DOT': 'polkadot',
    'MATIC': 'matic-network', 'TRX': 'tron', 'LINK': 'chainlink',
    'LTC': 'litecoin', 'BCH': 'bitcoin-cash', 'UNI': 'uniswap',
    'ATOM': 'cosmos', 'XLM': 'stellar', 'ETC': 'ethereum-classic',
    'FIL': 'filecoin', 'HBAR': 'hedera-hashgraph', 'NEAR': 'near',
    'APT': 'aptos', 'ARB': 'arbitrum', 'OP': 'optimism',
    'VEGA': 'vega-protocol', 'INJ': 'injective-protocol',
    'SUI': 'sui', 'SEI': 'sei-network', 'TIA': 'celestia',
    'RUNE': 'thorchain', 'AAVE': 'aave', 'GRT': 'the-graph',
}


def _fetch_coingecko_top_coins(per_page: int = 50) -> Dict[str, Dict[str, Any]]:
    """يجيب top N عملة من CoinGecko حسب الـ market cap.

    Returns:
        {coin_id: {'symbol': 'BTC', 'name': 'Bitcoin'}, ...}
    """
    url = (f"https://api.coingecko.com/api/v3/coins/markets"
           f"?vs_currency=usd&order=market_cap_desc&per_page={per_page}&page=1&sparkline=false")
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'M2y-CryptoLab/1.0',
            'Accept': 'application/json',
        })
        with urllib.request.urlopen(req, timeout=20) as response:
            data = json.loads(response.read().decode())
        if not isinstance(data, list):
            return {}
        coins: Dict[str, Dict[str, Any]] = {}
        for item in data:
            coin_id = (item.get('id') or '').strip()
            symbol = (item.get('symbol') or '').strip().upper()
            name = item.get('name') or coin_id
            if coin_id and symbol:
                coins[coin_id] = {'symbol': symbol, 'name': name}
        return coins
    except Exception as e:
        logger.warning(f"[CryptoLab] CoinGecko top-coins fetch failed: {e}")
        return {}


def _discover_coins_from_data_engine(data_engine_db: str) -> Dict[str, Dict[str, Any]]:
    """يقرأ العملات المتاحة من data_engine.db.crypto_prices (إذا موجود).

    الـ data_engine.db بيخزّن symbols بس (BTC, ETH) مش coin_ids، فعشان كده
    بنستخدم خريطة معروفة لتحويل symbol → coin_id. أي symbol مش معروف بيتساب.

    Returns:
        {coin_id: {'symbol': 'BTC', 'name': 'BTC'}, ...}
    """
    if not data_engine_db or not os.path.exists(data_engine_db):
        return {}
    try:
        try:
            from core.db_manager import db_manager
            conn = db_manager.connection('data_engine', writable=False).__enter__()
        except Exception:
            conn = sqlite3.connect(data_engine_db, timeout=10)
        cur = conn.cursor()
        # تحقق من وجود جدول crypto_prices
        row = cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='crypto_prices'"
        ).fetchone()
        if not row:
            conn.close()
            return {}
        # اقرأ الـ symbols المختلفة
        try:
            syms = [r[0] for r in cur.execute(
                'SELECT DISTINCT UPPER(symbol) FROM crypto_prices WHERE symbol IS NOT NULL'
            ).fetchall()]
        except sqlite3.OperationalError:
            conn.close()
            return {}
        conn.close()

        coins: Dict[str, Dict[str, Any]] = {}
        for sym in syms:
            if not sym:
                continue
            coin_id = _SYMBOL_TO_COINGECKO_ID.get(sym) or sym.lower()
            coins[coin_id] = {'symbol': sym, 'name': sym}
        return coins
    except Exception as e:
        logger.warning(f"[CryptoLab] data_engine.db coin discovery failed: {e}")
        return {}


def get_crypto_lab_coins(force_refresh: bool = False,
                         data_engine_db: Optional[str] = None,
                         max_coins: int = 50) -> Dict[str, str]:
    """يرجّع خريطة العملات المتاحة للتحليل (coin_id → symbol).

    Mass-scale discovery: بدل ما نحلل BTC+ETH بس، نكتشف كل العملات المتاحة:
      1. نجرّب data_engine.db.crypto_prices (الإنتاج فيه الداتا دي).
      2. لو فاضي/مش موجود، نسحب top 50 من CoinGecko.
      3. لو الاتنين فشلوا، نرجّع الـ default (BTC+ETH).

    النتيجة بتتعمل ليها cache لـ 6 ساعات عشان ما نعيدش الاكتشاف كل 15 دقيقة.

    Args:
        force_refresh: تجاهل الـ cache وسحب جديد
        data_engine_db: مسار data_engine.db (default: DATA_ENGINE_DB)
        max_coins: أقصى عدد عملات (default 50)

    Returns:
        {coin_id: symbol, ...}  e.g. {'bitcoin': 'BTC', 'ethereum': 'ETH', ...}
    """
    global _COINS_CACHE, _COINS_CACHE_AT
    import time as _time
    now = _time.time()
    if (not force_refresh and _COINS_CACHE is not None
            and (now - _COINS_CACHE_AT) < COINS_CACHE_TTL_SECONDS):
        return {cid: info['symbol'] for cid, info in _COINS_CACHE.items()}

    db_path = data_engine_db or DATA_ENGINE_DB

    # 1. جرّب data_engine.db أولاً
    discovered = _discover_coins_from_data_engine(db_path)

    # 2. لو فاضي، اسحب من CoinGecko top 50
    if not discovered:
        logger.info("[CryptoLab] No coins in data_engine.db — fetching CoinGecko top 50")
        discovered = _fetch_coingecko_top_coins(per_page=max_coins)

    # 3. لو برضه فاضي، ارجع للـ default
    if not discovered:
        logger.warning("[CryptoLab] Coin discovery failed — falling back to BTC+ETH")
        return dict(CRYPTO_LAB_COINS)

    # قصّ لأقصى عدد عملات
    if len(discovered) > max_coins:
        items = list(discovered.items())[:max_coins]
        discovered = dict(items)

    # حدّث الـ cache
    _COINS_CACHE = discovered
    _COINS_CACHE_AT = now
    logger.info(f"[CryptoLab] Discovered {len(discovered)} coins for mass-scale analysis")
    return {cid: info['symbol'] for cid, info in discovered.items()}

# ── Decision thresholds (mirror LiveIndicatorEngine's BUY/HOLD thresholds) ─
BUY_THRESHOLD = 68
HOLD_THRESHOLD = 45


# ============================================================================
# Crypto Lab Scheduler
# ============================================================================

class CryptoLabScheduler:
    """مختبر العملات الرقمية الحي — يحلل BTC + ETH كل 15 دقيقة (24/7).

    الاستخدام:
        scheduler = CryptoLabScheduler()
        scheduler.run_once()              # تحليل واحد فوري
        scheduler.start()                 # جدولة مستمرة (thread أو APScheduler)
        scheduler.stop()                  # إيقاف
    """

    def __init__(self, predictions_db: str = PREDICTIONS_DB,
                 data_engine_db: str = DATA_ENGINE_DB):
        self.predictions_db = predictions_db
        self.data_engine_db = data_engine_db
        self.running = False
        self._thread: Optional[threading.Thread] = None
        self.last_run: Optional[datetime] = None
        self.last_results: Dict[str, Dict[str, Any]] = {}  # symbol → last prediction
        self.last_error: Optional[str] = None

        # Lazy-loaded engines (deferred import so the module is importable
        # even if pandas/numpy aren't installed — the actual analysis just
        # degrades gracefully).
        self._fusion_engine_cls = None
        self._smc_calculate = None
        self._load_engines()

        # Ensure the predictions log table exists (idempotent — table already
        # exists per the task spec, but we double-check so the scheduler is
        # self-contained).
        self._ensure_predictions_table()

    # ------------------------------------------------------------------
    # Lazy engine loading
    # ------------------------------------------------------------------
    def _load_engines(self) -> None:
        """Load FusionEngineV20 + calculate_smc_score (deferred imports)."""
        try:
            from analyzers.fusion_engine import FusionEngineV20
            self._fusion_engine_cls = FusionEngineV20
            logger.info("[CryptoLab] FusionEngineV20 loaded")
        except Exception as e:
            logger.warning(f"[CryptoLab] FusionEngineV20 not available: {e}")
            self._fusion_engine_cls = None

        try:
            from analyzers.smc_engine import calculate_smc_score
            self._smc_calculate = calculate_smc_score
            logger.info("[CryptoLab] calculate_smc_score loaded")
        except Exception as e:
            logger.warning(f"[CryptoLab] calculate_smc_score not available: {e}")
            self._smc_calculate = None

    # ------------------------------------------------------------------
    # Database setup
    # ------------------------------------------------------------------
    def _ensure_predictions_table(self) -> None:
        """تأكد إن جدول `crypto_predictions_log` موجود (idempotent).

        V40.4 §4.2: يضيف أعمدة تتبع المراكز المفتوحة (status, exit_price,
        highest_price, actual_return, exited_at, remaining_pct) لو مش موجودة.
        """
        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('predictions', writable=True).__enter__()
            except Exception:
                conn = sqlite3.connect(self.predictions_db, timeout=30)
            conn.execute('PRAGMA busy_timeout = 30000')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS crypto_predictions_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT NOT NULL,
                    signal TEXT,
                    confidence REAL DEFAULT 0,
                    entry_price REAL,
                    target_price REAL,
                    stop_loss REAL,
                    analysis_json TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            ''')
            # Index لتسريع الاستعلامات الزمنية
            conn.execute('''
                CREATE INDEX IF NOT EXISTS idx_crypto_pred_symbol_time
                ON crypto_predictions_log(symbol, created_at)
            ''')

            # V40.4 §4.2: أعمدة تتبع المراكز المفتوحة + الإغلاق اللحيني
            # (ALTER TABLE ADD COLUMN is idempotent-safe via PRAGMA check)
            existing_cols = {
                row[1] for row in conn.execute("PRAGMA table_info(crypto_predictions_log)").fetchall()
            }
            v404_columns = [
                ('status',         "TEXT DEFAULT 'open'"),      # open / partial / closed
                ('exit_price',     'REAL'),
                ('exit_type',      'TEXT'),                     # target/stop/breakeven/hard_loss/trailing/partial_target
                ('highest_price',  'REAL'),                     # أعلى سعر وصل له الأصل
                ('actual_return',  'REAL'),                     # العائد الفعلي %
                ('exited_at',      'TEXT'),
                ('remaining_pct',  'REAL DEFAULT 1.0'),         # 1.0=full, 0.5=half exited
            ]
            for col_name, col_def in v404_columns:
                if col_name not in existing_cols:
                    conn.execute(f'ALTER TABLE crypto_predictions_log ADD COLUMN {col_name} {col_def}')
                    logger.info(f"[CryptoLab] Added column {col_name} to crypto_predictions_log")

            # Index لتسريع استعلام المراكز المفتوحة
            conn.execute('''
                CREATE INDEX IF NOT EXISTS idx_crypto_pred_status
                ON crypto_predictions_log(status)
            ''')
            conn.commit()
            conn.close()
            logger.debug(f"[CryptoLab] crypto_predictions_log table ensured in {self.predictions_db}")
        except Exception as e:
            logger.error(f"[CryptoLab] Failed to ensure crypto_predictions_log table: {e}")
            self.last_error = f"table_setup: {e}"

    # ------------------------------------------------------------------
    # Data fetching (CoinGecko primary, data_engine.db fallback)
    # ------------------------------------------------------------------
    def fetch_crypto_ohlcv(self, coin_id: str, days: int = 30) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        يجيب OHLCV للعملة من CoinGecko + معلومات السوق الحالية.

        Args:
            coin_id: 'bitcoin' أو 'ethereum' (CoinGecko coin_id)
            days: عدد الأيام (default 30 — يرجع ~180 شمعة 4h)

        Returns:
            (ohlcv, market_info)
            - ohlcv: list of {'open','high','low','close','volume','date'}
            - market_info: {'current_price', 'volume_24h', 'change_24h_pct', 'high_24h', 'low_24h', 'market_cap'}
        """
        ohlcv: List[Dict[str, Any]] = []
        market_info: Dict[str, Any] = {
            'current_price': 0.0, 'volume_24h': 0.0, 'change_24h_pct': 0.0,
            'high_24h': 0.0, 'low_24h': 0.0, 'market_cap': 0.0, 'name': '', 'source': '',
        }

        # ── 1. CoinGecko /markets endpoint — current price + 24h data ──
        markets_data = self._coingecko_get(
            f"https://api.coingecko.com/api/v3/coins/markets"
            f"?vs_currency=usd&ids={coin_id}&sparkline=false"
        )
        if markets_data and isinstance(markets_data, list) and len(markets_data) > 0:
            item = markets_data[0]
            market_info['current_price'] = float(item.get('current_price') or 0)
            market_info['volume_24h'] = float(item.get('total_volume') or 0)
            market_info['change_24h_pct'] = float(item.get('price_change_percentage_24h') or 0)
            market_info['high_24h'] = float(item.get('high_24h') or 0)
            market_info['low_24h'] = float(item.get('low_24h') or 0)
            market_info['market_cap'] = float(item.get('market_cap') or 0)
            market_info['name'] = item.get('name') or coin_id
            market_info['source'] = 'coingecko'

        # ── 2. CoinGecko /ohlc endpoint — historical OHLC (4h candles) ──
        ohlc_data = self._coingecko_get(
            f"https://api.coingecko.com/api/v3/coins/{coin_id}/ohlc"
            f"?vs_currency=usd&days={days}"
        )
        if ohlc_data and isinstance(ohlc_data, list) and len(ohlc_data) > 0:
            # OHLC endpoint returns [timestamp_ms, open, high, low, close] — no volume.
            # We synthesize volume by distributing 24h_volume uniformly across the
            # ~6 candles that make up a 24h window (4h candles).
            vol_per_candle = market_info['volume_24h'] / 6.0 if market_info['volume_24h'] > 0 else 0.0
            for entry in ohlc_data:
                try:
                    ts_ms = int(entry[0])
                    o = float(entry[1])
                    h = float(entry[2])
                    l = float(entry[3])
                    c = float(entry[4])
                    if h <= 0 or l <= 0 or c <= 0:
                        continue
                    ohlcv.append({
                        'date': datetime.utcfromtimestamp(ts_ms / 1000.0).isoformat(),
                        'open': o, 'high': h, 'low': l, 'close': c,
                        'volume': vol_per_candle,  # synthetic uniform distribution
                    })
                except (IndexError, ValueError, TypeError):
                    continue

        # ── 3. Fallback: data_engine.db.crypto_prices لو CoinGecko فشل ──
        if not ohlcv or market_info['current_price'] <= 0:
            db_price, db_change, db_volume = self._fetch_from_data_engine_db(coin_id)
            if db_price > 0:
                if market_info['current_price'] <= 0:
                    market_info['current_price'] = db_price
                    market_info['change_24h_pct'] = db_change
                    market_info['volume_24h'] = db_volume
                    market_info['source'] = 'data_engine_db'
                # لو مفيش OHLC history من CoinGecko، ننشئ شمعة وهمية واحدة من السعر الحالي
                # (الـ fusion engine مش هيقدر يحسب indicators كويس بس الـ score هيطلع)
                if not ohlcv:
                    ohlcv.append({
                        'date': datetime.utcnow().isoformat(),
                        'open': db_price, 'high': db_price,
                        'low': db_price, 'close': db_price,
                        'volume': db_volume / 6.0 if db_volume > 0 else 0.0,
                    })

        return ohlcv, market_info

    def _coingecko_get(self, url: str) -> Any:
        """يجيب JSON من CoinGecko API مع retry بسيط على 429 (rate limit)."""
        for attempt in range(2):
            try:
                req = urllib.request.Request(url, headers={
                    'User-Agent': 'M2y-CryptoLab/1.0',
                    'Accept': 'application/json',
                })
                with urllib.request.urlopen(req, timeout=20) as response:
                    return json.loads(response.read().decode())
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt == 0:
                    # Rate limited — wait 60s and retry once
                    logger.warning("[CryptoLab] CoinGecko rate-limited (429) — waiting 60s before retry")
                    time.sleep(60)
                    continue
                logger.warning(f"[CryptoLab] CoinGecko HTTPError {e.code} for {url}")
                return None
            except Exception as e:
                logger.warning(f"[CryptoLab] CoinGecko fetch failed for {url}: {e}")
                return None
        return None

    def _fetch_from_data_engine_db(self, coin_id: str) -> Tuple[float, float, float]:
        """احتياطي: اقرأ آخر سعر من data_engine.db.crypto_prices.

        Args:
            coin_id: CoinGecko coin_id (e.g. 'bitcoin')

        Returns:
            (price, change_percent, volume_24h)
        """
        # Mass-scale: نستخدم الـ dynamic coins map بدل الـ hardcoded BTC/ETH.
        # لو الـ coin_id مش في الخريطة، نبحث في الـ known reverse-map.
        coins_map = get_crypto_lab_coins()
        symbol = coins_map.get(coin_id)
        if not symbol:
            # reverse-lookup: إيه الـ symbol اللي بيرجع للـ coin_id ده؟
            for sym, cid in _SYMBOL_TO_COINGECKO_ID.items():
                if cid == coin_id:
                    symbol = sym
                    break
        if not symbol:
            symbol = coin_id.upper()
        try:
            if not os.path.exists(self.data_engine_db):
                return 0.0, 0.0, 0.0
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('data_engine', writable=False).__enter__()
            except Exception:
                conn = sqlite3.connect(self.data_engine_db, timeout=30)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            # الـ schema ممكن يختلف بين production (symbol/price_usd/total_volume)
            # و sandbox (symbol/price/volume as TEXT). بنجرب الأعمدة بشكل آمن.
            try:
                row = cur.execute('''
                    SELECT symbol, price, change_percent, volume, timestamp
                    FROM crypto_prices
                    WHERE UPPER(symbol) = ?
                    ORDER BY id DESC LIMIT 1
                ''', (symbol,)).fetchone()
            except sqlite3.OperationalError:
                # maybe schema has price_usd/total_volume columns
                try:
                    row = cur.execute('''
                        SELECT symbol, price_usd as price, price_change_24h as change_percent,
                               total_volume as volume, timestamp
                        FROM crypto_prices
                        WHERE UPPER(symbol) = ?
                        ORDER BY id DESC LIMIT 1
                    ''', (symbol,)).fetchone()
                except sqlite3.OperationalError:
                    row = None

            conn.close()
            if row:
                price = float(row['price'] or 0)
                change = float(row['change_percent'] or 0)
                # volume ممكن يكون TEXT زي "1.2M" — نستخدم نفس parser الـ LiveIndicatorEngine
                vol = self._parse_volume(row['volume'])
                return price, change, vol
        except Exception as e:
            logger.warning(f"[CryptoLab] data_engine.db fallback failed for {coin_id}: {e}")
        return 0.0, 0.0, 0.0

    @staticmethod
    def _parse_volume(v) -> float:
        """يحوّل volume بأمان (int, float, أو نص مثل '2.28M' → 2280000)."""
        if v is None:
            return 0.0
        try:
            return float(v)
        except (ValueError, TypeError):
            pass
        try:
            s = str(v).strip().replace('\u202f', '').replace(' ', '').replace(',', '')
            if s.endswith('M'):
                return float(s[:-1]) * 1_000_000
            elif s.endswith('K'):
                return float(s[:-1]) * 1_000
            elif s.endswith('B'):
                return float(s[:-1]) * 1_000_000_000
            return float(s)
        except (ValueError, TypeError):
            return 0.0

    # ------------------------------------------------------------------
    # Indicator calculation (lightweight, no pandas dependency)
    # ------------------------------------------------------------------
    @staticmethod
    def _sma(values: List[float], period: int) -> Optional[float]:
        """Simple Moving Average."""
        if len(values) < period:
            return None
        return sum(values[-period:]) / period

    @staticmethod
    def _ema(values: List[float], period: int) -> List[float]:
        """Exponential Moving Average (SMA-seeded)."""
        if len(values) < period:
            return []
        mult = 2.0 / (period + 1)
        ema: List[float] = []
        # seed with SMA of first `period` values
        sma_seed = sum(values[:period]) / period
        ema.append(sma_seed)
        for v in values[period:]:
            ema.append((v - ema[-1]) * mult + ema[-1])
        return ema

    @classmethod
    def _calc_macd(cls, closes: List[float]) -> Tuple[Optional[float], Optional[float], Optional[float]]:
        """(macd_line, signal_line, histogram) — last values only."""
        if len(closes) < 35:  # need 26 for slow EMA + 9 for signal
            return None, None, None
        ema_fast = cls._ema(closes, 12)
        ema_slow = cls._ema(closes, 26)
        # Align: ema_slow starts at index 25, ema_fast at index 11.
        # We need the overlapping tail (same length).
        n = min(len(ema_fast), len(ema_slow))
        macd_line_arr = [ema_fast[-n + i] - ema_slow[-n + i] for i in range(n)]
        if len(macd_line_arr) < 9:
            return None, None, None
        signal_arr = cls._ema(macd_line_arr, 9)
        if not signal_arr:
            return None, None, None
        macd_line = macd_line_arr[-1]
        signal_line = signal_arr[-1]
        hist = macd_line - signal_line
        return macd_line, signal_line, hist

    @staticmethod
    def _calc_rsi(closes: List[float], period: int = 14) -> Optional[float]:
        """Wilder's RSI."""
        if len(closes) < period + 1:
            return None
        gains = []
        losses = []
        for i in range(-period, 0):
            chg = closes[i] - closes[i - 1]
            gains.append(max(0.0, chg))
            losses.append(max(0.0, -chg))
        avg_gain = sum(gains) / period
        avg_loss = sum(losses) / period
        if avg_loss == 0:
            return 100.0 if avg_gain > 0 else 50.0
        rs = avg_gain / avg_loss
        return 100.0 - (100.0 / (1.0 + rs))

    @staticmethod
    def _calc_bollinger(closes: List[float], period: int = 20) -> Tuple[Optional[float], Optional[float], Optional[float]]:
        """(middle, upper, lower) — Bollinger Bands (SMA ± 2*stddev)."""
        if len(closes) < period:
            return None, None, None
        window = closes[-period:]
        mean = sum(window) / period
        var = sum((x - mean) ** 2 for x in window) / period
        std = var ** 0.5
        return mean, mean + 2 * std, mean - 2 * std

    @staticmethod
    def _calc_atr(ohlcv: List[Dict[str, Any]], period: int = 14) -> Optional[float]:
        """Average True Range."""
        if len(ohlcv) < period + 1:
            return None
        trs = []
        for i in range(-period, 0):
            h = float(ohlcv[i]['high'])
            l = float(ohlcv[i]['low'])
            prev_c = float(ohlcv[i - 1]['close'])
            tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
            trs.append(tr)
        return sum(trs) / period

    @staticmethod
    def _calc_volume_ratio(ohlcv: List[Dict[str, Any]], period: int = 20) -> float:
        """Volume ratio: latest candle volume / avg of last `period` candles."""
        if len(ohlcv) < period + 1:
            return 1.0
        recent_vols = [float(c['volume']) for c in ohlcv[-period - 1:-1]]
        avg = sum(recent_vols) / period if recent_vols and sum(recent_vols) > 0 else 0
        if avg <= 0:
            return 1.0
        return float(ohlcv[-1]['volume']) / avg

    # ------------------------------------------------------------------
    # Core analysis
    # ------------------------------------------------------------------
    def analyze_coin(self, coin_id: str, symbol: str) -> Optional[Dict[str, Any]]:
        """يحلل عملة واحدة ويرجع التوقع الكامل.

        Fetches live OHLCV (30 days) then delegates to analyze_ohlcv.
        Returns None if data is unavailable.
        """
        # 1. Fetch live data
        ohlcv, market_info = self.fetch_crypto_ohlcv(coin_id, days=30)
        if not ohlcv or market_info.get('current_price', 0) <= 0:
            logger.warning(f"[CryptoLab] No data for {symbol} ({coin_id}) — skipping")
            return None
        # 2. Delegate to the analysis core (shared with the backtester)
        return self.analyze_ohlcv(coin_id, symbol, ohlcv, market_info)

    def analyze_ohlcv(self, coin_id: str, symbol: str,
                      ohlcv: List[Dict[str, Any]],
                      market_info: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """يشغّل المحرك (FusionEngineV20 + SMC) على ohlcv جاهز.

        هذه هي "نواة التحليل" — لا تجلب الداتا بنفسها، بل تقبل ohlcv + market_info
        جاهزين. هذا يسمح للـ backtester بإعادة استخدام نفس المحرك على بيانات
        تاريخية مقسومة (truncated) دون تكرار الكود.

        Args:
            coin_id: CoinGecko coin_id (e.g. 'bitcoin') — for metadata only
            symbol:  Display symbol (e.g. 'BTC')
            ohlcv:   List of {'date','open','high','low','close','volume'} dicts
            market_info: Dict with at least 'current_price' + 'source'

        Returns:
            Same shape as analyze_coin, or None if ohlcv is empty.
        """
        if not ohlcv or market_info.get('current_price', 0) <= 0:
            return None

        closes = [float(c['close']) for c in ohlcv]
        current_price = float(market_info['current_price'])

        # 2. Compute indicators (lightweight, no pandas)
        rsi = self._calc_rsi(closes, period=14) or 50.0
        sma20 = self._sma(closes, 20) or current_price
        sma50 = self._sma(closes, 50) or current_price
        sma200 = self._sma(closes, 200) if len(closes) >= 200 else current_price
        macd_line, macd_signal, macd_hist = self._calc_macd(closes)
        bb_mid, bb_upper, bb_lower = self._calc_bollinger(closes, period=20)
        atr = self._calc_atr(ohlcv, period=14) or (current_price * 0.02)  # fallback: 2% of price
        vol_ratio = self._calc_volume_ratio(ohlcv, period=20)
        avg_volume_20d = sum(float(c['volume']) for c in ohlcv[-20:]) / min(20, len(ohlcv))

        # 3. Determine trend_up (price above SMA50 + SMA20 above SMA50)
        trend_up = bool(current_price > sma50 and sma20 > sma50)

        # 4. Run SMC engine (Order Blocks + FVG + Sweeps)
        smc_data: Dict[str, Any] = {}
        smc_score = 50.0
        smc_detail = 'SMC غير متاح'
        if self._smc_calculate is not None and len(ohlcv) >= 20:
            try:
                smc_result = self._smc_calculate(
                    ohlcv=ohlcv,
                    current_price=current_price,
                    volume_ratio=vol_ratio,
                    rsi=rsi,
                    sma200=float(sma200 or 0),
                )
                smc_score = float(smc_result.get('score', 50))
                # Extract the key signals fusion engine needs
                order_blocks = smc_result.get('order_blocks', [])
                sweeps = smc_result.get('sweeps', [])
                fvgs = smc_result.get('fvgs', [])

                # broke_resist: any bullish OB recently broken OR price made a BOS up
                broke_resist = any(
                    ob.get('type') == 'bullish_ob' and current_price > float(ob.get('top', 0))
                    for ob in order_blocks[-3:]
                )
                # sweep_low: any recent bullish liquidity sweep (price wicked below a level then recovered)
                sweep_low = any(
                    s.get('type') == 'bullish_sweep' or s.get('direction') == 'bullish'
                    for s in sweeps[-3:]
                )
                # active_ob_low: lowest low of the most recent bullish OB
                active_ob_low = 0.0
                for ob in reversed(order_blocks):
                    if ob.get('type') == 'bullish_ob':
                        active_ob_low = float(ob.get('bottom', 0))
                        break

                smc_data = {
                    'broke_resist': broke_resist,
                    'sweep_low': sweep_low,
                    'active_ob_low': active_ob_low,
                    'order_blocks_count': len(order_blocks),
                    'fvgs_count': len(fvgs),
                    'sweeps_count': len(sweeps),
                }
                smc_detail = (
                    f"SMC {smc_score:.0f}/100 "
                    f"(OBs={len(order_blocks)}, FVGs={len(fvgs)}, Sweeps={len(sweeps)})"
                )
            except Exception as e:
                logger.warning(f"[CryptoLab] SMC engine failed for {symbol}: {e}")
                smc_detail = f"SMC Error: {e}"

        # 5. Run Fusion Engine V20 (LuxAlgo + BigBeluga + SMC)
        fusion_score = 50.0
        fusion_signal_en = 'WAIT'
        fusion_signal_ar = 'انتظار'
        risk: Dict[str, Any] = {}
        bb_data: Dict[str, Any] = {}
        fair_value = current_price
        fair_premium = 0.0

        if self._fusion_engine_cls is not None:
            try:
                fusion = self._fusion_engine_cls(ohlcv)
                fusion_score, bb_data, fair_value, fair_premium, risk = fusion.calculate_fusion_score(
                    smc_data=smc_data,
                    rsi=rsi,
                    vol_ratio=vol_ratio,
                    trend_up=trend_up,
                    atr_val=atr,
                    current_price=current_price,
                )
                fusion_signal_en, fusion_signal_ar = self._fusion_engine_cls.score_to_signal(fusion_score)
            except Exception as e:
                logger.warning(f"[CryptoLab] Fusion engine failed for {symbol}: {e}")
                # Fallback: simple score from RSI + trend
                fusion_score = 50.0
                if trend_up:
                    fusion_score += 15
                if 50 < rsi < 70:
                    fusion_score += 10
                if vol_ratio > 1.3:
                    fusion_score += 10
                fusion_score = max(0.0, min(100.0, fusion_score))
                fusion_signal_en, fusion_signal_ar = 'WAIT', 'انتظار'
                risk = {}

        # 6. Combine SMC + Fusion into final score (60% SMC, 40% Fusion — same as master_analyzer)
        # الـ master_analyzer بيعمل master_score = master_score * 0.40 + smc_score * 0.60
        # بنطبق نفس المنطق هنا.
        final_score = fusion_score * 0.40 + smc_score * 0.60
        final_score = max(0.0, min(100.0, final_score))

        # 7. Map to signal (mirror LiveIndicatorEngine thresholds for consistency)
        if final_score >= BUY_THRESHOLD:
            signal = 'BUY'
            signal_ar = 'فرصة شراء ✅'
        elif final_score >= HOLD_THRESHOLD:
            signal = 'HOLD'
            signal_ar = 'إشارة إيجابية 📈'
        else:
            signal = 'SELL'
            signal_ar = 'إشارة سلبية ⚠️'

        # Override signal for SHORT direction from fusion risk (if SMC shows distribution)
        direction = risk.get('direction', 'LONG') if risk else 'LONG'
        if direction == 'SHORT' and final_score < HOLD_THRESHOLD:
            signal = 'SELL'
            signal_ar = 'فرصة بيع ⚠️'

        # 8. Confidence: scaled score (higher score = higher confidence)
        confidence = round(min(100.0, max(0.0, final_score)), 2)

        # 9. Entry / Target / Stop Loss (from fusion risk profile)
        entry_price = float(risk.get('entry', current_price) or current_price)
        target_price = float(risk.get('tp1', current_price * 1.05) or current_price * 1.05)
        stop_loss = float(risk.get('sl', current_price * 0.95) or current_price * 0.95)

        # 10. Build analysis_json (detailed snapshot for debugging / future AI commentary)
        analysis = {
            'symbol': symbol,
            'coin_id': coin_id,
            'name': market_info.get('name', ''),
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'source': market_info.get('source', 'unknown'),
            'current_price': round(current_price, 4),
            'change_24h_pct': round(market_info.get('change_24h_pct', 0), 2),
            'volume_24h': market_info.get('volume_24h', 0),
            'market_cap': market_info.get('market_cap', 0),
            'high_24h': market_info.get('high_24h', 0),
            'low_24h': market_info.get('low_24h', 0),
            'candles_analyzed': len(ohlcv),
            'indicators': {
                'rsi': round(rsi, 2),
                'macd_line': round(macd_line, 6) if macd_line is not None else None,
                'macd_signal': round(macd_signal, 6) if macd_signal is not None else None,
                'macd_hist': round(macd_hist, 6) if macd_hist is not None else None,
                'sma20': round(sma20, 4) if sma20 else None,
                'sma50': round(sma50, 4) if sma50 else None,
                'sma200': round(sma200, 4) if sma200 else None,
                'bb_upper': round(bb_upper, 4) if bb_upper else None,
                'bb_middle': round(bb_mid, 4) if bb_mid else None,
                'bb_lower': round(bb_lower, 4) if bb_lower else None,
                'atr': round(atr, 6) if atr else None,
                'atr_pct': round((atr / current_price * 100), 2) if atr and current_price > 0 else None,
                'vol_ratio': round(vol_ratio, 3),
                'avg_volume_20d': avg_volume_20d,
            },
            'trend_up': trend_up,
            'smc': {
                'score': round(smc_score, 2),
                'detail': smc_detail,
                **smc_data,
            },
            'fusion': {
                'score': round(fusion_score, 2),
                'signal': fusion_signal_en,
                'signal_ar': fusion_signal_ar,
                'fair_value': round(fair_value, 4) if fair_value else None,
                'fair_premium_pct': round(fair_premium, 2) if fair_premium else None,
                'bigbeluga': bb_data,
                'in_golden_pocket': bool(bb_data.get('in_pocket', False)),
            },
            'final_score': round(final_score, 2),
            'final_signal': signal,
            'final_signal_ar': signal_ar,
            'direction': direction,
            'risk': {
                'entry': round(entry_price, 4),
                'tp1': round(target_price, 4),
                'sl': round(stop_loss, 4),
                'tp2': round(float(risk.get('tp2', 0) or 0), 4) if risk else None,
                'risk_amount': round(float(risk.get('risk_amount', 0) or 0), 4) if risk else None,
                'rr_ratio_tp1': round(float(risk.get('rr_ratio_tp1', 0) or 0), 2) if risk else None,
            },
        }

        return {
            'symbol': symbol,
            'signal': signal,
            'signal_ar': signal_ar,
            'confidence': confidence,
            'entry_price': entry_price,
            'target_price': target_price,
            'stop_loss': stop_loss,
            'score': final_score,
            'analysis_json': analysis,
            'timestamp': analysis['timestamp'],
            'source': market_info.get('source', 'unknown'),
        }

    # ------------------------------------------------------------------
    # Logging to DB
    # ------------------------------------------------------------------
    def log_prediction(self, prediction: Dict[str, Any]) -> bool:
        """يسجّل التوقع في جدول `crypto_predictions_log`."""
        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('predictions', writable=True).__enter__()
            except Exception:
                conn = sqlite3.connect(self.predictions_db, timeout=30)
            conn.execute('PRAGMA busy_timeout = 30000')
            cur = conn.cursor()
            cur.execute('''
                INSERT INTO crypto_predictions_log
                    (symbol, signal, confidence, entry_price, target_price,
                     stop_loss, analysis_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                prediction['symbol'],
                prediction['signal'],
                float(prediction.get('confidence', 0)),
                float(prediction.get('entry_price', 0)),
                float(prediction.get('target_price', 0)),
                float(prediction.get('stop_loss', 0)),
                json.dumps(prediction.get('analysis_json', {}), ensure_ascii=False),
                prediction.get('timestamp') or datetime.utcnow().isoformat() + 'Z',
            ))
            conn.commit()
            conn.close()
            logger.info(
                f"[CryptoLab] ✅ Logged {prediction['symbol']}: "
                f"{prediction['signal']} @ ${prediction['entry_price']:.2f} "
                f"(confidence={prediction['confidence']:.0f}%, score={prediction['score']:.1f})"
            )
            return True
        except Exception as e:
            logger.error(f"[CryptoLab] Failed to log prediction for {prediction.get('symbol', '?')}: {e}")
            self.last_error = f"log_prediction: {e}"
            return False

    # ------------------------------------------------------------------
    # V40.4 §4.2: 24/7 Real-time position monitoring + trailing exit
    # ------------------------------------------------------------------
    def _fetch_live_price(self, symbol: str) -> Optional[float]:
        """يجلب السعر اللحيني للعملة من CoinGecko (fallback DB).

        Returns:
            السعر الحالي بالـ USD، أو None لو فشل.
        """
        # Resolve coin_id from the symbol map
        coin_id = _SYMBOL_TO_COINGECKO_ID.get(symbol.upper())
        if not coin_id:
            return None
        url = (f"https://api.coingecko.com/api/v3/coins/markets"
               f"?vs_currency=usd&ids={coin_id}&sparkline=false")
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'M2y-CryptoLab/1.0', 'Accept': 'application/json',
            })
            with urllib.request.urlopen(req, timeout=12) as response:
                data = json.loads(response.read().decode())
            if isinstance(data, list) and data:
                return float(data[0].get('current_price') or 0) or None
        except Exception as exc:
            logger.debug(f"[CryptoLab] live price fetch failed for {symbol}: {exc}")
        return None

    def _fetch_atr(self, symbol: str, period: int = 14) -> float:
        """يحسب ATR تقريبي للعملة من crypto_prices في data_engine.db."""
        try:
            if not os.path.exists(self.data_engine_db):
                return 0.0
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('data_engine', writable=False).__enter__()
            except Exception:
                conn = sqlite3.connect(f'file:{self.data_engine_db}?mode=ro', uri=True, timeout=5)
            rows = conn.execute(
                "SELECT high_24h, low_24h, price_usd FROM crypto_prices "
                "WHERE symbol = ? ORDER BY date DESC LIMIT ?",
                (symbol.upper(), period + 5)
            ).fetchall()
            conn.close()
            if len(rows) < period:
                return 0.0
            trs = []
            prev_close = float(rows[-1][2] or 0)
            for r in reversed(rows[:-1]):
                h, l, c = float(r[0] or 0), float(r[1] or 0), float(r[2] or 0)
                if h > 0 and l > 0 and prev_close > 0:
                    tr = max(h - l, abs(h - prev_close), abs(l - prev_close))
                    trs.append(tr)
                prev_close = c
            return sum(trs) / len(trs) if trs else 0.0
        except Exception:
            return 0.0

    def monitor_and_exit(self) -> Dict[str, Any]:
        """V40.4 §4.2 — تتبع لحظي للمراكز المفتوحة + إغلاق فوري عند الأهداف/الوقف.

        ينفّذ كل 5 دقائق (مع run_once) ويتحقق من كل صفقة مفتوحة:
          1. Hard loss ceiling: لو السعر <= entry * (1 - 10%) → إغلاق فوري (hard_loss)
          2. Stop loss: لو السعر <= stop_loss → إغلاق (stop)
          3. Target: لو السعر >= target_price → إغلاق (target)
          4. Partial exit 1.8R: لو السعر >= entry + risk*1.8 و remaining==1.0
             → إغلاق 50% + رفع الوقف لنقطة الدخول (breakeven)
          5. Trailing stop (بعد الـ partial): لو السعر <= highest - 2.0*ATR
             → إغلاق المتبقي (trailing)

        Returns:
            {'checked': N, 'exited': N, 'partial': N, 'errors': [...]}
        """
        checked = 0
        exited = 0
        partial = 0
        errors: List[str] = []

        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('predictions', writable=False).__enter__()
            except Exception:
                conn = sqlite3.connect(self.predictions_db, timeout=30)
            conn.execute('PRAGMA busy_timeout = 30000')
            # كل الصفقات المفتوحة (status open أو partial)
            open_rows = conn.execute(
                "SELECT id, symbol, entry_price, target_price, stop_loss, "
                "highest_price, remaining_pct, status "
                "FROM crypto_predictions_log "
                "WHERE status IN ('open', 'partial') "
                "ORDER BY created_at DESC LIMIT 200"
            ).fetchall()
            conn.close()
        except Exception as exc:
            logger.error(f"[CryptoLab] monitor_and_exit query failed: {exc}")
            return {'checked': 0, 'exited': 0, 'partial': 0, 'errors': [str(exc)]}

        for row in open_rows:
            pos_id, symbol, entry, target, stop, highest, remaining, status = row
            entry = float(entry or 0)
            target = float(target or 0)
            stop = float(stop or 0)
            highest = float(highest or entry)
            remaining = float(remaining or 1.0)
            checked += 1

            try:
                price = self._fetch_live_price(symbol)
                if not price or price <= 0:
                    errors.append(f"{symbol}: no live price")
                    continue

                # تحديث أعلى سعر
                new_highest = max(highest, price)
                risk = abs(entry - stop) if stop > 0 else entry * 0.05

                # ── Exit condition checks (priority order) ──────────────
                exit_type = None
                exit_price = price
                new_remaining = remaining
                new_stop = stop

                # 1. Hard loss ceiling (-10%)
                if price <= entry * (1 + CRYPTO_HARD_LOSS_CEILING_PCT / 100.0):
                    exit_type = 'hard_loss'
                    exit_price = price
                    new_remaining = 0.0

                # 2. Stop loss hit
                elif stop > 0 and price <= stop:
                    exit_type = 'stop'
                    exit_price = stop
                    new_remaining = 0.0

                # 3. Target hit
                elif target > 0 and price >= target:
                    exit_type = 'target'
                    exit_price = target
                    new_remaining = 0.0

                # 4. Partial exit at 1.8R (only if not yet partial)
                elif (remaining >= 1.0 and risk > 0 and
                      price >= entry + risk * CRYPTO_PARTIAL_EXIT_R):
                    exit_type = 'partial_target'
                    exit_price = price
                    new_remaining = remaining - CRYPTO_PARTIAL_EXIT_PCT
                    # Raise stop to breakeven (entry price)
                    if CRYPTO_BREAKEVEN_AFTER_PARTIAL:
                        new_stop = entry
                    partial += 1

                # 5. Trailing stop (after partial — status was 'partial')
                elif status == 'partial' and new_highest > entry:
                    atr = self._fetch_atr(symbol) or (entry * 0.03)
                    trail_level = new_highest - CRYPTO_TRAILING_ATR_MULT * atr
                    if price <= trail_level:
                        exit_type = 'trailing'
                        exit_price = price
                        new_remaining = 0.0

                if exit_type is None:
                    # No exit — just update highest_price if it moved
                    if new_highest != highest:
                        self._update_position(pos_id, highest_price=new_highest)
                    continue

                # Calculate blended actual_return for the position
                if new_remaining <= 0.0:
                    # Full exit: weighted avg of partial + final
                    if exit_type == 'partial_target':
                        # This shouldn't happen (partial keeps remaining > 0)
                        ret_pct = (exit_price - entry) / entry * 100.0
                    else:
                        # remaining was the portion still open before this exit
                        closed_now_pct = remaining
                        ret_pct = (exit_price - entry) / entry * 100.0 * closed_now_pct
                        # Add the previously-locked partial return (assume partial at 1.8R)
                        if remaining < 1.0:
                            partial_ret = risk * CRYPTO_PARTIAL_EXIT_R / entry * 100.0 * (1.0 - remaining)
                            ret_pct += partial_ret
                    new_status = 'closed'
                    exited += 1
                else:
                    # Partial exit — return reflects only the closed portion
                    closed_now_pct = CRYPTO_PARTIAL_EXIT_PCT
                    ret_pct = (exit_price - entry) / entry * 100.0 * closed_now_pct
                    new_status = 'partial'

                self._update_position(
                    pos_id,
                    exit_price=exit_price,
                    exit_type=exit_type,
                    highest_price=new_highest,
                    actual_return=round(ret_pct, 4),
                    remaining_pct=new_remaining,
                    status=new_status,
                    stop_loss=new_stop,
                    exited_at=datetime.utcnow().isoformat() + 'Z' if new_status == 'closed' else None,
                )
                logger.info(
                    f"[CryptoLab] EXIT {symbol} #{pos_id}: {exit_type} @ ${exit_price:.2f} "
                    f"(return={ret_pct:.2f}%, remaining={new_remaining:.2f})"
                )
            except Exception as exc:
                errors.append(f"{symbol}: {exc}")
                logger.error(f"[CryptoLab] monitor error for {symbol} #{pos_id}: {exc}")

        summary = {
            'checked': checked,
            'exited': exited,
            'partial': partial,
            'errors': errors,
        }
        if checked > 0:
            logger.info(
                f"[CryptoLab] monitor_and_exit: checked={checked} "
                f"exited={exited} partial={partial}"
            )
        return summary

    def _update_position(self, pos_id: int, **fields) -> None:
        """تحديث آمن لصف في crypto_predictions_log (فقط الحقول المُمرّرة)."""
        if not fields:
            return
        set_clauses = []
        values = []
        for k, v in fields.items():
            if v is None:
                continue
            set_clauses.append(f"{k} = ?")
            values.append(v)
        if not set_clauses:
            return
        values.append(pos_id)
        try:
            try:
                from core.db_manager import db_manager
                conn = db_manager.connection('predictions', writable=True).__enter__()
            except Exception:
                conn = sqlite3.connect(self.predictions_db, timeout=30)
            conn.execute('PRAGMA busy_timeout = 30000')
            conn.execute(
                f"UPDATE crypto_predictions_log SET {', '.join(set_clauses)} WHERE id = ?",
                values,
            )
            conn.commit()
            conn.close()
        except Exception as exc:
            logger.error(f"[CryptoLab] _update_position failed for #{pos_id}: {exc}")

    # ------------------------------------------------------------------
    # Public: run one cycle
    # ------------------------------------------------------------------
    def run_once(self) -> Dict[str, Any]:
        """يشغّل دورة تحليل واحدة لكل العملات (BTC + ETH).

        V40.4 §4.2: يبدأ بـ ``monitor_and_exit()`` لتتبع الصفقات المفتوحة
        وإغلاقها فوراً عند ضرب الأهداف/الوقف/الـ trailing، قبل توليد توقعات جديدة.

        Returns:
            {'success': bool, 'analyzed': int, 'logged': int, 'failed': int,
             'monitored': dict, 'results': {symbol: prediction}, 'errors': [str]}
        """
        results: Dict[str, Any] = {}
        errors: List[str] = []
        analyzed = 0
        logged = 0
        failed = 0

        # V40.4 §4.2: 24/7 position monitoring FIRST — exit open trades before
        # generating new predictions. This runs every 5 minutes.
        monitored = {'checked': 0, 'exited': 0, 'partial': 0, 'errors': []}
        try:
            monitored = self.monitor_and_exit()
        except Exception as exc:
            logger.error(f"[CryptoLab] monitor_and_exit failed: {exc}")
            monitored['errors'] = [str(exc)]

        # Mass-scale: اكتشف كل العملات المتاحة ديناميكياً
        coins_to_analyze = get_crypto_lab_coins()
        logger.info(f"[CryptoLab] run_once: analyzing {len(coins_to_analyze)} coins")

        for coin_id, symbol in coins_to_analyze.items():
            try:
                prediction = self.analyze_coin(coin_id, symbol)
                if prediction is None:
                    failed += 1
                    errors.append(f"{symbol}: no data available")
                    continue
                analyzed += 1
                if self.log_prediction(prediction):
                    logged += 1
                    results[symbol] = prediction
                    self.last_results[symbol] = prediction
                else:
                    failed += 1
                    errors.append(f"{symbol}: log failed")
            except Exception as e:
                failed += 1
                errors.append(f"{symbol}: {e}")
                logger.error(f"[CryptoLab] Error analyzing {symbol}: {e}", exc_info=True)

        self.last_run = datetime.utcnow()
        summary = {
            'success': logged > 0,
            'analyzed': analyzed,
            'logged': logged,
            'failed': failed,
            'monitored': monitored,
            'results': results,
            'errors': errors,
            'timestamp': self.last_run.isoformat() + 'Z' if self.last_run else None,
        }
        logger.info(
            f"[CryptoLab] Cycle complete — analyzed={analyzed}, logged={logged}, "
            f"failed={failed}, monitored={monitored.get('checked', 0)} "
            f"(exited={monitored.get('exited', 0)}, partial={monitored.get('partial', 0)})"
        )
        return summary

    # ------------------------------------------------------------------
    # Public: start / stop (thread-based)
    # ------------------------------------------------------------------
    def start(self, interval_seconds: int = CRYPTO_LAB_INTERVAL_SECONDS,
              use_scheduler_manager: bool = True) -> bool:
        """يشغّل الـ scheduler.

        Args:
            interval_seconds: كل قد إيه يشتغل (default 5 دقائق = 300 ثانية، V40.4 §4.2).
            use_scheduler_manager: لو True، يسجّل في SchedulerManager المركزي
                (APScheduler) بدل ما يفتح thread لوحده. ده الـ preferred path.

        Returns:
            True لو الـ scheduler اشتغل بنجاح.
        """
        if self.running:
            logger.warning("[CryptoLab] Already running")
            return True

        # Preferred path: register with central SchedulerManager
        if use_scheduler_manager:
            try:
                from core.scheduler_manager import scheduler_manager
                ok = scheduler_manager.register_interval(
                    name='crypto_lab_5min',
                    func=self.run_once,
                    seconds=interval_seconds,
                    max_instances=1,
                    trading_hours_only=False,  # 24/7 — not gated by EGX hours
                    timeout_seconds=120,  # hard cap to prevent starvation
                )
                if ok:
                    self.running = True
                    logger.info(
                        f"[CryptoLab] Registered with SchedulerManager — "
                        f"runs every {interval_seconds}s (24/7)"
                    )
                    # Run once immediately so we don't wait 5 min for first result
                    try:
                        scheduler_manager.trigger_job('crypto_lab_5min')
                    except Exception:
                        pass
                    return True
                logger.warning("[CryptoLab] SchedulerManager registration failed — falling back to thread")
            except ImportError:
                logger.warning("[CryptoLab] scheduler_manager not available — falling back to thread")
            except Exception as e:
                logger.warning(f"[CryptoLab] SchedulerManager error: {e} — falling back to thread")

        # Fallback: dedicated thread with time.sleep
        self.running = True
        self._thread = threading.Thread(
            target=self._run_loop, args=(interval_seconds,),
            daemon=True, name='CryptoLabScheduler',
        )
        self._thread.start()
        logger.info(f"[CryptoLab] Thread started — runs every {interval_seconds}s (24/7)")
        return True

    def _run_loop(self, interval_seconds: int) -> None:
        """حلقة الـ thread الاحتياطية (لو SchedulerManager مش متاح)."""
        # Run once immediately
        try:
            self.run_once()
        except Exception as e:
            logger.error(f"[CryptoLab] Initial run error: {e}")
        while self.running:
            try:
                time.sleep(interval_seconds)
                if not self.running:
                    break
                self.run_once()
            except Exception as e:
                logger.error(f"[CryptoLab] Loop error: {e}")
                time.sleep(30)  # back off on error

    def stop(self) -> None:
        """يوقف الـ scheduler."""
        self.running = False
        # Try to unregister from SchedulerManager
        try:
            from core.scheduler_manager import scheduler_manager
            scheduler_manager.unregister('crypto_lab_15min')
            logger.info("[CryptoLab] Unregistered from SchedulerManager")
        except Exception:
            pass
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
        logger.info("[CryptoLab] Stopped")

    # ------------------------------------------------------------------
    # Status (for monitoring / health check)
    # ------------------------------------------------------------------
    def get_status(self) -> Dict[str, Any]:
        """يرجع حالة الـ scheduler (للـ monitoring و health checks)."""
        # Mass-scale: اعرض العملات اللي بتتحلل فعلياً (dynamic)
        try:
            tracked_coins = list(get_crypto_lab_coins().values())
        except Exception:
            tracked_coins = list(CRYPTO_LAB_COINS.values())
        return {
            'running': self.running,
            'last_run': self.last_run.isoformat() + 'Z' if self.last_run else None,
            'last_error': self.last_error,
            'coins_tracked': tracked_coins,
            'coins_count': len(tracked_coins),
            'interval_seconds': CRYPTO_LAB_INTERVAL_SECONDS,
            'v404_params': {
                'hard_loss_ceiling_pct': CRYPTO_HARD_LOSS_CEILING_PCT,
                'partial_exit_r': CRYPTO_PARTIAL_EXIT_R,
                'partial_exit_pct': CRYPTO_PARTIAL_EXIT_PCT,
                'trailing_atr_mult': CRYPTO_TRAILING_ATR_MULT,
                'breakeven_after_partial': CRYPTO_BREAKEVEN_AFTER_PARTIAL,
            },
            'engines_loaded': {
                'fusion_engine': self._fusion_engine_cls is not None,
                'smc_engine': self._smc_calculate is not None,
            },
            'last_predictions': {
                sym: {
                    'signal': p.get('signal'),
                    'score': p.get('score'),
                    'entry_price': p.get('entry_price'),
                    'timestamp': p.get('timestamp'),
                }
                for sym, p in self.last_results.items()
            },
        }


# ============================================================================
# Singleton accessor (mirrors the get_live_engine() pattern in live_indicator_engine)
# ============================================================================

_crypto_lab_scheduler: Optional[CryptoLabScheduler] = None


def get_crypto_lab_scheduler() -> CryptoLabScheduler:
    """Singleton accessor for the CryptoLabScheduler."""
    global _crypto_lab_scheduler
    if _crypto_lab_scheduler is None:
        _crypto_lab_scheduler = CryptoLabScheduler()
    return _crypto_lab_scheduler


# ============================================================================
# Standalone entry point (for testing / manual run)
# ============================================================================

def main():
    """Run the CryptoLabScheduler standalone (for testing)."""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    )
    scheduler = CryptoLabScheduler()
    # Mass-scale: اعرض كل العملات المكتشفة
    coins = get_crypto_lab_coins()
    print("🚀 Crypto Lab Scheduler — standalone run (MASS-SCALE)")
    print(f"   Coins discovered: {len(coins)} → {list(coins.values())[:10]}{'...' if len(coins) > 10 else ''}")
    print(f"   Interval: every {CRYPTO_LAB_INTERVAL_SECONDS}s (5 min, V40.4 24/7)")
    print(f"   Predictions DB: {scheduler.predictions_db}")
    print(f"   V40.4 monitor: hard_loss={CRYPTO_HARD_LOSS_CEILING_PCT}% partial@{CRYPTO_PARTIAL_EXIT_R}R trailing={CRYPTO_TRAILING_ATR_MULT}*ATR")
    print()

    result = scheduler.run_once()
    print(f"\n📊 Result: analyzed={result['analyzed']}, logged={result['logged']}, failed={result['failed']}")
    mon = result.get('monitored', {})
    print(f"   monitor_and_exit: checked={mon.get('checked', 0)} exited={mon.get('exited', 0)} partial={mon.get('partial', 0)}")
    for sym, pred in result['results'].items():
        print(f"   {sym}: {pred['signal']} @ ${pred['entry_price']:.2f} "
              f"(score={pred['score']:.1f}, confidence={pred['confidence']:.0f}%)")
    if result['errors']:
        print("   Errors:")
        for e in result['errors']:
            print(f"     - {e}")


if __name__ == '__main__':
    main()
