"""
Crypto Event Impact Tracker
============================
متتبع تأثير أحداث العملات الرقمية — المكافئ لأحداث توزيعات الأسهم.

بينما الأسهم عندها أحداث توزيع أرباح (dividend events)، العملات الرقمية
عندها أنواع مختلفة من الأحداث اللي بتأثر على السعر:

═══════════════════════════════════════════════════════════════════════════
الفرق بين أحداث الأسهم والكريبتو:
═══════════════════════════════════════════════════════════════════════════
  الأسهم (Stocks):                    الكريبتو (Crypto):
  ─────────────────                   ──────────────────
  Ex-Dividend Date                    Token Unlock (Vesting)
  Earnings Reports                    Hard Fork
  Stock Splits                        Exchange Listing
  Buyback Programs                    SEC/Regulatory Action
  Board Meetings                      Whale Movement
  ─                                   Staking Reward
  ─                                   Mainnet Launch
  ─                                   Protocol Upgrade

═══════════════════════════════════════════════════════════════════════════
أنواع الأحداث وتأثيرها:
═══════════════════════════════════════════════════════════════════════════
  | الحدث              | التأثير          | التوصية      | Modifier       |
  |--------------------|-----------------|-------------|----------------|
  | Token Unlock       | -15% نموذجي     | WAIT 7 أيام  | -15/≤7d, -10/≤14d, -5/≤30d |
  | Hard Fork          | ±20% تقلب       | CAUTION      | -10/≤14d, -5/≤30d |
  | Exchange Listing   | +30% قصير المدى | AVOID (FOMO) | -8 (لا تلاحق)  |
  | SEC/Regulatory     | -40% ممكن       | WAIT         | -15 pending, -10 recent |
  | Whale Movement     | ±10%            | CAUTION      | -5 لو حركة كبيرة |
  | Staking Reward     | +5% APY         | INFO only    | +2 (إيجابي بسيط) |
  | Mainnet Launch     | +15-25%         | POSITIVE     | +5 لو مؤكد     |
  | Protocol Upgrade   | ±10%            | CAUTION      | -3/≤7d         |

═══════════════════════════════════════════════════════════════════════════
الآلية:
═══════════════════════════════════════════════════════════════════════════
  1. get_event_profile(symbol)
     - يجيب كل الأحداث المعروفة لعملة معينة
     - يحسب الأحداث النشطة (خلال 30 يوم)
     - يحسب أسوأ modifier من الأحداث النشطة

  2. check_events(symbol)
     - نقطة الدخول الرئيسية
     - يرجع CryptoEventResult بالتوصيات والتحذيرات

  3. get_all_active_events()
     - يجيب كل الأحداث النشطة لكل العملات

  4. _estimate_whale_risk(symbol)
     - يفحص volume anomalies من crypto_prices
     - يكتشف حركات الحيتان المحتملة

═══════════════════════════════════════════════════════════════════════════
الـ recommendation_modifier logic:
═══════════════════════════════════════════════════════════════════════════
  - modifier سالب كبير (مثلاً -15) → خفض ثقة MR signal بقوة
  - modifier سالب صغير (مثلاً -3) → خفض ثقة بسيط
  - modifier موجب (مثلاً +5) → زوّد الثقة بسيط
  - modifier = 0 → مفيش أحداث مؤثرة

Usage:
    from analyzers.crypto_event_tracker import CryptoEventTracker
    tracker = CryptoEventTracker()
    result = tracker.check_events('BTC')
    if result.should_wait:
        # خفض الثقة — في حدث خطير قريب
        conviction += result.recommendation_modifier  # modifier سالب
"""

import sqlite3
import logging
import math
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta, date

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()


# ============================================================================
# CONFIGURATION — Event Types, Impact Scores, Recommendation Modifiers
# ============================================================================

# أنواع أحداث الكريبتو مع تأثيرها
CRYPTO_EVENT_TYPES = {
    'token_unlock': {
        'name': 'Token Unlock (Vesting)',
        'name_ar': 'إلغاء قفل التوكن',
        'typical_impact': -0.15,          # -15% نموذجي
        'impact_range': (-0.25, -0.05),   # من -25% إلى -5%
        'recommendation': 'WAIT',
        'recommendation_ar': 'استنى 7 أيام',
        'modifiers': {
            'within_7d': -15,
            'within_14d': -10,
            'within_30d': -5,
            'beyond_30d': 0,
        },
        'volatility_window': 14,  # أيام التقلب بعد الحدث
    },
    'hard_fork': {
        'name': 'Hard Fork',
        'name_ar': 'انقسام الشبكة',
        'typical_impact': 0.0,            # ±20% تقلب (مش اتجاهي)
        'impact_range': (-0.20, 0.20),    # من -20% إلى +20%
        'recommendation': 'CAUTION',
        'recommendation_ar': 'حذر — تقلب عالي',
        'modifiers': {
            'within_14d': -10,
            'within_30d': -5,
            'beyond_30d': 0,
        },
        'volatility_window': 21,
    },
    'exchange_listing': {
        'name': 'Exchange Listing',
        'name_ar': 'إدراج في بورصة',
        'typical_impact': 0.30,           # +30% قصير المدى
        'impact_range': (0.10, 0.50),     # من +10% إلى +50%
        'recommendation': 'AVOID',
        'recommendation_ar': 'تجنب — لا تلاحق الفومو',
        'modifiers': {
            'within_7d': -8,    # لا تلاحق بعد الإدراج
            'within_14d': -5,
            'within_30d': -2,
            'beyond_30d': 0,
        },
        'volatility_window': 7,
    },
    'sec_regulatory': {
        'name': 'SEC/Regulatory Action',
        'name_ar': 'إجراء تنظيمي',
        'typical_impact': -0.40,          # -40% ممكن
        'impact_range': (-0.60, -0.10),   # من -60% إلى -10%
        'recommendation': 'WAIT',
        'recommendation_ar': 'استنى — خطر تنظيمي',
        'modifiers': {
            'pending': -15,    # الإجراء معلق
            'recent': -10,     # إجراء حديث (خلال 30 يوم)
            'beyond_30d': -3,  # أثر مستمر بسيط
        },
        'volatility_window': 30,
    },
    'whale_movement': {
        'name': 'Whale Movement',
        'name_ar': 'حركة حوت',
        'typical_impact': 0.0,            # ±10%
        'impact_range': (-0.10, 0.10),
        'recommendation': 'CAUTION',
        'recommendation_ar': 'حذر — حركة كبيرة',
        'modifiers': {
            'large_movement': -5,  # حركة كبيرة مكتشفة
            'moderate': -2,
            'small': 0,
        },
        'volatility_window': 3,
    },
    'staking_reward': {
        'name': 'Staking Reward',
        'name_ar': 'مكافأة Staking',
        'typical_impact': 0.05,           # +5% APY
        'impact_range': (0.02, 0.10),
        'recommendation': 'INFO',
        'recommendation_ar': 'معلومة فقط',
        'modifiers': {
            'active': 2,     # إيجابي بسيط
            'inactive': 0,
        },
        'volatility_window': 0,
    },
    'mainnet_launch': {
        'name': 'Mainnet Launch',
        'name_ar': 'إطلاق الشبكة الرئيسية',
        'typical_impact': 0.20,           # +15-25%
        'impact_range': (0.15, 0.25),
        'recommendation': 'POSITIVE',
        'recommendation_ar': 'إيجابي — إطلاق مؤكد',
        'modifiers': {
            'confirmed': 5,    # إيجابي لو مؤكد
            'rumored': -2,     # خطر لو شائع فقط
        },
        'volatility_window': 7,
    },
    'protocol_upgrade': {
        'name': 'Protocol Upgrade',
        'name_ar': 'ترقية البروتوكول',
        'typical_impact': 0.0,            # ±10%
        'impact_range': (-0.10, 0.10),
        'recommendation': 'CAUTION',
        'recommendation_ar': 'حذر — ترقية قادمة',
        'modifiers': {
            'within_7d': -3,
            'within_14d': -1,
            'beyond_14d': 0,
        },
        'volatility_window': 7,
    },
}

