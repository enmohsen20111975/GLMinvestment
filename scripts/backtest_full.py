#!/usr/bin/env python3
"""
Backtest Full — 2025-12-01 → 2026-06-17 (BACKTEST-FULL-001)
============================================================
باك تست كامل على التوصيات الفعلية المحفوظة في predictions.db.predictions
خلال الفترة المحددة، مع فصل القنوات والأسواق وفلتر الجودة.

المنطق:
  1. اقرأ كل predictions في الفترة [from, to]
  2. طبق فلتر الجودة (trade_valid):
     - entry_price > 0
     - ticker نظيف (لا مسافات، ≤ 12 char)
     - استبعاد التكرار على (ticker + date + channel + entry)
     - market معروف
     - exit منطقي (|exit/entry| <= 5x)
  3. احسب العائد لكل صفقة:
     - actual_return لو موجود
     - exit_price لو موجود
     - hit_target=1 → (target - entry) / entry × 100
     - hit_stop=1 → (stop - entry) / entry × 100
     - expired no hit → null (لا نختلق)
  4. HARD cap: ABS(return) <= 50 (مع تعليم capped=true)
  5. افصل القنوات: balanced ≠ morning_bell
  6. احسب KPI لكل قناة + by_market + Top20/Worst20 + MaxDD محفظة

القواعد المطبقة (CONSTITUTION):
  - Rule 7: HARD cap ABS(actual_return) <= 50
  - Rule 8: لا خلط قنوات (balanced ≠ morning_bell)

Output:
  - scripts/backtest_full_results.json
  - scripts/backtest_full_report.md

Usage:
    python3 scripts/backtest_full.py
    python3 scripts/backtest_full.py --start 2025-12-01 --end 2026-06-17
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PREDICTIONS_DB = PROJECT_ROOT / "db" / "predictions.db"
PRICE_HISTORY_DB = PROJECT_ROOT / "db" / "price_history.db"

HARD_CAP = 50.0
MAX_RETURN_RATIO = 5.0  # |exit/entry| > 5x = suspicious
PORTFOLIO_RISK_PCT = 1.0  # 1% risk per trade
PORTFOLIO_MAX_CONCURRENT = 3
INITIAL_EQUITY = 100.0


# ============================================================================
# Data classes
# ============================================================================

class Trade:
    def __init__(self, row: dict):
        self.id = row['id']
        self.ticker = str(row.get('ticker', '')).strip().upper()
        self.persona = str(row.get('persona', 'balanced'))
        self.morning_bell = int(row.get('morning_bell', 0) or 0)
        self.channel = 'morning_bell' if self.morning_bell == 1 else 'balanced'
        self.prediction_date = str(row.get('prediction_date', ''))
        self.entry_price = float(row.get('entry_price', 0) or 0)
        self.target_price = float(row.get('target_price', 0) or 0) if row.get('target_price') else None
        self.target_price_2 = float(row.get('target_price_2', 0) or 0) if row.get('target_price_2') else None
        self.stop_loss = float(row.get('stop_loss', 0) or 0) if row.get('stop_loss') else None
        self.exit_price = float(row.get('exit_price', 0) or 0) if row.get('exit_price') else None
        self.actual_exit_price = float(row.get('actual_exit_price', 0) or 0) if row.get('actual_exit_price') else None
        self.actual_return_field = float(row.get('actual_return', 0) or 0) if row.get('actual_return') else None
        self.hit_target = int(row.get('hit_target', 0) or 0)
        self.hit_stop = int(row.get('hit_stop', 0) or 0)
        self.status = str(row.get('status', ''))
        self.holding_days = int(row.get('holding_days', 0) or 0) if row.get('holding_days') else None
        self.outcome_date = str(row.get('outcome_date', '')) if row.get('outcome_date') else None
        self.highest_price = float(row.get('highest_price', 0) or 0) if row.get('highest_price') else None
        self.lowest_price = float(row.get('lowest_price', 0) or 0) if row.get('lowest_price') else None
        self.market = str(row.get('market', 'UNKNOWN')).upper()

        # computed
        self.actual_return: Optional[float] = None
        self.capped = False
        self.valid = True
        self.exclusion_reason: Optional[str] = None

    def compute_return(self):
        """احسب العائد الفعلي مع HARD cap."""
        if not self.entry_price or self.entry_price <= 0:
            self.valid = False
            self.exclusion_reason = 'entry_price_zero'
            return

        # ticker نظيف
        if not self.ticker or ' ' in self.ticker or len(self.ticker) > 12:
            self.valid = False
            self.exclusion_reason = 'ticker_invalid'
            return

        # market معروف
        if not self.market or self.market == 'UNKNOWN':
            self.valid = False
            self.exclusion_reason = 'market_unknown'
            return

        raw_ret = None
        exit_used = None

        # 1. actual_return field
        if self.actual_return_field is not None and math.isfinite(self.actual_return_field):
            raw_ret = self.actual_return_field
            exit_used = self.entry_price * (1 + raw_ret / 100)

        # 2. exit_price
        if raw_ret is None:
            exit = self.exit_price or self.actual_exit_price
            if exit and exit > 0:
                raw_ret = ((exit - self.entry_price) / self.entry_price) * 100
                exit_used = exit

        # 3. hit_target=1 → target
        if raw_ret is None and self.hit_target == 1 and self.target_price and self.target_price > 0:
            raw_ret = ((self.target_price - self.entry_price) / self.entry_price) * 100
            exit_used = self.target_price

        # 4. hit_stop=1 → stop
        if raw_ret is None and self.hit_stop == 1 and self.stop_loss and self.stop_loss > 0:
            raw_ret = ((self.stop_loss - self.entry_price) / self.entry_price) * 100
            exit_used = self.stop_loss

        # 5. expired no hit → null
        if raw_ret is None:
            self.actual_return = None
            return

        # فحص منطقية
        if exit_used:
            ratio = abs(exit_used / self.entry_price)
            if ratio > MAX_RETURN_RATIO:
                self.valid = False
                self.exclusion_reason = 'exit_price_unrealistic'
                return

        # HARD cap
        self.capped = abs(raw_ret) > HARD_CAP
        self.actual_return = max(-HARD_CAP, min(HARD_CAP, raw_ret))

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'ticker': self.ticker,
            'market': self.market,
            'channel': self.channel,
            'prediction_date': self.prediction_date,
            'entry_price': round(self.entry_price, 4) if self.entry_price else None,
            'target_price': round(self.target_price, 4) if self.target_price else None,
            'stop_loss': round(self.stop_loss, 4) if self.stop_loss else None,
            'exit_price': round(self.exit_price or self.actual_exit_price, 4) if (self.exit_price or self.actual_exit_price) else None,
            'actual_return': round(self.actual_return, 2) if self.actual_return is not None else None,
            'hit_target': self.hit_target,
            'hit_stop': self.hit_stop,
            'status': self.status,
            'holding_days': self.holding_days,
            'capped': self.capped,
            'valid': self.valid,
            'exclusion_reason': self.exclusion_reason,
        }


# ============================================================================
# KPI computation
# ============================================================================

def compute_kpis(trades: List[Trade]) -> dict:
    """احسب KPI لقائمة صفقات."""
    n_raw = len(trades)
    valid_trades = [t for t in trades if t.valid]
    measured = [t for t in valid_trades if t.actual_return is not None and t.actual_return != 0]
    n_valid = len(measured)
    excluded = [t for t in trades if not t.valid]
    n_open = len([t for t in trades if t.status in ('active', 'ACTIVE', 'PENDING')])

    # exclusion breakdown
    exclusion_breakdown = defaultdict(int)
    for t in excluded:
        reason = t.exclusion_reason or 'unknown'
        exclusion_breakdown[reason] += 1

    if n_valid == 0:
        return {
            'n_raw': n_raw,
            'n_valid': 0,
            'n_excluded': len(excluded),
            'n_open': n_open,
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
            'exclusion_breakdown': dict(exclusion_breakdown),
        }

    wins = [t for t in measured if t.actual_return > 0]
    losses = [t for t in measured if t.actual_return < 0]
    expired = [t for t in trades if t.status == 'EXPIRED' and t.hit_target == 0 and t.hit_stop == 0]
    tp_hits = [t for t in valid_trades if t.hit_target == 1]
    stop_hits = [t for t in valid_trades if t.hit_stop == 1]
    hard_capped = [t for t in measured if t.capped]

    gross_profit = sum(t.actual_return for t in wins)
    gross_loss_amount = sum(abs(t.actual_return) for t in losses)
    pf = gross_profit / gross_loss_amount if gross_loss_amount > 0 else (float('inf') if gross_profit > 0 else 0)

    avg_win = gross_profit / len(wins) if wins else 0
    avg_loss = -(gross_loss_amount / len(losses)) if losses else 0  # سالب
    expectancy = sum(t.actual_return for t in measured) / n_valid

    max_loss = min(t.actual_return for t in losses) if losses else 0
    max_win = max(t.actual_return for t in wins) if wins else 0

    return {
        'n_raw': n_raw,
        'n_valid': n_valid,
        'n_excluded': len(excluded),
        'n_open': n_open,
        'win_rate': round((len(wins) / n_valid) * 100, 2),
        'profit_factor': round(pf, 4) if pf != float('inf') else 0,
        'expectancy_pct': round(expectancy, 4),
        'avg_win_pct': round(avg_win, 4),
        'avg_loss_pct': round(avg_loss, 4),  # سالب
        'max_loss_pct': round(max_loss, 4),  # سالب
        'max_win_pct': round(max_win, 4),
        'tp1_hit_rate': round((len(tp_hits) / len(valid_trades)) * 100, 2) if valid_trades else 0,
        'stop_hit_rate': round((len(stop_hits) / len(valid_trades)) * 100, 2) if valid_trades else 0,
        'expired_rate': round((len(expired) / n_raw) * 100, 2) if n_raw > 0 else 0,
        'hard_capped_count': len(hard_capped),
        'exclusion_breakdown': dict(exclusion_breakdown),
    }


# ============================================================================
# Portfolio MaxDD simulation
# ============================================================================

def compute_portfolio_maxdd(trades: List[Trade]) -> dict:
    """
    محاكاة MaxDD بمحفظة حقيقية:
    - initial_equity = 100
    - risk_per_trade = 1% من equity (compounding)
    - position_size = (risk_pct * equity) / stop_distance_pct
    - return_dollars = position_size * actual_return_pct
    - MaxDD = peak-to-valley على equity curve (كل الصفقات بالترتيب الزمني)

    ملاحظة: لا concurrent limit في هذه المحاكاة المبسطة — كل صفقة تُؤخذ بالترتيب
    الزمني وتُغلق فوراً (simplified). هذا يعطي MaxDD خام صادق بدلاً من تخطي
    144 صفقة.
    """
    # ترتيب الصفقات بالتاريخ
    valid_measured = sorted(
        [t for t in trades if t.valid and t.actual_return is not None and t.actual_return != 0],
        key=lambda t: t.prediction_date
    )

    if not valid_measured:
        return {
            'initial_equity': INITIAL_EQUITY,
            'final_equity': INITIAL_EQUITY,
            'total_return_pct': 0,
            'max_drawdown_pct': 0,
            'n_taken': 0,
            'n_skipped_concurrent': 0,
            'method': f'risk={PORTFOLIO_RISK_PCT}% per trade (compounding), chronological order',
        }

    equity = INITIAL_EQUITY
    peak = equity
    max_dd = 0
    n_taken = 0
    equity_curve = [equity]

    for t in valid_measured:
        # حساب stop distance
        if t.stop_loss and t.entry_price and t.entry_price > 0:
            stop_distance_pct = abs(t.entry_price - t.stop_loss) / t.entry_price * 100
        else:
            # fallback: استخدم 5% لو لا يوجد وقف
            stop_distance_pct = 5.0

        if stop_distance_pct <= 0:
            stop_distance_pct = 5.0

        # position size (compounding: risk 1% of current equity)
        risk_amount = equity * (PORTFOLIO_RISK_PCT / 100)
        position_size = risk_amount / (stop_distance_pct / 100)

        # return in dollars
        return_dollars = position_size * (t.actual_return / 100)
        equity += return_dollars
        equity_curve.append(equity)

        # update peak + MaxDD
        if equity > peak:
            peak = equity
        dd = (peak - equity) / peak * 100 if peak > 0 else 0
        if dd > max_dd:
            max_dd = dd

        n_taken += 1

    return {
        'initial_equity': INITIAL_EQUITY,
        'final_equity': round(equity, 4),
        'total_return_pct': round((equity - INITIAL_EQUITY) / INITIAL_EQUITY * 100, 2),
        'max_drawdown_pct': round(max_dd, 2),
        'n_taken': n_taken,
        'n_skipped_concurrent': 0,
        'method': f'risk={PORTFOLIO_RISK_PCT}% per trade (compounding), chronological order, n_taken={n_taken}',
    }


# ============================================================================
# Horizons (+1, +3, +5 days)
# ============================================================================

def compute_horizons(trades: List[Trade], db_path: Path) -> dict:
    """
    حساب العوائد عند آفاق +1, +3, +5 أيام من تاريخ الدخول
    باستخدام price_history.db.
    """
    if not db_path.exists():
        return {'error': 'price_history.db not found', 'horizons': {}}

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    valid_trades = [t for t in trades if t.valid and t.entry_price and t.entry_price > 0]
    horizons = {1: [], 3: [], 5: []}

    for t in valid_trades:
        # جلب أسعار الإغلاق بعد تاريخ الدخول
        rows = conn.execute("""
            SELECT date, close_price FROM price_history
            WHERE ticker = ? AND date > ?
            ORDER BY date ASC LIMIT 6
        """, (t.ticker, t.prediction_date)).fetchall()

        if len(rows) < 1:
            continue

        for h in [1, 3, 5]:
            if len(rows) >= h:
                close = float(rows[h-1]['close_price'] or 0)
                if close > 0 and t.entry_price > 0:
                    ret = (close - t.entry_price) / t.entry_price * 100
                    ret = max(-HARD_CAP, min(HARD_CAP, ret))
                    horizons[h].append(ret)

    conn.close()

    result = {}
    for h, returns in horizons.items():
        if returns:
            wins = [r for r in returns if r > 0]
            losses = [r for r in returns if r < 0]
            gross_profit = sum(wins)
            gross_loss = sum(abs(r) for r in losses)
            pf = gross_profit / gross_loss if gross_loss > 0 else 0
            result[f'+{h}d'] = {
                'n': len(returns),
                'win_rate': round(len(wins) / len(returns) * 100, 2),
                'avg_return': round(sum(returns) / len(returns), 4),
                'profit_factor': round(pf, 4),
                'max_loss': round(min(returns), 4) if returns else 0,
                'max_win': round(max(returns), 4) if returns else 0,
            }
        else:
            result[f'+{h}d'] = {'n': 0, 'win_rate': 0, 'avg_return': 0, 'profit_factor': 0, 'max_loss': 0, 'max_win': 0}

    return {'horizons': result}


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description='Backtest Full — 2025-12-01 → 2026-06-17')
    parser.add_argument('--start', default='2025-12-01', help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end', default='2026-06-17', help='End date (YYYY-MM-DD)')
    args = parser.parse_args()

    start_date = args.start
    end_date = args.end

    print(f"[backtest] Period: {start_date} → {end_date}")
    print(f"[backtest] DB: {PREDICTIONS_DB}")

    if not PREDICTIONS_DB.exists():
        print(f"ERROR: {PREDICTIONS_DB} not found")
        sys.exit(1)

    conn = sqlite3.connect(str(PREDICTIONS_DB))
    conn.row_factory = sqlite3.Row

    # قرأ كل predictions في الفترة
    rows = conn.execute("""
        SELECT id, ticker, persona, morning_bell, prediction_date, entry_price,
               target_price, target_price_2, stop_loss, exit_price, actual_exit_price,
               actual_return, hit_target, hit_stop, status, holding_days,
               outcome_date, closed_at, highest_price, lowest_price, signal, market
        FROM predictions
        WHERE prediction_date >= ? AND prediction_date <= ?
        ORDER BY prediction_date DESC
    """, (start_date, end_date)).fetchall()

    print(f"[backtest] Raw predictions: {len(rows)}")

    # تحويل إلى Trade objects
    trades: List[Trade] = []
    seen_keys = set()
    for row in rows:
        t = Trade(dict(row))
        t.compute_return()

        # dedup
        dedup_key = f"{t.ticker}|{t.prediction_date}|{t.channel}|{t.entry_price:.4f}"
        if t.valid and dedup_key in seen_keys:
            t.valid = False
            t.exclusion_reason = 'duplicate'
        if t.valid:
            seen_keys.add(dedup_key)

        trades.append(t)

    conn.close()

    # فصل القنوات
    balanced_trades = [t for t in trades if t.channel == 'balanced']
    morning_bell_trades = [t for t in trades if t.channel == 'morning_bell']

    # فصل الأسواق
    markets = set(t.market for t in trades if t.valid)
    by_market_trades = {m: [t for t in trades if t.market == m] for m in markets}

    print(f"[backtest] balanced: {len(balanced_trades)} raw")
    print(f"[backtest] morning_bell: {len(morning_bell_trades)} raw")
    print(f"[backtest] markets: {dict((m, len(v)) for m, v in by_market_trades.items())}")

    # KPIs
    all_kpis = compute_kpis(trades)
    balanced_kpis = compute_kpis(balanced_trades)
    morning_bell_kpis = compute_kpis(morning_bell_trades)
    by_market_kpis = {m: compute_kpis(ts) for m, ts in by_market_trades.items()}

    # Top 20 / Worst 20
    valid_measured = [t for t in trades if t.valid and t.actual_return is not None and t.actual_return != 0]
    top20 = sorted(valid_measured, key=lambda t: t.actual_return, reverse=True)[:20]
    worst20 = sorted(valid_measured, key=lambda t: t.actual_return)[:20]

    # Portfolio MaxDD
    portfolio_dd_all = compute_portfolio_maxdd(trades)
    portfolio_dd_balanced = compute_portfolio_maxdd(balanced_trades)
    portfolio_dd_morning_bell = compute_portfolio_maxdd(morning_bell_trades)

    # Horizons
    horizons_all = compute_horizons(trades, PRICE_HISTORY_DB)

    # exclusion examples
    excluded_examples = [t.to_dict() for t in trades if not t.valid][:10]

    # Build report
    report = {
        'task': 'BACKTEST-FULL-001',
        'generated_at': datetime.utcnow().isoformat() + 'Z',
        'period': {'from': start_date, 'to': end_date},
        'data_source': 'predictions.db.predictions',
        'method': {
            'return_computation': 'actual_return → exit_price → hit_target/target → hit_stop/stop → null',
            'hard_cap': f'ABS(return) <= {HARD_CAP}',
            'quality_filter': ['entry_price > 0', 'ticker clean (no spaces, <= 12 char)', 'dedup (ticker+date+channel+entry)', 'market known', '|exit/entry| <= 5x'],
            'avg_loss_sign': 'negative (always)',
            'channels_separated': True,
            'markets_separated': True,
        },
        'data_coverage': {
            'predictions_actual_start': min(t.prediction_date for t in trades) if trades else None,
            'predictions_actual_end': max(t.prediction_date for t in trades) if trades else None,
            'note': 'predictions start from 2026-01-01 (no December 2025 data in DB)',
        },
        'kpis_all': all_kpis,
        'kpis_by_channel': {
            'balanced': balanced_kpis,
            'morning_bell': morning_bell_kpis,
        },
        'kpis_by_market': by_market_kpis,
        'portfolio_maxdd': {
            'all': portfolio_dd_all,
            'balanced': portfolio_dd_balanced,
            'morning_bell': portfolio_dd_morning_bell,
        },
        'horizons': horizons_all,
        'top20': [t.to_dict() for t in top20],
        'worst20': [t.to_dict() for t in worst20],
        'excluded_examples': excluded_examples,
    }

    # Save JSON
    json_path = PROJECT_ROOT / 'scripts' / 'backtest_full_results.json'
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    print(f"[backtest] JSON saved: {json_path}")

    # Generate Markdown report
    md = generate_markdown_report(report)
    md_path = PROJECT_ROOT / 'scripts' / 'backtest_full_report.md'
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(md)
    print(f"[backtest] Markdown saved: {md_path}")

    # Print summary
    print("\n" + "="*60)
    print("BACKTEST SUMMARY")
    print("="*60)
    print(f"Period: {start_date} → {end_date}")
    print(f"Data coverage: {report['data_coverage']['predictions_actual_start']} → {report['data_coverage']['predictions_actual_end']}")
    print(f"\nALL: n_raw={all_kpis['n_raw']}, n_valid={all_kpis['n_valid']}, n_excluded={all_kpis['n_excluded']}")
    print(f"  WR={all_kpis['win_rate']}%, PF={all_kpis['profit_factor']}, Exp={all_kpis['expectancy_pct']}%")
    print(f"  avg_win={all_kpis['avg_win_pct']}%, avg_loss={all_kpis['avg_loss_pct']}%")
    print(f"  max_loss={all_kpis['max_loss_pct']}%, max_win={all_kpis['max_win_pct']}%")
    print(f"\nBALANCED: n_raw={balanced_kpis['n_raw']}, n_valid={balanced_kpis['n_valid']}")
    print(f"  WR={balanced_kpis['win_rate']}%, PF={balanced_kpis['profit_factor']}, Exp={balanced_kpis['expectancy_pct']}%")
    print(f"  max_loss={balanced_kpis['max_loss_pct']}%, max_win={balanced_kpis['max_win_pct']}%")
    print(f"\nMORNING_BELL: n_raw={morning_bell_kpis['n_raw']}, n_valid={morning_bell_kpis['n_valid']}")
    print(f"  WR={morning_bell_kpis['win_rate']}%, PF={morning_bell_kpis['profit_factor']}, Exp={morning_bell_kpis['expectancy_pct']}%")
    print(f"  max_loss={morning_bell_kpis['max_loss_pct']}%, max_win={morning_bell_kpis['max_win_pct']}%")
    print(f"\nPortfolio MaxDD (all): {portfolio_dd_all['max_drawdown_pct']}% (n_taken={portfolio_dd_all['n_taken']})")
    print(f"Portfolio MaxDD (balanced): {portfolio_dd_balanced['max_drawdown_pct']}%")
    print(f"Portfolio MaxDD (morning_bell): {portfolio_dd_morning_bell['max_drawdown_pct']}%")
    print(f"\nExclusion breakdown: {all_kpis['exclusion_breakdown']}")
    print(f"\nTop trade: {top20[0].ticker if top20 else 'N/A'} ({top20[0].actual_return if top20 else 'N/A'}%)")
    print(f"Worst trade: {worst20[0].ticker if worst20 else 'N/A'} ({worst20[0].actual_return if worst20 else 'N/A'}%)")


def generate_markdown_report(report: dict) -> str:
    """توليد تقرير Markdown."""
    k = report['kpis_all']
    bk = report['kpis_by_channel']['balanced']
    mk = report['kpis_by_channel']['morning_bell']

    md = f"""# تقرير الباك تست الكامل — BACKTEST-FULL-001

