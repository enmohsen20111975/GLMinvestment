#!/usr/bin/env python3
"""
Stock Screener - ماسح الأسهم
5 presets:
1. رادار المضارب (Day Trader Radar): High volatility + Stoch 30-70 + "شراء" rating
2. المضارب اليومي (Daily Speculator): 6 rules – 52W discount + EPS + P/E + Div Yield + Volume
3. صائد القيمة (Value Hunter): P/E < 10 + P/B < 1 + div_yield > 5%
4. صواريخ الزخم (Momentum Rockets): Near 52-week high + "شراء قوي" + MACD+
5. ميزان حرارة السوق (Market Thermometer): advancing ratio + avg trend → single score

Data source: data_engine.db (tab_technical_analysis, tab_valuation, tab_profitability,
             tab_performance, tab_dividends, stocks tables)

NOTE: The RSI column in tab_technical_analysis is NOT standard 0-100 RSI.
      We use `stoch` (stochastic oscillator, 0-100) and `trend` instead.
"""

import sqlite3
import json
import os
import sys
import argparse
from datetime import datetime
from typing import Dict, List, Optional

# Resolve project paths — db/ lives at the Next.js project root (parent of vps-service)
PROJECT_ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
DATA_ENGINE_DB = os.path.join(PROJECT_ROOT, 'db', 'data_engine.db')
STOCKS_DB = os.path.join(PROJECT_ROOT, 'db', 'stocks.db')

# Helpers

def _safe_float(val, default=0.0) -> float:
    """Parse a string that may contain Arabic minus (−) or commas."""
    if val is None:
        return default
    s = str(val).strip().replace('−', '-').replace(',', '').replace('%', '')
    try:
        return float(s)
    except (ValueError, TypeError):
        return default

def _parse_price(val, default=0.0) -> float:
    """Parse price strings like '211.70 EGP' or '20.01 SAR'."""
    if val is None:
        return default
    s = str(val).strip()
    # Remove currency suffix
    for cur in (' EGP', ' SAR', ' KWD', ' QAR', ' USD'):
        s = s.replace(cur, '')
    s = s.replace('−', '-').replace(',', '')
    try:
        return float(s)
    except (ValueError, TypeError):
        return default

def _get_de_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DATA_ENGINE_DB)
    conn.row_factory = sqlite3.Row
    return conn

def _get_stocks_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(STOCKS_DB)
    conn.row_factory = sqlite3.Row
    return conn

VALID_MARKETS = ('السعودية', 'مصر', 'الكويت', 'قطر')

def _ensure_screener_table(conn: sqlite3.Connection):
    """Create screener_results table if it doesn't exist."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS screener_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            preset TEXT NOT NULL,
            symbol TEXT NOT NULL,
            name TEXT,
            market TEXT,
            price REAL,
            score REAL,
            reason TEXT,
            scan_date TEXT NOT NULL
        )
    """)
    conn.commit()

# Preset 1: رادار المضارب (Day Trader Radar)
# High volatility + Stochastic 30-70 + "شراء" rating