# حدود الأيام لتصنيف الأحداث
EVENT_DAY_THRESHOLDS = {
    'urgent': 7,      # حدث خلال 7 أيام — عاجل
    'near': 14,       # حدث خلال 14 يوم — قريب
    'upcoming': 30,   # حدث خلال 30 يوم — قادم
}

# حدود كشف الحيتان
WHALE_VOLUME_MULTIPLIER = 3.0   # حجم التداول 3× المتوسط = حوت محتمل
WHALE_PRICE_DROP = -8.0         # هبوط 8% أو أكثر = تأثير حوت


# ============================================================================
# KNOWN CRYPTO EVENTS DATABASE
# قاعدة بيانات الأحداث المعروفة — يتم تحديثها يدوياً
# ============================================================================

KNOWN_CRYPTO_EVENTS = {
    'BTC': [
        {
            'type': 'hard_fork',
            'name': 'Bitcoin Network Upgrade',
            'name_ar': 'ترقية شبكة بيتكوين',
            'frequency': 'biannual',
            'estimated_impact': 0.0,
            'details': 'Bitcoin network upgrades happen roughly every 6 months',
        },
        {
            'type': 'staking_reward',
            'name': 'BTC Staking (Babylon)',
            'name_ar': 'Staking بيتكوين عبر Babylon',
            'frequency': 'daily',
            'estimated_impact': 0.02,
            'details': 'BTC staking yields via Babylon protocol',
        },
    ],
    'ETH': [
        {
            'type': 'protocol_upgrade',
            'name': 'Ethereum Pectra Upgrade',
            'name_ar': 'ترقية إيثريوم بيكترا',
            'frequency': 'quarterly',
            'estimated_impact': 0.05,
            'details': 'Ethereum roadmap upgrades (Pectra, Fusaka, etc.)',
        },
        {
            'type': 'staking_reward',
            'name': 'ETH Staking Rewards',
            'name_ar': 'مكافآت Staking إيثريوم',
            'frequency': 'daily',
            'estimated_impact': 0.04,
            'details': '~3-4% APY for ETH validators',
        },
    ],
    'SOL': [
        {
            'type': 'token_unlock',
            'name': 'SOL Token Unlock',
            'name_ar': 'إلغاء قفل SOL',
            'frequency': 'monthly',
            'estimated_impact': -0.05,
            'details': 'Monthly SOL inflation/unlock schedule',
        },
        {
            'type': 'protocol_upgrade',
            'name': 'Solana Network Upgrade',
            'name_ar': 'ترقية شبكة سولانا',
            'frequency': 'quarterly',
            'estimated_impact': 0.05,
            'details': 'Solana regular network upgrades',
        },
    ],
    'BNB': [
        {
            'type': 'token_unlock',
            'name': 'BNB Auto-Burn',
            'name_ar': 'حرق تلقائي لـ BNB',
            'frequency': 'quarterly',
            'estimated_impact': 0.03,
            'details': 'Quarterly BNB burn reduces supply',
        },
    ],
    'XRP': [
        {
            'type': 'sec_regulatory',
            'name': 'SEC vs Ripple',
            'name_ar': 'دعوى SEC ضد ريبل',
            'frequency': 'ongoing',
            'estimated_impact': -0.10,
            'details': 'Ongoing SEC litigation — potential settlement or appeal',
        },
    ],
    'ADA': [
        {
            'type': 'staking_reward',
            'name': 'ADA Staking Rewards',
            'name_ar': 'مكافآت Staking ADA',
            'frequency': 'daily',
            'estimated_impact': 0.035,
            'details': '~3-5% APY for ADA staking',
        },
        {
            'type': 'protocol_upgrade',
            'name': 'Cardano Network Upgrade',
            'name_ar': 'ترقية شبكة كاردانو',
            'frequency': 'semiannual',
            'estimated_impact': 0.05,
            'details': 'Cardano hard fork events (Chang, Plomin, etc.)',
        },
    ],
    'DOGE': [
        {
            'type': 'whale_movement',
            'name': 'DOGE Whale Activity',
            'name_ar': 'نشاط حيتان DOGE',
            'frequency': 'sporadic',
            'estimated_impact': -0.05,
            'details': 'DOGE whales hold large % of supply — watch for moves',
        },
    ],
    'DOT': [
        {
            'type': 'staking_reward',
            'name': 'DOT Staking Rewards',
            'name_ar': 'مكافآت Staking DOT',
            'frequency': 'daily',
            'estimated_impact': 0.05,
            'details': '~10-15% nominal APY for DOT nominators',
        },
        {
            'type': 'protocol_upgrade',
            'name': 'Polkadot Runtime Upgrade',
            'name_ar': 'ترقية Polkadot',
            'frequency': 'quarterly',
            'estimated_impact': 0.03,
            'details': 'Regular runtime upgrades via governance',
        },
    ],
    'LINK': [
        {
            'type': 'staking_reward',
            'name': 'LINK Staking',
            'name_ar': 'Staking لينك',
            'frequency': 'daily',
            'estimated_impact': 0.04,
            'details': 'Chainlink staking v0.2 — ~4-5% APY',
        },
    ],
    'AVAX': [
        {
            'type': 'token_unlock',
            'name': 'AVAX Token Unlock',
            'name_ar': 'إلغاء قفل AVAX',
            'frequency': 'monthly',
            'estimated_impact': -0.08,
            'details': 'Monthly AVAX vesting unlocks',
        },
        {
            'type': 'staking_reward',
            'name': 'AVAX Staking Rewards',
            'name_ar': 'مكافآت Staking AVAX',
            'frequency': 'daily',
            'estimated_impact': 0.07,
            'details': '~7-10% APY for AVAX validators',
        },
    ],
    'UNI': [
        {
            'type': 'token_unlock',
            'name': 'UNI Token Unlock',
            'name_ar': 'إلغاء قفل UNI',
            'frequency': 'monthly',
            'estimated_impact': -0.10,
            'details': 'Uniswap team/advisor vesting unlocks',
        },
    ],
    'SUI': [
        {
            'type': 'token_unlock',
            'name': 'SUI Token Unlock',
            'name_ar': 'إلغاء قفل SUI',
            'frequency': 'monthly',
            'estimated_impact': -0.12,
            'details': 'Large monthly SUI unlocks from team/investor allocations',
        },
        {
            'type': 'protocol_upgrade',
            'name': 'Sui Network Upgrade',
            'name_ar': 'ترقية شبكة Sui',
            'frequency': 'quarterly',
            'estimated_impact': 0.03,
            'details': 'Sui regular protocol upgrades',
        },
    ],
    'NEAR': [
        {
            'type': 'token_unlock',
            'name': 'NEAR Token Unlock',
            'name_ar': 'إلغاء قفل NEAR',
            'frequency': 'monthly',
            'estimated_impact': -0.08,
            'details': 'NEAR monthly unlocks',
        },
        {
            'type': 'staking_reward',
            'name': 'NEAR Staking Rewards',
            'name_ar': 'مكافآت Staking NEAR',
            'frequency': 'daily',
            'estimated_impact': 0.06,
            'details': '~8-11% APY for NEAR staking',
        },
    ],
    'ONDO': [
        {
            'type': 'token_unlock',
            'name': 'ONDO Token Unlock',
            'name_ar': 'إلغاء قفل ONDO',
            'frequency': 'monthly',
            'estimated_impact': -0.15,
            'details': 'Major ONDO unlocks from team and investor allocations',
        },
    ],
    'WLD': [
        {
            'type': 'token_unlock',
            'name': 'WLD Token Unlock',
            'name_ar': 'إلغاء قفل WLD',
            'frequency': 'daily',
            'estimated_impact': -0.10,
            'details': 'Worldcoin daily unlocks — very inflationary',
        },
    ],
    'LTC': [
        {
            'type': 'hard_fork',
            'name': 'Litecoin Halving',
            'name_ar': 'تخفيض مكافأة Litecoin',
            'frequency': 'every_4_years',
            'estimated_impact': 0.15,
            'details': 'Litecoin halving reduces block reward by 50%',
        },
    ],
    'TRX': [
        {
            'type': 'staking_reward',
            'name': 'TRX Staking Rewards',
            'name_ar': 'مكافآت Staking TRX',
            'frequency': 'daily',
            'estimated_impact': 0.04,
            'details': '~3-5% APY for TRX staking',
        },
    ],
}

