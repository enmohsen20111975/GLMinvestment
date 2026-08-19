#!/usr/bin/env python3
"""
₿ Crypto Blind Backtesting Engine — مختبر الكريبتو الزمني (MASS-SCALE)
==========================================================================
يختبر هل "العقل الجديد" (V20 Fusion + SMC + Dip Buying) بيتوقع صح في سوق
الكريبتو — على **كل** العملات المتاحة (مش BTC/ETH بس).

كيف يعمل:
1. يكتشف كل العملات المتاحة (من data_engine.db أو CoinGecko top 50).
2. لكل عملة، يسحب 90 يوم OHLCV من CoinGecko API.
3. يقسم الداتا عند Cutoff (افتراضي: قبل 30 يوم):
   - الـ 60 يوم الأولين = "الماضي" (المحرك بيشوفه ويحلله)
   - الـ 30 يوم الأخيرة = "المستقبل" (المحرك مايشوفش — بنقيس عليه النتيجة)
4. يشغل نفس محرك الـ Live Lab (FusionEngineV20 + SMC) على الـ 60 يوم.
5. يقارن التوقع بالـ 30 يوم الحقيقية:
   - WIN  → وصل للـ Target قبل الـ Stop
   - LOSS → ضرب الـ Stop قبل الـ Target
   - NEUTRAL → مفيش حاجة حصلت
6. يطبع Win Rate Report لكل العملات (سوق كامل).

ليه الكريبتو مش EGX؟
  - EGX فيه فجوات وأيام مقطوعة → Backtester بيSKIP معظم الأسهم.
  - الكريبتو 24/7 → الداتا كاملة ومتناسقة → اختبار حقيقي للمحرك.

Usage:
    python3 scripts/crypto_blind_backtester.py              # كل العملات المتاحة
    python3 scripts/crypto_blind_backtester.py --all        # كل العملات (صريح)
    python3 scripts/crypto_blind_backtester.py --days 90 --forward-days 30
    python3 scripts/crypto_blind_backtester.py --coins bitcoin,ethereum
    python3 scripts/crypto_blind_backtester.py --max-coins 20
    python3 scripts/crypto_blind_backtester.py --json
"""

import sys
import os
import json
import argparse
from pathlib import Path
from datetime import datetime, timedelta

# ── Paths ──
PROJECT_ROOT = Path(__file__).parent.parent
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))

# ── Lazy-loaded scheduler (loads FusionEngineV20 + SMC) ──
_crypto_scheduler = None


def get_scheduler():
    """Lazy-init the CryptoLabScheduler (loads the V20 + SMC engines)."""
    global _crypto_scheduler
    if _crypto_scheduler is None:
        from jobs.crypto_lab_scheduler import get_crypto_lab_scheduler
        _crypto_scheduler = get_crypto_lab_scheduler()
    return _crypto_scheduler


def discover_all_coins(max_coins=50):
    """يكتشف كل العملات المتاحة للتحليل (MASS-SCALE).

    يستخدم نفس منطق الـ Live Lab scheduler:
      1. data_engine.db.crypto_prices (الإنتاج)
      2. CoinGecko top 50 (fallback)
      3. BTC+ETH (last resort)

    Returns:
        list of (coin_id, symbol) tuples, e.g. [('bitcoin','BTC'), ('ethereum','ETH'), ...]
    """
    from jobs.crypto_lab_scheduler import get_crypto_lab_coins
    coins_map = get_crypto_lab_coins(force_refresh=True, max_coins=max_coins)
    return list(coins_map.items())


# ═══════════════════════════════════════════════════════════════════════════
# Core: Run one crypto blind backtest
# ═══════════════════════════════════════════════════════════════════════════

