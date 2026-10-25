"""
Dividend Event Impact Tracker (Phase 4 — Multi-Market Extension)
================================================================
يتتبع أحداث توزيع الأرباح وتأثيرها على السعر، ويبني "بروفايل سلوكي" لكل سهم.

الفلسفة:
    "الأسعار بتنزل قبل وبعد التوزيع بنمط متكرر.
     لو فهمنا النمط، نقدر نتنبأ بنوبة الهبوط القادمة."

═══════════════════════════════════════════════════════════════════════════
المصادر البيانية:
═══════════════════════════════════════════════════════════════════════════
  1. data_engine.db → tab_dividends (DPS, cont_div, payout, yield)
  2. price_history.db → price_history (daily OHLCV — 274K صف من 2025-01-09)

═══════════════════════════════════════════════════════════════════════════
الآلية:
═══════════════════════════════════════════════════════════════════════════
  1. detect_dividend_events(ticker)
     - يجيب تاريخ آخر حدث drop كبير (>3% في يوم) من price_history
     - يقارنه بنمط التوزيع (لو cont_div ≥ 1، السهم يوزع)
     - يخمن ex-dividend date بناءً على آخر drop + periodicity (سنوي/نصف سنوي)

  2. build_behavioral_profile(ticker)
     - يحسب لكل حدث اكتشفه:
       * pre_event_drift  (معدل الحركة 7 أيام قبل الحدث)
       * event_day_drop   (الهبوط يوم الحدث)
       * post_event_recovery (معدل التعافي 7 أيام بعد)
       * recovery_days     (عدد أيام التعافي للرجوع لـ pre-event price)
     - يبني متوسطات (avg, std) للسلوك المتوقع

  3. get_event_context(ticker)
     - يرجع context كامل للـ analyzer:
       * last_event_date
       * next_predicted_event
       * days_to_next_event
       * behavioral_profile
       * recommendation_modifier: 'WAIT_FOR_DIP' | 'BUY_NOW' | 'NEUTRAL'
       * confidence (0-1)

═══════════════════════════════════════════════════════════════════════════
الـ recommendation_modifier logic:
═══════════════════════════════════════════════════════════════════════════
  - days_to_next_event ≤ 5  → 'WAIT_FOR_DIP' (السعر هينزل قريب — استنى)
  - days_to_next_event ≤ 14 → 'CAUTION' (قريب من الحدث — حذر)
  - days_to_next_event > 14 → 'BUY_NOW' (بعيد عن الحدث — آمن)
  - لو مفيش بيانات → 'NEUTRAL'

Usage:
    from analyzers.event_impact_tracker import DividendEventTracker
    tracker = DividendEventTracker()
    ctx = tracker.get_event_context('COMI')
    if ctx['recommendation_modifier'] == 'WAIT_FOR_DIP':
        # خفض الثقة — السعر هينزل قريب
        confidence -= 10
"""

import sqlite3
import os
import logging
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()


# ============================================================================
# Data Models
# ============================================================================

@dataclass
class DividendEvent:
    """حدث توزيع أرباح واحد."""
    date: str               # YYYY-MM-DD
    ticker: str
    pre_event_price: Optional[float] = None
    event_day_price: Optional[float] = None
    post_event_price: Optional[float] = None
    pre_event_drift: Optional[float] = None     # % change 7d before
    event_day_drop: Optional[float] = None      # % drop on event day
    post_event_recovery: Optional[float] = None # % recovery 7d after
    recovery_days: Optional[int] = None         # days to recover pre-event price
    is_estimated: bool = True                   # True لو heuristic, False لو confirmed


