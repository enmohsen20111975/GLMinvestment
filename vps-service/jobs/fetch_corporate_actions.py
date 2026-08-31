#!/usr/bin/env python3
"""
fetch_corporate_actions.py — جلب توزيعات الأرباح + أخبار الاكتتاب + الجمعيات العمومية
=================================================================================
يجمع 3 أنواع من Corporate Actions:
  1. توزيعات الأرباح (Dividends) — من data_engine.db.tab_dividends (موجود)
  2. أخبار الاكتتاب (IPO) — من DuckDuckGo
  3. الجمعيات العمومية (General Assembly) — من DuckDuckGo

يخزنها في predictions.db.corporate_actions table.

التشغيل:
  python3 vps-service/jobs/fetch_corporate_actions.py
"""
import os
import sys
import json
import sqlite3
import logging
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

PREDICTIONS_DB = str(PROJECT_ROOT / "db" / "predictions.db")
DATA_ENGINE_DB = str(PROJECT_ROOT / "db" / "data_engine.db")

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)


def init_corporate_actions_table():
    """أنشئ جدول corporate_actions لو مش موجود."""
    conn = sqlite3.connect(PREDICTIONS_DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS corporate_actions (
            id TEXT PRIMARY KEY,
            ticker TEXT,
            action_type TEXT,
            action_date TEXT,
            details TEXT,
            source TEXT,
            created_at TEXT
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ca_ticker ON corporate_actions(ticker)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ca_type ON corporate_actions(action_type)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ca_date ON corporate_actions(action_date)")
    conn.commit()
    conn.close()


def fetch_dividends():
    """اجلب توزيعات الأرباح من data_engine.db.tab_dividends."""
    if not os.path.exists(DATA_ENGINE_DB):
        logger.warning("data_engine.db مش موجود")
        return 0

    conn_de = sqlite3.connect(DATA_ENGINE_DB)
    # فحص الـ schema
    cols = [c[1] for c in conn_de.execute("PRAGMA table_info(tab_dividends)").fetchall()]
    if not cols:
        logger.warning("tab_dividends مش موجود في data_engine.db")
        conn_de.close()
        return 0

    logger.info(f"tab_dividends columns: {cols}")

    # اقرأ كل التوزيعات
    rows = conn_de.execute("SELECT * FROM tab_dividends").fetchall()
    col_names = cols
    conn_de.close()

    # خزن في corporate_actions
    conn_pred = sqlite3.connect(PREDICTIONS_DB)
    count = 0
    for row in rows:
        row_dict = dict(zip(col_names, row))
        ticker = row_dict.get('symbol', row_dict.get('ticker', ''))
        if not ticker:
            continue

        # ex-div date
        ex_div_date = row_dict.get('ex_dividend_date', row_dict.get('date', row_dict.get('ex_date', '')))
        amount = row_dict.get('dividend_amount', row_dict.get('amount', 0))
        currency = row_dict.get('currency', 'EGP')

        if not ex_div_date:
            continue

        ca_id = f"div_{ticker}_{ex_div_date}"
        details = json.dumps({
            'amount': float(amount) if amount else 0,
            'currency': currency,
            'ex_div_date': str(ex_div_date)[:10],
            'raw': {k: str(v) for k, v in row_dict.items() if v is not None}
        }, ensure_ascii=False)

        try:
            conn_pred.execute("""
                INSERT OR REPLACE INTO corporate_actions
                (id, ticker, action_type, action_date, details, source, created_at)
                VALUES (?, ?, 'dividend', ?, ?, 'data_engine', ?)
            """, (ca_id, ticker, str(ex_div_date)[:10], details, datetime.now().isoformat()))
            count += 1
        except Exception as e:
            logger.debug(f"خطأ في تخزين dividend {ticker}: {e}")

    conn_pred.commit()
    conn_pred.close()
    logger.info(f"✅ توزيعات الأرباح: {count} سجل")
    return count


def fetch_ipo_news():
    """اجلب أخبار الاكتتاب من DuckDuckGo."""
    try:
        from ddgs import DDGS
    except ImportError:
        logger.warning("ddgs مش موجود — تخطي أخبار الاكتتاب")
        return 0

    conn_pred = sqlite3.connect(PREDICTIONS_DB)
    count = 0

    queries = [
        "EGX IPO Egypt stock listing 2026",
        "البورصة المصرية اكتتاب جديد 2026",
        "EGX new listing Egypt",
    ]

    for query in queries:
        try:
            with DDGS() as ddgs:
                results = list(ddgs.news(query, max_results=5))
                for r in results:
                    title = r.get('title', '')
                    url = r.get('url', '') or r.get('link', '')
                    date = r.get('date', '')
                    source_name = r.get('source', '')

                    ca_id = f"ipo_{hash(url) if url else hash(title)}"
                    details = json.dumps({
                        'title': title,
                        'url': url,
                        'date': date,
                        'source': source_name,
                    }, ensure_ascii=False)

                    try:
                        conn_pred.execute("""
                            INSERT OR REPLACE INTO corporate_actions
                            (id, ticker, action_type, action_date, details, source, created_at)
                            VALUES (?, 'EGX_GENERAL', 'ipo', ?, ?, 'duckduckgo', ?)
                        """, (ca_id, str(date)[:10] if date else datetime.now().strftime('%Y-%m-%d'),
                              details, datetime.now().isoformat()))
                        count += 1
                    except Exception:
                        pass
        except Exception as e:
            logger.warning(f"بحث DuckDuckGo فشل لـ '{query}': {e}")

    conn_pred.commit()
    conn_pred.close()
    logger.info(f"✅ أخبار الاكتتاب: {count} سجل")
    return count


def fetch_assembly_news():
    """اجلب أخبار الجمعيات العمومية من DuckDuckGo."""
    try:
        from ddgs import DDGS
    except ImportError:
        logger.warning("ddgs مش موجود — تخطي الجمعيات العمومية")
        return 0

    conn_pred = sqlite3.connect(PREDICTIONS_DB)
    count = 0

    queries = [
        "EGX Egypt general assembly meeting stock 2026",
        "البورصة المصرية جمعية عمومية 2026",
        "EGX Egypt shareholder meeting dividend",
    ]

    for query in queries:
        try:
            with DDGS() as ddgs:
                results = list(ddgs.news(query, max_results=5))
                for r in results:
                    title = r.get('title', '')
                    url = r.get('url', '') or r.get('link', '')
                    date = r.get('date', '')
                    source_name = r.get('source', '')

                    ca_id = f"asm_{hash(url) if url else hash(title)}"
                    details = json.dumps({
                        'title': title,
                        'url': url,
                        'date': date,
                        'source': source_name,
                    }, ensure_ascii=False)

                    try:
                        conn_pred.execute("""
                            INSERT OR REPLACE INTO corporate_actions
                            (id, ticker, action_type, action_date, details, source, created_at)
                            VALUES (?, 'EGX_GENERAL', 'assembly', ?, ?, 'duckduckgo', ?)
                        """, (ca_id, str(date)[:10] if date else datetime.now().strftime('%Y-%m-%d'),
                              details, datetime.now().isoformat()))
                        count += 1
                    except Exception:
                        pass
        except Exception as e:
            logger.warning(f"بحث DuckDuckGo فشل لـ '{query}': {e}")

    conn_pred.commit()
    conn_pred.close()
    logger.info(f"✅ الجمعيات العمومية: {count} سجل")
    return count


def get_upcoming_actions(ticker: str, days_ahead: int = 7) -> list:
    """ارجع Corporate Actions قادمة لسهم معين."""
    conn = sqlite3.connect(PREDICTIONS_DB)
    today = datetime.now().strftime('%Y-%m-%d')
    future = (datetime.now() + timedelta(days=days_ahead)).strftime('%Y-%m-%d')

    rows = conn.execute("""
        SELECT action_type, action_date, details
        FROM corporate_actions
        WHERE ticker = ? AND action_date >= ? AND action_date <= ?
        ORDER BY action_date
    """, (ticker, today, future)).fetchall()
    conn.close()

    actions = []
    for r in rows:
        try:
            details = json.loads(r[2]) if r[2] else {}
        except:
            details = {}
        actions.append({
            'type': r[0],
            'date': r[1],
            'details': details,
        })
    return actions


def main():
    print("╔" + "═"*70 + "╗")
    print("║   جلب Corporate Actions — توزيعات + اكتتاب + جمعيات        ║")
    print("╚" + "═"*70 + "╝\n")

    init_corporate_actions_table()

    print("── 1. توزيعات الأرباح (Dividends) ──")
    div_count = fetch_dividends()

    print("\n── 2. أخبار الاكتتاب (IPO) ──")
    ipo_count = fetch_ipo_news()

    print("\n── 3. الجمعيات العمومية (General Assembly) ──")
    asm_count = fetch_assembly_news()

    # ملخص
    conn = sqlite3.connect(PREDICTIONS_DB)
    total = conn.execute("SELECT COUNT(*) FROM corporate_actions").fetchone()[0]
    by_type = conn.execute("""
        SELECT action_type, COUNT(*) FROM corporate_actions GROUP BY action_type
    """).fetchall()
    conn.close()

    print(f"\n═══ ملخص ═══")
    print(f"  إجمالي Corporate Actions: {total}")
    for t, c in by_type:
        print(f"  {t}: {c}")

    # اختبار: upcoming actions لـ COMI
    print(f"\n── اختبار: COMI upcoming actions (7 أيام) ──")
    actions = get_upcoming_actions('COMI', 7)
    if actions:
        for a in actions:
            print(f"  {a['type']} on {a['date']}: {a['details'].get('amount', a['details'].get('title', ''))}")
    else:
        print("  (لا توجد actions قادمة)")


if __name__ == '__main__':
    main()
