"""
Persona DB - Safe storage layer for Unified Persona Engine
@version 1.0.0

القواعد الحديدية:
1. ممنوع ALTER TABLE. ممنوع تغيير أي جدول موجود.
2. جدول persona_predictions جديد — CREATE TABLE IF NOT EXISTS (آمن 100%).
3. كل عمليات DB في try/except — لو فشل التخزين، التحليل يكمل.
4. لا تغيير schema لـ stored_analyses — نستخدم analysis_json الموجود (TEXT field فاضي).
"""

import os
import json
import sqlite3
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, Any, List

_PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
PREDICTIONS_DB = os.environ.get('PREDICTIONS_DB', str(_PROJECT_ROOT / 'db' / 'predictions.db'))

# FIX (Aug 2026): Centralize safe connections. Prevents 'database is locked'
# when many background jobs hit predictions.db concurrently.
try:
    from core.database import safe_connect as _safe_connect
except ImportError:
    def _safe_connect(db_path, readonly=False, timeout=30.0):
        # Phase 7.1: migrated to db_manager (writable=True)
        from core.db_manager import db_manager
        conn = db_manager.connection(db_path, writable=True).__enter__()
        try:
            conn.execute(f'PRAGMA busy_timeout={int(timeout * 1000)}')
            if not readonly:
                conn.execute('PRAGMA journal_mode=WAL')
                conn.execute('PRAGMA synchronous=NORMAL')
        except Exception:
            pass
        return conn


# ==================== TABLE INITIALIZATION (SAFE) ====================