**الفترة:** {report['period']['from']} → {report['period']['to']}
**تاريخ التوليد:** {report['generated_at']}
**مصدر البيانات:** {report['data_source']}

## تغطية البيانات

- **البيانات الفعلية:** {report['data_coverage']['predictions_actual_start']} → {report['data_coverage']['predictions_actual_end']}
- **ملاحظة:** {report['data_coverage']['note']}

## طريقة الحساب

- **حساب العائد:** {report['method']['return_computation']}
- **HARD cap:** {report['method']['hard_cap']}
- **متوسط الخسارة:** {report['method']['avg_loss_sign']} (سالب دائماً)
- **القنوات مفصولة:** {report['method']['channels_separated']}
- **الأسواق مفصولة:** {report['method']['markets_separated']}

## فلتر الجودة

"""
    for f in report['method']['quality_filter']:
        md += f"- {f}\n"

    md += f"""

## KPI الإجمالي (ALL)

| KPI | القيمة |
|-----|--------|
| n_raw | {k['n_raw']} |
| n_valid | {k['n_valid']} |
| n_excluded | {k['n_excluded']} |
| n_open | {k['n_open']} |
| Win Rate | {k['win_rate']}% |
| Profit Factor | {k['profit_factor']} |
| Expectancy | {k['expectancy_pct']}% |
| متوسط الربح | {k['avg_win_pct']}% |
| متوسط الخسارة | {k['avg_loss_pct']}% |
| Max Loss | {k['max_loss_pct']}% |
| Max Win | {k['max_win_pct']}% |
| TP1 hit rate | {k['tp1_hit_rate']}% |
| Stop hit rate | {k['stop_hit_rate']}% |
| Expired rate | {k['expired_rate']}% |
| Hard capped | {k['hard_capped_count']} |

