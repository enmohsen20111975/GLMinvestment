#!/usr/bin/env python3
"""
data_diagnostic.py — فحص تشخيصي شامل لدقة البيانات
====================================================
ينشئ تقرير JSON لكل سهم يوضّح:
  - مصدر كل قيمة (أي DB + أي table)
  - RSI الحقيقي + مصدره
  - support/resistance + مصدرها
  - dividend_yield + طريقة حسابها
  - R:R calculation
  - التطابق بين الـ APIs المختلفة

Usage:
  cd /root/GLMinvestment
  python3 vps-service/scripts/data_diagnostic.py --ticker NIPH
  python3 vps-service/scripts/data_diagnostic.py --all
  python3 vps-service/scripts/data_diagnostic.py --fix NIPH

Author: Main Agent (Z.ai Code)
Date: 2026-10-10
"""

import sqlite3
import json
import os
import sys
import argparse
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_DIR = PROJECT_ROOT / 'db'


def log(msg, level='INFO'):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f'[{ts}] [{level}] {msg}', flush=True)


def get_db(path):
    if not os.path.exists(path):
        return None
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def diagnose_ticker(ticker):
    """فحص تشخيصي كامل لسهم واحد."""
    report = {
        'ticker': ticker,
        'timestamp': datetime.now().isoformat(),
        'sources': {},
        'inconsistencies': [],
    }

    # ── 1. stocks.db ──
    stocks_db = get_db(DB_DIR / 'stocks.db')
    if stocks_db:
        # البيانات الأساسية
        row = stocks_db.execute("""
            SELECT ticker, name, name_ar, sector, current_price, previous_close,
                   change_percent, volume, market_cap, pe_ratio, pb_ratio,
                   roe, roa, eps, dividend_yield, rsi, ma_50, ma_200,
                   support, resistance, high_52w, low_52w, beta, trend, signal,
                   last_update
            FROM stocks WHERE ticker = ?
        """, (ticker,)).fetchone()

        if row:
            stock_data = dict(row)
            report['sources']['stocks_db'] = stock_data

            # فحص dividend_yield
            price = stock_data.get('current_price', 0)
            div_yield = stock_data.get('dividend_yield')
            if price > 0 and div_yield and div_yield > 5:
                # غالباً غلط — التوزيعات المصرية نادراً فوق 5%
                report['inconsistencies'].append({
                    'field': 'dividend_yield',
                    'value': div_yield,
                    'issue': f'dividend_yield={div_yield}% مرتفع جداً (السعر={price})',
                    'expected': f'~{(2/price)*100:.2f}%' if price > 0 else 'unknown',
                    'fix': 'تحقق من update_fundamentals.py',
                })

            # فحص support > price
            support = stock_data.get('support')
            if support and price > 0 and support > price:
                report['inconsistencies'].append({
                    'field': 'support',
                    'value': support,
                    'issue': f'support={support} > price={price} (دعم فوق السعر!)',
                    'fix': 'support = low_52w or price * 0.95',
                })

            # فحص resistance < price
            resistance = stock_data.get('resistance')
            if resistance and price > 0 and resistance < price and resistance > 0:
                report['inconsistencies'].append({
                    'field': 'resistance',
                    'value': resistance,
                    'issue': f'resistance={resistance} < price={price} (مقاومة تحت السعر!)',
                    'fix': 'resistance = high_52w or price * 1.08',
                })

            # فحص RSI
            rsi = stock_data.get('rsi')
            if rsi and (rsi < 0 or rsi > 100):
                report['inconsistencies'].append({
                    'field': 'rsi',
                    'value': rsi,
                    'issue': f'RSI={rsi} خارج النطاق [0-100]',
                    'fix': 'NULL + recalculate',
                })

            # فحص high_52w < low_52w
            high_52w = stock_data.get('high_52w')
            low_52w = stock_data.get('low_52w')
            if high_52w and low_52w and high_52w < low_52w:
                report['inconsistencies'].append({
                    'field': '52w_range',
                    'value': f'high={high_52w}, low={low_52w}',
                    'issue': 'high_52w < low_52w',
                    'fix': 'swap values',
                })

            # فحص RSI من stock_daily_prices (القيمة الحقيقية)
            prices = stocks_db.execute("""
                SELECT close FROM stock_daily_prices
                WHERE ticker = ? AND close IS NOT NULL AND close > 0
                ORDER BY price_date DESC LIMIT 15
            """, (ticker,)).fetchall()

            if len(prices) >= 15:
                closes = [p['close'] for p in reversed(prices)]  # أقدم → أحدث
                gains = 0
                losses = 0
                for i in range(1, 15):
                    change = closes[i] - closes[i - 1]
                    if change > 0:
                        gains += change
                    else:
                        losses -= change
                avg_gain = gains / 14
                avg_loss = losses / 14
                if avg_loss == 0:
                    real_rsi = 100
                else:
                    rs = avg_gain / avg_loss
                    real_rsi = 100 - (100 / (1 + rs))

                report['sources']['computed_rsi'] = {
                    'value': round(real_rsi, 4),
                    'method': 'Wilder 14-period',
                    'closes_used': closes[-5:],
                }

                if rsi and abs(rsi - real_rsi) > 2:
                    report['inconsistencies'].append({
                        'field': 'rsi',
                        'value': rsi,
                        'issue': f'RSI في DB={rsi:.2f} vs محسوب={real_rsi:.2f} (فرق {abs(rsi-real_rsi):.2f})',
                        'fix': f'UPDATE stocks SET rsi={real_rsi:.4f} WHERE ticker="{ticker}"',
                    })

        stocks_db.close()

    # ── 2. predictions.db ──
    pred_db = get_db(DB_DIR / 'predictions.db')
    if pred_db:
        preds = pred_db.execute("""
            SELECT ticker, signal, entry_price, target_price, target_price_2,
                   stop_loss, master_score, risk_reward, confidence,
                   prediction_date, status, who_is_buying, morning_bell,
                   evidence_count, explosive_label
            FROM predictions WHERE ticker = ?
            ORDER BY prediction_date DESC LIMIT 3
        """, (ticker,)).fetchall()

        if preds:
            report['sources']['predictions'] = [dict(p) for p in preds]

            # فحص R:R
            for p in preds:
                entry = p['entry_price']
                target = p['target_price']
                stop = p['stop_loss']
                db_rr = p['risk_reward']

                if entry and target and stop and entry > 0 and stop > 0 and target > 0:
                    if stop < entry:  # BUY
                        risk = entry - stop
                        reward = target - entry
                        actual_rr = reward / risk if risk > 0 else None
                    else:  # SELL
                        risk = stop - entry
                        reward = entry - target
                        actual_rr = reward / risk if risk > 0 else None

                    if actual_rr and db_rr and abs(actual_rr - db_rr) > 0.1:
                        report['inconsistencies'].append({
                            'field': 'risk_reward',
                            'value': db_rr,
                            'issue': f'R:R في DB={db_rr:.4f} vs محسوب={actual_rr:.4f}',
                            'fix': f'UPDATE predictions SET risk_reward={actual_rr:.4f} WHERE id={p["ticker"]}',
                        })

                    if stop > entry and p['signal'] in ('BUY', 'STRONG_BUY', 'HOLD'):
                        report['inconsistencies'].append({
                            'field': 'stop_loss',
                            'value': stop,
                            'issue': f'stop={stop} > entry={entry} في {p["signal"]}!',
                            'fix': f'stop = entry * 0.95 = {entry * 0.95:.2f}',
                        })

        # stored_analyses
        sa = pred_db.execute("""
            SELECT ticker, maestro_score, recommendation, entry_price,
                   target_price, stop_loss, risk_reward, confidence, regime
            FROM stored_analyses WHERE ticker = ?
        """, (ticker,)).fetchall()

        if sa:
            report['sources']['stored_analyses'] = [dict(s) for s in sa]

        pred_db.close()

    # ── 3. data_engine.db (fundamentals) ──
    de_db = get_db(DB_DIR / 'data_engine.db')
    if de_db:
        # tab_valuation
        try:
            val = de_db.execute("""
                SELECT * FROM tab_valuation WHERE ticker = ? LIMIT 1
            """, (ticker,)).fetchone()
            if val:
                report['sources']['data_engine_tab_valuation'] = dict(val)
        except:
            pass

        # historical_data
        try:
            hist = de_db.execute("""
                SELECT * FROM historical_data WHERE ticker = ?
                ORDER BY date DESC LIMIT 5
            """, (ticker,)).fetchall()
            if hist:
                report['sources']['data_engine_historical'] = [dict(h) for h in hist]
        except:
            pass

        de_db.close()

    # ── 4. ملخص التناقضات ──
    report['inconsistency_count'] = len(report['inconsistencies'])

    return report