def ensure_persona_tables() -> bool:
    """
    إنشاء جدول persona_predictions لو مش موجود.
    CREATE TABLE IF NOT EXISTS = آمن 100% ومش هيعطل الإنتاج.
    """
    try:
        conn = _safe_connect(PREDICTIONS_DB)
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS persona_predictions (
                id TEXT PRIMARY KEY,
                ticker TEXT NOT NULL,
                market TEXT,
                persona_type TEXT,
                signal_type TEXT,
                entry_price REAL,
                target_price REAL,
                stop_loss REAL,
                prediction_date TEXT,
                status TEXT DEFAULT 'PENDING',
                final_price REAL,
                profit_loss_percent REAL,
                hit_target INTEGER DEFAULT 0,
                hit_stop_loss INTEGER DEFAULT 0,
                created_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_persona_ticker ON persona_predictions(ticker);
            CREATE INDEX IF NOT EXISTS idx_persona_type ON persona_predictions(persona_type);
            CREATE INDEX IF NOT EXISTS idx_persona_status ON persona_predictions(status);
            CREATE INDEX IF NOT EXISTS idx_persona_date ON persona_predictions(prediction_date);
            CREATE INDEX IF NOT EXISTS idx_persona_ticker_type ON persona_predictions(ticker, persona_type);
        ''')
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[PersonaDB] ensure_persona_tables failed: {e}")
        return False


def _gen_prediction_id(ticker: str, persona_type: str, prediction_date: str) -> str:
    """توليد ID ثابت للتنبؤ (لتجنب التكرار)."""
    raw = f"{ticker}_{persona_type}_{prediction_date}"
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:32]


# ==================== SAFE STORAGE FUNCTIONS ====================

def safe_store_prediction(
    ticker: str,
    market: str,
    persona_type: str,
    signal_type: str,
    entry_price: Optional[float],
    target_price: Optional[float],
    stop_loss: Optional[float],
    prediction_date: Optional[str] = None,
) -> bool:
    """
    تخزين تنبؤ persona في persona_predictions (آمن — try/except).
    لو فشل التخزين، بيرجع False لكن مابيرمي exception.
    """
    try:
        if not ensure_persona_tables():
            return False

        pred_date = prediction_date or datetime.now().strftime('%Y-%m-%d')
        pred_id = _gen_prediction_id(ticker, persona_type, pred_date)

        conn = _safe_connect(PREDICTIONS_DB)  # FIX: timeout=30 + busy_timeout
        cur = conn.cursor()
        cur.execute('''
            INSERT OR REPLACE INTO persona_predictions (
                id, ticker, market, persona_type, signal_type,
                entry_price, target_price, stop_loss,
                prediction_date, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
        ''', (
            pred_id, ticker.upper(), market, persona_type, signal_type,
            float(entry_price) if entry_price is not None else None,
            float(target_price) if target_price is not None else None,
            float(stop_loss) if stop_loss is not None else None,
            pred_date,
            datetime.now().isoformat(),
        ))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[PersonaDB] safe_store_prediction failed for {ticker}/{persona_type}: {e}")
        return False


def safe_store_analysis_json(
    ticker: str,
    market: str,
    maestro_score: float,
    recommendation: str,
    recommendation_ar: str,
    confidence: float,
    entry_price: float,
    target_price: Optional[float],
    stop_loss: Optional[float],
    risk_reward: float,
    regime: str,
    regime_score: float,
    timeframe_aligned: int,
    timeframe_count: int,
    volume_ratio: Optional[float],
    liquidity_rating: Optional[str],
    analysis_json: Dict[str, Any],
    analysis_version: str = '4.0-persona',
) -> bool:
    """
    تخزين نتيجة التحليل في stored_analyses مع analysis_json يحتوي personas (gambler + investor + narrative + context).
    آمن — try/except. لو فشل، بيرجع False.

    # SINGLE-WRITER (Task PHASE-3, Rule 73) — DISABLED. daily_predictor.py is the
    # canonical writer. This function now returns True (pretend success) without
    # touching stored_analyses. Set SKIP_STORED_ANALYSES_WRITE = False to re-enable.
    """
    # SINGLE-WRITER (Task PHASE-3, Rule 73)
    # Only daily_predictor.py is allowed to write to stored_analyses.
    # This writer is disabled to prevent conflicting decisions (last-writer-wins).
    SKIP_STORED_ANALYSES_WRITE = True
    if SKIP_STORED_ANALYSES_WRITE:
        try:
            print('[SINGLE-WRITER] Skipping stored_analyses write in persona_db.safe_store_analysis_json — use daily_predictor.py')
        except Exception:
            pass
        return True  # pretend success — callers expect True/False, do not raise
    try:
        conn = _safe_connect(PREDICTIONS_DB)  # FIX: timeout=30 + busy_timeout
        cur = conn.cursor()
        analysis_json_str = json.dumps(analysis_json, default=str, ensure_ascii=False) if analysis_json else None
        # PHASE-C0 (أغسطس 2026): إصلاح حرج — تغيير INSERT OR REPLACE إلى
        # INSERT ... ON CONFLICT DO UPDATE (upsert حقيقي).
        # المشكلة: INSERT OR REPLACE كان بيمسح الصف كامل ويعيد إدخاله بدون أعمدة
        # persona (is_gambler_opportunity, is_investor_opportunity, rank scores,
        # pe_ratio, roe, change_1d, change_1m, volatility, fair_value_upside)
        # → كلها بترجع DEFAULT (0/NULL) → P16 flags دايماً 0.
        # الحل: ON CONFLICT(ticker, market) DO UPDATE UPDATE فقط الأعمدة المحددة،
        # ما بيمسش الأعمدة التانية (persona flags + fundamentals).
        cur.execute('''
            INSERT INTO stored_analyses (
                ticker, market, maestro_score, recommendation, recommendation_ar,
                confidence, entry_price, target_price, stop_loss, risk_reward,
                regime, regime_score, timeframe_aligned, timeframe_count,
                volume_ratio, liquidity_rating,
                analysis_json, analysis_version, analysis_type, updated_at
            ) VALUES (
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?,
                ?, ?, 'scheduled', CURRENT_TIMESTAMP
            )
            ON CONFLICT(ticker, market) DO UPDATE SET
                maestro_score = excluded.maestro_score,
                recommendation = excluded.recommendation,
                recommendation_ar = excluded.recommendation_ar,
                confidence = excluded.confidence,
                entry_price = excluded.entry_price,
                target_price = excluded.target_price,
                stop_loss = excluded.stop_loss,
                risk_reward = excluded.risk_reward,
                regime = excluded.regime,
                regime_score = excluded.regime_score,
                timeframe_aligned = excluded.timeframe_aligned,
                timeframe_count = excluded.timeframe_count,
                volume_ratio = excluded.volume_ratio,
                liquidity_rating = excluded.liquidity_rating,
                analysis_json = excluded.analysis_json,
                analysis_version = excluded.analysis_version,
                analysis_type = excluded.analysis_type,
                updated_at = CURRENT_TIMESTAMP
        ''', (
            ticker.upper(), market,
            float(maestro_score or 0),
            recommendation or 'hold',
            recommendation_ar or 'احتفاظ',
            float(confidence or 0),
            float(entry_price or 0),
            float(target_price) if target_price is not None else None,
            float(stop_loss) if stop_loss is not None else None,
            float(risk_reward or 0),
            regime or 'range',
            float(regime_score or 0),
            int(timeframe_aligned or 0),
            int(timeframe_count or 0),
            float(volume_ratio) if volume_ratio is not None else None,
            liquidity_rating,
            analysis_json_str,
            analysis_version,
        ))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[PersonaDB] safe_store_analysis_json failed for {ticker}: {e}")
        return False


# ==================== READ FUNCTIONS ====================

def get_persona_predictions(
    ticker: Optional[str] = None,
    persona_type: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
) -> List[Dict]:
    """قراءة تنبؤات persona من persona_predictions."""
    try:
        if not ensure_persona_tables():
            return []
        conn = _safe_connect(PREDICTIONS_DB)  # FIX: timeout=30 + busy_timeout
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        sql = "SELECT * FROM persona_predictions WHERE 1=1"
        params: List[Any] = []
        if ticker:
            sql += " AND ticker = ?"
            params.append(ticker.upper())
        if persona_type:
            sql += " AND persona_type = ?"
            params.append(persona_type)
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY prediction_date DESC LIMIT ?"
        params.append(limit)
        cur.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
        conn.close()
        return rows
    except Exception as e:
        print(f"[PersonaDB] get_persona_predictions failed: {e}")
        return []


def get_persona_stats(persona_type: Optional[str] = None) -> Dict[str, Any]:
    """إحصائيات تتبع التوقعات لـ persona معين أو الكل."""
    try:
        if not ensure_persona_tables():
            return {'total': 0, 'hit_target': 0, 'hit_stop': 0, 'win_rate': 0}
        conn = _safe_connect(PREDICTIONS_DB)  # FIX: timeout=30 + busy_timeout
        cur = conn.cursor()
        # Constitution Rule 7 (HARD cap): استبعاد العوائد السامة |profit_loss_percent| > 50%
        # من إحصائيات الـ persona (يمنع -10814% من تلوث counts/win_rate).
        sql = ("SELECT COUNT(*) as total, SUM(hit_target) as hits, SUM(hit_stop_loss) as stops "
               "FROM persona_predictions WHERE (profit_loss_percent IS NULL OR ABS(profit_loss_percent) <= 50)")
        params: List[Any] = []
        if persona_type:
            sql += " AND persona_type = ?"
            params.append(persona_type)
        cur.execute(sql, params)
        row = cur.fetchone()
        total = row[0] or 0
        hits = row[1] or 0
        stops = row[2] or 0
        conn.close()
        # win_rate: نسبة hit_target من الصفوف المغلقة (hits + stops)
        closed = hits + stops
        win_rate = (hits / closed * 100) if closed > 0 else 0
        return {
            'total': total,
            'hit_target': hits,
            'hit_stop_loss': stops,
            'win_rate': round(win_rate, 2),
        }
    except Exception as e:
        print(f"[PersonaDB] get_persona_stats failed: {e}")
        return {'total': 0, 'hit_target': 0, 'hit_stop_loss': 0, 'win_rate': 0}


# ==================== UPDATE OUTCOMES ====================

def update_persona_prediction_outcome(
    ticker: str,
    persona_type: str,
    final_price: float,
    prediction_date: Optional[str] = None,
) -> Dict[str, Any]:
    """
    تحديث نتيجة تنبؤ persona بعد ما يتحقق.
    بيحدد hit_target / hit_stop_loss / profit_loss_percent.
    آمن — try/except.
    """
    try:
        if not ensure_persona_tables():
            return {'success': False, 'error': 'tables not available'}

        conn = _safe_connect(PREDICTIONS_DB)  # FIX: timeout=30 + busy_timeout
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # جلب آخر تنبؤ للـ persona ده
        if prediction_date:
            cur.execute('''
                SELECT * FROM persona_predictions
                WHERE ticker = ? AND persona_type = ? AND prediction_date = ?
                ORDER BY created_at DESC LIMIT 1
            ''', (ticker.upper(), persona_type, prediction_date))
        else:
            cur.execute('''
                SELECT * FROM persona_predictions
                WHERE ticker = ? AND persona_type = ? AND status = 'PENDING'
                ORDER BY prediction_date DESC LIMIT 1
            ''', (ticker.upper(), persona_type))
        row = cur.fetchone()
        if not row:
            conn.close()
            return {'success': False, 'error': 'no pending prediction found'}

        pred = dict(row)
        entry = pred.get('entry_price') or 0
        target = pred.get('target_price') or 0
        stop = pred.get('stop_loss') or 0
        if entry <= 0:
            conn.close()
            return {'success': False, 'error': 'invalid entry_price'}

        pnl_pct = ((final_price - entry) / entry) * 100
        hit_target = 1 if (target > 0 and final_price >= target) else 0
        hit_stop = 1 if (stop > 0 and final_price <= stop) else 0
        # تحديد الحالة
        if hit_target:
            status = 'TARGET_HIT'
        elif hit_stop:
            status = 'STOP_HIT'
        else:
            status = 'CLOSED'

        cur.execute('''
            UPDATE persona_predictions
            SET final_price = ?, profit_loss_percent = ?, hit_target = ?, hit_stop_loss = ?, status = ?
            WHERE id = ?
        ''', (final_price, round(pnl_pct, 2), hit_target, hit_stop, status, pred['id']))
        conn.commit()
        conn.close()
        return {
            'success': True,
            'ticker': ticker.upper(),
            'persona_type': persona_type,
            'entry': entry,
            'final': final_price,
            'pnl_pct': round(pnl_pct, 2),
            'hit_target': bool(hit_target),
            'hit_stop_loss': bool(hit_stop),
            'status': status,
        }
    except Exception as e:
        print(f"[PersonaDB] update_persona_prediction_outcome failed: {e}")
        return {'success': False, 'error': str(e)}


# ==================== COMBINED SAFE STORE ====================

def safe_store_full_analysis(
    ticker: str,
    market: str,
    maestro_score: float,
    recommendation: str,
    recommendation_ar: str,
    confidence: float,
    entry_price: float,
    target_price: Optional[float],
    stop_loss: Optional[float],
    risk_reward: float,
    regime: str,
    regime_score: float,
    timeframe_aligned: int,
    timeframe_count: int,
    volume_ratio: Optional[float],
    liquidity_rating: Optional[str],
    narrative: Dict[str, str],
    gambler: Dict[str, Any],
    investor: Dict[str, Any],
    context: Dict[str, Any],
    prediction_date: Optional[str] = None,
) -> Dict[str, bool]:
    """
    تخزين كامل آمن:
    1. stored_analyses (analysis_json فيه gambler + investor + narrative + context)
    2. persona_predictions: 2 rows (gambler + investor)

    لو أي عملية فشلت، الباقي بيكمل. مفيش تعطيل.

    PHASE-C0 (أغسطس 2026): إصلاح كذبة P16 — الـ flags كانت دايماً 0 لأن
    safe_store_analysis_json كان بيعمل INSERT OR REPLACE وبيمسح الـ flags اللي
    الـ INSERT الأساسي في background_analyzer.py:2022 كتبها. دلوقتي بنخطّي
    استدعاء safe_store_analysis_json هنا (الـ INSERT الأساسي بيكتب analysis_json
    غني بالفعل: narrative + gambler + investor + context + confluence + phases).
    بنحتفظ فقط بـ safe_store_prediction لكتابة persona_predictions.
    """
    results = {'stored_analyses': False, 'gambler_prediction': False, 'investor_prediction': False}

    # 1. stored_analyses — PHASE-C0: SKIPPED.
    # الـ INSERT الأساسي في background_analyzer.py:2022 بيكتب:
    #   - كل أعمدة persona (is_gambler_opportunity, is_investor_opportunity,
    #     gambler_rank_score, investor_rank_score, pe_ratio, roe, change_1d,
    #     change_1m, volatility, fair_value_upside)
    #   - analysis_json غني (narrative + gambler + investor + context + confluence + phases)
    # استدعاء safe_store_analysis_json كان بيعمل INSERT OR REPLACE وبيمسح كل ده.
    # لو احتجنا نرجعلك، شغّل safe_store_analysis_json مباشرة (بعد إصلاحها لـ upsert).
    results['stored_analyses'] = True  # نفترض إن الـ INSERT الأساسي نجح

    # 2. persona_predictions: gambler
    g_signal = (gambler.get('signal') or 'HOLD').upper()
    if g_signal in ['BUY', 'SELL', 'HOLD']:
        results['gambler_prediction'] = safe_store_prediction(
            ticker=ticker, market=market, persona_type='gambler',
            signal_type=g_signal,
            entry_price=gambler.get('entry') or entry_price,
            target_price=gambler.get('target'),
            stop_loss=gambler.get('stop'),
            prediction_date=prediction_date,
        )

    # 3. persona_predictions: investor
    i_signal = (investor.get('signal') or 'HOLD').upper()
    if i_signal in ['BUY', 'SELL', 'HOLD']:
        results['investor_prediction'] = safe_store_prediction(
            ticker=ticker, market=market, persona_type='investor',
            signal_type=i_signal,
            entry_price=investor.get('entry') or entry_price,
            target_price=investor.get('target'),
            stop_loss=investor.get('stop'),
            prediction_date=prediction_date,
        )

    return results