@dataclass
class BehavioralProfile:
    """البروفايل السلوكي لسهم حول أحداث التوزيع."""
    ticker: str
    has_dividends: bool = False
    cont_div_years: Optional[int] = None
    dps_ttm: Optional[float] = None
    div_yield: Optional[float] = None
    payout_ratio: Optional[float] = None
    events_analyzed: int = 0
    avg_pre_event_drift: Optional[float] = None
    avg_event_day_drop: Optional[float] = None
    avg_post_event_recovery: Optional[float] = None
    avg_recovery_days: Optional[float] = None
    consistency_score: float = 0.0  # 0-1 (هل النمط بيتكرر؟)
    last_event_date: Optional[str] = None
    next_predicted_event: Optional[str] = None
    days_to_next_event: Optional[int] = None
    recommendation_modifier: str = 'NEUTRAL'  # WAIT_FOR_DIP | CAUTION | BUY_NOW | NEUTRAL
    confidence: float = 0.0  # 0-1
    notes: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'ticker': self.ticker,
            'has_dividends': self.has_dividends,
            'cont_div_years': self.cont_div_years,
            'dps_ttm': self.dps_ttm,
            'div_yield': self.div_yield,
            'payout_ratio': self.payout_ratio,
            'events_analyzed': self.events_analyzed,
            'avg_pre_event_drift': round(self.avg_pre_event_drift, 2) if self.avg_pre_event_drift is not None else None,
            'avg_event_day_drop': round(self.avg_event_day_drop, 2) if self.avg_event_day_drop is not None else None,
            'avg_post_event_recovery': round(self.avg_post_event_recovery, 2) if self.avg_post_event_recovery is not None else None,
            'avg_recovery_days': round(self.avg_recovery_days, 1) if self.avg_recovery_days is not None else None,
            'consistency_score': round(self.consistency_score, 2),
            'last_event_date': self.last_event_date,
            'next_predicted_event': self.next_predicted_event,
            'days_to_next_event': self.days_to_next_event,
            'recommendation_modifier': self.recommendation_modifier,
            'confidence': round(self.confidence, 2),
            'notes': self.notes,
        }


# ============================================================================
# Dividend Event Tracker
# ============================================================================

