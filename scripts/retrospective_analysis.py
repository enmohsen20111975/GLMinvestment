#!/usr/bin/env python3
"""
retrospective_analysis.py — التحليل الرجعي للوحوش والجثث
============================================================
EGX-STRATEGY-FINAL (2026-08-30): تحليل رجعي شامل لمعرفة:
  1. الوحوش: الأسهم اللي عملت +80% أو +100% — هل النظام اصطادها ولا فاتت؟
  2. الجثث: الأسهم اللي نزلت -30% أو -40% — هل النظام لبسها ولا نجا؟

لكل سهم:
  - هل كان فيه إشارة من النظام؟
  - لو أيوه: دخل عند أي سعر؟ خرج عند أي سعر؟ خد قد إيه من الحركة؟
  - لو لأ: أنهي شرط رفضه؟ (Don't Chase / Deep Correction / RS / سيولة / سوق / evidence)

الهدف: نعرف إحنا بنصيد فين وبنموت فين.
"""
from __future__ import annotations
import os, sys, json, sqlite3
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

from utils.egx_gate import is_valid_egx_ticker, get_egx_canonical_ticker
from utils.entry_gate import check_entry_gate


def load_all_egx_prices():
    """حمّل كل أسعار EGX من data_engine.db."""
    conn = sqlite3.connect(str(PROJECT_ROOT / 'db' / 'data_engine.db'))
    conn.row_factory = sqlite3.Row
    # فلتر EGX canonical فقط
    c = conn.cursor()
    c.execute('SELECT DISTINCT symbol FROM egksco_price_history')
    all_tickers = [r[0] for r in c.fetchall()]
    conn.close()

    # فلتر EGX
    egx_tickers = [t for t in all_tickers if is_valid_egx_ticker(t)]
    print(f'📊 إجمالي tickers: {len(all_tickers)} → EGX canonical: {len(egx_tickers)}')

    # حمّل أسعار كل سهم EGX
    conn = sqlite3.connect(str(PROJECT_ROOT / 'db' / 'data_engine.db'))
    conn.row_factory = sqlite3.Row
    prices = {}
    for ticker in egx_tickers:
        canonical = get_egx_canonical_ticker(ticker)
        norm_ticker = canonical['ticker'] if canonical else ticker
        rows = conn.execute(
            'SELECT price_date, open_price, high_price, low_price, close_price, volume '
            'FROM egksco_price_history WHERE symbol = ? AND price_date >= ? '
            'ORDER BY price_date',
            (ticker, '2026-02-27')
        ).fetchall()
        if len(rows) < 20:
            continue
        prices[norm_ticker] = {
            'dates': [r['price_date'] for r in rows],
            'opens': [float(r['open_price'] or 0) for r in rows],
            'highs': [float(r['high_price'] or 0) for r in rows],
            'lows': [float(r['low_price'] or 0) for r in rows],
            'closes': [float(r['close_price'] or 0) for r in rows],
            'volumes': [float(r['volume'] or 0) for r in rows],
        }
    conn.close()
    return prices


def compute_performance(prices_data):
    """احسب أداء كل سهم في الفترة (return %)."""
    performances = []
    for ticker, data in prices_data.items():
        closes = data['closes']
        if len(closes) < 20 or closes[0] <= 0:
            continue
        first_price = closes[0]
        last_price = closes[-1]
        max_price = max(closes)
        min_price = min(closes)
        total_return = ((last_price - first_price) / first_price) * 100
        max_drawdown = ((max_price - min_price) / max_price) * 100 if max_price > 0 else 0
        # أعلى ارتفاع من البداية
        max_gain = ((max_price - first_price) / first_price) * 100 if first_price > 0 else 0
        performances.append({
            'ticker': ticker,
            'first_price': first_price,
            'last_price': last_price,
            'max_price': max_price,
            'min_price': min_price,
            'total_return': total_return,
            'max_gain': max_gain,
            'max_drawdown': max_drawdown,
            'data': data,
        })
    return performances


