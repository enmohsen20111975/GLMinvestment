#!/usr/bin/env python3
"""
EGX Fundamental Fetcher — من EGXPilot (مجاني، مش EODHD)
=========================================================
يجيب البيانات الأساسية لأسهم EGX من EGXPilot API.

المصادر:
1. /api/stocks/all — كل الأسهم + أسعار + EPS + P/E
2. /api/stockanalysis/<ticker> — تحليل AI + RSI + MACD + entry/stop/target
3. /api/golden-stocks-v2/ — فرص ذهبية pre-breakout
4. egx_official_sectors.py — القطاعات الرسمية (18 قطاع)

EGXPilot مجاني ومشترك فيه أصلاً — مش محتاج EODHD.

Usage:
    from data.egx_fundamental_fetcher import EGXFundamentalFetcher
    fetcher = EGXFundamentalFetcher()
    fund = fetcher.get_fundamentals('COMI')
    fetcher.fetch_all_egx_fundamentals(limit=0)
"""

import os
import re
import sys
import sqlite3
import json
import time
import logging
import requests
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Add parent paths
_VPS_DIR = Path(__file__).resolve().parent.parent
if str(_VPS_DIR) not in sys.path:
    sys.path.insert(0, str(_VPS_DIR))

_PROJECT_ROOT = _VPS_DIR.parent
# FETCHER-FIX (2026-08-17): env override so sandbox tests against db/vps_real/data_engine.db
# without touching production. Default = production path (db/data_engine.db).
DATA_ENGINE_DB = os.environ.get('EGX_DATA_ENGINE_DB', str(_PROJECT_ROOT / 'db' / 'data_engine.db'))

logger = logging.getLogger(__name__)

# ─── Column-shift defense (FETCHER-FIX 2026-08-17) ───────────────────────────
# The 8 shifted rows in tab_balance_sheet/income_statement/cash_flow had
# symbol = Arabic market name ('السعودية') + market = fiscal_period ('2026-Q1').
# Root cause: a scraper leaked the market name into the symbol column for
# stocks whose ticker extraction failed (numeric/Saudi codes).
# This guard rejects that bug class at the fetcher level — a market name,
# fiscal-period pattern, index symbol, or empty string can NEVER be written
# as a ticker into egx_fundamentals (or tab_* if ever extended).
MARKET_NAMES = ('السعودية', 'مصر', 'الكويت', 'قطر', 'امارات', 'البحرين', 'عمان')
_FP_RE = re.compile(r'^\d{4}-(Q[1-4]|H[1-2]|FY)$')  # fiscal_period pattern: 2026-Q1

# EGXPilot API endpoints (مجاني)
EGXPILOT_API = 'https://egxpilot.com/api/stocks/all'
EGXPILOT_AI_ANALYSIS_API = 'https://egxpilot.com/api/stockanalysis/'
EGXPILOT_V2_ST_API = 'https://egxpilot.com/api/v2/st/'
EGXPILOT_GOLDEN_STOCKS_API = 'https://egxpilot.com/api/golden-stocks-v2/'
REQUEST_TIMEOUT = 30

# Import EGX data
try:
    from data.egx_official_sectors import STOCK_SECTORS, EGX_OFFICIAL_SECTORS
    # STOCK_SECTORS mapped by Arabic name, need ticker mapping
except ImportError:
    STOCK_SECTORS = {}
    EGX_OFFICIAL_SECTORS = {}

try:
    from data.egx_ticker_sector_map import TICKER_SECTOR_MAP
except ImportError:
    TICKER_SECTOR_MAP = {}

try:
    from data.egx_stocks_complete import EGX_STOCKS
except ImportError:
    EGX_STOCKS = {}


