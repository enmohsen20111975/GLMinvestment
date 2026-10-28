#!/usr/bin/env python3
"""
new_daily_predictor.py — التوقعات بالـ V3 المنسق/المنفذ
============================================================
بيلغي V40.2 القديم (الـ brute force) ويستخدم النظام الذكي:
  - orchestrator_v3: بيخطط مسار التحليل حسب حالة السوق
  - executor_v3: بينفذ الخطة بـ المحركات الصغيرة المتخصصة

الـ filters (من الـ smart mode):
  1. ابدأ من آخر تاريخ في الـ DB
  2. فلتر أيام الإجازات
  3. فلتر الأسهم الميتة
  4. فلتر التوقعات اللي لسه valid

Usage:
    python3 vps-service/jobs/new_daily_predictor.py --market EGX --today-only
    python3 vps-service/jobs/new_daily_predictor.py --market TADAWUL --yesterday-only
    python3 vps-service/jobs/new_daily_predictor.py --all-markets --yesterday-only
    python3 vps-service/jobs/new_daily_predictor.py --market EGX --today-only --dry-run
"""
import sys
import os
import json
import argparse
import sqlite3
import logging
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
os.chdir(PROJECT_ROOT)

# ============================================================
# Logging — سجل مفصل لكل حاجة بتحصل
# ============================================================
LOG_DIR = PROJECT_ROOT / 'logs'
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / f'v3_predictor_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log'

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    handlers=[
        logging.FileHandler(str(LOG_FILE), encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ]
)
logger = logging.getLogger(__name__)
logger.info(f'=' * 60)
logger.info(f'V3 Smart Predictor started — log file: {LOG_FILE}')
logger.info(f'=' * 60)

# ============================================================
# Smart Filters (من الـ smart logic اللي اتدمج قبل كده)
# ============================================================

CANONICAL_MARKET = {
    'KSA': 'TADAWUL', 'SAUDI': 'TADAWUL', 'TADAWUL': 'TADAWUL',
    'EGX': 'EGX', 'KSE': 'KSE', 'QSE': 'QSE', 'US': 'US', 'CRYPTO': 'CRYPTO',
}

STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'


def normalize_market(market_code: str) -> str:
    return CANONICAL_MARKET.get(market_code.strip().upper(), market_code.strip().upper())


def is_trading_day(date_str: str, market_code: str) -> bool:
    try:
        from utils.trading_calendar import is_trading_day as _check
        dt = datetime.strptime(date_str, '%Y-%m-%d')
        return _check(dt, market_code)
    except Exception:
        dt = datetime.strptime(date_str, '%Y-%m-%d')
        return dt.weekday() not in [4, 5]


def get_last_prediction_date(market_code: str) -> str | None:
    """آخر تاريخ في predictions table عبر DAL."""
    try:
        from core.db_manager import get_last_prediction_date as dal_last_date
        return dal_last_date(market_code)
    except Exception:
        return None


def get_active_tickers(market_code: str) -> list[str]:
    """كل الأسهم النشطة في السوق عبر DAL."""
    try:
        from core.db_manager import get_active_tickers as dal_active
        return dal_active(market_code)
    except Exception:
        return []


def filter_dead_stocks(tickers: list[str], market_code: str) -> tuple[list[str], int]:
    """فلتر الأسهم الميتة عبر DAL.
    
    فلترين:
      1. change% بين -3% و +0.5% (سهم واقف/خسران النهاردة)
      2. الأسعار التاريخية flat (نفس السعر كل الأيام = ميت تاريخياً)
    """
    if not tickers:
        return [], 0
    try:
        from core.db_manager import db_manager, get_price_history
        placeholders = ','.join(['?'] * len(tickers))
        rows = db_manager.query('stocks',
            f"SELECT ticker, change_percent FROM stocks WHERE ticker IN ({placeholders}) AND market = ?",
            (*tickers, market_code)
        )
        alive = []
        dead_count = 0
        for r in rows:
            change = r.get('change_percent')
            if change is None:
                continue
            change = float(change)
            if -3.0 <= change <= 0.5:
                dead_count += 1
                continue
            # فلتر 2: اتأكد إن الأسعار التاريخية مش flat
            prices, _ = get_price_history(r['ticker'], market_code, 30)
            if prices and len(set(prices)) <= 2:
                dead_count += 1
                continue
            alive.append(r['ticker'])
        return alive, dead_count
    except Exception:
        return tickers, 0


