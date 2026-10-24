#!/usr/bin/env python3
"""
Stock Fundamentals Engine — محرك البيانات الأساسية
=====================================================
يجمع البيانات من data-engine.db (9 جداول) + stocks.db
يعطي صورة كاملة لكل سهم: مالية + تقييم + ربحية + تقني + أرباح

data-engine.db tables:
- tab_balance_sheet (866) - ميزانية عمومية
- tab_income_statement (866) - قائمة الدخل
- tab_cash_flow (866) - التدفقات النقدية
- tab_valuation (858) - التقييم (P/E, PEG, P/S)
- tab_profitability (858) - الربحية (margins, ROE)
- tab_performance (858) - الأداء (1W, 1M, 3M)
- tab_dividends (858) - الأرباح (DPS, yield)
- tab_technical_analysis (863) - التحليل الفني (rating, trend)
- historical_data (99076) - بيانات تاريخية

Author: M2Y Developers Team
Version: 1.0.0
"""

import os
import sys
import sqlite3
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any
from pathlib import Path

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')


def _sf(val, default=0.0):
    """safe float - extracts number from strings like '11.59 B EGP', '1.26%', '+92.31%'"""
    if val is None:
        return default
    try:
        s = str(val).replace('−', '-').replace('،', '').replace('\u202f', '').strip()
        # Extract first number (handle B/M/K suffixes)
        import re
        match = re.search(r'([+-]?\d+\.?\d*)\s*([BMKbmk])?', s)
        if match:
            num = float(match.group(1))
            suffix = (match.group(2) or '').upper()
            if suffix == 'B':
                num *= 1e9
            elif suffix == 'M':
                num *= 1e6
            elif suffix == 'K':
                num *= 1e3
            return num if num == num else default
        return default
    except:
        return default


