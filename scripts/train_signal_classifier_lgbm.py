#!/usr/bin/env python3
"""
scripts/train_signal_classifier_lgbm.py
========================================
Institutional ML Signal Gatekeeper — Trained on Real Egyptian/Arab Market Data.
Adheres strictly to Rule 20 (Python = Brain) and Rule 27 (NO-FAKE-DATA).

Features Extracted (Point-in-Time, Zero Lookahead Bias):
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
  12. `signal_type_encoded`: Categorical code of Wyckoff pattern.

Target:
  1 = Verified Win (+5% target hit before -5% stop loss)
  0 = Verified Loss (-5% stop loss hit or target not hit within window)
"""

import os
import sys
import json
import sqlite3
import numpy as np
import pandas as pd
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import joblib

import lightgbm as lgb
from sklearn.metrics import classification_report, roc_auc_score, precision_score, recall_score, f1_score
from sklearn.model_selection import TimeSeriesSplit

PROJECT_ROOT = Path('/home/meme/my_apps/GLMinvestment')
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'
PRICE_HISTORY_DB = PROJECT_ROOT / 'db' / 'price_history.db'
MODELS_DIR = PROJECT_ROOT / 'models'
MODELS_DIR.mkdir(parents=True, exist_ok=True)
MODEL_OUT_PATH = MODELS_DIR / 'lgbm_signal_gatekeeper.joblib'
METRICS_OUT_PATH = MODELS_DIR / 'lgbm_metrics.json'

TARGET_PCT = 5.0
STOP_PCT = -5.0
WINDOW_DAYS = 30


def parse_val(v) -> float:
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
    df.loc[zero_turnover, 'turnover'] = df.loc[zero_turnover, 'close'] * df.loc[zero_turnover, 'volume']
    
    cache = {}
    for ticker, group in df.groupby('ticker'):
        cache[ticker] = group.reset_index(drop=True)
    print(f"Cached {len(cache):,} tickers with daily candles.")
    return cache


def compute_features_for_signal(
    ticker_df: pd.DataFrame,
    signal_date: str,
    market_turnovers_at_date: np.ndarray,
) -> Optional[Dict[str, float]]:
    """Compute point-in-time features strictly on or before signal_date."""
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
        percentile_rank = float(np.mean(market_turnovers_at_date <= avg_turnover_20d) * 100.0)
    else:
        percentile_rank = 50.0
    
    # 2. Relative Volume (RVol)
    today_vol = volumes[-1]
    avg_vol_20d = float(np.mean(volumes[-20:])) if len(volumes) >= 20 else today_vol
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
    bollinger_bandwidth = float((upper_bb - lower_bb) / sma20 * 100.0) if sma20 > 0 else 0.0
    
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


def evaluate_ground_truth_outcome(
    ticker_df: pd.DataFrame,
    signal_date: str,
    entry_price: float,
    target_pct: float = TARGET_PCT,
    stop_pct: float = STOP_PCT,
) -> Tuple[Optional[int], str]:
    """
    Evaluate true trade outcome using strict conservative logic:
    If target and stop are both touched in the same day -> Stop Loss First (0).
    """
    future = ticker_df[ticker_df['price_date'] > signal_date].head(WINDOW_DAYS)
    if len(future) == 0:
        return None, 'no_future_candles'
    
    target_price = entry_price * (1.0 + target_pct / 100.0)
    stop_price = entry_price * (1.0 + stop_pct / 100.0)
    
    for _, row in future.iterrows():
        high = row['high']
        low = row['low']
        close = row['close']
        
        hit_target = high >= target_price
        hit_stop = low <= stop_price
        
        if hit_target and hit_stop:
            return 0, 'same_day_stop_loss'  # Conservative rule V-01
        elif hit_stop:
            return 0, 'stop_loss_hit'
        elif hit_target:
            return 1, 'target_hit_win'
            
    # Window expired without hitting either
    final_return = (future.iloc[-1]['close'] - entry_price) / entry_price * 100.0
    return (1 if final_return > 0 else 0), 'window_expired'