## مقارنة القنوات (balanced vs morning_bell)

| القناة | n_raw | n_valid | WR | PF | Expectancy | avg_win | avg_loss | max_loss | max_win |
|--------|-------|---------|-----|-----|------------|---------|----------|----------|---------|
| balanced | {bk['n_raw']} | {bk['n_valid']} | {bk['win_rate']}% | {bk['profit_factor']} | {bk['expectancy_pct']}% | {bk['avg_win_pct']}% | {bk['avg_loss_pct']}% | {bk['max_loss_pct']}% | {bk['max_win_pct']}% |
| morning_bell | {mk['n_raw']} | {mk['n_valid']} | {mk['win_rate']}% | {mk['profit_factor']} | {mk['expectancy_pct']}% | {mk['avg_win_pct']}% | {mk['avg_loss_pct']}% | {mk['max_loss_pct']}% | {mk['max_win_pct']}% |

## KPI حسب السوق (by_market)

"""
    for m, mk_kpis in report['kpis_by_market'].items():
        md += f"### {m}\n\n"
        md += f"| n_raw | n_valid | WR | PF | Exp | max_loss |\n"
        md += f"|-------|---------|-----|-----|-----|----------|\n"
        md += f"| {mk_kpis['n_raw']} | {mk_kpis['n_valid']} | {mk_kpis['win_rate']}% | {mk_kpis['profit_factor']} | {mk_kpis['expectancy_pct']}% | {mk_kpis['max_loss_pct']}% |\n\n"

    # Portfolio MaxDD
    pdd = report['portfolio_maxdd']
    md += f"""## MaxDD بمحاكاة محفظة