class StockFundamentals:
    """محرك البيانات الأساسية للسهم"""

    def __init__(self):
        self.stocks_db = STOCKS_DB
        self.data_engine_db = DATA_ENGINE_DB

    def _get_de_conn(self):
        """data-engine.db connection"""
        if not os.path.exists(self.data_engine_db):
            return None
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(self.data_engine_db, writable=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _get_stocks_conn(self):
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(self.stocks_db, writable=False)
        conn.row_factory = sqlite3.Row
        return conn

    def get_stock_full_profile(self, ticker: str) -> Optional[Dict]:
        """
        الصورة الكاملة لسهم واحد من كل قواعد البيانات
        يجمع: stocks.db + data-engine.db (9 جداول)
        """
        ticker = ticker.upper().strip()
        result = {'ticker': ticker, 'found': False}

        # 1. Basic info from stocks.db
        try:
            conn = self._get_stocks_conn()
            cur = conn.cursor()
            stock = cur.execute("""
                SELECT ticker, name, name_ar, current_price, change_percent, volume,
                       market_cap, pe_ratio, pb_ratio, ps_ratio, eps, roe, roa,
                       debt_to_equity, current_ratio, book_value_per_share,
                       ma_50, ma_200, rsi, support, resistance, signal, trend,
                       dividend_yield, profit_margin, avg_volume, beta,
                       high_52w, low_52w, sector, industry
                FROM stocks WHERE ticker = ? OR ticker = ?
            """, (ticker, ticker.replace('.EGX', ''))).fetchone()

            if stock:
                result['found'] = True
                result['basic'] = {
                    'ticker': stock['ticker'],
                    'name': stock['name'],
                    'name_ar': stock['name_ar'],
                    'price': _sf(stock['current_price']),
                    'change_percent': _sf(stock['change_percent']),
                    'volume': _sf(stock['volume']),
                    'market_cap': _sf(stock['market_cap']),
                    'pe_ratio': _sf(stock['pe_ratio']),
                    'pb_ratio': _sf(stock['pb_ratio']),
                    'ps_ratio': _sf(stock['ps_ratio']),
                    'eps': _sf(stock['eps']),
                    'roe': _sf(stock['roe']),
                    'roa': _sf(stock['roa']),
                    'debt_to_equity': _sf(stock['debt_to_equity']),
                    'current_ratio': _sf(stock['current_ratio']),
                    'book_value': _sf(stock['book_value_per_share']),
                    'ma_50': _sf(stock['ma_50']),
                    'ma_200': _sf(stock['ma_200']),
                    'rsi': _sf(stock['rsi']) if stock['rsi'] else None,
                    'support': _sf(stock['support']),
                    'resistance': _sf(stock['resistance']),
                    'signal': stock['signal'],
                    'trend': stock['trend'],
                    'dividend_yield': _sf(stock['dividend_yield']),
                    'profit_margin': _sf(stock['profit_margin']),
                    'avg_volume': _sf(stock['avg_volume']),
                    'beta': _sf(stock['beta']),
                    'high_52w': _sf(stock['high_52w']),
                    'low_52w': _sf(stock['low_52w']),
                    'sector': stock['sector'],
                    'industry': stock['industry'],
                }
            conn.close()
        except Exception as e:
            logger.debug(f"Error getting basic info for {ticker}: {e}")

        # 2. data-engine.db tables
        conn_de = self._get_de_conn()
        if conn_de:
            cur_de = conn_de.cursor()
            symbol = ticker.replace('.EGX', '')
            # DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
            # exact match replaces the old fuzzy LIKE pattern.

            # Balance Sheet
            try:
                row = cur_de.execute("SELECT * FROM tab_balance_sheet WHERE symbol = ? ORDER BY fiscal_end DESC LIMIT 1", (symbol,)).fetchone()
                if row:
                    result['balance_sheet'] = {
                        'total_assets': _sf(row['total_assets']),
                        'total_liabilities': _sf(row['total_liabilities']),
                        'total_equity': _sf(row['total_equity']),
                        'fiscal_period': row['fiscal_period'],
                        'fiscal_end': row['fiscal_end'],
                    }
            except: pass

            # Income Statement — DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
            try:
                row = cur_de.execute("SELECT * FROM tab_income_statement WHERE symbol = ? ORDER BY fiscal_end DESC LIMIT 1", (symbol,)).fetchone()
                if row:
                    result['income_statement'] = {
                        'revenue': _sf(row['revenue']),
                        'revenue_growth': _sf(row['revenue_growth']),
                        'gross_profit': _sf(row['gross_profit']),
                        'operating_income': _sf(row['operating_income']) if 'operating_income' in row.keys() else 0,
                        'net_income': _sf(row['net_income']) if 'net_income' in row.keys() else 0,
                        'eps': _sf(row['eps']) if 'eps' in row.keys() else 0,
                        'fiscal_end': row['fiscal_end'],
                    }
            except: pass

            # Cash Flow — DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
            try:
                row = cur_de.execute("SELECT * FROM tab_cash_flow WHERE symbol = ? ORDER BY fiscal_end DESC LIMIT 1", (symbol,)).fetchone()
                if row:
                    result['cash_flow'] = {
                        'operating_cf': _sf(row['operating_cf']),
                        'investing_cf': _sf(row['investing_cf']),
                        'financing_cf': _sf(row['financing_cf']),
                        'free_cf': _sf(row['free_cf']) if 'free_cf' in row.keys() else 0,
                        'fiscal_end': row['fiscal_end'],
                    }
            except: pass

            # Valuation — DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
            try:
                row = cur_de.execute("SELECT * FROM tab_valuation WHERE symbol = ? LIMIT 1", (symbol,)).fetchone()
                if row:
                    result['valuation'] = {
                        'market_cap': _sf(row['market_cap']),
                        'pe_ratio': _sf(row['pe_ratio']),
                        'peg_ratio': _sf(row['peg_ratio']),
                        'ps_ratio': _sf(row['ps_ratio']),
                        'pb_ratio': _sf(row['pb_ratio']) if 'pb_ratio' in row.keys() else 0,
                        'ev_ebitda': _sf(row['ev_ebitda']) if 'ev_ebitda' in row.keys() else 0,
                    }
            except: pass

            # Profitability — DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
            try:
                row = cur_de.execute("SELECT * FROM tab_profitability WHERE symbol = ? LIMIT 1", (symbol,)).fetchone()
                if row:
                    result['profitability'] = {
                        'gross_margin': _sf(row['gross_margin']),
                        'operating_margin': _sf(row['operating_margin']),
                        'pretax_margin': _sf(row['pretax_margin']),
                        'net_margin': _sf(row['net_margin']),
                        'fcf_margin': _sf(row['fcf_margin']),
                        'roe': _sf(row['roe']) if 'roe' in row.keys() else 0,
                        'roa': _sf(row['roa']) if 'roa' in row.keys() else 0,
                        # DATA-ENGINE-UNIFY-1 Stage 2b: roic column not in tab_profitability
                        # schema (roc is the closest alternative). Map roic ← roc so the
                        # downstream dict shape is preserved; falls back to 0 when roc is absent.
                        'roic': _sf(row['roc']) if 'roc' in row.keys() else 0,
                    }
            except: pass

            # Performance — DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
            try:
                row = cur_de.execute("SELECT * FROM tab_performance WHERE symbol = ? LIMIT 1", (symbol,)).fetchone()
                if row:
                    result['performance'] = {
                        'price': _sf(row['price']),
                        'change_percent': _sf(row['change_percent']),
                        'perf_1w': _sf(row['perf_1w']),
                        'perf_1m': _sf(row['perf_1m']),
                        'perf_3m': _sf(row['perf_3m']),
                        'perf_6m': _sf(row['perf_6m']) if 'perf_6m' in row.keys() else 0,
                        'perf_1y': _sf(row['perf_1y']) if 'perf_1y' in row.keys() else 0,
                        'perf_ytd': _sf(row['perf_ytd']) if 'perf_ytd' in row.keys() else 0,
                    }
            except: pass

            # Dividends — DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
            try:
                row = cur_de.execute("SELECT * FROM tab_dividends WHERE symbol = ? LIMIT 1", (symbol,)).fetchone()
                if row:
                    result['dividends'] = {
                        'dps_ttm': _sf(row['dps_ttm']),
                        'dps_fy': _sf(row['dps_fy']),
                        'div_yield': _sf(row['div_yield']),
                        'div_yield_fwd': _sf(row['div_yield_fwd']),
                        'payout_ratio': _sf(row['payout_ratio']),
                    }
            except: pass

            # Technical Analysis — DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
            try:
                row = cur_de.execute("SELECT * FROM tab_technical_analysis WHERE symbol = ? LIMIT 1", (symbol,)).fetchone()
                if row:
                    result['technical'] = {
                        'technical_rating': row['technical_rating'],
                        'ma_rating': row['ma_rating'],
                        'oscillators_rating': row['oscillators_rating'],
                        'trend': row['trend'],
                        'momentum': _sf(row['momentum']) if 'momentum' in row.keys() else 0,
                    }
            except: pass

            conn_de.close()

        # 3. Fallback enrichment from stocks.db basic info if data_engine.db fields are missing/zero
        basic = result.get('basic', {})
        if basic:
            val = result.setdefault('valuation', {})
            if not val.get('pe_ratio') and basic.get('pe_ratio'): val['pe_ratio'] = basic['pe_ratio']
            if not val.get('pb_ratio') and basic.get('pb_ratio'): val['pb_ratio'] = basic['pb_ratio']
            if not val.get('ps_ratio') and basic.get('ps_ratio'): val['ps_ratio'] = basic['ps_ratio']
            if not val.get('market_cap') and basic.get('market_cap'): val['market_cap'] = basic['market_cap']

            prof = result.setdefault('profitability', {})
            if not prof.get('roe') and basic.get('roe'): prof['roe'] = basic['roe']
            if not prof.get('roa') and basic.get('roa'): prof['roa'] = basic['roa']
            if not prof.get('net_margin') and basic.get('profit_margin'): prof['net_margin'] = basic['profit_margin']

            div = result.setdefault('dividends', {})
            if not div.get('div_yield') and basic.get('dividend_yield'): div['div_yield'] = basic['dividend_yield']

            inc = result.setdefault('income_statement', {})
            if not inc.get('eps') and basic.get('eps'): inc['eps'] = basic['eps']

            # Structural Balance Sheet & Income Statement fallbacks
            # (دعم البيانات المالية الهيكلية المحسوبة للشركات الصغرى)
            # Computes derived metrics when raw financial statements are missing,
            # using market cap + price multiples (P/B, P/E). Each estimated value
            # is flagged with is_estimated=True so the frontend can show a
            # "تقديري" badge. See: self.compute_structural_estimates()
            bs = result.setdefault('balance_sheet', {})
            mc = basic.get('market_cap', 0) or val.get('market_cap', 0)
            pb = basic.get('pb_ratio', 0) or val.get('pb_ratio', 0)
            pe = basic.get('pe_ratio', 0) or val.get('pe_ratio', 0)
            current_price = basic.get('price', 0) or 0.0

            # Snapshot of raw presence BEFORE structural fallback — used to
            # determine estimation_method ('raw' | 'structural' | 'mixed').
            raw_present_before = bool(bs.get('total_equity')) or bool(inc.get('net_income')) \
                or bool(prof.get('roe')) or bool(inc.get('eps'))

            # is_estimated sub-dicts (per-section) — additive, never overwrites
            # existing keys. False = raw, True = structurally estimated.
            bs_est = bs.setdefault('is_estimated', {})
            inc_est = inc.setdefault('is_estimated', {})
            prof_est = prof.setdefault('is_estimated', {})
            val_est = val.setdefault('is_estimated', {})
            basic_est = basic.setdefault('is_estimated', {})

            # Compute structural estimates once
            est = self.compute_structural_estimates(mc, pb, pe, current_price)

            estimated_count = 0

            # total_equity (Balance Sheet) = Market Cap / P/B
            if not bs.get('total_equity') and est.get('total_equity') is not None:
                bs['total_equity'] = est['total_equity']
                bs_est['total_equity'] = True
                estimated_count += 1
            else:
                bs_est['total_equity'] = False

            # total_assets ≈ total_equity * 1.5 (rough structural estimate)
            if not bs.get('total_assets') and bs.get('total_equity'):
                bs['total_assets'] = round(bs['total_equity'] * 1.5, 2)
                bs_est['total_assets'] = True
                estimated_count += 1
            else:
                bs_est['total_assets'] = False

            # total_liabilities = total_assets - total_equity
            if not bs.get('total_liabilities') and bs.get('total_assets') and bs.get('total_equity'):
                bs['total_liabilities'] = round(bs['total_assets'] - bs['total_equity'], 2)
                bs_est['total_liabilities'] = True
                estimated_count += 1
            else:
                bs_est['total_liabilities'] = False

            # net_income (Income Statement) = Market Cap / P/E
            if not inc.get('net_income') and est.get('net_income') is not None:
                inc['net_income'] = est['net_income']
                inc_est['net_income'] = True
                estimated_count += 1
            else:
                inc_est['net_income'] = False

            # revenue ≈ net_income * 4 (rough structural estimate)
            if not inc.get('revenue') and inc.get('net_income'):
                inc['revenue'] = round(inc['net_income'] * 4.0, 2)
                inc_est['revenue'] = True
                estimated_count += 1
            else:
                inc_est['revenue'] = False

            # eps = current_price / pe (Income Statement + basic)
            if (not inc.get('eps')) and est.get('eps') is not None:
                inc['eps'] = est['eps']
                inc_est['eps'] = True
                estimated_count += 1
            else:
                inc_est['eps'] = False

            if (not basic.get('eps')) and est.get('eps') is not None:
                basic['eps'] = est['eps']
                basic_est['eps'] = True
                estimated_count += 1
            else:
                basic_est['eps'] = False

            # roe (%) = (net_income / total_equity) * 100 (Profitability + basic)
            if (not prof.get('roe')) and est.get('roe') is not None:
                prof['roe'] = est['roe']
                prof_est['roe'] = True
                estimated_count += 1
            else:
                prof_est['roe'] = False

            if (not basic.get('roe')) and est.get('roe') is not None:
                basic['roe'] = est['roe']
                basic_est['roe'] = True
                estimated_count += 1
            else:
                basic_est['roe'] = False

            # book_value_per_share (basic) = total_equity / shares (or price / P/B fallback)
            if (not basic.get('book_value')) and est.get('book_value_per_share') is not None:
                basic['book_value'] = est['book_value_per_share']
                basic_est['book_value'] = True
                estimated_count += 1
            else:
                basic_est['book_value'] = False

            # debt_to_equity — cannot be derived without total debt
            # Mark explicitly as "تقديري غير متاح" (estimated N/A) when raw missing.
            if not basic.get('debt_to_equity'):
                basic_est['debt_to_equity'] = False
                basic['debt_to_equity_note'] = 'تقديري غير متاح'
            else:
                basic_est['debt_to_equity'] = False

            # P/E + P/B flags — never estimated (raw inputs used for derivation)
            val_est.setdefault('pe_ratio', False)
            val_est.setdefault('pb_ratio', False)
            val_est.setdefault('ps_ratio', False)
            val_est.setdefault('market_cap', False)

            # Determine top-level estimation_method
            if estimated_count == 0:
                result['estimation_method'] = 'raw'
            elif not raw_present_before:
                # Company had no raw balance sheet / income statement data —
                # everything came from structural estimation.
                result['estimation_method'] = 'structural'
            else:
                result['estimation_method'] = 'mixed'

        # 4. Health score (aggregate)
        result['health_score'] = self._calculate_health_score(result)

        # Default estimation_method when basic info is unavailable
        result.setdefault('estimation_method', 'raw')

        return result if result['found'] else None

    def compute_structural_estimates(self, market_cap, pb_ratio, pe_ratio,
                                     current_price, shares_outstanding=None):
        """
        Structural Estimation for Small Companies
        (دعم البيانات المالية الهيكلية المحسوبة للشركات الصغرى)
        ============================================================

        Computes derived fundamental metrics when raw financial statements
        are missing, using market cap and price multiples (P/B, P/E).

        Formulas:
          - Total Equity (Book Value) = Market Cap / P/B
            (when P/B > 0 and Market Cap > 0)
          - Book Value Per Share = Total Equity / Shares Outstanding
            (or Current Price / P/B as fallback when shares unknown)
          - Net Income = Market Cap / P/E (when P/E > 0)
          - ROE (%) = (Net Income / Total Equity) * 100
          - Debt-to-Equity — cannot be derived without total debt;
            marked as 'تقديري غير متاح' (estimated N/A)
          - EPS = Current Price / P/E (when P/E > 0)

        All non-null values are flagged with is_estimated = True so the
        frontend can show a "تقديري" badge. Division-by-zero is guarded.

        Returns:
            dict with keys: total_equity, book_value_per_share, net_income,
            roe, eps, debt_to_equity, debt_to_equity_note, is_estimated
        """
        def _num(x):
            try:
                v = float(x) if x is not None else 0.0
                return v if v == v else 0.0  # NaN guard
            except (TypeError, ValueError):
                return 0.0

        mc = _num(market_cap)
        pb = _num(pb_ratio)
        pe = _num(pe_ratio)
        price = _num(current_price)
        shares = _num(shares_outstanding) if shares_outstanding is not None else 0.0

        out: Dict[str, Any] = {'is_estimated': True}

        # Total Equity = Market Cap / P/B (guard P/B=0, Market Cap=0)
        if mc > 0 and pb > 0:
            out['total_equity'] = round(mc / pb, 2)
        else:
            out['total_equity'] = None

        # Book Value Per Share = Total Equity / Shares Outstanding
        # (or Current Price / P/B as fallback when shares unknown)
        if out['total_equity'] is not None and shares > 0:
            out['book_value_per_share'] = round(out['total_equity'] / shares, 4)
        elif price > 0 and pb > 0:
            out['book_value_per_share'] = round(price / pb, 4)
        else:
            out['book_value_per_share'] = None

        # Net Income = Market Cap / P/E (guard P/E=0, Market Cap=0)
        if mc > 0 and pe > 0:
            out['net_income'] = round(mc / pe, 2)
        else:
            out['net_income'] = None

        # ROE (%) = (Net Income / Total Equity) * 100 (guard total_equity=0)
        if (out['net_income'] is not None
                and out['total_equity'] is not None
                and out['total_equity'] > 0):
            out['roe'] = round((out['net_income'] / out['total_equity']) * 100, 2)
        else:
            out['roe'] = None

        # EPS = Current Price / P/E (guard P/E=0, price=0)
        if price > 0 and pe > 0:
            out['eps'] = round(price / pe, 4)
        else:
            out['eps'] = None

        # Debt-to-Equity — cannot be derived without total debt
        out['debt_to_equity'] = None
        out['debt_to_equity_note'] = 'تقديري غير متاح'

        return out

    def _calculate_health_score(self, data: Dict) -> Dict:
        """حساب نقاط الصحة للسهم (0-100)"""
        score = 50
        factors = []

        # Profitability
        prof = data.get('profitability', {})
        if prof:
            if prof.get('net_margin', 0) > 15:
                score += 10; factors.append("هامش صافي ربح > 15%")
            if prof.get('roe', 0) > 15:
                score += 10; factors.append("ROE > 15%")
            if prof.get('gross_margin', 0) > 30:
                score += 5; factors.append("هامش إجمالي > 30%")

        # Valuation
        val = data.get('valuation', {})
        if val:
            pe = val.get('pe_ratio', 0)
            if 0 < pe < 10:
                score += 15; factors.append(f"P/E منخفض ({pe:.1f})")
            elif pe > 30:
                score -= 10; factors.append(f"P/E مرتفع ({pe:.1f})")

        # Dividends
        div = data.get('dividends', {})
        if div:
            if div.get('div_yield', 0) > 3:
                score += 10; factors.append(f"توزيع أرباح {div['div_yield']:.1f}%")

        # Performance
        perf = data.get('performance', {})
        if perf:
            if perf.get('perf_1y', 0) > 20:
                score += 10; factors.append(f"أداء سنوي +{perf['perf_1y']:.0f}%")
            elif perf.get('perf_1y', 0) < -20:
                score -= 15; factors.append(f"أداء سنوي {perf['perf_1y']:.0f}%")

        # Technical
        tech = data.get('technical', {})
        if tech:
            rating = str(tech.get('technical_rating', '')).lower()
            if 'strong buy' in rating:
                score += 10; factors.append("تقييم فني: شراء قوي")
            elif 'buy' in rating:
                score += 5; factors.append("تقييم فني: شراء")
            elif 'sell' in rating:
                score -= 10; factors.append("تقييم فني: بيع")

        score = max(0, min(100, score))

        if score >= 80:
            label, color = "ممتاز", "emerald"
        elif score >= 65:
            label, color = "جيد", "green"
        elif score >= 50:
            label, color = "متوسط", "amber"
        elif score >= 35:
            label, color = "ضعيف", "orange"
        else:
            label, color = "خطر", "red"

        return {
            'score': score,
            'label': label,
            'color': color,
            'factors': factors,
        }

    def get_market_overview(self) -> Dict:
        """نظرة عامة على السوق من data-engine.db"""
        conn = self._get_de_conn()
        if not conn:
            return {'error': 'data-engine.db not found'}

        cur = conn.cursor()
        overview = {}

        # Top performers
        try:
            rows = cur.execute("""
                SELECT symbol, name, price, change_percent, perf_1w, perf_1m, perf_1y
                FROM tab_performance
                WHERE market = 'مصر' OR market = 'EGX'
                ORDER BY CAST(change_percent AS REAL) DESC LIMIT 10
            """).fetchall()
            overview['top_performers'] = [dict(r) for r in rows]
        except: overview['top_performers'] = []

        # Best value (low P/E) — DATA-ENGINE-UNIFY-1 Stage 2a: tab_* uses symbol (not ticker)
        try:
            rows = cur.execute("""
                SELECT v.symbol AS symbol, v.pe_ratio, v.ps_ratio, v.market_cap,
                       p.net_margin, p.roe
                FROM tab_valuation v
                LEFT JOIN tab_profitability p ON v.symbol = p.symbol AND v.market = p.market
                WHERE CAST(v.pe_ratio AS REAL) > 0 AND CAST(v.pe_ratio AS REAL) < 15
                ORDER BY CAST(v.pe_ratio AS REAL) ASC LIMIT 10
            """).fetchall()
            overview['best_value'] = [dict(r) for r in rows]
        except: overview['best_value'] = []

        # Best dividends
        try:
            rows = cur.execute("""
                SELECT symbol, dps_ttm, div_yield, payout_ratio
                FROM tab_dividends
                WHERE CAST(div_yield AS REAL) > 3
                ORDER BY CAST(div_yield AS REAL) DESC LIMIT 10
            """).fetchall()
            overview['best_dividends'] = [dict(r) for r in rows]
        except: overview['best_dividends'] = []

        # Technical ratings summary
        try:
            rows = cur.execute("""
                SELECT technical_rating, COUNT(*) as cnt
                FROM tab_technical_analysis
                GROUP BY technical_rating
                ORDER BY cnt DESC
            """).fetchall()
            overview['technical_summary'] = [dict(r) for r in rows]
        except: overview['technical_summary'] = []

        conn.close()
        return overview


# Convenience functions
def get_stock_profile(ticker: str) -> Optional[Dict]:
    engine = StockFundamentals()
    return engine.get_stock_full_profile(ticker)

def get_market_overview() -> Dict:
    engine = StockFundamentals()
    return engine.get_market_overview()
