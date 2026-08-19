"""
Persona Investor - المستثمر (طويل المدى)
@version 2.0.0

منطق المستثمر:
- P/E, P/B (تقييم مقابل القطاع)
- dividend yield (التوزيعات)
- debt/equity (المديونية)
- ROE, ROA (الربحية)
- fair value gap (الفرق عن القيمة العادلة)
- beta (التذبذب)
- profit margin (هامش الربح)

القرارات: "شراء قوي" / "شراء" / "انتظر" / "بيع" / "بيع قوي" / "ابعد"
النصوص بالعربى العامى.
الإطار الزمني: 6-12 شهر.
"""

from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field
import sqlite3
import os
from pathlib import Path

from analyzers.support_resistance_calculator import calculate_support_resistance

_PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')


# 🧠 الخبير v3: حساب high_52w, low_52w من price_history
_inv_price_cache: Dict[str, list] = {}


def _inv_load_price_history(ticker: str) -> list:
    """حمّل آخر 260 يوم من price_history للسهم (مع cache)."""
    if ticker in _inv_price_cache:
        return _inv_price_cache[ticker]
    try:
        conn = sqlite3.connect(STOCKS_DB)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute('''
            SELECT date, high_price, low_price, close_price, volume
            FROM stock_price_history
            WHERE ticker = ?
            ORDER BY date DESC
            LIMIT 260
        ''', (ticker,))
        rows = cur.fetchall()
        conn.close()
        _inv_price_cache[ticker] = [dict(r) for r in rows]
        return _inv_price_cache[ticker]
    except Exception:
        _inv_price_cache[ticker] = []
        return []


def _inv_compute_52w(ticker: str) -> tuple:
    """حساب high_52w و low_52w من آخر 252 يوم."""
    rows = _inv_load_price_history(ticker)
    if not rows:
        return 0.0, 0.0
    highs = [r['high_price'] for r in rows if r.get('high_price') and r['high_price'] > 0]
    lows = [r['low_price'] for r in rows if r.get('low_price') and r['low_price'] > 0]
    return (max(highs) if highs else 0.0, min(lows) if lows else 0.0)


def _inv_compute_rsi(ticker: str, period: int = 14) -> float:
    """حساب RSI من price_history (fallback لو مفيش في stocks table)."""
    rows = _inv_load_price_history(ticker)
    if len(rows) < period + 1:
        return 0.0
    # rows مرتبة DESC (الأحدث أول) — نعكسها
    closes = [r['close_price'] for r in reversed(rows) if r.get('close_price') and r['close_price'] > 0]
    if len(closes) < period + 1:
        return 0.0
    gains = []
    losses = []
    for i in range(1, len(closes)):
        change = closes[i] - closes[i - 1]
        if change > 0:
            gains.append(change)
            losses.append(0)
        else:
            gains.append(0)
            losses.append(abs(change))
    if len(gains) < period:
        return 0.0
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return round(rsi, 2)


@dataclass
class InvestorResult:
    verdict: str  # "شراء قوي" / "شراء" / "انتظر" / "بيع" / "بيع قوي" / "ابعد"
    score: float  # 0-100
    reason: str  # شرح بالعربى العامي
    signal: str  # BUY / SELL / HOLD
    entry: Optional[float] = None
    target: Optional[float] = None
    stop: Optional[float] = None
    timeframe: str = '6-12 شهر'
    conditions: List[str] = field(default_factory=list)
    fair_value: Optional[float] = None
    # 🧠 S/R info (so frontend can display real levels)
    support: Optional[float] = None
    resistance: Optional[float] = None
    zone: Optional[str] = None
    rr: Optional[float] = None
    # 📊 أهداف القيمة العادلة + وقف القصة
    fair_value_gap_pct: float = 0.0  # الفرق عن القيمة العادلة (موجب = رخيص)
    target_1: float = 0.0  # الهدف الأول (40% من الفرق)
    target_2: float = 0.0  # الهدف التاني (80% من الفرق)
    target_3: float = 0.0  # الهدف التالت (5% فوق القيمة العادلة)
    trailing_stop: float = 0.0  # وقف مبنى على الدعم/المقاومة
    trailing_stop_logic: str = ''  # شرح الوقف بالعربى
    story_change_stop: bool = False  # هل نستخدم منطق "اتغيرت القصة"؟
    # 🎯 Leading Indicator Proxy (جديد — كشف تغير القصة قبل ما يحصل)
    story_status: str = 'intact'  # 'intact' | 'warning' | 'broken'
    story_warning_reason: str = ''  # سبب التحذير بالعربي
    story_sectors_divergence: float = 0.0  # الفرق بين أداء السهم والقطاع (20 يوم)
    story_volume_anomaly: float = 0.0  # نسبة الحجم للمتوسط (3x+ = anomaly)
    regime_note: str = ''  # ملاحظة عن تعديل الأهداف حسب وضع السوق
    score_breakdown: Dict = field(default_factory=dict)  # تفصيل كل عامل في النتيجة


def _clamp(v: float, lo: float = 0, hi: float = 100) -> float:
    return max(lo, min(hi, v))


def _get_sector_avg_pe(sector: str) -> Optional[float]:
    """متوسط P/E للقطاع من stocks.db (للمقارنة)."""
    try:
        conn = sqlite3.connect(STOCKS_DB)
        cur = conn.cursor()
        cur.execute('''
            SELECT AVG(pe_ratio) FROM stocks
            WHERE sector = ? AND pe_ratio IS NOT NULL AND pe_ratio > 0 AND pe_ratio < 100
        ''', (sector,))
        row = cur.fetchone()
        conn.close()
        if row and row[0]:
            return float(row[0])
        return None
    except Exception:
        return None


def _get_sector_avg_pb(sector: str) -> Optional[float]:
    """متوسط P/B للقطاع من stocks.db (لحساب القيمة العادلة)."""
    try:
        conn = sqlite3.connect(STOCKS_DB)
        cur = conn.cursor()
        cur.execute('''
            SELECT AVG(pb_ratio) FROM stocks
            WHERE sector = ? AND pb_ratio IS NOT NULL AND pb_ratio > 0 AND pb_ratio < 50
        ''', (sector,))
        row = cur.fetchone()
        conn.close()
        if row and row[0]:
            return float(row[0])
        return None
    except Exception:
        return None


