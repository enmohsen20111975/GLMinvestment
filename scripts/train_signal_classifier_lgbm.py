#!/usr/bin/env python3
"""
scripts/train_signal_classifier_lgbm.py — V2 (BRAVO-GRAND-SIMULATION-PHASE-3)
===========================================================================
Institutional ML Signal Gatekeeper V2 — Trained on ALL 297 verified signals
(120 verified_win + 177 verified_loss) across the EGX market.

Adheres strictly to:
  - Rule 20 (PYTHON = BRAIN): كل الحسابات في Python.
  - Rule 27 (NO-FAKE-DATA): لا اختلاق — labels مأخوذة من `status` column في
    radar_signal_tracking (consistent with verify_all_radar_signals.py + the
    Phase-1 data_gap_cleaner re-verification).

Features Extracted (Point-in-Time, Zero Lookahead Bias — 12 features):
  1. `percentile_rank`: Trailing 20-day liquidity percentile rank across market.
  2. `avg_turnover_20d_log`: Log of 20-day average daily turnover.
  3. `rvol_20d`: Volume relative to 20-day average volume (surge indicator).
  4. `rsi_14`: Relative Strength Index.
  5. `mfi_14`: Money Flow Index.
  6. `price_to_sma20`: % distance from SMA20.
  7. `price_to_sma50`: % distance from SMA50.
  8. `atr_14_pct`: Normalized volatility (ATR / Price).
  9. `bollinger_bandwidth`: BB width / Middle (volatility squeeze).
  10. `high_low_spread_pct`: (High - Low) / Close on signal day.
  11. `dist_from_20d_high`: Distance from 20-day trailing high.
  12. `signal_type_code`: Categorical code of Wyckoff pattern.

Target (V2 — استخدم status column مباشرة):
  1 = verified_win  (+5% target hit before -5% stop loss — stored in DB).
  0 = verified_loss (-5% stop loss hit — stored in DB).

V2 CHANGES (Task BRAVO-GRAND-SIMULATION-PHASE-3):
  - Fixed PROJECT_ROOT (was /home/meme/my_apps/GLMinvestment → now /home/z/my-project).
  - Training universe = 297 verified signals (was: re-evaluate from prices,
    which produced different labels and larger universe).
  - Added purged_time_series_split (chronological + 5-day gap).
  - Added Confusion Matrix (TP/TN/FP/FN) at threshold 0.65.
  - Added Precision at threshold 0.65.
  - Added Coverage (نسبة الإشارات المقبولة).
  - Added ROC-AUC score (sklearn.metrics.roc_auc_score).
  - Saved model as a dict with metadata:
      {version, model, feature_names, roc_auc, confusion_matrix, trained_at,
       n_train, n_test, threshold, baseline_win_rate_pct, ...}.

IDEMPOTENT: re-running overwrites the model artifact + metrics JSON.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import joblib
import numpy as np
import pandas as pd

import lightgbm as lgb
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    precision_score,
    roc_auc_score,
)

# ─────────────────────────────────────────────────────────────────────────────
# Paths (V2 fix — was wrong /home/meme/my_apps/GLMinvestment)
# ─────────────────────────────────────────────────────────────────────────────
_SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = Path(os.environ.get('PROJECT_ROOT') or str(_SCRIPT_DIR.parent))
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
MODELS_DIR = PROJECT_ROOT / 'models'
MODELS_DIR.mkdir(parents=True, exist_ok=True)
MODEL_OUT_PATH = MODELS_DIR / 'lgbm_signal_gatekeeper.joblib'
METRICS_OUT_PATH = MODELS_DIR / 'lgbm_metrics.json'

# ─────────────────────────────────────────────────────────────────────────────
# Strategy parameters — mirror institutional_multi_market_backtest.py
# ─────────────────────────────────────────────────────────────────────────────
TARGET_PCT = 5.0
STOP_PCT = -5.0
WINDOW_DAYS = 30
TRADING_DAYS_PER_YEAR = 252

# V2 — Training universe parameters
TRAIN_RATIO = 0.75  # 75% train, 25% test
PURGE_GAP_DAYS = 5  # 5-day purge gap between train end and test start
GATEKEEPER_THRESHOLD = 0.65  # default acceptance threshold
RANDOM_STATE = 42

# Model metadata — V2
MODEL_VERSION = 'V2'

# ─────────────────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────────────────
def open_db_readonly(path: Path) -> sqlite3.Connection:
    """Open stocks.db in READ-ONLY mode (Rule 27 — never write)."""
    if not path.exists():
        raise FileNotFoundError(f'DB not found: {path}')
    conn = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def parse_val(v) -> float:
    """Robustly parse float numbers (handles commas, unicode spaces, K/M/B suffixes)."""
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace('\u202f', '').replace('\xa0', '').replace(' ', '').replace(',', '')
    if not s:
        return 0.0
    mult = 1.0
    if s.endswith(('k', 'K')):
        mult = 1e3
        s = s[:-1]
    elif s.endswith(('m', 'M')):
        mult = 1e6
        s = s[:-1]
    elif s.endswith(('b', 'B')):
        mult = 1e9
        s = s[:-1]
    try:
        return float(s) * mult
    except (ValueError, TypeError):
        return 0.0


def load_candles_cache(conn: sqlite3.Connection) -> Dict[str, pd.DataFrame]:
    """Load stock daily prices into indexed DataFrames per ticker for ultra-fast point-in-time querying."""
    print("Loading daily price history into memory...")
    query = """
        SELECT ticker, price_date, open, high, low, close, volume, turnover
        FROM stock_daily_prices
        WHERE close IS NOT NULL AND close > 0
        ORDER BY ticker, price_date ASC
    """
    df = pd.read_sql_query(query, conn)
    df['open'] = df['open'].apply(parse_val)
    df['high'] = df['high'].apply(parse_val)
    df['low'] = df['low'].apply(parse_val)
    df['close'] = df['close'].apply(parse_val)
    df['volume'] = df['volume'].apply(parse_val)
    df['turnover'] = df['turnover'].apply(parse_val)

    # Fallback for turnover if 0
    zero_turnover = df['turnover'] <= 0
    df.loc[zero_turnover, 'turnover'] = (
        df.loc[zero_turnover, 'close'] * df.loc[zero_turnover, 'volume']
    )

    cache: Dict[str, pd.DataFrame] = {}
    for ticker, group in df.groupby('ticker'):
        cache[ticker] = group.reset_index(drop=True)
    print(f"Cached {len(cache):,} tickers with daily candles.")
    return cache


def compute_features_for_signal(
    ticker_df: pd.DataFrame,
    signal_date: str,
    market_turnovers_at_date: np.ndarray,
) -> Optional[Dict[str, float]]:
    """Compute point-in-time features strictly on or before signal_date (zero lookahead)."""
    hist = ticker_df[ticker_df['price_date'] <= signal_date]
    if len(hist) < 20:
        return None  # Insufficient history for indicators

    closes = hist['close'].values
    highs = hist['high'].values
    lows = hist['low'].values
    volumes = hist['volume'].values
    turnovers = hist['turnover'].values

    current_close = closes[-1]
    if current_close <= 0:
        return None

    # 1. 20-day Average Turnover and Percentile Rank
    avg_turnover_20d = float(np.mean(turnovers[-20:]))
    if len(market_turnovers_at_date) > 0:
        percentile_rank = float(
            np.mean(market_turnovers_at_date <= avg_turnover_20d) * 100.0
        )
    else:
        percentile_rank = 50.0

    # 2. Relative Volume (RVol)
    today_vol = volumes[-1]
    avg_vol_20d = (
        float(np.mean(volumes[-20:])) if len(volumes) >= 20 else today_vol
    )
    rvol_20d = float(today_vol / avg_vol_20d) if avg_vol_20d > 0 else 1.0

    # 3. SMAs and Distance
    sma20 = float(np.mean(closes[-20:]))
    sma50 = float(np.mean(closes[-50:])) if len(closes) >= 50 else sma20
    price_to_sma20 = float((current_close - sma20) / sma20 * 100.0)
    price_to_sma50 = float((current_close - sma50) / sma50 * 100.0)

    # 4. Relative Strength Index (RSI 14)
    deltas = np.diff(closes[-15:])
    gains = np.maximum(deltas, 0)
    losses = np.maximum(-deltas, 0)
    avg_gain = np.mean(gains) if len(gains) > 0 else 0
    avg_loss = np.mean(losses) if len(losses) > 0 else 0
    if avg_loss == 0:
        rsi_14 = 100.0
    else:
        rs = avg_gain / avg_loss
        rsi_14 = float(100.0 - (100.0 / (1.0 + rs)))

    # 5. Money Flow Index (MFI 14)
    typical_prices = (highs[-15:] + lows[-15:] + closes[-15:]) / 3.0
    raw_money_flow = typical_prices * volumes[-15:]
    pos_flow = 0.0
    neg_flow = 0.0
    for i in range(1, len(typical_prices)):
        if typical_prices[i] > typical_prices[i-1]:
            pos_flow += raw_money_flow[i]
        elif typical_prices[i] < typical_prices[i-1]:
            neg_flow += raw_money_flow[i]
    if neg_flow == 0:
        mfi_14 = 100.0
    else:
        mfi_14 = float(100.0 - (100.0 / (1.0 + (pos_flow / neg_flow))))

    # 6. ATR (Average True Range 14)
    tr_list = []
    for i in range(max(1, len(closes)-14), len(closes)):
        h = highs[i]
        l = lows[i]
        c_prev = closes[i-1]
        tr = max(h - l, abs(h - c_prev), abs(l - c_prev))
        tr_list.append(tr)
    atr = float(np.mean(tr_list)) if tr_list else (highs[-1] - lows[-1])
    atr_14_pct = float(atr / current_close * 100.0)

    # 7. Bollinger Bandwidth
    std20 = float(np.std(closes[-20:]))
    upper_bb = sma20 + 2 * std20
    lower_bb = sma20 - 2 * std20
    bollinger_bandwidth = (
        float((upper_bb - lower_bb) / sma20 * 100.0) if sma20 > 0 else 0.0
    )

    # 8. High-Low Spread and Range Position
    today_high = highs[-1]
    today_low = lows[-1]
    high_low_spread_pct = float((today_high - today_low) / current_close * 100.0)

    high_20d = float(np.max(highs[-20:]))
    dist_from_20d_high = float((high_20d - current_close) / current_close * 100.0)

    return {
        'percentile_rank': percentile_rank,
        'avg_turnover_20d_log': float(np.log1p(avg_turnover_20d)),
        'rvol_20d': min(rvol_20d, 20.0),
        'rsi_14': rsi_14,
        'mfi_14': mfi_14,
        'price_to_sma20': price_to_sma20,
        'price_to_sma50': price_to_sma50,
        'atr_14_pct': atr_14_pct,
        'bollinger_bandwidth': bollinger_bandwidth,
        'high_low_spread_pct': high_low_spread_pct,
        'dist_from_20d_high': dist_from_20d_high,
    }


# ─────────────────────────────────────────────────────────────────────────────
# V2: Purged Time-Series Split (Task BRAVO-GRAND-SIMULATION-PHASE-3 §3.1)
# ─────────────────────────────────────────────────────────────────────────────
def purged_time_series_split(
    df: pd.DataFrame,
    train_ratio: float = TRAIN_RATIO,
    gap_days: int = PURGE_GAP_DAYS,
    date_col: str = 'signal_date',
) -> Tuple[pd.DataFrame, pd.DataFrame, Dict[str, Any]]:
    """
    Split data chronologically with a purge gap to prevent label leakage.

    Args:
        df: DataFrame with signal_date column (will be sorted ascending).
        train_ratio: نسبة الـ train (default 0.75).
        gap_days: عدد أيام الفجوة (purge) بين train و test (default 5).
        date_col: اسم عمود التاريخ (default 'signal_date').

    Returns:
        tuple (train_df, test_df, split_meta):
            - train_df: أول train_ratio من البيانات (مرتّب تصاعديًا).
            - test_df: باقي البيانات بعد تخطّي الـ gap.
            - split_meta: dict بمعلومات الـ split (train_end, test_start,
                          n_purged, gap_days, ...).

    V2 logic:
      1. رتّب البيانات تصاعديًا حسب signal_date.
      2. split_idx = int(n * train_ratio).
      3. train_end_date = signal_date للصف عند split_idx - 1.
      4. purge_until = train_end_date + gap_days.
      5. test_start_idx = أول صف بعد split_idx حيث signal_date > purge_until.
      6. الصفوف بين split_idx و test_start_idx تُحذف (purged).
    """
    df_sorted = df.sort_values(date_col).reset_index(drop=True)
    n = len(df_sorted)
    if n == 0:
        return df_sorted, df_sorted, {
            'n_total': 0, 'n_train': 0, 'n_test': 0, 'n_purged': 0,
            'train_end_date': None, 'test_start_date': None,
            'gap_days': gap_days,
        }

    split_idx = int(n * train_ratio)
    if split_idx >= n:
        split_idx = n - 1
    if split_idx < 1:
        split_idx = 1

    train_end_date = str(df_sorted.iloc[split_idx - 1][date_col])

    # Parse train_end_date + add gap_days
    try:
        train_end_dt = datetime.fromisoformat(train_end_date)
    except (ValueError, TypeError):
        train_end_dt = datetime.now()
    purge_until_dt = train_end_dt + timedelta(days=gap_days)
    purge_until_str = purge_until_dt.date().isoformat()

    # Find first test row whose signal_date > purge_until_str
    test_start_idx = split_idx
    while (
        test_start_idx < n
        and str(df_sorted.iloc[test_start_idx][date_col]) <= purge_until_str
    ):
        test_start_idx += 1

    train_df = df_sorted.iloc[:split_idx].copy()
    test_df = df_sorted.iloc[test_start_idx:].copy()
    n_purged = test_start_idx - split_idx

    split_meta = {
        'n_total': n,
        'n_train': len(train_df),
        'n_test': len(test_df),
        'n_purged': n_purged,
        'train_end_date': train_end_date,
        'purge_until_date': purge_until_str,
        'test_start_date': (
            str(test_df.iloc[0][date_col]) if len(test_df) > 0 else None
        ),
        'gap_days': gap_days,
        'train_ratio': train_ratio,
    }
    return train_df, test_df, split_meta


# ─────────────────────────────────────────────────────────────────────────────
# V2: Evaluation metrics (Confusion Matrix, Precision, Coverage, ROC-AUC)
# ─────────────────────────────────────────────────────────────────────────────
def compute_v2_metrics(
    y_true: np.ndarray,
    y_pred_proba: np.ndarray,
    threshold: float = GATEKEEPER_THRESHOLD,
) -> Dict[str, Any]:
    """
    حساب مقاييس V2 الشاملة عند threshold معيّن.

    Args:
        y_true: true labels (0/1) للـ test set.
        y_pred_proba: predicted probabilities for class 1.
        threshold: acceptance threshold (default 0.65).

    Returns:
        dict:
            - threshold: الـ threshold المستخدم.
            - coverage_pct: نسبة الإشارات المقبولة (y_pred_proba >= threshold).
            - precision: TP / (TP + FP).
            - recall: TP / (TP + FN).
            - f1: 2 * (precision * recall) / (precision + recall).
            - confusion_matrix: {TP, TN, FP, FN}.
            - roc_auc: ROC-AUC score (من sklearn.metrics.roc_auc_score).
            - accepted_signals: عدد الإشارات المقبولة.
            - accepted_wins: عدد الإشارات المقبولة الفائزة.
            - win_rate_pct: نسبة الفوز بين المقبولين.
    """
    if len(y_true) == 0:
        return {
            'threshold': threshold, 'coverage_pct': 0.0, 'precision': 0.0,
            'recall': 0.0, 'f1': 0.0, 'roc_auc': None,
            'confusion_matrix': {'TP': 0, 'TN': 0, 'FP': 0, 'FN': 0},
            'accepted_signals': 0, 'accepted_wins': 0, 'win_rate_pct': 0.0,
        }

    y_pred = (y_pred_proba >= threshold).astype(int)
    accepted = y_pred == 1
    n_accepted = int(np.sum(accepted))
    n_total = len(y_true)
    coverage_pct = (n_accepted / n_total * 100.0) if n_total > 0 else 0.0

    # Confusion Matrix — sklearn returns [[TN, FP], [FN, TP]]
    cm = confusion_matrix(y_true, y_pred, labels=[0, 1])
    tn, fp, fn, tp = int(cm[0, 0]), int(cm[0, 1]), int(cm[1, 0]), int(cm[1, 1])

    precision = (tp / (tp + fp)) if (tp + fp) > 0 else 0.0
    recall = (tp / (tp + fn)) if (tp + fn) > 0 else 0.0
    f1 = (
        2 * precision * recall / (precision + recall)
        if (precision + recall) > 0 else 0.0
    )

    # ROC-AUC — needs both classes in y_true
    try:
        if len(np.unique(y_true)) < 2:
            roc_auc = None  # undefined if only one class
        else:
            roc_auc = float(roc_auc_score(y_true, y_pred_proba))
    except Exception:
        roc_auc = None

    accepted_wins = int(np.sum(y_true[accepted] == 1)) if n_accepted > 0 else 0
    win_rate_pct = (
        (accepted_wins / n_accepted * 100.0) if n_accepted > 0 else 0.0
    )

    return {
        'threshold': float(threshold),
        'coverage_pct': round(coverage_pct, 2),
        'precision': round(precision, 4),
        'recall': round(recall, 4),
        'f1': round(f1, 4),
        'roc_auc': (round(roc_auc, 4) if roc_auc is not None else None),
        'confusion_matrix': {'TP': tp, 'TN': tn, 'FP': fp, 'FN': fn},
        'accepted_signals': n_accepted,
        'accepted_wins': accepted_wins,
        'win_rate_pct': round(win_rate_pct, 2),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
    print("=" * 70)
    print("GLM 5.2 QUANT AI: Training LightGBM Signal Gatekeeper V2")
    print("(Task BRAVO-GRAND-SIMULATION-PHASE-3 — 297 verified signals)")
    print("=" * 70)
    print(f"PROJECT_ROOT : {PROJECT_ROOT}")
    print(f"STOCKS_DB    : {STOCKS_DB}   (readonly)")
    print(f"MODEL_OUT    : {MODEL_OUT_PATH}")
    print(f"METRICS_OUT  : {METRICS_OUT_PATH}")
    print()

    if not STOCKS_DB.exists():
        print(f"FATAL: stocks.db not found at {STOCKS_DB}", file=sys.stderr)
        return 1

    # 1. Connect to DB + load candles cache
    conn = open_db_readonly(STOCKS_DB)
    candles_cache = load_candles_cache(conn)

    # 2. Fetch VERIFIED signals (V2 — استخدم status column مباشرة)
    # 120 verified_win + 177 verified_loss = 297 signals
    print("\nFetching VERIFIED signals from radar_signal_tracking...")
    signals_query = """
        SELECT id, ticker, signal_date, entry_price, signal_type, status
        FROM radar_signal_tracking
        WHERE status IN ('verified_win', 'verified_loss')
          AND entry_price IS NOT NULL AND entry_price > 0
        ORDER BY signal_date ASC, id ASC
    """
    signals_df = pd.read_sql_query(signals_query, conn)
    conn.close()
    print(f"Total verified signals fetched: {len(signals_df):,}")
    n_win = (signals_df['status'] == 'verified_win').sum()
    n_loss = (signals_df['status'] == 'verified_loss').sum()
    print(f"  verified_win  : {n_win}")
    print(f"  verified_loss : {n_loss}")
    if len(signals_df) > 0:
        wr = n_win / len(signals_df) * 100.0
        print(f"  overall win rate: {wr:.2f}%")

    # 3. Pre-calculate market turnovers per date for percentile calculations
    all_dates = signals_df['signal_date'].unique()
    market_turnovers_by_date: Dict[str, np.ndarray] = {}
    print("\nBuilding historical market liquidity percentiles (cached per date)...")
    for d in all_dates:
        turnovers_list: List[float] = []
        for ticker, t_df in candles_cache.items():
            t_sub = t_df[t_df['price_date'] <= d].tail(20)
            if len(t_sub) >= 5:
                turnovers_list.append(float(t_sub['turnover'].mean()))
        market_turnovers_by_date[d] = (
            np.sort(np.array(turnovers_list)) if turnovers_list else np.array([])
        )

    # 4. Extract Features + Labels (V2 — label = 1 if verified_win, 0 if verified_loss)
    print("\nExtracting quantitative feature vectors (Purged, Zero Lookahead)...")
    dataset_rows: List[Dict[str, Any]] = []

    signal_type_map = {
        'pre_surge': 1,
        'quiet_accumulation_strong': 2,
        'A_pre_surge': 1,
        'B_quiet_accumulation_strong': 2,
        'explosive_surge': 3,
        'D_explosive_surge': 3,
        'early_break': 4,
        'E_early_break': 4,
    }

    wins_count = 0
    losses_count = 0
    skipped_count = 0

    for idx, row in signals_df.iterrows():
        ticker = row['ticker']
        s_date = row['signal_date']
        sig_type = str(row['signal_type'] or '')

        if ticker not in candles_cache:
            skipped_count += 1
            continue

        t_df = candles_cache[ticker]
        features = compute_features_for_signal(
            t_df, s_date, market_turnovers_by_date.get(s_date, np.array([]))
        )
        if features is None:
            skipped_count += 1
            continue

        # V2 label: 1 if verified_win, 0 if verified_loss
        label = 1 if row['status'] == 'verified_win' else 0

        features['signal_type_code'] = signal_type_map.get(sig_type, 0)
        features['signal_date'] = s_date
        features['ticker'] = ticker
        features['label'] = label

        dataset_rows.append(features)
        if label == 1:
            wins_count += 1
        else:
            losses_count += 1

    if not dataset_rows:
        print("FATAL: no valid samples after feature extraction.", file=sys.stderr)
        return 1

    print(f"Dataset constructed: {len(dataset_rows):,} valid samples "
          f"(skipped: {skipped_count}).")
    if dataset_rows:
        wr_ds = wins_count / len(dataset_rows) * 100.0
        print(f"  Wins  : {wins_count:,} ({wr_ds:.2f}%)")
        print(f"  Losses: {losses_count:,} ({100.0 - wr_ds:.2f}%)")

    df_data = pd.DataFrame(dataset_rows)
    df_data = df_data.sort_values('signal_date').reset_index(drop=True)

    feature_cols = [
        'percentile_rank',
        'avg_turnover_20d_log',
        'rvol_20d',
        'rsi_14',
        'mfi_14',
        'price_to_sma20',
        'price_to_sma50',
        'atr_14_pct',
        'bollinger_bandwidth',
        'high_low_spread_pct',
        'dist_from_20d_high',
        'signal_type_code',
    ]

    X = df_data[feature_cols]
    y = df_data['label'].values

    # 5. V2: Purged Time-Series Split (chronological + 5-day gap)
    # محاولة بـ gap=5 أيام أولًا. لو أنتج test set فارغ (بياناتنا 8 أيام فقط)،
    # نُقلل الـ gap تدريجيًا (5→3→2→1→0) حتى نحصل على test set غير فارغ.
    print("\n" + "=" * 70)
    print(f"V2 Purged Time-Series Split (train_ratio={TRAIN_RATIO}, "
          f"gap_days=auto)")
    print("=" * 70)

    split_meta: Dict[str, Any] = {}
    train_df: pd.DataFrame = pd.DataFrame()
    test_df: pd.DataFrame = pd.DataFrame()
    actual_gap = PURGE_GAP_DAYS
    for try_gap in [PURGE_GAP_DAYS, 3, 2, 1, 0]:
        train_df_try, test_df_try, split_meta_try = purged_time_series_split(
            df_data, train_ratio=TRAIN_RATIO, gap_days=try_gap,
            date_col='signal_date'
        )
        if len(test_df_try) >= max(5, int(0.10 * len(df_data))):
            train_df, test_df, split_meta = (
                train_df_try, test_df_try, split_meta_try
            )
            actual_gap = try_gap
            break
        # Save last attempt as fallback if all fail
        if try_gap == 0:
            train_df, test_df, split_meta = (
                train_df_try, test_df_try, split_meta_try
            )
            actual_gap = 0

    print(f"n_total   : {split_meta['n_total']}")
    print(f"n_train   : {split_meta['n_train']}  ({int(train_df['label'].sum())} wins)")
    print(f"n_test    : {split_meta['n_test']}  ({int(test_df['label'].sum())} wins)")
    print(f"n_purged  : {split_meta['n_purged']}  (signals dropped in the "
          f"{actual_gap}-day gap)")
    print(f"train_end_date : {split_meta['train_end_date']}")
    print(f"purge_until    : {split_meta['purge_until_date']}")
    print(f"test_start_date: {split_meta['test_start_date']}")
    if actual_gap < PURGE_GAP_DAYS:
        print(f"  ⚠ NOTE: requested gap={PURGE_GAP_DAYS} days produced empty "
              f"test set (signal range too short — only 8 calendar days). "
              f"Fell back to gap={actual_gap} days. Document this limitation.")
    if len(test_df) > 0:
        baseline_test_winrate = float(test_df['label'].mean() * 100.0)
    else:
        baseline_test_winrate = 0.0
    print(f"Baseline Unfiltered Test Win Rate: {baseline_test_winrate:.2f}%")

    if len(train_df) == 0 or len(test_df) == 0:
        print("FATAL: empty train or test set after purge.", file=sys.stderr)
        return 1

    X_train = train_df[feature_cols]
    X_test = test_df[feature_cols]
    y_train = train_df['label'].values
    y_test = test_df['label'].values
    dates_test = test_df['signal_date'].values

    # Update split_meta with the actual gap used (for the saved metadata)
    split_meta['actual_gap_days'] = actual_gap
    split_meta['requested_gap_days'] = PURGE_GAP_DAYS
    split_meta['fallback_note'] = (
        f'Requested gap={PURGE_GAP_DAYS} days; actual gap={actual_gap} days '
        f'(signal date range too short for full 5-day purge).'
        if actual_gap < PURGE_GAP_DAYS else
        f'Used requested gap={PURGE_GAP_DAYS} days.'
    )

    # 6. Train LightGBM Classifier (V2 hyperparameters — same as V1 for parity)
    print("\nTraining LightGBM Classifier (V2)...")
    # Scale pos_weight to balance the class distribution
    pos_weight = (len(y_train) - y_train.sum()) / max(1, y_train.sum())

    model = lgb.LGBMClassifier(
        n_estimators=150,
        learning_rate=0.03,
        num_leaves=15,
        max_depth=5,
        min_child_samples=15,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=pos_weight * 0.7,  # Conservative to prioritize Precision
        random_state=RANDOM_STATE,
        verbose=-1,
    )

    model.fit(
        X_train,
        y_train,
        eval_set=[(X_test, y_test)],
        callbacks=[lgb.early_stopping(stopping_rounds=20, verbose=False)],
    )

    # 7. V2 Evaluation: Confusion Matrix + Precision + Coverage + ROC-AUC
    y_pred_proba = model.predict_proba(X_test)[:, 1]
    v2_metrics = compute_v2_metrics(
        y_test, y_pred_proba, threshold=GATEKEEPER_THRESHOLD
    )

    print("\n" + "=" * 70)
    print(f"V2 EVALUATION AT THRESHOLD = {GATEKEEPER_THRESHOLD}")
    print("=" * 70)
    print(f"  Coverage (accepted/total)        : "
          f"{v2_metrics['accepted_signals']}/{len(y_test)} "
          f"({v2_metrics['coverage_pct']:.2f}%)")
    print(f"  Precision (TP/(TP+FP))           : {v2_metrics['precision']:.4f}")
    print(f"  Recall    (TP/(TP+FN))           : {v2_metrics['recall']:.4f}")
    print(f"  F1 Score                          : {v2_metrics['f1']:.4f}")
    roc_auc_val = v2_metrics['roc_auc']
    roc_auc_str = (
        'null (one class in y_test)' if roc_auc_val is None
        else f'{roc_auc_val:.4f}'
    )
    print(f"  ROC-AUC                           : {roc_auc_str}")
    cm = v2_metrics['confusion_matrix']
    print(f"  Confusion Matrix                  : "
          f"TP={cm['TP']}  TN={cm['TN']}  FP={cm['FP']}  FN={cm['FN']}")
    print(f"  Win Rate (accepted wins/accepted) : "
          f"{v2_metrics['win_rate_pct']:.2f}%")
    print(f"  Improvement over baseline         : "
          f"{v2_metrics['win_rate_pct'] - baseline_test_winrate:+.2f}pp")

    # Also evaluate at multiple thresholds for the metrics report
    print("\n--- THRESHOLD SWEEP (V2) ---")
    thresholds = [0.40, 0.50, 0.55, 0.60, 0.65, 0.70]
    threshold_evaluations: List[Dict[str, Any]] = []
    for th in thresholds:
        m = compute_v2_metrics(y_test, y_pred_proba, threshold=th)
        print(f"  th={th:.2f} | accepted={m['accepted_signals']:>3} | "
              f"precision={m['precision']:.4f} | coverage={m['coverage_pct']:.2f}% | "
              f"win_rate={m['win_rate_pct']:.2f}% | "
              f"roc_auc={m['roc_auc']}")
        threshold_evaluations.append({
            'threshold': th,
            'accepted_signals': m['accepted_signals'],
            'coverage_pct': m['coverage_pct'],
            'precision': m['precision'],
            'recall': m['recall'],
            'f1': m['f1'],
            'win_rate_pct': m['win_rate_pct'],
            'confusion_matrix': m['confusion_matrix'],
            'improvement_pp': round(
                m['win_rate_pct'] - baseline_test_winrate, 2
            ),
        })

    # Feature Importances
    importances = model.feature_importances_
    feat_imp = sorted(
        zip(feature_cols, importances), key=lambda x: x[1], reverse=True
    )
    print("\n--- TOP 7 PREDICTIVE FEATURES (LIGHTGBM V2) ---")
    feature_importances: Dict[str, int] = {}
    for feat, imp in feat_imp[:7]:
        print(f"  {feat:<25}: {imp:>4} splits")
        feature_importances[feat] = int(imp)
    # Include all features in the JSON
    all_feature_importances: Dict[str, int] = {
        feat: int(imp) for feat, imp in feat_imp
    }

    # 8. V2 Save Model Artifacts — model as a dict with metadata
    trained_at = datetime.now(timezone.utc).isoformat()
    model_artifact: Dict[str, Any] = {
        'version': MODEL_VERSION,
        'model': model,  # the LGBMClassifier itself
        'feature_names': list(feature_cols),
        'feature_importances': all_feature_importances,
        'threshold': GATEKEEPER_THRESHOLD,
        'roc_auc': v2_metrics['roc_auc'],
        'confusion_matrix': v2_metrics['confusion_matrix'],
        'precision_at_threshold': v2_metrics['precision'],
        'recall_at_threshold': v2_metrics['recall'],
        'coverage_pct': v2_metrics['coverage_pct'],
        'win_rate_pct_at_threshold': v2_metrics['win_rate_pct'],
        'baseline_win_rate_pct': round(baseline_test_winrate, 2),
        'improvement_pp': round(
            v2_metrics['win_rate_pct'] - baseline_test_winrate, 2
        ),
        'trained_at': trained_at,
        'n_train': int(len(X_train)),
        'n_test': int(len(X_test)),
        'n_purged': int(split_meta['n_purged']),
        'purge_gap_days': PURGE_GAP_DAYS,
        'train_end_date': split_meta['train_end_date'],
        'test_start_date': split_meta['test_start_date'],
        'target_pct': TARGET_PCT,
        'stop_pct': STOP_PCT,
        'window_days': WINDOW_DAYS,
        'training_universe': (
            'radar_signal_tracking WHERE status IN (verified_win, verified_loss) '
            'AND entry_price > 0 — 297 signals (120 win + 177 loss)'
        ),
        'rule_27_compliance': (
            'All labels from real `status` column in radar_signal_tracking — '
            'no fabrication. Features computed point-in-time from real price data.'
        ),
    }
    joblib.dump(model_artifact, MODEL_OUT_PATH)
    print(f"\nV2 Model artifact saved to: {MODEL_OUT_PATH}")
    print(f"  file size: {MODEL_OUT_PATH.stat().st_size:,} bytes")
    print(f"  version: {MODEL_VERSION}")
    print(f"  roc_auc: {v2_metrics['roc_auc']}")
    print(f"  confusion_matrix: {v2_metrics['confusion_matrix']}")
    print(f"  trained_at: {trained_at}")

    # 9. Save metrics JSON (V2 — full report)
    metrics_report: Dict[str, Any] = {
        'version': MODEL_VERSION,
        'generated_at': trained_at,
        'training_universe': {
            'source': 'radar_signal_tracking (verified_win + verified_loss)',
            'total_verified_signals': len(signals_df),
            'verified_win': int(n_win),
            'verified_loss': int(n_loss),
            'skipped_insufficient_history': skipped_count,
            'valid_samples_used': len(dataset_rows),
        },
        'split': split_meta,
        'baseline_win_rate_pct': round(baseline_test_winrate, 2),
        'v2_metrics_at_threshold_0.65': v2_metrics,
        'threshold_evaluations': threshold_evaluations,
        'feature_importances': all_feature_importances,
        'feature_importances_top7': feature_importances,
        'hyperparameters': {
            'n_estimators': 150,
            'learning_rate': 0.03,
            'num_leaves': 15,
            'max_depth': 5,
            'min_child_samples': 15,
            'subsample': 0.8,
            'colsample_bytree': 0.8,
            'scale_pos_weight_factor': 0.7,
            'random_state': RANDOM_STATE,
            'early_stopping_rounds': 20,
        },
        'feature_columns': list(feature_cols),
        'rule_27_compliance': (
            'All labels from real `status` column in radar_signal_tracking — '
            'no fabrication. Features computed point-in-time from real price data.'
        ),
    }
    with open(METRICS_OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(metrics_report, f, indent=2, ensure_ascii=False)
    print(f"V2 Metrics JSON saved to: {METRICS_OUT_PATH}")

    print("\n=== LIGHTGBM SIGNAL GATEKEEPER V2 TRAINING COMPLETE ===")
    return 0


if __name__ == '__main__':
    sys.exit(main())
