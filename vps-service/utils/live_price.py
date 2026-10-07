#!/usr/bin/env python3
"""
live_price.py — مصدر السعر الحي الموحّد لكل المنصة (v1)
=====================================================================

ديل واحد بـ يرجّع "آخر سعر" لسهم — بنفس مسار الشارت بالظبط.

لما الـ user بيفتح الـ interactive chart على invist.m2y.net، الـ backend
بـ يقرأ من `intraday.db.stock_intraday` عبر `data_engine/intraday_storage.py`.
لما `daily_closer` بـ يقفل توقع، كان بـ يقرأ من `stocks.db.stocks.current_price`
(ملوث — COMI=140 بدل 20). ده خلّى الإغلاق يطلع غلط ونتحنا لـ "ترقيع"
بـ `previous_close × (1+change%)`. الترقيع أنقذ الشاشة مؤقتاً، لكنه مش
"سعر اليوم".

الـ unified function هنا بـ يوحّد المسار:

  1. intraday.db.stock_intraday (آخر `price` ORDER BY `timestamp` DESC)
     ← نفس مصدر الشارت. ده "سعر اليوم" أثناء/بعد الجلسة.
  2. data_engine.db.egksco_stocks.last_price (مع staleness check 24h)
     ← محرك البيانات الرسمي.
  3. stocks.db.egksco_stocks.last_price (mirror copy)
     ← fallback لو data_engine.db مش متاح.
  4. stocks.db.stocks.current_price (مع pollution check)
     ← fallback أخير — مع log تحذير إن المصدر مش حي.

ملاحظة مهمة عن `stocks.previous_close` (سبتمبر 2026 — تحديث بعد فحص فعلي):
  الترقيع السابق (أغسطس 2026) كان بـ يستخدم `previous_close × (1+change%)`
  بافتراض إن `current_price` ملوّث و`previous_close` صحيح. الفحص الفعلي
  أثبت العكس — `previous_close` هو الملوّث (COMI: pc=20.5 بدل 139.15)،
  بينما `current_price` صحيح (COMI: cp=140.23 يطابق egksco_stocks.last_price=140.5).
  الترقيع القديم كان بـ يعطي COMI=20.4 بدل 140.5 → إغلاقات غلط.

الـ priority دي موثّقة من فحص فعلي لـ PRAGMA table_info على الـ DBs:
  - intraday.db: stock_intraday(ticker, market, timestamp, price, ...)
  - data_engine.db: egksco_stocks(symbol, last_price, prev_close, change_pct, last_update)
  - stocks.db: egksco_stocks (mirror) + stocks(current_price POLLUTED, previous_close OK)

التوافق:
  - daily_closer._get_current_price_stocks() → استبدال بـ get_live_price()
  - stored_analysis_routes._get_current_price() → استبدال بـ get_live_price()

Author: دليل الاستثمار
Version: 1.0.0 — سبتمبر 2026
"""
from __future__ import annotations

import os
import sqlite3
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# ============================================================================
# DB PATHS — نفس الـ resolution اللي بـ يستخدمه intraday_storage.py
# ============================================================================
_PROJECT_ROOT = Path(__file__).resolve().parents[2]  # vps-service/utils/.. → root
DB_DIR = _PROJECT_ROOT / 'db'

INTRADAY_DB = str(DB_DIR / 'intraday.db')
DATA_ENGINE_DB = str(DB_DIR / 'data_engine.db')
STOCKS_DB = os.environ.get('DATABASE_PATH', str(DB_DIR / 'stocks.db'))

# Staleness threshold — لو آخر update أقدم من كده، نعتبره "مش حي" ونتحرك للمصدر التالي
# 24 ساعة معناها: لو الـ intraday أحدث من أمس، اقبله. وإلا fallback.
STALENESS_HOURS = 24

# Cache بسيط (60 ثانية) — عشان الـ daily_closer بـ يستدعي نفس الـ ticker أكتر من مرة
_PRICE_CACHE: dict = {}  # ticker → (price, source, ts_iso)
_CACHE_TTL_SECONDS = 60