def _calculate_fair_value(
    eps: float,
    pe_ratio: float,
    bvps: float,
    pb_ratio: float,
    sector: str,
    market_regime: str,
) -> tuple:
    """
    حساب القيمة العادلة من الأساسيات (EPS × P/E قطاع + BVPS × P/B قطاع).
    بترجع (fair_value, fair_value_gap_pct) — لو مفيش بيانات كافية بترجع (0.0, 0.0)
    """
    try:
        sector_avg_pe = _get_sector_avg_pe(sector)
        sector_avg_pb = _get_sector_avg_pb(sector)

        # حساب القيمة العادلة من EPS و P/E
        fv_pe = 0.0
        if eps and eps > 0 and sector_avg_pe and sector_avg_pe > 0:
            fv_pe = eps * sector_avg_pe

        # حساب القيمة العادلة من BVPS و P/B
        fv_pb = 0.0
        if bvps and bvps > 0 and sector_avg_pb and sector_avg_pb > 0:
            fv_pb = bvps * sector_avg_pb

        # لو الاتنين متاحين: المتوسط
        # لو واحد بس: نستخدمه
        # لو مفيش: 0
        if fv_pe > 0 and fv_pb > 0:
            fair_value = (fv_pe + fv_pb) / 2.0
        elif fv_pe > 0:
            fair_value = fv_pe
        elif fv_pb > 0:
            fair_value = fv_pb
        else:
            return 0.0, 0.0

        # تعديل حسب وضع السوق
        # السوق الصاعد: المستثمر مستعد يدفع أكتر (+10%)
        # السوق النازل: طالب خصم (-10%)
        # السوق العرضي: بدون تعديل
        if market_regime == 'BULL':
            fair_value *= 1.10
        elif market_regime == 'BEAR':
            fair_value *= 0.90
        # SIDEWAYS → × 1.0 (بدون تعديل)

        return round(fair_value, 2), 0.0  # gap_pct بيحسب بعد ما نعرف current_price
    except Exception:
        return 0.0, 0.0


def _get_fair_value_from_data_engine(ticker: str) -> Optional[float]:
    """محاولة جلب القيمة العادلة من data_engine.db (tab_valuation)."""
    try:
        if not os.path.exists(DATA_ENGINE_DB):
            return None
        conn = sqlite3.connect(DATA_ENGINE_DB)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        # جدول tab_valuation فيه fair_value أو similar
        cur.execute('''
            SELECT symbol, pe_ratio, pb_ratio, fair_value FROM tab_valuation
            WHERE symbol = ? LIMIT 1
        ''', (ticker.upper(),))
        row = cur.fetchone()
        conn.close()
        if row and row['fair_value']:
            return float(row['fair_value'])
        return None
    except Exception:
        return None


def _detect_story_change_proxy(ticker: str, sector: str) -> dict:
    """
    كشف تغير "القصة" الأساسية للسهم باستخدام proxy من Price Action.
    
    لما بدنا نعمل.leading indicators بديل للـ fundamentals المتأخرة:
    1. Price vs Sector Divergence: السهم نازل 15%+ والقطاع طالع = "story change" محتمل
    2. Volume Anomaly: حجم ضخم 3x+ + سعر نازل = "smart money" بيبيع
    3. Support Break: كسر دعم رئيسي = تأكيد تغير القصة
    
    Returns:
        dict: {
            'status': 'intact' | 'warning' | 'broken',
            'reason': str,
            'sectors_divergence': float,
            'volume_anomaly': float,
        }
    """
    result = {
        'status': 'intact',
        'reason': '',
        'sectors_divergence': 0.0,
        'volume_anomaly': 0.0,
    }
    
    try:
        rows = _inv_load_price_history(ticker)
        if not rows or len(rows) < 20:
            return result
        
        # rows مرتبة DESC — نعكسها
        rows_asc = list(reversed(rows))
        closes = [r['close_price'] for r in rows_asc if r.get('close_price') and r['close_price'] > 0]
        volumes = [r['volume'] for r in rows_asc if r.get('volume') and r['volume'] > 0]
        
        if len(closes) < 20:
            return result
        
        current_price = closes[-1]
        price_20d_ago = closes[-20] if len(closes) >= 20 else closes[0]
        stock_change_20d = (current_price - price_20d_ago) / price_20d_ago if price_20d_ago > 0 else 0
        
        # 1. Price vs Sector Divergence
        sector_change_20d = 0.0
        try:
            conn = sqlite3.connect(STOCKS_DB)
            cur = conn.cursor()
            cur.execute('''
                SELECT AVG(
                    CASE WHEN prev_close > 0 
                    THEN (close - prev_close) * 1.0 / prev_close 
                    ELSE 0 END
                ) as avg_change
                FROM stocks
                WHERE sector = ? AND close IS NOT NULL AND prev_close IS NOT NULL AND prev_close > 0
                LIMIT 50
            ''', (sector,))
            row = cur.fetchone()
            if row and row[0]:
                sector_change_20d = float(row[0]) * 20  # تقريبي: نضرب في 20 عشان نحصل على تغير 20 يوم
            conn.close()
        except Exception:
            pass
        
        # الفرق بين أداء السهم والقطاع
        divergence = stock_change_20d - sector_change_20d
        result['sectors_divergence'] = round(divergence * 100, 2)  # كنسبة مئوية
        
        # السهم نزل 15%+ والقطاع طالع = "story change" محتمل
        if stock_change_20d < -0.15 and sector_change_20d > 0:
            result['status'] = 'warning'
            result['reason'] = f'⚠️ السهم نزل {stock_change_20d*100:.1f}% والقطاع طالع {sector_change_20d*100:.1f}% — السهم منفصل عن قطاعه، تحقق من أخبار الشركة'
        elif divergence < -0.20:
            result['status'] = 'warning'
            result['reason'] = f'⚠️ أداء السهم أضعف من القطاع بنسبة {abs(divergence)*100:.1f}% — ممكن يكون فيه مشكلة شركة'
        
        # 2. Volume Anomaly
        if len(volumes) >= 20:
            vol_avg_20 = sum(volumes[-20:]) / 20
            vol_recent_5 = sum(volumes[-5:]) / 5 if len(volumes) >= 5 else vol_avg_20
            vol_ratio = vol_recent_5 / vol_avg_20 if vol_avg_20 > 0 else 1.0
            result['volume_anomaly'] = round(vol_ratio, 2)
            
            # حجم ضخم 3x+ + سعر نازل = "smart money" بيبيع
            if vol_ratio >= 3.0 and stock_change_20d < -0.05:
                if result['status'] != 'broken':
                    result['status'] = 'warning'
                    reason_add = f'حجم ضخم {vol_ratio:.1f}x المتوسط + نزول {stock_change_20d*100:.1f}% — تصريف ذكي محتمل'
                    result['reason'] = f'{result["reason"]} | {reason_add}' if result['reason'] else f'⚠️ {reason_add}'
        
        # 3. Support Break (using S/R calculator)
        try:
            from analyzers.support_resistance_calculator import calculate_support_resistance
            sr = calculate_support_resistance(ticker)
            if sr and sr.get('support') and sr['support'] > 0:
                if current_price < sr['support'] * 0.98:
                    result['status'] = 'broken'
                    reason_add = f'كسر دعم رئيسي {sr["support"]:.2f} — القصة اتغيرت فعلاً'
                    result['reason'] = f'{result["reason"]} | 🚨 {reason_add}' if result['reason'] else f'🚨 {reason_add}'
        except Exception:
            pass
        
    except Exception:
        pass
    
    return result