class EGXFundamentalFetcher:
    """يجيب fundamentals لأسهم EGX.

    FIX (2026-10-05 — Rule 54): EGXPilot ميت (HTTP 404). دلوقتي بـ يقرأ من
    tab_profitability + tab_valuation في data_engine.db (بيانات حقيقية متخزنة).
    لو البيانات مش متوفرة في الـ DB، بـ يرجّع None (مش placeholder).

    مصادر البيانات البديلة:
    1. tab_profitability (ROE, ROA, margins) — 82 سهم EGX عندهم ROE حقيقي
    2. tab_valuation (P/E, P/B, P/S) — من EGKSCO/TradingView
    3. stocks.db.stocks (price, volume, sector) — live data
    4. EGX_STOCKS (EPS values) — hardcoded EPS from EGX official
    """

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({'User-Agent': 'GLMinvestment/1.0'})
        # Rule 54: data_engine.db هو canonical للأساسيات
        self._db_path = str(Path(__file__).resolve().parents[2] / 'db' / 'data_engine.db')
        self._stocks_db = str(Path(__file__).resolve().parents[2] / 'db' / 'stocks.db')

    # ─── Column-shift guard (FETCHER-FIX 2026-08-17) ──────────────────────
    @staticmethod
    def _is_valid_ticker(symbol) -> bool:
        """Reject values that must never be stored as a ticker.

        Blocks the column-shift bug class: a market name, fiscal-period
        pattern, index symbol, or empty string leaking into the symbol/ticker
        column. Returns True only for real tradeable tickers (e.g. 'COMI',
        '1010', 'SWDY').
        """
        if not symbol or not isinstance(symbol, str):
            return False
        s = symbol.strip()
        if not s:
            return False
        if s in MARKET_NAMES:                  # Arabic market name leaked
            return False
        if _FP_RE.match(s):                     # fiscal_period leaked (2026-Q1)
            return False
        su = s.upper()
        if su.startswith('.') or su.startswith('EGX'):  # index (.EGX30, EGX30)
            return False
        return True

    def _safe_get(self, url: str, timeout: int = REQUEST_TIMEOUT):
        """طلب آمن."""
        try:
            return self.session.get(url, timeout=timeout)
        except Exception as e:
            logger.error(f"Request error: {e}")
            return None

    def _parse_volume(self, value) -> int:
        """Parse volume strings like '1.44 M'."""
        if value is None:
            return 0
        if isinstance(value, (int, float)):
            return int(value)
        s = str(value).strip().upper().replace('\u202f', '').replace(' ', '')
        multipliers = {'K': 1_000, 'M': 1_000_000, 'B': 1_000_000_000}
        for suffix, mult in multipliers.items():
            if s.endswith(suffix):
                try:
                    return int(float(s[:-1]) * mult)
                except ValueError:
                    return 0
        try:
            return int(float(s))
        except (ValueError, TypeError):
            return 0

    # ─── Get Fundamentals for One Stock ──────────────────────────────────

    def get_fundamentals(self, ticker: str) -> Optional[Dict]:
        """يجيب fundamentals لسهم واحد من tab_profitability + tab_valuation + stocks.db.

        FIX (2026-10-05): EGXPilot ميت — بـ يقرأ من الـ DBs الحقيقية بدلاً منه.
        لو البيانات مش متوفرة → بيرجّع None (مش placeholder).
        """
        ticker = (ticker or '').upper().strip()
        if not self._is_valid_ticker(ticker):
            logger.warning(f"Reject invalid ticker (column-shift guard): {ticker!r}")
            return None

        # 1. اقرأ من tab_profitability + tab_valuation في data_engine.db
        import sqlite3 as _sqlite3
        try:
            # Phase 7.1: migrated
            from core.db_manager import db_manager
            conn = db_manager.connection(self._db_path, writable=False).__enter__()
            conn.row_factory = _sqlite3.Row
            cur = conn.cursor()
            # tab_profitability: ROE, ROA, margins
            cur.execute('SELECT * FROM tab_profitability WHERE symbol = ? AND market = "مصر"', (ticker,))
            prof_row = cur.fetchone()
            # tab_valuation: P/E, P/B, P/S
            cur.execute('SELECT * FROM tab_valuation WHERE symbol = ? AND market = "مصر"', (ticker,))
            val_row = cur.fetchone()
            conn.close()
        except Exception:
            prof_row = None
            val_row = None

        # 2. اقرأ من stocks.db (price, volume, sector)
        try:
            # Phase 7.1: migrated
            from core.db_manager import db_manager
            conn2 = db_manager.connection(self._stocks_db, writable=False).__enter__()
            conn2.row_factory = _sqlite3.Row
            cur2 = conn2.cursor()
            cur2.execute('SELECT current_price, change_percent, volume, sector, name, name_ar, market_cap FROM stocks WHERE ticker = ?', (ticker,))
            stock_row = cur2.fetchone()
            conn2.close()
        except Exception:
            stock_row = None

        # 3. EPS from EGX_STOCKS (if available)
        eps = None
        try:
            from data.egx_fetcher import EPS_VALUES
            eps = EPS_VALUES.get(ticker)
        except ImportError:
            pass

        # 4. بناء الـ fundamentals dict من البيانات الحقيقية
        price = float(stock_row['current_price']) if stock_row and stock_row['current_price'] else 0
        change = float(stock_row['change_percent']) if stock_row and stock_row['change_percent'] else 0
        volume = float(stock_row['volume']) if stock_row and stock_row['volume'] else 0
        sector = stock_row['sector'] if stock_row else (TICKER_SECTOR_MAP.get(ticker, '') or '')
        name = stock_row['name_ar'] if stock_row and stock_row['name_ar'] else (stock_row['name'] if stock_row else '')
        market_cap = float(stock_row['market_cap']) if stock_row and stock_row['market_cap'] else None

        # Parse ROE/ROA from tab_profitability (stored as strings like "15.60%")
        roe = self._parse_pct(prof_row['roe']) if prof_row else None
        roa = self._parse_pct(prof_row['roa']) if prof_row else None
        net_margin = self._parse_pct(prof_row['net_margin']) if prof_row else None

        # P/E, P/B from tab_valuation
        pe_ratio = None
        pb_ratio = None
        ps_ratio = None
        if val_row:
            pe_ratio = self._parse_num(val_row['pe_ratio'])
            pb_ratio = self._parse_num(val_row['pb_ratio'])
            ps_ratio = self._parse_num(val_row['ps_ratio'])

        # Rule 27: لو مفيش بيانات حقيقية → None (مش placeholder)
        if price == 0 and roe is None and pe_ratio is None:
            return None  # لا توجد بيانات حقيقية لهذا السهم

        fundamentals = {
            'ticker': ticker,
            'market': 'EGX',
            'name': name,
            'sector': sector,
            'industry': sector,
            'currency': 'EGP',
            'current_price': price,
            'change_percent': round(change, 2) if change else 0,
            'volume': volume,
            'pe_ratio': pe_ratio,
            'eps': eps,
            'pb_ratio': pb_ratio,
            'market_cap': market_cap,
            'roe': roe,
            'roa': roa,
            'net_margin': net_margin,
            'fundamental_score': self._calc_fund_score({
                'pe_ratio': pe_ratio,
                'roe': roe,
                'eps': eps,
            }),
        }
        return fundamentals

    @staticmethod
    def _parse_pct(val) -> Optional[float]:
        """حوّل '15.60%' → 15.60. لو NULL/فاضي → None."""
        if not val or val == '—' or val == '-':
            return None
        try:
            s = str(val).replace('%', '').replace(',', '').strip()
            if s.startswith('−') or s.startswith('-'):
                s = '-' + s[1:]
            return float(s)
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _parse_num(val) -> Optional[float]:
        """حوّل نص لرقم. لو NULL/فاضي → None."""
        if not val or val == '—' or val == '-':
            return None
        try:
            return float(str(val).replace(',', '').strip())
        except (ValueError, TypeError):
            return None

    def _fetch_all_stocks(self) -> Optional[List[Dict]]:
        """يجيب كل أسهم EGX من EGXPilot."""
        response = self._safe_get(self.api_url)
        if response and response.status_code == 200:
            data = response.json()
            stocks = data if isinstance(data, list) else data.get('stocks', data.get('data', []))
            if isinstance(stocks, list):
                return stocks
        return None

    def _fetch_ai_analysis(self, ticker: str) -> Optional[Dict]:
        """يجيب تحليل AI لسهم من EGXPilot."""
        response = self._safe_get(f"{self.ai_url}{ticker}")
        if not response or response.status_code != 200:
            return None

        try:
            data = response.json()
            short_term = data.get('shortTerm', {}) or {}
            trading_scenario = data.get('tradingScenario', {}) or {}
            risk = data.get('risk', {}) or {}
            indicators = data.get('indicators', {}) or {}

            return {
                'rsi': indicators.get('rsi'),
                'macd': indicators.get('macd', {}).get('histogram') if isinstance(indicators.get('macd'), dict) else None,
                'recommendation': short_term.get('signal', ''),
                'confidence': short_term.get('confidence', 0),
                'ai_summary': short_term.get('arabicLabel', data.get('bias', {}).get('label', '')),
                'entry': trading_scenario.get('entryZone', [0, 0]),
                'stop_loss': risk.get('stopLoss'),
                'targets': risk.get('targets', {}),
                'smart_money': data.get('regime', {}).get('label', ''),
            }
        except Exception as e:
            logger.error(f"AI analysis parse error for {ticker}: {e}")
            return None

    def _calc_fund_score(self, f: Dict) -> float:
        """يحسب fundamental score من 0-100.

        EGXPilot بيوفر P/E + EPS بس (مش ROE/Margins).
        بس بنحسب score من اللي متاح + AI recommendation.
        """
        score = 50  # baseline

        # Valuation (30 points)
        pe = f.get('pe_ratio')
        if pe:
            if pe < 10: score += 18
            elif pe < 15: score += 12
            elif pe < 25: score += 6
            elif pe > 50: score -= 12

        # AI Recommendation (20 points)
        rec = f.get('recommendation', '').lower() if f.get('recommendation') else ''
        if 'strong_buy' in rec or 'buy' in rec:
            score += 12
        elif 'sell' in rec or 'strong_sell' in rec:
            score -= 12
        elif 'neutral' in rec or 'hold' in rec:
            score += 2

        # RSI (15 points) — oversold = فرصة
        rsi = f.get('rsi')
        if rsi:
            if 30 <= rsi <= 45:  # oversold لكن مش falling knife
                score += 10
            elif 45 <= rsi <= 60:  # neutral
                score += 5
            elif rsi > 80:  # overbought
                score -= 8

        # Confidence (15 points)
        conf = f.get('confidence')
        if conf:
            if conf > 80:
                score += 10
            elif conf > 60:
                score += 6
            elif conf < 30:
                score -= 5

        # Smart Money (10 points)
        sm = f.get('smart_money', '').lower() if f.get('smart_money') else ''
        if 'accumulation' in sm or 'buy' in sm:
            score += 8
        elif 'distribution' in sm or 'sell' in sm:
            score -= 5

        # Volume (10 points)
        vol = f.get('volume', 0)
        if vol and vol > 1_000_000:  # سيولة عالية
            score += 5
        elif vol and vol < 10_000:  # سيولة ميتة
            score -= 8

        return round(max(0, min(100, score)), 1)

    # ─── Bulk Fetch ──────────────────────────────────────────────────────

    def fetch_all_egx_fundamentals(self, limit: int = 0, fetch_ai: bool = False) -> Dict:
        """يجيب fundamentals لكل أسهم EGX ويخزنها في data_engine.db.

        Args:
            limit: 0 = كل الأسهم، N = أول N سهم
            fetch_ai: هل نجيب AI analysis لكل سهم؟ (أبطأ بس أعمق)

        Returns:
            {success, total, fetched, stored, errors}
        """
        # جلب كل الأسهم من EGXPilot
        all_stocks = self._fetch_all_stocks()
        if not all_stocks:
            return {'success': False, 'error': 'EGXPilot مش متاح', 'fetched': 0}

        if limit > 0:
            all_stocks = all_stocks[:limit]

        # إنشاء/تأكيد table
        # Phase 7.1: migrated to db_manager (writable=True)
        from core.db_manager import db_manager
        conn = db_manager.connection(DATA_ENGINE_DB, writable=True).__enter__()
        conn.execute('''
            CREATE TABLE IF NOT EXISTS egx_fundamentals (
                ticker TEXT PRIMARY KEY,
                name TEXT,
                sector TEXT,
                industry TEXT,
                pe_ratio REAL,
                eps REAL,
                pb_ratio REAL,
                roe REAL,
                net_margin REAL,
                debt_to_equity REAL,
                dividend_yield REAL,
                market_cap REAL,
                current_price REAL,
                change_percent REAL,
                volume REAL,
                rsi REAL,
                macd REAL,
                recommendation TEXT,
                ai_summary TEXT,
                smart_money TEXT,
                confidence REAL,
                entry TEXT,
                stop_loss REAL,
                targets TEXT,
                fundamental_score REAL,
                raw_data TEXT,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        ''')
        conn.commit()

        fetched = 0
        stored = 0
        errors = []

        skipped_invalid = 0
        for stock in all_stocks:
            ticker = (stock.get('Symbol') or '').upper().strip()
            # FETCHER-FIX: guard rejects market names / fiscal periods / indices
            # so they can never be written as a ticker into egx_fundamentals.
            if not self._is_valid_ticker(ticker):
                skipped_invalid += 1
                continue

            try:
                fund = self.get_fundamentals(ticker)
                if fund:
                    fetched += 1
                    conn.execute('''
                        INSERT OR REPLACE INTO egx_fundamentals
                            (ticker, name, sector, industry, pe_ratio, eps,
                             current_price, change_percent, volume,
                             rsi, macd, recommendation, ai_summary,
                             smart_money, confidence, entry, stop_loss,
                             targets, market_cap, fundamental_score, raw_data, updated_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
                    ''', (
                        fund['ticker'], fund['name'], fund['sector'], fund['industry'],
                        fund.get('pe_ratio'), fund.get('eps'),
                        fund.get('current_price'), fund.get('change_percent'),
                        fund.get('volume'),
                        fund.get('rsi'), fund.get('macd'),
                        fund.get('recommendation'), fund.get('ai_summary'),
                        fund.get('smart_money'), fund.get('confidence'),
                        json.dumps(fund.get('entry')) if fund.get('entry') else None,
                        fund.get('stop_loss'),
                        json.dumps(fund.get('targets')) if fund.get('targets') else None,
                        fund.get('market_cap'),
                        fund['fundamental_score'],
                        json.dumps(fund),
                    ))
                    conn.commit()
                    stored += 1

                    # لو fetch_ai=True، ننتظر شوية عشان rate limit
                    if fetch_ai:
                        time.sleep(0.3)
                else:
                    errors.append(f"{ticker}: no data")
            except Exception as e:
                errors.append(f"{ticker}: {str(e)[:50]}")

        conn.close()

        return {
            'success': True,
            'total': len(all_stocks),
            'fetched': fetched,
            'stored': stored,
            'skipped_invalid': skipped_invalid,
            'errors': errors[:10],
        }

    # ─── Tab_* Integrity Check (FETCHER-FIX 2026-08-17) ────────────────────
    # Read-only verification that tab_balance_sheet / tab_income_statement /
    # tab_cash_flow have ZERO shifted rows (symbol = market name). The fetcher
    # does NOT write to tab_* (owned by the TradingView scraper, which uses a
    # TICKER+ArabicName symbol format). This check lets the operator confirm
    # tab_* stays clean after the migration (migrate_fundamentals_schema.py)
    # and that the cron never reproduces the 8 corrupted rows.

    def verify_tab_integrity(self) -> Dict:
        """Read-only scan of tab_* for shifted rows. Returns per-table report."""
        report: Dict = {'db': DATA_ENGINE_DB, 'tables': {}, 'clean': True}
        if not os.path.exists(DATA_ENGINE_DB):
            report['error'] = f'DB not found: {DATA_ENGINE_DB}'
            return report
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(DATA_ENGINE_DB, writable=False).__enter__()
            cur = conn.cursor()
            for table in ('tab_balance_sheet', 'tab_income_statement', 'tab_cash_flow'):
                try:
                    cur.execute(f'SELECT COUNT(*) FROM {table}')
                    total = cur.fetchone()[0]
                    placeholders = ','.join('?' * len(MARKET_NAMES))
                    cur.execute(
                        f'SELECT id, symbol, market FROM {table} '
                        f'WHERE symbol IN ({placeholders})',
                        MARKET_NAMES,
                    )
                    shifted = cur.fetchall()
                    report['tables'][table] = {
                        'total': total,
                        'shifted': len(shifted),
                        'shifted_ids': [r[0] for r in shifted],
                    }
                    if shifted:
                        report['clean'] = False
                except sqlite3.OperationalError:
                    report['tables'][table] = {'error': 'table missing or wrong schema'}
            conn.close()
        except Exception as e:
            report['error'] = str(e)
        return report

    # ─── Golden Stocks ───────────────────────────────────────────────────

    def fetch_golden_stocks(self, limit: int = 10) -> Optional[List[Dict]]:
        """يجيب الفرص الذهبية (pre-breakout) من EGXPilot."""
        response = self._safe_get(EGXPILOT_GOLDEN_STOCKS_API)
        if not response or response.status_code != 200:
            return None

        try:
            data = response.json()
            opportunities = data.get('opportunities', [])[:limit]
            return opportunities
        except Exception:
            return None


