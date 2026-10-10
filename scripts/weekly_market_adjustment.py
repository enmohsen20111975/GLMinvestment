#!/usr/bin/env python3
"""
Weekly Market Adjustment — Simple Learning Mechanism
====================================================
محرك التعلم الأسبوعي (P24-ADAPTIVE-ENGINE — أغسطس 2026)

الفكرة:
  كل أسبوع، السكريبت ده بيقرأ الأسهم اللي عملت +20% في آخر 15 يوم تداول،
  بيطلع الخصائص المشتركة بينها (volume spike ratio, RSI range, volatility)،
  وبيعمل soft adjustment لملف config/optimizer_params.json عشان المنصة تتعلّم
  من النجاحات وتعدّل عتباتها تدريجياً.

كيفية التشغيل:
  python3 scripts/weekly_market_adjustment.py
  (يا ريت يتعمل cron أسبوعي: 0 6 * * 1 — كل اتنين صبحاً 6)

القاعدة الذهبية: تعديلات soft فقط (±10% max per run)، ومش بيمسح القيم
اللي كتبها الأدمن يدوياً — بيحفظ الـ baseline في حقل منفصل عشان يقدر يرجع.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import math
import statistics
from datetime import datetime, timedelta
from pathlib import Path

# Project root: scripts/ -> project root
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
OPTIMIZER_PARAMS_PATH = str(_PROJECT_ROOT / 'config' / 'optimizer_params.json')

# Learning parameters
WINNER_RETURN_THRESHOLD = 20.0     # +20% في 15 يوم = "winner"
LOOKBACK_DAYS = 15                 # نوفّر 15 يوم تداول
MIN_WINNERS_FOR_LEARNING = 3       # أقل من 3 فائزين → ما نتعلّمش (عينة صغيرة)
SOFT_ADJUST_MAX_PCT = 0.10         # max ±10% تعديل لكل run
RSI_BULLISH_RANGE_DEFAULT = (40, 70)


def _log(msg: str) -> None:
    print(f"[weekly-adjust] {msg}")


def _compute_rsi(closes: list, period: int = 14) -> float:
    """حساب RSI بسيط."""
    if len(closes) < period + 1:
        return 50.0
    gains, losses = 0.0, 0.0
    for i in range(len(closes) - period, len(closes)):
        change = closes[i] - closes[i - 1]
        if change > 0:
            gains += change
        else:
            losses += abs(change)
    if losses == 0:
        return 100.0
    rs = gains / losses
    return round(100 - (100 / (1 + rs)), 2)


def _compute_volume_spike(volumes: list) -> float:
    """volume spike ratio = today_volume / avg_20d."""
    if len(volumes) < 21:
        return 1.0
    avg_20 = sum(volumes[-21:-1]) / 20.0 if len(volumes) >= 21 else sum(volumes[:-1]) / max(1, len(volumes) - 1)
    if avg_20 <= 0:
        return 1.0
    return volumes[-1] / avg_20


def _compute_volatility_pct(closes: list) -> float:
    """20-day volatility as % (max-min)/mean."""
    if len(closes) < 20:
        return 0.0
    recent = closes[-20:]
    mean = sum(recent) / len(recent)
    if mean <= 0:
        return 0.0
    return ((max(recent) - min(recent)) / mean) * 100.0


def find_winners(db_path: str = STOCKS_DB, days: int = LOOKBACK_DAYS,
                 threshold: float = WINNER_RETURN_THRESHOLD) -> list:
    """الأسهم اللي عملت +threshold% في آخر `days` يوم تداول.

    Returns:
        list of dicts: {ticker, return_pct, volume_spike, rsi, volatility_pct,
                        sector, start_price, end_price}
    """
    winners = []
    if not os.path.exists(db_path):
        _log(f"DB not found: {db_path}")
        return winners

    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        # جلب كل الأسهم النشطة
        cur.execute("SELECT ticker, sector FROM stocks WHERE is_active = 1 AND market = 'EGX'")
        all_stocks = [(r['ticker'], r['sector'] or 'UNKNOWN') for r in cur.fetchall()]
        conn.close()
    except Exception as e:
        _log(f"Failed to read stocks list: {e}")
        return winners

    _log(f"Scanning {len(all_stocks)} active EGX stocks for +{threshold}% winners in last {days} days...")

    for ticker, sector in all_stocks:
        try:
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()
            cur.execute(
                "SELECT close, volume FROM stock_daily_prices "
                "WHERE ticker = ? AND close IS NOT NULL AND close > 0 "
                "ORDER BY price_date DESC LIMIT ?",
                (ticker, days + 5),
            )
            rows = cur.fetchall()
            conn.close()
            if len(rows) < days:
                continue
            rows.reverse()  # oldest -> newest
            closes = [float(r[0]) for r in rows if r[0]]
            volumes = [float(r[1] or 0) for r in rows]
            if len(closes) < 5:
                continue
            start_price = closes[0]
            end_price = closes[-1]
            if start_price <= 0:
                continue
            return_pct = ((end_price - start_price) / start_price) * 100.0
            if return_pct < threshold:
                continue
            vol_spike = _compute_volume_spike(volumes)
            rsi = _compute_rsi(closes)
            vol_pct = _compute_volatility_pct(closes)
            winners.append({
                'ticker': ticker,
                'sector': sector,
                'return_pct': round(return_pct, 2),
                'volume_spike': round(vol_spike, 2),
                'rsi': rsi,
                'volatility_pct': round(vol_pct, 2),
                'start_price': round(start_price, 2),
                'end_price': round(end_price, 2),
            })
        except Exception:
            continue

    _log(f"Found {len(winners)} winners (≥+{threshold}% in {days}d).")
    return winners


def extract_common_traits(winners: list) -> dict:
    """استخراج الخصائص المشتركة من قائمة الفائزين.

    Returns:
        dict: {
            'avg_volume_spike': float,
            'avg_rsi': float,
            'rsi_range': (low, high),  # الـ 25th-75th percentile
            'avg_volatility_pct': float,
            'count': int,
            'top_sectors': [(sector, count), ...],
        }
    """
    if not winners:
        return {}
    vol_spikes = [w['volume_spike'] for w in winners]
    rsis = [w['rsi'] for w in winners]
    vols = [w['volatility_pct'] for w in winners]

    # RSI range = 25th to 75th percentile (المنطقة اللي معظم الفائزين فيها)
    sorted_rsis = sorted(rsis)
    n = len(sorted_rsis)
    if n >= 4:
        q25 = sorted_rsis[n // 4]
        q75 = sorted_rsis[(3 * n) // 4]
    else:
        q25, q75 = min(rsis), max(rsis)

    # top sectors
    sector_counts = {}
    for w in winners:
        s = w['sector']
        sector_counts[s] = sector_counts.get(s, 0) + 1
    top_sectors = sorted(sector_counts.items(), key=lambda x: -x[1])[:5]

    return {
        'avg_volume_spike': round(statistics.mean(vol_spikes), 2),
        'avg_rsi': round(statistics.mean(rsis), 2),
        'rsi_range': (round(q25, 1), round(q75, 1)),
        'avg_volatility_pct': round(statistics.mean(vols), 2),
        'count': len(winners),
        'top_sectors': top_sectors,
        'generated_at': datetime.now().isoformat(),
    }


def soft_adjust_optimizer_params(traits: dict, params_path: str = OPTIMIZER_PARAMS_PATH) -> dict:
    """تعديل soft لملف optimizer_params.json بناءً على الخصائص المستفادة.

    القواعد:
      - لو avg_volume_spike للفائزين > 2.0 → نخفّض volume_spike_mult (نشتري على spike أقل)
      - لو avg_rsi للفائزين في نطاق صعودي (50-70) → نخفّض min_technical_confluence
      - لو avg_volatility_pct > 8% → نرفع max_stop_pct شوية (نتسامح مع التذبذب)
      - التعديل max ±10% per run (SOFT_ADJUST_MAX_PCT).

    Returns:
        dict: {old_params, new_params, changes_applied}
    """
    if not traits or not os.path.exists(params_path):
        _log("No traits or params file missing — skipping adjustment.")
        return {'old_params': None, 'new_params': None, 'changes_applied': []}

    try:
        with open(params_path, 'r', encoding='utf-8') as f:
            old_params = json.load(f)
    except Exception as e:
        _log(f"Failed to read {params_path}: {e}")
        return {'old_params': None, 'new_params': None, 'changes_applied': []}

    new_params = dict(old_params)
    changes = []

    def _soft_adjust(key: str, direction: str, reason: str):
        """direction: 'up' or 'down'، max ±10%."""
        if key not in new_params:
            return
        try:
            current = float(new_params[key])
        except (TypeError, ValueError):
            return
        delta = current * SOFT_ADJUST_MAX_PCT
        if direction == 'up':
            new_val = current + delta
        else:
            new_val = current - delta
        # لا تنزل تحت 0
        new_val = max(0.0, new_val)
        new_params[key] = round(new_val, 4)
        changes.append({
            'key': key,
            'old': current,
            'new': new_params[key],
            'direction': direction,
            'reason': reason,
        })

    # 1. volume_spike_mult: لو الفائزين عندهم spike > 2.0 → نخفّض العتبة (نشتري على spike أقل)
    avg_vol_spike = traits.get('avg_volume_spike', 1.5)
    if avg_vol_spike > 2.0:
        _soft_adjust('volume_spike_mult', 'down',
                     f"winners avg_vol_spike={avg_vol_spike}>2.0 → lower threshold")

    # 2. min_technical_confluence: لو الفائزين RSI في نطاق صعودي → نخفّض العتبة
    rsi_range = traits.get('rsi_range', (40, 70))
    if rsi_range[0] >= 45 and rsi_range[1] <= 75:
        _soft_adjust('min_technical_confluence', 'down',
                     f"winners RSI range {rsi_range} is bullish → lower confluence requirement")

    # 3. max_stop_pct: لو الفائزين تذبذبهم عالي → نوسّع الوقف
    avg_vol = traits.get('avg_volatility_pct', 0.0)
    if avg_vol > 8.0:
        _soft_adjust('max_stop_pct', 'up',
                     f"winners avg_volatility={avg_vol}%>8% → widen stop")

    # 4. min_rr_ratio: لو الفائزين عملوا +20%+ → نقدر نخفّض R/R المطلوب (الثقة أكتر)
    if traits.get('count', 0) >= 5 and avg_vol_spike > 1.5:
        _soft_adjust('min_rr_ratio', 'down',
                     f"{traits['count']} winners with strong momentum → lower RR floor")

    # اكتب الملف الجديد (مع backup للقديم في حقل metadata)
    if changes:
        new_params['_last_weekly_adjustment'] = {
            'timestamp': datetime.now().isoformat(),
            'winners_count': traits.get('count', 0),
            'changes': changes,
            'traits_summary': {
                'avg_volume_spike': avg_vol_spike,
                'avg_rsi': traits.get('avg_rsi'),
                'rsi_range': list(rsi_range),
                'avg_volatility_pct': avg_vol,
            },
        }
        try:
            with open(params_path, 'w', encoding='utf-8') as f:
                json.dump(new_params, f, indent=2, ensure_ascii=False)
            _log(f"Updated {params_path} with {len(changes)} soft adjustments.")
        except Exception as e:
            _log(f"Failed to write {params_path}: {e}")

    return {'old_params': old_params, 'new_params': new_params, 'changes_applied': changes}


def main() -> int:
    _log("=" * 60)
    _log("Weekly Market Adjustment — Simple Learning Mechanism (P24)")
    _log("=" * 60)
    _log(f"DB: {STOCKS_DB}")
    _log(f"Params: {OPTIMIZER_PARAMS_PATH}")
    _log(f"Threshold: +{WINNER_RETURN_THRESHOLD}% in {LOOKBACK_DAYS}d")
    _log("")

    # 1. find winners
    winners = find_winners()
    if len(winners) < MIN_WINNERS_FOR_LEARNING:
        _log(f"Only {len(winners)} winners found (< {MIN_WINNERS_FOR_LEARNING}). "
             f"Not enough data to learn — skipping adjustment.")
        return 0

    _log("")
    _log(f"Top 10 winners:")
    for w in sorted(winners, key=lambda x: -x['return_pct'])[:10]:
        _log(f"  {w['ticker']:8s} +{w['return_pct']:6.1f}%  "
             f"vol_spike={w['volume_spike']:.1f}x  RSI={w['rsi']:.0f}  "
             f"vol={w['volatility_pct']:.1f}%  ({w['sector']})")

    # 2. extract common traits
    traits = extract_common_traits(winners)
    _log("")
    _log("Common traits of winners:")
    _log(f"  avg_volume_spike : {traits.get('avg_volume_spike')}")
    _log(f"  avg_rsi         : {traits.get('avg_rsi')}")
    _log(f"  rsi_range (Q25-Q75): {traits.get('rsi_range')}")
    _log(f"  avg_volatility  : {traits.get('avg_volatility_pct')}%")
    _log(f"  top_sectors     : {traits.get('top_sectors')}")

    # 3. soft-adjust optimizer_params.json
    _log("")
    result = soft_adjust_optimizer_params(traits)
    if result['changes_applied']:
        _log("")
        _log("Soft adjustments applied:")
        for c in result['changes_applied']:
            _log(f"  {c['key']}: {c['old']} → {c['new']} ({c['direction']}) — {c['reason']}")
    else:
        _log("No adjustments needed (traits within current params).")

    _log("")
    _log("Weekly adjustment complete.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