def filter_stale_predictions(tickers: list[str], market_code: str, scan_date: str) -> tuple[list[str], int]:
    """skip لو فيه توقع نشط + السعر ما تغيرش >1% عبر DAL."""
    if not tickers:
        return [], 0
    try:
        from core.db_manager import db_manager
        # الأسهم اللي ليها توقعات نشطة في اليوم ده
        existing_rows = db_manager.query('predictions',
            """SELECT ticker, entry_price FROM predictions 
               WHERE market = ? AND prediction_date LIKE ? 
               AND (outcome_date IS NULL OR exit_type IS NULL)""",
            (market_code, f"{scan_date}%")
        )
        # الأسعار الحالية
        placeholders = ','.join(['?'] * len(tickers))
        stock_rows = db_manager.query('stocks',
            f"SELECT ticker, current_price FROM stocks WHERE ticker IN ({placeholders}) AND market = ?",
            (*tickers, market_code)
        )
        current_prices = {r['ticker']: r['current_price'] for r in stock_rows if r.get('current_price')}
        existing_map = {r['ticker']: r['entry_price'] for r in existing_rows}
        to_reanalyze = []
        skipped_count = 0
        for ticker in tickers:
            if ticker not in existing_map:
                to_reanalyze.append(ticker)
                continue
            entry_price = existing_map[ticker]
            current_price = current_prices.get(ticker)
            if entry_price and current_price and entry_price > 0:
                change_pct = abs((current_price - entry_price) / entry_price * 100)
                if change_pct < 1.0:
                    skipped_count += 1
                    continue
            to_reanalyze.append(ticker)
        return to_reanalyze, skipped_count
    except Exception:
        return tickers, 0


def get_price_history(ticker: str, market_code: str, days: int = 60) -> tuple[list[float], list[float]]:
    """
    جيب آخر N يوم من الأسعار والأحجام.
    بتستخدم الـ DAL الموحد (db_manager.get_price_history) اللي بيقرا من:
      1. data_engine.db.egksco_price_history (EGX رسمي)
      2. data_engine.db.historical_data (كل الأسواق)
      3. stocks.db.stock_daily_prices (fallback)
    """
    try:
        from core.db_manager import get_price_history as dal_get_prices
        prices, volumes = dal_get_prices(ticker, market_code, days)
        return prices, volumes
    except Exception:
        return [], []


# ============================================================
# V3 Engine Runner
# ============================================================