def preset_day_trader(market: Optional[str] = None) -> List[Dict]:
    """Day Trader Radar – volatile stocks + buy-side rating. Uses Stoch instead of RSI."""
    conn = _get_de_conn()
    try:
        mkt_filter = ""
        params: list = []
        if market and market in VALID_MARKETS:
            mkt_filter = "AND ta.market = ?"
            params.append(market)

        query = f"""
            SELECT
                ta.symbol, ta.market, ta.technical_rating,
                ta.stoch, ta.macd, ta.atr, ta.adx, ta.trend,
                perf.price, perf.change_percent, perf.perf_1w, perf.volatility_1w,
                s.name
            FROM tab_technical_analysis ta
            JOIN tab_performance perf
                ON ta.symbol = perf.symbol AND ta.market = perf.market
            LEFT JOIN stocks s
                ON ta.symbol = s.symbol
            WHERE ta.market IN ({','.join(['?']*len(VALID_MARKETS))})
              {mkt_filter}
              AND ta.technical_rating LIKE '%شراء%'
        """
        base_params = list(VALID_MARKETS) + params
        rows = conn.execute(query, base_params).fetchall()

        results: List[Dict] = []
        for r in rows:
            stoch = _safe_float(r['stoch'])
            # Use stoch in 30-70 range (neutral to slightly overbought)
            if stoch < 30 or stoch > 70:
                continue

            atr = _safe_float(r['atr'])
            vol_1w = _safe_float(r['volatility_1w'])
            macd = _safe_float(r['macd'])
            adx = _safe_float(r['adx'])
            trend = _safe_float(r['trend'])
            price = _parse_price(r['price'])

            # Score: base 40 + volatility + stoch sweet-spot + MACD + ADX + rating
            vol_score = min(15, abs(atr) / max(price, 1) * 100)
            stoch_score = 12 if 40 <= stoch <= 60 else 6
            macd_score = 10 if macd > 0 else 0
            adx_score = min(10, adx / 50 * 10) if adx > 20 else 0
            trend_score = min(13, trend / 80 * 13) if trend > 50 else 0
            rating_bonus = 5 if 'شراء قوي' in (r['technical_rating'] or '') else 0
            score = min(100, max(0, 40 + vol_score + stoch_score + macd_score + adx_score + trend_score + rating_bonus))

            reason = (f"Stoch={stoch:.0f} | ATR={atr:.2f} | "
                      f"MACD={'+'if macd>0 else ''}{macd:.1f} | ADX={adx:.0f} | {r['technical_rating']}")

            results.append({
                'symbol': r['symbol'],
                'name': r['name'] or r['symbol'],
                'market': r['market'],
                'price': price,
                'change_percent': _safe_float(r['change_percent']),
                'score': round(score, 1),
                'reason': reason,
            })

        results.sort(key=lambda x: x['score'], reverse=True)
        return results[:50]
    finally:
        conn.close()

# Preset 2: صائد القيمة (Value Hunter)
# P/E < 10 + P/B < 1 + div_yield > 5%

def preset_value(market: Optional[str] = None) -> List[Dict]:
    """Value Hunter – deep-value stocks with low multiples and high yield."""
    conn = _get_de_conn()
    try:
        mkt_filter = ""
        params: list = []
        if market and market in VALID_MARKETS:
            mkt_filter = "AND v.market = ?"
            params.append(market)

        query = f"""
            SELECT
                v.symbol, v.market, v.pe_ratio, v.pb_ratio, v.ps_ratio,
                d.div_yield, d.div_yield_fwd, d.payout_ratio,
                perf.price, perf.change_percent,
                s.name
            FROM tab_valuation v
            JOIN tab_dividends d
                ON v.symbol = d.symbol AND v.market = d.market
            JOIN tab_performance perf
                ON v.symbol = perf.symbol AND v.market = perf.market
            LEFT JOIN stocks s
                ON v.symbol = s.symbol
            WHERE v.market IN ({','.join(['?']*len(VALID_MARKETS))})
              {mkt_filter}
        """
        base_params = list(VALID_MARKETS) + params
        rows = conn.execute(query, base_params).fetchall()

        results: List[Dict] = []
        for r in rows:
            pe = _safe_float(r['pe_ratio'])
            pb = _safe_float(r['pb_ratio'])
            div_yield = _safe_float(r['div_yield'])
            price = _parse_price(r['price'])

            # Apply filters
            if pe <= 0 or pe >= 10:
                continue
            if pb <= 0 or pb >= 1:
                continue
            if div_yield < 5:
                continue

            # Score: lower PE/PB + higher yield → higher score
            pe_score = min(25, (10 - pe) / 10 * 25)
            pb_score = min(25, (1 - pb) / 1 * 25)
            yield_score = min(30, div_yield / 15 * 30)
            fwd_bonus = 10 if _safe_float(r['div_yield_fwd']) > div_yield else 0
            payout = _safe_float(r['payout_ratio'])
            payout_score = 10 if 0 < payout < 80 else 5
            score = min(100, max(0, pe_score + pb_score + yield_score + fwd_bonus + payout_score))

            reason = (f"P/E={pe:.1f} | P/B={pb:.2f} | "
                      f"Div={div_yield:.1f}% | Payout={payout:.0f}%")

            results.append({
                'symbol': r['symbol'],
                'name': r['name'] or r['symbol'],
                'market': r['market'],
                'price': price,
                'change_percent': _safe_float(r['change_percent']),
                'score': round(score, 1),
                'reason': reason,
            })

        results.sort(key=lambda x: x['score'], reverse=True)
        return results[:50]
    finally:
        conn.close()

