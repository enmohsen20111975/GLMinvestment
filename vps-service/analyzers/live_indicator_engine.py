"""
live_indicator_engine.py — محرك التحديث اللحظي (Live Delta Calculator)
=====================================================================
يفصل البيانات التاريخية (الثابتة) عن البيانات اللحظية (المتحركة).

المبدأ:
  - القيم المغلقة ليوم الأمس (RSI, MACD, SMA, ATR) تُقرأ من cached_analysis
  - شمعة اليوم اللحظية (O, H, L, C, V) تُقرأ من stocks.db
  - المؤشرات تُحسب باستخدام معادلات التحديث السريع (Incremental Update)

المعادلات:
  - RSI (Wilder's): Avg_Gain_Today = (Avg_Gain_Yesterday * 13 + Today_Gain) / 14
  - MACD (EMA update): EMA_today = (Price - EMA_yesterday) * multiplier + EMA_yesterday
  - SMA: لا تتغير خلال اليوم
  - Volume Ratio: يحسب من حجم اليوم vs متوسط 20 يوم
"""
import sqlite3
import os
import math
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List
from datetime import datetime

_BASE_DIR = Path(__file__).parent.parent.parent
_STOCKS_DB = str(_BASE_DIR / 'db' / 'stocks.db')
_PREDICTIONS_DB = str(_BASE_DIR / 'db' / 'predictions.db')

# ── Thresholds ─────────────────────────────────────────────────────────────
BUY_THRESHOLD = 68
HOLD_THRESHOLD = 45

# Sector boosts/penalties
SECTOR_BOOST = {
    'خدمات المستهلك': 5, 'مستهلك - غير معمرة': 5, 'تجارة التجزئة': 5, 'الخدمات الصحية': 5,
}
SECTOR_PENALTY = {
    'خدمات التوزيع': -5, 'الخدمات التجارية': -5, 'خدمات التكنولوجيا': -5,
    'السلع الاستهلاكية المُعمرة': -3,
}
REGIME_BOOST = {'bull_trend': 5, 'ranging': 5}
REGIME_PENALTY = {'bear_trend': -5}


try:
    from analyzers.smc_engine import calculate_smc_score
    HAS_SMC = True
except Exception:
    HAS_SMC = False


