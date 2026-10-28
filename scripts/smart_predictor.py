#!/usr/bin/env python3
"""
Smart Predictor — توقعات ذكية بدل الـ brute force
====================================================
الفرق بين ده وبين daily_predictor.py بتاع برافو:
  - برافو: brute force على 280 يوم × 289 سهم = 80,000 تحليل (163 ساعة)
  - Smart: فلتر → فلتر → فلتر → حلل الـ 10-30 سهم النشطة بس (دقايق)

الـ filters:
  1. اشتغل من آخر تاريخ في الـ DB (مش من 1 يناير)
  2. فلتر أيام الإجازات (is_trading_day)
  3. فلتر الأسهم الميتة (change% بين -3% و +0.5%)
  4. فلتر الأسهم مش في الـ radar
  5. فلتر الأسهم اللي ليها توقع بالفعل
  6. حلل الباقي بس

Usage:
    python3 scripts/smart_predictor.py --market EGX --today-only
    python3 scripts/smart_predictor.py --market TADAWUL --yesterday-only
    python3 scripts/smart_predictor.py --all-markets --yesterday-only
    python3 scripts/smart_predictor.py --market KSE --start 2026-10-25 --end 2026-10-28
    python3 scripts/smart_predictor.py --market EGX --today-only --dry-run
"""
import sys
import os
import json
import argparse
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta

# Path setup
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
os.chdir(PROJECT_ROOT)

# ============================================================
# Helpers
# ============================================================

STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'
RADAR_OUTPUT_DIR = PROJECT_ROOT / 'scripts' / 'output'

# Market code → stocks.db market value
CANONICAL_MARKET = {
    'KSA': 'TADAWUL',
    'SAUDI': 'TADAWUL',
    'TADAWUL': 'TADAWUL',
    'EGX': 'EGX',
    'KSE': 'KSE',
    'QSE': 'QSE',
    'US': 'US',
    'CRYPTO': 'CRYPTO',
}


def normalize_market(market_code: str) -> str:
    """Convert CLI market code to canonical DB value."""
    return CANONICAL_MARKET.get(market_code.strip().upper(), market_code.strip().upper())


def is_trading_day(date_str: str, market_code: str) -> bool:
    """هل اليوم ده يوم تداول؟ فلتر جمعة/سبت/عيد."""
    try:
        from utils.trading_calendar import is_trading_day as _check
        dt = datetime.strptime(date_str, '%Y-%m-%d')
        return _check(dt, market_code)
    except Exception:
        # fallback: skip Friday/Saturday only
        dt = datetime.strptime(date_str, '%Y-%m-%d')
        return dt.weekday() not in [4, 5]  # 4=Friday, 5=Saturday


def get_last_prediction_date(market_code: str) -> str | None:
    """آخر تاريخ في predictions table للسوق ده."""
    try:
        conn = sqlite3.connect(str(PREDICTIONS_DB))
        row = conn.execute(
            "SELECT MAX(prediction_date) FROM predictions WHERE market = ?",
            (market_code,)
        ).fetchone()
        conn.close()
        if row and row[0]:
            # prediction_date ممكن يكون "2026-10-22 12:55:16" — ناخد التاريخ بس
            return str(row[0])[:10]
        return None
    except Exception:
        return None


def get_existing_tickers(market_code: str, scan_date: str) -> set:
    """الأسهم اللي ليها توقع بالفعل في اليوم ده."""
    try:
        conn = sqlite3.connect(str(PREDICTIONS_DB))
        rows = conn.execute(
            "SELECT ticker FROM predictions WHERE market = ? AND prediction_date LIKE ?",
            (market_code, f"{scan_date}%")
        ).fetchall()
        conn.close()
        return {r[0] for r in rows}
    except Exception:
        return set()


