"""
Enhanced Prediction Tracker — KPI Aligned to Gold Standard
============================================================
نظام تتبع التوقعات المحسن، مُحاذى مع الـ gold standard:

  - src/app/api/admin/platform-performance/route.ts
  - scripts/backtest_full.py

المميزات (المحاذات مع المعيار الإلزامي):
  - يقرأ من جدول `predictions` (Gold standard table — نفس الجدول الذي يستخدمه
    route.ts و backtest_full.py). قبل هذا الإصلاح كان الكود يقرأ من `aiPrediction`
    (legacy) ويستخدم أعمدة غير موجودة (actual_return, holding_days,
    target_hit_date, stop_hit_date) → كان الكود مكسوراً تماماً.
  - HARD cap ±50 على actual_return (Constitution Rule 7).
  - فصل القنوات: balanced ≠ morning_bell (Constitution Rule 8).
  - n_raw, n_valid, n_excluded + exclusion_breakdown (سبب → عدد).
  - capped_rows (عدد الصفقات التي وصلت للـ HARD cap ±50).
  - avg_loss سالب دائماً.
  - dedup على (ticker + prediction_date + channel + entry_price).
  - READ-ONLY: لا يكتب على أي DB (كان يكتب على aiPrediction بأعمدة غير موجودة،
    الآن أصبح read-only على predictions).

Author: GLMinvestment Platform — KPI Alignment Agent
"""

import math
import sqlite3
import json
import os
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict


# ============================================================================
# مسارات قواعد البيانات (fixed)
# ============================================================================
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PREDICTIONS_DB = os.path.join(PROJECT_ROOT, 'db', 'predictions.db')
DATA_ENGINE_DB = os.path.join(PROJECT_ROOT, 'db', 'data_engine.db')
STOCKS_DB = os.path.join(PROJECT_ROOT, 'db', 'stocks.db')


# ============================================================================
# Gold Standard Constants (Constitution Rules 7 + 8)
# ============================================================================
HARD_CAP_PCT = 50.0       # Rule 7: ABS(actual_return) <= 50
MAX_RETURN_RATIO = 5.0    # |exit/entry| > 5x = suspicious

AUDIT_STATUS = 'audited'
AUDIT_NOTE = (
    'KPI aligned to gold standard (src/app/api/admin/platform-performance/route.ts + '
    'scripts/backtest_full.py). '
    'Source table: predictions (was aiPrediction — legacy/broken). '
    'HARD cap ±50 applied to actual_return (Rule 7). '
    'Channels separated: balanced ≠ morning_bell (Rule 8). '
    'n_raw / n_valid / n_excluded + exclusion_breakdown + capped_rows implemented. '
    'Dedup on (ticker + prediction_date + channel + entry_price). '
    'avg_loss_pct is always <= 0. '
    'READ-ONLY: no writes to DB (was broken before — wrote to non-existent aiPrediction columns).'
)


# ============================================================================
# Data classes
# ============================================================================

@dataclass
class PredictionResult:
    """نتيجة تقييم التوقع"""
    prediction_id: str
    symbol: str
    status: str
    entry_price: float
    current_price: float
    target_price: float
    stop_loss: float
    signal_type: str
    actual_return: Optional[float] = None
    hit_target: bool = False
    hit_stop: bool = False
    target_hit_date: Optional[str] = None
    stop_hit_date: Optional[str] = None
    evaluation_date: Optional[str] = None
    holding_days: int = 0
    market: str = ''
    channel: str = 'balanced'
    capped: bool = False


# ============================================================================
# Helpers — KPI math (mirror of backtest_full.py + route.ts)
# ============================================================================

def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        if v is None or v == '':
            return default
        return float(v)
    except Exception:
        return default


def _safe_num(v: Any) -> Optional[float]:
    if v is None or v == '':
        return None
    try:
        n = float(v)
        return n if math.isfinite(n) else None
    except Exception:
        return None