class DividendEventTracker:
    """
    يتتبع أحداث توزيع الأرباح وتأثيرها على السعر.

    بيستخدم heuristic approach:
      - يكتشف الـ price drops الكبيرة (>3%) في price_history
      - يقارنها بنمط التوزيع من tab_dividends
      - يبني behavioral profile للسهم
    """

    # Thresholds
    DROP_THRESHOLD = -3.0     # % drop ليُعتبر "حدث" محتمل
    LOOKBACK_DAYS = 252       # ~1 سنة تداول
    PRE_EVENT_WINDOW = 7      # أيام قبل الحدث
    POST_EVENT_WINDOW = 7     # أيام بعد الحدث
    RECOVERY_MAX_DAYS = 30    # حد أقصى للبحث عن recovery

    # Cache للـ DB connections
    _de_cache: Dict[str, sqlite3.Connection] = {}
    _ph_cache: Dict[str, sqlite3.Connection] = {}

    # Cache للـ profiles (يتجدد يومياً)
    _profile_cache: Dict[str, Tuple[BehavioralProfile, float]] = {}
    _profile_cache_ttl = 3600.0  # 1 ساعة

    def __init__(self,
                 data_engine_path: str = None,
                 price_history_path: str = None):
        data_engine_path = data_engine_path or str(_PROJECT_ROOT / 'db' / 'data_engine.db')
        price_history_path = price_history_path or str(_PROJECT_ROOT / 'db' / 'price_history.db')
        self.data_engine_path = data_engine_path
        self.price_history_path = price_history_path

    # ========================================================================
    # DB Connections
    # ========================================================================

    def _get_de_connection(self) -> Optional[sqlite3.Connection]:
        """data_engine.db connection."""
        if not os.path.exists(self.data_engine_path):
            return None
        if self.data_engine_path in self._de_cache:
            try:
                self._de_cache[self.data_engine_path].execute('SELECT 1')
                return self._de_cache[self.data_engine_path]
            except sqlite3.Error:
                del self._de_cache[self.data_engine_path]
        try:
            conn = sqlite3.connect(self.data_engine_path, timeout=5.0)
            conn.row_factory = sqlite3.Row
            self._de_cache[self.data_engine_path] = conn
            return conn
        except sqlite3.Error as e:
            logger.error(f"Error opening data_engine: {e}")
            return None

    def _get_ph_connection(self) -> Optional[sqlite3.Connection]:
        """price_history.db connection."""
        if not os.path.exists(self.price_history_path):
            return None
        if self.price_history_path in self._ph_cache:
            try:
                self._ph_cache[self.price_history_path].execute('SELECT 1')
                return self._ph_cache[self.price_history_path]
            except sqlite3.Error:
                del self._ph_cache[self.price_history_path]
        try:
            conn = sqlite3.connect(self.price_history_path, timeout=5.0)
            conn.row_factory = sqlite3.Row
            self._ph_cache[self.price_history_path] = conn
            return conn
        except sqlite3.Error as e:
            logger.error(f"Error opening price_history: {e}")
            return None

    # ========================================================================
    # Step 1: Fetch dividend metadata (DPS, cont_div, etc.)
    # ========================================================================

    def _fetch_dividend_metadata(self, ticker: str) -> Optional[Dict[str, Any]]:
        """يجيب بيانات التوزيع من tab_dividends."""
        conn = self._get_de_connection()
        if conn is None:
            return None
        try:
            cur = conn.cursor()
            # tab_dividends فيها symbol + market + dps_ttm + div_yield + cont_div
            cur.execute(
                """SELECT symbol, market, dps_ttm, div_yield, div_yield_fwd,
                          payout_ratio, cont_div, cont_div_growth
                   FROM tab_dividends
                   WHERE symbol LIKE ? LIMIT 1""",
                (f"{ticker}%",)
            )
            row = cur.fetchone()
            return dict(row) if row else None
        except sqlite3.Error as e:
            logger.debug(f"Error fetching dividend metadata for {ticker}: {e}")
            return None

    # ========================================================================
    # Step 2: Fetch price history
    # ========================================================================

    def _fetch_price_history(self, ticker: str, limit: int = 365) -> List[Dict[str, Any]]:
        """يجيب تاريخ السعر من price_history.db."""
        conn = self._get_ph_connection()
        if conn is None:
            return []
        try:
            cur = conn.cursor()
            cur.execute(
                """SELECT date, open_price, high_price, low_price, close_price, volume
                   FROM price_history
                   WHERE ticker = ?
                   ORDER BY date DESC LIMIT ?""",
                (ticker, limit)
            )
            rows = cur.fetchall()
            # نرجّعها مرتبة تصاعدياً بالتاريخ
            return [dict(r) for r in reversed(rows)]
        except sqlite3.Error as e:
            logger.debug(f"Error fetching price history for {ticker}: {e}")
            return []

    # ========================================================================
    # Step 3: Detect ex-dividend events (heuristic)
    # ========================================================================

    def detect_dividend_events(self, ticker: str) -> List[DividendEvent]:
        """
        يكتشف أحداث توزيع الأرباح من price action.

        الـ heuristic:
          - يجيب تاريخ السعر لآخر سنة
          - يدوّر على أيام فيها close < previous_close * (1 - DROP_THRESHOLD/100)
          - لكل حدث، يحسب pre/post metrics
          - يفلتر الأحداث اللي مش dividend-related (مثلاً market-wide crash)
            بناءً على cont_div (لو cont_div ≥ 1، السهم يوزع)
        """
        meta = self._fetch_dividend_metadata(ticker)
        # لو cont_div = 0 أو None، السهم ما يوزعش — نرجع قائمة فارغة
        if meta:
            cont_div = self._parse_numeric(meta.get('cont_div'))
            if cont_div is not None and cont_div == 0:
                return []

        prices = self._fetch_price_history(ticker, limit=self.LOOKBACK_DAYS)
        if len(prices) < 30:  # محتاجين على الأقل شهر
            return []

        events: List[DividendEvent] = []

        # ندور على drops كبيرة
        for i in range(1, len(prices)):
            prev_close = prices[i - 1]['close_price']
            curr_close = prices[i]['close_price']
            if not prev_close or not curr_close:
                continue

            pct_change = ((curr_close - prev_close) / prev_close) * 100.0
            if pct_change <= self.DROP_THRESHOLD:
                # حدث محتمل — نحسب الـ metrics
                event = self._build_event(prices, i, ticker)
                if event:
                    events.append(event)

        # نفلتر: نشيل الأحداث المتتالية (crash ممكن يطلع أحداث متتالية)
        # بنحتفظ بأقوى حدث في كل نافذة 7 أيام
        filtered = self._filter_consecutive_events(events)

        return filtered

    def _build_event(self, prices: List[Dict[str, Any]], idx: int, ticker: str) -> Optional[DividendEvent]:
        """يبني DividendEvent للموقع idx في قائمة الأسعار."""
        event_date = prices[idx]['date']
        event_price = prices[idx]['close_price']

        # pre_event_drift: نسبة التغير من (idx - 7) لـ (idx - 1)
        pre_start = max(0, idx - self.PRE_EVENT_WINDOW)
        pre_end = idx - 1
        pre_event_drift = None
        pre_event_price = None
        if pre_end > pre_start and prices[pre_start]['close_price']:
            pre_event_price = prices[pre_end]['close_price']
            start_price = prices[pre_start]['close_price']
            if start_price:
                pre_event_drift = ((pre_event_price - start_price) / start_price) * 100.0

        # post_event_recovery: نسبة التغير من (idx) لـ (idx + 7)
        post_end = min(len(prices) - 1, idx + self.POST_EVENT_WINDOW)
        post_event_price = prices[post_end]['close_price'] if post_end > idx else None
        post_event_recovery = None
        if post_event_price and event_price:
            post_event_recovery = ((post_event_price - event_price) / event_price) * 100.0

        # recovery_days: كم يوم احتاج السهم ليرجوع لـ pre-event price
        recovery_days = None
        if pre_event_price and event_price < pre_event_price:
            target = pre_event_price
            for j in range(idx + 1, min(len(prices), idx + self.RECOVERY_MAX_DAYS + 1)):
                if prices[j]['close_price'] and prices[j]['close_price'] >= target:
                    recovery_days = j - idx
                    break

        return DividendEvent(
            date=event_date,
            ticker=ticker,
            pre_event_price=pre_event_price,
            event_day_price=event_price,
            post_event_price=post_event_price,
            pre_event_drift=pre_event_drift,
            event_day_drop=((event_price - (prices[idx - 1]['close_price'] or event_price))
                            / (prices[idx - 1]['close_price'] or event_price)) * 100.0,
            post_event_recovery=post_event_recovery,
            recovery_days=recovery_days,
            is_estimated=True,
        )

    def _filter_consecutive_events(self, events: List[DividendEvent]) -> List[DividendEvent]:
        """يشيل الأحداث المتتالية (crash)، ويحتفظ بأقوى حدث كل 7 أيام."""
        if not events:
            return []
        # ترتيب بالتاريخ
        sorted_events = sorted(events, key=lambda e: e.date)
        filtered: List[DividendEvent] = []
        last_kept_date = None

        for ev in sorted_events:
            if last_kept_date is None:
                filtered.append(ev)
                last_kept_date = ev.date
            else:
                # الفرق بالأيام
                try:
                    d1 = datetime.strptime(last_kept_date, '%Y-%m-%d')
                    d2 = datetime.strptime(ev.date, '%Y-%m-%d')
                    days_diff = (d2 - d1).days
                    if days_diff >= 7:
                        filtered.append(ev)
                        last_kept_date = ev.date
                    else:
                        # لو الحدث الجديد أقوى (drop أكبر)، نستبدله
                        if (ev.event_day_drop or 0) < (filtered[-1].event_day_drop or 0):
                            filtered[-1] = ev
                            last_kept_date = ev.date
                except ValueError:
                    continue

        return filtered

    # ========================================================================
    # Step 4: Build Behavioral Profile
    # ========================================================================

    def build_behavioral_profile(self, ticker: str) -> BehavioralProfile:
        """يبني بروفايل سلوكي كامل للسهم."""
        # نتأكد من cache
        cache_key = ticker
        cached = self._profile_cache.get(cache_key)
        if cached:
            profile, ts = cached
            if (datetime.now().timestamp() - ts) < self._profile_cache_ttl:
                return profile

        profile = BehavioralProfile(ticker=ticker)
        notes = []

        # 1) dividend metadata
        meta = self._fetch_dividend_metadata(ticker)
        if meta:
            profile.dps_ttm = self._parse_numeric(meta.get('dps_ttm'))
            profile.div_yield = self._parse_percent(meta.get('div_yield'))
            profile.payout_ratio = self._parse_percent(meta.get('payout_ratio'))
            cont_div = self._parse_numeric(meta.get('cont_div'))
            profile.cont_div_years = int(cont_div) if cont_div is not None else None
            profile.has_dividends = (cont_div is not None and cont_div > 0)
            if profile.has_dividends:
                notes.append(f'السهم يوزع أرباح منذ {profile.cont_div_years} سنوات')
            else:
                notes.append('السهم لا يوزع أرباح')
        else:
            notes.append('لا توجد بيانات توزيعات في tab_dividends')

        # 2) detect events
        events = self.detect_dividend_events(ticker) if profile.has_dividends or meta is None else []
        profile.events_analyzed = len(events)

        if events:
            # حساب المتوسطات
            pre_drifts = [e.pre_event_drift for e in events if e.pre_event_drift is not None]
            day_drops = [e.event_day_drop for e in events if e.event_day_drop is not None]
            recoveries = [e.post_event_recovery for e in events if e.post_event_recovery is not None]
            rec_days = [e.recovery_days for e in events if e.recovery_days is not None]

            if pre_drifts:
                profile.avg_pre_event_drift = sum(pre_drifts) / len(pre_drifts)
            if day_drops:
                profile.avg_event_day_drop = sum(day_drops) / len(day_drops)
            if recoveries:
                profile.avg_post_event_recovery = sum(recoveries) / len(recoveries)
            if rec_days:
                profile.avg_recovery_days = sum(rec_days) / len(rec_days)

            # consistency_score: هل النمط بيتكرر؟
            # بنحسبه بناءً على عدد الأحداث + تشابه الـ day_drops
            if len(events) >= 2 and day_drops:
                avg = sum(day_drops) / len(day_drops)
                variance = sum((x - avg) ** 2 for x in day_drops) / len(day_drops)
                std = variance ** 0.5
                # لو الـ std صغير بالنسبة للـ avg، النمط متسق
                if abs(avg) > 0:
                    cv = std / abs(avg)  # coefficient of variation
                    profile.consistency_score = max(0.0, min(1.0, 1.0 - cv))
                else:
                    profile.consistency_score = 0.5
            else:
                profile.consistency_score = 0.3 if events else 0.0

            # آخر حدث
            last_event = max(events, key=lambda e: e.date)
            profile.last_event_date = last_event.date

            # توقع الحدث القادم
            next_event = self._predict_next_event(events, profile.cont_div_years)
            if next_event:
                profile.next_predicted_event = next_event
                # حساب days_to_next_event
                try:
                    next_dt = datetime.strptime(next_event, '%Y-%m-%d')
                    today = datetime.now()
                    diff = (next_dt - today).days
                    profile.days_to_next_event = diff
                except ValueError:
                    pass

            # confidence بناءً على عدد الأحداث + consistency
            profile.confidence = min(1.0, (len(events) / 4.0) * 0.5 + profile.consistency_score * 0.5)
            notes.append(f'حللنا {len(events)} حدث توزيع في آخر سنة')

            if profile.avg_event_day_drop is not None:
                notes.append(f'متوسط الهبوط يوم الحدث: {profile.avg_event_day_drop:.2f}%')
            if profile.avg_recovery_days is not None:
                notes.append(f'متوسط أيام التعافي: {profile.avg_recovery_days:.1f} يوم')
        else:
            if profile.has_dividends:
                notes.append('لم نكتشف أحداث توزيع واضحة في price action (قد تكون بسيطة)')
                profile.confidence = 0.2
            else:
                profile.confidence = 0.0

        # recommendation_modifier
        profile.recommendation_modifier = self._compute_recommendation_modifier(profile)
        profile.notes = notes

        # cache
        self._profile_cache[cache_key] = (profile, datetime.now().timestamp())
        return profile

    def _predict_next_event(self, events: List[DividendEvent], cont_div: Optional[int]) -> Optional[str]:
        """
        يتنبأ بتاريخ الحدث القادم بناءً على:
          - آخر حدث
          - الفترة بين الأحداث السابقة (periodicity)
        """
        if not events:
            return None
        sorted_events = sorted(events, key=lambda e: e.date)
        last_event = sorted_events[-1]

        try:
            last_dt = datetime.strptime(last_event.date, '%Y-%m-%d')
        except ValueError:
            return None

        # لو فيه ≥ 2 events، نحسب الفترة بينهم
        if len(sorted_events) >= 2:
            intervals = []
            for i in range(1, len(sorted_events)):
                try:
                    d1 = datetime.strptime(sorted_events[i - 1].date, '%Y-%m-%d')
                    d2 = datetime.strptime(sorted_events[i].date, '%Y-%m-%d')
                    intervals.append((d2 - d1).days)
                except ValueError:
                    continue
            if intervals:
                avg_interval = sum(intervals) / len(intervals)
                # نفلتر الـ intervals المتطرفة (outliers)
                reasonable = [x for x in intervals if 60 <= x <= 400]
                if reasonable:
                    avg_interval = sum(reasonable) / len(reasonable)
                next_dt = last_dt + timedelta(days=int(avg_interval))
                return next_dt.strftime('%Y-%m-%d')

        # fallback: بناءً على cont_div (لو ≥ 1، السهم يوزع سنوياً عادةً)
        if cont_div and cont_div >= 1:
            # افتراض توزيع سنوي
            next_dt = last_dt + timedelta(days=365)
            return next_dt.strftime('%Y-%m-%d')

        return None

    def _compute_recommendation_modifier(self, profile: BehavioralProfile) -> str:
        """يحسب الـ recommendation_modifier بناءً على days_to_next_event."""
        if profile.days_to_next_event is None:
            return 'NEUTRAL'
        if profile.days_to_next_event <= 5:
            return 'WAIT_FOR_DIP'
        if profile.days_to_next_event <= 14:
            return 'CAUTION'
        return 'BUY_NOW'

    # ========================================================================
    # Step 5: Get Event Context (for analyzer integration)
    # ========================================================================

    def get_event_context(self, ticker: str) -> Dict[str, Any]:
        """
        يرجع context كامل للـ analyzer.

        Returns:
            dict مع:
              - has_dividends
              - cont_div_years
              - last_event_date
              - next_predicted_event
              - days_to_next_event
              - recommendation_modifier
              - confidence
              - behavioral_profile (avg drop, recovery, etc.)
              - signal_adjustment (int: -15..+5 — تعديل الثقة)
              - notes
        """
        profile = self.build_behavioral_profile(ticker)

        # signal_adjustment: تعديل الثقة للـ MR signal
        signal_adjustment = 0
        if profile.recommendation_modifier == 'WAIT_FOR_DIP':
            signal_adjustment = -15  # خفض الثقة — السعر هينزل قريب
        elif profile.recommendation_modifier == 'CAUTION':
            signal_adjustment = -5
        elif profile.recommendation_modifier == 'BUY_NOW':
            # لو السهم بيتعافى بعد التوزيع بسرعة، ممكن نزود الثقة شوية
            if profile.avg_post_event_recovery and profile.avg_post_event_recovery > 2:
                signal_adjustment = +3
            else:
                signal_adjustment = 0

        return {
            'ticker': ticker,
            'has_dividends': profile.has_dividends,
            'cont_div_years': profile.cont_div_years,
            'div_yield': profile.div_yield,
            'payout_ratio': profile.payout_ratio,
            'last_event_date': profile.last_event_date,
            'next_predicted_event': profile.next_predicted_event,
            'days_to_next_event': profile.days_to_next_event,
            'recommendation_modifier': profile.recommendation_modifier,
            'confidence': profile.confidence,
            'behavioral_profile': {
                'events_analyzed': profile.events_analyzed,
                'avg_pre_event_drift': profile.avg_pre_event_drift,
                'avg_event_day_drop': profile.avg_event_day_drop,
                'avg_post_event_recovery': profile.avg_post_event_recovery,
                'avg_recovery_days': profile.avg_recovery_days,
                'consistency_score': profile.consistency_score,
            },
            'signal_adjustment': signal_adjustment,
            'notes': profile.notes,
        }

    # ========================================================================
    # Parser Helpers
    # ========================================================================

    @staticmethod
    def _parse_numeric(value: Any) -> Optional[float]:
        """يحول قيمة مالية نصية لـ float (نفس logic الـ quality_gate)."""
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        import re
        s = str(value).strip()
        if not s or s.lower() in ('n/a', 'na', '-', '--', 'null', 'none'):
            return None
        # Unicode minus
        s = s.replace('\u2212', '-').replace('\u200b', '').replace('\u202f', ' ')
        s = s.replace(',', '')
        # unit detection
        multiplier = 1.0
        unit_match = re.search(r'\b([MBKT])\b', s, re.IGNORECASE)
        if unit_match:
            unit = unit_match.group(1).upper()
            multipliers = {'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12}
            multiplier = multipliers.get(unit, 1.0)
            s = s[:unit_match.start()] + s[unit_match.end():]
        is_percent = '%' in s
        s = s.replace('%', '').strip()
        num_match = re.search(r'-?\d+\.?\d*', s)
        if not num_match:
            return None
        try:
            num = float(num_match.group())
            if not is_percent:
                num = num * multiplier
            return num
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _parse_percent(value: Any) -> Optional[float]:
        return DividendEventTracker._parse_numeric(value)

    def close(self):
        for conn in self._de_cache.values():
            try:
                conn.close()
            except Exception:
                pass
        for conn in self._ph_cache.values():
            try:
                conn.close()
            except Exception:
                pass
        self._de_cache.clear()
        self._ph_cache.clear()
        self._profile_cache.clear()


# ============================================================================
# Convenience Singleton
# ============================================================================

_default_tracker: Optional[DividendEventTracker] = None


def get_event_context(ticker: str) -> Dict[str, Any]:
    """
    دالة مساعدة سريعة لجلب event context.

    Usage:
        from analyzers.event_impact_tracker import get_event_context
        ctx = get_event_context('COMI')
        if ctx['recommendation_modifier'] == 'WAIT_FOR_DIP':
            confidence += ctx['signal_adjustment']  # -15
    """
    global _default_tracker
    if _default_tracker is None:
        _default_tracker = DividendEventTracker()
    return _default_tracker.get_event_context(ticker)


# ============================================================================
# CLI / Test Mode
# ============================================================================

if __name__ == '__main__':
    print("=" * 80)
    print("📅 Dividend Event Impact Tracker (Phase 4 — Multi-Market)")
    print("=" * 80)

    tracker = DividendEventTracker()

    # اختبار أسهم EGX معروفة بالتوزيعات
    test_tickers = ['COMI', 'ETEL', 'TMGH', 'FWRY', 'HRHO', 'SWDY', 'ABUK', 'EFID']

    print(f"\n📊 فحص {len(test_tickers)} سهم:")
    print("-" * 120)
    print(f"{'Ticker':8s} | {'HasDiv':6s} | {'ContDiv':7s} | {'LastEvent':12s} | {'NextEvent':12s} | "
          f"{'Days':5s} | {'AvgDrop':8s} | {'RecDays':7s} | {'Modifier':14s} | {'Conf':5s}")
    print("-" * 120)

    for ticker in test_tickers:
        ctx = tracker.get_event_context(ticker)
        bp = ctx['behavioral_profile']
        has_div = '✓' if ctx['has_dividends'] else '✗'
        cont = str(ctx['cont_div_years'] or '-')
        last = ctx['last_event_date'] or '-'
        nxt = ctx['next_predicted_event'] or '-'
        days = str(ctx['days_to_next_event'] if ctx['days_to_next_event'] is not None else '-')
        avg_drop = f"{bp['avg_event_day_drop']:.2f}%" if bp['avg_event_day_drop'] is not None else '-'
        rec_days = f"{bp['avg_recovery_days']:.1f}" if bp['avg_recovery_days'] is not None else '-'
        mod = ctx['recommendation_modifier']
        conf = f"{ctx['confidence']:.2f}"
        print(f"{ticker:8s} | {has_div:6s} | {cont:7s} | {last:12s} | {nxt:12s} | "
              f"{days:5s} | {avg_drop:8s} | {rec_days:7s} | {mod:14s} | {conf:5s}")

    # تفاصيل كاملة لأول سهم
    print("\n" + "=" * 80)
    print("✅ تفاصيل كاملة لـ COMI:")
    print("=" * 80)
    import json
    ctx = tracker.get_event_context('COMI')
    print(json.dumps(ctx, indent=2, ensure_ascii=False, default=str))

    tracker.close()
