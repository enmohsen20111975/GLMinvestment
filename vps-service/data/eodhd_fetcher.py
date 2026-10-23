#!/usr/bin/env python3
"""
EODHD Fetcher - EOD Historical Data API
========================================
جلب البيانات التاريخية والحية من EODHD API

Features:
- بيانات تاريخية يومية (EOD) لكل أسهم EGX
- تحديث جماعي (Bulk) لكل 281 سهم في طلب واحد
- بيانات لحظية (Real-time) كاحتياطي
- تخزين في stocks.db + price_history.db

API: https://eodhd.com/
Exchange code for EGX: "EGX"
Ticker format: "COMI.EGX", "BTFH.EGX", etc.

Author: M2Y Developers Team
Version: 1.0.0
"""

import os
import sys
import time
import sqlite3
import logging
import requests
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from pathlib import Path

logger = logging.getLogger(__name__)

# ============================================================================
# CONFIGURATION
# ============================================================================

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')

# API key from environment variable (set in .env or ecosystem.config.js)
EODHD_API_KEY = os.environ.get('EODHD_API_KEY', '')  # P2 fix: removed hardcoded key (EODHD subscription cancelled)
EODHD_BASE_URL = 'https://eodhd.com/api'
EGX_EXCHANGE_CODE = 'EGX'

# Rate limiting: EODHD allows 100K requests/day on basic plans
REQUEST_DELAY = 0.5  # 500ms between requests to be safe
BULK_REQUEST_DELAY = 60  # bulk endpoint: 1 request per minute