def run_crypto_backtest(coin_id, symbol, total_days=90, forward_days=30):
    """Run a single blind backtest for one crypto coin.

    Args:
        coin_id:     CoinGecko coin_id (e.g. 'bitcoin')
        symbol:      Display symbol (e.g. 'BTC')
        total_days:  Total history window to fetch (default 90)
        forward_days: Forward evaluation window (default 30)

    Returns:
        dict with: symbol, cutoff, signal, entry, target, stop, outcome, ...
    """
    result = {
        'symbol': symbol,
        'coin_id': coin_id,
        'total_days': total_days,
        'forward_days': forward_days,
        'history_candles': 0,
        'forward_candles': 0,
        'cutoff_date': None,
        'signal': 'NO_DATA',
        'confidence': 0,
        'score': 0,
        'entry_price': None,
        'target_price': None,
        'stop_loss': None,
        'risk_reward': None,
        'outcome': 'SKIP',
        'outcome_detail': '',
        'forward_data': [],
    }

    # 1. Fetch full OHLCV window from CoinGecko (same source as Live Lab)
    scheduler = get_scheduler()
    try:
        ohlcv, market_info = scheduler.fetch_crypto_ohlcv(coin_id, days=total_days)
    except Exception as e:
        result['outcome'] = 'ERROR'
        result['outcome_detail'] = f'Fetch error: {str(e)[:100]}'
        return result

    if not ohlcv or len(ohlcv) < 20:
        result['outcome'] = 'SKIP'
        result['outcome_detail'] = (
            f'Insufficient OHLCV from CoinGecko ({len(ohlcv)} candles < 20). '
            f'Rate-limited or network issue.'
        )
        return result

    result['history_candles_total'] = len(ohlcv)

    # 2. Split at cutoff: history = first (total - forward) candles, forward = last forward_days
    # The OHLCV from CoinGecko is ordered oldest → newest.
    split_idx = max(10, len(ohlcv) - forward_days)  # ensure at least 10 history candles
    history = ohlcv[:split_idx]
    forward = ohlcv[split_idx:]

    result['history_candles'] = len(history)
    result['forward_candles'] = len(forward)

    if len(history) < 20:
        result['outcome'] = 'SKIP'
        result['outcome_detail'] = f'Insufficient history ({len(history)} < 20 candles)'
        return result

    if not forward:
        result['outcome'] = 'NO_FUTURE_DATA'
        result['outcome_detail'] = 'No forward candles after cutoff'
        return result

    # The cutoff date = last date in the history portion
    cutoff_date = str(history[-1].get('date', '')).split('T')[0]
    result['cutoff_date'] = cutoff_date

    # 3. Build market_info for the analysis (the "current price" = last close of history)
    # The engine needs: current_price, source, volume_24h, change_24h_pct, name, etc.
    # We derive these from the history's last candle so the engine doesn't see the future.
    last_candle = history[-1]
    prev_candle = history[-2] if len(history) >= 2 else last_candle
    current_price = float(last_candle.get('close', 0))
    prev_close = float(prev_candle.get('close', current_price))
    change_pct = ((current_price - prev_close) / prev_close * 100) if prev_close > 0 else 0.0
    vol_24h = float(last_candle.get('volume', 0))
    high_24h = float(last_candle.get('high', current_price))
    low_24h = float(last_candle.get('low', current_price))

    blind_market_info = {
        'current_price': current_price,
        'source': market_info.get('source', 'coingecko'),
        'volume_24h': vol_24h,
        'change_24h_pct': change_pct,
        'name': market_info.get('name', symbol),
        'high_24h': high_24h,
        'low_24h': low_24h,
        'market_cap': market_info.get('market_cap', 0),
    }

    # 4. Run the engine (FusionEngineV20 + SMC) on the blind history
    try:
        prediction = scheduler.analyze_ohlcv(coin_id, symbol, history, blind_market_info)
    except Exception as e:
        result['outcome'] = 'ERROR'
        result['outcome_detail'] = f'Analysis error: {str(e)[:100]}'
        return result

    if prediction is None:
        result['outcome'] = 'ERROR'
        result['outcome_detail'] = 'analyze_ohlcv returned None'
        return result

    # 5. Extract prediction
    result['signal'] = prediction.get('signal', 'HOLD')
    result['confidence'] = prediction.get('confidence', 0)
    result['score'] = prediction.get('score', 0)
    result['entry_price'] = prediction.get('entry_price', current_price)
    result['target_price'] = prediction.get('target_price')
    result['stop_loss'] = prediction.get('stop_loss')
    result['risk_reward'] = (
        round(abs(result['target_price'] - result['entry_price']) /
              abs(result['entry_price'] - result['stop_loss']), 2)
        if result['target_price'] and result['stop_loss']
        and result['entry_price']
        and abs(result['entry_price'] - result['stop_loss']) > 0
        else None
    )

    signal = result['signal']
    entry_price = result['entry_price']
    target_price = result['target_price']
    stop_price = result['stop_loss']

    # HOLD signals → no trade taken
    if signal not in ('BUY', 'SELL') or not target_price or not stop_price:
        result['outcome'] = 'NEUTRAL'
        result['outcome_detail'] = f'Signal is {signal} — no trade taken'
        result['forward_data'] = forward
        return result

    # 6. Evaluate: did the forward price hit target or stop first?
    target_hit_day = None
    stop_hit_day = None

    for i, day in enumerate(forward):
        day_high = float(day.get('high', 0))
        day_low = float(day.get('low', 0))
        if signal == 'BUY':
            # Check stop first (conservative — assume worst case)
            if day_low <= stop_price:
                stop_hit_day = i + 1
                break
            if day_high >= target_price:
                target_hit_day = i + 1
                break
        else:  # SELL
            if day_high >= stop_price:
                stop_hit_day = i + 1
                break
            if day_low <= target_price:
                target_hit_day = i + 1
                break

    if target_hit_day:
        result['outcome'] = 'WIN'
        hit_date = str(forward[target_hit_day - 1].get('date', '')).split('T')[0]
        result['outcome_detail'] = f'Target hit on day {target_hit_day} ({hit_date})'
    elif stop_hit_day:
        result['outcome'] = 'LOSS'
        hit_date = str(forward[stop_hit_day - 1].get('date', '')).split('T')[0]
        result['outcome_detail'] = f'Stop hit on day {stop_hit_day} ({hit_date})'
    else:
        # Neither hit — check direction
        last_fwd_close = float(forward[-1].get('close', 0))
        if last_fwd_close > 0 and entry_price > 0:
            pct = ((last_fwd_close / entry_price) - 1) * 100
            if signal == 'BUY':
                if last_fwd_close > entry_price:
                    result['outcome'] = 'NEUTRAL_UP'
                    result['outcome_detail'] = (
                        f'No hit. Price moved UP {pct:+.1f}% but didn\'t reach target'
                    )
                else:
                    result['outcome'] = 'NEUTRAL_DOWN'
                    result['outcome_detail'] = (
                        f'No hit. Price moved DOWN {pct:+.1f}% but didn\'t hit stop'
                    )
            else:  # SELL
                if last_fwd_close < entry_price:
                    result['outcome'] = 'NEUTRAL_UP'
                    result['outcome_detail'] = (
                        f'No hit. Price moved in favor {-pct:+.1f}% but didn\'t reach target'
                    )
                else:
                    result['outcome'] = 'NEUTRAL_DOWN'
                    result['outcome_detail'] = (
                        f'No hit. Price moved against {pct:+.1f}% but didn\'t hit stop'
                    )
        else:
            result['outcome'] = 'NEUTRAL'
            result['outcome_detail'] = 'No hit and could not determine direction'

    result['forward_data'] = forward
    return result


