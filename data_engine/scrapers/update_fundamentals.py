"""
update_fundamentals.py — تحديث الأساسيات المالية من TradingView REST
================================================================================

المشكلة: tab_valuation + tab_profitability لم تُحدّث منذ أسابيع
  (EGXPilot ميت HTTP 404، tradingview_scraper.py Playwright يـ CREATE فقط)

الحل: جلب P/E, ROE, EPS من TradingView REST scanner (نفس مصدر الأسعار)
  + حفظ في data_engine.db.tab_valuation + tab_profitability

الاستخدام:
  cd ~/my_apps/GLMinvestment
  .venv/bin/python -m data_engine.scrapers.update_fundamentals

Cron (أسبوعي):
  0 14 * * 6 cd /root/GLMinvestment && .venv/bin/python -m data_engine.scrapers.update_fundamentals >> logs/fundamentals.log 2>&1
================================================================================
"""

import urllib.request
import json
import sqlite3
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / 'db' / 'data_engine.db'

# TradingView scanner (نفس tradingview_rest.py)
TV_URL = 'https://scanner.tradingview.com/egypt/scan'
# columns تشمل الأساسيات
TV_COLUMNS = [
    'name', 'description', 'close',
    'market_cap_basic',  # Market Cap
    'price_earnings',    # P/E
    'price_book_fq',     # P/B
    'earnings_per_share_basic',  # EPS
    'return_on_equity',  # ROE
    'return_on_assets',  # ROA
    'dividend_yield_recent',  # Dividend Yield
    'sector',
    'industry',
]


def log(msg, level='INFO'):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] {level}: {msg}")


def fetch_fundamentals_from_tv() -> list:
    """جلب الأساسيات من TradingView scanner"""
    try:
        body = {
            'range': [0, 500],
            'columns': TV_COLUMNS,
            'sort': {'sortBy': 'name', 'sortOrder': 'asc'},
            'markets': ['egypt'],
        }
        payload = json.dumps(body).encode('utf-8')
        req = urllib.request.Request(
            TV_URL, data=payload,
            headers={
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
                'Content-Type': 'application/json',
            },
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())

        rows = []
        if isinstance(data, dict):
            rows = data.get('data', []) or []
        elif isinstance(data, list):
            rows = data

        if not rows:
            log("  ❌ TradingView رجع 0 نتائج", 'ERROR')
            return []

        # columns = ['name', 'description', 'close', 'market_cap_basic', 'price_earnings',
        #            'price_book_fq', 'earnings_per_share_basic', 'return_on_equity',
        #            'return_on_assets', 'dividend_yield_recent', 'sector', 'industry']
        # d[0]=name, d[1]=description, d[2]=close, d[3]=market_cap, d[4]=pe, d[5]=pb,
        # d[6]=eps, d[7]=roe, d[8]=roa, d[9]=div_yield, d[10]=sector, d[11]=industry
        results = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            symbol = row.get('s', '').replace('EGX:', '').strip()
            d = row.get('d', [])
            if not isinstance(d, list) or len(d) < 8:
                continue
            if not symbol:
                continue

            results.append({
                'ticker': symbol,
                'name': d[1] if len(d) > 1 else '',
                'market_cap': float(d[3]) if d[3] and isinstance(d[3], (int, float)) else None,
                'pe_ratio': float(d[4]) if d[4] and isinstance(d[4], (int, float)) else None,
                'pb_ratio': float(d[5]) if d[5] and isinstance(d[5], (int, float)) else None,
                'eps': float(d[6]) if d[6] and isinstance(d[6], (int, float)) else None,
                'roe': float(d[7]) if d[7] and isinstance(d[7], (int, float)) else None,
                'roa': float(d[8]) if d[8] and isinstance(d[8], (int, float)) else None,
                'dividend_yield': float(d[9]) if d[9] and isinstance(d[9], (int, float)) else None,
                'sector': d[10] if len(d) > 10 and d[10] else '',
                'industry': d[11] if len(d) > 11 and d[11] else '',
            })

        return results
    except Exception as e:
        log(f"  ❌ خطأ: {e}", 'ERROR')
        return []