**الطريقة:** {pdd['all']['method']}

| القناة | initial | final | return% | MaxDD% | n_taken | n_skipped |
|--------|---------|-------|---------|--------|---------|-----------|
| ALL | {pdd['all']['initial_equity']} | {pdd['all']['final_equity']} | {pdd['all']['total_return_pct']}% | {pdd['all']['max_drawdown_pct']}% | {pdd['all']['n_taken']} | {pdd['all']['n_skipped_concurrent']} |
| balanced | {pdd['balanced']['initial_equity']} | {pdd['balanced']['final_equity']} | {pdd['balanced']['total_return_pct']}% | {pdd['balanced']['max_drawdown_pct']}% | {pdd['balanced']['n_taken']} | {pdd['balanced']['n_skipped_concurrent']} |
| morning_bell | {pdd['morning_bell']['initial_equity']} | {pdd['morning_bell']['final_equity']} | {pdd['morning_bell']['total_return_pct']}% | {pdd['morning_bell']['max_drawdown_pct']}% | {pdd['morning_bell']['n_taken']} | {pdd['morning_bell']['n_skipped_concurrent']} |

## آفاق القياس (+1, +3, +5 أيام)

"""
    horizons = report['horizons'].get('horizons', {})
    md += "| الأفق | n | WR | avg_return | PF | max_loss | max_win |\n"
    md += "|-------|-----|-----|------------|-----|----------|---------|\n"
    for h_key in ['+1d', '+3d', '+5d']:
        h = horizons.get(h_key, {})
        md += f"| {h_key} | {h.get('n', 0)} | {h.get('win_rate', 0)}% | {h.get('avg_return', 0)}% | {h.get('profit_factor', 0)} | {h.get('max_loss', 0)}% | {h.get('max_win', 0)}% |\n"

    # Top 20
    md += "\n## أفضل 20 صفقة (Top 20)\n\n"
    md += "| # | السهم | السوق | القناة | التاريخ | دخول | وقف | هدف | عائد | capped | حالة |\n"
    md += "|---|------|------|--------|---------|------|-----|------|------|--------|------|\n"
    for i, t in enumerate(report['top20'], 1):
        md += f"| {i} | {t['ticker']} | {t['market']} | {t['channel']} | {t['prediction_date']} | {t['entry_price']} | {t['stop_loss'] or '—'} | {t['target_price'] or '—'} | {t['actual_return']}% | {'✓' if t['capped'] else '—'} | {t['status']} |\n"

    # Worst 20
    md += "\n## أسوأ 20 صفقة (Worst 20)\n\n"
    md += "| # | السهم | السوق | القناة | التاريخ | دخول | وقف | هدف | عائد | حالة |\n"
    md += "|---|------|------|--------|---------|------|-----|------|------|------|\n"
    for i, t in enumerate(report['worst20'], 1):
        md += f"| {i} | {t['ticker']} | {t['market']} | {t['channel']} | {t['prediction_date']} | {t['entry_price']} | {t['stop_loss'] or '—'} | {t['target_price'] or '—'} | {t['actual_return']}% | {t['status']} |\n"

    # Excluded examples
    md += "\n## أمثلة على صفقات مستبعدة\n\n"
    md += "| السهم | السوق | دخول | سبب الاستبعاد |\n"
    md += "|------|------|------|----------------|\n"
    for t in report['excluded_examples']:
        md += f"| {t['ticker']} | {t['market']} | {t['entry_price']} | {t['exclusion_reason']} |\n"

    # Exclusion breakdown
    md += f"\n## أسباب الاستبعاد\n\n"
    md += f"| السبب | العدد |\n|------|------|\n"
    for reason, count in report['kpis_all']['exclusion_breakdown'].items():
        md += f"| {reason} | {count} |\n"

    md += f"""
---

## المخاطر والقيود

1. **actual_return/exit_price NULL في DB**: تم حساب العائد من hit_target/hit_stop + target/stop.
2. **HARD cap 50%**: صفقات وصلت للحد الأقصى قد يكون عائدها الفعلي أعلى.
3. **MaxDD محفظة مبسط**: يفترض إغلاق فوري بعد العائد (simplified) — ليس محاكاة بار-بار كاملة.
4. **آفاق +1/+3/+5**: تستخدم price_history.db (قد لا يوجد لكل سهم).
5. **لا خلط قنوات**: balanced ≠ morning_bell مفصولة في كل KPI.

## الخلاصة

- **balanced**: n={bk['n_valid']}, WR={bk['win_rate']}%, PF={bk['profit_factor']}, Exp={bk['expectancy_pct']}%, max_loss={bk['max_loss_pct']}%
- **morning_bell**: n={mk['n_valid']}, WR={mk['win_rate']}%, PF={mk['profit_factor']}, Exp={mk['expectancy_pct']}%, max_loss={mk['max_loss_pct']}%
- **Portfolio MaxDD (all)**: {pdd['all']['max_drawdown_pct']}% (n_taken={pdd['all']['n_taken']})
"""
    return md


if __name__ == '__main__':
    main()