def check_system_signal(ticker, data, scan_dates):
    """اتحقق هل النظام كان له إشارة على السهم في أي تاريخ فحص."""
    from engines.v38_backtest_engine import V38BacktestEngine
    engine = V38BacktestEngine()

    dates = data['dates']
    closes = data['closes']
    opens = data['opens']
    highs = data['highs']
    lows = data['lows']
    volumes = data['volumes']

    signals = []
    for scan_date in scan_dates:
        # لاقي index الـ scan_date
        try:
            day_idx = dates.index(scan_date)
        except ValueError:
            # أقرب تاريخ
            day_idx = None
            for i, d in enumerate(dates):
                if d <= scan_date:
                    day_idx = i
                else:
                    break
            if day_idx is None or day_idx < 30:
                continue

        if day_idx < 30 or day_idx >= len(dates):
            continue

        try:
            result = engine.analyze_single_day_v393(
                ticker, dates[:day_idx+1], opens[:day_idx+1], highs[:day_idx+1],
                lows[:day_idx+1], closes[:day_idx+1], volumes[:day_idx+1], day_idx, 0.0
            )
            signal = result.get('signal', 'WAIT')
            score = result.get('score', 0)
            evidence = sum(1 for v in result.get('proofs', {}).values() if '✅' in str(v))

            # فحص entry_gate
            gate_data = {
                'entry_price': float(result.get('entry', 0) or 0),
                'target_price': float(result.get('target', 0) or 0),
                'stop_price': float(result.get('stop_loss', 0) or 0),
                'evidence_count': evidence,
                'proofs': result.get('proofs', {}),
                'closes': closes[:day_idx+1],
                'volumes': volumes[:day_idx+1],
                'market_regime_trend': result.get('market_regime_trend', ''),
            }
            gate_result = check_entry_gate(gate_data)

            signals.append({
                'date': scan_date,
                'signal': signal,
                'score': score,
                'evidence': evidence,
                'gate_passed': gate_result['passed'],
                'gate_failed_reasons': gate_result['reasons_failed'],
                'entry': float(result.get('entry', 0) or 0),
                'target': float(result.get('target', 0) or 0),
                'stop': float(result.get('stop_loss', 0) or 0),
            })

            # لو الـ gate passed + signal BUY → نوقف (النظام كان هيقبلها)
            if gate_result['passed'] and signal in ('STRONG_BUY', 'INSTITUTIONAL_BUY', 'BUY'):
                return signals, True  # اصطادها
        except Exception as e:
            continue

    return signals, False  # ما اصطادهاش