# عملات مستقرة — مفيش أحداث تؤثر
STABLECOINS = {'USDT', 'USDC', 'DAI', 'PAXG', 'USDE', 'USDY', 'USYC',
               'PYUSD', 'USD1', 'USDG', 'USDS', 'RLUSD', 'XAUT'}


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class CryptoEvent:
    """
    حدث كريبتو واحد.
    represents a single crypto event that may impact price.
    """
    event_type: str               # 'token_unlock', 'hard_fork', 'exchange_listing', etc.
    symbol: str                   # 'BTC', 'ETH', etc.
    event_name: str               # Human-readable name
    event_date: Optional[str]     # ISO date or None if estimated
    days_until: Optional[int]     # Days until event (None if unknown/recurring)
    expected_impact: float        # -1.0 to +1.0
    recommendation: str           # 'WAIT', 'CAUTION', 'AVOID', 'INFO', 'POSITIVE'
    confidence_modifier: float    # Adjustment to MR signal conviction
    source: str                   # Where we got this info
    details: Dict = None          # Additional event details

    def __post_init__(self):
        if self.details is None:
            self.details = {}

    def to_dict(self) -> Dict[str, Any]:
        """تحويل إلى dictionary."""
        return {
            'event_type': self.event_type,
            'symbol': self.symbol,
            'event_name': self.event_name,
            'event_date': self.event_date,
            'days_until': self.days_until,
            'expected_impact': round(self.expected_impact, 4),
            'recommendation': self.recommendation,
            'confidence_modifier': self.confidence_modifier,
            'source': self.source,
            'details': self.details or {},
        }


@dataclass
class CryptoEventProfile:
    """
    بروفايل أحداث لعملة واحدة.
    Profile of all events for a single cryptocurrency.
    """
    symbol: str
    events: List[CryptoEvent]
    active_events_count: int       # أحداث خلال 30 يوم
    max_negative_modifier: float   # أسوأ modifier من الأحداث النشطة
    overall_recommendation: str    # 'SAFE', 'CAUTION', 'WAIT'
    next_event: Optional[CryptoEvent]  # أقرب حدث قادم

    def to_dict(self) -> Dict[str, Any]:
        """تحويل إلى dictionary."""
        return {
            'symbol': self.symbol,
            'events': [e.to_dict() for e in self.events],
            'active_events_count': self.active_events_count,
            'max_negative_modifier': self.max_negative_modifier,
            'overall_recommendation': self.overall_recommendation,
            'next_event': self.next_event.to_dict() if self.next_event else None,
        }