def _compute_actual_return_capped(row: Dict[str, Any]) -> Tuple[Optional[float], bool, bool, Optional[str]]:
    """يحسب العائد الفعلي للصفقة مع HARD cap.

    يرجع: (capped_return, was_capped, suspicious, exclusion_reason)
        - capped_return: العائد بعد HARD cap، أو None لو لا يمكن قياسه.
        - was_capped: True لو |raw_return| > HARD_CAP_PCT.
        - suspicious: True لو |exit/entry| > MAX_RETURN_RATIO.
        - exclusion_reason: سبب الاستبعاد لو غير صالح للقياس.

    نفس منطق route.ts::computeActualReturnRaw + backtest_full.py::Trade.compute_return.
    """
    entry = _safe_num(row.get('entry_price'))
    if not entry or entry <= 0:
        return None, False, False, 'entry_price_zero'

    raw_ret: Optional[float] = None
    exit_used: Optional[float] = None

    # 1. actual_return field
    ar = _safe_num(row.get('actual_return'))
    if ar is not None and math.isfinite(ar):
        raw_ret = ar
        exit_used = entry * (1 + ar / 100)

    # 2. exit_price / actual_exit_price
    if raw_ret is None:
        exit_price = _safe_num(row.get('exit_price'))
        if exit_price is None:
            exit_price = _safe_num(row.get('actual_exit_price'))
        if exit_price is not None and exit_price > 0:
            raw_ret = ((exit_price - entry) / entry) * 100
            exit_used = exit_price

    # 3. hit_target=1 → target
    if raw_ret is None:
        hit_target = int(row.get('hit_target') or 0)
        target = _safe_num(row.get('target_price'))
        if hit_target == 1 and target is not None and target > 0:
            raw_ret = ((target - entry) / entry) * 100
            exit_used = target

    # 4. hit_stop=1 → stop
    if raw_ret is None:
        hit_stop = int(row.get('hit_stop') or 0)
        stop = _safe_num(row.get('stop_loss'))
        if hit_stop == 1 and stop is not None and stop > 0:
            raw_ret = ((stop - entry) / entry) * 100
            exit_used = stop

    # 5. expired no hit → null
    if raw_ret is None:
        return None, False, False, None  # valid but not measured

    # فحص منطقية: |exit/entry| > 5x → suspicious
    ratio = abs(exit_used / entry) if (exit_used and entry) else 1
    suspicious = ratio > MAX_RETURN_RATIO

    capped = abs(raw_ret) > HARD_CAP_PCT
    bounded = max(-HARD_CAP_PCT, min(HARD_CAP_PCT, raw_ret))

    return bounded, capped, suspicious, None


def _validate_trade(row: Dict[str, Any], seen_keys: set) -> Tuple[bool, Optional[str], str]:
    """فحص صلاحية الصفقة + dedup (mirror of route.ts::validateTrade).

    Returns:
        (valid, exclusion_reason, channel)
    """
    ticker = str(row.get('ticker', '')).strip().upper()
    entry = _safe_num(row.get('entry_price'))

    if not entry or entry <= 0:
        return False, 'entry_price_zero', 'balanced'

    if not ticker or ' ' in ticker or len(ticker) > 12:
        return False, 'ticker_invalid', 'balanced'

    market = str(row.get('market', '') or '').upper()
    if not market or market == 'UNKNOWN':
        return False, 'market_unknown', 'balanced'

    morning_bell = int(row.get('morning_bell') or 0)
    channel = 'morning_bell' if morning_bell == 1 else 'balanced'

    prediction_date = str(row.get('prediction_date', '') or '')
    dedup_key = f"{ticker}|{prediction_date}|{channel}|{entry:.4f}"
    if dedup_key in seen_keys:
        return False, 'duplicate', channel
    seen_keys.add(dedup_key)

    return True, None, channel


# ============================================================================
# Main tracker class
# ============================================================================