def analyze_investor(
    ticker: str,
    stock: Dict[str, Any],
    context: Dict[str, Any],
    master_score_v13: float = 0.0,  # Phase 8.1: Score from V13 Quant Engine
) -> InvestorResult:
    """
    تحليل المستثمر للسهم.
    stock: بيانات من stocks.db (pe_ratio, pb_ratio, dividend_yield, debt_to_equity, roe, roa, beta, profit_margin, book_value_per_share, current_price, sector)
    context: MaestroHumanContext كـ dict
    """
    conditions: List[str] = []
    score = 0.0
    score_breakdown: Dict[str, float] = {}  # 📊 تفصيل كل عامل في النتيجة

    current_price = float(stock.get('current_price') or 0)
    if current_price <= 0:
        return InvestorResult(
            verdict='ابعد', score=0, reason='مفيش سعر متاح للسهم.',
            signal='HOLD', conditions=['السعر غير متاح'],
        )

    pe_ratio = float(stock.get('pe_ratio') or 0) if stock.get('pe_ratio') is not None else 0
    pb_ratio = float(stock.get('pb_ratio') or 0) if stock.get('pb_ratio') is not None else 0
    debt_to_equity = float(stock.get('debt_to_equity') or 0) if stock.get('debt_to_equity') is not None else 0
    roe = float(stock.get('roe') or 0) if stock.get('roe') is not None else 0
    roa = float(stock.get('roa') or 0) if stock.get('roa') is not None else 0
    beta = float(stock.get('beta') or 0) if stock.get('beta') is not None else 0
    profit_margin = float(stock.get('profit_margin') or 0) if stock.get('profit_margin') is not None else 0
    book_value_per_share = float(stock.get('book_value_per_share') or 0) if stock.get('book_value_per_share') is not None else 0
    sector = stock.get('sector') or ''
    # 📊 EPS للقيمة العادلة
    eps = float(stock.get('eps') or 0) if stock.get('eps') is not None else 0

    # من context
    tc = context.get('time_context', {}) or {}
    mc = context.get('market_context', {}) or {}
    market_regime = mc.get('regime', 'SIDEWAYS')
    change_1y = tc.get('change_1y')
    # 🧠 الخبير v3: dividend_yield مش موجود في stocks table — نحاول من context أو نتجاهل
    dividend_yield = float(tc.get('dividend_yield') or 0)
    # 🧠 الخبير v3: high_52w, low_52w من price_history (مش من stocks table)
    high_52w, low_52w = _inv_compute_52w(ticker)
    if not high_52w:
        high_52w = tc.get('high_52w') or float(stock.get('high_52w') or 0)
    if not low_52w:
        low_52w = tc.get('low_52w') or float(stock.get('low_52w') or 0)

    # 🧠 الخبير v3: RSI fallback من price_history
    rsi = float(stock.get('rsi') or 0)
    if rsi <= 0:
        rsi = _inv_compute_rsi(ticker, 14)

    # 🧠 الخبير v3: MA_50 fallback من price_history
    ma_50 = float(stock.get('ma_50') or 0)
    if ma_50 <= 0:
        rows = _inv_load_price_history(ticker)
        if rows:
            closes_50 = [r['close_price'] for r in rows[:50] if r.get('close_price') and r['close_price'] > 0]
            if closes_50:
                ma_50 = sum(closes_50) / len(closes_50)

    # ========== 1. P/E Ratio ==========
    # للبنوك والتأمين: P/E مش متاح عادة، نعتمد على P/B و ROE بدلاً منه
    is_financial = any(k in (sector or '').lower() for k in ['مالي', 'بنك', 'تأمين', 'financial', 'bank', 'insurance'])

    if pe_ratio > 0:
        sector_pe = _get_sector_avg_pe(sector)
        if pe_ratio < 8:
            score += 25
            conditions.append(f'P/E منخفض جداً ({pe_ratio:.1f}) — سهم مُقَيَّم بأقل من قيمته')
            score_breakdown['pe_ratio'] = 25
        elif pe_ratio < 12:
            score += 18
            conditions.append(f'P/E كويس ({pe_ratio:.1f})')
            score_breakdown['pe_ratio'] = 18
        elif pe_ratio < 20:
            score += 8
            conditions.append(f'P/E عادي ({pe_ratio:.1f})')
            score_breakdown['pe_ratio'] = 8
        elif pe_ratio < 35:
            score -= 5
            conditions.append(f'P/E مرتفع ({pe_ratio:.1f})')
            score_breakdown['pe_ratio'] = -5
        else:
            score -= 15
            conditions.append(f'P/E مبالغ فيه ({pe_ratio:.1f}) — السهم غالي')
            score_breakdown['pe_ratio'] = -15

        if sector_pe and sector_pe > 0:
            pe_discount = ((sector_pe - pe_ratio) / sector_pe) * 100
            if pe_discount > 30:
                score += 12
                conditions.append(f'خصم {pe_discount:.0f}% عن متوسط القطاع ({sector_pe:.1f})')
                score_breakdown['pe_vs_sector'] = 12
            elif pe_discount > 15:
                score += 6
                conditions.append(f'أرخص من القطاع بـ {pe_discount:.0f}%')
                score_breakdown['pe_vs_sector'] = 6
            elif pe_discount < -30:
                score -= 8
                conditions.append(f'أغلى من القطاع بـ {abs(pe_discount):.0f}%')
                score_breakdown['pe_vs_sector'] = -8
    elif is_financial:
        # بنوك/تأمين: P/E مش متاح = طبيعي، مفيش عقاب
        conditions.append('P/E غير متاح — بنك/تأمين (نعتمد على P/B و ROE)')
    else:
        conditions.append('P/E غير متاح')

    # ========== 2. P/B Ratio ==========
    if pb_ratio > 0:
        if pb_ratio < 1.0:
            score += 20
            conditions.append(f'P/B أقل من 1 ({pb_ratio:.2f}) — يتداول بأقل من قيمته الدفترية')
            score_breakdown['pb_ratio'] = 20
        elif pb_ratio < 1.5:
            score += 12
            conditions.append(f'P/B كويس ({pb_ratio:.2f})')
            score_breakdown['pb_ratio'] = 12
        elif pb_ratio < 3.0:
            score += 4
            conditions.append(f'P/B عادي ({pb_ratio:.2f})')
            score_breakdown['pb_ratio'] = 4
        elif pb_ratio > 5.0:
            score -= 10
            conditions.append(f'P/B مرتفع ({pb_ratio:.2f}) — مبالغ فيه')
            score_breakdown['pb_ratio'] = -10

    # ========== 3. Dividend Yield ==========
    if dividend_yield > 0:
        if dividend_yield >= 7:
            score += 22
            conditions.append(f'توزيعات عالية جداً ({dividend_yield:.1f}%) 💰')
            score_breakdown['dividend_yield'] = 22
        elif dividend_yield >= 5:
            score += 16
            conditions.append(f'توزيعات ممتازة ({dividend_yield:.1f}%)')
            score_breakdown['dividend_yield'] = 16
        elif dividend_yield >= 3:
            score += 10
            conditions.append(f'توزيعات كويسة ({dividend_yield:.1f}%)')
            score_breakdown['dividend_yield'] = 10
        elif dividend_yield >= 1:
            score += 4
            conditions.append(f'توزيعات بسيطة ({dividend_yield:.1f}%)')
            score_breakdown['dividend_yield'] = 4
        # 0 توزيعات = ليس بالضرورة سيء (شركات نمو)

    # ========== 4. ROE (الربحية) ==========
    if roe > 0:
        if roe >= 20:
            score += 20
            conditions.append(f'ROE ممتاز ({roe:.1f}%) — الشركة بتكسب كويس')
            score_breakdown['roe'] = 20
        elif roe >= 15:
            score += 12
            conditions.append(f'ROE كويس ({roe:.1f}%)')
            score_breakdown['roe'] = 12
        elif roe >= 10:
            score += 6
            conditions.append(f'ROE عادي ({roe:.1f}%)')
            score_breakdown['roe'] = 6
        elif roe < 5:
            score -= 8
            conditions.append(f'ROE ضعيف ({roe:.1f}%) — الربحية مش كويسة')
            score_breakdown['roe'] = -8

    # ========== 5. Debt to Equity ==========
    # ملاحظة: البنوك بطبيعتها D/E عالي جداً (ودائع = ديون)، فبنتجاهله للقطاع المالي
    if is_financial:
        # للبنوك: نتجاهل D/E ونضيف نقطة على الاستقرار
        if debt_to_equity < 5:  # بنوك D/E بتبقى عالية جداً عادي
            score += 8
            conditions.append('بنك/تأمين — ميزانية مستقرة')
            score_breakdown['debt_to_equity'] = 8
    elif debt_to_equity > 0:
        if debt_to_equity < 0.3:
            score += 15
            conditions.append(f'ديون منخفضة جداً (D/E {debt_to_equity:.2f}) — ميزانية قوية')
            score_breakdown['debt_to_equity'] = 15
        elif debt_to_equity < 0.8:
            score += 8
            conditions.append(f'ديون تحت السيطرة (D/E {debt_to_equity:.2f})')
            score_breakdown['debt_to_equity'] = 8
        elif debt_to_equity < 1.5:
            score += 0
            conditions.append(f'ديون متوسطة (D/E {debt_to_equity:.2f})')
            score_breakdown['debt_to_equity'] = 0
        elif debt_to_equity > 2.5:
            score -= 15
            conditions.append(f'ديون مرتفعة (D/E {debt_to_equity:.2f}) — خطر')
            score_breakdown['debt_to_equity'] = -15

    # ========== 6. Profit Margin ==========
    if profit_margin > 0:
        if profit_margin >= 20:
            score += 12
            conditions.append(f'هامش ربح ممتاز ({profit_margin:.1f}%)')
            score_breakdown['profit_margin'] = 12
        elif profit_margin >= 10:
            score += 6
            conditions.append(f'هامش ربح كويس ({profit_margin:.1f}%)')
            score_breakdown['profit_margin'] = 6
        elif profit_margin < 3:
            score -= 5
            conditions.append(f'هامش ربح ضعيف ({profit_margin:.1f}%)')
            score_breakdown['profit_margin'] = -5

    # ========== 7. Beta (التذبذب) ==========
    if beta > 0:
        if beta < 0.8:
            score += 8
            conditions.append(f'Beta منخفض ({beta:.2f}) — سهم مستقر')
            score_breakdown['beta'] = 8
        elif beta > 1.5:
            score -= 5
            conditions.append(f'Beta مرتفع ({beta:.2f}) — تذبذب عالي')
            score_breakdown['beta'] = -5

    # ========== 8. القيمة العادلة (fair_value) ==========
    # أول: نحسب من الأساسيات (EPS × P/E قطاع + BVPS × P/B قطاع)
    calc_fv, _ = _calculate_fair_value(eps, pe_ratio, book_value_per_share, pb_ratio, sector, market_regime)

    # لو مفيش بيانات كافية: نحاول من data_engine.db
    de_fv = _get_fair_value_from_data_engine(ticker)

    # الأولوية: القيمة المحسوبة من الأساسيات > data_engine > تقدير بسيط
    fair_value = 0.0
    fair_value_gap_pct = 0.0
    regime_note = ''

    if calc_fv and calc_fv > 0:
        fair_value = calc_fv
        # ملاحظة الوضع
        if market_regime == 'BULL':
            regime_note = 'القيمة العادلة بعدلها +10% عشان السوق صاعد'
        elif market_regime == 'BEAR':
            regime_note = 'القيمة العادلة بعدلها -10% عشان السوق نازل (خصم أمان)'
    elif de_fv and de_fv > 0:
        fair_value = de_fv
        regime_note = 'القيمة العادلة من data_engine'
    elif book_value_per_share > 0 and pb_ratio > 0:
        # تقدير بسيط: القيمة العادلة = book_value * متوسط P/B للقطاع (~1.5)
        fair_value = book_value_per_share * 1.5
        regime_note = 'تقدير بسيط من القيمة الدفترية'

    # حساب fair_value_gap_pct
    if fair_value and fair_value > 0 and current_price > 0:
        fair_value_gap_pct = round(((fair_value - current_price) / current_price) * 100, 2)

    if fair_value and fair_value > 0:
        upside = ((fair_value - current_price) / current_price) * 100
        if upside > 30:
            score += 25
            conditions.append(f'القيمة العادلة {fair_value:.1f} — فرصة {upside:.0f}% صعود')
            score_breakdown['fair_value'] = 25
        elif upside > 15:
            score += 15
            conditions.append(f'القيمة العادلة {fair_value:.1f} — خصم {upside:.0f}%')
            score_breakdown['fair_value'] = 15
        elif upside > 5:
            score += 5
            conditions.append(f'القيمة العادلة {fair_value:.1f} — خصم {upside:.0f}%')
            score_breakdown['fair_value'] = 5
        elif upside < -20:
            score -= 15
            conditions.append(f'السهم فوق قيمته العادلة بـ {abs(upside):.0f}% — غالي')
            score_breakdown['fair_value'] = -15

    # ========== 9. وضع السوق ==========
    if market_regime == 'BEAR':
        # السوق النازل = فرص شراء للمستثمر طويل المدى
        score += 5
        conditions.append('السوق نازل — فرصة شراء للمستثمر الصبور')
        score_breakdown['market_regime'] = 5
    elif market_regime == 'BULL':
        # السوق الصاعد = ممكن الأسهم تكون غالية
        score -= 3
        score_breakdown['market_regime'] = -3

    # ========== 10. المسافة من القمة السنوية ==========
    if high_52w > 0 and current_price > 0:
        distance_from_high = ((high_52w - current_price) / high_52w) * 100
        if distance_from_high > 30:
            score += 10
            conditions.append(f'السهم نزل {distance_from_high:.0f}% من قمته السنوية — فرصة')
            score_breakdown['distance_from_high'] = 10

    # ========== 11. Bank Quality Bonus ==========
    # للبنوك: لو التوزيعات >= 5% و ROE >= 15% و P/B < 2.5 → bonus إضافي
    if is_financial and dividend_yield >= 5 and roe >= 15 and 0 < pb_ratio < 2.5:
        score += 15
        conditions.append('بنك قوي: توزيعات +5% و ROE +15% و P/B معقول — أساسيات ممتازة')
        score_breakdown['bank_quality'] = 15

    # ========== 12. 🧠 الخبير v3: Technical Scoring (دائماً) ==========
    # المستخدم اشتكى: Investor بيرجع HOLD لكل الأسهم
    # السبب: الأساسيات ناقصة (ROE=0, PB=0, dividend_yield missing)
    # الحل: نضيف التقني كـ scoring إضافي دائماً (مش بس لما الأساسيات تنقص)
    fundamentals_missing = (pb_ratio <= 0 and roe <= 0)
    if fundamentals_missing:
        conditions.append('الأساسيات ناقصة — الاعتماد على التحليل التقني')

    # 12a. RSI تشبع بيعي = فرصة شراء للمستثمر
    if rsi > 0 and rsi < 30:
        score += 22
        conditions.append(f'RSI {rsi:.0f} — تشبع بيعي حاد، السهم ناضي')
        score_breakdown['rsi'] = 22
    elif rsi > 0 and rsi < 40:
        score += 14
        conditions.append(f'RSI {rsi:.0f} — قرب التشبع البيعي')
        score_breakdown['rsi'] = 14
    elif rsi > 0 and rsi < 50:
        score += 6
        conditions.append(f'RSI {rsi:.0f} — زخم ضعيف')
        score_breakdown['rsi'] = 6
    elif rsi > 0 and rsi > 75:
        score -= 10
        conditions.append(f'RSI {rsi:.0f} — تشبع شرائي، السهم غالي')
        score_breakdown['rsi'] = -10

    # 12b. السعر تحت MA_50 = تصحيح (فرصة)
    if ma_50 > 0 and current_price > 0:
        if current_price < ma_50 * 0.85:
            score += 18
            conditions.append(f'السعر تحت MA_50 بـ 15%+ — تصحيح قوي')
            score_breakdown['below_ma50'] = 18
        elif current_price < ma_50 * 0.92:
            score += 12
            conditions.append(f'السعر تحت MA_50 بـ 8%+ — تصحيح')
            score_breakdown['below_ma50'] = 12
        elif current_price < ma_50 * 0.98:
            score += 5
            conditions.append(f'السعر تحت MA_50 — تصحيح بسيط')
            score_breakdown['below_ma50'] = 5
        elif current_price > ma_50 * 1.15:
            score -= 8
            conditions.append(f'السعر فوق MA_50 بـ 15%+ — ممكن يكون غالي')
            score_breakdown['below_ma50'] = -8

    # 12c. المسافة من القاع السنوي
    if low_52w > 0 and current_price > 0:
        distance_from_low = ((current_price - low_52w) / low_52w) * 100
        if 0 < distance_from_low < 10:
            score += 18
            conditions.append(f'على القاع السنوي ({distance_from_low:.1f}% من القاع) — فرصة')
            score_breakdown['near_52w_low'] = 18
        elif distance_from_low < 25:
            score += 8
            conditions.append(f'قرب القاع السنوي ({distance_from_low:.1f}%)')
            score_breakdown['near_52w_low'] = 8

    # 12d. حجم التداول (سيولة كافية) — من price_history
    rows = _inv_load_price_history(ticker)
    if rows:
        recent_vols = [r.get('volume') or 0 for r in rows[:30] if (r.get('volume') or 0) > 0]
        avg_vol = sum(recent_vols) / len(recent_vols) if recent_vols else 0
        if avg_vol > 1_000_000:
            score += 8
            conditions.append(f'سيولة قوية (متوسط {avg_vol/1e6:.1f}M/يوم)')
            score_breakdown['liquidity'] = 8
        elif avg_vol > 300_000:
            score += 4
            conditions.append(f'سيولة كافية (متوسط {avg_vol/1e6:.1f}M/يوم)')
            score_breakdown['liquidity'] = 4

    score = _clamp(score)

    # ========== متغيرات الأهداف الجديدة ==========
    target_1 = 0.0
    target_2 = 0.0
    target_3 = 0.0
    trailing_stop = 0.0
    trailing_stop_logic = ''
    story_change_stop = False
    is_fallback = False  # هل الأهداف من S/R حقيقية ولا تقديرية

    # ========== 🎯 كشف تغير القصة (Leading Indicator Proxy) ==========
    story_status = 'intact'
    story_warning_reason = ''
    story_sectors_divergence = 0.0
    story_volume_anomaly = 0.0
    try:
        story_detect = _detect_story_change_proxy(ticker, sector)
        story_status = story_detect.get('status', 'intact')
        story_warning_reason = story_detect.get('reason', '')
        story_sectors_divergence = story_detect.get('sectors_divergence', 0.0)
        story_volume_anomaly = story_detect.get('volume_anomaly', 0.0)
        
        # لو القصة اتغيرت → نعدل الـ score (خصم 10 نقاط)
        if story_status == 'broken':
            score = max(0, score - 15)
            conditions.append(f'⚠️ story_change=broken: {story_warning_reason[:80]}')
        elif story_status == 'warning':
            score = max(0, score - 5)
            conditions.append(f'story_change=warning: {story_warning_reason[:60]}')
    except Exception:
        pass

    # ========== القرار النهائي ==========
    # 🧠 الخبير v7 (يوليو 2026): الـ verdict والـ reason بيتحددوا بعد ما S/R + R/R gates تخلص
    # عشان مفيش تناقض بين "شراء" و "استنى تحسن المؤشرات"
    # الترتيب: score → signal → S/R gates → R/R gates → verdict + reason النهائي

    # 🧠 أساسيات قوية: للتساهل في المنطقة الوسطى
    # المستثمر الصبور ممكن يشتري في المنطقة الوسطى لو الأساسيات قوية
    strong_fundamentals = False
    try:
        sector_pe_val = _get_sector_avg_pe(sector)
        fv_pe_ok = (pe_ratio > 0 and sector_pe_val and sector_pe_val > 0 and pe_ratio < sector_pe_val)
        fv_roe_ok = roe > 15
        fv_div_ok = dividend_yield > 3
        strong_fundamentals = (fv_pe_ok and fv_roe_ok and fv_div_ok)
    except Exception:
        strong_fundamentals = False

    # Phase 8.1: V13 Engine Disconnection Fix
    # الـ Persona بقى "مضاعف" للـ Score الجديد، مش يحسب Score مستقل
    if master_score_v13 > 0:
        # ادمج الـ V13 score مع الـ investor score (V13 = 60%, investor = 40%)
        score = (master_score_v13 * 0.60) + (score * 0.40)
        conditions.append(f'V13 Quant Score: {master_score_v13:.1f} → blended score: {score:.1f}')

    # 1. signal أولي من الـ score (بدون verdict/reason عشان لسه الـ gates هتشتغل)
    # RELAX-INVESTOR-001: خفّفنا العتبات عشان المحرك يطلّع فرص أكتر.
    # قبل كده: score >= 30 → BUY، score 15-30 → HOLD (مرفوض تماماً من investor tab).
    # دلوقتي: score >= 25 → BUY، score 15-25 → ACCUMULATE (يتعرض في investor tab
    # مع ملاحظة "استنى كسر مقاومة")، score < 15 → HOLD.
    if score >= 50:
        signal = 'BUY'
        entry = round(current_price, 2)
    elif score >= 25:
        signal = 'BUY'
        entry = round(current_price, 2)
    elif score >= 15:
        # ACCUMULATE: السهم كويس بس مش قوي كفاية لـ BUY فوري.
        # يتعرض في investor tab مع ملاحظة "استنى تأكيد الكسر".
        signal = 'ACCUMULATE'
        entry = round(current_price, 2)
    elif score >= 10:
        signal = 'HOLD'
        entry = None
        target = None
        stop = None
    else:
        signal = 'HOLD'
        entry = None
        target = None
        stop = None

    # ========== 🧠 الخبير v4: S/R-based target/stop + R/R gating ==========
    # المستخدم اكتشف إن الـ percentage targets (+10%/-12%) فاضية — مش مستويات سعر حقيقية.
    # بدّلناها بـ: target = المقاومة البعيدة (أو القيمة العادلة لو أعلى)،
    # stop = تحت الدعم بـ 3%، مع R/R gate >= 2.0:1.
    # مراجعة (يوليو 2026): كان بيطلب 180 يوم + is_fresh(7 أيام) → كتير من الأسهم
    # كانت بترجع "مفيش بيانات دعم/مقاومة كافية". دلوقتي فيه fallback تدريجي:
    # 180 → 90 → 60 → 30 يوم. ولو كلهم فشلوا، نحسب S/R سريع من المتاح.
    sr_long = None
    for _days in (180, 90, 60, 30):
        sr_long = calculate_support_resistance(ticker, days=_days)
        if sr_long and sr_long.get('is_fresh'):
            break
    # لو لسه مفيش S/R fresh، جرّب آخر واحد متاح (حتى لو مش fresh)
    if not sr_long or not sr_long.get('is_fresh'):
        for _days in (90, 60, 30):
            sr_long = calculate_support_resistance(ticker, days=_days)
            if sr_long:
                break
    sr_short = calculate_support_resistance(ticker, days=90)
    sr_support: Optional[float] = None
    sr_resistance: Optional[float] = None
    sr_zone: Optional[str] = None
    sr_rr: Optional[float] = None

    if not sr_long:
        # fallback أخير: احسب S/R سريع من current_price (لو معروفة)
        # بدل ما نرجّع "انتظر" بشكل أعمى
        # 🚨 FIX: استخدمنا 0.95 بدل 0.92 (أقل عنف)
        if current_price and current_price > 0:
            sr_support = round(current_price * 0.95, 2)  # -5% دعم تقديري
            sr_resistance = round(current_price * 1.15, 2)  # +15% مقاومة تقديرية
            sr_zone = 'middle'
            is_fallback = True
            # كمّل التحليل بالـ fallback values
        else:
            return InvestorResult(
                verdict='انتظر', score=round(score, 1),
                reason='مفيش بيانات سعر كافية للمستثمر',
                signal='HOLD', conditions=conditions + ['لا يوجد سعر'],
                fair_value=fair_value,
                fair_value_gap_pct=fair_value_gap_pct,
                regime_note=regime_note,
                score_breakdown=score_breakdown,
            )
    else:
        sr_support = sr_long['support']
        sr_resistance = sr_long['resistance']
        sr_zone = sr_long['zone']

    # Breakdown على المدى البعيد = بيع قوي
    if sr_long and sr_long.get('zone') == 'breakdown':
        return InvestorResult(
            verdict='بيع قوي', score=round(score, 1),
            reason='السهم كسر كل الدعوم على المدى البعيد — بيع فوري',
            signal='SELL', conditions=conditions + ['zone=breakdown_180d'],
            fair_value=fair_value,
            fair_value_gap_pct=fair_value_gap_pct,
            support=sr_support, resistance=sr_resistance, zone=sr_zone, rr=None,
            regime_note=regime_note,
            score_breakdown=score_breakdown,
        )

    # 🧠 المستثمر الصبور: لو في المنطقة الوسطى بس أساسيات قوية → ACCUMULATE (مش HOLD)
    if sr_zone == 'middle' and strong_fundamentals and signal == 'HOLD' and score >= 15:
        signal = 'ACCUMULATE'
        entry = round(current_price, 2)
        conditions.append('أساسيات قوية (P/E<قطاع، ROE>15%، توزيعات>3%) — المستثمر يشتري النزول')

    # Calculate target/stop from S/R (for BUY and ACCUMULATE signals)
    # RELAX-INVESTOR-001: ACCUMULATE بياخد نفس معالجة الـ BUY (target/stop/R-R)
    # عشان الواجهة تقدر تعرضه كفرصة كاملة مع مستويات دخول/خروج.
    if signal in ('BUY', 'ACCUMULATE'):
        # 📊 حساب 3-tier targets
        # لو في قيمة عادلة: الأهداف مبنية عليها
        # لو مفيش: نستخدم S/R مع إطارات أطول
        if fair_value and fair_value > 0 and fair_value > current_price:
            # أهداف مبنية على القيمة العادلة
            target_1 = round(entry + (fair_value - entry) * 0.4, 2)  # 40% من الفرق
            target_2 = round(entry + (fair_value - entry) * 0.8, 2)  # 80% من الفرق
            target_3 = round(fair_value * 1.05, 2)  # 5% فوق القيمة العادلة (مكافأة الصبر)
            target = target_2  # الهدف الأساسي = 80% من الفرق
            conditions.append(f'الأهداف: T1={target_1} T2={target_2} T3={target_3}')
        elif fair_value and fair_value > 0 and fair_value <= current_price:
            # السهم فوق القيمة العادلة = مبالغ فيه
            # هدف واحد بس: min(entry * 1.03, resistance) — مش نشتري بقوة
            target_1 = round(min(entry * 1.03, sr_resistance or entry * 1.05), 2)
            target = target_1
            conditions.append(f'السهم فوق القيمة العادلة ({fair_value:.1f}) — هدف محافظ T1={target_1}')
        else:
            # مفيش قيمة عادلة: نستخدم S/R مع إطارات أطول من المغامر
            if sr_long:
                target = sr_long.get('far_resistance') or sr_long.get('resistance') or sr_resistance
            else:
                target = sr_resistance  # الـ fallback values (+15% above)
            # أهداف S/R بسيطة (بدون قيمة عادلة)
            target_1 = round(entry + (target - entry) * 0.4, 2) if target and target > entry else 0.0
            target_2 = round(entry + (target - entry) * 0.8, 2) if target and target > entry else 0.0
            target_3 = target or 0.0

        # وقف "تغير القصة": الأساسي مش نسبة — هل الاستثمار اتغير؟
        # الوقف الأولي: تحت الدعم بـ 1%
        if sr_support and sr_support > 0:
            stop = round(sr_support * 0.99, 2)
            trailing_stop = stop
        else:
            # no support available — fallback -10%
            stop = round(current_price * 0.90, 2)
            trailing_stop = stop

        # 🧠 منطق "تغير القصة": المستثمر وقفه مش نسبة — هل القصة اتغيرت؟
        # الفلاغ ده بيروح للـ daily closer بس بنحطه هنا عشان الواجهة تعرضه
        story_change_stop = True
        trailing_stop_logic = 'الوقف: لو اتغيرت القصة الأساسية (EPS نزل، ديون زادت، القطاع ضعف)'

        # R/R for investor must be >= 2.0:1
        # مراجعة (يوليو 2026): خفّضنا من 2.0 → 1.5 عشان نطلّع فرص أكتر
        risk = current_price - stop
        reward = target - current_price
        if risk <= 0:
            return InvestorResult(
                verdict='ابعد', score=round(score, 1),
                reason='السعر فوق الدعم بمرحلة خطرة',
                signal='HOLD', conditions=conditions + ['risk<=0'],
                fair_value=fair_value,
                fair_value_gap_pct=fair_value_gap_pct,
                support=sr_support, resistance=sr_resistance, zone=sr_zone, rr=None,
                trailing_stop=trailing_stop, trailing_stop_logic=trailing_stop_logic,
                story_change_stop=story_change_stop,
                story_status=story_status,
                story_warning_reason=story_warning_reason,
                story_sectors_divergence=story_sectors_divergence,
                story_volume_anomaly=story_volume_anomaly,
                regime_note=regime_note,
                score_breakdown=score_breakdown,
            )

        # 🚨 FIX (يوليو 2026): لو target < entry للشراء = R/R سالب = إشارة فاسدة
        # كان بيرجع "فرصة" بالرغم إن الهدف أقل من الدخول!
        if reward <= 0:
            return InvestorResult(
                verdict='ابعد', score=round(score, 1),
                reason=f'الهدف {target} أقل من سعر الدخول {current_price} — إشارة فاسدة',
                signal='HOLD', conditions=conditions + [f'target<{current_price}'],
                fair_value=fair_value,
                fair_value_gap_pct=fair_value_gap_pct,
                support=sr_support, resistance=sr_resistance, zone=sr_zone, rr=None,
                trailing_stop=trailing_stop, trailing_stop_logic=trailing_stop_logic,
                story_change_stop=story_change_stop,
                story_status=story_status,
                story_warning_reason=story_warning_reason,
                story_sectors_divergence=story_sectors_divergence,
                story_volume_anomaly=story_volume_anomaly,
                regime_note=regime_note,
                score_breakdown=score_breakdown,
            )

        rr = reward / risk
        sr_rr = round(rr, 2)

        # 🚨 FIX: لو R/R < 1.0 = المخاطرة أكبر من الربح = ابعد (مش انتظر)
        if rr < 1.0:
            return InvestorResult(
                verdict='ابعد', score=round(score, 1),
                reason=f"R/R {rr:.2f}:1 — المخاطرة أكبر من الربح. ماتدخلش.",
                signal='HOLD', conditions=conditions + [f'rr={rr:.2f}<1.0'],
                fair_value=fair_value,
                fair_value_gap_pct=fair_value_gap_pct,
                support=sr_support, resistance=sr_resistance, zone=sr_zone, rr=sr_rr,
                trailing_stop=trailing_stop, trailing_stop_logic=trailing_stop_logic,
                story_change_stop=story_change_stop,
                story_status=story_status,
                story_warning_reason=story_warning_reason,
                story_sectors_divergence=story_sectors_divergence,
                story_volume_anomaly=story_volume_anomaly,
                regime_note=regime_note,
                score_breakdown=score_breakdown,
            )

        # مراجعة (يوليو 2026): خفّضنا R/R gate من 2.0 → 1.5 عشان نطلّع فرص أكتر
        # المستخدم اشتكى إن 10 من 12 سهم "انتظر" بسبب R/R ضعيف
        # RELAX-INVESTOR-001: لـ ACCUMULATE، R/R gate أقل (1.2 بدل 1.5).
        # السهم كويس أساسياً بس مش قوي كفاية لـ BUY — نسمح به لو R/R >= 1.2.
        _rr_gate = 1.2 if signal == 'ACCUMULATE' else 1.5
        if rr < _rr_gate:
            return InvestorResult(
                verdict='انتظر', score=round(score, 1),
                reason=f"R/R ضعيف للمستثمر {rr:.2f}:1 — استنى فرصة أحسن",
                signal='HOLD', conditions=conditions + [f'rr={rr:.2f}'],
                fair_value=fair_value,
                fair_value_gap_pct=fair_value_gap_pct,
                support=sr_support, resistance=sr_resistance, zone=sr_zone, rr=sr_rr,
                target_1=target_1, target_2=target_2, target_3=target_3,
                trailing_stop=trailing_stop, trailing_stop_logic=trailing_stop_logic,
                story_change_stop=story_change_stop,
                story_status=story_status,
                story_warning_reason=story_warning_reason,
                story_sectors_divergence=story_sectors_divergence,
                story_volume_anomaly=story_volume_anomaly,
                regime_note=regime_note,
                score_breakdown=score_breakdown,
            )

        target = round(target, 2)
        stop = round(stop, 2)
        # مراجعة: fallback آمن لو sr_long None
        _s_disp = sr_support if sr_support else (sr_long['support'] if sr_long else 0)
        _r_disp = sr_resistance if sr_resistance else (sr_long['resistance'] if sr_long else 0)
        _far_r = sr_long.get('far_resistance', 0) if sr_long else 0
        _zone_disp = sr_long['zone'] if sr_long else (sr_zone or 'middle')
        conditions.append(
            f"S={_s_disp:.2f} R={_r_disp:.2f} "
            f"far_R={_far_r:.2f} "
            f"zone={_zone_disp} R/R={rr:.2f}:1"
        )
        if fair_value and fair_value > 0:
            conditions.append(f"fair_value={fair_value:.2f} gap={fair_value_gap_pct:.1f}%")

        # 🧠 الخبير v7: verdict + reason يتبنوا هنا بعد كل gates عشان متناسقين
        # RELAX-INVESTOR-001: أضفنا verdict لـ ACCUMULATE (تجميع).
        if score >= 50 and rr >= 2.5:
            verdict = 'شراء قوي'
            _base_reason = 'السهم مقيم بأقل من قيمته بفرق واضح، أساسيات قوية، وتوزيعات كويسة.'
        elif score >= 50:
            verdict = 'شراء'
            _base_reason = f'السهم فيه أساسيات قوية — R/R {rr:.2f}:1 مناسب للاستثمار.'
        elif score >= 25:
            verdict = 'شراء'
            _base_reason = f'السهم فيه مؤشرات إيجابية — R/R {rr:.2f}:1.'
        elif signal == 'ACCUMULATE':
            verdict = 'تجميع'
            _base_reason = f'السهم كويس بس مش قوي كفاية لشراء فوري — R/R {rr:.2f}:1. جمّع على النزلات.'
        else:
            verdict = 'انتظر'
            _base_reason = 'السهم أساسياته متوسطة — استنى تحسن المؤشرات أو انخفاض السعر.'

        # HUMANIZE-034: ادمج السرد البشري مع السبب الأساسي
        try:
            from analyzers.narrative_generator import build_humanized_reason
            _humanized = build_humanized_reason(
                ticker=ticker,
                indicators={
                    'rsi': rsi,
                    'macd_hist': 0,  # persona_investor لا يحسب MACD
                    'volume_ratio': vol_ratio if 'vol_ratio' in dir() else 1.0,
                    'bb_lower': None,
                    'bb_upper': None,
                    'sma50': ma_50,
                    'sma200': None,
                },
                pine_flags={
                    'is_golden_pullback': False,
                    'is_dead_cat': False,
                    'is_bullish_divergence': False,
                },
                sr_levels={
                    'support': sr_support,
                    'resistance': sr_resistance,
                    'far_support': None,
                    'far_resistance': None,
                },
                score=score,
                regime=market_regime.lower() if market_regime else 'unknown',
            )
            # ادمج السرد البشري مع السبب الأساسي
            reason = f"{_humanized} — {_base_reason}"
        except Exception:
            reason = _base_reason

    elif signal == 'HOLD':
        if score >= 15:
            verdict = 'انتظر'
            reason = 'السهم فيه مؤشرات إيجابية بس محدودة — استنى تحسن المؤشرات أو انخفاض السعر.'
        elif score >= 10:
            verdict = 'انتظر'
            reason = 'السهم أساسياته متوسطة — استنى تحسن المؤشرات أو انخفاض السعر.'
        else:
            verdict = 'ابعد'
            reason = 'السهم غالي أو أساسياته ضعيفة — مش فرصة استثمار.'
    else:
        verdict = 'ابعد'
        reason = 'السهم غالي أو أساسياته ضعيفة — مش فرصة استثمار.'

    return InvestorResult(
        verdict=verdict,
        score=round(score, 1),
        reason=reason,
        signal=signal,
        entry=entry,
        target=target,
        stop=stop,
        timeframe='6-12 شهر',
        conditions=conditions,
        fair_value=fair_value,
        # 📊 أهداف القيمة العادلة
        fair_value_gap_pct=fair_value_gap_pct,
        target_1=target_1,
        target_2=target_2,
        target_3=target_3,
        # 🧠 S/R info للواجهة
        support=sr_support,
        resistance=sr_resistance,
        zone=sr_zone,
        rr=sr_rr,
        # 🛑 وقف تغير القصة
        trailing_stop=trailing_stop,
        trailing_stop_logic=trailing_stop_logic,
        story_change_stop=story_change_stop,
        story_status=story_status,
        story_warning_reason=story_warning_reason,
        story_sectors_divergence=story_sectors_divergence,
        story_volume_anomaly=story_volume_anomaly,
        # 📊 تفاصيل إضافية
        regime_note=regime_note,
        score_breakdown=score_breakdown,
    )