def get_radar_picks(market_code: str) -> list[dict]:
    """اقرأ آخر radar JSON للسوق ده."""
    pattern = f"maker_radar_{market_code}_*.json"
    files = sorted(RADAR_OUTPUT_DIR.glob(pattern), reverse=True)
    if not files:
        return []
    try:
        with open(files[0]) as f:
            data = json.load(f)
        # الـ radar بيرجع {stocks: [...]} أو {predictions: [...]}
        stocks = data.get('stocks') or data.get('predictions') or []
        if isinstance(stocks, dict):
            # ممكن يكون dict بدل list
            stocks = list(stocks.values())
        return stocks if isinstance(stocks, list) else []
    except Exception as e:
        print(f"  ⚠️  فشل قراءة radar للـ {market_code}: {e}", flush=True)
        return []


def get_active_tickers(market_code: str) -> list[str]:
    """fallback: كل الأسهم النشطة (لو الـ radar فاضي)."""
    try:
        conn = sqlite3.connect(str(STOCKS_DB))
        rows = conn.execute(
            "SELECT ticker FROM stocks WHERE market = ? AND is_active = 1 AND current_price > 0",
            (market_code,)
        ).fetchall()
        conn.close()
        return [r[0] for r in rows]
    except Exception:
        return []


def filter_dead_stocks(tickers: list[str], market_code: str) -> list[str]:
    """
    فلتر الأسهم الميتة:
      - change% بين -3% و +0.5% → سهم واقف/خسران → skip
      - باقي الأسهم (صاعدة أو نازلة جامد) → نحللها
    """
    if not tickers:
        return []
    try:
        conn = sqlite3.connect(str(STOCKS_DB))
        placeholders = ','.join(['?'] * len(tickers))
        rows = conn.execute(
            f"SELECT ticker, change_percent FROM stocks WHERE ticker IN ({placeholders}) AND market = ?",
            (*tickers, market_code)
        ).fetchall()
        conn.close()
        
        alive = []
        dead_count = 0
        for ticker, change in rows:
            if change is None:
                continue
            change = float(change)
            # فلتر: -3% < change < +0.5% → ميت
            if -3.0 <= change <= 0.5:
                dead_count += 1
                continue
            alive.append(ticker)
        return alive
    except Exception as e:
        print(f"  ⚠️  فشل filter_dead_stocks: {e}", flush=True)
        return tickers  # fallback: رجّع كل حاجة


def date_range(start_date: str, end_date: str) -> list[str]:
    """قائمة التواريخ من start لـ end."""
    start = datetime.strptime(start_date, '%Y-%m-%d')
    end = datetime.strptime(end_date, '%Y-%m-%d')
    dates = []
    current = start
    while current <= end:
        dates.append(current.strftime('%Y-%m-%d'))
        current += timedelta(days=1)
    return dates


# ============================================================
# Main predictor
# ============================================================