def fix_ticker(ticker):
    """إصلاح التناقضات المكتشفة."""
    log(f'━━━ إصلاح {ticker} ━━━')

    report = diagnose_ticker(ticker)
    fixes = 0

    stocks_db = sqlite3.connect(str(DB_DIR / 'stocks.db'))

    for inc in report['inconsistencies']:
        field = inc['field']
        issue = inc['issue']

        if field == 'dividend_yield':
            # حساب صحيح: annual_dividend / price * 100
            price = report['sources'].get('stocks_db', {}).get('current_price', 0)
            if price > 0:
                # محاولة جلب التوزيع من tab_dividends
                correct_div = None
                de_db = get_db(DB_DIR / 'data_engine.db')
                if de_db:
                    try:
                        div_row = de_db.execute(
                            "SELECT value FROM tab_dividends WHERE ticker = ? ORDER BY date DESC LIMIT 1",
                            (ticker,)
                        ).fetchone()
                        if div_row and div_row['value']:
                            annual_div = float(div_row['value'])
                            correct_div = (annual_div / price) * 100
                    except:
                        pass
                    de_db.close()

                if correct_div is None:
                    # fallback: لو مفيش بيانات → NULL (Rule 27)
                    correct_div = None

                if correct_div is not None:
                    stocks_db.execute("UPDATE stocks SET dividend_yield = ? WHERE ticker = ?", (round(correct_div, 2), ticker))
                    log(f'  ✅ dividend_yield: {inc["value"]} → {round(correct_div, 2)}%')
                    fixes += 1
                else:
                    stocks_db.execute("UPDATE stocks SET dividend_yield = NULL WHERE ticker = ?", (ticker,))
                    log(f'  ✅ dividend_yield: {inc["value"]} → NULL (no data)')
                    fixes += 1

        elif field == 'support':
            price = report['sources'].get('stocks_db', {}).get('current_price', 0)
            low_52w = report['sources'].get('stocks_db', {}).get('low_52w')
            new_support = low_52w if low_52w and low_52w < price else price * 0.95
            stocks_db.execute("UPDATE stocks SET support = ? WHERE ticker = ?", (new_support, ticker))
            log(f'  ✅ support: {inc["value"]} → {new_support}')
            fixes += 1

        elif field == 'resistance':
            price = report['sources'].get('stocks_db', {}).get('current_price', 0)
            high_52w = report['sources'].get('stocks_db', {}).get('high_52w')
            new_resistance = high_52w if high_52w and high_52w > price else price * 1.08
            stocks_db.execute("UPDATE stocks SET resistance = ? WHERE ticker = ?", (new_resistance, ticker))
            log(f'  ✅ resistance: {inc["value"]} → {new_resistance}')
            fixes += 1

        elif field == 'rsi':
            computed = report['sources'].get('computed_rsi', {}).get('value')
            if computed:
                stocks_db.execute("UPDATE stocks SET rsi = ? WHERE ticker = ?", (computed, ticker))
                log(f'  ✅ rsi: {inc["value"]} → {computed}')
                fixes += 1

        elif field == '52w_range':
            high = report['sources'].get('stocks_db', {}).get('high_52w')
            low = report['sources'].get('stocks_db', {}).get('low_52w')
            if high and low and high < low:
                stocks_db.execute("UPDATE stocks SET high_52w = ?, low_52w = ? WHERE ticker = ?", (low, high, ticker))
                log(f'  ✅ 52w: swapped high/low')
                fixes += 1

    # إصلاح R:R في predictions
    pred_db = sqlite3.connect(str(DB_DIR / 'predictions.db'))
    for inc in report['inconsistencies']:
        if inc['field'] == 'risk_reward':
            # محتاج إعادة حساب
            preds = pred_db.execute("SELECT id, entry_price, target_price, stop_loss, signal FROM predictions WHERE ticker = ?", (ticker,)).fetchall()
            for p in preds:
                entry = p[1]
                target = p[2]
                stop = p[3]
                signal = p[4]
                if entry and target and stop:
                    if signal in ('BUY', 'STRONG_BUY', 'HOLD', 'ACCUMULATE'):
                        if stop < entry:
                            rr = (target - entry) / (entry - stop)
                            pred_db.execute("UPDATE predictions SET risk_reward = ? WHERE id = ?", (round(rr, 4), p[0]))
                            log(f'  ✅ R:R في prediction {p[0]}: → {round(rr, 4)}')
                            fixes += 1

        elif inc['field'] == 'stop_loss':
            # stop > entry في BUY
            preds = pred_db.execute("SELECT id, entry_price, signal FROM predictions WHERE ticker = ? AND stop_loss > entry_price AND signal IN ('BUY','STRONG_BUY','HOLD','ACCUMULATE')", (ticker,)).fetchall()
            for p in preds:
                new_stop = p[1] * 0.95
                pred_db.execute("UPDATE predictions SET stop_loss = ? WHERE id = ?", (new_stop, p[0]))
                log(f'  ✅ stop في prediction {p[0]}: → {new_stop}')
                fixes += 1

    pred_db.commit()
    pred_db.close()

    stocks_db.commit()
    stocks_db.close()

    log(f'\n  ✅ تم إصلاح {fixes} مشكلة في {ticker}')
    return fixes