def analyze_with_v3(ticker: str, market_code: str, prices: list[float], volumes: list[float]) -> dict:
    """
    حلل سهم بـ النظام الذكي V3 (orchestrator + executor).
    """
    logger.info(f'--- {ticker} ({market_code}) — V3 Analysis Start ---')
    logger.info(f'  input: {len(prices)} prices, {len(volumes)} volumes')
    if prices:
        logger.info(f'  price range: {min(prices):.2f} → {max(prices):.2f} (current={prices[-1]:.2f})')
    
    try:
        from core.orchestrator_v3 import create_v3_plan
        from core.executor_v3 import execute_v3
        
        # 1. المنسّق: يخطط التحليل
        logger.info(f'  [orchestrator] creating plan...')
        plan = create_v3_plan(
            ticker=ticker,
            prices=prices,
            volumes=volumes,
            market=market_code,
            fund_available=True,
            event_available=False,
        )
        logger.info(f'  [orchestrator] state_code={plan.state_code} | market_regime={plan.market_regime} | stock_regime={plan.stock_regime}')
        logger.info(f'  [orchestrator] selected_engines={plan.selected_engines}')
        logger.info(f'  [orchestrator] execution_order={plan.execution_order}')
        logger.info(f'  [orchestrator] normalized_weights={plan.normalized_weights}')
        logger.info(f'  [orchestrator] decision_policy={plan.decision_policy}')
        if plan.no_trade_reason:
            logger.info(f'  [orchestrator] no_trade_reason={plan.no_trade_reason}')
        
        # Gate: لو no_trade من البداية
        if plan.decision_policy == 'no_trade':
            logger.warning(f'  {ticker}: NO_TRADE (orchestrator) — {plan.no_trade_reason}')
            return {
                'ticker': ticker,
                'signal': 'NO_TRADE',
                'reason': plan.no_trade_reason,
                'state': plan.state_code,
                'complete': False,
            }
        
        # 2. المنفّذ: ينفذ الخطة
        logger.info(f'  [executor] executing plan (id={plan.plan_id[:8]})...')
        result = execute_v3(plan, prices=prices, volumes=volumes, ticker=ticker, market=market_code)
        
        logger.info(f'  [executor] complete={result.complete}')
        logger.info(f'  [executor] final_signal={result.final_signal}')
        logger.info(f'  [executor] signal_score={result.signal_score}')
        logger.info(f'  [executor] confidence={result.confidence}')
        logger.info(f'  [executor] position_size={result.position_size_pct}%')
        logger.info(f'  [executor] engine_scores={result.engine_scores}')
        logger.info(f'  [executor] engine_signals={result.engine_signals}')
        if result.warnings:
            logger.warning(f'  [executor] warnings={result.warnings[:5]}')
        if result.errors:
            logger.error(f'  [executor] errors={result.errors[:5]}')
        if result.no_trade_reason:
            logger.info(f'  [executor] no_trade_reason={result.no_trade_reason}')
        
        return {
            'ticker': ticker,
            'signal': result.final_signal,
            'confidence': result.confidence,
            'score': result.signal_score,
            'state': plan.state_code,
            'market_regime': plan.market_regime,
            'engines_ran': list(result.engine_scores.keys()),
            'risk_profile': result.risk_profile,
            'position_size': result.position_size_pct,
            'warnings': result.warnings[:3] if isinstance(result.warnings, list) else [],
            'errors': result.errors[:3] if isinstance(result.errors, list) else [],
            'complete': result.complete,
            'no_trade_reason': result.no_trade_reason,
        }
    except Exception as e:
        logger.error(f'  {ticker}: EXCEPTION — {e}', exc_info=True)
        return {
            'ticker': ticker,
            'signal': 'ERROR',
            'reason': str(e)[:200],
            'complete': False,
        }


def save_prediction(result: dict, market_code: str, scan_date: str) -> bool:
    """احفظ التوقع في predictions.db عبر DAL."""
    if result.get('signal') not in ['BUY', 'STRONG_BUY', 'SELL', 'STRONG_SELL']:
        logger.info(f'  {result["ticker"]}: save skipped (signal={result.get("signal")})')
        return False
    
    try:
        from core.db_manager import db_manager
        logger.info(f'  {result["ticker"]}: saving prediction (signal={result.get("signal")}, score={result.get("score",0):.1f})...')
        
        # خد السعر الحالي عبر DAL
        price_row = db_manager.query_one('stocks',
            "SELECT current_price FROM stocks WHERE ticker = ? AND market = ?",
            (result['ticker'], market_code)
        )
        
        entry_price = float(price_row['current_price']) if price_row and price_row.get('current_price') else 0
        confidence = result.get('confidence', 0)
        score = result.get('score', 0)
        
        # احسب target/stop بسيط
        signal = result['signal']
        if 'BUY' in signal:
            target_price = entry_price * 1.05 if entry_price > 0 else 0
            stop_loss = entry_price * 0.97 if entry_price > 0 else 0
        else:
            target_price = entry_price * 0.95 if entry_price > 0 else 0
            stop_loss = entry_price * 1.03 if entry_price > 0 else 0
        
        db_manager.execute('predictions', """
            INSERT INTO predictions (ticker, market, signal, signal_type, 
                                    prediction_date, entry_price, target_price, stop_loss,
                                    master_score, confidence, persona, status, created_at, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        """, (
            result['ticker'], market_code, signal, signal,
            scan_date, entry_price, target_price, stop_loss,
            score, confidence, 'v3_smart', datetime.now().isoformat(),
            f"state={result.get('state','?')} regime={result.get('market_regime','?')} engines={result.get('engines_ran',[])}"
        ))
        logger.info(f'  {result["ticker"]}: ✓ saved to predictions.db')
        return True
    except Exception as e:
        logger.error(f'  {result["ticker"]}: ✗ save failed — {e}', exc_info=True)
        return False