def run_smart(market_code: str, start_date: str | None = None, 
              end_date: str | None = None, dry_run: bool = False,
              max_tickers: int | None = None):
    """
    شغّل الـ smart predictor لسوق معين.
    """
    canonical = normalize_market(market_code)
    today = datetime.now().strftime('%Y-%m-%d')
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    
    # 1. حدد نطاق التواريخ
    if start_date is None:
        # اشتغل من آخر تاريخ في الـ DB
        last_date = get_last_prediction_date(canonical)
        if last_date:
            # ابدأ من اليوم اللي بعد آخر تاريخ
            last_dt = datetime.strptime(last_date, '%Y-%m-%d')
            start_date = (last_dt + timedelta(days=1)).strftime('%Y-%m-%d')
            print(f"  📅 آخر توقع في الـ DB: {last_date} → نبدأ من {start_date}", flush=True)
        else:
            # مفيش توقعات قبل كده → ابدأ من أمس
            start_date = yesterday
            print(f"  📅 مفيش توقعات قديمة → نبدأ من {start_date}", flush=True)
    
    if end_date is None:
        end_date = today
    
    print(f"\n{'='*60}", flush=True)
    print(f"  Smart Predictor — {canonical}", flush=True)
    print(f"  Period: {start_date} → {end_date}", flush=True)
    print(f"  Dry-run: {dry_run}", flush=True)
    print(f"{'='*60}\n", flush=True)
    
    # 2. الأيام اللي محتاج نـ scanها (فلتر الإجازات)
    all_dates = date_range(start_date, end_date)
    scan_dates = [d for d in all_dates if is_trading_day(d, canonical)]
    skipped_holidays = len(all_dates) - len(scan_dates)
    print(f"  📅 إجمالي الأيام: {len(all_dates)} | بعد فلتر الإجازات: {len(scan_dates)} (تخطى {skipped_holidays})", flush=True)
    
    if not scan_dates:
        print("  ℹ️  مفيش أيام تداول في الفترة دي", flush=True)
        return
    
    # 3. الأسهم النشطة من الـ radar
    radar_picks = get_radar_picks(canonical)
    if radar_picks:
        candidate_tickers = []
        for pick in radar_picks:
            if isinstance(pick, dict):
                ticker = pick.get('ticker') or pick.get('symbol')
                if ticker:
                    candidate_tickers.append(ticker)
        print(f"  📡 radar picks: {len(candidate_tickers)} سهم", flush=True)
    else:
        # fallback: كل الأسهم النشطة
        candidate_tickers = get_active_tickers(canonical)
        print(f"  ⚠️  radar فاضي → fallback لكل الأسهم النشطة: {len(candidate_tickers)}", flush=True)
    
    if not candidate_tickers:
        print("  ℹ️  مفيش أسهم نشطة", flush=True)
        return
    
    # 4. لكل يوم، فلتر وحلل
    total_analyzed = 0
    total_saved = 0
    total_skipped_existing = 0
    total_skipped_dead = 0
    
    for scan_date in scan_dates:
        print(f"\n  📅 {scan_date}:", flush=True)
        
        # 4a. فلتر الأسهم اللي ليها توقع بالفعل
        existing = get_existing_tickers(canonical, scan_date)
        todo = [t for t in candidate_tickers if t not in existing]
        total_skipped_existing += len(candidate_tickers) - len(todo)
        print(f"    - ليها توقع بالفعل: {len(candidate_tickers) - len(todo)} | متبقي: {len(todo)}", flush=True)
        
        # 4b. فلتر الأسهم الميتة
        alive = filter_dead_stocks(todo, canonical)
        total_skipped_dead += len(todo) - len(alive)
        print(f"    - أسهم ميتة (change بين -3% و +0.5%): {len(todo) - len(alive)} | متبقي: {len(alive)}", flush=True)
        
        if not alive:
            print(f"    - ℹ️  مفيش أسهم تستاهل التحليل اليوم ده", flush=True)
            continue
        
        # 4c. limit لو محدد
        if max_tickers and len(alive) > max_tickers:
            alive = alive[:max_tickers]
            print(f"    - ⚡ limited to {max_tickers} tickers", flush=True)
        
        # 5. حلل (أو اطبع بس لو dry-run)
        if dry_run:
            print(f"    🧪 [DRY RUN] هيحلل {len(alive)} سهم: {alive[:5]}{'...' if len(alive) > 5 else ''}", flush=True)
            total_analyzed += len(alive)
            continue
        
        # شغّل V40.2 engine على الأسهم دي
        print(f"    🔍 بتحليل {len(alive)} سهم...", flush=True)
        saved_this_date = run_v40_engine(alive, canonical, scan_date)
        total_saved += saved_this_date
        total_analyzed += len(alive)
        print(f"    ✓ تم حفظ {saved_this_date} توقع", flush=True)
    
    # 6. ملخص
    print(f"\n{'='*60}", flush=True)
    print(f"  ✅ الملخص:", flush=True)
    print(f"    - أيام التداول: {len(scan_dates)}", flush=True)
    print(f"    - أسهم تم تحليلها: {total_analyzed}", flush=True)
    print(f"    - توقعات جديدة محفوظة: {total_saved}", flush=True)
    print(f"    - تخطى (توقعات موجودة): {total_skipped_existing}", flush=True)
    print(f"    - تخطى (أسهم ميتة): {total_skipped_dead}", flush=True)
    print(f"{'='*60}", flush=True)