@dataclass
class CryptoEventResult:
    """
    نتيجة فحص أحداث الكريبتو.
    Result of checking crypto events for a symbol.
    """
    symbol: str
    has_active_events: bool
    profile: CryptoEventProfile
    recommendation_modifier: float  # يُضاف إلى MR conviction
    should_wait: bool               # True لو أي حدث ينصح بالانتظار
    warnings: List[str]             # تحذيرات بالعربي

    def to_dict(self) -> Dict[str, Any]:
        """تحويل إلى dictionary."""
        return {
            'symbol': self.symbol,
            'has_active_events': self.has_active_events,
            'profile': self.profile.to_dict(),
            'recommendation_modifier': self.recommendation_modifier,
            'should_wait': self.should_wait,
            'warnings': self.warnings,
        }


# ============================================================================
# MAIN CLASS — CryptoEventTracker
# ============================================================================

class CryptoEventTracker:
    """
    متتبع تأثير أحداث العملات الرقمية.

    المكافئ الكريبتو لمتتبع أحداث توزيعات الأسهم (DividendEventTracker).
    يفحص أنواع مختلفة من الأحداث اللي بتأثر على سعر الكريبتو.

    Usage:
        tracker = CryptoEventTracker()
        result = tracker.check_events('BTC')
        if result.should_wait:
            conviction += result.recommendation_modifier
    """

    # Cache للنتائج (يتجدد كل ساعة)
    _profile_cache: Dict[str, tuple] = {}
    _cache_ttl: float = 3600.0  # ثانية واحدة = 1 ساعة

    def __init__(self, db_path: str = None):
        """
        Initialize the Crypto Event Tracker.

        Args:
            db_path: Path to data_engine.db. If None, uses default path
                     or works without database (fallback to known events).
        """
        if db_path is None:
            # محاولة العثور على قاعدة البيانات — أو العمل بدونها
            import os
            possible_paths = [
                str(_PROJECT_ROOT / 'db' / 'data_engine.db'),
            ]
            for p in possible_paths:
                if os.path.exists(p):
                    db_path = p
                    break

        self.db_path = db_path
        self._conn = None

        if self.db_path:
            logger.info(f"CryptoEventTracker initialized with DB: {self.db_path}")
        else:
            logger.info("CryptoEventTracker initialized without DB — using known events only")

    # ========================================================================
    # Database Connection
    # ========================================================================

    def _get_connection(self) -> Optional[sqlite3.Connection]:
        """الحصول على اتصال بقاعدة البيانات."""
        if not self.db_path:
            return None

        # تحقق من الاتصال الموجود
        if self._conn is not None:
            try:
                self._conn.execute('SELECT 1')
                return self._conn
            except sqlite3.Error:
                self._conn = None

        # اتصال جديد
        try:
            self._conn = sqlite3.connect(self.db_path, timeout=5.0)
            self._conn.row_factory = sqlite3.Row
            return self._conn
        except sqlite3.Error as e:
            logger.error(f"Error connecting to database: {e}")
            return None

    # ========================================================================
    # Main Entry Points
    # ========================================================================

    def check_events(self, symbol: str) -> CryptoEventResult:
        """
        نقطة الدخول الرئيسية — فحص أحداث الكريبتو لعملة معينة.

        Args:
            symbol: رمز العملة (مثلاً 'BTC', 'ETH')

        Returns:
            CryptoEventResult مع التوصيات والتحذيرات
        """
        symbol = symbol.upper().strip()

        # العملات المستقرة — مفيش أحداث
        if symbol in STABLECOINS:
            return self._stablecoin_result(symbol)

        # بناء البروفايل
        profile = self.get_event_profile(symbol)

        # حساب التوصية النهائية
        should_wait = False
        recommendation_modifier = 0.0
        warnings = []

        for event in profile.events:
            # لو الحدث نشط (خلال 30 يوم) أو مفيش تاريخ معروف (متكرر)
            is_active = (event.days_until is not None and event.days_until <= 30) or \
                        (event.days_until is None and event.event_type in (
                            'whale_movement', 'sec_regulatory', 'staking_reward'))

            if is_active:
                recommendation_modifier += event.confidence_modifier

                # هل الحدث ينصح بالانتظار؟
                if event.recommendation in ('WAIT', 'AVOID'):
                    should_wait = True

                # بناء تحذير بالعربي
                warning = self._build_warning(event)
                if warning:
                    warnings.append(warning)

        # حد أقصى للmodifier (-25 إلى +10)
        recommendation_modifier = max(-25.0, min(10.0, recommendation_modifier))

        return CryptoEventResult(
            symbol=symbol,
            has_active_events=profile.active_events_count > 0,
            profile=profile,
            recommendation_modifier=round(recommendation_modifier, 2),
            should_wait=should_wait,
            warnings=warnings,
        )

    def get_event_profile(self, symbol: str) -> CryptoEventProfile:
        """
        بناء بروفايل الأحداث لعملة معينة.

        Args:
            symbol: رمز العملة

        Returns:
            CryptoEventProfile
        """
        symbol = symbol.upper().strip()

        # تجربة الـ cache أولاً
        cache_key = f"profile_{symbol}"
        now = datetime.now().timestamp()
        if cache_key in self._profile_cache:
            cached_profile, cached_time = self._profile_cache[cache_key]
            if now - cached_time < self._cache_ttl:
                return cached_profile

        # جلب الأحداث من DB والأحداث المعروفة
        events = self._fetch_known_events(symbol)

        # كشف مخاطر الحيتان
        whale_event = self._estimate_whale_risk(symbol)
        if whale_event is not None:
            # أضف فقط لو مفيش حدث حوت موجود بالفعل
            existing_whale = any(e.event_type == 'whale_movement' for e in events)
            if not existing_whale:
                events.append(whale_event)

        # ترتيب حسب الأيام المتبقية (الأقرب أولاً)
        events.sort(key=lambda e: e.days_until if e.days_until is not None else 9999)

        # حساب الأحداث النشطة
        active_events = [e for e in events
                         if e.days_until is not None and e.days_until <= 30]
        active_count = len(active_events)

        # أسوأ modifier سلبي
        negative_modifiers = [e.confidence_modifier for e in active_events
                              if e.confidence_modifier < 0]
        max_negative = min(negative_modifiers) if negative_modifiers else 0.0

        # التوصية العامة
        if any(e.recommendation == 'WAIT' for e in active_events):
            overall_rec = 'WAIT'
        elif any(e.recommendation == 'AVOID' for e in active_events):
            overall_rec = 'WAIT'  # AVOID يعني استنى كمان
        elif any(e.recommendation == 'CAUTION' for e in active_events):
            overall_rec = 'CAUTION'
        else:
            overall_rec = 'SAFE'

        # أقرب حدث
        next_event = events[0] if events else None

        profile = CryptoEventProfile(
            symbol=symbol,
            events=events,
            active_events_count=active_count,
            max_negative_modifier=round(max_negative, 2),
            overall_recommendation=overall_rec,
            next_event=next_event,
        )

        # حفظ في cache
        self._profile_cache[cache_key] = (profile, now)

        return profile

    def get_all_active_events(self) -> List[CryptoEvent]:
        """
        جلب كل الأحداث النشطة لكل العملات.

        Returns:
            List[CryptoEvent] — كل الأحداث النشطة
        """
        all_events = []

        # فحص كل العملات المعروفة
        for symbol in KNOWN_CRYPTO_EVENTS:
            profile = self.get_event_profile(symbol)
            for event in profile.events:
                if event.days_until is not None and event.days_until <= 30:
                    all_events.append(event)
                elif event.days_until is None:
                    # أحداث متكررة بدون تاريخ — أضفها كمعلومات
                    all_events.append(event)

        # ترتيب حسب الأيام المتبقية
        all_events.sort(key=lambda e: e.days_until if e.days_until is not None else 9999)

        return all_events

    # ========================================================================
    # Event Fetching & Detection
    # ========================================================================

    def _fetch_known_events(self, symbol: str) -> List[CryptoEvent]:
        """
        جلب الأحداث المعروفة لعملة معينة.
        يبحث أولاً في قاعدة البيانات، ثم في KNOWN_CRYPTO_EVENTS.

        Args:
            symbol: رمز العملة

        Returns:
            List[CryptoEvent]
        """
        events = []

        # 1. محاولة جلب من قاعدة البيانات
        db_events = self._fetch_events_from_db(symbol)
        events.extend(db_events)

        # 2. إضافة الأحداث المعروفة (fallback)
        known = KNOWN_CRYPTO_EVENTS.get(symbol, [])
        for known_event in known:
            event_type = known_event['type']
            event_config = CRYPTO_EVENT_TYPES.get(event_type, {})

            # تحقق من عدم وجود حدث من نفس النوع من الـ DB
            existing_types = {e.event_type for e in db_events}
            if event_type in existing_types:
                continue  # الـ DB أولوية أعلى

            # بناء CryptoEvent من المعروف
            event_name = known_event.get('name', event_config.get('name', event_type))
            event_date = known_event.get('event_date')  # ممكن مفيش تاريخ محدد
            days_until = self._estimate_days_until(event_date, known_event.get('frequency'))

            # حساب التأثير المتوقع
            expected_impact = known_event.get('estimated_impact',
                                               event_config.get('typical_impact', 0.0))

            # التوصية
            recommendation = event_config.get('recommendation', 'INFO')

            # حساب modifier
            modifier = self._compute_modifier_for_type(event_type, days_until, known_event)

            events.append(CryptoEvent(
                event_type=event_type,
                symbol=symbol,
                event_name=event_name,
                event_date=event_date,
                days_until=days_until,
                expected_impact=expected_impact,
                recommendation=recommendation,
                confidence_modifier=modifier,
                source='known_events_db',
                details={
                    'name_ar': known_event.get('name_ar', ''),
                    'frequency': known_event.get('frequency', ''),
                    'info': known_event.get('details', ''),
                },
            ))

        return events

    def _fetch_events_from_db(self, symbol: str) -> List[CryptoEvent]:
        """
        جلب أحداث من قاعدة البيانات (لو فيه جدول crypto_events).

        Args:
            symbol: رمز العملة

        Returns:
            List[CryptoEvent] — من قاعدة البيانات
        """
        events = []
        conn = self._get_connection()
        if conn is None:
            return events

        try:
            cursor = conn.cursor()

            # تحقق من وجود جدول crypto_events
            cursor.execute("""
                SELECT name FROM sqlite_master
                WHERE type='table' AND name='crypto_events'
            """)
            if cursor.fetchone() is None:
                return events  # مفيش جدول — استخدم known events

            # جلب الأحداث من الجدول
            cursor.execute("""
                SELECT event_type, event_name, event_date, expected_impact,
                       recommendation, details, source
                FROM crypto_events
                WHERE symbol = ?
                ORDER BY event_date ASC
            """, (symbol,))

            for row in cursor.fetchall():
                event_type = row['event_type']
                event_config = CRYPTO_EVENT_TYPES.get(event_type, {})

                # حساب days_until
                event_date = row['event_date']
                days_until = None
                if event_date:
                    try:
                        event_dt = datetime.strptime(event_date[:10], '%Y-%m-%d').date()
                        days_until = (event_dt - date.today()).days
                    except (ValueError, TypeError):
                        pass

                # حساب modifier
                modifier = self._compute_modifier_for_type(
                    event_type, days_until, {'status': row.get('details', {}).get('status')})

                events.append(CryptoEvent(
                    event_type=event_type,
                    symbol=symbol,
                    event_name=row['event_name'],
                    event_date=event_date,
                    days_until=days_until,
                    expected_impact=row['expected_impact'],
                    recommendation=row['recommendation'] or event_config.get('recommendation', 'INFO'),
                    confidence_modifier=modifier,
                    source=row['source'] or 'database',
                    details=row['details'] if isinstance(row['details'], dict) else {},
                ))

        except sqlite3.Error as e:
            logger.warning(f"Error fetching events from DB for {symbol}: {e}")

        return events

    def _estimate_whale_risk(self, symbol: str) -> Optional[CryptoEvent]:
        """
        تقدير مخاطر حركة الحيتان بناءً على بيانات التداول.

        يستخدم crypto_prices table:
          - total_volume: لو 3× المتوسط = حوت محتمل
          - price_change_24h: لو هبوط > 8% = تأثير حوت

        Args:
            symbol: رمز العملة

        Returns:
            Optional[CryptoEvent] — لو اكتشف حركة حوت
        """
        conn = self._get_connection()
        if conn is None:
            return None

        try:
            cursor = conn.cursor()

            # جلب بيانات اليوم وآخر 7 أيام
            cursor.execute("""
                SELECT price_usd, price_change_24h, total_volume, market_cap,
                       timestamp
                FROM crypto_prices
                WHERE symbol = ?
                ORDER BY timestamp DESC
                LIMIT 8
            """, (symbol,))

            rows = cursor.fetchall()
            if len(rows) < 2:
                return None

            # بيانات اليوم
            latest = rows[0]
            latest_volume = latest['total_volume'] or 0
            latest_price_change = latest['price_change_24h'] or 0
            latest_market_cap = latest['market_cap'] or 0

            # متوسط حجم التداول (7 أيام سابقة)
            past_volumes = [r['total_volume'] or 0 for r in rows[1:]]
            if not past_volumes or sum(past_volumes) == 0:
                return None
            avg_volume = sum(past_volumes) / len(past_volumes)

            # كشف الحوت: حجم 3× المتوسط
            is_whale_volume = (latest_volume > avg_volume * WHALE_VOLUME_MULTIPLIER
                               and avg_volume > 0)

            # كشف الحوت: هبوط حاد
            is_whale_drop = latest_price_change <= WHALE_PRICE_DROP

            if not (is_whale_volume or is_whale_drop):
                return None

            # بناء حدث حوت
            event_config = CRYPTO_EVENT_TYPES['whale_movement']

            # تحديد شدة الحدث
            if is_whale_drop:
                modifier = event_config['modifiers']['large_movement']  # -5
                severity = 'large'
            else:
                modifier = event_config['modifiers']['moderate']  # -2
                severity = 'moderate'

            # حساب نسبة الحجم للمتوسط
            volume_ratio = latest_volume / avg_volume if avg_volume > 0 else 0

            details = {
                'latest_volume': latest_volume,
                'avg_volume_7d': round(avg_volume, 2),
                'volume_ratio': round(volume_ratio, 2),
                'price_change_24h': round(latest_price_change, 4),
                'market_cap': latest_market_cap,
                'severity': severity,
            }

            return CryptoEvent(
                event_type='whale_movement',
                symbol=symbol,
                event_name=f'Whale Movement Detected ({severity})',
                event_date=datetime.now().strftime('%Y-%m-%d'),
                days_until=0,  # الحدث حالي
                expected_impact=latest_price_change / 100.0,
                recommendation='CAUTION',
                confidence_modifier=modifier,
                source='volume_anomaly_detection',
                details=details,
            )

        except sqlite3.Error as e:
            logger.warning(f"Error estimating whale risk for {symbol}: {e}")
            return None

    # ========================================================================
    # Modifier Computation
    # ========================================================================

    def _compute_modifier(self, event: CryptoEvent) -> float:
        """
        حساب modifier الإدانة لحدث معين.

        Args:
            event: CryptoEvent

        Returns:
            float — modifier (-25 إلى +10)
        """
        return self._compute_modifier_for_type(
            event.event_type, event.days_until,
            event.details or {}
        )

    def _compute_modifier_for_type(
        self,
        event_type: str,
        days_until: Optional[int],
        details: Dict = None
    ) -> float:
        """
        حساب modifier بناءً على نوع الحدث والأيام المتبقية.

        Args:
            event_type: نوع الحدث
            days_until: الأيام المتبقية (None لو مش معروف)
            details: تفاصيل إضافية

        Returns:
            float — modifier
        """
        details = details or {}
        event_config = CRYPTO_EVENT_TYPES.get(event_type, {})
        modifiers = event_config.get('modifiers', {})

        if not modifiers:
            return 0.0

        # Handle event type specific logic
        if event_type == 'token_unlock':
            if days_until is not None:
                if days_until <= 7:
                    return modifiers.get('within_7d', -15)
                elif days_until <= 14:
                    return modifiers.get('within_14d', -10)
                elif days_until <= 30:
                    return modifiers.get('within_30d', -5)
            return modifiers.get('beyond_30d', 0)

        elif event_type == 'hard_fork':
            if days_until is not None:
                if days_until <= 14:
                    return modifiers.get('within_14d', -10)
                elif days_until <= 30:
                    return modifiers.get('within_30d', -5)
            return modifiers.get('beyond_30d', 0)

        elif event_type == 'exchange_listing':
            if days_until is not None:
                if days_until <= 7:
                    return modifiers.get('within_7d', -8)
                elif days_until <= 14:
                    return modifiers.get('within_14d', -5)
                elif days_until <= 30:
                    return modifiers.get('within_30d', -2)
            return modifiers.get('beyond_30d', 0)

        elif event_type == 'sec_regulatory':
            # الأحداث التنظيمية — ليها حالات مختلفة
            status = details.get('status', '')
            if status == 'pending' or (days_until is not None and days_until <= 30):
                return modifiers.get('pending', -15)
            elif status == 'recent' or (days_until is not None and 0 <= days_until <= 60):
                return modifiers.get('recent', -10)
            return modifiers.get('beyond_30d', -3)

        elif event_type == 'whale_movement':
            severity = details.get('severity', 'small')
            if severity == 'large':
                return modifiers.get('large_movement', -5)
            elif severity == 'moderate':
                return modifiers.get('moderate', -2)
            return modifiers.get('small', 0)

        elif event_type == 'staking_reward':
            # Staking إيجابي دائماً
            return modifiers.get('active', 2)

        elif event_type == 'mainnet_launch':
            status = details.get('status', 'rumored')
            if status == 'confirmed':
                return modifiers.get('confirmed', 5)
            return modifiers.get('rumored', -2)

        elif event_type == 'protocol_upgrade':
            if days_until is not None:
                if days_until <= 7:
                    return modifiers.get('within_7d', -3)
                elif days_until <= 14:
                    return modifiers.get('within_14d', -1)
            return modifiers.get('beyond_14d', 0)

        return 0.0

    # ========================================================================
    # Helper Methods
    # ========================================================================

    def _estimate_days_until(
        self,
        event_date: Optional[str],
        frequency: Optional[str]
    ) -> Optional[int]:
        """
        تقدير عدد الأيام المتبقية للحدث.

        لو فيه تاريخ محدد — نحسب الفرق.
        لو مفيش — نقدّر بناءً على التكرار.

        Args:
            event_date: ISO date string or None
            frequency: 'daily', 'monthly', 'quarterly', etc.

        Returns:
            Optional[int] — عدد الأيام أو None
        """
        if event_date:
            try:
                event_dt = datetime.strptime(event_date[:10], '%Y-%m-%d').date()
                return (event_dt - date.today()).days
            except (ValueError, TypeError):
                pass

        # تقدير بناءً على التكرار
        freq_days = {
            'daily': 0,
            'weekly': 7,
            'biweekly': 14,
            'monthly': 30,
            'quarterly': 90,
            'semiannual': 180,
            'biannual': 180,
            'annual': 365,
            'every_4_years': 1460,
            'sporadic': None,    # مش معروف
            'ongoing': None,     # مستمر
        }

        return freq_days.get(frequency, None)

    def _build_warning(self, event: CryptoEvent) -> str:
        """
        بناء تحذير بالعربي للحدث.

        Args:
            event: CryptoEvent

        Returns:
            str — تحذير بالعربي
        """
        event_config = CRYPTO_EVENT_TYPES.get(event.event_type, {})
        name_ar = event.details.get('name_ar', '') if event.details else ''
        if not name_ar:
            name_ar = event_config.get('name_ar', event.event_name)

        # بناء التحذير حسب نوع الحدث والتوصية
        if event.recommendation == 'WAIT':
            if event.event_type == 'token_unlock':
                days = event.days_until or '?'
                return f"⚠️ {name_ar} خلال {days} يوم — استنى بعد إلغاء القفل"
            elif event.event_type == 'sec_regulatory':
                return f"⚠️ {name_ar} — إجراء تنظيمي قادم، استنى"
            else:
                return f"⚠️ {name_ar} — يُنصح بالانتظار"

        elif event.recommendation == 'AVOID':
            return f"🚫 {name_ar} — لا تلاحق الفومو"

        elif event.recommendation == 'CAUTION':
            if event.event_type == 'whale_movement':
                vol_info = ''
                if event.details and 'volume_ratio' in event.details:
                    vol_info = f" (حجم التداول {event.details['volume_ratio']:.1f}× المتوسط)"
                return f"🐋 حركة حوت مكتشفة{vol_info} — حذر"
            elif event.event_type == 'hard_fork':
                return f"⚡ {name_ar} — تقلب عالي متوقع"
            else:
                return f"⚡ {name_ar} — حذر مطلوب"

        elif event.recommendation == 'POSITIVE':
            return f"✅ {name_ar} — إيجابي"

        elif event.recommendation == 'INFO':
            return f"ℹ️ {name_ar}"

        return f"📌 {name_ar}"

    def _stablecoin_result(self, symbol: str) -> CryptoEventResult:
        """نتيجة للعملات المستقرة — مفيش أحداث تؤثر."""
        empty_profile = CryptoEventProfile(
            symbol=symbol,
            events=[],
            active_events_count=0,
            max_negative_modifier=0.0,
            overall_recommendation='SAFE',
            next_event=None,
        )
        return CryptoEventResult(
            symbol=symbol,
            has_active_events=False,
            profile=empty_profile,
            recommendation_modifier=0.0,
            should_wait=False,
            warnings=[f"ℹ️ {symbol} عملة مستقرة — مفيش أحداث تؤثر على السعر"],
        )

    def get_event_summary(self) -> Dict[str, Any]:
        """
        ملخص كل الأحداث النشطة عبر كل العملات.

        Returns:
            Dict with summary information
        """
        all_events = self.get_all_active_events()

        # تقسيم حسب النوع
        by_type: Dict[str, List[CryptoEvent]] = {}
        for event in all_events:
            by_type.setdefault(event.event_type, []).append(event)

        # أكثر العملات عرضة للأحداث
        by_symbol: Dict[str, int] = {}
        for event in all_events:
            by_symbol[event.symbol] = by_symbol.get(event.symbol, 0) + 1

        # العملات اللي لازم نستنى
        wait_symbols = []
        for symbol in KNOWN_CRYPTO_EVENTS:
            result = self.check_events(symbol)
            if result.should_wait:
                wait_symbols.append({
                    'symbol': symbol,
                    'modifier': result.recommendation_modifier,
                    'warnings': result.warnings,
                })

        return {
            'total_active_events': len(all_events),
            'events_by_type': {k: len(v) for k, v in by_type.items()},
            'symbols_with_most_events': sorted(
                by_symbol.items(), key=lambda x: x[1], reverse=True
            )[:10],
            'symbols_to_wait': wait_symbols,
            'scan_time': datetime.now().isoformat(),
        }