# ═══════════════════════════════════════════════════════════════════════════
# Report Generation
# ═══════════════════════════════════════════════════════════════════════════

def print_single_report(result):
    """Print a detailed report for one crypto backtest."""
    print(f"\n{'='*70}")
    print(f"  ₿ CRYPTO BLIND BACKTEST — {result['symbol']}")
    print(f"{'='*70}")
    print(f"  Coin ID        : {result['coin_id']}")
    print(f"  Cutoff Date    : {result['cutoff_date']} (engine sees data up to here)")
    print(f"  History Candles: {result['history_candles']}")
    print(f"  Forward Candles: {result['forward_candles']}")
    print(f"")
    print(f"  ── Engine Prediction ──")
    print(f"  Signal         : {result['signal']}")
    print(f"  Confidence     : {result['confidence']}/100")
    print(f"  Score          : {result['score']:.1f}")
    print(f"  Entry Price    : ${result['entry_price']:.2f}" if result['entry_price'] else f"  Entry Price    : N/A")
    if result['target_price']:
        print(f"  Target Price   : ${result['target_price']:.2f}")
        print(f"  Stop Loss      : ${result['stop_loss']:.2f}")
        rr = result.get('risk_reward')
        print(f"  Risk/Reward    : 1:{rr}" if rr else f"  Risk/Reward    : N/A")
    print(f"")
    print(f"  ── Actual Outcome ──")

    outcome_emoji = {
        'WIN': '✅', 'LOSS': '❌', 'NEUTRAL': '⚪',
        'NEUTRAL_UP': '📈', 'NEUTRAL_DOWN': '📉',
        'SKIP': '⏭️', 'NO_FUTURE_DATA': '❓',
        'ERROR': '💥', 'NO_DATA': '🚫',
    }
    emoji = outcome_emoji.get(result['outcome'], '❓')
    print(f"  Outcome        : {emoji} {result['outcome']}")
    print(f"  Detail         : {result['outcome_detail']}")

    if result['forward_data']:
        fwd = result['forward_data']
        print(f"")
        print(f"  ── Forward Price Action ({len(fwd)} candles) ──")
        entry = result['entry_price']
        for day in fwd[:10]:
            d = str(day.get('date', '')).split('T')[0]
            c = float(day.get('close', 0))
            pct = ((c / entry) - 1) * 100 if entry > 0 and c > 0 else 0
            arrow = '📈' if pct > 0 else '📉' if pct < 0 else '➡️'
            print(f"    {d} | O:${float(day.get('open',0)):.2f} H:${float(day.get('high',0)):.2f} "
                  f"L:${float(day.get('low',0)):.2f} C:${c:.2f} | {arrow} {pct:+.1f}%")
        if len(fwd) > 10:
            print(f"    ... ({len(fwd) - 10} more candles)")

    print(f"{'='*70}")