class LiveIndicatorEngine:
    """محرك التحديث اللحظي — يحسب المؤشرات بدون قراءة التاريخ كاملاً.

    P41-DELAYED-DATA-MODE (HOW_WE_ANALYZE v10 / PROJECT_DISSECTION):
      لو الـ data_engine بيوصل بـ price data متأخر 5 دقايق (DELAYED_DATA_MINUTES=5)،
      الـ Breakout signals سريعة الزوال بتبقى بتعمل ضرر أكتر من نفعها (دخول في فخ
      السيولة بعد ما الـ move خلصت). فبنـ:
        1. نلغي نقاط MACD/Volume لو اليوم صعد أكتر من 4% (breakout veto)
        2. نرفع حساسية الـ Golden Pullback (+10 boost) عشان نركّز على التصحيحات
        3. نرفع عتبة الـ dead_cat_bounce (RSI > 65 بدل 55) عشان نتجنب الإنذارات
           الكاذبة من تذبذب آخر 5 دقايق
        4. بنـ relax الـ EGX Time Trap veto (مش محتاجينه، الـ delay بنفسه بيلغي
           فوضى أول 15 دقيقة)
    """

    def __init__(self, stocks_db: str = None, predictions_db: str = None,
                 delayed_minutes: int = None):
        self.stocks_db = stocks_db or _STOCKS_DB
        self.predictions_db = predictions_db or _PREDICTIONS_DB
        # P41-DELAYED-DATA-MODE: اقرأ DELAYED_DATA_MINUTES من env لو مش متمرر صراحةً
        if delayed_minutes is None:
            try:
                delayed_minutes = int(os.environ.get('DELAYED_DATA_MINUTES', '0') or '0')
            except Exception:
                delayed_minutes = 0
        self.delayed_minutes = max(0, delayed_minutes)
        self.delayed_mode = self.delayed_minutes > 0

    # ── قراءة بيانات الأمس (EOD Cache) ────────────────────────────────────

    def get_yesterday_indicators(self, ticker: str) -> Dict[str, Any]:
        """يقرأ القيم المغلقة ليوم الأمس من cached_analysis أو stored_analyses."""
        result = {
            'rsi': 50.0, 'macd_line': 0.0, 'macd_signal': 0.0, 'macd_hist': 0.0,
            'sma20': None, 'sma50': None, 'sma200': None,
            'ema_fast': None, 'ema_slow': None,
            'bb_upper': None, 'bb_lower': None, 'bb_middle': None,
            'avg_volume_20d': 0, 'support': None, 'resistance': None,
            'sector': '', 'market_regime': 'unknown',
            'found': False,
        }
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(self.stocks_db, writable=False).__enter__()
            conn.execute('PRAGMA busy_timeout = 30000')
            cur = conn.cursor()

            # Read from cached_analysis
            cur.execute('''
                SELECT ticker, sector, current_price, composite_score,
                       technical_score, fundamental_score, risk_level,
                       signal, confidence, analysis_json
                FROM cached_analysis WHERE ticker = ?
            ''', (ticker.upper(),))
            row = cur.fetchone()
            if row:
                result['found'] = True
                result['sector'] = row[1] or ''
                result['yesterday_price'] = row[2] or 0
                result['yesterday_score'] = row[3] or 50
                result['signal'] = row[7] or 'hold'
                # Parse analysis_json for indicators
                import json
                try:
                    analysis = json.loads(row[9]) if row[9] else {}
                    ind = analysis.get('indicators', analysis.get('current_indicators', {}))
                    if isinstance(ind, dict):
                        result['rsi'] = ind.get('rsi', 50.0) or 50.0
                        result['macd_line'] = ind.get('macd', 0.0) or 0.0
                        result['macd_signal'] = ind.get('macd_signal', 0.0) or 0.0
                        result['macd_hist'] = ind.get('macd_histogram', 0.0) or 0.0
                        result['sma20'] = ind.get('sma20')
                        result['sma50'] = ind.get('sma50')
                        result['sma200'] = ind.get('sma200')
                        result['bb_upper'] = ind.get('bb_upper')
                        result['bb_lower'] = ind.get('bb_lower')
                        result['bb_middle'] = ind.get('bb_middle')
                        result['avg_volume_20d'] = ind.get('avg_volume', 0) or 0
                except Exception:
                    pass

            # Read sector + regime from stocks table
            cur.execute('SELECT sector, current_price, volume FROM stocks WHERE ticker = ?', (ticker.upper(),))
            stock_row = cur.fetchone()
            if stock_row:
                if not result['sector']:
                    result['sector'] = stock_row[0] or ''
                if not result.get('yesterday_price'):
                    result['yesterday_price'] = stock_row[1] or 0
                if not result['avg_volume_20d']:
                    result['avg_volume_20d'] = stock_row[2] or 0

            conn.close()
        except Exception as e:
            pass
        return result

    # ── قراءة شمعة اليوم اللحظية ──────────────────────────────────────────

    def get_today_candle(self, ticker: str) -> Dict[str, Any]:
        """
        P19-REAL-TIME-SYNC-PRACTICAL-ANALYSIS: يقرأ شمعة اليوم اللحظية من
        stocks.db بـ schema اللي بيعملها migrator.py + sync.py.

        المصادر:
          1. stocks.current_price / previous_close / volume / change_percent / last_updated
             (الـ data_engine/sync.py بيـ updateها كل 30 ثانية وقت الجلسة).
          2. stock_daily_prices.open_price / high_price / low_price / close_price
             لـ price_date = today (sync.py بيعمل UPSERT بيحافظ على الـ high/low
             عبر MAX/MIN aggregation → Live Developing Candle).

        لو الـ daily candle row موجود → نستخدم الـ open/high/low منه (متراكمين
        على مدار الجلسة). لو مش موجود → نستنتجهم من current_price + previous_close.

        الـ Volume بيتخزن كـ INTEGER في stocks.db، بس بنستخدم _parse_volume() كـ safety.

        Fallback: لو الـ DB مفيهاش بيانات، نحاول نقرأ من Data Engine API.
        """
        result = {'open': 0, 'high': 0, 'low': 0, 'close': 0, 'volume': 0, 'found': False}
        ticker = ticker.upper()
        today = datetime.now().strftime('%Y-%m-%d')

        # ── 1. اقرأ من stocks.db (الـ DB اللي الـ data_engine/sync.py بيحدّثها) ──
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(self.stocks_db, writable=False).__enter__()
            conn.execute('PRAGMA busy_timeout = 30000')
            cur = conn.cursor()

            # ── P19: schema-aware SELECT ──
            # stocks table (migrator schema) مفيهاش open_price/high_price/low_price.
            # بنقرأ current_price + previous_close + volume + change_percent + last_updated.
            # الـ last_updated هي الـ sync.py بيكتبها كل 30 ثانية.
            cur.execute('''
                SELECT current_price, previous_close, volume, change_percent,
                       last_updated
                FROM stocks WHERE ticker = ? AND is_active = 1
            ''', (ticker,))
            row = cur.fetchone()

            if row and row[0] and float(row[0]) > 0:
                current_price = float(row[0])
                previous_close = float(row[1]) if row[1] else current_price
                vol = self._parse_volume(row[2])
                change_pct = float(row[3] or 0)
                last_updated = row[4] or ''

                # ── P19: اقرأ شمعة اليوم من stock_daily_prices ──
                # sync.py بيعمل UPSERT بيحافظ على open (أول سعر في الجلسة)
                # و high (MAX تراكمي) و low (MIN تراكمي) و close (آخر سعر).
                # ده الـ Live Developing Candle — كل ما الـ scraper يجيب سعر
                # جديد، الـ high/low بيتحدثوا من غير ما الـ open يتغير.
                open_p = previous_close  # الافتراضي
                high_p = max(current_price, previous_close)
                low_p = min(current_price, previous_close)
                try:
                    cur.execute('''
                        SELECT open_price, high_price, low_price, close_price
                        FROM stock_daily_prices
                        WHERE ticker = ? AND price_date = ?
                    ''', (ticker, today))
                    candle_row = cur.fetchone()
                    if candle_row:
                        if candle_row[0] is not None:
                            open_p = float(candle_row[0])
                        if candle_row[1] is not None:
                            high_p = float(candle_row[1])
                        if candle_row[2] is not None:
                            low_p = float(candle_row[2])
                        # close_price من candle_row لو موجود وأحدث من current_price
                        # بس الأولوية لـ stocks.current_price (الـ sync بيـ updateه آخر)
                except sqlite3.OperationalError:
                    # stock_daily_prices table مش موجودة أو الأعمدة ناقصة → fallback
                    pass

                # تأكد إن الـ high/low بيشملوا current_price (آخر سعر)
                high_p = max(high_p, current_price)
                low_p = min(low_p, current_price) if low_p > 0 else current_price

                result = {
                    'open': open_p,
                    'high': high_p,
                    'low': low_p,
                    'close': current_price,
                    'volume': vol,
                    'change_percent': change_pct,
                    'previous_close': previous_close,
                    'last_update': last_updated,
                    'found': True,
                }

            conn.close()
        except Exception:
            pass

        # ── 2. Fallback: Data Engine API على المنفذ 5000 (لو الـ DB فاضي) ──
        if not result['found']:
            try:
                api_result = self._fetch_from_data_engine_api(ticker)
                if api_result and api_result.get('found'):
                    result = api_result
            except Exception:
                pass

        return result

    def get_db_last_updated(self, ticker: str) -> str:
        """
        P19-REAL-TIME-SYNC: رجّع آخر تـ update لسعر السهم في stocks.db.

        الـ router بيستخدمها عشان يقرر هل الكاش stale ولا لأ:
          - لو last_updated أحدث من وقت الـ cache entry → الكاش stale، skipه.
          - لو أقدم أو مفيش → الكاش valid، استخدمه.

        Returns:
            ISO timestamp string (مثال: '2026-07-30T10:15:23.123456')
            أو '' لو السهم مش موجود أو مفيهوش last_updated.
        """
        ticker = ticker.upper()
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(self.stocks_db, writable=False).__enter__()
            conn.execute('PRAGMA busy_timeout = 5000')
            cur = conn.cursor()

            # P19: schema-aware — migrator schema بيستخدم 'last_updated'
            cur.execute('SELECT last_updated FROM stocks WHERE ticker = ?', (ticker,))
            row = cur.fetchone()
            conn.close()
            if row and row[0]:
                return str(row[0])
        except Exception:
            pass
        return ''

    def _fetch_from_data_engine_api(self, ticker: str) -> Dict[str, Any]:
        """
        DATA-ENGINE-035: يقرأ أحدث سعر لحظي من Data Engine API (port 5000).

        ده fallback لو الـ stocks.db مفيهوش بيانات للسهم (مثلاً السهم جديد أو
        الـ Data Engine لسه ما حدّش). بناخد البيانات من الـ JSON cache اللي
        الـ Data Engine بيحفظه في data_engine/data/stocks_full_data.json.
        """
        try:
            import json
            import os
            json_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                'data_engine', 'data', 'stocks_full_data.json'
            )
            if not os.path.exists(json_path):
                return {'found': False}

            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            # ابحث عن السهم بالـ symbol
            for stock in data:
                if str(stock.get('symbol', '')).upper() == ticker:
                    price = float(stock.get('price', 0) or 0)
                    if price <= 0:
                        continue
                    vol = self._parse_volume(stock.get('volume', 0))
                    change_pct = float(stock.get('change_percent', 0) or 0)
                    return {
                        'open': price,  # fallback: not available in JSON
                        'high': price,
                        'low': price,
                        'close': price,
                        'volume': vol,
                        'change_percent': change_pct,
                        'previous_close': price / (1 + change_pct / 100) if change_pct != 0 else price,
                        'last_update': '',
                        'found': True,
                    }
        except Exception:
            pass
        return {'found': False}

    @staticmethod
    def _parse_volume(v) -> float:
        """يحوّل volume بأمان (int, float, أو نص مثل '2.28 M' → 2280000)."""
        if v is None:
            return 0.0
        try:
            return float(v)
        except (ValueError, TypeError):
            pass
        try:
            s = str(v).strip().replace('\u202f', '').replace(' ', '').replace(',', '')
            if s.endswith('M'):
                return float(s[:-1]) * 1_000_000
            elif s.endswith('K'):
                return float(s[:-1]) * 1_000
            elif s.endswith('B'):
                return float(s[:-1]) * 1_000_000_000
            return float(s)
        except (ValueError, TypeError):
            return 0.0

    # ── حساب RSI اللحظي (Wilder's Smoothing) ──────────────────────────────

    def calculate_live_rsi(self, yesterday_avg_gain: float, yesterday_avg_loss: float,
                           today_change: float) -> float:
        """
        Wilder's Smoothing for RSI:
        Avg_Gain_Today = (Avg_Gain_Yesterday * 13 + max(0, Today_Gain)) / 14
        Avg_Loss_Today = (Avg_Loss_Yesterday * 13 + max(0, -Today_Change)) / 14
        RS = Avg_Gain / Avg_Loss
        RSI = 100 - (100 / (1 + RS))
        """
        today_gain = max(0.0, today_change)
        today_loss = max(0.0, -today_change)

        avg_gain = (yesterday_avg_gain * 13 + today_gain) / 14
        avg_loss = (yesterday_avg_loss * 13 + today_loss) / 14

        if avg_loss == 0:
            return 100.0 if avg_gain > 0 else 50.0
        rs = avg_gain / avg_loss
        rsi = 100.0 - (100.0 / (1.0 + rs))
        return round(rsi, 2)

    # ── حساب MACD اللحظي (EMA Update) ─────────────────────────────────────

    def calculate_live_macd(self, yesterday_ema_fast: float, yesterday_ema_slow: float,
                            today_close: float, fast: int = 12, slow: int = 26,
                            signal: int = 9, yesterday_signal: float = None) -> Tuple[float, float, float]:
        """
        EMA update: EMA_today = (Price - EMA_yesterday) * multiplier + EMA_yesterday
        Returns: (macd_line, signal_line, histogram)

        Per owner directive (no fake data): signal line is computed as the
        9-period EMA of the MACD line. If yesterday_signal is provided
        (cached from prior bar), we use the standard EMA update formula.
        If yesterday_signal is None (first run / no cache), we return
        signal_line = None and the caller should treat it as 'insufficient data'.
        """
        mult_fast = 2.0 / (fast + 1)
        mult_slow = 2.0 / (slow + 1)
        mult_signal = 2.0 / (signal + 1)

        ema_fast = (today_close - yesterday_ema_fast) * mult_fast + yesterday_ema_fast
        ema_slow = (today_close - yesterday_ema_slow) * mult_slow + yesterday_ema_slow
        macd_line = ema_fast - ema_slow

        # Signal line: REAL 9-period EMA of MACD line (no fake macd*0.9)
        if yesterday_signal is None:
            # Insufficient data — return None honestly per owner directive
            return round(macd_line, 6), None, None
        signal_line = (macd_line - yesterday_signal) * mult_signal + yesterday_signal
        histogram = macd_line - signal_line

        return round(macd_line, 6), round(signal_line, 6), round(histogram, 6)

    # ── حساب Volume Ratio اللحظي ──────────────────────────────────────────

    def calculate_live_volume_ratio(self, avg_20d_volume, today_volume: float) -> float:
        """يحسب نسبة حجم اليوم إلى متوسط 20 يوم."""
        avg = self._parse_volume(avg_20d_volume)
        if avg and avg > 0:
            return round(today_volume / avg, 2)
        return 1.0

    # ── كشف أنماط الشموع اللحظية ──────────────────────────────────────────

    def detect_live_candlestick(self, today: Dict[str, Any]) -> Dict[str, Any]:
        """يكشف أنماط الشموع اليابانية من شمعة اليوم."""
        o, h, l, c = today['open'], today['high'], today['low'], today['close']
        body = abs(c - o)
        range_ = h - l
        if range_ <= 0:
            return {'name': 'Doji', 'signal': 'neutral', 'points': 3}

        # Doji
        if body / range_ < 0.1:
            return {'name': 'Doji', 'name_ar': 'دوجي', 'signal': 'neutral', 'points': 3}

        lower_wick = min(o, c) - l
        upper_wick = h - max(o, c)

        # Hammer (bullish)
        if lower_wick > 2 * body and upper_wick < body * 0.5:
            return {'name': 'Hammer', 'name_ar': 'مطرقة', 'signal': 'bullish', 'points': 10}

        # Shooting Star (bearish)
        if upper_wick > 2 * body and lower_wick < body * 0.5:
            return {'name': 'Shooting Star', 'name_ar': 'نجم هابط', 'signal': 'bearish', 'points': 0}

        # Bullish candle
        if c > o:
            return {'name': 'Bullish', 'name_ar': 'صعودية', 'signal': 'bullish', 'points': 7}

        # Bearish candle
        return {'name': 'Bearish', 'name_ar': 'هبوطية', 'signal': 'bearish', 'points': 0}

    # ── حساب الـ 8 Layers Score اللحظي ────────────────────────────────────

    def calculate_live_score(self, ticker: str) -> Dict[str, Any]:
        """يحسب الـ 8 layers score باستخدام القيم اللحظية."""
        yesterday = self.get_yesterday_indicators(ticker)
        today = self.get_today_candle(ticker)

        if not today['found'] or not yesterday.get('found'):
            return {'success': False, 'error': f'لا توجد بيانات كافية لـ {ticker}'}

        today_close = today['close']
        today_change = today['close'] - (yesterday.get('yesterday_price') or today['open'])

        # ── Layer 1: Macro Trend (25 pts) — من cache ──
        regime = yesterday.get('market_regime', 'unknown')
        macro_pts = 12  # default for unknown
        if regime == 'bull_trend':
            macro_pts = 25
        elif regime == 'ranging':
            macro_pts = 10
        elif regime == 'bear_trend':
            macro_pts = 0

        # ── Layer 2: Price vs SMA50 (18 pts) ──
        sma50 = yesterday.get('sma50')
        if sma50 and sma50 > 0:
            sma50_pts = 18 if today_close > sma50 else 3
        else:
            sma50_pts = 9  # neutral

        # ── Layer 3: RSI (20 pts) — Live calculated ──
        # Approximate yesterday's avg_gain/avg_loss from RSI
        yesterday_rsi = yesterday.get('rsi', 50.0)
        if yesterday_rsi > 50:
            yesterday_avg_gain = yesterday_rsi / 100
            yesterday_avg_loss = (100 - yesterday_rsi) / 100
        else:
            yesterday_avg_gain = yesterday_rsi / 100
            yesterday_avg_loss = (100 - yesterday_rsi) / 100

        live_rsi = self.calculate_live_rsi(yesterday_avg_gain, yesterday_avg_loss, today_change)
        if 40 <= live_rsi <= 65:
            rsi_pts = 20
        elif 30 <= live_rsi < 40:
            rsi_pts = 15
        elif 65 < live_rsi <= 75:
            rsi_pts = 10
        elif live_rsi < 30:
            rsi_pts = 12
        else:
            rsi_pts = 3

        # ── Layer 4: Volume (20 pts) — Live ──
        vol_ratio = self.calculate_live_volume_ratio(
            yesterday.get('avg_volume_20d', 0), today['volume']
        )
        if vol_ratio >= 1.3:
            vol_pts = 20
        elif vol_ratio >= 1.0:
            vol_pts = 14
        else:
            vol_pts = 6

        # ── Layer 5: Bollinger (10 pts) — من cache ──
        bb_upper = yesterday.get('bb_upper')
        bb_lower = yesterday.get('bb_lower')
        if bb_upper and bb_lower and bb_upper > bb_lower:
            bb_range = bb_upper - bb_lower
            bb_pos = (today_close - bb_lower) / bb_range if bb_range > 0 else 0.5
            if 0.2 <= bb_pos <= 0.5:
                bb_pts = 10
            elif 0.5 < bb_pos <= 0.7:
                bb_pts = 5
            elif bb_pos > 0.7:
                bb_pts = 2
            else:
                bb_pts = 7
        else:
            bb_pts = 5

        # ── Layer 6: MACD (23 pts) — Live calculated ──
        y_ema_fast = yesterday.get('ema_fast') or yesterday.get('sma20') or today_close
        y_ema_slow = yesterday.get('ema_slow') or yesterday.get('sma50') or today_close
        macd_line, macd_signal, macd_hist = self.calculate_live_macd(
            y_ema_fast, y_ema_slow, today_close
        )
        vol_confirmed = vol_ratio >= 1.0
        if macd_hist > 0 and macd_line > macd_signal:
            macd_pts = 23 if vol_confirmed else 12
        elif macd_hist > 0:
            macd_pts = 12
        elif macd_hist < 0 and macd_line < macd_signal:
            macd_pts = 0
        else:
            macd_pts = 6

        # ────────────────────────────────────────────────────────────────────
        # P41-DELAYED-DATA-MODE: Breakout Veto (HOW_WE_ANALYZE v10)
        # ────────────────────────────────────────────────────────────────────
        # لو عندنا تأخير 5 دقايق (DELAYED_DATA_MINUTES>0)، الشراء بعد صعود يومي
        # أكبر من 4% بيساوي الدخول في فخ السيولة (الـ move خلصت ولسه نقفل فوق).
        # فبنلغي نقاط الـ MACD والـ Volume اللي بتعكس breakout مؤكد، ونخليها
        # محايدة (6 للـ MACD، 6 للـ Volume) — الـ Golden Pullback boost تحت
        # بياخد الـ lead.
        breakout_vetoed = False
        daily_change_pct = 0.0
        try:
            y_price_ref = yesterday.get('yesterday_price') or today.get('open') or today_close
            if y_price_ref and y_price_ref > 0:
                daily_change_pct = ((today_close - y_price_ref) / y_price_ref) * 100.0
        except Exception:
            daily_change_pct = 0.0

        if self.delayed_mode and daily_change_pct >= 4.0:
            breakout_vetoed = True
            # قلل نقاط MACD/Volume (Breakout bias) للحد الأدنى المحايد
            macd_pts = min(macd_pts, 6)
            vol_pts = min(vol_pts, 6)

        # ── Layer 7: Candlestick (10 pts) — Live ──
        candle = self.detect_live_candlestick(today)
        candle_pts = candle['points']

        # ── Layer 8: Fibonacci (12 pts) — من cache ──
        # Approximate: if price near support → +12
        support = yesterday.get('support')
        resistance = yesterday.get('resistance')
        if support and support > 0 and today_close > 0:
            dist_to_support = abs(today_close - support) / today_close * 100
            if dist_to_support < 2:
                fib_pts = 12
            elif dist_to_support < 5:
                fib_pts = 6
            else:
                fib_pts = 2
        else:
            fib_pts = 3

        # ── Layer 9: Smart Money Concepts (SMC) — Order Blocks + FVG + Sweeps (50 pts - TOP PRIORITY) ──
        smc_pts = 0
        smc_detail = 'SMC غير متاح'
        if HAS_SMC:
            try:
                ohlcv = self._get_recent_ohlcv(ticker, days=90)
                if ohlcv:
                    sma200 = yesterday.get('sma200') or 0
                    smc_result = calculate_smc_score(
                        ohlcv=ohlcv,
                        current_price=today_close,
                        volume_ratio=vol_ratio,
                        rsi=live_rsi,
                        sma200=float(sma200),
                    )
                    smc_raw = float(smc_result.get('score', 0))
                    smc_pts = max(0.0, min(50.0, smc_raw / 2.0))
                    smc_detail = f'SMC {smc_raw:.0f}/100 (OBs={len(smc_result.get("order_blocks", []))}, FVGs={len(smc_result.get("fvgs", []))}, Sweeps={len(smc_result.get("sweeps", []))})'
            except Exception as e:
                smc_detail = f'SMC Error: {e}'

        # ── Total Score (SMC Weighted Primary) ──
        score = smc_pts + (macro_pts + sma50_pts + rsi_pts + vol_pts + bb_pts + macd_pts + candle_pts + fib_pts) * 0.5

        # ── Sector Boost/Penalty ──
        sector = yesterday.get('sector', '')
        if sector in SECTOR_BOOST:
            score += SECTOR_BOOST[sector]
        elif sector in SECTOR_PENALTY:
            score += SECTOR_PENALTY[sector]

        # ── Regime Boost/Penalty ──
        if regime in REGIME_BOOST:
            score += REGIME_BOOST[regime]
        elif regime in REGIME_PENALTY:
            score += REGIME_PENALTY[regime]

        # ── Pine Script Smart Logic (LIVE-ENGINE-028) ──
        y_close = yesterday.get('yesterday_price', today['open'])
        sma50_val = yesterday.get('sma50') or today_close
        bb_low_val = yesterday.get('bb_lower') or today_close * 0.95

        is_dead_cat = self.detect_dead_cat_bounce(
            today_close, sma50_val or 0, live_rsi, y_close or today['open']
        )
        is_golden_pullback = self.detect_golden_pullback(
            today_close, sma50_val or 0, bb_low_val or 0, y_close or today['open']
        )
        is_bullish_div = self.detect_bullish_divergence(
            today['low'], today.get('open', today['low']),
            live_rsi, yesterday_rsi
        )

        # P41-DELAYED-DATA-MODE: Golden Pullback Boost
        # لو الـ data متأخرة 5 دقايق، الـ breakout signals بتبقى خطرها أكتر من
        # نفعها. فبنرفع وزن الـ Golden Pullback (اتجاه صاعد + تصحيح للأسفل ناحية
        # BB Lower) عشان نركّز على التصحيحات الآمنة بدل الاختراقات المتأخرة.
        golden_pullback_boost = 10
        if self.delayed_mode and is_golden_pullback:
            golden_pullback_boost = 15  # +50% boost في وضع التأخير

        # Apply Veto/Boost
        reason = ''
        if is_dead_cat:
            score -= 15
        elif is_golden_pullback:
            score += golden_pullback_boost
        elif is_bullish_div:
            # P23-CRYPTO-LAB-FUSION: was +5 → +7 (+40%, slightly above the requested +30%)
            # RSI Divergence هو LEADING indicator بيتنبأ بالعكس (reversal) قبل
            # ما السعر يأكده. لما السعر بيعمل lower low بس الـ RSI بيعمل higher low
            # ده معناه إن الـ momentum البيعي بيضعف والـ buyers بيدخلوا بشكل خفي.
            # رفعنا الـ bonus عشان نعطي إشارة الـ divergence وزن أكبر في القرار.
            score += 7

        # HUMANIZE-034: ولّد سبب بشري واقعي بدل الجمل الثابتة
        try:
            from analyzers.narrative_generator import build_humanized_reason
            pine_flags = {
                'is_golden_pullback': is_golden_pullback,
                'is_dead_cat': is_dead_cat,
                'is_bullish_divergence': is_bullish_div,
            }
            indicators_for_reason = {
                'rsi': live_rsi,
                'macd_hist': macd_hist,
                'volume_ratio': vol_ratio,
                'bb_lower': yesterday.get('bb_lower'),
                'bb_upper': yesterday.get('bb_upper'),
                'sma50': yesterday.get('sma50'),
                'sma200': yesterday.get('sma200'),
            }
            sr_levels = {
                'support': yesterday.get('support'),
                'resistance': yesterday.get('resistance'),
                'far_support': None,
                'far_resistance': None,
            }
            reason = build_humanized_reason(
                ticker=ticker,
                indicators=indicators_for_reason,
                pine_flags=pine_flags,
                sr_levels=sr_levels,
                score=score,
                regime=regime,
            )
        except Exception:
            # Fallback لو الـ narrative_generator فشل (مش هكسر الـ engine)
            if is_dead_cat:
                reason = '⚠️ فخ ارتداد! ابتعد — السهم في اتجاه هابط'
            elif is_golden_pullback:
                reason = '🟢 تصحيح ذهبي — فرصة شراء بخصم في اتجاه صاعد'
            elif is_bullish_div:
                reason = '📊 تباعد إيجابي — الزخم يضعف والهبوط يقترب من نهايته'
            else:
                reason = 'إشارة فنية'

        # ── STRATEGY-041-FIX: Intraday Volume Trap (وقت الجلسة) ──
        # المشكلة: الساعة 10:15 الصبح السهم لسه متداول بـ 50K بس، فالكود بيرفضه.
        # الحل: نقسم الشرط حسب وقت الجلسة:
        #   - أول ساعة (10:00-11:00): veto بس لو السيولة صفر أو vol_ratio < 0.3x
        #   - بعد 11:30: القاعدة الكاملة تشتغل (vol_ratio < 1.2x = فخ)
        # Bug 12.4 fix (EGX Time Trap): أول 15 دقيقة (10:00-10:15) = Price Discovery chaos
        # تجاهل أي إشارة إلا لو السيولة مرعبة (vol_ratio >= 5.0)
        from datetime import datetime as _dt_intraday
        import pytz as _pytz_intraday
        try:
            _cairo_tz = _pytz_intraday.timezone('Africa/Cairo')
            _now_cairo = _dt_intraday.now(_cairo_tz)
            _session_hour = _now_cairo.hour
            _session_minute = _now_cairo.minute
            _is_first_hour = _session_hour == 10  # 10:00-10:59 (أول ساعة جلسة)
            _is_mature_session = _session_hour >= 12 or (_session_hour == 11 and _session_minute >= 30)
            # Bug 12.4: أول 15 دقيقة = Price Discovery = فوضى
            _is_first_15_mins = (_session_hour == 10 and _session_minute < 15)
        except Exception:
            _is_first_hour = False
            _is_mature_session = True  # fallback: اعتبر الجلسة ناضجة
            _is_first_15_mins = False

        # Bug 12.4: EGX Time Trap - أول 15 دقيقة = تجاهل كل الإشارات
        # إلا لو السيولة مرعبة (vol_ratio >= 5.0)
        #
        # P41-DELAYED-DATA-MODE: لو الـ data متأخرة 5 دقايق، أول 15 دقيقة بتاعت
        # الـ Price Discovery أصلاً عدت (احنا بـ 5 دقايق تأخير)، فالـ veto ده مش
        # محتاجينه — الـ delayed_mode بنفسه بيتعامل مع الفوضى دي عبر Breakout Veto.
        if _is_first_15_mins and vol_ratio < 5.0 and not self.delayed_mode:
            return {
                'score': 0,
                'signal': 'WAIT',
                'signal_ar': 'انتظار (أول 15 دقيقة - Price Discovery)',
                'reason': 'EGX Time Trap: أول 15 دقيقة فيها فوضى تسعير - تجاهل الإشارات إلا لو السيولة مرعبة',
                'ticker': ticker,
                'timestamp': datetime.now().isoformat(),
            }

        # ── STRATEGY-041: Trap Detector (Volume vs Price) ──
        # لو Score ≥ 70 (شراء) بس volume_ratio < 1.2x (سيولة ضعيفة)
        # والسهم طالع فوق SMA50 → ده فخ مضارب (يطلع السهم بسيولة وهمية)
        # النظام يطير التوصية فوراً ويحولها لـ HOLD
        is_trap = False
        trap_reason = ''
        # STRATEGY-041-FIX: أول ساعة جلسة → veto بس لو vol_ratio < 0.3x (ميت خالص)
        # بعد 11:30 → veto لو vol_ratio < 1.2x (القاعدة الكاملة)
        _trap_vol_threshold = 0.3 if _is_first_hour else 1.2
        if score >= 70 and vol_ratio < _trap_vol_threshold and today_close > (sma50_val or today_close):
            is_trap = True
            score = min(score - 20, 65)  # خفض الـ score تحت BUY_THRESHOLD
            if _is_first_hour:
                trap_reason = (
                    f'🚨 فخ مضارب! السهم طالع بس السيولة ميتة ({vol_ratio:.1f}x) — '
                    f'ده تصريف وهمي، ابعد'
                )
            else:
                trap_reason = (
                    f'🚨 فخ مضارب! السهم طالع بس السيولة ضعيفة ({vol_ratio:.1f}x) — '
                    f'ده تصريف وهمي، ابعد'
                )
            reason = trap_reason

        # ── STRATEGY-041: Liquidity Filter (الأسهم المضروبة) ──
        # لو قيمة التداول اللحظي (volume × price) أقل من 500K جنيه
        # STRATEGY-041-FIX: أول ساعة جلسة → الحد الأدنى 50K بس (سيبه يطلع طالع)
        # بعد 11:30 → الحد الأدنى 500K (القاعدة الكاملة)
        # BRIEF-042-FIX: Penny Stocks → لو السعر < 1 جنيه، الحد الأدنى 2M (مش 500K)
        is_low_liquidity = False
        liquidity_reason = ''
        try:
            turnover_egp = today.get('volume', 0) * today_close
            # BRIEF-042-FIX: Penny Stocks Warning
            # الأسهم < 1 جنيه بتتصرف بـ 100K ممكن تموت السيولة وتقفل على ورقتك
            is_penny = today_close < 1.0
            if is_penny:
                # Penny stock: الحد الأدنى 2M (أول ساعة) أو 2M (بعد 11:30)
                MIN_TURNOVER_EGP = 2_000_000 if not _is_first_hour else 500_000
            else:
                # سهم عادي: 50K (أول ساعة) أو 500K (بعد 11:30)
                MIN_TURNOVER_EGP = 50_000 if _is_first_hour else 500_000

            if turnover_egp < MIN_TURNOVER_EGP and score >= BUY_THRESHOLD:
                is_low_liquidity = True
                score = min(score - 25, 60)  # خفض تحت BUY_THRESHOLD
                if is_penny:
                    liquidity_reason = (
                        f'⚠️ سهم معدوم + سيولة ميتة — السعر {today_close:.2f} جنيه '
                        f'وقيمة التداول {turnover_egp/1e6:.1f}M جنيه (أقل من 2M للمية). '
                        f'فخ! السهم بيتأكل سيولة ويمكن تقفل على ورقتك'
                    )
                elif _is_first_hour:
                    liquidity_reason = (
                        f'⚠️ السيولة ميتة — قيمة التداول {turnover_egp/1000:.0f}K جنيه '
                        f'(أقل من 50K). السهم ميت خالص'
                    )
                else:
                    liquidity_reason = (
                        f'⚠️ سيولة ضعيفة — قيمة التداول {turnover_egp/1000:.0f}K جنيه '
                        f'(أقل من 500K). السهم صعب بيعه لو نزل'
                    )
                if not is_trap:
                    reason = liquidity_reason
        except Exception:
            pass

        # ── Signal ──
        if is_dead_cat:
            signal = 'SELL'
            signal_ar = '⚠️ فخ ارتداد — ابتعد!'
        elif is_trap:
            signal = 'HOLD'
            signal_ar = '🚨 فخ مضارب — ابعد!'
        elif is_low_liquidity:
            signal = 'HOLD'
            signal_ar = '⚠️ سيولة ضعيفة — ابعد!'
        elif score >= BUY_THRESHOLD:
            signal = 'BUY'
            signal_ar = 'فرصة شراء قوية ✅'
        elif score >= HOLD_THRESHOLD:
            signal = 'HOLD'
            signal_ar = 'إشارة إيجابية 📈'
        else:
            signal = 'SELL'
            signal_ar = 'محايد - انتظر ⏳'

        # ── Build response ──
        return {
            'success': True,
            'ticker': ticker.upper(),
            'mode': 'DELAYED_LIVE' if self.delayed_mode else 'LIVE',
            'delayed_minutes': self.delayed_minutes,
            'delayed_mode': self.delayed_mode,
            'breakout_vetoed': breakout_vetoed,
            'daily_change_pct': round(daily_change_pct, 2),
            'golden_pullback_boost': golden_pullback_boost if is_golden_pullback else 0,
            'timestamp': datetime.now().isoformat(),
            'today_candle': today,
            'yesterday_rsi': round(yesterday_rsi, 2),
            'live_rsi': live_rsi,
            'live_macd': macd_line,
            'live_macd_signal': macd_signal,
            'live_macd_hist': macd_hist,
            'volume_ratio': vol_ratio,
            'candlestick': candle,
            'score': round(score, 1),
            'is_dead_cat': is_dead_cat,
            'is_golden_pullback': is_golden_pullback,
            'is_bullish_divergence': is_bullish_div,
            'is_trap': is_trap,  # STRATEGY-041: Trap Detector
            'is_low_liquidity': is_low_liquidity,  # STRATEGY-041: Liquidity Filter
            'reason': reason,
            'signal': signal,
            'signal_ar': signal_ar,
            'smc_detail': smc_detail,
            'breakdown': {
                'macro_trend': {'points': macro_pts, 'max': 25},
                'price_vs_sma50': {'points': sma50_pts, 'max': 18},
                'rsi': {'points': rsi_pts, 'max': 20, 'value': live_rsi},
                'volume': {'points': vol_pts, 'max': 20, 'ratio': vol_ratio},
                'bollinger': {'points': bb_pts, 'max': 10},
                'macd': {'points': macd_pts, 'max': 23, 'hist': macd_hist},
                'candlestick': {'points': candle_pts, 'max': 10, 'pattern': candle['name']},
                'fibonacci': {'points': fib_pts, 'max': 12},
                'smc': {'points': round(smc_pts, 1), 'max': 25, 'detail': smc_detail},
            },
            'sector': sector,
            'regime': regime,
        }

    # ── LIVE-ENGINE-028: Pine Script Smart Logic ──────────────────────────

    def detect_dead_cat_bounce(self, today_close: float, sma50: float,
                               rsi: float, yesterday_close: float) -> bool:
        """فخ الارتداد (Dead Cat Bounce).

        P41-DELAYED-DATA-MODE: لو الـ data متأخرة 5 دقايق، بنرفع عتبة الـ RSI من
        55 لـ 65 عشان نتجنب الإنذارات الكاذبة الناتجة عن تذبذب آخر 5 دقايق. الـ 5
        دقايق تأخير معناها إن الـ "bounce" اللي بنشوفه ممكن يكون خلص من زمان، فلازم
        نطلب تأكيد أقوى (RSI > 65) قبل ما نطلق إنذار فخ الارتداد.
        """
        if sma50 <= 0 or yesterday_close <= 0:
            return False
        was_below = yesterday_close < sma50
        now_above = today_close > sma50
        # P41-DELAYED-DATA-MODE: ارفع عتبة الـ RSI لـ 65 (بدل 55) لو الـ data متأخرة
        # عشان نتجنب الإنذارات الكاذبة من تذبذب آخر 5 دقايق. التأخير معناه إن الـ
        # bounce اللي بنشوفه ممكن يكون خلص، فلازم نطلب تأكيد أقوى قبل الـ veto.
        rsi_threshold = 65 if self.delayed_mode else 55
        rsi_high = rsi > rsi_threshold
        return was_below and now_above and rsi_high

    def detect_golden_pullback(self, today_close: float, sma50: float,
                               bb_lower: float, yesterday_close: float) -> bool:
        """التصحيح الذهبي (Golden Pullback)."""
        if sma50 <= 0 or bb_lower <= 0:
            return False
        was_above = yesterday_close > sma50
        pulled_back = today_close <= bb_lower * 1.01
        return was_above and pulled_back

    def detect_bullish_divergence(self, today_low: float, yesterday_low: float,
                                  today_rsi: float, yesterday_rsi: float) -> bool:
        """التباعد الإيجابي (Bullish Divergence)."""
        if yesterday_low <= 0 or yesterday_rsi <= 0:
            return False
        lower_low = today_low < yesterday_low
        higher_rsi = today_rsi > yesterday_rsi
        return lower_low and higher_rsi

    # ── فحص سريع لأعلى الفرص اللحظية ──────────────────────────────────────

    def scan_live_opportunities(self, limit: int = 10) -> Dict[str, Any]:
        """يفحص الأسهم النشطة ويرجع أعلى الفرص اللحظية."""
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(self.stocks_db, writable=False).__enter__()
            conn.execute('PRAGMA busy_timeout = 30000')
            cur = conn.cursor()
            # Get active stocks with price > 0 and volume > 0
            cur.execute('''
                SELECT ticker FROM stocks
                WHERE is_active = 1 AND current_price > 0 AND volume > 0
                ORDER BY volume DESC LIMIT 50
            ''')
            tickers = [r[0] for r in cur.fetchall()]
            conn.close()

            results = []
            for ticker in tickers:
                analysis = self.calculate_live_score(ticker)
                if analysis.get('success') and analysis['score'] >= HOLD_THRESHOLD:
                    results.append(analysis)

            # Sort by score DESC
            results.sort(key=lambda x: x['score'], reverse=True)
            return {
                'success': True,
                'mode': 'LIVE',
                'scanned': len(tickers),
                'found': len(results),
                'opportunities': results[:limit],
                'timestamp': datetime.now().isoformat(),
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def _get_recent_ohlcv(self, ticker: str, days: int = 90) -> List[Dict[str, Any]]:
        ohlcv = []
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(self.stocks_db, writable=False).__enter__()
            conn.execute('PRAGMA busy_timeout = 30000')
            cur = conn.cursor()
            cur.execute('''
                SELECT date, open, high, low, close, volume
                FROM price_history
                WHERE ticker = ?
                ORDER BY date DESC
                LIMIT ?
            ''', (ticker.upper(), days))
            rows = cur.fetchall()[::-1]
            conn.close()
            for r in rows:
                ohlcv.append({
                    'date': r[0],
                    'open': float(r[1] or 0),
                    'high': float(r[2] or 0),
                    'low': float(r[3] or 0),
                    'close': float(r[4] or 0),
                    'volume': float(r[5] or 0),
                })
        except Exception as e:
            logger.debug(f"[LiveIndicatorEngine] ohlcv fetch failed for {ticker}: {e}")
        return ohlcv

    # ========================================================================
    # REALITY-CHECK-023: AI Integration (دمج الذكاء الاصطناعي الحقيقي)
    # ========================================================================
    # الـ Score اللي بيطلع من المحرك لازم يمر على الـ AI (Ollama).
    # الـ AI بيبص على:
    # 1. التوقعات المفتوحة (PENDING) للسهم ده
    # 2. الأساسيات (لو فيه توقع فاشل سابق)
    # 3. المؤشرات اللحظية
    # وبيدي تعليق بناءً على الحسابات: "السهم ده توقعنا عليه صعود أمبارح
    # وهو دلوقتي نازل، إحذر، ممكن يكون فيه تصريف".
    # ========================================================================

    def get_ai_commentary(self, ticker: str, live_score: float = None,
                          current_price: float = None) -> Dict[str, Any]:
        """
        الحصول على تعليق الـ AI على السهم بناءً على المؤشرات والتوقعات المفتوحة.

        Args:
            ticker: رمز السهم
            live_score: الدرجة اللحظية (اختياري)
            current_price: السعر الحالي (اختياري)

        Returns:
            Dict: {ai_comment, ai_confidence, ai_decision, has_open_prediction, ...}
        """
        # محاولة استيراد GLMFinanceAgent (lazy import)
        try:
            import sys
            import os
            _vps_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            if _vps_root not in sys.path:
                sys.path.insert(0, _vps_root)
            from ai.glm_finance_agent import GLMFinanceAgent
        except Exception as e:
            return {
                'ai_comment': '',
                'ai_confidence': 0,
                'ai_decision': None,
                'ai_available': False,
                'ai_error': f'GLMFinanceAgent import failed: {e}',
            }

        try:
            agent = GLMFinanceAgent(timeout=30)

            # التحقق من توفر Ollama
            if not agent.is_available():
                return {
                    'ai_comment': '',
                    'ai_confidence': 0,
                    'ai_decision': None,
                    'ai_available': False,
                    'ai_error': 'Ollama not available',
                }

            # جلب التوقعات المفتوحة للسهم
            open_predictions = []
            try:
                from analyzers.prediction_tracker import PredictionTracker
                tracker = PredictionTracker(self.predictions_db)
                open_predictions = tracker.get_open_predictions(ticker=ticker, limit=5)
            except Exception:
                pass

            # جلب المؤشرات اللحظية
            live_data = self.calculate_live_score(ticker) if live_score is None else {'total_score': live_score}

            # بناء الـ prompt للـ AI
            prompt_parts = [f"حلّل السهم {ticker}:"]
            if current_price or live_data.get('current_price'):
                p = current_price or live_data.get('current_price')
                prompt_parts.append(f"- السعر الحالي: {p:.2f}")
            if live_data.get('rsi'):
                prompt_parts.append(f"- RSI: {live_data['rsi']:.1f}")
            if live_data.get('volume_ratio'):
                prompt_parts.append(f"- Volume Ratio: {live_data['volume_ratio']:.2f}x")
            prompt_parts.append(f"- Live Score: {live_data.get('total_score', 50):.1f}/100")

            # إضافة معلومات التوقعات المفتوحة
            if open_predictions:
                prompt_parts.append(f"\nالتوقعات المفتوحة على السهم ده ({len(open_predictions)} توقع):")
                for i, pred in enumerate(open_predictions[:3], 1):
                    entry = float(pred.get('entry_price', 0) or 0)
                    target = float(pred.get('target_price', 0) or 0)
                    stop = float(pred.get('stop_loss', 0) or 0)
                    signal = pred.get('signal_type', '?')
                    prompt_parts.append(
                        f"  توقع {i}: {signal} @ {entry:.2f}, هدف {target:.2f}, وقف {stop:.2f}"
                    )
                    # تتبع الزخم
                    if current_price and target > 0:
                        momentum = tracker.track_momentum(pred['id'], current_price)
                        if momentum.get('status') != 'error':
                            prompt_parts.append(f"    حالة الزخم: {momentum.get('momentum_status')}")
            else:
                prompt_parts.append("\nمفيش توقعات مفتوحة على السهم ده.")

            prompt_parts.append(
                "\nبناءً على البيانات دي، ادي تعليق قصير (سطرين بالكتير) بالعربي:"
                "\n- لو فيه تناقض بين التوقع والمؤشرات اللحظية → نبّه المستخدم"
                "\n- لو التوقع صاعد والسهم نازل → 'إحذر، ممكن يكون فيه تصريف'"
                "\n- لو التوقع هابط والسهم طالع → 'إحذر، التوقع ممكن يفشل'"
                "\n- لو كل حاجة متفقة → 'السهم ماشي حسب التوقع'"
                "\nرجّع JSON بصيغة: {\"comment\": \"التعليق\", \"confidence\": 0-100, \"decision\": \"agree|warn|disagree\"}"
            )

            prompt = "\n".join(prompt_parts)
            raw_response = agent._call_ollama(
                model=agent.FAST_MODEL,
                prompt=prompt,
                max_tokens=300,
                temperature=0.3,
            )

            # محاولة parse كـ JSON
            parsed = agent._parse_json_response(raw_response)
            if 'parse_error' in parsed:
                # لو الـ AI رد نص مش JSON، نستخدمه كـ comment مباشر
                return {
                    'ai_comment': raw_response[:300] if raw_response else '',
                    'ai_confidence': 50,
                    'ai_decision': 'agree',
                    'ai_available': True,
                    'has_open_predictions': len(open_predictions) > 0,
                    'open_predictions_count': len(open_predictions),
                }

            return {
                'ai_comment': parsed.get('comment', raw_response[:300]),
                'ai_confidence': float(parsed.get('confidence', 50)),
                'ai_decision': parsed.get('decision', 'agree'),
                'ai_available': True,
                'has_open_predictions': len(open_predictions) > 0,
                'open_predictions_count': len(open_predictions),
            }

        except Exception as e:
            return {
                'ai_comment': '',
                'ai_confidence': 0,
                'ai_decision': None,
                'ai_available': False,
                'ai_error': str(e),
            }


# Singleton
_live_engine = None

def get_live_engine() -> LiveIndicatorEngine:
    """Singleton factory — يبني الـ LiveIndicatorEngine مرة واحدة ويـ cacheه.

    P41-DELAYED-DATA-MODE: الـ LiveIndicatorEngine بيقرأ DELAYED_DATA_MINUTES من
    الـ environment في __init__، فالـ singleton بياخد قيمة الـ env وقت الإنشاء.
    لو الـ env value اتغيرت بعد كده، الـ singleton مش هيتأثر — ده مقصود عشان
    الـ behavior يبقى deterministic خلال عمر الـ process.
    """
    global _live_engine
    if _live_engine is None:
        _live_engine = LiveIndicatorEngine()
    return _live_engine