# ============================================================================
# SELF-TEST
# ============================================================================

def run_self_test():
    """
    اختبار ذاتي — يتأكد إن كل الوظائف الأساسية تشتغل.
    """
    print("=" * 70)
    print("CRYPTO EVENT IMPACT TRACKER — Self-Test")
    print("متتبع تأثير أحداث الكريبتو — اختبار ذاتي")
    print("=" * 70)

    tracker = CryptoEventTracker()

    # ─── Test 1: Event Type Configuration ───
    print("\n--- Test 1: Event Type Configuration ---")
    print(f"  Total event types configured: {len(CRYPTO_EVENT_TYPES)}")
    for etype, config in CRYPTO_EVENT_TYPES.items():
        print(f"  ✓ {etype}: impact={config['typical_impact']:+.0%}, "
              f"rec={config['recommendation']}")
    assert len(CRYPTO_EVENT_TYPES) == 8, "Expected 8 event types"
    print("  ✅ All event types configured correctly")

    # ─── Test 2: Known Events Database ───
    print("\n--- Test 2: Known Events Database ---")
    print(f"  Total symbols with known events: {len(KNOWN_CRYPTO_EVENTS)}")
    for symbol, events in KNOWN_CRYPTO_EVENTS.items():
        print(f"  ✓ {symbol}: {len(events)} events")
    assert len(KNOWN_CRYPTO_EVENTS) > 10, "Expected >10 symbols in known events"
    print("  ✅ Known events database populated")

    # ─── Test 3: Stablecoin Handling ───
    print("\n--- Test 3: Stablecoin Handling ---")
    for stable in ['USDT', 'USDC', 'DAI']:
        result = tracker.check_events(stable)
        assert not result.has_active_events, f"{stable} should have no active events"
        assert result.recommendation_modifier == 0.0, f"{stable} modifier should be 0"
        assert not result.should_wait, f"{stable} should not require waiting"
        print(f"  ✓ {stable}: no events, modifier=0.0, safe")
    print("  ✅ Stablecoin handling correct")

    # ─── Test 4: BTC Profile ───
    print("\n--- Test 4: BTC Event Profile ---")
    btc_result = tracker.check_events('BTC')
    print(f"  BTC active events: {btc_result.profile.active_events_count}")
    print(f"  BTC overall recommendation: {btc_result.profile.overall_recommendation}")
    print(f"  BTC recommendation modifier: {btc_result.recommendation_modifier}")
    print(f"  BTC should wait: {btc_result.should_wait}")
    for event in btc_result.profile.events:
        print(f"    - {event.event_type}: {event.event_name} "
              f"(modifier={event.confidence_modifier}, rec={event.recommendation})")
    print("  ✅ BTC profile generated")

    # ─── Test 5: ETH Profile ───
    print("\n--- Test 5: ETH Event Profile ---")
    eth_result = tracker.check_events('ETH')
    print(f"  ETH active events: {eth_result.profile.active_events_count}")
    print(f"  ETH overall recommendation: {eth_result.profile.overall_recommendation}")
    print(f"  ETH recommendation modifier: {eth_result.recommendation_modifier}")
    for event in eth_result.profile.events:
        print(f"    - {event.event_type}: {event.event_name} "
              f"(modifier={event.confidence_modifier})")
    print("  ✅ ETH profile generated")

    # ─── Test 6: High-Risk Coin (Token Unlock) ───
    print("\n--- Test 6: High-Risk Coins (Token Unlocks) ---")
    for symbol in ['SUI', 'ONDO', 'WLD']:
        result = tracker.check_events(symbol)
        print(f"  {symbol}: modifier={result.recommendation_modifier}, "
              f"should_wait={result.should_wait}, "
              f"warnings={len(result.warnings)}")
        for w in result.warnings:
            print(f"    ⚠ {w}")
    print("  ✅ High-risk coins assessed")

    # ─── Test 7: Whale Detection ───
    print("\n--- Test 7: Whale Detection (DB-based) ---")
    whale_event = tracker._estimate_whale_risk('BTC')
    if whale_event:
        print(f"  ✓ Whale detected: {whale_event.event_name}")
        print(f"    modifier={whale_event.confidence_modifier}")
        print(f"    details={whale_event.details}")
    else:
        print("  ℹ️ No whale movement currently detected (normal)")
    print("  ✅ Whale detection functional")

    # ─── Test 8: All Active Events ───
    print("\n--- Test 8: All Active Events ---")
    all_events = tracker.get_all_active_events()
    print(f"  Total events across all coins: {len(all_events)}")
    for event in all_events[:10]:
        print(f"    {event.symbol}: {event.event_type} — {event.event_name}")
    print("  ✅ All active events retrieved")

    # ─── Test 9: Event Summary ───
    print("\n--- Test 9: Event Summary ---")
    summary = tracker.get_event_summary()
    print(f"  Total active events: {summary['total_active_events']}")
    print(f"  Events by type: {summary['events_by_type']}")
    print(f"  Symbols to wait: {len(summary['symbols_to_wait'])}")
    for sw in summary['symbols_to_wait'][:5]:
        print(f"    ⏳ {sw['symbol']}: modifier={sw['modifier']}")
    print("  ✅ Event summary generated")

    # ─── Test 10: Modifier Computation ───
    print("\n--- Test 10: Modifier Computation ---")
    # Token unlock modifier tests
    assert tracker._compute_modifier_for_type('token_unlock', 3, {}) == -15, \
        "Token unlock ≤7d should be -15"
    assert tracker._compute_modifier_for_type('token_unlock', 10, {}) == -10, \
        "Token unlock ≤14d should be -10"
    assert tracker._compute_modifier_for_type('token_unlock', 25, {}) == -5, \
        "Token unlock ≤30d should be -5"
    assert tracker._compute_modifier_for_type('token_unlock', 60, {}) == 0, \
        "Token unlock >30d should be 0"

    # Hard fork modifier tests
    assert tracker._compute_modifier_for_type('hard_fork', 7, {}) == -10, \
        "Hard fork ≤14d should be -10"
    assert tracker._compute_modifier_for_type('hard_fork', 20, {}) == -5, \
        "Hard fork ≤30d should be -5"

    # Staking modifier
    assert tracker._compute_modifier_for_type('staking_reward', 0, {}) == 2, \
        "Staking should be +2"

    # SEC regulatory
    assert tracker._compute_modifier_for_type('sec_regulatory', 5, {}) == -15, \
        "SEC pending should be -15"
    assert tracker._compute_modifier_for_type('sec_regulatory', 100, {}) == -3, \
        "SEC beyond 30d should be -3"

    print("  ✓ Token unlock modifiers correct")
    print("  ✓ Hard fork modifiers correct")
    print("  ✓ Staking modifiers correct")
    print("  ✓ SEC regulatory modifiers correct")
    print("  ✅ All modifier computations correct")

    # ─── Test 11: Serialization ───
    print("\n--- Test 11: Serialization (to_dict) ---")
    btc_dict = btc_result.to_dict()
    assert 'symbol' in btc_dict, "to_dict should have 'symbol'"
    assert 'profile' in btc_dict, "to_dict should have 'profile'"
    assert 'warnings' in btc_dict, "to_dict should have 'warnings'"
    assert isinstance(btc_dict['profile']['events'], list), "Events should be a list"
    print(f"  ✓ BTC result serialized: {len(btc_dict['profile']['events'])} events")
    print("  ✅ Serialization working")

    # ─── Test 12: XRP (SEC Regulatory) ───
    print("\n--- Test 12: XRP (SEC Regulatory) ---")
    xrp_result = tracker.check_events('XRP')
    print(f"  XRP active events: {xrp_result.profile.active_events_count}")
    print(f"  XRP modifier: {xrp_result.recommendation_modifier}")
    print(f"  XRP should wait: {xrp_result.should_wait}")
    for w in xrp_result.warnings:
        print(f"    ⚠ {w}")
    print("  ✅ XRP regulatory risk assessed")

    # ─── Final Results ───
    print("\n" + "=" * 70)
    print("✅ ALL SELF-TESTS PASSED — CryptoEventTracker is ready!")
    print("✅ كل الاختبارات ناجحة — المتتبع جاهز للاستخدام!")
    print("=" * 70)


if __name__ == "__main__":
    run_self_test()