def _connect(db_path: str) -> Optional[sqlite3.Connection]:
    """افتح اتصال SQLite مع WAL + busy_timeout (نفس patch الـ daily_closer)."""
    try:
        conn = sqlite3.connect(db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA busy_timeout=30000')
        except Exception:
            pass
        return conn
    except Exception as e:
        logger.warning(f"[live_price] connect failed for {db_path}: {e}")
        return None


def _is_fresh(timestamp_str: Optional[str], max_hours: int = STALENESS_HOURS) -> bool:
    """تحقّق إن timestamp أحدث من `max_hours` ساعة. True لو fresh أو ما نقدرش نحسبه."""
    if not timestamp_str:
        # مفيش timestamp → اخد بالحذر بس نعتبره "fresh" (الـ caller بـ يقرر)
        return True
    try:
        # SQLite timestamps متعددة الصيغ: 'YYYY-MM-DD HH:MM:SS' / 'YYYY-MM-DDTHH:MM:SS' / ISO8601
        ts = str(timestamp_str).strip()
        # اقتطاع الميكروثواني والـ timezone لو موجودة
        if '+' in ts:
            ts = ts.split('+')[0]
        if 'Z' in ts:
            ts = ts.replace('Z', '')
        # جرّب صيغتين
        parsed = None
        for fmt in ('%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%d %H:%M:%S',
                    '%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S',
                    '%Y-%m-%d %H:%M', '%Y-%m-%dT%H:%M'):
            try:
                parsed = datetime.strptime(ts[:26] if '.' in ts else ts[:19], fmt)
                break
            except ValueError:
                continue
        if not parsed:
            return True  # ما نقدرش نحسب → اعتبره fresh (الـ caller يتحقق)
        age_hours = (datetime.now() - parsed).total_seconds() / 3600.0
        return age_hours <= max_hours
    except Exception:
        return True  # ما نقدرش نحكم → خلي الـ caller يقرر


# ============================================================================
# المصدر 1: intraday.db.stock_intraday — نفس مسار الشارت
# ============================================================================
def _price_from_intraday(ticker: str) -> Tuple[float, str, Optional[str]]:
    """اقرأ آخر سعر من intraday.db.intraday_prices.

    Schema الفعلي (موثّق من PRAGMA table_info — سبتمبر 2026):
      intrayday_prices(id, ticker, price_time, price, volume, bid, ask,
                       source, created_at)
    ملاحظة: الـ table اسمها `intraday_prices` (مش `stock_intraday`)، والعمود
    `price_time` (مش `timestamp`). الكود القديم كان بـ يستخدم أسماء غلط →
    silent OperationalError → المصدر ده بـ يفشل دايماً → fallback لـ data_engine.

    Returns:
        (price, source_label, timestamp_str) أو (0.0, '', None) لو فشل.
    """
    try:
        if not os.path.exists(INTRADAY_DB):
            return (0.0, '', None)
        conn = _connect(INTRADAY_DB)
        if not conn:
            return (0.0, '', None)
        try:
            cur = conn.cursor()
            # intraday_prices(ticker, price_time, price, volume, bid, ask, source, created_at)
            cur.execute('''
                SELECT price, price_time
                FROM intraday_prices
                WHERE ticker = ? AND price > 0
                ORDER BY price_time DESC
                LIMIT 1
            ''', (ticker.upper(),))
            row = cur.fetchone()
            if row and row['price']:
                price = float(row['price'])
                ts = row['price_time']
                if price > 0:
                    return (round(price, 4), 'intraday', ts)
        except sqlite3.OperationalError as e:
            # ممكن الـ table مش موجودة لو الـ intraday_storage ما اشتغلش لسه
            logger.debug(f"[live_price] intraday.intraday_prices not available for {ticker}: {e}")
        finally:
            conn.close()
    except Exception as e:
        logger.warning(f"[live_price] _price_from_intraday failed for {ticker}: {e}")
    return (0.0, '', None)


# ============================================================================
# المصدر 2: data_engine.db.egksco_stocks — محرك البيانات الرسمي
# ============================================================================
def _price_from_data_engine(ticker: str) -> Tuple[float, str, Optional[str]]:
    """اقرأ last_price من data_engine.db.egksco_stocks (محرك البيانات الرسمي).

    Schema (موثّق من PRAGMA table_info):
      egksco_stocks(id, symbol, name, market, sector, last_price, change,
                    change_percent, volume, turnover, last_updated)
    ملاحظة: data_engine.db بـ يستخدم `last_updated` (تحت)، بينما stocks.db.egksco_stocks
    بـ يستخدم `last_update` (بدون d). الاتنين مصادر مختلفة، الـ schema مش identical.
    """
    try:
        if not os.path.exists(DATA_ENGINE_DB):
            return (0.0, '', None)
        conn = _connect(DATA_ENGINE_DB)
        if not conn:
            return (0.0, '', None)
        try:
            cur = conn.cursor()
            cur.execute('''
                SELECT last_price, change_percent, last_updated
                FROM egksco_stocks
                WHERE symbol = ?
                ORDER BY last_updated DESC
                LIMIT 1
            ''', (ticker.upper(),))
            row = cur.fetchone()
            if row:
                last_price = float(row['last_price']) if row['last_price'] else 0.0
                last_updated = row['last_updated']
                # فحص staleness: لو أقدم من 24 ساعة، المصدر ده مش "حي" → نتحرك لـ fallback
                if last_price > 0 and _is_fresh(last_updated, STALENESS_HOURS):
                    return (round(last_price, 4), 'data_engine', last_updated)
                # لو stale → نرجّع 0 عشان الـ caller يجرّب المصدر التالي
                logger.info(f"[live_price] data_engine stale for {ticker} (last_updated={last_updated})")
        except sqlite3.OperationalError as e:
            logger.debug(f"[live_price] data_engine.egksco_stocks not available for {ticker}: {e}")
        finally:
            conn.close()
    except Exception as e:
        logger.warning(f"[live_price] _price_from_data_engine failed for {ticker}: {e}")
    return (0.0, '', None)


# ============================================================================
# المصدر 3: stocks.db.egksco_stocks — mirror copy
# ============================================================================
def _price_from_stocks_egksco(ticker: str) -> Tuple[float, str, Optional[str]]:
    """اقرأ last_price من stocks.db.egksco_stocks (نسخة mirror في stocks.db).

    نفس schema بالظبط زي data_engine.db.egksco_stocks.
    """
    try:
        if not os.path.exists(STOCKS_DB):
            return (0.0, '', None)
        conn = _connect(STOCKS_DB)
        if not conn:
            return (0.0, '', None)
        try:
            cur = conn.cursor()
            cur.execute('''
                SELECT last_price, prev_close, change_pct, last_update
                FROM egksco_stocks
                WHERE symbol = ?
                ORDER BY last_update DESC
                LIMIT 1
            ''', (ticker.upper(),))
            row = cur.fetchone()
            if row:
                last_price = float(row['last_price']) if row['last_price'] else 0.0
                last_update = row['last_update']
                if last_price > 0 and _is_fresh(last_update, STALENESS_HOURS):
                    return (round(last_price, 4), 'stocks.egksco', last_update)
        except sqlite3.OperationalError as e:
            logger.debug(f"[live_price] stocks.egksco_stocks not available for {ticker}: {e}")
        finally:
            conn.close()
    except Exception as e:
        logger.warning(f"[live_price] _price_from_stocks_egksco failed for {ticker}: {e}")
    return (0.0, '', None)


# ============================================================================
# المصدر 4 (fallback أخير): stocks.db.stocks.current_price (مع pollution check)
# ============================================================================
def _price_from_stocks_patched(ticker: str) -> Tuple[float, str, Optional[str]]:
    """اقرأ من stocks.db.stocks باستخدام `current_price` مباشرة (مع sanity check).

    إصلاح data pollution (سبتمبر 2026 — تحديث مهم):
    الافتراض السابق كان إن `current_price` ملوّث و`previous_close` صحيح، فكنّا
    بـ نحسب `previous_close × (1 + change_percent/100)`. لكن الفحص الفعلي
    على الإنتاج أثبت العكس:

      COMI: stocks.current_price=140.23 (CORRECT) — egksco_stocks.last_price=140.5
            stocks.previous_close=20.5 (POLLUTED!) — egksco_stocks.prev_close=139.15
      HRHO: stocks.current_price=27.48 (CORRECT) — egksco_stocks.last_price=27.67
            stocks.previous_close=11.5 (POLLUTED!) — egksco_stocks.prev_close=27.77
      SWDY: stocks.current_price=109.02 (CORRECT) — egksco_stocks.last_price=108.49
            stocks.previous_close=26.0 (POLLUTED!) — egksco_stocks.prev_close=105.2
      EFID: stocks.current_price=29.70 (slightly off) — egksco_stocks.last_price=32.16
            stocks.previous_close=15.2 (POLLUTED!) — egksco_stocks.prev_close=30.84

    الخلاصة: `previous_close` هو الملوّث، مش `current_price`. الترقيع القديم
    كان بـ يستخدم القيمة الملوّثة وبيطلّع نتائج غلط (COMI طلع 20.4 بدل 140.5).

    الاستراتيجية الجديدة:
      1. نستخدم `current_price` مباشرة (هو الصحيح في الغالب).
      2. sanity check: لو `current_price` و`previous_close` مختلفين بـ نسبة
         كبيرة (> 3×)، ده يعني إن في pollution — نفضّل `current_price` لأن
         `previous_close` هو اللي بـ يتلوّث.
      3. لو `current_price` <= 0، نرجّع 0 (لا fallback لـ previous_close).
    """
    try:
        if not os.path.exists(STOCKS_DB):
            return (0.0, '', None)
        conn = _connect(STOCKS_DB)
        if not conn:
            return (0.0, '', None)
        try:
            cur = conn.cursor()
            cur.execute('''
                SELECT current_price, previous_close, change_percent, last_update
                FROM stocks
                WHERE ticker = ?
                LIMIT 1
            ''', (ticker.upper(),))
            row = cur.fetchone()
            if row:
                cp = float(row['current_price']) if row['current_price'] else 0.0
                pc = float(row['previous_close']) if row['previous_close'] else 0.0
                last_update = row['last_update'] if 'last_update' in row.keys() else None

                if cp > 0:
                    # Sanity check: لو cp و pc مختلفين جداً، اقبل cp (هو الأصح)
                    if pc > 0 and (cp > pc * 3.0 or cp < pc / 3.0):
                        logger.warning(
                            f"[live_price] stocks.pollution: {ticker} cp={cp} vs pc={pc} "
                            f"— accepting current_price (previous_close polluted)"
                        )
                    return (round(cp, 4), 'stocks.current_price', last_update)
                # لا fallback لـ previous_close — هو الملوّث
        except sqlite3.OperationalError as e:
            logger.debug(f"[live_price] stocks.stocks not available for {ticker}: {e}")
        finally:
            conn.close()
    except Exception as e:
        logger.warning(f"[live_price] _price_from_stocks_patched failed for {ticker}: {e}")
    return (0.0, '', None)


# ============================================================================
# الدالة الموحّدة — get_live_price(ticker)
# ============================================================================
def get_live_price(ticker: str, use_cache: bool = True) -> float:
    """ارجع آخر سعر حي لـ ticker — بنفس مسار الشارت.

    Priority chain (موثّقة من PRAGMA table_info الفعلي):
      1. intraday.db.stock_intraday (آخر `price` ORDER BY `timestamp` DESC)
         ← نفس مصدر الشارت — "سعر اليوم".
      2. data_engine.db.egksco_stocks.last_price (مع staleness 24h)
         ← محرك البيانات الرسمي (column: `last_updated`).
      3. stocks.db.egksco_stocks.last_price (mirror copy, column: `last_update`)
         ← fallback لو data_engine.db مش متاح.
      4. stocks.db.stocks.current_price (مع pollution check)
         ← fallback أخير — مع log تحذير.
         ملاحظة: `stocks.previous_close` ملوّث لبعض tickers → لا تستخدمه.

    Args:
        ticker: رمز السهم (مثلاً 'COMI'). Case-insensitive.
        use_cache: استخدم cache 60 ثانية (default True). يفضّل تشغيله دايماً
                   عشان الـ daily_closer بـ يستدعي نفس الـ ticker أكتر من مرة.

    Returns:
        السعر (float) أو 0.0 لو مفيش مصدر متاح.
    """
    if not ticker:
        return 0.0
    ticker = ticker.upper().strip()

    # Cache check
    if use_cache:
        cached = _PRICE_CACHE.get(ticker)
        if cached:
            price, _, ts = cached
            cache_age = (datetime.now() - ts).total_seconds()
            if cache_age < _CACHE_TTL_SECONDS:
                return price

    # Priority chain
    for fn in (_price_from_intraday, _price_from_data_engine,
               _price_from_stocks_egksco, _price_from_stocks_patched):
        try:
            price, source, ts_str = fn(ticker)
            if price > 0:
                # حدّث الـ cache
                _PRICE_CACHE[ticker] = (price, source, datetime.now())
                if source == 'stocks.patched' or source == 'stocks.current_price':
                    logger.info(
                        f"[live_price] {ticker}={price} via {source} (fallback — not live). "
                        f"Check intraday collector."
                    )
                else:
                    logger.debug(f"[live_price] {ticker}={price} via {source} (ts={ts_str})")
                return price
        except Exception as e:
            logger.warning(f"[live_price] {fn.__name__} raised for {ticker}: {e}")
            continue

    # كل المصادر فشلت
    logger.warning(f"[live_price] no price source available for {ticker}")
    _PRICE_CACHE[ticker] = (0.0, 'none', datetime.now())
    return 0.0


def get_live_price_with_source(ticker: str) -> Tuple[float, str]:
    """نفس get_live_price لكن بيرجّع source label كمان ('intraday'/'data_engine'/...).

    مفيد للـ debugging وعرض "مصدر السعر" في الـ UI.
    """
    if not ticker:
        return (0.0, 'none')
    ticker = ticker.upper().strip()

    for fn in (_price_from_intraday, _price_from_data_engine,
               _price_from_stocks_egksco, _price_from_stocks_patched):
        try:
            price, source, _ = fn(ticker)
            if price > 0:
                _PRICE_CACHE[ticker] = (price, source, datetime.now())
                return (price, source)
        except Exception:
            continue
    return (0.0, 'none')


def clear_cache() -> None:
    """امسح الـ cache (للـ tests أو لـ force-refresh)."""
    _PRICE_CACHE.clear()


# ============================================================================
# P41 — Morning Bell helpers: RVOL + Intraday Momentum
# ============================================================================

# Cache قصير (90 ثانية) للـ RVOL والزخم اللحظي عشان جرس الصباح بيفحص كذا سهم
_INTRADAY_CACHE: dict = {}  # ticker → (snapshot_dict, ts)
_INTRADAY_CACHE_TTL = 90  # seconds — أقصر من cache السعر عشان الزخم بيتغير بسرعة

PRICE_HISTORY_DB = str(DB_DIR / 'price_history.db')


def _price_from_intraday_full(ticker: str) -> Optional[sqlite3.Row]:
    """آخر صف intraday كامل (price + volume + open + high + low + change)."""
    ticker = ticker.upper().strip()
    conn = _connect(INTRADAY_DB)
    if not conn:
        return None
    try:
        row = conn.execute(
            'SELECT ticker, timestamp, price, change_percent, volume, open, high, low '
            'FROM stock_intraday WHERE ticker = ? ORDER BY timestamp DESC LIMIT 1',
            (ticker,)
        ).fetchone()
        return row
    except sqlite3.OperationalError:
        return None
    finally:
        conn.close()


def get_intraday_snapshot(ticker: str) -> dict:
    """لقطة لحظية كاملة لسهم من intraday.db.

    Returns dict:
        price, volume, open, high, low, change_percent, timestamp, source
    """
    if not ticker:
        return {}
    ticker = ticker.upper().strip()
    cached = _INTRADAY_CACHE.get(ticker)
    if cached:
        snap, ts = cached
        if (datetime.now() - ts).total_seconds() < _INTRADAY_CACHE_TTL:
            return snap
    row = _price_from_intraday_full(ticker)
    if not row:
        # fallback للسعر الموحد (بدون volume/open/high)
        price = get_live_price(ticker, use_cache=True)
        snap = {'price': price, 'volume': 0, 'open': 0.0, 'high': 0.0,
                'low': 0.0, 'change_percent': 0.0, 'timestamp': None,
                'source': 'fallback_live_price'}
        _INTRADAY_CACHE[ticker] = (snap, datetime.now())
        return snap
    snap = {
        'price': float(row['price'] or 0),
        'volume': int(row['volume'] or 0),
        'open': float(row['open'] or 0),
        'high': float(row['high'] or 0),
        'low': float(row['low'] or 0),
        'change_percent': float(row['change_percent'] or 0),
        'timestamp': row['timestamp'],
        'source': 'intraday',
    }
    _INTRADAY_CACHE[ticker] = (snap, datetime.now())
    return snap


def _avg_daily_volume_20(ticker: str) -> float:
    """متوسط حجم التداول اليومي لآخر 20 يوم من price_history.db.

    Returns 0.0 لو مفيش بيانات.
    """
    ticker = ticker.upper().strip()
    conn = _connect(PRICE_HISTORY_DB)
    if not conn:
        return 0.0
    try:
        row = conn.execute(
            'SELECT AVG(volume) as avg_vol FROM ('
            '  SELECT volume FROM price_history WHERE ticker = ? '
            '  AND volume > 0 ORDER BY date DESC LIMIT 20'
            ')', (ticker,)
        ).fetchone()
        return float(row['avg_vol'] or 0.0) if row else 0.0
    except sqlite3.OperationalError:
        return 0.0
    finally:
        conn.close()


def compute_rvol(ticker: str) -> float:
    """Relative Volume = حجم اليوم / متوسط حجم 20 يوم.

    Returns:
        1.0 لو مفيش بيانات كافية (محايد).
        >1.0 = حجم أعلى من المعتاد (فرصة جرس الصباح).
        <1.0 = حجم أقل من المعتاد.
    """
    if not ticker:
        return 1.0
    ticker = ticker.upper().strip()
    snap = get_intraday_snapshot(ticker)
    today_vol = snap.get('volume', 0)
    if today_vol <= 0:
        return 1.0
    avg_vol = _avg_daily_volume_20(ticker)
    if avg_vol <= 0:
        return 1.0
    return round(today_vol / avg_vol, 2)


def get_intraday_momentum(ticker: str) -> dict:
    """زخم لحظي مركّب لسهم — لجرس الصباح ومحرك الخروج.

    Returns dict:
        ticker, current_price, open, high, low, volume, rvol,
        extension_pct_day (from open), change_pct, timestamp, source
    """
    if not ticker:
        return {}
    ticker = ticker.upper().strip()
    snap = get_intraday_snapshot(ticker)
    if not snap or snap['price'] <= 0:
        return {'ticker': ticker, 'current_price': 0.0, 'rvol': 1.0,
                'extension_pct_day': 0.0}
    rvol = compute_rvol(ticker)
    # extension_pct_day = كم امتد السعر من افتتاح اليوم
    ext = 0.0
    if snap['open'] > 0:
        ext = ((snap['price'] - snap['open']) / snap['open']) * 100
    return {
        'ticker': ticker,
        'current_price': snap['price'],
        'open': snap['open'],
        'high': snap['high'],
        'low': snap['low'],
        'volume': snap['volume'],
        'rvol': rvol,
        'extension_pct_day': round(ext, 2),
        'change_pct': snap['change_percent'],
        'timestamp': snap['timestamp'],
        'source': snap['source'],
    }


def get_recent_price_history(ticker: str, days: int = 20) -> dict:
    """آخر N يوم من price_history لاستخدامها في continuation engine.

    Returns dict:
        highs[], lows[], volumes[], closes[], avg_volume_20, atr, sma_20
    """
    if not ticker:
        return {}
    ticker = ticker.upper().strip()
    conn = _connect(PRICE_HISTORY_DB)
    if not conn:
        return {}
    try:
        rows = conn.execute(
            'SELECT date, high_price, low_price, close_price, volume '
            'FROM price_history WHERE ticker = ? '
            'AND high_price > 0 AND close_price > 0 '
            'ORDER BY date DESC LIMIT ?',
            (ticker, days)
        ).fetchall()
    except sqlite3.OperationalError:
        return {}
    finally:
        conn.close()
    if not rows or len(rows) < 5:
        return {}
    highs = [float(r['high_price']) for r in reversed(rows)]
    lows = [float(r['low_price']) for r in reversed(rows)]
    closes = [float(r['close_price']) for r in reversed(rows)]
    volumes = [float(r['volume'] or 0) for r in reversed(rows)]
    avg_volume_20 = sum(volumes) / len(volumes) if volumes else 0.0
    # ATR simplified: متوسط (high - low) لآخر N يوم
    ranges = [h - l for h, l in zip(highs, lows)]
    atr = sum(ranges) / len(ranges) if ranges else 0.0
    # SMA 20
    sma_20 = sum(closes) / len(closes) if closes else 0.0
    return {
        'highs': highs,
        'lows': lows,
        'closes': closes,
        'volumes': volumes,
        'avg_volume_20': avg_volume_20,
        'atr': atr,
        'sma_20': sma_20,
    }


# ============================================================================
# Self-test — run as script
# ============================================================================
if __name__ == '__main__':
    import sys
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')

    tickers = sys.argv[1:] if len(sys.argv) > 1 else ['COMI', 'HRHO', 'SWDY', 'EFID']
    print(f"\n{'Ticker':<10} {'Price':>12}  {'Source':<20}  Notes")
    print('-' * 70)
    for t in tickers:
        price, source = get_live_price_with_source(t)
        note = ''
        if source == 'intraday':
            note = '✓ live (chart path)'
        elif source == 'data_engine':
            note = '✓ engine'
        elif source == 'stocks.egksco':
            note = '~ mirror'
        elif source == 'stocks.patched':
            note = '⚠ fallback (pc×chg%)'
        elif source == 'stocks.current_price':
            note = '⚠ fallback (raw current_price)'
        else:
            note = '✗ no source'
        print(f"{t:<10} {price:>12.4f}  {source:<20}  {note}")
