#!/usr/bin/env python3
"""
explosive_opportunity_hunter.py — صائد الفرص الانفجارية (الاستباقي)
====================================================================
سكربت استباقي بـ يـ scan السوق كله ويطلع الأسهم اللي على وشك تطير BEFORE
ما تحصل، عشان نلتقطها بدري بدل ما نندم بعد كده.

المنطق (3 طبقات):
  1. PRE-FLIGHT DETECTION: أسهم فيها accumulation + volume surge + breakout
     setup = على وشك تطير.
  2. ENGINE-GAP ANALYSIS: لكل سهم كده، بـ يحسب Maestro score وبيقول هل
     الـ engine بـ يـ flagه BUY ولا لأ، وليه (threshold gap).
  3. PERSONA COVERAGE: بـ يقول لكل persona (gambler/balanced/conservative)
     هل هتلتقط السهم ده ولا هتـ missه.

الـ output:
  - Top-20 أسهم انفجارية محتملة (pre-flight)
  - لكل واحد: ماestro_score، recommendation المتوقع، الـ threshold gap
  - ملخص: كم سهم الـ engine بـ يـ catchهم vs كم واحد بـ يـ missهم

CLI:
  python3 vps-service/scripts/explosive_opportunity_hunter.py
  python3 vps-service/scripts/explosive_opportunity_hunter.py --top 30 --json

الـ script ده READ-ONLY — ما بـ يعدلش أي حاجة. بيقرأ من price_history.db
+ stocks.db (real VPS data في الساندبوكس، أو production DBs على الـ VPS).

Author: M2Y — P0-v12 (owner directive: "الفرص كتيييييييير جدا")
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Optional

SCRIPT_DIR = Path(__file__).resolve().parent
VPS_ROOT = SCRIPT_DIR.parent
PROJECT_ROOT = VPS_ROOT.parent

# DB paths: prefer real VPS data (sandbox), fallback to production paths (VPS)
VPS_REAL_DIR = PROJECT_ROOT / "db" / "vps_real"
PRICE_HISTORY_DB = VPS_REAL_DIR / "price_history.db" if VPS_REAL_DIR.exists() else PROJECT_ROOT / "db" / "price_history.db"
STOCKS_DB = VPS_REAL_DIR / "stocks.db" if VPS_REAL_DIR.exists() else PROJECT_ROOT / "db" / "stocks.db"

OUTPUT_DIR = SCRIPT_DIR / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ─── P0-v12 Persona thresholds ────────────────────────────────────────────
# MAESTRO-GHOST-HUNT (2026-10-12 — Rule 67 violation):
# قبل كده: comment بيقول "mirror maestro_orchestrator.py after port" — بس
# maestro_orchestrator.py اتمسح (MAESTRO-KILL)! الـ thresholds دي بقت orphan.
# الحل: غيرنا الـ comment + أضفنا note إن دول standalone thresholds (مش mirror).
# لو محتاج canonical thresholds، لازم تيجي من engine_settings.py (Rule 11).
PERSONA_THRESHOLDS = {
    'gambler': {
        'bull':  (45, 28, 18, 12),
        'bear':  (50, 32, 22, 15),
        'range': (42, 25, 16, 10),
    },
    'balanced': {
        'bull':  (55, 42, 30, 20),
        'bear':  (58, 45, 32, 22),
        'range': (52, 40, 28, 18),
    },
    'conservative': {
        'bull':  (62, 50, 38, 28),
        'bear':  (68, 55, 42, 32),
        'range': (58, 48, 36, 26),
    },
}
# TODO (Rule 11): Move these to engine_settings.py as the canonical source.


def log(msg: str):
    print(msg, flush=True)


def connect_ro(db_path: Path) -> sqlite3.Connection:
    uri = f"file:{db_path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


# ─── Data loading ────────────────────────────────────────────────────────────

def load_all_tickers() -> List[Dict]:
    """Load all active tickers from stocks.db (with sectors)."""
    if not STOCKS_DB.exists():
        log(f"[WARN] stocks.db not found at {STOCKS_DB}")
        return []
    conn = connect_ro(STOCKS_DB)
    try:
        # Try stocks table (VPS real) — has Arabic sectors
        rows = conn.execute("""
            SELECT ticker, name_ar, sector, is_active
            FROM stocks
            WHERE is_active = 1 OR is_active IS NULL
            ORDER BY ticker
        """).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        # Fallback: egksco_stocks
        try:
            rows = conn.execute("""
                SELECT ticker, name_ar, sector
                FROM egksco_stocks
                ORDER BY ticker
            """).fetchall()
            return [dict(r) for r in rows]
        except Exception as e:
            log(f"[WARN] Could not load tickers: {e}")
            return []
    finally:
        conn.close()


def load_price_history(ticker: str, days: int = 90) -> List[Dict]:
    """Load price history for a ticker from price_history.db."""
    if not PRICE_HISTORY_DB.exists():
        return []
    conn = connect_ro(PRICE_HISTORY_DB)
    try:
        rows = conn.execute("""
            SELECT ticker, date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ? AND close_price > 0
            ORDER BY date DESC
            LIMIT ?
        """, (ticker, days)).fetchall()
        # Reverse to chronological
        return list(reversed([dict(r) for r in rows]))
    except Exception:
        return []
    finally:
        conn.close()


# ─── Explosive pre-flight detection ──────────────────────────────────────────

def compute_indicators(candles: List[Dict]) -> Dict:
    """Compute momentum/volatility/volume indicators from candle list."""
    if len(candles) < 20:
        return {'enough_data': False}

    closes = [float(c.get('close_price') or c.get('close') or 0) for c in candles]
    highs = [float(c.get('high_price') or c.get('high') or 0) for c in candles]
    lows = [float(c.get('low_price') or c.get('low') or 0) for c in candles]
    volumes = [float(c.get('volume') or 0) for c in candles]

    closes = [c for c in closes if c > 0]
    if len(closes) < 20:
        return {'enough_data': False}

    current_price = closes[-1]

    # 1. Momentum: 20-day return
    price_20d_ago = closes[-20] if len(closes) >= 20 else closes[0]
    momentum_20d = ((current_price - price_20d_ago) / price_20d_ago * 100) if price_20d_ago > 0 else 0

    # 2. 5-day momentum (recent surge)
    price_5d_ago = closes[-6] if len(closes) >= 6 else closes[0]
    momentum_5d = ((current_price - price_5d_ago) / price_5d_ago * 100) if price_5d_ago > 0 else 0

    # P0-v13: Bad-data / split detection. الأسهم اللي بتعمل +35362% في 5 أيام
    # دي مجرّد stock split أو data error، مش surge حقيقي. أي سهم بـ يتحرك
    # أكتر من +200% في 5 أيام أو +400% في 20 يوم = BAD_DATA → بنـ excludeه
    # من قائمة الأسهم الانفجارية عشان ما يـ polluteش التوقعات بـ false positives.
    # الأسهم الانفجارية الحقيقية بتتحرك +20% لـ +100% في 5 أيام.
    is_bad_data = (abs(momentum_5d) > 200) or (abs(momentum_20d) > 400)

    # 3. Volume ratio: today vs 20-day avg
    recent_vols = [v for v in volumes[-20:] if v > 0]
    avg_vol_20 = sum(recent_vols) / len(recent_vols) if recent_vols else 0
    current_vol = volumes[-1] if volumes else 0
    volume_ratio = (current_vol / avg_vol_20) if avg_vol_20 > 0 else 1.0

    # 4. Volatility percentile (ATR/price)
    atr_vals = []
    for i in range(1, min(len(closes), 15)):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        atr_vals.append(tr)
    atr = sum(atr_vals) / len(atr_vals) if atr_vals else 0
    atr_pct = (atr / current_price * 100) if current_price > 0 else 0
    # volatility_percentile: rough proxy (0-100) based on atr_pct
    vol_pct = min(100, max(0, atr_pct * 12))  # scale: 3% ATR → 36, 7% ATR → 84

    # 5. Breakout: current price >= max(high_20d) * 0.99
    recent_highs = [h for h in highs[-20:] if h > 0]
    high_20d = max(recent_highs) if recent_highs else current_price
    is_breakout = current_price >= high_20d * 0.99

    # 6. Distance from 20d high (% below)
    dist_from_high = ((high_20d - current_price) / high_20d * 100) if high_20d > 0 else 0

    return {
        'enough_data': True,
        'is_bad_data': is_bad_data,
        'current_price': round(current_price, 2),
        'momentum_20d': round(momentum_20d, 2),
        'momentum_5d': round(momentum_5d, 2),
        'volume_ratio': round(volume_ratio, 2),
        'atr_pct': round(atr_pct, 2),
        'vol_pct': round(vol_pct, 1),
        'is_breakout': is_breakout,
        'high_20d': round(high_20d, 2),
        'dist_from_high_pct': round(dist_from_high, 2),
        'avg_vol_20': int(avg_vol_20),
    }


def explosive_potential_score(ind: Dict) -> Tuple[float, str]:
    """Score how likely this stock is to explode (0-100).

    Factors:
    - momentum_5d (recent surge) — weight 30
    - volume_ratio (accumulation) — weight 25
    - is_breakout (technical trigger) — weight 20
    - vol_pct (volatility = fuel) — weight 15
    - momentum_20d (trend) — weight 10
    """
    if not ind.get('enough_data'):
        return 0, 'insufficient data'
    if ind.get('is_bad_data'):
        # P0-v13: split/bad-data → exclude تماماً من قائمة الانفجارية.
        return 0, 'BAD DATA (split/error excluded)'

    score = 0
    reasons = []

    m5 = ind['momentum_5d']
    m5_disp = min(m5, 100)  # P0-v13: cap display at 100% (avoids +35362% visual noise)
    if m5 >= 10:
        score += 30; reasons.append(f'5d momentum +{m5_disp}% (surge)')
    elif m5 >= 5:
        score += 20; reasons.append(f'5d momentum +{m5_disp}%')
    elif m5 >= 2:
        score += 10

    vr = ind['volume_ratio']
    if vr >= 3.0:
        score += 25; reasons.append(f'volume {vr}× (massive accumulation)')
    elif vr >= 2.0:
        score += 20; reasons.append(f'volume {vr}× (heavy accumulation)')
    elif vr >= 1.5:
        score += 12; reasons.append(f'volume {vr}×')

    if ind['is_breakout']:
        score += 20; reasons.append('breakout (new 20d high)')
    elif ind['dist_from_high_pct'] < 2:
        score += 12; reasons.append(f'near 20d high ({ind["dist_from_high_pct"]}%)')

    vp = ind['vol_pct']
    if vp > 80:
        score += 15; reasons.append(f'explosive volatility ({vp}%)')
    elif vp > 50:
        score += 8

    m20 = ind['momentum_20d']
    m20_disp = min(m20, 100)  # P0-v13: cap display
    if m20 >= 20:
        score += 10; reasons.append(f'20d trend +{m20_disp}%')
    elif m20 >= 10:
        score += 6

    return min(100, score), ' | '.join(reasons)


# ─── Maestro score simulation (simplified) ───────────────────────────────────

def simulate_maestro_score(ind: Dict) -> float:
    """Rough maestro_score simulation (0-100) from indicators.

    The real maestro_score is complex (technical 40% + fundamental 30% +
    confluence 20% + risk 10%). Without fundamental data (PE/ROE/growth),
    scores are naturally LOWER — the real engine pulls scores down when
    fundamentals are weak or confluence is low.

    This proxy is deliberately CONSERVATIVE: base 35, capped bonuses,
    so the threshold-gap analysis is realistic (not everything = BUY).
    The momentum numbers are also capped (data anomalies like +7728%
    are likely splits/bad data — we treat anything >25% as 25%).
    """
    if not ind.get('enough_data'):
        return 30
    if ind.get('is_bad_data'):
        # P0-v13: bad-data/split → score منخفض عشان ما يطلعش BUY.
        return 20

    score = 35  # conservative base (real maestro starts ~50 but fundamentals pull it down)
    # Cap momentum at 25% to handle data anomalies (splits, bad ticks)
    m5 = min(ind['momentum_5d'], 25)
    m20 = min(ind['momentum_20d'], 40)

    # momentum contribution (capped)
    if m5 >= 10: score += 8
    elif m5 >= 5: score += 5
    elif m5 >= 2: score += 2

    if m20 >= 20: score += 7
    elif m20 >= 10: score += 4

    # volume (accumulation signal)
    vr = ind['volume_ratio']
    if vr >= 3.0: score += 8
    elif vr >= 2.0: score += 5
    elif vr >= 1.5: score += 2

    # breakout
    if ind['is_breakout']: score += 6
    elif ind['dist_from_high_pct'] < 2: score += 3

    # volatility (fuel but also risk)
    if ind['vol_pct'] > 80: score += 3
    elif ind['vol_pct'] > 50: score += 1

    # Penalty: extreme volatility = risk penalty (real engine does this)
    if ind['atr_pct'] > 8:
        score -= 5

    return min(82, max(25, score))


def predict_recommendation(maestro_score: float, persona: str, regime: str = 'bull') -> str:
    """Predict the recommendation using the NEW P0-v12 thresholds."""
    thresholds = PERSONA_THRESHOLDS.get(persona, PERSONA_THRESHOLDS['balanced']).get(
        regime, PERSONA_THRESHOLDS[persona]['range']
    )
    if maestro_score >= thresholds[0]:
        return 'strong_buy'
    elif maestro_score >= thresholds[1]:
        return 'buy'
    elif maestro_score >= thresholds[2]:
        return 'hold'
    elif maestro_score >= thresholds[3]:
        return 'sell'
    else:
        return 'strong_sell'


def threshold_gap(maestro_score: float, persona: str, regime: str = 'bull') -> Dict:
    """How far is the score from the BUY threshold?"""
    thresholds = PERSONA_THRESHOLDS.get(persona, PERSONA_THRESHOLDS['balanced']).get(
        regime, PERSONA_THRESHOLDS[persona]['range']
    )
    buy_threshold = thresholds[1]
    strong_buy_threshold = thresholds[0]
    return {
        'buy_gap': round(buy_threshold - maestro_score, 1),
        'strong_buy_gap': round(strong_buy_threshold - maestro_score, 1),
        'would_buy': maestro_score >= buy_threshold,
        'would_strong_buy': maestro_score >= strong_buy_threshold,
    }


# ─── Main scan ───────────────────────────────────────────────────────────────

def scan_market(top_n: int = 20) -> Dict:
    """Scan the whole market for explosive pre-flight opportunities."""
    tickers = load_all_tickers()
    log(f"[HUNTER] Loaded {len(tickers)} tickers from stocks.db")
    log(f"[HUNTER] Price history DB: {PRICE_HISTORY_DB}")

    if not PRICE_HISTORY_DB.exists():
        log(f"[ERROR] price_history.db not found at {PRICE_HISTORY_DB}")
        return {'error': 'price_history.db not found', 'scanned': 0}

    candidates = []
    scanned = 0
    errors = 0

    for t in tickers:
        ticker = t.get('ticker')
        if not ticker:
            continue
        try:
            candles = load_price_history(ticker, days=90)
            if len(candles) < 20:
                continue
            scanned += 1

            ind = compute_indicators(candles)
            if not ind.get('enough_data'):
                continue

            score, reasons = explosive_potential_score(ind)
            if score < 30:  # skip low-potential
                continue

            maestro_proxy = simulate_maestro_score(ind)

            # For each persona, predict recommendation
            persona_preds = {}
            for persona in ('gambler', 'balanced', 'conservative'):
                rec = predict_recommendation(maestro_proxy, persona)
                gap = threshold_gap(maestro_proxy, persona)
                persona_preds[persona] = {
                    'recommendation': rec,
                    'would_buy': gap['would_buy'],
                    'buy_gap': gap['buy_gap'],
                }

            candidates.append({
                'ticker': ticker,
                'name_ar': t.get('name_ar', ''),
                'sector': t.get('sector', ''),
                'explosive_score': score,
                'reasons': reasons,
                'maestro_score_proxy': maestro_proxy,
                'indicators': ind,
                'persona_predictions': persona_preds,
            })
        except Exception as e:
            errors += 1
            continue

    # Sort by explosive_score descending
    candidates.sort(key=lambda x: x['explosive_score'], reverse=True)
    top_candidates = candidates[:top_n]

    # Coverage summary
    total = len(candidates)
    gambler_buys = sum(1 for c in candidates if c['persona_predictions']['gambler']['would_buy'])
    balanced_buys = sum(1 for c in candidates if c['persona_predictions']['balanced']['would_buy'])
    conservative_buys = sum(1 for c in candidates if c['persona_predictions']['conservative']['would_buy'])

    # Pre-port thresholds coverage (for comparison — what the OLD engine would catch)
    # P0-v13: بنـ compare الـ 3 personas قبل وبعد تخفيض العتبات.
    OLD_THRESHOLDS = {
        'gambler':      {'bull': (55, 35, 25, 18)},   # pre-P0-v11
        'balanced':     {'bull': (68, 55, 40, 28)},   # pre-P0-v13
        'conservative': {'bull': (75, 62, 48, 35)},   # pre-P0-v13
    }
    old_gambler_buys = sum(
        1 for c in candidates
        if c['maestro_score_proxy'] >= OLD_THRESHOLDS['gambler']['bull'][1]
    )
    old_balanced_buys = sum(
        1 for c in candidates
        if c['maestro_score_proxy'] >= OLD_THRESHOLDS['balanced']['bull'][1]
    )
    old_conservative_buys = sum(
        1 for c in candidates
        if c['maestro_score_proxy'] >= OLD_THRESHOLDS['conservative']['bull'][1]
    )

    summary = {
        'scanned': scanned,
        'errors': errors,
        'total_explosive_candidates': total,
        'coverage_new_thresholds': {
            'gambler_buys': gambler_buys,
            'balanced_buys': balanced_buys,
            'conservative_buys': conservative_buys,
        },
        'coverage_old_thresholds': {
            'gambler_buys': old_gambler_buys,
            'balanced_buys': old_balanced_buys,
            'conservative_buys': old_conservative_buys,
        },
        'improvement': {
            'gambler_delta': gambler_buys - old_gambler_buys,
            'gambler_pct_increase': round(
                ((gambler_buys - old_gambler_buys) / max(1, old_gambler_buys) * 100), 1
            ) if old_gambler_buys > 0 else float('inf'),
            'balanced_delta': balanced_buys - old_balanced_buys,
            'balanced_pct_increase': round(
                ((balanced_buys - old_balanced_buys) / max(1, old_balanced_buys) * 100), 1
            ) if old_balanced_buys > 0 else float('inf'),
            'conservative_delta': conservative_buys - old_conservative_buys,
            'conservative_pct_increase': round(
                ((conservative_buys - old_conservative_buys) / max(1, old_conservative_buys) * 100), 1
            ) if old_conservative_buys > 0 else float('inf'),
        },
        'generated_at': datetime.now().isoformat(),
        'data_source': 'vps_real' if VPS_REAL_DIR.exists() else 'production',
    }

    return {
        'summary': summary,
        'top_candidates': top_candidates,
    }


def render_report(result: Dict) -> str:
    """Render a human-readable Arabic report."""
    s = result['summary']
    lines = []
    lines.append("# تقرير صائد الفرص الانفجارية — " + datetime.now().strftime('%Y-%m-%d %H:%M'))
    lines.append(f"**مصدر البيانات:** {s['data_source']} | **الأسهم الممسوحة:** {s['scanned']}")
    lines.append("")
    lines.append("## ملخص التغطية (Coverage)")
    lines.append("")
    lines.append("| Persona | الأسهم الملتقطة (BUY) | من إجمالي الانفجارية |")
    lines.append("|---------|----------------------|---------------------|")
    total = s['total_explosive_candidates']
    cov = s['coverage_new_thresholds']
    lines.append(f"| المضارب (gambler) | {cov['gambler_buys']} | {total} ({cov['gambler_buys']/max(1,total)*100:.0f}%) |")
    lines.append(f"| المتوازن (balanced) | {cov['balanced_buys']} | {total} ({cov['balanced_buys']/max(1,total)*100:.0f}%) |")
    lines.append(f"| المحافظ (conservative) | {cov['conservative_buys']} | {total} ({cov['conservative_buys']/max(1,total)*100:.0f}%) |")
    lines.append("")
    lines.append("## مقارنة قبل/بعد تخفيض العتبات (P0-v13)")
    lines.append("")
    lines.append("| Persona | عتبة buy قديمة | عتبة buy جديدة | كان بـ يلتقط | دلوقتي بـ يلتقط | التحسن |")
    lines.append("|---------|---------------|---------------|-------------|----------------|--------|")
    delta = s['improvement']
    old = s['coverage_old_thresholds']
    lines.append(f"| المضارب | 35 | 28 | {old['gambler_buys']} | {cov['gambler_buys']} | +{delta['gambler_delta']} ({delta['gambler_pct_increase']}%) |")
    lines.append(f"| المتوازن | 55 | 42 | {old['balanced_buys']} | {cov['balanced_buys']} | +{delta['balanced_delta']} ({delta['balanced_pct_increase']}%) |")
    lines.append(f"| المحافظ | 62 | 50 | {old['conservative_buys']} | {cov['conservative_buys']} | +{delta['conservative_delta']} ({delta['conservative_pct_increase']}%) |")
    lines.append("")
    lines.append(f"> **الخلاصة:** تخفيض عتبات المتوازن (55→42) والمحافظ (62→50) بـ يـ letهم يلتقطوا الأسهم الانفجارية اللي كانوا بـ يـ missوها. owner: \"ما تفتناش الفرص\"")
    lines.append("")
    lines.append("## أعلى 20 سهم انفجاري محتمل (Pre-Flight)")
    lines.append("")
    lines.append("| # | السهم | Score | Maestro | المضارب | المتوازن | المحافظ | الأسباب |")
    lines.append("|---|------|-------|---------|---------|----------|---------|---------|")
    for i, c in enumerate(result['top_candidates'], 1):
        pp = c['persona_predictions']
        g = 'BUY' if pp['gambler']['would_buy'] else f"gap +{pp['gambler']['buy_gap']}"
        b = 'BUY' if pp['balanced']['would_buy'] else f"gap +{pp['balanced']['buy_gap']}"
        cv = 'BUY' if pp['conservative']['would_buy'] else f"gap +{pp['conservative']['buy_gap']}"
        lines.append(
            f"| {i} | {c['ticker']} | {c['explosive_score']} | {c['maestro_score_proxy']} | {g} | {b} | {cv} | {c['reasons'][:80]} |"
        )
    lines.append("")
    lines.append("---")
    lines.append("*تم التوليد بواسطة `explosive_opportunity_hunter.py` — P0-v13 (balanced/conservative thresholds lowered + bad-data exclusion)*")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description='صائد الفرص الانفجارية')
    parser.add_argument('--top', type=int, default=20, help='عدد الأسهم في التقرير')
    parser.add_argument('--json', action='store_true', help='إخراج JSON فقط')
    parser.add_argument('--json-only', action='store_true', help='إخراج JSON فقط (alias)')
    args = parser.parse_args()

    log("[HUNTER] Starting explosive opportunity scan...")
    result = scan_market(top_n=args.top)

    if 'error' in result:
        log(f"[HUNTER] ERROR: {result['error']}")
        sys.exit(1)

    if args.json or args.json_only:
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    else:
        report = render_report(result)
        print(report)
        # Also save to file
        out_file = OUTPUT_DIR / f"explosive_hunt_{datetime.now().strftime('%Y%m%d')}.md"
        out_file.write_text(report, encoding='utf-8')
        json_file = OUTPUT_DIR / f"explosive_hunt_{datetime.now().strftime('%Y%m%d')}.json"
        json_file.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
        log(f"\n[HUNTER] Report saved to {out_file}")
        log(f"[HUNTER] JSON saved to {json_file}")

    s = result['summary']
    log(f"\n[HUNTER] DONE — scanned {s['scanned']} stocks, found {s['total_explosive_candidates']} explosive candidates")
    cov = s['coverage_new_thresholds']
    old = s['coverage_old_thresholds']
    log(f"[HUNTER] Coverage (new P0-v13): gambler={cov['gambler_buys']}, balanced={cov['balanced_buys']}, conservative={cov['conservative_buys']}")
    log(f"[HUNTER] Coverage (old P0-v12): gambler={old['gambler_buys']}, balanced={old['balanced_buys']}, conservative={old['conservative_buys']}")


if __name__ == '__main__':
    main()