def print_batch_summary(results):
    """Print a summary report for multiple crypto backtests."""
    print(f"\n{'#'*70}")
    print(f"  ₿ CRYPTO BLIND BACKTESTING SUMMARY — Win Rate Report")
    print(f"{'#'*70}")
    print(f"  Tested {len(results)} coins")
    print()

    wins = sum(1 for r in results if r['outcome'] == 'WIN')
    losses = sum(1 for r in results if r['outcome'] == 'LOSS')
    neutrals = sum(1 for r in results if r['outcome'].startswith('NEUTRAL'))
    skips = sum(1 for r in results if r['outcome'] in ('SKIP', 'NO_DATA', 'NO_FUTURE_DATA', 'ERROR'))

    trades_taken = wins + losses
    win_rate = (wins / trades_taken * 100) if trades_taken > 0 else 0

    print(f"  ┌─────────────────────────────────────────────┐")
    print(f"  │  ✅ WINS (target hit)     : {wins:>3}              │")
    print(f"  │  ❌ LOSSES (stop hit)     : {losses:>3}              │")
    print(f"  │  ⚪ NEUTRAL (no hit)      : {neutrals:>3}              │")
    print(f"  │  ⏭️  SKIPPED (no data)    : {skips:>3}              │")
    print(f"  ├─────────────────────────────────────────────┤")
    print(f"  │  📊 TRADES TAKEN          : {trades_taken:>3}              │")
    print(f"  │  🎯 WIN RATE              : {win_rate:>5.1f}%          │")
    print(f"  └─────────────────────────────────────────────┘")
    print()

    print(f"  Per-coin breakdown:")
    print(f"  {'Symbol':<8} {'Signal':<8} {'Score':>6} {'Entry':>12} {'Target':>12} {'Stop':>12} {'Outcome':<15}")
    print(f"  {'─'*8} {'─'*8} {'─'*6} {'─'*12} {'─'*12} {'─'*12} {'─'*15}")
    for r in results:
        entry = f"${r['entry_price']:.2f}" if r['entry_price'] else 'N/A'
        tgt = f"${r['target_price']:.2f}" if r['target_price'] else 'N/A'
        stp = f"${r['stop_loss']:.2f}" if r['stop_loss'] else 'N/A'
        print(f"  {r['symbol']:<8} {r['signal']:<8} {r['score']:>6.1f} "
              f"{entry:>12} {tgt:>12} {stp:>12} {r['outcome']:<15}")
    print()

    if trades_taken > 0:
        if win_rate >= 60:
            print(f"  🟢 VERDICT: Crypto engine is PREDICTIVE (Win Rate ≥ 60%)")
        elif win_rate >= 40:
            print(f"  🟡 VERDICT: Crypto engine is MIXED (40-60% Win Rate)")
        else:
            print(f"  🔴 VERDICT: Crypto engine is LAGGING (Win Rate < 40%)")
            print(f"     → Consider tuning V20 Fusion weights or Dip Buying thresholds")
    else:
        print(f"  ⚪ No trades were taken (all signals were HOLD or data was insufficient)")

    print(f"{'#'*70}")