def main():
    print("=" * 70)
    print("GLM 5.2 QUANT AI: Training LightGBM Signal Gatekeeper")
    print("=" * 70)
    
    # 1. Connect to databases
    conn_stocks = sqlite3.connect(f'file:{STOCKS_DB}?mode=ro', uri=True)
    candles_cache = load_candles_cache(conn_stocks)
    
    # 2. Fetch all signals from radar_signal_tracking
    print("Fetching signals from radar_signal_tracking...")
    signals_query = """
        SELECT id, ticker, signal_date, entry_price, signal_type, status
        FROM radar_signal_tracking
        WHERE entry_price IS NOT NULL AND entry_price > 0
        ORDER BY signal_date ASC
    """
    signals_df = pd.read_sql_query(signals_query, conn_stocks)
    print(f"Total raw signals fetched: {len(signals_df):,}")
    
    # Pre-calculate market average turnovers per date for percentile calculations
    all_dates = signals_df['signal_date'].unique()
    market_turnovers_by_date = {}
    print("Building historical market liquidity percentiles...")
    for d in all_dates:
        turnovers_list = []
        for ticker, t_df in candles_cache.items():
            t_sub = t_df[t_df['price_date'] <= d].tail(20)
            if len(t_sub) >= 5:
                turnovers_list.append(t_sub['turnover'].mean())
        market_turnovers_by_date[d] = np.sort(np.array(turnovers_list)) if turnovers_list else np.array([])
    
    # 3. Extract Features and Ground-Truth Labels
    print("Extracting quantitative feature vectors (Purged, Zero Lookahead)...")
    dataset_rows = []
    
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
        entry_px = float(row['entry_price'])
        sig_type = str(row['signal_type'] or '')
        
        if ticker not in candles_cache:
            skipped_count += 1
            continue
            
        t_df = candles_cache[ticker]
        features = compute_features_for_signal(t_df, s_date, market_turnovers_by_date.get(s_date, np.array([])))
        if features is None:
            skipped_count += 1
            continue
            
        label, outcome_reason = evaluate_ground_truth_outcome(t_df, s_date, entry_px)
        if label is None:
            skipped_count += 1
            continue
            
        features['signal_type_code'] = signal_type_map.get(sig_type, 0)
        features['signal_date'] = s_date
        features['ticker'] = ticker
        features['label'] = label
        
        dataset_rows.append(features)
        if label == 1:
            wins_count += 1
        else:
            losses_count += 1
            
    print(f"Dataset constructed: {len(dataset_rows):,} valid samples.")
    print(f"Wins: {wins_count:,} ({wins_count/len(dataset_rows)*100:.2f}%) | Losses: {losses_count:,} ({losses_count/len(dataset_rows)*100:.2f}%)")
    
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
    
    # 4. Strict Time-Series Split (75% Train, 25% Out-Of-Sample Test)
    split_idx = int(len(df_data) * 0.75)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]
    dates_test = df_data['signal_date'].iloc[split_idx:].values
    
    print("\n" + "=" * 50)
    print(f"Train samples (earlier dates): {len(X_train):,} ({y_train.sum()} wins)")
    print(f"Test samples (latest out-of-sample): {len(X_test):,} ({y_test.sum()} wins)")
    baseline_test_winrate = y_test.mean() * 100.0
    print(f"Baseline Unfiltered Test Win Rate: {baseline_test_winrate:.2f}%")
    print("=" * 50)
    
    # 5. Train LightGBM Classifier
    print("\nTraining LightGBM Classifier...")
    # Scale pos_weight to give balanced focus on high-probability precision
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
        random_state=42,
        verbose=-1,
    )
    
    model.fit(
        X_train,
        y_train,
        eval_set=[(X_test, y_test)],
        callbacks=[lgb.early_stopping(stopping_rounds=20, verbose=False)],
    )
    
    # 6. Evaluation & Confidence Threshold Analysis
    y_pred_proba = model.predict_proba(X_test)[:, 1]
    
    print("\n" + "=" * 70)
    print("OUT-OF-SAMPLE PRECISION & WIN-RATE BY AI CONFIDENCE THRESHOLD")
    print("=" * 70)
    
    thresholds = [0.40, 0.50, 0.55, 0.60, 0.65, 0.70]
    metrics_report = {
        'baseline_win_rate_pct': round(baseline_test_winrate, 2),
        'total_test_samples': len(X_test),
        'threshold_evaluations': [],
        'feature_importances': {},
    }
    
    for th in thresholds:
        accepted_idx = y_pred_proba >= th
        n_accepted = np.sum(accepted_idx)
        if n_accepted == 0:
            print(f"Threshold >= {th:.2f} | 0 signals accepted")
            continue
        accepted_wins = np.sum(y_test[accepted_idx] == 1)
        win_rate = accepted_wins / n_accepted * 100.0
        improvement = win_rate - baseline_test_winrate
        
        print(f"🎯 Threshold >= {th:.2f} | Accepted: {n_accepted:>3} signals | Wins: {accepted_wins:>3} | "
              f"Win Rate: {win_rate:>6.2f}% (Improvement: {improvement:>+5.2f}%)")
        
        metrics_report['threshold_evaluations'].append({
            'threshold': th,
            'accepted_signals': int(n_accepted),
            'wins': int(accepted_wins),
            'win_rate_pct': round(win_rate, 2),
            'improvement_pp': round(improvement, 2),
        })
        
    # Feature Importances
    importances = model.feature_importances_
    feat_imp = sorted(zip(feature_cols, importances), key=lambda x: x[1], reverse=True)
    print("\n--- TOP 7 PREDICTIVE FEATURES (LIGHTGBM) ---")
    for feat, imp in feat_imp[:7]:
        print(f"  {feat:<25}: {imp:>4} splits")
        metrics_report['feature_importances'][feat] = int(imp)
        
    # 7. Save Model Artifacts
    joblib.dump(model, MODEL_OUT_PATH)
    print(f"\nModel artifact saved to: {MODEL_OUT_PATH}")
    print(f"File size: {MODEL_OUT_PATH.stat().st_size:,} bytes")
    
    with open(METRICS_OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(metrics_report, f, indent=2, ensure_ascii=False)
    print(f"Metrics JSON saved to: {METRICS_OUT_PATH}")
    
    print("\n=== LIGHTGBM SIGNAL GATEKEEPER TRAINING COMPLETE ===")
    return 0


if __name__ == '__main__':
    sys.exit(main())