# Preset 3: صواريخ الزخم (Momentum Rockets)
# Near 52-week high + "شراء قوي" + MACD positive

def preset_momentum(market: Optional[str] = None) -> List[Dict]:
    """Momentum Rockets – strong uptrends with confirming technicals."""
    conn = _get_de_conn()
    try:
        mkt_filter = ""
        params: list = []
        if market and market in VALID_MARKETS:
            mkt_filter = "AND ta.market = ?"
            params.append(market)

        query = f"""
            SELECT
                ta.symbol, ta.market, ta.technical_rating,
                ta.stoch, ta.macd, ta.atr, ta.adx, ta.trend,
                perf.price, perf.change_percent,
                perf.perf_1w, perf.perf_1m, perf.perf_3m, perf.perf_6m, perf.perf_1y,
                s.name
            FROM tab_technical_analysis ta
            JOIN tab_performance perf
                ON ta.symbol = perf.symbol AND ta.market = perf.market
            LEFT JOIN stocks s
                ON ta.symbol = s.symbol
            WHERE ta.market IN ({','.join(['?']*len(VALID_MARKETS))})
              {mkt_filter}
              AND ta.technical_rating LIKE '%شراء قوي%'
        """
        base_params = list(VALID_MARKETS) + params
        rows = conn.execute(query, base_params).fetchall()

        results: List[Dict] = []
        for r in rows:
            perf_1y = _safe_float(r['perf_1y'])
            macd = _safe_float(r['macd'])
            stoch = _safe_float(r['stoch'])
            trend = _safe_float(r['trend'])
            price = _parse_price(r['price'])
            perf_1m = _safe_float(r['perf_1m'])
            perf_3m = _safe_float(r['perf_3m'])

            # Must be near 52w high (perf_1y > 20%)
            if perf_1y < 20:
                continue
            # MACD must be positive (momentum confirmation)
            if macd <= 0:
                continue

            # Score components
            momentum_score = min(30, perf_1y / 100 * 30)
            macd_score = min(20, macd / 100 * 20)
            stoch_penalty = max(0, (stoch - 80) * 0.5) if stoch > 80 else 0
            short_term_bonus = 10 if perf_1m > 5 else 5 if perf_1m > 0 else 0
            mid_term_bonus = 10 if perf_3m > 15 else 5 if perf_3m > 5 else 0
            trend_bonus = 5 if trend > 60 else 0
            score = min(100, max(0, 25 + momentum_score + macd_score + short_term_bonus + mid_term_bonus + trend_bonus - stoch_penalty))

            reason = (f"1Y={perf_1y:+.0f}% | 1M={perf_1m:+.0f}% | "
                      f"MACD=+{macd:.1f} | Stoch={stoch:.0f}")

            results.append({
                'symbol': r['symbol'],
                'name': r['name'] or r['symbol'],
                'market': r['market'],
                'price': price,
                'change_percent': _safe_float(r['change_percent']),
                'score': round(score, 1),
                'reason': reason,
            })

        results.sort(key=lambda x: x['score'], reverse=True)
        return results[:50]
    finally:
        conn.close()