class EnhancedPredictionTracker:
    """
    متتبع التوقعات المحسن — مُحاذى مع gold standard.

    يقرأ من جدول `predictions` (نفس الجدول الذي يستخدمه route.ts و backtest_full.py).
    READ-ONLY: لا يكتب على أي DB.
    """

    def __init__(self, predictions_db: str = None, data_engine_db: str = None):
        self.predictions_db = predictions_db or PREDICTIONS_DB
        self.data_engine_db = data_engine_db or DATA_ENGINE_DB

    # ------------------------------------------------------------------
    # DB connections
    # ------------------------------------------------------------------
    def _get_predictions_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.predictions_db, timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA journal_mode=WAL;')
        conn.execute('PRAGMA busy_timeout=30000;')
        return conn

    def _get_data_engine_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.data_engine_db, timeout=30.0)
        conn.row_factory = sqlite3.Row
        return conn

    # ------------------------------------------------------------------
    # Current price lookup
    # ------------------------------------------------------------------
    def get_current_price(self, symbol: str, market: str = None) -> Optional[float]:
        """الحصول على السعر الحالي للسهم من data_engine.db أو stocks.db."""
        # 1. data_engine.db للـ CRYPTO
        if str(market or '').upper() == 'CRYPTO' or symbol in ['BTC', 'ETH', 'BNB']:
            if os.path.exists(self.data_engine_db):
                try:
                    conn = self._get_data_engine_connection()
                    try:
                        row = conn.execute(
                            'SELECT price_usd FROM crypto_prices '
                            'WHERE symbol = ? OR symbol = ? ORDER BY timestamp DESC LIMIT 1',
                            (symbol, symbol + 'USDT')
                        ).fetchone()
                        if row and row['price_usd']:
                            return float(row['price_usd'])
                    finally:
                        conn.close()
                except Exception:
                    pass

        # 2. stocks.db
        if os.path.exists(STOCKS_DB):
            try:
                conn = sqlite3.connect(STOCKS_DB, timeout=30.0)
                conn.row_factory = sqlite3.Row
                try:
                    row = conn.execute(
                        'SELECT current_price, close, last, price FROM stocks '
                        'WHERE ticker = ? OR symbol = ? LIMIT 1',
                        (symbol, symbol)
                    ).fetchone()
                    if row:
                        for v in row:
                            if v is not None and _safe_float(v, 0) > 0:
                                return _safe_float(v)
                finally:
                    conn.close()
            except Exception:
                pass

        # 3. data_engine.db stocks
        if os.path.exists(self.data_engine_db):
            try:
                conn = self._get_data_engine_connection()
                try:
                    row = conn.execute(
                        'SELECT price FROM stocks WHERE symbol = ? LIMIT 1',
                        (symbol,)
                    ).fetchone()
                    if row and row['price']:
                        return float(row['price'])
                    row = conn.execute(
                        'SELECT price FROM stock_prices WHERE symbol = ? '
                        'ORDER BY timestamp DESC LIMIT 1',
                        (symbol,)
                    ).fetchone()
                    if row and row['price']:
                        return float(row['price'])
                finally:
                    conn.close()
            except Exception:
                pass

        return None

    # ------------------------------------------------------------------
    # READ-ONLY evaluation (no DB writes — was broken before on aiPrediction)
    # ------------------------------------------------------------------
    def evaluate_prediction(self, symbol: str, current_price: float = None) -> PredictionResult:
        """تقييم توقع واحد — READ-ONLY (لا يكتب على الـ DB).

        Args:
            symbol: رمز السهم
            current_price: السعر الحالي (اختياري — سيتم جلبه إذا لم يحدد)

        Returns:
            PredictionResult مع actual_return مُطبّق عليه HARD cap ±50.
        """
        conn = self._get_predictions_connection()
        try:
            # نقرأ من `predictions` table (gold standard) — أحدث توقع لهذا الـ ticker
            row = conn.execute(
                '''SELECT id, ticker, signal_type, signal, entry_price,
                          target_price, stop_loss, prediction_date, status, market,
                          morning_bell, persona, actual_return, exit_price,
                          actual_exit_price, hit_target, hit_stop, holding_days,
                          outcome_date, closed_at, maestro_score, confidence
                   FROM predictions
                   WHERE ticker = ?
                   ORDER BY prediction_date DESC LIMIT 1''',
                (symbol,)
            ).fetchone()

            if not row:
                return PredictionResult(
                    prediction_id='',
                    symbol=symbol,
                    status='NOT_FOUND',
                    entry_price=0,
                    current_price=0,
                    target_price=0,
                    stop_loss=0,
                    signal_type='',
                )

            d = dict(row)
            entry_price = _safe_float(d.get('entry_price'), 0)
            target_price = _safe_float(d.get('target_price'), 0)
            stop_loss = _safe_float(d.get('stop_loss'), 0)
            signal_type = str(d.get('signal_type') or d.get('signal') or '')
            market = str(d.get('market') or '')
            morning_bell = int(d.get('morning_bell') or 0)
            channel = 'morning_bell' if morning_bell == 1 else 'balanced'
            status = str(d.get('status') or '')

            # السعر الحالي
            if current_price is None:
                current_price = self.get_current_price(symbol, market)

            if current_price is None:
                return PredictionResult(
                    prediction_id=str(d.get('id', '')),
                    symbol=symbol,
                    status='PRICE_UNAVAILABLE',
                    entry_price=entry_price,
                    current_price=0,
                    target_price=target_price,
                    stop_loss=stop_loss,
                    signal_type=signal_type,
                    market=market,
                    channel=channel,
                )

            # احسب أيام الاحتفاظ
            holding_days = int(d.get('holding_days') or 0)
            if holding_days <= 0:
                try:
                    pred_date_str = str(d.get('prediction_date') or '')[:10]
                    pred_dt = datetime.strptime(pred_date_str, '%Y-%m-%d')
                    holding_days = max(0, (datetime.now() - pred_dt).days)
                except Exception:
                    holding_days = 0

            # التحقق من الوصول للهدف أو الوقف
            today = datetime.now().strftime('%Y-%m-%d')
            hit_target = False
            hit_stop = False
            actual_return: Optional[float] = None
            capped = False

            # 1) استخدم actual_return الموجود إن وجد (مع HARD cap)
            stored_return = _safe_num(d.get('actual_return'))
            if stored_return is not None and math.isfinite(stored_return) and stored_return != 0:
                capped = abs(stored_return) > HARD_CAP_PCT
                actual_return = max(-HARD_CAP_PCT, min(HARD_CAP_PCT, stored_return))

            # 2) لو مش موجود → احسب من current_price
            if actual_return is None and entry_price > 0:
                computed = ((current_price - entry_price) / entry_price) * 100
                capped = abs(computed) > HARD_CAP_PCT
                actual_return = max(-HARD_CAP_PCT, min(HARD_CAP_PCT, computed))

            # حدّد hit_target / hit_stop
            if signal_type == 'BUY':
                if current_price >= target_price:
                    hit_target = True
                elif current_price <= stop_loss:
                    hit_stop = True
            elif signal_type == 'SELL':
                if current_price <= target_price:
                    hit_target = True
                elif current_price >= stop_loss:
                    hit_stop = True

            return PredictionResult(
                prediction_id=str(d.get('id', '')),
                symbol=symbol,
                status=status,
                entry_price=entry_price,
                current_price=current_price,
                target_price=target_price,
                stop_loss=stop_loss,
                signal_type=signal_type,
                actual_return=actual_return,
                hit_target=hit_target,
                hit_stop=hit_stop,
                target_hit_date=today if hit_target else None,
                stop_hit_date=today if hit_stop else None,
                evaluation_date=today,
                holding_days=holding_days,
                market=market,
                channel=channel,
                capped=capped,
            )
        finally:
            conn.close()

    def batch_evaluate_predictions(self, market: str = None) -> Dict[str, Any]:
        """تقييم كل التوقعات النشطة — READ-ONLY (لا يكتب على الـ DB)."""
        conn = self._get_predictions_connection()
        try:
            if market:
                rows = conn.execute(
                    "SELECT ticker, market FROM predictions WHERE status IN ('active', 'ACTIVE', 'PENDING') AND market = ?",
                    (market,)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT ticker, market FROM predictions WHERE status IN ('active', 'ACTIVE', 'PENDING')"
                ).fetchall()

            results: Dict[str, Any] = {
                'total_evaluated': 0,
                'targets_hit': 0,
                'stops_hit': 0,
                'still_pending': 0,
                'errors': 0,
                'details': [],
                'audit_status': AUDIT_STATUS,
                'audit_note': 'READ-ONLY batch evaluation (no DB writes). Source: predictions table.',
            }

            for r in rows:
                symbol = r['ticker']
                pred_market = r['market'] if 'market' in r.keys() else None
                try:
                    result = self.evaluate_prediction(symbol)
                    results['total_evaluated'] += 1

                    if result.hit_target:
                        results['targets_hit'] += 1
                    elif result.hit_stop:
                        results['stops_hit'] += 1
                    else:
                        results['still_pending'] += 1

                    results['details'].append({
                        'symbol': symbol,
                        'status': result.status,
                        'return': result.actual_return,
                        'capped': result.capped,
                    })
                except Exception as e:
                    results['errors'] += 1
                    results['details'].append({
                        'symbol': symbol,
                        'status': 'ERROR',
                        'error': str(e),
                    })

            return results
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # History / Stats — Gold standard KPIs
    # ------------------------------------------------------------------
    def _fetch_predictions_rows(self, market: str = None, days: int = 30) -> List[Dict[str, Any]]:
        """يجلب صفوف predictions في الفترة المحددة (raw read)."""
        conn = self._get_predictions_connection()
        try:
            since_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
            if market:
                rows = conn.execute(
                    '''SELECT id, ticker, signal_type, signal, prediction_date, entry_price,
                              target_price, target_price_2, stop_loss, exit_price,
                              actual_exit_price, actual_return, hit_target, hit_stop,
                              status, holding_days, outcome_date, closed_at,
                              highest_price, lowest_price, market, persona, morning_bell,
                              maestro_score, confidence
                       FROM predictions
                       WHERE prediction_date >= ? AND market = ?
                       ORDER BY prediction_date DESC''',
                    (since_date, market)
                ).fetchall()
            else:
                rows = conn.execute(
                    '''SELECT id, ticker, signal_type, signal, prediction_date, entry_price,
                              target_price, target_price_2, stop_loss, exit_price,
                              actual_exit_price, actual_return, hit_target, hit_stop,
                              status, holding_days, outcome_date, closed_at,
                              highest_price, lowest_price, market, persona, morning_bell,
                              maestro_score, confidence
                       FROM predictions
                       WHERE prediction_date >= ?
                       ORDER BY prediction_date DESC''',
                    (since_date,)
                ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def _build_trade_records(self, raw_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """يبني Trade records مع HARD cap + validation + dedup + channel split.

        نفس منطق route.ts و backtest_full.py.
        """
        seen_keys = set()
        trades: List[Dict[str, Any]] = []

        for row in raw_rows:
            ret, capped, suspicious, _ = _compute_actual_return_capped(row)
            valid, exclusion_reason, channel = _validate_trade(row, seen_keys)

            # لو suspicious → استبعد
            if valid and suspicious:
                valid = False
                exclusion_reason = 'exit_price_unrealistic'

            ticker = str(row.get('ticker', '')).strip().upper()
            market = str(row.get('market', '') or 'UNKNOWN').upper()

            trades.append({
                'id': row.get('id'),
                'ticker': ticker,
                'market': market,
                'channel': channel,
                'prediction_date': str(row.get('prediction_date', '') or ''),
                'entry_price': _safe_float(row.get('entry_price'), 0),
                'target_price': _safe_num(row.get('target_price')),
                'stop_loss': _safe_num(row.get('stop_loss')),
                'exit_price': _safe_num(row.get('exit_price')) or _safe_num(row.get('actual_exit_price')),
                'actual_return': ret,  # capped or None
                'hit_target': int(row.get('hit_target') or 0),
                'hit_stop': int(row.get('hit_stop') or 0),
                'status': str(row.get('status', '') or ''),
                'holding_days': int(row.get('holding_days') or 0),
                'capped': capped,
                'valid': valid,
                'exclusion_reason': exclusion_reason,
            })
        return trades

    def get_prediction_history(self, market: str = None, days: int = 30) -> List[Dict]:
        """سجل التوقعات مع النتائج — يقرأ من `predictions` table."""
        raw_rows = self._fetch_predictions_rows(market=market, days=days)
        trades = self._build_trade_records(raw_rows)
        return trades

    def get_performance_stats(self, market: str = None, days: int = 30) -> Dict[str, Any]:
        """إحصائيات الأداء — KPI محاذى مع gold standard.

        Returns dict with:
          - n_raw, n_valid, n_excluded, exclusion_breakdown, capped_rows
          - win_rate, profit_factor, expectancy_pct, avg_win_pct, avg_loss_pct (سالب),
            max_loss_pct (سالب), max_win_pct
          - tp1_hit_rate, stop_hit_rate, expired_rate, hard_capped_count
          - by_channel (balanced ≠ morning_bell)
          - by_market
          - best_predictions / worst_predictions
          - audit_status, audit_note
        """
        raw_rows = self._fetch_predictions_rows(market=market, days=days)
        trades = self._build_trade_records(raw_rows)

        n_raw = len(trades)
        valid_trades = [t for t in trades if t['valid']]
        measured = [t for t in valid_trades if t['actual_return'] is not None and t['actual_return'] != 0]
        n_valid = len(measured)
        excluded = [t for t in trades if not t['valid']]
        n_open = len([t for t in trades if t['status'] in ('active', 'ACTIVE', 'PENDING')])

        # exclusion breakdown
        exclusion_breakdown: Dict[str, int] = defaultdict(int)
        for t in excluded:
            reason = t['exclusion_reason'] or 'unknown'
            exclusion_breakdown[reason] += 1

        if n_valid == 0:
            return {
                'period_days': days,
                'market': market or 'ALL',
                'total_predictions': n_raw,
                'n_raw': n_raw,
                'n_valid': 0,
                'n_excluded': len(excluded),
                'n_open': n_open,
                'pending': n_open,
                'evaluated': 0,
                'targets_hit': 0,
                'stops_hit': 0,
                'win_rate': 0,
                'profit_factor': 0,
                'expectancy_pct': 0,
                'avg_win_pct': 0,
                'avg_loss_pct': 0,
                'max_loss_pct': 0,
                'max_win_pct': 0,
                'tp1_hit_rate': 0,
                'stop_hit_rate': 0,
                'expired_rate': 0,
                'hard_capped_count': 0,
                'capped_rows': 0,
                'hard_cap_pct': HARD_CAP_PCT,
                'exclusion_breakdown': dict(exclusion_breakdown),
                'by_signal_type': {},
                'by_market': {},
                'by_channel': [],
                'best_predictions': [],
                'worst_predictions': [],
                'avg_return': 0,
                'avg_holding_days': 0,
                'avg_maestro_score': 0,
                'avg_confidence': 0,
                'audit_status': AUDIT_STATUS,
                'audit_note': AUDIT_NOTE,
            }

        wins = [t for t in measured if t['actual_return'] > 0]
        losses = [t for t in measured if t['actual_return'] < 0]
        expired = [t for t in trades if t['status'] == 'EXPIRED' and t['hit_target'] == 0 and t['hit_stop'] == 0]
        tp_hits = [t for t in valid_trades if t['hit_target'] == 1]
        stop_hits = [t for t in valid_trades if t['hit_stop'] == 1]
        hard_capped = [t for t in measured if t['capped']]

        gross_profit = sum(t['actual_return'] for t in wins)
        gross_loss_amount = sum(abs(t['actual_return']) for t in losses)
        pf = (gross_profit / gross_loss_amount) if gross_loss_amount > 0 else (
            float('inf') if gross_profit > 0 else 0.0
        )

        avg_win = (gross_profit / len(wins)) if wins else 0
        avg_loss = (-(gross_loss_amount / len(losses))) if losses else 0  # سالب دائماً
        expectancy = sum(t['actual_return'] for t in measured) / n_valid

        max_loss = min((t['actual_return'] for t in losses), default=0)  # سالب
        max_win = max((t['actual_return'] for t in wins), default=0)

        # by signal type
        by_signal: Dict[str, Dict[str, Any]] = {}
        sig_groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for t in valid_trades:
            sig_groups[t.get('signal_type') or t.get('signal') or 'UNKNOWN'].append(t)
        for sig, group in sig_groups.items():
            sig_measured = [t for t in group if t['actual_return'] is not None and t['actual_return'] != 0]
            sig_wins = [t for t in sig_measured if t['actual_return'] > 0]
            sig_gp = sum(t['actual_return'] for t in sig_wins)
            by_signal[sig] = {
                'total': len(group),
                'targets_hit': len([t for t in group if t['hit_target'] == 1]),
                'avg_return': round(sum(t['actual_return'] for t in sig_measured) / len(sig_measured), 2) if sig_measured else 0,
            }

        # by market
        by_market: Dict[str, Dict[str, Any]] = {}
        mkt_groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for t in trades:
            mkt_groups[t['market']].append(t)
        for mk, group in mkt_groups.items():
            mk_valid = [t for t in group if t['valid']]
            mk_measured = [t for t in mk_valid if t['actual_return'] is not None and t['actual_return'] != 0]
            mk_wins = [t for t in mk_measured if t['actual_return'] > 0]
            mk_losses = [t for t in mk_measured if t['actual_return'] < 0]
            mk_gp = sum(t['actual_return'] for t in mk_wins)
            mk_gl = sum(abs(t['actual_return']) for t in mk_losses)
            mk_pf = (mk_gp / mk_gl) if mk_gl > 0 else (float('inf') if mk_gp > 0 else 0)
            by_market[mk] = {
                'n_raw': len(group),
                'n_valid': len(mk_measured),
                'total': len(group),
                'targets_hit': len([t for t in group if t['hit_target'] == 1]),
                'stops_hit': len([t for t in group if t['hit_stop'] == 1]),
                'win_rate': round((len(mk_wins) / len(mk_measured) * 100), 2) if mk_measured else 0,
                'profit_factor': round(mk_pf, 4) if mk_pf != float('inf') else 0,
                'avg_return': round((mk_gp - mk_gl) / len(mk_measured), 2) if mk_measured else 0,
                'capped_rows': len([t for t in mk_measured if t['capped']]),
            }

        # by_channel (gold standard)
        by_channel: List[Dict[str, Any]] = []
        for ch in ('balanced', 'morning_bell'):
            ch_trades = [t for t in trades if t['channel'] == ch]
            if not ch_trades:
                continue
            ch_valid = [t for t in ch_trades if t['valid']]
            ch_measured = [t for t in ch_valid if t['actual_return'] is not None and t['actual_return'] != 0]
            if not ch_measured:
                by_channel.append({
                    'channel': ch,
                    'n_raw': len(ch_trades),
                    'n_valid': 0,
                    'win_rate': 0,
                    'profit_factor': 0,
                    'expectancy_pct': 0,
                    'max_loss_pct': 0,
                    'capped_rows': len([t for t in ch_valid if t['capped']]),
                })
                continue
            ch_wins = [t for t in ch_measured if t['actual_return'] > 0]
            ch_losses = [t for t in ch_measured if t['actual_return'] < 0]
            ch_gp = sum(t['actual_return'] for t in ch_wins)
            ch_gl = sum(abs(t['actual_return']) for t in ch_losses)
            ch_pf = (ch_gp / ch_gl) if ch_gl > 0 else (float('inf') if ch_gp > 0 else 0)
            ch_max_loss = min((t['actual_return'] for t in ch_losses), default=0)
            by_channel.append({
                'channel': ch,
                'n_raw': len(ch_trades),
                'n_valid': len(ch_measured),
                'wins': len(ch_wins),
                'losses': len(ch_losses),
                'win_rate': round((len(ch_wins) / len(ch_measured) * 100), 2) if ch_measured else 0,
                'profit_factor': round(ch_pf, 4) if ch_pf != float('inf') else 0,
                'expectancy_pct': round((ch_gp - ch_gl) / len(ch_measured), 4),
                'max_loss_pct': round(ch_max_loss, 4),
                'capped_rows': len([t for t in ch_measured if t['capped']]),
            })

        # best / worst
        sorted_by_return = sorted(measured, key=lambda t: t['actual_return'])
        worst_predictions = [
            {'symbol': t['ticker'], 'return': round(t['actual_return'], 4),
             'signal': t.get('signal_type') or t.get('signal') or ''}
            for t in sorted_by_return[:5]
        ]
        best_predictions = [
            {'symbol': t['ticker'], 'return': round(t['actual_return'], 4),
             'signal': t.get('signal_type') or t.get('signal') or ''}
            for t in sorted_by_return[-5:][::-1]
        ]

        # aggregate extras
        avg_holding_days = (sum(t['holding_days'] for t in valid_trades) / len(valid_trades)) if valid_trades else 0
        avg_maestro = (sum(_safe_float(r.get('maestro_score'), 0) for r in raw_rows) / len(raw_rows)) if raw_rows else 0
        avg_confidence = (sum(_safe_float(r.get('confidence'), 0) for r in raw_rows) / len(raw_rows)) if raw_rows else 0
        targets_hit_count = len([t for t in valid_trades if t['hit_target'] == 1])
        stops_hit_count = len([t for t in valid_trades if t['hit_stop'] == 1])
        win_rate_pct = (len(wins) / n_valid * 100) if n_valid > 0 else 0
        hard_capped_count = len(hard_capped)

        return {
            # ---- Gold standard KPI fields ----
            'n_raw': n_raw,
            'n_valid': n_valid,
            'n_excluded': len(excluded),
            'n_open': n_open,
            'exclusion_breakdown': dict(exclusion_breakdown),
            'capped_rows': hard_capped_count,
            'hard_capped_count': hard_capped_count,
            'hard_cap_pct': HARD_CAP_PCT,
            # ---- WR / PF / Expectancy ----
            'win_rate': round(win_rate_pct, 2),
            'profit_factor': round(pf, 4) if pf != float('inf') else 0,
            'expectancy_pct': round(expectancy, 4),
            'avg_win_pct': round(avg_win, 4),
            'avg_loss_pct': round(avg_loss, 4),  # سالب دائماً
            'max_loss_pct': round(max_loss, 4),  # سالب
            'max_win_pct': round(max_win, 4),
            'tp1_hit_rate': round((len(tp_hits) / len(valid_trades) * 100), 2) if valid_trades else 0,
            'stop_hit_rate': round((len(stop_hits) / len(valid_trades) * 100), 2) if valid_trades else 0,
            'expired_rate': round((len(expired) / n_raw * 100), 2) if n_raw > 0 else 0,
            # ---- Legacy-compatible fields ----
            'period_days': days,
            'market': market or 'ALL',
            'total_predictions': n_raw,
            'pending': n_open,
            'evaluated': n_valid,
            'targets_hit': targets_hit_count,
            'stops_hit': stops_hit_count,
            'avg_return': round(expectancy, 2),
            'avg_holding_days': round(avg_holding_days, 1),
            'avg_maestro_score': round(avg_maestro, 1),
            'avg_confidence': round(avg_confidence, 1),
            # ---- Groupings ----
            'by_signal_type': by_signal,
            'by_market': by_market,
            'by_channel': by_channel,
            'best_predictions': best_predictions,
            'worst_predictions': worst_predictions,
            # ---- Audit ----
            'audit_status': AUDIT_STATUS,
            'audit_note': AUDIT_NOTE,
        }

    # ------------------------------------------------------------------
    # Check / Pending / Export — adapted to predictions table
    # ------------------------------------------------------------------
    def check_target_hit(self, prediction_id: str) -> Dict[str, Any]:
        """التحقق من الوصول للهدف — يقرأ من `predictions` table."""
        conn = self._get_predictions_connection()
        try:
            row = conn.execute(
                '''SELECT id, ticker, signal_type, signal, entry_price, target_price,
                          stop_loss, status, market, morning_bell, outcome_date,
                          closed_at, exit_price, actual_exit_price, actual_return,
                          hit_target, hit_stop
                   FROM predictions WHERE id = ?''',
                (prediction_id,)
            ).fetchone()

            if not row:
                return {'error': 'Prediction not found', 'prediction_id': prediction_id}

            d = dict(row)
            symbol = str(d.get('ticker', ''))
            signal_type = str(d.get('signal_type') or d.get('signal') or '')
            entry_price = _safe_float(d.get('entry_price'), 0)
            target_price = _safe_float(d.get('target_price'), 0)
            stop_loss = _safe_float(d.get('stop_loss'), 0)
            status = str(d.get('status') or '')
            market = str(d.get('market') or '')
            morning_bell = int(d.get('morning_bell') or 0)
            channel = 'morning_bell' if morning_bell == 1 else 'balanced'

            current_price = self.get_current_price(symbol, market)
            if current_price is None:
                return {
                    'prediction_id': str(prediction_id),
                    'symbol': symbol,
                    'status': status,
                    'channel': channel,
                    'error': 'Current price unavailable',
                }

            hit_target = False
            hit_stop = False
            if signal_type == 'BUY':
                hit_target = current_price >= target_price
                hit_stop = current_price <= stop_loss
            elif signal_type == 'SELL':
                hit_target = current_price <= target_price
                hit_stop = current_price >= stop_loss

            return {
                'prediction_id': str(prediction_id),
                'symbol': symbol,
                'signal_type': signal_type,
                'entry_price': entry_price,
                'target_price': target_price,
                'stop_loss': stop_loss,
                'current_price': current_price,
                'status': status,
                'channel': channel,
                'hit_target': hit_target,
                'hit_stop': hit_stop,
                'outcome_date': d.get('outcome_date'),
                'distance_to_target_pct': round(((target_price - current_price) / current_price) * 100, 2) if current_price > 0 else 0,
                'distance_to_stop_pct': round(((current_price - stop_loss) / current_price) * 100, 2) if current_price > 0 else 0,
                'audit_status': AUDIT_STATUS,
            }
        finally:
            conn.close()

    def get_pending_predictions(self, market: str = None, limit: int = 100) -> List[Dict]:
        """الحصول على التوقعات النشطة — يقرأ من `predictions` table."""
        conn = self._get_predictions_connection()
        try:
            if market:
                rows = conn.execute(
                    '''SELECT id, ticker, signal_type, signal, entry_price, target_price,
                              stop_loss, prediction_date, market, morning_bell, persona,
                              maestro_score, confidence
                       FROM predictions
                       WHERE status IN ('active', 'ACTIVE', 'PENDING') AND market = ?
                       ORDER BY maestro_score DESC, prediction_date DESC
                       LIMIT ?''',
                    (market, limit)
                ).fetchall()
            else:
                rows = conn.execute(
                    '''SELECT id, ticker, signal_type, signal, entry_price, target_price,
                              stop_loss, prediction_date, market, morning_bell, persona,
                              maestro_score, confidence
                       FROM predictions
                       WHERE status IN ('active', 'ACTIVE', 'PENDING')
                       ORDER BY maestro_score DESC, prediction_date DESC
                       LIMIT ?''',
                    (limit,)
                ).fetchall()

            pending = []
            for r in rows:
                d = dict(r)
                symbol = str(d.get('ticker', ''))
                mkt = str(d.get('market') or '')
                morning_bell = int(d.get('morning_bell') or 0)
                channel = 'morning_bell' if morning_bell == 1 else 'balanced'
                entry_price = _safe_float(d.get('entry_price'), 0)
                target_price = _safe_float(d.get('target_price'), 0)
                stop_loss = _safe_float(d.get('stop_loss'), 0)
                current_price = self.get_current_price(symbol, mkt)

                pending.append({
                    'id': d.get('id'),
                    'symbol': symbol,
                    'signal_type': str(d.get('signal_type') or d.get('signal') or ''),
                    'entry_price': entry_price,
                    'target_price': target_price,
                    'stop_loss': stop_loss,
                    'prediction_date': d.get('prediction_date'),
                    'market': mkt,
                    'channel': channel,
                    'maestro_score': _safe_float(d.get('maestro_score'), 0),
                    'confidence': _safe_float(d.get('confidence'), 0),
                    'current_price': current_price,
                    'potential_return': round(((target_price - entry_price) / entry_price) * 100, 2) if entry_price > 0 else 0,
                    'risk_ratio': round(abs((target_price - entry_price) / (entry_price - stop_loss)), 2) if (entry_price and entry_price != stop_loss) else 0,
                })
            return pending
        finally:
            conn.close()

    def export_report(self, market: str = None, days: int = 30, format: str = 'json') -> str:
        """تصدير تقرير التوقعات."""
        stats = self.get_performance_stats(market, days)
        history = self.get_prediction_history(market, days)

        social_share = {
            'text': 'انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈',
            'links': {
                'website': 'https://invist.m2y.net',
                'android_app': 'https://play.google.com/store/apps/details?id=com.egx.investment',
                'facebook': 'https://www.facebook.com/profile.php?id=61590600300048',
                'telegram': 'https://t.me/Arabian_investment_guide',
            }
        }

        if format == 'json':
            return json.dumps({
                'stats': stats,
                'history': history,
                'exported_at': datetime.now().isoformat(),
                'social_share': social_share,
                'audit_status': AUDIT_STATUS,
                'audit_note': AUDIT_NOTE,
            }, ensure_ascii=False, indent=2, default=str)

        elif format == 'csv':
            import io
            output = io.StringIO()
            output.write('Symbol,Market,Channel,Signal,Entry,Target,Stop,Status,Return,Date,Capped\n')
            for h in history:
                output.write(
                    f'{h.get("ticker","")},{h.get("market","")},{h.get("channel","")},'
                    f'{h.get("signal_type") or h.get("signal") or ""},'
                    f'{h.get("entry_price")},{h.get("target_price")},{h.get("stop_loss")},'
                    f'{h.get("status","")},{h.get("actual_return") or ""},'
                    f'{h.get("prediction_date","")},{int(bool(h.get("capped")))}\n'
                )
            output.write('\n')
            output.write('#' + '=' * 80 + '\n')
            output.write(f'# Audit Status: {AUDIT_STATUS}\n')
            output.write(f'# Audit Note: {AUDIT_NOTE}\n')
            output.write('#' + '=' * 80 + '\n')
            return output.getvalue()

        return ''


# ============================================================================
# Self-test
# ============================================================================

if __name__ == '__main__':
    tracker = EnhancedPredictionTracker()

    print("=" * 70)
    print("Enhanced Prediction Tracker — KPI Aligned to Gold Standard")
    print("=" * 70)
    print(f"audit_status: {AUDIT_STATUS}")
    print(f"predictions_db: {tracker.predictions_db}")
    print(f"data_engine_db: {tracker.data_engine_db}")
    print(f"HARD_CAP_PCT: ±{HARD_CAP_PCT}")
    print()

    print("\n📊 Performance Stats (30 days):")
    stats = tracker.get_performance_stats()
    print(f"  n_raw:         {stats['n_raw']}")
    print(f"  n_valid:       {stats['n_valid']}")
    print(f"  n_excluded:    {stats['n_excluded']}")
    print(f"  exclusion_breakdown: {stats['exclusion_breakdown']}")
    print(f"  capped_rows:   {stats['capped_rows']}")
    print(f"  win_rate:      {stats['win_rate']}%")
    print(f"  profit_factor: {stats['profit_factor']}")
    print(f"  expectancy:    {stats['expectancy_pct']}%")
    print(f"  avg_win_pct:   {stats['avg_win_pct']}%")
    print(f"  avg_loss_pct:  {stats['avg_loss_pct']}%  (must be ≤ 0)")
    print(f"  max_loss_pct:  {stats['max_loss_pct']}%  (must be ≤ 0)")
    print(f"  by_channel:   {stats['by_channel']}")
    print(f"  audit_status:  {stats['audit_status']}")