def save_to_db(fundamentals: list) -> int:
    """حفظ الأساسيات في tab_valuation + tab_profitability.

    DATA-ENGINE-UNIFY-1 Stage 2a: fix 2 bugs.
    Bug 1 (critical): `now_iso` was undefined → NameError swallowed by
    `except: pass` → INSERT never executed → tab_* stayed stale while
    `saved += 1` lied. Now `now_iso` is defined at function entry.
    Bug 2 (data loss): `INSERT OR REPLACE` with only 5 columns would wipe
    the rich columns (market_cap_perf, peg_ratio, ps_ratio, pcf_ratio,
    pfcf_ratio, pcash_ratio, ev, ev_revenue, ev_ebit, ev_ebitda, data)
    that the TradingView Arabic scraper populated. Switched to
    `ON CONFLICT(symbol) DO UPDATE SET` — only touches the 4 TV columns.
    Bug 3 (anti-pattern): `except: pass` violated Rule (no silent failures).
    Replaced with logged warnings.
    """
    if not fundamentals:
        return 0

    now_iso = datetime.now().isoformat()

    try:
        conn = sqlite3.connect(str(DB_PATH), timeout=30.0)
        cur = conn.cursor()

        # auto-migration: تأكد من وجود الجداول بالـ schema المرن
        # tab_valuation قد تستخدم ticker أو symbol كـ PK
        cur.execute('''CREATE TABLE IF NOT EXISTS tab_valuation (
            ticker TEXT PRIMARY KEY,
            pe_ratio REAL, pb_ratio REAL, ps_ratio REAL,
            market_cap REAL, last_updated TEXT
        )''')
        cur.execute('''CREATE TABLE IF NOT EXISTS tab_profitability (
            ticker TEXT PRIMARY KEY,
            roe REAL, roa REAL, eps REAL,
            dividend_yield REAL, last_updated TEXT
        )''')

        # UNIFY-FIX: لو الجدول موجود بـ schema قديم (symbol بدل ticker)
        # نستخدم symbol كـ PK. نكتشف العمود الفعلي
        try:
            val_cols = [row[1] for row in cur.execute("PRAGMA table_info(tab_valuation)").fetchall()]
            val_pk = 'ticker' if 'ticker' in val_cols else ('symbol' if 'symbol' in val_cols else 'ticker')
        except Exception:
            val_pk = 'ticker'
        try:
            prof_cols = [row[1] for row in cur.execute("PRAGMA table_info(tab_profitability)").fetchall()]
            prof_pk = 'ticker' if 'ticker' in prof_cols else ('symbol' if 'symbol' in prof_cols else 'ticker')
        except Exception:
            prof_pk = 'ticker'

        saved = 0
        skipped = 0

        for f in fundamentals:
            ticker = f['ticker']

            # tab_valuation — استخدم val_pk (ticker أو symbol حسب الـ schema الموجود)
            # DATA-ENGINE-UNIFY-1 Stage 2a: ON CONFLICT DO UPDATE (مش INSERT OR REPLACE)
            # عشان ما نـ wipeش الـ rich columns (market_cap_perf, peg_ratio, ...).
            # بس لازم نتأكد إن فيه UNIQUE/PK على val_pk — لو لأ، نـ fallback لـ UPDATE.
            try:
                cur.execute(f'''
                    INSERT INTO tab_valuation
                    ({val_pk}, pe_ratio, pb_ratio, market_cap, last_updated)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT({val_pk}) DO UPDATE SET
                        pe_ratio = COALESCE(excluded.pe_ratio, tab_valuation.pe_ratio),
                        pb_ratio = COALESCE(excluded.pb_ratio, tab_valuation.pb_ratio),
                        market_cap = COALESCE(excluded.market_cap, tab_valuation.market_cap),
                        last_updated = excluded.last_updated
                ''', (ticker, f.get('pe_ratio'), f.get('pb_ratio'),
                      f.get('market_cap'), now_iso))
                saved += 1
            except sqlite3.OperationalError as e:
                # لو مفيش UNIQUE/PK → نـ fallback لـ UPDATE الموجود
                if 'no column' in str(e).lower() or 'unique' in str(e).lower() or 'constraint' in str(e).lower():
                    try:
                        cur.execute(f'''
                            UPDATE tab_valuation SET
                                pe_ratio = COALESCE(?, pe_ratio),
                                pb_ratio = COALESCE(?, pb_ratio),
                                market_cap = COALESCE(?, market_cap),
                                last_updated = ?
                            WHERE {val_pk} = ?
                        ''', (f.get('pe_ratio'), f.get('pb_ratio'),
                              f.get('market_cap'), now_iso, ticker))
                        if cur.rowcount > 0:
                            saved += 1
                        else:
                            skipped += 1
                    except Exception as e2:
                        log(f"  ⚠️ tab_valuation UPDATE فشل لـ {ticker}: {e2}", 'WARN')
                        skipped += 1
                else:
                    log(f"  ⚠️ tab_valuation INSERT فشل لـ {ticker}: {e}", 'WARN')
                    skipped += 1

            # tab_profitability
            try:
                cur.execute(f'''
                    INSERT INTO tab_profitability
                    ({prof_pk}, roe, roa, eps, dividend_yield, last_updated)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT({prof_pk}) DO UPDATE SET
                        roe = COALESCE(excluded.roe, tab_profitability.roe),
                        roa = COALESCE(excluded.roa, tab_profitability.roa),
                        eps = COALESCE(excluded.eps, tab_profitability.eps),
                        dividend_yield = COALESCE(excluded.dividend_yield, tab_profitability.dividend_yield),
                        last_updated = excluded.last_updated
                ''', (ticker, f.get('roe'), f.get('roa'), f.get('eps'),
                      f.get('dividend_yield'), now_iso))
            except sqlite3.OperationalError as e:
                if 'no column' in str(e).lower() or 'unique' in str(e).lower() or 'constraint' in str(e).lower():
                    try:
                        cur.execute(f'''
                            UPDATE tab_profitability SET
                                roe = COALESCE(?, roe),
                                roa = COALESCE(?, roa),
                                eps = COALESCE(?, eps),
                                dividend_yield = COALESCE(?, dividend_yield),
                                last_updated = ?
                            WHERE {prof_pk} = ?
                        ''', (f.get('roe'), f.get('roa'), f.get('eps'),
                              f.get('dividend_yield'), now_iso, ticker))
                    except Exception as e2:
                        log(f"  ⚠️ tab_profitability UPDATE فشل لـ {ticker}: {e2}", 'WARN')
                else:
                    log(f"  ⚠️ tab_profitability INSERT فشل لـ {ticker}: {e}", 'WARN')

        conn.commit()
        conn.close()

        # إحصاء القيم الحقيقية
        has_pe = sum(1 for f in fundamentals if f.get('pe_ratio') is not None)
        has_roe = sum(1 for f in fundamentals if f.get('roe') is not None)
        log(f"  📊 P/E متاح: {has_pe}/{len(fundamentals)}")
        log(f"  📊 ROE متاح: {has_roe}/{len(fundamentals)}")
        if skipped:
            log(f"  ⚠️ skipped: {skipped}")

        return saved
    except Exception as e:
        log(f"  ❌ حفظ: {e}", 'ERROR')
        return 0


if __name__ == '__main__':
    log("=" * 60)
    log("📊 تحديث الأساسيات المالية من TradingView REST")
    log("=" * 60)

    log("  جلب الأساسيات من TradingView scanner...")
    fundamentals = fetch_fundamentals_from_tv()
    log(f"  تم جلب {len(fundamentals)} سهم")

    if fundamentals:
        saved = save_to_db(fundamentals)
        log(f"  ✅ تم حفظ {saved} سهم في tab_valuation + tab_profitability")
    else:
        log("  ⚠️ لا توجد بيانات أساسية")

    log("=" * 60)
    log("✅ اكتمل")