# Preset 4: ميزان حرارة السوق (Market Thermometer)
# Advancing vs declining ratio + avg trend → single score 0-100

def preset_thermometer(market: Optional[str] = None) -> List[Dict]:
    """Market Thermometer – single score per market. Uses trend column."""
    conn = _get_de_conn()
    try:
        markets = [market] if market and market in VALID_MARKETS else list(VALID_MARKETS)
        results: List[Dict] = []

        for mkt in markets:
            rows = conn.execute("""
                SELECT change_percent, trend, stoch
                FROM tab_performance perf
                LEFT JOIN tab_technical_analysis ta
                    ON perf.symbol = ta.symbol AND perf.market = ta.market
                WHERE perf.market = ?
            """, (mkt,)).fetchall()

            if not rows:
                continue

            advancing = 0
            declining = 0
            trend_sum = 0.0
            trend_count = 0

            for r in rows:
                chg = _safe_float(r['change_percent'])
                trend_val = _safe_float(r['trend'], default=-1)
                if chg > 0:
                    advancing += 1
                elif chg < 0:
                    declining += 1
                if trend_val >= 0:
                    trend_sum += trend_val
                    trend_count += 1

            total = advancing + declining
            adv_ratio = advancing / total if total > 0 else 0.5
            avg_trend = trend_sum / trend_count if trend_count > 0 else 50

            # Thermometer score: blend advancing ratio and average trend
            # adv_ratio: 0→0, 0.5→40, 1→80
            adv_score = adv_ratio * 80
            # avg_trend: typically 40-70, scale to 0-100
            trend_normalized = min(100, max(0, avg_trend))
            # Weighted blend: 55% advancing, 45% trend
            thermo = min(100, max(0, adv_score * 0.55 + trend_normalized * 0.45))

            if thermo >= 70:
                label = "ساخن 🔥"
            elif thermo >= 55:
                label = "دافئ ☀️"
            elif thermo >= 40:
                label = "معتدل 🌤️"
            elif thermo >= 25:
                label = "بارد ❄️"
            else:
                label = "متجمد 🧊"

            results.append({
                'symbol': mkt,
                'name': mkt,
                'market': mkt,
                'price': 0,
                'change_percent': round(adv_ratio * 100, 1),
                'score': round(thermo, 1),
                'reason': f"صاعد={advancing} | هابط={declining} | نسبة={adv_ratio:.0%} | اتجاه={avg_trend:.0f} | {label}",
            })

        results.sort(key=lambda x: x['score'], reverse=True)
        return results
    finally:
        conn.close()

# Preset 5: المضارب اليومي (Daily Speculator)
# 6 rules scoring 0-100:
# 1. السعر < 85% من قمة 52 أسبوع → +20
# 2. EPS > 0 → +20
# 3. P/E < 20 → +15
# 4. السعر < 90% من قمة السنة → +15
# 5. Dividend Yield > 5% → +15
# 6. حجم أعلى من المتوسط 20 يوم × 1.5 → +15