class EODHDFetcher:
    """جلب البيانات من EODHD API"""

    def __init__(self, api_key: str = None, stocks_db: str = None, price_history_db: str = None):
        self.api_key = api_key or EODHD_API_KEY
        self.stocks_db = stocks_db or STOCKS_DB
        self.price_history_db = price_history_db or PRICE_HISTORY_DB
        self.session = requests.Session()
        self.session.headers.update({'User-Agent': 'GLMinvestment/1.0'})

    def _make_request(self, endpoint: str, params: Dict = None) -> Optional[Any]:
        """طلب آمن من EODHD API مع إعادة المحاولة"""
        url = f"{EODHD_BASE_URL}/{endpoint}"
        params = params or {}
        params['api_token'] = self.api_key
        params.setdefault('fmt', 'json')

        for attempt in range(3):
            try:
                response = self.session.get(url, params=params, timeout=30)
                if response.status_code == 200:
                    return response.json()
                elif response.status_code == 429:
                    logger.warning(f"[EODHD] Rate limited, waiting 10s (attempt {attempt+1})")
                    time.sleep(10)
                elif response.status_code == 403:
                    logger.error(f"[EODHD] Forbidden: {response.text[:200]}")
                    return None
                else:
                    logger.warning(f"[EODHD] HTTP {response.status_code}: {response.text[:200]}")
                    time.sleep(2)
            except requests.exceptions.RequestException as e:
                logger.warning(f"[EODHD] Request error (attempt {attempt+1}): {e}")
                time.sleep(3)

        logger.error(f"[EODHD] Failed after 3 attempts: {endpoint}")
        return None

    # ========================================================================
    # EGX STOCKS LIST
    # ========================================================================

    def get_egx_stocks_list(self) -> List[Dict]:
        """جلب قائمة كل أسهم EGX (281 سهم)"""
        logger.info("[EODHD] Fetching EGX stocks list...")
        data = self._make_request(f'exchange-symbol-list/{EGX_EXCHANGE_CODE}')
        if data and isinstance(data, list):
            stocks = [s for s in data if s.get('Type') == 'Common Stock']
            logger.info(f"[EODHD] Got {len(stocks)} EGX common stocks")
            return stocks
        return []

    def sync_egx_stocks_to_db(self) -> Dict:
        """مزامنة قائمة الأسهم مع stocks.db - يضيف أي أسهم جديدة"""
        stocks = self.get_egx_stocks_list()
        if not stocks:
            return {'success': False, 'error': 'No stocks fetched'}

        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(self.stocks_db, writable=False).__enter__()
        cur = conn.cursor()
        added = 0
        updated = 0

        for s in stocks:
            ticker = s.get('Code', '').strip()
            name = s.get('Name', '').strip()
            if not ticker:
                continue

            # Check if stock exists
            existing = cur.execute("SELECT id FROM stocks WHERE ticker = ?", (ticker,)).fetchone()
            if existing:
                # Update name if missing
                # DATA-ENGINE-UNIFY-1 Stage 1: name_ar must stay Arabic-only.
                # Previously this UPDATE injected the English `name` into name_ar
                # when name_ar was empty — same pollution bug as the INSERT branch.
                # Now name_ar is left untouched here (Arabic names come from EGKSCO
                # via sync.py, not from EODHD). Only `name` (English) is filled.
                cur.execute("""
                    UPDATE stocks SET name = COALESCE(NULLIF(name, ''), ?),
                                      market = 'EGX'
                    WHERE ticker = ?
                """, (name, ticker))
                updated += 1
            else:
                # Insert new stock
                # DATA-ENGINE-UNIFY-1 Stage 1: name_ar must be NULL — Arabic names come
                # from EGKSCO only, not EODHD. Inserting the English `name` into
                # `name_ar` was polluting the column and masking alias detection.
                cur.execute("""
                    INSERT INTO stocks (ticker, name, name_ar, market, is_active, created_at, updated_at)
                    VALUES (?, ?, ?, 'EGX', 1, datetime('now'), datetime('now'))
                """, (ticker, name, None))
                added += 1

        conn.commit()
        conn.close()
        logger.info(f"[EODHD] Stocks sync: {added} added, {updated} updated")
        return {'success': True, 'added': added, 'updated': updated, 'total': len(stocks)}

    # ========================================================================
    # HISTORICAL EOD DATA (for backfilling)
    # ========================================================================

    def get_historical_eod(self, ticker: str, from_date: str, to_date: str) -> List[Dict]:
        """
        جلب البيانات التاريخية اليومية لسهم واحد
        ticker: 'COMI' (without .EGX)
        from_date: '2024-01-01'
        to_date: '2026-07-12'
        """
        symbol = f"{ticker}.{EGX_EXCHANGE_CODE}"
        data = self._make_request(f'eod/{symbol}', {
            'from': from_date,
            'to': to_date,
            'order': 'a',  # ascending
        })
        return data if data else []

    def backfill_stock_history(self, ticker: str, days: int = 730) -> Dict:
        """
        تعبئة البيانات التاريخية لسهم واحد
        days: عدد الأيام (افتراضي 730 = سنتين)
        """
        to_date = datetime.now().strftime('%Y-%m-%d')
        from_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

        logger.info(f"[EODHD] Backfilling {ticker} ({from_date} to {to_date})...")
        records = self.get_historical_eod(ticker, from_date, to_date)
        if not records:
            return {'ticker': ticker, 'success': False, 'error': 'No data'}

        # Store in stock_daily_prices (stocks.db) — P0 fix (يوليو 2026):
        # ده الكانونيكال لـ stocks.db. price_history.db بيتحدث من خلال sync منفصل.
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(self.stocks_db, writable=False).__enter__()
        cur = conn.cursor()
        saved_daily = 0
        for r in records:
            try:
                cur.execute("""
                    INSERT OR REPLACE INTO stock_daily_prices
                        (ticker, price_date, open, high, low, close, volume, change_percent, fetch_time)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                """, (
                    ticker,
                    r.get('date'),
                    float(r.get('open', 0)),
                    float(r.get('high', 0)),
                    float(r.get('low', 0)),
                    float(r.get('close', 0)),
                    int(r.get('volume', 0) or 0),
                    None,  # change_percent will be calculated
                ))
                saved_daily += 1
            except Exception as e:
                logger.debug(f"[EODHD] Error saving {ticker} {r.get('date')}: {e}")

        # Update stocks table with latest price
        if records:
            latest = records[-1]
            cur.execute("""
                UPDATE stocks SET
                    current_price = ?,
                    previous_close = ?,
                    open_price = ?,
                    high_price = ?,
                    low_price = ?,
                    volume = ?,
                    last_update = ?,
                    updated_at = datetime('now')
                WHERE ticker = ?
            """, (
                float(latest.get('close', 0)),
                float(latest.get('close', 0)),  # EOD doesn't give prev_close directly
                float(latest.get('open', 0)),
                float(latest.get('high', 0)),
                float(latest.get('low', 0)),
                int(latest.get('volume', 0) or 0),
                latest.get('date'),
                ticker,
            ))

        conn.commit()
        conn.close()

        # Store in price_history.db (P0 fix يوليو 2026):
        # price_history.db هو الكانونيكال للتاريخ السعري.
        # stock_daily_prices (stocks.db) بيستخدم كـ cache للأسعار اليومية.
        # الاتنين بيتكتبوا لأن price_history.db فيه بيانات تاريخية أقدم (pre-EODHD)
        # و stock_daily_prices فيه الـ clean EODHD data.
        # الـ sync بينهم بيتم عن طريق get_price_history() fallback chain.
        #
        # Task 23-B (Rule 66): INSERT → write_guarded(). الـ guard بيـ enforce
        # canonical source hierarchy. 'eodhd' is NOT in any market's hierarchy,
        # so writes will be SKIPPED — canonical writer per market takes precedence
        # (e.g. intraday_aggregated for EGX, yahoo_clean for US/TADAWUL/KSE/QSE).
        try:
            # Import source_authority guard (Rule 66)
            _vps_path = str(_PROJECT_ROOT / 'vps-service')
            if _vps_path not in sys.path:
                sys.path.insert(0, _vps_path)
            from data.source_authority import write_guarded, get_market_for_ticker

            saved_history = 0
            for r in records:
                try:
                    market = get_market_for_ticker(ticker, db_path=self.stocks_db)
                    wrote = write_guarded(
                        db_path=self.price_history_db,
                        ticker=ticker,
                        market=market,
                        date=r.get('date'),
                        open_price=float(r.get('open', 0)),
                        high_price=float(r.get('high', 0)),
                        low_price=float(r.get('low', 0)),
                        close_price=float(r.get('close', 0)),
                        volume=int(r.get('volume', 0) or 0),
                        source='eodhd',
                    )
                    if wrote:
                        saved_history += 1
                except Exception:
                    pass
        except Exception as e:
            logger.debug(f"[EODHD] price_history.db error: {e}")
            saved_history = 0

        logger.info(f"[EODHD] {ticker}: {saved_daily} daily records saved")
        return {
            'ticker': ticker,
            'success': True,
            'records': saved_daily,
            'history_records': saved_history,
            'date_range': f"{from_date} to {to_date}",
        }

    # ========================================================================
    # BULK EOD (all 281 stocks at once - 1 request per minute)
    # ========================================================================

    def get_bulk_eod(self) -> List[Dict]:
        """
        جلب بيانات اليوم لكل أسهم EGX في طلب واحد
        Returns: list of {code, open, high, low, close, volume, previousClose, ...}
        """
        logger.info("[EODHD] Fetching bulk EOD for all EGX stocks...")
        data = self._make_request(f'eod-bulk-last-day/{EGX_EXCHANGE_CODE}', {
            'filter': 'Common Stock',
        })
        if data and isinstance(data, list):
            logger.info(f"[EODHD] Bulk EOD: {len(data)} stocks")
            return data
        return []

    def update_all_stocks_bulk(self) -> Dict:
        """
        تحديث كل أسهم EGX مرة واحدة باستخدام bulk EOD
        مثالي للتحديث بعد إغلاق السوق
        """
        data = self.get_bulk_eod()
        if not data:
            return {'success': False, 'error': 'No bulk data'}

        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(self.stocks_db, writable=False).__enter__()
        cur = conn.cursor()
        updated = 0
        errors = 0

        for s in data:
            ticker = s.get('code', '').replace('.EGX', '').strip()
            close = float(s.get('close', 0) or 0)
            if not ticker or close <= 0:
                errors += 1
                continue

            prev_close = float(s.get('previousClose', 0) or close)
            change_pct = ((close - prev_close) / prev_close * 100) if prev_close > 0 else 0

            try:
                cur.execute("""
                    UPDATE stocks SET
                        current_price = ?,
                        previous_close = ?,
                        open_price = ?,
                        high_price = ?,
                        low_price = ?,
                        volume = ?,
                        change_percent = ?,
                        last_update = ?,
                        updated_at = datetime('now')
                    WHERE ticker = ?
                """, (
                    close,
                    prev_close,
                    float(s.get('open', 0) or 0),
                    float(s.get('high', 0) or 0),
                    float(s.get('low', 0) or 0),
                    int(float(s.get('volume', 0) or 0)) if str(s.get('volume', '')).replace('.','').isdigit() else 0,
                    round(change_pct, 4),
                    datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
                    ticker,
                ))
                if cur.rowcount > 0:
                    updated += 1
            except Exception as e:
                errors += 1
                logger.debug(f"[EODHD] Error updating {ticker}: {e}")

        conn.commit()
        conn.close()
        logger.info(f"[EODHD] Bulk update: {updated} stocks updated, {errors} errors")
        return {
            'success': True,
            'updated': updated,
            'errors': errors,
            'total': len(data),
            'source': 'EODHD',
            'timestamp': datetime.now().isoformat(),
        }

    # ========================================================================
    # REAL-TIME QUOTE (fallback for intraday)
    # ========================================================================

    def get_real_time(self, ticker: str) -> Optional[Dict]:
        """جلب السعر اللحظي لسهم واحد"""
        symbol = f"{ticker}.{EGX_EXCHANGE_CODE}"
        data = self._make_request(f'real-time/{symbol}')
        if data:
            return {
                'ticker': ticker,
                'price': float(data.get('close', 0) or 0) if data.get('close') != 'NA' else None,
                'previous_close': float(data.get('previousClose', 0) or 0) if data.get('previousClose') != 'NA' else None,
                'change': float(data.get('change', 0) or 0) if data.get('change') != 'NA' else None,
                'change_percent': float(data.get('change_p', 0) or 0) if data.get('change_p') != 'NA' else None,
                'timestamp': data.get('timestamp'),
            }
        return None

    # ============================================================
    # FUNDAMENTAL DATA — البيانات الأساسية (يوليو 2026)
    # ============================================================
    # EODHD endpoint: /api/fundamentals/{ticker}.{exchange}
    # بيرجّع: P/E, P/B, ROE, ROA, Margins, Revenue, Debt, Dividends, إلخ.
    # ============================================================

    def get_fundamentals(self, ticker: str, market: str = 'EGX') -> Optional[Dict]:
        """جلب البيانات الأساسية لسهم من EODHD.

        Args:
            ticker: رمز السهم (مثلاً COMI)
            market: السوق (EGX/TADAWUL/KSE/QSE)

        Returns:
            dict فيه البيانات الأساسية موحّدة + fundamental_score, أو None
        """
        # تحديد الـ suffix حسب السوق
        suffix_map = {
            'EGX': 'CA',
            'TADAWUL': 'SR',
            'KSE': 'KW',
            'QSE': 'QA',
        }
        suffix = suffix_map.get(market.upper(), 'CA')
        eodhd_ticker = f"{ticker}.{suffix}" if '.' not in ticker else ticker

        data = self._make_request(f"fundamentals/{eodhd_ticker}")
        if not data:
            return None

        # توحيد البيانات
        general = data.get('General', {}) or {}
        highlights = data.get('Highlights', {}) or {}
        valuation = data.get('Valuation', {}) or {}

        def _sf(val):
            # FIX (Aug 2026): Original _sf did `float(val)` which crashes on
            # formatted strings like '377.55\u202fM' (thin space + M suffix).
            # Now we use parse_numeric for plain numerics (P/E, ROE, etc.)
            # and parse_market_cap for market_cap / enterprise_value (which
            # EODHD sometimes returns with M/B/T suffixes).
            try:
                from core.database import parse_numeric, parse_market_cap
                if val is None:
                    return None
                return round(parse_numeric(val), 2) if parse_numeric(val) is not None else None
            except ImportError:
                try:
                    return round(float(val), 2) if val is not None else None
                except (ValueError, TypeError):
                    return None

        def _sf_market_cap(val):
            # FIX (Aug 2026): market_cap needs suffix-aware parser.
            # '377.55\u202fM' -> 377550000.0
            try:
                from core.database import parse_market_cap
                v = parse_market_cap(val)
                return round(v, 2) if v is not None else None
            except ImportError:
                try:
                    return round(float(val), 2) if val is not None else None
                except (ValueError, TypeError):
                    return None

        fundamentals = {
            'ticker': ticker.upper(),
            'market': market.upper(),
            'name': general.get('Name', ''),
            'sector': general.get('Sector', ''),
            'industry': general.get('Industry', ''),
            'currency': general.get('CurrencyCode', 'EGP'),

            # Valuation
            'pe_ratio': _sf(highlights.get('PERRatio')),
            'peg_ratio': _sf(highlights.get('PEGRatio')),
            'pb_ratio': _sf(highlights.get('PBRatio')),
            'ps_ratio': _sf(highlights.get('PSRatio')),
            'ev_ebitda': _sf(valuation.get('EVToEBITDA')),

            # Profitability
            'roe': _sf(highlights.get('ReturnOnEquity')),
            'roa': _sf(highlights.get('ReturnOnAssets')),
            'net_margin': _sf(highlights.get('ProfitMargin')),
            'gross_margin': _sf(highlights.get('GrossMarginTTM')),
            'operating_margin': _sf(highlights.get('OperatingMarginTTM')),

            # Growth
            'revenue_growth': _sf(highlights.get('RevenueGrowth5Y')),
            'eps_growth': _sf(highlights.get('EPSGrowth5Y')),

            # Financial Health
            'debt_to_equity': _sf(highlights.get('DebtToEquityRatio')),
            'current_ratio': _sf(highlights.get('CurrentRatioTTM')),
            'quick_ratio': _sf(highlights.get('QuickRatioTTM')),

            # Dividends
            'dividend_yield': _sf(highlights.get('DividendYield')),
            'payout_ratio': _sf(highlights.get('PayoutRatio')),

            # Market Data
            # FIX (Aug 2026): market_cap + enterprise_value may come from EODHD
            # as formatted strings ('377.55 M', '1.2 B'). Use suffix-aware parser.
            'market_cap': _sf_market_cap(highlights.get('MarketCapitalization')),
            'enterprise_value': _sf_market_cap(highlights.get('EnterpriseValue')),
            'beta': _sf(highlights.get('Beta')),
        }

        # Fundamental Score (0-100)
        fundamentals['fundamental_score'] = self._calc_fund_score(fundamentals)

        return fundamentals

    def _calc_fund_score(self, f: Dict) -> float:
        """يحسب fundamental score من 0-100.

        Valuation (25): P/E < 10 = ممتاز
        Profitability (30): ROE > 25% = ممتاز
        Growth (20): Revenue growth > 20% = ممتاز
        Financial Health (15): Debt/Equity < 0.5 = ممتاز
        Dividends (10): Yield > 5% = ممتاز
        """
        score = 50

        pe = f.get('pe_ratio')
        if pe:
            if pe < 10: score += 15
            elif pe < 15: score += 10
            elif pe < 25: score += 5
            elif pe > 50: score -= 10

        roe = f.get('roe')
        if roe:
            if roe > 25: score += 18
            elif roe > 15: score += 12
            elif roe > 10: score += 6
            elif roe < 5: score -= 8

        net_margin = f.get('net_margin')
        if net_margin:
            if net_margin > 15: score += 8
            elif net_margin > 5: score += 4
            elif net_margin < 0: score -= 10

        rev_growth = f.get('revenue_growth')
        if rev_growth:
            if rev_growth > 20: score += 12
            elif rev_growth > 10: score += 8
            elif rev_growth < 0: score -= 5

        de = f.get('debt_to_equity')
        if de:
            if de < 0.5: score += 8
            elif de < 1.0: score += 4
            elif de > 3: score -= 8

        div_yield = f.get('dividend_yield')
        if div_yield:
            if div_yield > 5: score += 6
            elif div_yield > 3: score += 4
            elif div_yield > 1: score += 2

        return round(max(0, min(100, score)), 1)

    def fetch_all_egx_fundamentals(self, limit: int = 0) -> Dict:
        """يجيب fundamentals لكل أسهم EGX ويخزنها في data_engine.db.

        Args:
            limit: 0 = كل الأسهم، N = أول N سهم

        Returns:
            {success, total, fetched, stored, errors}
        """
        import sqlite3
        import json as _json
        from pathlib import Path

        _root = Path(__file__).resolve().parent.parent.parent
        _db = str(_root / 'db' / 'data_engine.db')

        # جلب قائمة أسهم EGX
        stocks = self.get_egx_stocks_list()
        if limit > 0:
            stocks = stocks[:limit]

        # إنشاء/تأكيد table
        # Phase 7.1: migrated to db_manager (writable=True)
        from core.db_manager import db_manager
        conn = db_manager.connection(_db, writable=True).__enter__()
        conn.execute('''
            CREATE TABLE IF NOT EXISTS egx_fundamentals (
                ticker TEXT PRIMARY KEY,
                name TEXT,
                sector TEXT,
                industry TEXT,
                pe_ratio REAL,
                peg_ratio REAL,
                pb_ratio REAL,
                ps_ratio REAL,
                ev_ebitda REAL,
                roe REAL,
                roa REAL,
                net_margin REAL,
                gross_margin REAL,
                operating_margin REAL,
                revenue_growth REAL,
                eps_growth REAL,
                debt_to_equity REAL,
                current_ratio REAL,
                quick_ratio REAL,
                dividend_yield REAL,
                payout_ratio REAL,
                market_cap REAL,
                enterprise_value REAL,
                beta REAL,
                fundamental_score REAL,
                raw_data TEXT,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        ''')
        conn.commit()

        fetched = 0
        stored = 0
        errors = []

        for stock in stocks:
            ticker = stock.get('ticker') or stock.get('symbol') or stock.get('Code', '')
            if not ticker:
                continue
            try:
                fund = self.get_fundamentals(ticker, 'EGX')
                if fund:
                    fetched += 1
                    conn.execute('''
                        INSERT OR REPLACE INTO egx_fundamentals
                            (ticker, name, sector, industry, pe_ratio, peg_ratio,
                             pb_ratio, ps_ratio, ev_ebitda, roe, roa, net_margin,
                             gross_margin, operating_margin, revenue_growth, eps_growth,
                             debt_to_equity, current_ratio, quick_ratio,
                             dividend_yield, payout_ratio, market_cap,
                             enterprise_value, beta, fundamental_score, raw_data, updated_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
                    ''', (
                        fund['ticker'], fund['name'], fund['sector'], fund['industry'],
                        fund['pe_ratio'], fund['peg_ratio'], fund['pb_ratio'], fund['ps_ratio'],
                        fund['ev_ebitda'], fund['roe'], fund['roa'], fund['net_margin'],
                        fund['gross_margin'], fund['operating_margin'],
                        fund['revenue_growth'], fund['eps_growth'],
                        fund['debt_to_equity'], fund['current_ratio'], fund['quick_ratio'],
                        fund['dividend_yield'], fund['payout_ratio'],
                        fund['market_cap'], fund['enterprise_value'], fund['beta'],
                        fund['fundamental_score'],
                        _json.dumps(fund),
                    ))
                    conn.commit()
                    stored += 1
                    time.sleep(1.5)  # EODHD rate limit
                else:
                    errors.append(f"{ticker}: no data")
            except Exception as e:
                errors.append(f"{ticker}: {str(e)[:50]}")

        conn.close()

        return {
            'success': True,
            'total': len(stocks),
            'fetched': fetched,
            'stored': stored,
            'errors': errors[:10],
        }

    # ========================================================================
    # FULL BACKFILL (all stocks, 2 years)
    # ========================================================================

    def backfill_all_stocks(self, days: int = 730, delay: float = None) -> Dict:
        """
        تعبئة كاملة لكل أسهم EGX
        days: عدد الأيام (افتراضي 730 = سنتين)
        delay: التأخير بين الطلبات (افتراضي 0.5s)
        """
        delay = delay if delay is not None else REQUEST_DELAY
        stocks = self.get_egx_stocks_list()
        if not stocks:
            return {'success': False, 'error': 'No stocks list'}

        total = len(stocks)
        success = 0
        failed = 0
        total_records = 0
        start_time = time.time()

        logger.info(f"[EODHD] Starting full backfill: {total} stocks, {days} days each")

        for i, s in enumerate(stocks, 1):
            ticker = s.get('Code', '').strip()
            if not ticker:
                continue

            result = self.backfill_stock_history(ticker, days=days)
            if result.get('success'):
                success += 1
                total_records += result.get('records', 0)
            else:
                failed += 1

            if i % 10 == 0:
                elapsed = time.time() - start_time
                rate = i / elapsed if elapsed > 0 else 0
                eta = (total - i) / rate if rate > 0 else 0
                logger.info(f"[EODHD] Progress: {i}/{total} ({success} ok, {failed} failed) "
                          f"- {total_records} records - ETA: {eta:.0f}s")

            time.sleep(delay)

        elapsed = time.time() - start_time
        logger.info(f"[EODHD] Backfill complete: {success}/{total} stocks, {total_records} records, {elapsed:.0f}s")

        return {
            'success': True,
            'total_stocks': total,
            'success_count': success,
            'failed_count': failed,
            'total_records': total_records,
            'days_of_history': days,
            'elapsed_seconds': round(elapsed, 1),
            'timestamp': datetime.now().isoformat(),
        }


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def update_egx_prices_bulk() -> bool:
    """دالة سريعة لتحديث كل أسهم EGX باستخدام bulk EOD"""
    fetcher = EODHDFetcher()
    result = fetcher.update_all_stocks_bulk()
    return result.get('success', False)