def investor_to_dict(result: InvestorResult) -> Dict[str, Any]:
    """تحويل InvestorResult لـ dict للـ JSON."""
    return {
        'verdict': result.verdict,
        'score': result.score,
        'reason': result.reason,
        'signal': result.signal,
        'entry': result.entry,
        'target': result.target,
        'stop': result.stop,
        'timeframe': result.timeframe,
        'conditions': result.conditions,
        'fair_value': result.fair_value,
        # 📊 أهداف القيمة العادلة
        'fair_value_gap_pct': result.fair_value_gap_pct,
        'target_1': result.target_1,
        'target_2': result.target_2,
        'target_3': result.target_3,
        # 🧠 S/R info للواجهة
        'support': result.support,
        'resistance': result.resistance,
        'zone': result.zone,
        'rr': result.rr,
        # 🛑 وقف تغير القصة
        'trailing_stop': result.trailing_stop,
        'trailing_stop_logic': result.trailing_stop_logic,
        'story_change_stop': result.story_change_stop,
        'story_status': result.story_status,
        'story_warning_reason': result.story_warning_reason,
        'story_sectors_divergence': result.story_sectors_divergence,
        'story_volume_anomaly': result.story_volume_anomaly,
        # 📊 تفاصيل إضافية
        'regime_note': result.regime_note,
        'score_breakdown': result.score_breakdown,
    }