# ─── CLI ────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    fetcher = EGXFundamentalFetcher()

    import sys as _sys
    # FETCHER-FIX (2026-08-17): no-args default = full bulk fetch (was: single-stock
    # 'COMI' test). The cron (`egx_fundamental_fetcher.py` with no args) must
    # actually populate egx_fundamentals, not silently test one stock.
    if len(_sys.argv) > 1 and _sys.argv[1] == "stats":
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(DATA_ENGINE_DB, writable=False).__enter__()
        try:
            total = conn.execute("SELECT COUNT(*) FROM egx_fundamentals").fetchone()[0]
            print(f"Total EGX fundamentals: {total}")
        except sqlite3.OperationalError:
            print("Table not found")
        conn.close()
    elif len(_sys.argv) > 1 and _sys.argv[1] == "verify":
        # Read-only tab_* integrity check (post-migration / post-cron verification)
        report = fetcher.verify_tab_integrity()
        print(json.dumps(report, indent=2, ensure_ascii=False))
        _sys.exit(0 if report.get('clean') else 1)
    elif len(_sys.argv) > 1 and _sys.argv[1] == "fetch":
        limit = int(_sys.argv[2]) if len(_sys.argv) > 2 else 0
        result = fetcher.fetch_all_egx_fundamentals(limit=limit)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    elif len(_sys.argv) == 1:
        # No args = cron invocation → full bulk fetch (populates egx_fundamentals)
        result = fetcher.fetch_all_egx_fundamentals(limit=0)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        # Test single stock: `egx_fundamental_fetcher.py COMI`
        ticker = _sys.argv[1]
        fund = fetcher.get_fundamentals(ticker)
        if fund:
            print(json.dumps(fund, indent=2, ensure_ascii=False, default=str))
        else:
            print(f"No data for {ticker}")