def backfill_all_egx_history(days: int = 730) -> Dict:
    """دالة سريعة لتعبئة كل البيانات التاريخية"""
    fetcher = EODHDFetcher()
    return fetcher.backfill_all_stocks(days=days)


# ============================================================================
# CLI
# ============================================================================

if __name__ == '__main__':
    import argparse
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

    parser = argparse.ArgumentParser(description='EODHD Fetcher - EGX Data')
    parser.add_argument('--action', choices=['list', 'sync', 'bulk', 'backfill-one', 'backfill-all', 'realtime'],
                        default='list', help='Action to perform')
    parser.add_argument('--ticker', type=str, help='Ticker for single stock actions')
    parser.add_argument('--days', type=int, default=730, help='Days of history (default: 730 = 2 years)')

    args = parser.parse_args()
    fetcher = EODHDFetcher()

    if args.action == 'list':
        stocks = fetcher.get_egx_stocks_list()
        print(f"Total EGX stocks: {len(stocks)}")
        for s in stocks[:20]:
            print(f"  {s.get('Code'):10s} | {s.get('Name','')[:40]}")
        if len(stocks) > 20:
            print(f"  ... and {len(stocks)-20} more")

    elif args.action == 'sync':
        result = fetcher.sync_egx_stocks_to_db()
        print(f"Sync result: {result}")

    elif args.action == 'bulk':
        result = fetcher.update_all_stocks_bulk()
        print(f"Bulk update: {result}")

    elif args.action == 'backfill-one':
        if not args.ticker:
            print("Error: --ticker required")
            sys.exit(1)
        result = fetcher.backfill_stock_history(args.ticker, days=args.days)
        print(f"Backfill {args.ticker}: {result}")

    elif args.action == 'backfill-all':
        result = fetcher.backfill_all_stocks(days=args.days)
        print(f"Full backfill: {result}")

    elif args.action == 'realtime':
        if not args.ticker:
            print("Error: --ticker required")
            sys.exit(1)
        result = fetcher.get_real_time(args.ticker)
        print(f"Real-time {args.ticker}: {result}")