def preset_daily_speculator(market: Optional[str] = None) -> List[Dict]:
    """المضارب اليومي – 6 قواعد للتقييم من 0-100"""
    conn = _get_de_conn()
    try:
        mkt_filter = ""
        params: list = []
        if market and market in VALID_MARKETS:
            mkt_filter = "AND market = ?"
            params.append(market)

        # ── Step 1: 52-week high from historical_data ──
        high_52w_query = f"""
            SELECT symbol, MAX(high) as high_52w
            FROM historical_data
            WHERE date >= date('now', '-364 days')
              AND market IN ({','.join(['?']*len(VALID_MARKETS))})
              {mkt_filter.replace('market', 'market')}
            GROUP BY symbol
        """
        high_52w_rows = conn.execute(high_52w_query, list(VALID_MARKETS) + params).fetchall()
        high_52w_map = {r['symbol']: _safe_float(r['high_52w']) for r in high_52w_rows}

        # ── Step 2: Average volume (20d) and latest volume ──
        vol_query = f"""
            SELECT symbol,
                   AVG(CASE WHEN rn <= 20 THEN volume END) as avg_vol_20,
                   MAX(CASE WHEN rn = 1 THEN volume END) as latest_vol
            FROM (
                SELECT symbol, volume,
                       ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) as rn
                FROM historical_data
                WHERE market IN ({','.join(['?']*len(VALID_MARKETS))})
                {mkt_filter.replace('market', 'market')}
            )
            GROUP BY symbol
        """
        vol_rows = conn.execute(vol_query, list(VALID_MARKETS) + params).fetchall()
        vol_map = {}
        for r in vol_rows:
            avg = _safe_float(r['avg_vol_20'])
            latest = _safe_float(r['latest_vol'])
            vol_map[r['symbol']] = {'avg': avg, 'latest': latest}

        # ── Step 3: Tab data (valuation + dividends + income + performance) ──
        mkt_filter2 = ""
        params2: list = []
        if market and market in VALID_MARKETS:
            mkt_filter2 = "AND perf.market = ?"
            params2.append(market)

        query = f"""
            SELECT
                perf.symbol, perf.market, perf.price, perf.change_percent,
                v.pe_ratio,
                d.div_yield,
                MAX(inc.eps_basic) as eps_basic,
                s.name
            FROM tab_performance perf
            LEFT JOIN tab_valuation v
                ON perf.symbol = v.symbol AND perf.market = v.market
            LEFT JOIN tab_dividends d
                ON perf.symbol = d.symbol AND perf.market = d.market
            LEFT JOIN tab_income_statement inc
                ON perf.symbol = inc.symbol AND perf.market = inc.market
            LEFT JOIN stocks s
                ON perf.symbol = s.symbol
            WHERE perf.market IN ({','.join(['?']*len(VALID_MARKETS))})
              {mkt_filter2}
            GROUP BY perf.symbol, perf.market
        """
        rows = conn.execute(query, list(VALID_MARKETS) + params2).fetchall()

        results: List[Dict] = []
        for r in rows:
            price = _parse_price(r['price'])
            if price <= 0:
                continue

            score = 0
            reasons: List[str] = []
            symbol = r['symbol']

            # Rule 1: السعر < 85% من قمة 52 أسبوع → +20
            high_52w = high_52w_map.get(symbol, 0)
            if high_52w > 0 and price < high_52w * 0.85:
                score += 20
                discount = (1 - price / high_52w) * 100
                reasons.append(f'خصم52W={discount:.0f}%')

            # Rule 2: EPS > 0 → +20
            eps = _safe_float(r['eps_basic'])
            if eps > 0:
                score += 20
                reasons.append(f'EPS={eps:.2f}>0')

            # Rule 3: P/E < 20 → +15
            pe = _safe_float(r['pe_ratio'])
            if 0 < pe < 20:
                score += 15
                reasons.append(f'P/E={pe:.1f}')

            # Rule 4: السعر < 90% من قمة السنة → +15
            if high_52w > 0 and price < high_52w * 0.90:
                score += 15
                reasons.append(f'<90%قمة')

            # Rule 5: Dividend Yield > 5% → +15
            div_yield = _safe_float(r['div_yield'])
            if div_yield > 5:
                score += 15
                reasons.append(f'Div={div_yield:.1f}%')

            # Rule 6: حجم أعلى من المتوسط 20 يوم × 1.5 → +15
            vol_data = vol_map.get(symbol)
            if vol_data and vol_data['avg'] > 0:
                vol_ratio = vol_data['latest'] / vol_data['avg']
                if vol_ratio > 1.5:
                    score += 15
                    reasons.append(f'Vol×{vol_ratio:.1f}')

            score = min(100, max(0, score))
            label = 'فرصة' if score >= 70 else 'راقب' if score >= 50 else 'انتظر'

            reason_str = ' | '.join(reasons) if reasons else 'لا توجد معايير'

            results.append({
                'symbol': symbol,
                'name': r['name'] or symbol,
                'market': r['market'],
                'price': price,
                'change_percent': _safe_float(r['change_percent']),
                'score': round(score, 1),
                'reason': f'{label} — {reason_str}',
            })

        results.sort(key=lambda x: x['score'], reverse=True)
        return results[:50]
    finally:
        conn.close()