def main():
    print('='*70)
    print('  التحليل الرجعي — الوحوش والجثث (6 شهور: Feb-Aug 2026)')
    print('='*70)

    prices = load_all_egx_prices()
    print(f'📊 أسهم EGX ببيانات كافية: {len(prices)}')

    performances = compute_performance(prices)
    print(f'📊 أسهم بأداء محسوب: {len(performances)}')

    # الوحوش: أعلى 20 صاعد (max_gain)
    monsters = sorted(performances, key=lambda x: -x['max_gain'])[:20]
    # الجثث: أعلى 20 هابط (total_return)
    corpses = sorted(performances, key=lambda x: x['total_return'])[:20]

    print(f'\n🎯 الوحوش (أعلى 20 صاعد):')
    print(f'{"السهم":<8} {"first":<10} {"max":<10} {"last":<10} {"max_gain%":<12} {"total_ret%":<12}')
    for m in monsters:
        print(f'{m["ticker"]:<8} {m["first_price"]:<10.2f} {m["max_price"]:<10.2f} {m["last_price"]:<10.2f} {m["max_gain"]:<12.1f} {m["total_return"]:<12.1f}')

    print(f'\n💀 الجثث (أعلى 20 هابط):')
    print(f'{"السهم":<8} {"first":<10} {"min":<10} {"last":<10} {"total_ret%":<12} {"max_dd%":<12}')
    for c in corpses:
        print(f'{c["ticker"]:<8} {c["first_price"]:<10.2f} {c["min_price"]:<10.2f} {c["last_price"]:<10.2f} {c["total_return"]:<12.1f} {c["max_drawdown"]:<12.1f}')

    # تواريخ الفحص (كل 5 أيام تداول)
    scan_dates = []
    if performances:
        sample_data = performances[0]['data']
        all_dates = sample_data['dates']
        scan_dates = all_dates[::5]  # كل 5 أيام
    print(f'\n📊 تواريخ الفحص: {len(scan_dates)} تاريخ')

    # تحليل الوحوش
    print(f'\n{"="*70}')
    print(f'  تحليل الوحوش — هل النظام اصطادها؟')
    print(f'{"="*70}')
    monsters_analysis = []
    for m in monsters[:15]:  # أول 15
        print(f'\n🎯 {m["ticker"]} (max_gain={m["max_gain"]:.1f}%):')
        signals, caught = check_system_signal(m['ticker'], m['data'], scan_dates)
        if caught:
            # لاقي آخر إشارة مقبولة
            accepted = [s for s in signals if s['gate_passed'] and s['signal'] in ('STRONG_BUY','INSTITUTIONAL_BUY','BUY')]
            if accepted:
                last = accepted[-1]
                # كم يوم قبل القمة؟
                try:
                    peak_idx = m['data']['closes'].index(max(m['data']['closes']))
                    peak_date = m['data']['dates'][peak_idx]
                    days_before = (datetime.strptime(peak_date, '%Y-%m-%d') - datetime.strptime(last['date'], '%Y-%m-%d')).days
                except:
                    days_before = 0
                print(f'  ✅ اصطادها في {last["date"]} ({days_before} يوم قبل القمة)')
                print(f'     entry={last["entry"]:.2f} target={last["target"]:.2f} stop={last["stop"]:.2f} ev={last["evidence"]}')
                monsters_analysis.append({
                    'ticker': m['ticker'], 'max_gain': m['max_gain'], 'caught': True,
                    'signal_date': last['date'], 'days_before_peak': days_before,
                    'entry': last['entry'], 'target': last['target'], 'stop': last['stop'],
                })
        else:
            # ما اصطادهاش — أنهي شرط رفضه؟
            if signals:
                # آخر إشارة + أسباب الرفض
                last = signals[-1]
                fail_reasons = last['gate_failed_reasons'] if last['gate_failed_reasons'] else ['signal=WAIT/score low']
                print(f'  ❌ فاتها. آخر فحص: {last["date"]} signal={last["signal"]} score={last["score"]} ev={last["evidence"]}')
                print(f'     أسباب الرفض: {fail_reasons[:3]}')
                monsters_analysis.append({
                    'ticker': m['ticker'], 'max_gain': m['max_gain'], 'caught': False,
                    'last_signal': last['signal'], 'fail_reasons': fail_reasons[:3],
                })
            else:
                print(f'  ❌ فاتها (مفيش بيانات كافية للفحص)')
                monsters_analysis.append({
                    'ticker': m['ticker'], 'max_gain': m['max_gain'], 'caught': False,
                    'fail_reasons': ['insufficient_data'],
                })

    # تحليل الجثث
    print(f'\n{"="*70}')
    print(f'  تحليل الجثث — هل النظام لبسها؟')
    print(f'{"="*70}')
    corpses_analysis = []
    for c in corpses[:15]:  # أول 15
        print(f'\n💀 {c["ticker"]} (total_ret={c["total_return"]:.1f}%):')
        signals, caught = check_system_signal(c['ticker'], c['data'], scan_dates)
        if caught:
            accepted = [s for s in signals if s['gate_passed'] and s['signal'] in ('STRONG_BUY','INSTITUTIONAL_BUY','BUY')]
            if accepted:
                last = accepted[-1]
                print(f'  ⚠️ لبسها! إشارة في {last["date"]} entry={last["entry"]:.2f}')
                corpses_analysis.append({
                    'ticker': c['ticker'], 'total_ret': c['total_return'], 'caught': True,
                    'signal_date': last['date'], 'entry': last['entry'],
                })
        else:
            if signals:
                last = signals[-1]
                fail_reasons = last['gate_failed_reasons'] if last['gate_failed_reasons'] else ['signal=WAIT/score low']
                print(f'  ✅ نجا منها. آخر فحص: {last["date"]} signal={last["signal"]}')
                print(f'     أسباب الرفض: {fail_reasons[:3]}')
                corpses_analysis.append({
                    'ticker': c['ticker'], 'total_ret': c['total_return'], 'caught': False,
                    'fail_reasons': fail_reasons[:3],
                })
            else:
                print(f'  ✅ نجا منها (مفيش بيانات كافية)')
                corpses_analysis.append({
                    'ticker': c['ticker'], 'total_ret': c['total_return'], 'caught': False,
                    'fail_reasons': ['insufficient_data'],
                })

    # تجميع الأسباب المتكررة
    print(f'\n{"="*70}')
    print(f'  تجميع الأسباب المتكررة')
    print(f'{"="*70}')

    # أسباب فوت الوحوش
    monster_fail_reasons = {}
    for m in monsters_analysis:
        if not m['caught']:
            for r in m.get('fail_reasons', []):
                # اختصر السبب
                short = r.split('(')[0].split(':')[0].strip()
                monster_fail_reasons[short] = monster_fail_reasons.get(short, 0) + 1

    print(f'\nأسباب فوت الوحوش (من {sum(1 for m in monsters_analysis if not m["caught"])} سهم فات):')
    for reason, count in sorted(monster_fail_reasons.items(), key=lambda x: -x[1]):
        print(f'  {reason}: {count}')

    # أسباب نجاة الجثث
    corpse_save_reasons = {}
    for c in corpses_analysis:
        if not c['caught']:
            for r in c.get('fail_reasons', []):
                short = r.split('(')[0].split(':')[0].strip()
                corpse_save_reasons[short] = corpse_save_reasons.get(short, 0) + 1

    print(f'\nأسباب نجاة الجثث (من {sum(1 for c in corpses_analysis if not c["caught"])} سهم نجا):')
    for reason, count in sorted(corpse_save_reasons.items(), key=lambda x: -x[1]):
        print(f'  {reason}: {count}')

    # حفظ النتائج
    output = {
        'monsters_analysis': monsters_analysis,
        'corpses_analysis': corpses_analysis,
        'monster_fail_reasons': monster_fail_reasons,
        'corpse_save_reasons': corpse_save_reasons,
    }
    output_path = str(PROJECT_ROOT / 'db' / 'retrospective_analysis.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2, default=str)
    print(f'\n💾 تم حفظ النتائج في {output_path}')


if __name__ == '__main__':
    main()