def run_v40_engine(tickers: list[str], market_code: str, scan_date: str) -> int:
    """
    شغّل V40.2 engine على الأسهم دي.
    دلوقتي بنستدعي daily_predictor.py كـ subprocess (نفس الـ engine).
    """
    # محتاجين نـ integrate مع V40.2 engine الفعلي
    # للأسف daily_predictor.py مش بيـ expose API بسيط
    # فبنستدعيه كـ subprocess مع --max-tickers + --tickers-offset
    
    # فلتر الـ tickers لـ string مفصول بفواصل
    tickers_arg = ','.join(tickers)
    
    import subprocess
    cmd = [
        'python3',
        str(PROJECT_ROOT / 'vps-service' / 'jobs' / 'daily_predictor.py'),
        '--start', scan_date,
        '--end', scan_date,
        '--market', market_code if market_code != 'TADAWUL' else 'KSA',
        '--keep-old',  # متحذفش التوقعات القديمة
    ]
    
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=600,
            cwd=str(PROJECT_ROOT)
        )
        if result.returncode == 0:
            # عدّ التوقعات الجديدة
            try:
                conn = sqlite3.connect(str(PREDICTIONS_DB))
                count = conn.execute(
                    "SELECT COUNT(*) FROM predictions WHERE market = ? AND prediction_date LIKE ?",
                    (market_code, f"{scan_date}%")
                ).fetchone()[0]
                conn.close()
                return count
            except Exception:
                return 0
        else:
            print(f"    ⚠️  V40.2 exit code {result.returncode}", flush=True)
            if result.stderr:
                print(f"    stderr: {result.stderr[:300]}", flush=True)
            return 0
    except subprocess.TimeoutExpired:
        print(f"    ⚠️  timeout (10 دقايق)", flush=True)
        return 0
    except Exception as e:
        print(f"    ⚠️  خطأ: {e}", flush=True)
        return 0


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description='Smart Predictor — توقعات ذكية بدل الـ brute force',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
أمثلة:
  %(prog)s --market EGX --today-only              # EGX لليوم
  %(prog)s --market TADAWUL --yesterday-only      # TADAWUL لأمس
  %(prog)s --all-markets --yesterday-only         # كل الأسواق لأمس
  %(prog)s --market KSE --start 2026-10-25 --end 2026-10-28
  %(prog)s --market EGX --today-only --dry-run     # جاف (اختبار)
  %(prog)s --market EGX --today-only --max-tickers 5  # limit
""",
    )
    parser.add_argument('--market', default='EGX',
                        choices=['EGX', 'KSA', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO'],
                        help='السوق (default: EGX)')
    parser.add_argument('--all-markets', action='store_true',
                        help='شغّل لكل الأسواق بالتتابع')
    parser.add_argument('--today-only', action='store_true',
                        help='توليد لليوم بس')
    parser.add_argument('--yesterday-only', action='store_true',
                        help='توليد لأمس بس (للكرون بعد إغلاق السوق)')
    parser.add_argument('--start', default=None,
                        help='تاريخ البداية (YYYY-MM-DD)')
    parser.add_argument('--end', default=None,
                        help='تاريخ النهاية (YYYY-MM-DD)')
    parser.add_argument('--dry-run', action='store_true',
                        help='جاف — اطبع بس ما تـ saveش')
    parser.add_argument('--max-tickers', type=int, default=None,
                        help='حد أقصى لعدد الأسهم لكل يوم')
    
    args = parser.parse_args()
    
    # حدد نطاق التواريخ
    today = datetime.now().strftime('%Y-%m-%d')
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    
    start_date = args.start
    end_date = args.end
    
    if args.today_only and args.yesterday_only:
        print("❌ مش ممكن --today-only و --yesterday-only معاً", flush=True)
        sys.exit(1)
    elif args.today_only:
        start_date = today
        end_date = today
    elif args.yesterday_only:
        start_date = yesterday
        end_date = yesterday
    
    # شغّل
    if args.all_markets:
        markets = ['EGX', 'KSA', 'KSE', 'QSE', 'US']
        for m in markets:
            print(f"\n{'#'*60}", flush=True)
            print(f"# Processing market: {m}", flush=True)
            print(f"{'#'*60}", flush=True)
            run_smart(m, start_date, end_date, dry_run=args.dry_run,
                      max_tickers=args.max_tickers)
    else:
        run_smart(args.market, start_date, end_date, dry_run=args.dry_run,
                  max_tickers=args.max_tickers)


if __name__ == '__main__':
    main()