# ============================================================
# Main Runner
# ============================================================

def run(market_code: str, start_date: str | None = None, end_date: str | None = None,
        dry_run: bool = False, max_tickers: int | None = None):
    """شغّل الـ V3 predictor لسوق معين."""
    canonical = normalize_market(market_code)
    today = datetime.now().strftime('%Y-%m-%d')
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    
    # 1. حدد نطاق التواريخ
    if start_date is None:
        last_date = get_last_prediction_date(canonical)
        if last_date:
            last_dt = datetime.strptime(last_date, '%Y-%m-%d')
            start_date = (last_dt + timedelta(days=1)).strftime('%Y-%m-%d')
            print(f"  📅 آخر توقع: {last_date} → نبدأ من {start_date}", flush=True)
        else:
            start_date = yesterday
            print(f"  📅 مفيش توقعات قديمة → نبدأ من {start_date}", flush=True)
    if end_date is None:
        end_date = today
    
    print(f"\n{'='*60}", flush=True)
    print(f"  V3 Smart Predictor — {canonical}", flush=True)
    print(f"  Period: {start_date} → {end_date}", flush=True)
    print(f"  Dry-run: {dry_run}", flush=True)
    print(f"{'='*60}\n", flush=True)
    
    # 2. فلتر أيام الإجازات
    start_dt = datetime.strptime(start_date, '%Y-%m-%d')
    end_dt = datetime.strptime(end_date, '%Y-%m-%d')
    all_dates = []
    current = start_dt
    while current <= end_dt:
        all_dates.append(current.strftime('%Y-%m-%d'))
        current += timedelta(days=1)
    
    scan_dates = [d for d in all_dates if is_trading_day(d, canonical)]
    print(f"  📅 إجمالي: {len(all_dates)} | بعد فلتر الإجازات: {len(scan_dates)}", flush=True)
    
    if not scan_dates:
        print("  ℹ️  مفيش أيام تداول", flush=True)
        return
    
    # 3. الأسهم المرشحة
    candidate_tickers = get_active_tickers(canonical)
    if not candidate_tickers:
        print("  ℹ️  مفيش أسهم نشطة", flush=True)
        return
    print(f"  📊 أسهم نشطة: {len(candidate_tickers)}", flush=True)
    
    # 4. لكل يوم، فلتر وحلل
    total_analyzed = 0
    total_saved = 0
    total_skipped_stale = 0
    total_skipped_dead = 0
    total_no_trade = 0
    total_errors = 0
    
    for scan_date in scan_dates:
        print(f"\n  📅 {scan_date}:", flush=True)
        
        # 4a. فلتر التوقعات اللي لسه valid
        todo, skipped_stale = filter_stale_predictions(candidate_tickers, canonical, scan_date)
        total_skipped_stale += skipped_stale
        
        # 4b. فلتر الأسهم الميتة
        alive, dead_count = filter_dead_stocks(todo, canonical)
        total_skipped_dead += dead_count
        print(f"    - after filters: {len(alive)} (skip stale={skipped_stale}, dead={dead_count})", flush=True)
        
        if not alive:
            print(f"    ℹ️  مفيش أسهم تستاهل", flush=True)
            continue
        
        # 4c. limit
        if max_tickers and len(alive) > max_tickers:
            alive = alive[:max_tickers]
        
        # 5. حلل بـ V3
        for ticker in alive:
            prices, volumes = get_price_history(ticker, canonical)
            if len(prices) < 50:
                continue  # V3 محتاج 50+ يوم
            
            result = analyze_with_v3(ticker, canonical, prices, volumes)
            total_analyzed += 1
            
            signal = result.get('signal', 'NO_TRADE')
            state = result.get('state', '?')
            
            if signal == 'NO_TRADE':
                total_no_trade += 1
                print(f"    {ticker}: NO_TRADE (state={state}, reason={result.get('no_trade_reason','?')[:50]})", flush=True)
            elif signal == 'ERROR':
                total_errors += 1
                print(f"    {ticker}: ERROR — {result.get('reason','?')[:80]}", flush=True)
            else:
                # BUY / SELL
                logger.info(f'  {ticker}: {signal} ✓ (state={state}, score={result.get("score",0):.1f}, conf={result.get("confidence",0):.1f})')
                if not dry_run:
                    saved = save_prediction(result, canonical, scan_date)
                    if saved:
                        total_saved += 1
                print(f"    {ticker}: {signal} ✓ (state={state}, score={result.get('score',0):.1f}, conf={result.get('confidence',0):.1f})", flush=True)
    
    # 6. ملخص
    summary = {
        'market': canonical,
        'scan_dates_count': len(scan_dates),
        'total_analyzed': total_analyzed,
        'total_saved': total_saved,
        'total_no_trade': total_no_trade,
        'total_errors': total_errors,
        'skipped_stale': total_skipped_stale,
        'skipped_dead': total_skipped_dead,
        'timestamp': datetime.now().isoformat(),
    }
    print(f"\n{'='*60}", flush=True)
    print(f"  ✅ الملخص — {canonical}", flush=True)
    print(f"    - أيام التداول: {len(scan_dates)}", flush=True)
    print(f"    - أسهم تحللت: {total_analyzed}", flush=True)
    print(f"    - توقعات محفوظة: {total_saved}", flush=True)
    print(f"    - NO_TRADE: {total_no_trade}", flush=True)
    print(f"    - errors: {total_errors}", flush=True)
    print(f"    - تخطى (stale): {total_skipped_stale}", flush=True)
    print(f"    - تخطى (dead): {total_skipped_dead}", flush=True)
    print(f"{'='*60}", flush=True)
    
    # سجل الملخص في الـ log file
    logger.info(f'=' * 60)
    logger.info(f'SUMMARY — {canonical}')
    for k, v in summary.items():
        logger.info(f'  {k}: {v}')
    logger.info(f'=' * 60)
    logger.info(f'Log file saved to: {LOG_FILE}')
    
    # احفظ الملخص في ملف JSON كمان
    summary_file = LOG_DIR / f'v3_summary_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    with open(summary_file, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    logger.info(f'Summary JSON saved to: {summary_file}')


def main():
    parser = argparse.ArgumentParser(description='V3 Smart Predictor — التوقعات بالـ orchestrator/executor')
    parser.add_argument('--market', default='EGX', choices=['EGX','KSA','TADAWUL','KSE','QSE','US'])
    parser.add_argument('--all-markets', action='store_true')
    parser.add_argument('--today-only', action='store_true')
    parser.add_argument('--yesterday-only', action='store_true')
    parser.add_argument('--start', default=None)
    parser.add_argument('--end', default=None)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--max-tickers', type=int, default=None)
    args = parser.parse_args()
    
    today = datetime.now().strftime('%Y-%m-%d')
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    
    start_date = args.start
    end_date = args.end
    if args.today_only:
        start_date = end_date = today
    elif args.yesterday_only:
        start_date = end_date = yesterday
    
    if args.all_markets:
        for m in ['EGX','KSA','KSE','QSE']:
            print(f"\n{'#'*60}\n# {m}\n{'#'*60}", flush=True)
            run(m, start_date, end_date, args.dry_run, args.max_tickers)
    else:
        run(args.market, start_date, end_date, args.dry_run, args.max_tickers)


if __name__ == '__main__':
    main()