# ═══════════════════════════════════════════════════════════════════════════
# CLI Entry Point
# ═══════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='₿ Crypto Blind Backtesting Engine — اختبر العقل على الكريبتو 24/7 (MASS-SCALE)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
أمثلة:
  # اختبر كل العملات المتاحة (الافتراضي — MASS-SCALE)
  python3 scripts/crypto_blind_backtester.py

  # صريح: كل العملات
  python3 scripts/crypto_blind_backtester.py --all

  # نافذة أطول
  python3 scripts/crypto_blind_backtester.py --days 120 --forward-days 30

  # عملات محددة
  python3 scripts/crypto_blind_backtester.py --coins bitcoin,ethereum,solana

  # أقصى 20 عملة
  python3 scripts/crypto_blind_backtester.py --max-coins 20

  # إخراج JSON
  python3 scripts/crypto_blind_backtester.py --json
        """
    )
    parser.add_argument('--coins', type=str, default=None,
                        help='قائمة CoinGecko coin_ids مفصولة بفواصل '
                             '(default: كل العملات المتاحة)')
    parser.add_argument('--all', action='store_true',
                        help='اختبر كل العملات المتاحة (MASS-SCALE) — هذا الافتراضي')
    parser.add_argument('--max-coins', type=int, default=50,
                        help='أقصى عدد عملات للاختبار (default: 50)')
    parser.add_argument('--days', type=int, default=90,
                        help='إجمالي أيام التاريخ (default: 90)')
    parser.add_argument('--forward-days', type=int, default=30,
                        help='أيام المستقبل للتقييم (default: 30)')
    parser.add_argument('--json', action='store_true', help='إخراج JSON بدلاً من نص')

    args = parser.parse_args()

    # Mass-scale: لو --coins محدد، استخدمه. وإلا، اكتشف كل العملات.
    if args.coins:
        coin_ids = [c.strip() for c in args.coins.split(',') if c.strip()]
        # خريطة symbol ديناميكية من الـ scheduler
        try:
            from jobs.crypto_lab_scheduler import get_crypto_lab_coins
            coins_map = get_crypto_lab_coins(max_coins=100)
        except Exception:
            coins_map = {}
        # لو الـ coin_id في الخريطة، استخدم الـ symbol بتاعه. وإلا upper.
        coin_symbol_pairs = [(cid, coins_map.get(cid) or cid.upper()[:4])
                             for cid in coin_ids]
    else:
        # MASS-SCALE: اكتشف كل العملات المتاحة
        print("\n₿ MASS-SCALE MODE — discovering all available coins...")
        coin_symbol_pairs = discover_all_coins(max_coins=args.max_coins)
        if not coin_symbol_pairs:
            print("❌ لم يتم العثور على عملات. جرّب --coins bitcoin,ethereum")
            return

    print(f"\n₿ CRYPTO BLIND BACKTESTING ENGINE (MASS-SCALE)")
    print(f"   Coins to test: {len(coin_symbol_pairs)}")
    if len(coin_symbol_pairs) <= 15:
        for cid, sym in coin_symbol_pairs:
            print(f"     • {sym:8} ({cid})")
    else:
        for cid, sym in coin_symbol_pairs[:10]:
            print(f"     • {sym:8} ({cid})")
        print(f"     ... و {len(coin_symbol_pairs) - 10} عملة أخرى")
    print(f"   Total history: {args.days} days")
    print(f"   Forward window: {args.forward_days} days (the 'future' to evaluate)")
    print(f"   Engine: FusionEngineV20 + SMC (same as Live Lab)")

    # Run backtests
    results = []
    for coin_id, symbol in coin_symbol_pairs:
        print(f"\n🔄 Fetching + analyzing {symbol} ({coin_id})...")
        result = run_crypto_backtest(coin_id, symbol, total_days=args.days,
                                     forward_days=args.forward_days)
        results.append(result)
        if not args.json:
            print_single_report(result)

    if args.json:
        print(json.dumps(results, indent=2, default=str))
    else:
        print_batch_summary(results)

    # Save results to file
    report_path = PROJECT_ROOT / 'db' / f'crypto_backtest_report_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'total_days': args.days,
            'forward_days': args.forward_days,
            'coins_tested': len(coin_symbol_pairs),
            'coin_symbol_pairs': [{'coin_id': cid, 'symbol': sym} for cid, sym in coin_symbol_pairs],
            'results': results,
        }, f, indent=2, default=str, ensure_ascii=False)
    print(f"\n💾 Report saved to: {report_path}")


if __name__ == '__main__':
    main()