# Save results to screener_results table

def save_results(preset: str, results: List[Dict], conn: Optional[sqlite3.Connection] = None):
    """Save a preset's results to the screener_results table."""
    own_conn = conn is None
    if own_conn:
        conn = _get_stocks_conn()
    try:
        _ensure_screener_table(conn)
        today = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        # Delete old results for same preset+date
        conn.execute(
            "DELETE FROM screener_results WHERE preset = ? AND scan_date >= ?",
            (preset, today[:10])
        )
        for r in results:
            conn.execute("""
                INSERT INTO screener_results (preset, symbol, name, market, price, score, reason, scan_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                preset,
                r['symbol'],
                r.get('name', r['symbol']),
                r.get('market', ''),
                r.get('price', 0),
                r.get('score', 0),
                r.get('reason', ''),
                today,
            ))
        conn.commit()
    finally:
        if own_conn:
            conn.close()

# CLI interface

PRESET_MAP = {
    'day_trader': preset_day_trader,
    'daily_speculator': preset_daily_speculator,
    'value': preset_value,
    'momentum': preset_momentum,
    'thermometer': preset_thermometer,
}

PRESET_NAMES = {
    'day_trader': 'رادار المضارب',
    'daily_speculator': 'المضارب اليومي',
    'value': 'صائد القيمة',
    'momentum': 'صواريخ الزخم',
    'thermometer': 'ميزان حرارة السوق',
}


def run_preset(name: str, market: Optional[str] = None) -> List[Dict]:
    """Run a single preset and save results."""
    func = PRESET_MAP.get(name)
    if not func:
        print(f"Unknown preset: {name}", file=sys.stderr)
        return []
    results = func(market=market)
    save_results(name, results)
    return results


def run_all(market: Optional[str] = None) -> Dict[str, List[Dict]]:
    """Run all 4 presets and save results."""
    all_results = {}
    for name in PRESET_MAP:
        results = run_preset(name, market=market)
        all_results[name] = results
    return all_results


def main():
    parser = argparse.ArgumentParser(description='Stock Screener - ماسح الأسهم')
    parser.add_argument('--preset', choices=list(PRESET_MAP.keys()),
                        help='Run a specific preset')
    parser.add_argument('--market', default=None,
                        help='Filter by market (EGX, Tadawul, KW, QA)')
    parser.add_argument('--run-all', action='store_true',
                        help='Run all presets and save to DB')
    args = parser.parse_args()

    # Map short market names to Arabic
    market_map = {
        'EGX': 'مصر', 'egx': 'مصر',
        'Tadawul': 'السعودية', 'tadawul': 'السعودية', 'SA': 'السعودية',
        'Kuwait': 'الكويت', 'KW': 'الكويت',
        'Qatar': 'قطر', 'QA': 'قطر',
    }
    market = market_map.get(args.market, args.market)

    if args.run_all:
        all_res = run_all(market=market)
        output = {
            name: {
                'preset_name': PRESET_NAMES[name],
                'count': len(res),
                'results': res,
            }
            for name, res in all_res.items()
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))
    elif args.preset:
        results = run_preset(args.preset, market=market)
        output = {
            'preset': args.preset,
            'preset_name': PRESET_NAMES[args.preset],
            'count': len(results),
            'results': results,
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