def fix_all():
    """فحص + إصلاح كل الأسهم."""
    log('═══════════════════════════════════════════════════════════')
    log('  🔧 فحص + إصلاح شامل لكل الأسهم')
    log('═══════════════════════════════════════════════════════════\n')

    stocks_db = sqlite3.connect(str(DB_DIR / 'stocks.db'))
    tickers = stocks_db.execute("SELECT ticker FROM stocks WHERE ticker IS NOT NULL AND current_price > 0").fetchall()
    stocks_db.close()

    total_fixes = 0
    total_issues = 0

    for i, (ticker,) in enumerate(tickers):
        if i % 100 == 0:
            log(f'  المعالجة: {i}/{len(tickers)}...')

        report = diagnose_ticker(ticker)
        if report['inconsistency_count'] > 0:
            total_issues += report['inconsistency_count']
            fixes = fix_ticker(ticker)
            total_fixes += fixes

    log(f'\n═══════════════════════════════════════════════════════════')
    log(f'  ✅ مكتمل: {len(tickers)} سهم، {total_issues} مشكلة، {total_fixes} إصلاح')
    log(f'═══════════════════════════════════════════════════════════')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Data Diagnostic + Fix')
    parser.add_argument('--ticker', help='فحص سهم محدد')
    parser.add_argument('--fix', help='إصلاح سهم محدد')
    parser.add_argument('--all', action='store_true', help='فحص + إصلاح كل الأسهم')
    args = parser.parse_args()

    if args.fix:
        fix_ticker(args.fix)
    elif args.ticker:
        report = diagnose_ticker(args.ticker)
        print(json.dumps(report, indent=2, ensure_ascii=False, default=str))
    elif args.all:
        fix_all()
    else:
        parser.print_help()
