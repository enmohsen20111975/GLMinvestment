#!/usr/bin/env python3
"""
scripts/run_quick_analysis.py
=============================
RECOMMENDATIONS-FIX-022 (يوليو 2026)

سكربت يشغّل تحليل سريع لـ 50 سهم EGX نشط (حسب turnover) باستخدام
MaestroOrchestrator.analyze() مباشرة (نفس المنطق المستخدم في الإنتاج)
ويخزّن النتائج في:

  1. stored_analyses        (predictions.db) — maestro_score + recommendation + analysis_json
  2. cached_analysis        (stocks.db)        — master_score + signal + target/stop
  3. persona_predictions    (predictions.db) — gambler + investor rows

النتيجة: الـ endpoint /api/stored-analysis/results + /api/v2/recommend
بيرجعوا توصيات حقيقية بدل ما يكونوا فاضيين.

ملاحظة: بيتخطّى فلتر الـ 10-candle و MIN_TURNOVER_EGP اللي في
BackgroundAnalyzer._analyze_and_store عشان نضمن إن النتائج تتخزّن حتى
لو history قصير (load_merged_history بيرجع شمعة واحدة بس من price_history.db
لأن stock_daily_prices مش متصل بيه مباشرة).

Usage:
    python3 scripts/run_quick_analysis.py            # default 50 stocks EGX
    python3 scripts/run_quick_analysis.py --limit 100 --market EGX
    python3 scripts/run_quick_analysis.py --ticker COMI   # سهم واحد
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

# Project root + vps-service on path
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_VPS_ROOT = _PROJECT_ROOT / 'vps-service'
for p in (_PROJECT_ROOT, _VPS_ROOT):
    sp = str(p)
    if sp not in sys.path:
        sys.path.insert(0, sp)

STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')


def _parse_volume(v: Any) -> int:
    """Parse '5.29 M' → 5290000, '14.62 K' → 14620, etc."""
    if v is None:
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip().replace('\u202f', '').replace(' ', '').replace(',', '')
    if not s or s == '-':
        return 0
    mult = 1
    if s.endswith('B'):
        mult = 1_000_000_000
        s = s[:-1]
    elif s.endswith('M'):
        mult = 1_000_000
        s = s[:-1]
    elif s.endswith('K'):
        mult = 1_000
        s = s[:-1]
    try:
        return int(float(s) * mult)
    except (ValueError, TypeError):
        return 0


def get_top_active_stocks(market: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Get top active stocks by turnover (price * volume) — must have price history."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    # JOIN with stock_daily_prices to ensure we only get stocks WITH price history.
    # Sort by turnover (price × parsed_volume) DESC. We can't multiply in SQL because
    # volume is stored as TEXT ("5.29 M"), so we sort in Python after parsing.
    if market.upper() == 'EGX':
        cur.execute('''
            SELECT s.ticker, s.name, s.name_ar, s.current_price, s.volume, s.market, s.sector,
                   COUNT(d.ticker) as hist_count
            FROM stocks s
            INNER JOIN stock_daily_prices d ON d.ticker = s.ticker
            WHERE (s.market = 'EGX' OR s.market IS NULL)
              AND s.current_price > 0
              AND (s.is_active = 1 OR s.is_active IS NULL)
              AND s.volume IS NOT NULL AND s.volume != '' AND s.volume != '0'
            GROUP BY s.ticker
            HAVING hist_count > 0
        ''')
    else:
        cur.execute('''
            SELECT s.ticker, s.name, s.name_ar, s.current_price, s.volume, s.market, s.sector,
                   COUNT(d.ticker) as hist_count
            FROM stocks s
            INNER JOIN stock_daily_prices d ON d.ticker = s.ticker
            WHERE s.market = ?
              AND s.current_price > 0
              AND (s.is_active = 1 OR s.is_active IS NULL)
              AND s.volume IS NOT NULL AND s.volume != '' AND s.volume != '0'
            GROUP BY s.ticker
            HAVING hist_count > 0
        ''', (market,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    # Sort by turnover (price × parsed_volume) desc
    rows.sort(key=lambda r: (r.get('current_price') or 0) * _parse_volume(r.get('volume')), reverse=True)
    return rows[:limit]


def count_stored() -> Dict[str, int]:
    """Count rows in stored_analyses, cached_analysis, persona_predictions."""
    out = {'stored_analyses': 0, 'cached_analysis': 0, 'persona_predictions': 0}
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        c = db_manager.connection(PREDICTIONS_DB, writable=False).__enter__()
        cur = c.cursor()
        cur.execute('SELECT COUNT(*) FROM stored_analyses')
        out['stored_analyses'] = cur.fetchone()[0]
        cur.execute('SELECT COUNT(*) FROM persona_predictions')
        out['persona_predictions'] = cur.fetchone()[0]
        c.close()
    except Exception as e:
        print(f'[count] predictions.db error: {e}')
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        c = db_manager.connection(STOCKS_DB, writable=False).__enter__()
        cur = c.cursor()
        cur.execute('SELECT COUNT(*) FROM cached_analysis')
        out['cached_analysis'] = cur.fetchone()[0]
        c.close()
    except Exception as e:
        print(f'[count] stocks.db error: {e}')
    return out


# ============================================================================
# Custom analyze + store (bypasses the 10-candle filter in BG analyzer)
# ============================================================================

def _load_history(ticker: str) -> List[Dict[str, Any]]:
    """Load history: try load_merged_history first, fallback to stock_daily_prices."""
    try:
        from analyzers.master_analyzer import load_merged_history
        hist = load_merged_history(ticker, STOCKS_DB, limit=120)
        if hist and len(hist) >= 1:
            return hist
    except Exception as e:
        print(f'  [hist] load_merged_history failed for {ticker}: {e}')

    # Fallback: read from stock_daily_prices directly
    hist = []
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute('''
            SELECT price_date as date, close as close_price, high as high_price,
                   low as low_price, open as open_price, volume
            FROM stock_daily_prices
            WHERE ticker = ? AND close IS NOT NULL AND close > 0
            ORDER BY price_date DESC
            LIMIT 120
        ''', (ticker.upper(),))
        rows = [dict(r) for r in cur.fetchall()]
        hist = list(reversed(rows))
        conn.close()
    except Exception as e:
        print(f'  [hist] stock_daily_prices fallback failed for {ticker}: {e}')
    return hist


def _ensure_stored_analyses_columns(conn):
    """Make sure stored_analyses has the columns we want to write."""
    cur = conn.cursor()
    cur.execute('PRAGMA table_info(stored_analyses)')
    cols = {r[1] for r in cur.fetchall()}
    needed = {
        'turnover_egp': 'REAL',
        'volume_ratio': 'REAL',
        'liquidity_rating': 'TEXT',
        'regime': 'TEXT',
        'regime_score': 'REAL',
        'timeframe_aligned': 'INTEGER',
        'timeframe_count': 'INTEGER',
        'analysis_json': 'TEXT',
        'analysis_version': 'TEXT',
        'analysis_type': 'TEXT',
        'updated_at': 'TEXT',
    }
    for col, typ in needed.items():
        if col not in cols:
            try:
                cur.execute(f'ALTER TABLE stored_analyses ADD COLUMN {col} {typ}')
            except sqlite3.OperationalError:
                pass
    conn.commit()


def _ensure_cached_analysis_columns(conn):
    """Make sure cached_analysis has the columns we want to write."""
    cur = conn.cursor()
    cur.execute('PRAGMA table_info(cached_analysis)')
    cols = {r[1] for r in cur.fetchall()}
    needed = {
        'target_price': 'REAL',
        'stop_loss': 'REAL',
        'current_price': 'REAL',
        'confidence': 'REAL',
        'updated_at': 'TEXT',
        'risk_reward': 'REAL',
        'entry_price': 'REAL',
        'technical_score': 'REAL',
        'fundamental_score': 'REAL',
        'timing_score': 'REAL',
        'pattern_score': 'REAL',
        'market_regime_score': 'REAL',
        'liquidity_level': 'TEXT',
        'is_tradeable': 'INTEGER',
        'market': 'TEXT',
        'analysis_date': 'TEXT',
        'analysis_json': 'TEXT',
    }
    for col, typ in needed.items():
        if col not in cols:
            try:
                cur.execute(f'ALTER TABLE cached_analysis ADD COLUMN {col} {typ}')
            except sqlite3.OperationalError:
                pass
    conn.commit()


def _store_result(
    result,
    market: str,
    history: List[Dict[str, Any]],
    stock_data: Dict[str, Any],
) -> Dict[str, bool]:
    """
    Store MaestroResult in:
      1. stored_analyses (predictions.db)
      2. cached_analysis (stocks.db)
      3. persona_predictions (predictions.db) — via safe_store_full_analysis

    Returns dict with success flags.
    """
    out = {'stored_analyses': False, 'cached_analysis': False, 'persona_predictions': False}
    ticker = (getattr(result, 'ticker', '') or '').upper()
    if not ticker:
        return out

    rec = (getattr(result, 'recommendation', '') or 'hold').lower()
    rec_ar = getattr(result, 'recommendation_ar', '') or ('شراء' if 'buy' in rec else 'بيع' if 'sell' in rec else 'احتفاظ')
    score = float(getattr(result, 'maestro_score', 0) or 0)
    confidence = float(getattr(result, 'confidence', 50) or 50)
    entry = float(getattr(result, 'entry_price', 0) or 0)
    target = getattr(result, 'target', None)
    stop = getattr(result, 'stop_loss', None)
    rr = float(getattr(result, 'risk_reward', 0) or 0)

    # Normalize target/stop to floats (or None)
    try:
        target_f = float(target) if target is not None else None
    except (TypeError, ValueError):
        target_f = None
    try:
        stop_f = float(stop) if stop is not None else None
    except (TypeError, ValueError):
        stop_f = None

    # Compute R/R if missing
    if (rr == 0 or rr is None) and entry > 0 and target_f and stop_f:
        risk = entry - stop_f
        reward = target_f - entry
        if risk > 0 and reward > 0:
            rr = round(reward / risk, 2)

    # Build analysis_json with gambler + investor objects
    gambler = getattr(result, 'gambler', None) or {}
    investor = getattr(result, 'investor', None) or {}
    narrative = getattr(result, 'persona_narrative', None) or {}

    # Heal persona objects: ensure they have entry/target/stop/signal/verdict.
    # RECOMMENDATIONS-FIX-022: حتى لو الـ persona engine رجّع entry=None (لأن الإشارة
    # HOLD)، نعبّي entry/target/stop من الـ master values عشان الواجهة تقدر تعرض
    # أرقام حقيقية بدل ما تكون None.
    def _heal_persona(p: Dict[str, Any], persona: str) -> Dict[str, Any]:
        if not isinstance(p, dict):
            p = {}
        # Ensure required keys exist
        p.setdefault('verdict', 'انتظر')
        p.setdefault('signal', 'HOLD')
        p.setdefault('score', score)
        p.setdefault('timeframe', '6-12 شهر' if persona == 'investor' else 'يومي-أسبوعي')
        p.setdefault('reason', '')
        p.setdefault('conditions', [])
        # Override None entry/target/stop with master values (so UI shows numbers)
        if p.get('entry') is None and entry > 0:
            p['entry'] = entry
        if p.get('target') is None and target_f is not None:
            p['target'] = target_f
        if p.get('stop') is None and stop_f is not None:
            p['stop'] = stop_f
        # Always set rr if missing
        if not p.get('rr') and rr:
            p['rr'] = rr
        return p

    gambler = _heal_persona(gambler, 'gambler')
    investor = _heal_persona(investor, 'investor')

    analysis_json = {
        'narrative': narrative,
        'gambler': gambler,
        'investor': investor,
        'context': {},
        # Convenience top-level fields for the frontend
        'maestro_score': score,
        'recommendation': rec,
        'recommendation_ar': rec_ar,
        'entry_price': entry,
        'target_price': target_f,
        'stop_loss': stop_f,
        'risk_reward': rr,
        'confidence': confidence,
    }

    analysis_json_str = json.dumps(analysis_json, default=str, ensure_ascii=False)

    # ── 1. stored_analyses (predictions.db) ──
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(PREDICTIONS_DB, writable=False).__enter__()
        _ensure_stored_analyses_columns(conn)
        cur = conn.cursor()
        # Compute turnover from last candle
        last_candle = history[-1] if history else {}
        last_close = float(last_candle.get('close', last_candle.get('close_price', 0)) or 0)
        last_volume = float(last_candle.get('volume', 0) or 0)
        try:
            from utils.helpers import parse_volume as _parse_vol
            last_volume = float(_parse_vol(last_volume) or 0)
        except Exception:
            pass
        turnover_egp = last_close * last_volume

        # Determine regime from result (or default)
        phases = getattr(result, 'phases', None) or {}
        regime_phase = phases.get('regime', {}) if isinstance(phases, dict) else {}
        regime = regime_phase.get('phase', 'range') if regime_phase else 'range'
        regime_score = regime_phase.get('score', 50) if regime_phase else 50
        tf_phase = phases.get('timeframe', {}) if isinstance(phases, dict) else {}
        tf_aligned = 1 if tf_phase.get('aligned', False) else 0
        tf_count = tf_phase.get('aligned_count', 1) if tf_phase else 1
        vol_phase = phases.get('volume', {}) if isinstance(phases, dict) else {}
        vol_ratio = vol_phase.get('volume_ratio', 1.0) if vol_phase else 1.0
        liquidity = vol_phase.get('liquidity_rating', 'NORMAL') if vol_phase else 'NORMAL'

        cur.execute('''
            INSERT OR REPLACE INTO stored_analyses (
                ticker, market, maestro_score, recommendation, recommendation_ar,
                confidence, entry_price, target_price, stop_loss, risk_reward,
                regime, regime_score, timeframe_aligned, timeframe_count,
                volume_ratio, liquidity_rating,
                analysis_json, analysis_version, analysis_type, turnover_egp, updated_at
            ) VALUES (
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?,
                ?, '4.0-persona', 'scheduled', ?, CURRENT_TIMESTAMP
            )
        ''', (
            ticker, market, score, rec, rec_ar,
            confidence, entry, target_f, stop_f, rr,
            regime, regime_score, tf_aligned, tf_count,
            vol_ratio, liquidity,
            analysis_json_str, float(turnover_egp) if turnover_egp else None,
        ))
        conn.commit()
        conn.close()
        out['stored_analyses'] = True
    except Exception as e:
        print(f'  [store] stored_analyses error for {ticker}: {e}')

    # ── 2. cached_analysis (stocks.db) ──
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
        _ensure_cached_analysis_columns(conn)
        cur = conn.cursor()
        # Ensure table exists (legacy)
        cur.execute('''
            CREATE TABLE IF NOT EXISTS cached_analysis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                analysis_date TEXT NOT NULL,
                analysis_json TEXT NOT NULL,
                signal TEXT,
                master_score REAL,
                technical_score REAL,
                fundamental_score REAL,
                timing_score REAL,
                pattern_score REAL,
                market_regime_score REAL,
                liquidity_level TEXT,
                is_tradeable INTEGER DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(ticker, analysis_date)
            )
        ''')
        conn.commit()

        signal_upper = rec.upper()
        # Map: 'strong_buy' → 'STRONG_BUY', etc.
        if signal_upper not in ('BUY', 'STRONG_BUY', 'SELL', 'STRONG_SELL', 'HOLD'):
            signal_upper = 'BUY' if 'buy' in rec else 'SELL' if 'sell' in rec else 'HOLD'

        cached_data = {
            'ticker': ticker,
            'signal': signal_upper,
            'signal_ar': rec_ar,
            'master_score': score,
            'technical_score': float(getattr(result, 'technical_score', 50) or 50),
            'fundamental_score': float(getattr(result, 'fundamental_score', 50) or 50),
            'timing_score': 50,
            'pattern_score': 50,
            'market_regime_score': float(regime_score),
            'liquidity_level': liquidity,
            'is_tradeable': 1,
            'entry_price': entry,
            'target_price': target_f,
            'stop_loss': stop_f,
            'risk_reward': rr,
            'market': market,
            'confidence': confidence,
        }

        today_str = datetime.now().strftime('%Y-%m-%d')
        cached_json_str = json.dumps(cached_data, default=str, ensure_ascii=False)

        cur.execute('''
            INSERT OR REPLACE INTO cached_analysis
            (ticker, analysis_date, analysis_json, signal, master_score,
             technical_score, fundamental_score, timing_score, pattern_score,
             market_regime_score, liquidity_level, is_tradeable, created_at,
             target_price, stop_loss, current_price, confidence, updated_at,
             risk_reward, entry_price, market)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)
        ''', (
            ticker, today_str, cached_json_str,
            cached_data['signal'], cached_data['master_score'],
            cached_data['technical_score'], cached_data['fundamental_score'],
            cached_data['timing_score'], cached_data['pattern_score'],
            cached_data['market_regime_score'], cached_data['liquidity_level'],
            1, datetime.now().isoformat(),
            target_f, stop_f, entry, confidence,
            rr, entry, market,
        ))
        conn.commit()
        conn.close()
        out['cached_analysis'] = True
    except Exception as e:
        print(f'  [store] cached_analysis error for {ticker}: {e}')

    # ── 3. persona_predictions (predictions.db) ──
    try:
        from core.persona_db import safe_store_full_analysis
        # Ensure tables exist
        try:
            from core.persona_db import init_persona_tables
            init_persona_tables()
        except Exception:
            pass

        safe_store_full_analysis(
            ticker=ticker,
            market=market,
            maestro_score=score,
            recommendation=rec,
            recommendation_ar=rec_ar,
            confidence=confidence,
            entry_price=entry,
            target_price=target_f,
            stop_loss=stop_f,
            risk_reward=rr,
            regime=regime,
            regime_score=regime_score,
            timeframe_aligned=tf_aligned,
            timeframe_count=tf_count,
            volume_ratio=vol_ratio,
            liquidity_rating=liquidity,
            narrative=narrative,
            gambler=gambler,
            investor=investor,
            context={},
        )
        out['persona_predictions'] = True
    except Exception as e:
        print(f'  [store] persona_predictions error for {ticker}: {e}')

    return out


def main():
    parser = argparse.ArgumentParser(description='Quick background analysis for EGX stocks')
    parser.add_argument('--limit', type=int, default=50, help='Number of stocks to analyze (default 50)')
    parser.add_argument('--market', type=str, default='EGX', help='Market code (default EGX)')
    parser.add_argument('--ticker', type=str, default=None, help='Analyze a single ticker instead')
    parser.add_argument('--verbose', action='store_true', help='Print per-ticker progress')
    args = parser.parse_args()

    print('=' * 70)
    print('🚀 RECOMMENDATIONS-FIX-022 — Quick Background Analysis')
    print('=' * 70)
    print(f'  stocks DB:       {STOCKS_DB}')
    print(f'  predictions DB:  {PREDICTIONS_DB}')
    print(f'  market:          {args.market}')
    print(f'  limit:           {args.limit}')
    if args.ticker:
        print(f'  single ticker:   {args.ticker}')
    print()

    before = count_stored()
    print(f'📊 Before: stored_analyses={before["stored_analyses"]}, '
          f'cached_analysis={before["cached_analysis"]}, '
          f'persona_predictions={before["persona_predictions"]}')
    print()

    # Lazy import (heavy)
    from analyzers.maestro_orchestrator import MaestroOrchestrator

    maestro = MaestroOrchestrator(db_path=STOCKS_DB)
    if not maestro:
        print('❌ MaestroOrchestrator failed to initialize — abort.')
        sys.exit(2)

    if args.ticker:
        # Single ticker mode — fetch from DB
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute('SELECT * FROM stocks WHERE ticker = ?', (args.ticker.upper(),))
        row = cur.fetchone()
        conn.close()
        if not row:
            print(f'❌ Ticker {args.ticker} not found in stocks table')
            sys.exit(3)
        stocks_to_analyze = [dict(row)]
    else:
        stocks_to_analyze = get_top_active_stocks(args.market, args.limit)
        if not stocks_to_analyze:
            print(f'❌ No active stocks found for market={args.market}')
            sys.exit(3)

    print(f'📦 Analyzing {len(stocks_to_analyze)} stocks...')
    print('-' * 70)

    analyzed_ok = 0
    analyzed_buy = 0
    errors = 0
    started = time.time()

    for i, s in enumerate(stocks_to_analyze, 1):
        ticker = (s.get('ticker') or '').upper()
        if not ticker:
            continue
        try:
            stock_data = s
            # Load history (with fallback)
            history = _load_history(ticker)
            if not history:
                if args.verbose:
                    print(f'  [{i:>3}/{len(stocks_to_analyze)}] {ticker:<8} — SKIP (no history)')
                continue

            # Run orchestrator.analyze directly
            result = maestro.analyze(ticker, stock_data, history, options={})
            if result is None:
                if args.verbose:
                    print(f'  [{i:>3}/{len(stocks_to_analyze)}] {ticker:<8} — SKIP (orchestrator returned None)')
                continue

            # Store the result
            store_flags = _store_result(result, args.market, history, stock_data)

            analyzed_ok += 1
            rec = (getattr(result, 'recommendation', '') or '').lower()
            score_val = float(getattr(result, 'maestro_score', 0) or 0)
            if rec in ('buy', 'strong_buy', 'swing_buy', 't1_buy'):
                analyzed_buy += 1
            if args.verbose or (i % 10 == 0):
                flags_str = ('S' if store_flags['stored_analyses'] else '.') + \
                             ('C' if store_flags['cached_analysis'] else '.') + \
                             ('P' if store_flags['persona_predictions'] else '.')
                print(f'  [{i:>3}/{len(stocks_to_analyze)}] {ticker:<8} [{flags_str}] rec={rec:<12} '
                      f'score={score_val:>5.1f} entry={getattr(result, "entry_price", 0)} '
                      f'target={getattr(result, "target", 0)} stop={getattr(result, "stop_loss", 0)}')
        except Exception as e:
            errors += 1
            print(f'  [{i:>3}/{len(stocks_to_analyze)}] {ticker:<8} — ERROR: {e}')

    elapsed = time.time() - started
    print('-' * 70)
    print(f'⏱️  Elapsed: {elapsed:.1f}s ({elapsed / max(analyzed_ok, 1):.2f}s per stock)')
    print(f'✅ Analyzed OK: {analyzed_ok}')
    print(f'📈 Buy signals: {analyzed_buy}')
    if errors:
        print(f'⚠️  Errors: {errors}')

    print()
    after = count_stored()
    print(f'📊 After:  stored_analyses={after["stored_analyses"]}, '
          f'cached_analysis={after["cached_analysis"]}, '
          f'persona_predictions={after["persona_predictions"]}')
    print()
    delta_stored = after['stored_analyses'] - before['stored_analyses']
    delta_cached = after['cached_analysis'] - before['cached_analysis']
    delta_persona = after['persona_predictions'] - before['persona_predictions']
    print(f'Δ stored_analyses:      {delta_stored:+d}')
    print(f'Δ cached_analysis:      {delta_cached:+d}')
    print(f'Δ persona_predictions:  {delta_persona:+d}')
    print()
    print('=' * 70)
    print('✅ Done — الواجهة دلوقتي تقدر تعرض توصيات حقيقية من /api/stored-analysis/results')
    print('=' * 70)


if __name__ == '__main__':
    main()
