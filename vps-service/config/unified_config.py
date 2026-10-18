"""
Unified Configuration Engine
============================
محرك الإعدادات الموحدة

يحتوي على:
1. MarketProfile  - إعدادات كل سوق (أوزان + استراتيجية + عتبات)
2. PersonaProfile - شخصية المتداول (مضارب/متداول/مستثمر/محافظ)
3. UnifiedConfig  - دمج السوق مع الشخصية لإنتاج إعدادات نهائية

الفلسفة:
- كل سوق له طبيعة مختلفة → أوزان مختلفة
- كل شخصية لها أهداف مختلفة → عتبات مختلفة
- النظام الواحد يتكيف مع الاثنين معاً

نتائج Backtest (أبريل-مايو 2025):
- EGX  T+1:    69.9% WR, +13.65% PnL ✅
- TADAWUL T+1: 38.8% WR, +0.4%  PnL ❌ → يحتاج Swing
- KSE Swing:   52.4% WR, +3.6%  PnL ⚠️ → يحتاج ضبط

@authorM2yDevelopers Team
@version 2.0.0 - Unified Multi-Market Multi-Persona
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from enum import Enum


# ============================================================================
# ENUMS
# ============================================================================

class TradingStrategy(Enum):
    """استراتيجيات التداول"""
    T1         = "T+1"          # مضاربة يومية
    SWING      = "swing"        # تداول أسبوعي (3-10 أيام)
    POSITION   = "position"     # مركز متوسط (أسابيع-شهور)
    BREAKOUT   = "breakout"     # اختراق للكريبتو
    SCALP      = "scalp"        # مضاربة لحظية (ساعات)


class PersonaType(Enum):
    """أنواع شخصيات المتداول"""
    SCALPER     = "scalper"      # مضارب سريع جداً
    TRADER      = "trader"       # متداول swing
    INVESTOR    = "investor"     # مستثمر متوسط المدى
    CONSERVATIVE = "conservative" # محافظ جداً
    CUSTOM      = "custom"       # مخصص بالكامل


class StopLossMethod(Enum):
    """طرق حساب وقف الخسارة"""
    ATR      = "atr"      # بناءً على التذبذب الفعلي
    SUPPORT  = "support"  # تحت أقرب مستوى دعم
    FIXED    = "fixed"    # نسبة ثابتة
    COMBINED = "combined" # دمج ATR + دعم


# ============================================================================
# MARKET PROFILE
# ============================================================================

@dataclass
class AnalyzerWeights:
    """أوزان المحللات (مجموعها = 100)"""
    technical:    int = 40    # RSI + MACD + MA + Bollinger
    volume:       int = 20    # حجم التداول + السيولة
    candlestick:  int = 15    # نماذج الشموع
    fundamental:  int = 10    # الأساسيات (P/E, EPS, etc.)
    sentiment:    int = 10    # الأخبار + مشاعر السوق
    sector:       int = 5     # أداء القطاع

    def validate(self) -> bool:
        total = (self.technical + self.volume + self.candlestick +
                 self.fundamental + self.sentiment + self.sector)
        return total == 100

    def to_dict(self) -> dict:
        return {
            "technical":   self.technical,
            "volume":      self.volume,
            "candlestick": self.candlestick,
            "fundamental": self.fundamental,
            "sentiment":   self.sentiment,
            "sector":      self.sector,
        }


@dataclass
class MarketProfile:
    """
    ملف تعريف السوق الكامل
    كل سوق له خصائصه وإعداداته المثلى المبنية على البيانات الفعلية
    """
    # التعريف
    market_code: str            # EGX / KSA / KSE / QSE / DFM / CRYPTO / FOREX
    market_name: str            # الاسم الإنجليزي
    market_name_ar: str         # الاسم العربي
    currency: str               # EGP / SAR / KWD / USD

    # أوزان المحللات (مخصصة لكل سوق)
    weights: AnalyzerWeights = field(default_factory=AnalyzerWeights)

    # الاستراتيجية الافتراضية
    default_strategy: TradingStrategy = TradingStrategy.SWING

    # عتبات القبول
    min_score_buy:     float = 65.0  # الحد الأدنى للشراء (0-100)
    min_score_strong:  float = 80.0  # الحد الأدنى للشراء القوي
    min_score_sell:    float = 35.0  # الحد الأقصى للبيع

    # فلاتر الجودة
    min_volume_filter: int   = 1_000_000  # أقل حجم تداول مقبول
    min_value_traded:  int   = 1_000_000  # أقل قيمة تداول مقبولة (بالعملة المحلية)
    min_rr:            float = 1.8        # R/R الأدنى المقبول (RULE-18-RESTORE: was 1.5)

    # وقف الخسارة
    stop_method:       StopLossMethod = StopLossMethod.COMBINED
    stop_atr_mult:     float = 2.0        # مضاعف ATR لوقف الخسارة
    stop_fixed_pct:    float = 7.0        # نسبة ثابتة (بديل)
    stop_max_pct:      float = 5.0        # الحد الأقصى لوقف الخسارة (كان 15% — واسع جداً للـ EGX، المحسّن يستخدم 3% أصلاً)
    stop_min_pct:      float = 3.0        # الحد الأدنى لوقف الخسارة

    # الأهداف
    target_rr_mult:    float = 1.5        # مضاعف على المخاطرة للهدف
    target_max_pct:    float = 30.0       # الحد الأقصى للهدف
    target_min_pct:    float = 3.0        # الحد الأدنى للهدف

    # إعدادات التداول
    max_concurrent_trades: int = 3        # أقصى صفقات متزامنة
    position_size_pct: float = 10.0       # حجم الصفقة من رأس المال

    # RSI Thresholds (مخصصة لكل سوق)
    rsi_overbought:    float = 70.0
    rsi_oversold:      float = 30.0
    rsi_extreme_high:  float = 85.0       # Kimi Fix: RSI فوق كدة = بيع إجباري
    rsi_extreme_low:   float = 20.0       # Kimi Fix: RSI تحت كدة = شراء قوي

    # ملاحظات خاصة بالسوق
    notes: str = ""

    # ─── V40.4: Market Physics Matrix fields (Directive §3) ──────────────────
    # حقن ديناميكي لمعايير كل سوق في المحرك الموحد (Unified Decision Core)
    benchmark_ticker: str = ""                        # EGX30ETF / TASI / BKP / QE_INDEX / BTC.D
    min_turnover_local: float = 500_000.0             # الحد الأدنى للسيولة بالعملة المحلية
    # Task REAPPLY-CRITICAL-FIXES — canonical (Rule 8 + Rule 18 + engine_settings.py:240,289).
    # Was 3.0/1.5 (stale drift). Rule 8 ATR clamp = [5%, 9%], Rule 18 R:R floor = 1.8.
    atr_stop_min_pct: float = 5.0                     # الحد الأدنى لوقف الخسارة (نطاق ATR) — Rule 8 floor
    atr_stop_max_pct: float = 9.0                     # الحد الأقصى لوقف الخسارة (نطاق ATR) — Rule 8 cap
    dynamic_rr_normal: float = 1.8                    # أرضية R:R في السوق العادي (Rule 18 floor ≥ 1.8)
    dynamic_rr_outperform: float = 2.0                # أرضية R:R عند التفوق على المؤشر المرجعي
    data_provider_type: str = "financial_statements"  # 'financial_statements' أو 'on_chain_tokenomics'
    price_db_table: str = "price_history"             # 'price_history' أو 'crypto_prices'
    is_continuous_24_7: bool = False                  # False للأسهم، True للكريبتو


# ============================================================================
# PERSONA PROFILE
# ============================================================================

@dataclass
class PersonaProfile:
    """
    شخصية المتداول
    تُعدّل على إعدادات السوق لتنتج توقعات مخصصة
    """
    persona: PersonaType
    name_ar: str

    # تعديلات على درجة القبول
    score_threshold_boost: float = 0.0    # + على min_score_buy من السوق
    # مثال: +10 يعني المحافظ يحتاج 65+10=75% للشراء

    # إعدادات الصفقة
    max_concurrent_trades: int   = 3      # أقصى صفقات متزامنة
    position_size_pct:     float = 10.0   # حجم الصفقة %
    risk_per_trade_pct:    float = 2.0    # أقصى خسارة % من رأس المال

    # أيام الاحتفاظ
    min_holding_days: int  = 1
    max_holding_days: int  = 7

    # تعديل R/R
    min_rr_override: Optional[float] = None  # None = استخدم قيمة السوق

    # فلاتر إضافية
    require_volume_confirm:  bool = True   # يشترط تأكيد الحجم
    require_pattern_confirm: bool = False  # يشترط نمط شمعة واضح
    require_sector_trend:    bool = False  # يشترط أن القطاع في اتجاه صاعد

    # الاستراتيجيات المسموحة
    allowed_strategies: List[str] = field(
        default_factory=lambda: ["T+1", "swing", "position", "breakout"]
    )

    # إشارات مسموح بها (None = كل الإشارات)
    allowed_signals: Optional[List[str]] = None

    # وقف الخسارة
    stop_tighter_factor: float = 1.0     # 0.8 = وقف أضيق بـ 20%

    # الهدف
    target_higher_factor: float = 1.0   # 1.2 = هدف أعلى بـ 20%

    def get_min_rr(self, market_min_rr: float) -> float:
        """الحصول على R/R الأدنى (الشخصية أو السوق أيهما أعلى)"""
        if self.min_rr_override is not None:
            return max(self.min_rr_override, market_min_rr)
        return market_min_rr

    def get_min_score(self, market_min_score: float) -> float:
        """الحصول على الحد الأدنى للدرجة بعد تعديل الشخصية"""
        return min(95.0, market_min_score + self.score_threshold_boost)


# ============================================================================
# UNIFIED RESULT
# ============================================================================

@dataclass
class UnifiedSignalResult:
    """نتيجة التحليل الموحدة"""
    # التعريف
    ticker:       str
    market:       str
    persona:      str
    strategy:     str
    timestamp:    str

    # الإشارة
    signal:       str           # STRONG_BUY / BUY / HOLD / SELL / STRONG_SELL
    signal_ar:    str           # الإشارة بالعربية
    score:        float         # 0-100
    confidence:   float         # 0-100 (ثقة النظام)

    # الأسعار
    current_price: float
    entry_price:   float
    stop_loss:     float
    target_1:      float        # الهدف الأول
    target_2:      Optional[float] = None  # الهدف الثاني
    risk_reward:   float = 0.0

    # تفاصيل الدرجات
    technical_score:   float = 0.0
    volume_score:      float = 0.0
    candle_score:      float = 0.0
    fundamental_score: float = 0.0
    sentiment_score:   float = 0.0
    sector_score:      float = 0.0

    # إصلاحات Kimi
    rsi_override:     bool = False
    rr_valid:         bool = True
    rejection_reason: Optional[str] = None

    # ─── Momentum Accumulation (تجميع ذكي / Pre-Explosion) ──────────────────
    # يكشف الأسهم اللي بتصعد متواصل بدون pullback حقيقي (زي ELKA)
    # ويمنع الـ RSI Override إنه يبيعها بدري قبل الانفجار
    momentum_accumulation: bool = False
    momentum_strength:     float = 0.0    # 0-100
    momentum_reason:       Optional[str] = None
    no_pullback:           bool = False  # مفيش تراجع > 5% في آخر 15 يوم
    trailing_stop:         Optional[float] = None  # وقف متحرك مقترح للـ momentum

    # السياق
    market_regime:    str = "unknown"     # bull / bear / range
    rsi:              float = 50.0
    macd_signal:      str = "neutral"

    # تحذيرات
    warnings: List[str] = field(default_factory=list)

    @property
    def is_valid(self) -> bool:
        return self.rr_valid and self.signal not in ("REJECTED", "REJECTED_RR")

    @property
    def stop_loss_pct(self) -> float:
        if self.entry_price > 0:
            return round(abs(self.entry_price - self.stop_loss) / self.entry_price * 100, 2)
        return 0.0

    @property
    def target_pct(self) -> float:
        if self.entry_price > 0:
            return round(abs(self.target_1 - self.entry_price) / self.entry_price * 100, 2)
        return 0.0

    def to_dict(self) -> dict:
        return {
            "ticker":        self.ticker,
            "market":        self.market,
            "persona":       self.persona,
            "strategy":      self.strategy,
            "timestamp":     self.timestamp,
            "signal":        self.signal,
            "signal_ar":     self.signal_ar,
            "score":         round(self.score, 1),
            "confidence":    round(self.confidence, 1),
            "current_price": self.current_price,
            "entry_price":   self.entry_price,
            "stop_loss":     self.stop_loss,
            "stop_loss_pct": self.stop_loss_pct,
            "target_1":      self.target_1,
            "target_2":      self.target_2,
            "target_pct":    self.target_pct,
            "risk_reward":   round(self.risk_reward, 2),
            "technical_score":   round(self.technical_score, 1),
            "volume_score":      round(self.volume_score, 1),
            "candle_score":      round(self.candle_score, 1),
            "fundamental_score": round(self.fundamental_score, 1),
            "sentiment_score":   round(self.sentiment_score, 1),
            "rsi_override":  self.rsi_override,
            "rr_valid":      self.rr_valid,
            "rejection_reason": self.rejection_reason,
            "momentum_accumulation": self.momentum_accumulation,
            "momentum_strength":    round(self.momentum_strength, 1),
            "momentum_reason":      self.momentum_reason,
            "no_pullback":          self.no_pullback,
            "trailing_stop":        self.trailing_stop,
            "market_regime": self.market_regime,
            "rsi":           round(self.rsi, 1),
            "warnings":      self.warnings,
            "is_valid":      self.is_valid,
        }


# ============================================================================
# PREDEFINED PROFILES - ملفات جاهزة
# ============================================================================

# ─── أسواق الأسهم ───────────────────────────────────────────────────────────

MARKET_PROFILES: Dict[str, MarketProfile] = {

    # =====================================================================
    # EGX - البورصة المصرية
    # النتيجة: T+1 ينجح بقوة (Win Rate 70%, P&L +13.65%)
    # =====================================================================
    "EGX": MarketProfile(
        market_code="EGX",
        market_name="Egyptian Exchange",
        market_name_ar="البورصة المصرية",
        currency="EGP",
        weights=AnalyzerWeights(
            technical=40,     # RSI+MACD+MA الأهم في EGX
            volume=25,        # السيولة مهمة جداً
            candlestick=20,   # نماذج الشموع فعالة
            fundamental=5,    # الأساسيات أقل أهمية يومياً
            sentiment=7,      # الأخبار المصرية
            sector=3,
        ),
        default_strategy=TradingStrategy.T1,  # ✅ مثبت بـ Backtest
        min_score_buy=65.0,
        min_score_strong=80.0,
        min_volume_filter=1_000_000,
        min_value_traded=1_000_000,
        min_rr=1.8,           # RL-FIX-16: 1.2→1.8 (51% كانوا R/R<1.5 فشلوا)
        stop_method=StopLossMethod.COMBINED,
        stop_atr_mult=2.5,    # RL-FIX-16: 1.5→2.5 (47% ضربوا الوقف — كان ضيق جداً)
        stop_fixed_pct=2.0,   # RL-FIX-16: 1.0→2.0 (وقف 1% يتضربه أي تذبذب عشوائي)
        stop_max_pct=7.0,
        stop_min_pct=1.5,     # RL-FIX-16: 0.5→1.5 (وقف أقل من 1.5% غير واقعي للـ EGX)
        target_rr_mult=2.0,   # RL-FIX-16: 1.5→2.0 (target = 2× stop → R/R=2.0)
        target_min_pct=2.5,   # RL-FIX-16: 1.5→2.5 (هدف أقل من 2.5% لا يغطي التكاليف)
        target_max_pct=7.0,   # RL-FIX-16: 5.0→7.0 (سماح بأهداف أعلى قليلاً)
        max_concurrent_trades=3,
        position_size_pct=10.0,
        rsi_overbought=70.0,
        rsi_oversold=30.0,
        rsi_extreme_high=80.0,  # أكثر حساسية في EGX
        rsi_extreme_low=25.0,
        notes="EGX: T+1 مثبت. وقت التداول 4.5 ساعة. السيولة مهمة.",
        # V40.4 Market Physics Matrix
        benchmark_ticker="EGX30ETF",
        min_turnover_local=500_000.0,        # 500k EGP
        # Task REAPPLY-CRITICAL-FIXES — canonical (Rule 8 + Rule 18 + engine_settings.py:240,289).
        # Was 3.0/1.5 (stale drift). Rule 8 ATR clamp = [5%, 9%], Rule 18 R:R floor = 1.8.
        atr_stop_min_pct=5.0,               # [5.0%, 9.0%] — Rule 8
        atr_stop_max_pct=9.0,
        dynamic_rr_normal=1.8,              # Normal 1.8 (Rule 18), Bull 2.0
        dynamic_rr_outperform=2.0,
        data_provider_type="financial_statements",
        price_db_table="price_history",
        is_continuous_24_7=False,
    ),

    # =====================================================================
    # KSA (TADAWUL) - السوق السعودي
    # النتيجة: T+1 فاشل (38.8%) → Swing أنسب
    # =====================================================================
    "KSA": MarketProfile(
        market_code="KSA",
        market_name="Saudi Exchange (Tadawul)",
        market_name_ar="تداول السعودية",
        currency="SAR",
        weights=AnalyzerWeights(
            technical=35,     # تقني مهم لكن أقل من EGX
            volume=30,        # الحجم أهم (سوق أكبر وأكثر سيولة)
            candlestick=15,
            fundamental=12,   # الأساسيات أهم في الـ swing
            sentiment=5,
            sector=3,
        ),
        default_strategy=TradingStrategy.SWING,  # ❌ T+1 فشل → Swing
        min_score_buy=68.0,    # أعلى قليلاً
        min_score_strong=82.0,
        min_volume_filter=5_000_000,  # حجم أعلى لسوق أكبر
        min_value_traded=10_000_000,
        min_rr=1.8,           # RULE-18-RESTORE: was 1.5 (TADAWUL)
        stop_atr_mult=2.0,
        stop_fixed_pct=2.5,
        stop_max_pct=8.0,
        stop_min_pct=1.5,
        target_rr_mult=2.0,   # نسبة أعلى للـ swing
        target_min_pct=4.0,
        target_max_pct=15.0,
        max_concurrent_trades=3,
        position_size_pct=10.0,
        rsi_overbought=70.0,
        rsi_oversold=30.0,
        rsi_extreme_high=85.0,
        rsi_extreme_low=20.0,
        notes="TADAWUL: T+1 فشل في Backtest. استخدام Swing (3-7 أيام).",
        # V40.4 Market Physics Matrix
        benchmark_ticker="TASI",
        min_turnover_local=2_000_000.0,      # 2M SAR
        atr_stop_min_pct=3.0,               # [3.0%, 6.0%]
        atr_stop_max_pct=6.0,
        dynamic_rr_normal=1.8,              # RULE-18-RESTORE: was 1.5 (TADAWUL)
        dynamic_rr_outperform=2.0,
        data_provider_type="financial_statements",
        price_db_table="price_history",
        is_continuous_24_7=False,
    ),

    # =====================================================================
    # KSE - بورصة الكويت
    # النتيجة: Swing 52.4% WR - يحتاج ضبط
    # =====================================================================
    "KSE": MarketProfile(
        market_code="KSE",
        market_name="Kuwait Stock Exchange",
        market_name_ar="بورصة الكويت",
        currency="KWD",
        weights=AnalyzerWeights(
            technical=38,
            volume=28,        # السيولة مهمة (سوق أصغر)
            candlestick=18,
            fundamental=8,
            sentiment=5,
            sector=3,
        ),
        default_strategy=TradingStrategy.SWING,
        min_score_buy=65.0,
        min_score_strong=80.0,
        min_volume_filter=500_000,
        min_value_traded=500_000,
        min_rr=1.8,           # RULE-18-RESTORE: was 1.5 (KSE)
        stop_method=StopLossMethod.ATR,
        stop_atr_mult=2.0,
        stop_fixed_pct=2.0,
        stop_max_pct=8.0,
        stop_min_pct=1.5,
        target_rr_mult=2.0,
        target_min_pct=3.0,
        target_max_pct=12.0,
        max_concurrent_trades=3,
        position_size_pct=8.0,  # أصغر بسبب السيولة
        notes="KSE: Swing. سيولة منخفضة → حجم مركز أصغر.",
        # V40.4 Market Physics Matrix
        benchmark_ticker="BKP",
        min_turnover_local=50_000.0,         # 50k KWD
        atr_stop_min_pct=2.0,               # [2.0%, 4.5%]
        atr_stop_max_pct=4.5,
        dynamic_rr_normal=1.8,              # RULE-18-RESTORE: was 1.5
        dynamic_rr_outperform=1.8,
        data_provider_type="financial_statements",
        price_db_table="price_history",
        is_continuous_24_7=False,
    ),

    # =====================================================================
    # QSE - بورصة قطر
    # =====================================================================
    "QSE": MarketProfile(
        market_code="QSE",
        market_name="Qatar Stock Exchange",
        market_name_ar="بورصة قطر",
        currency="QAR",
        weights=AnalyzerWeights(
            technical=38,
            volume=27,
            candlestick=18,
            fundamental=10,
            sentiment=5,
            sector=2,
        ),
        default_strategy=TradingStrategy.SWING,
        min_score_buy=68.0,
        min_score_strong=83.0,
        min_volume_filter=500_000,
        min_value_traded=500_000,
        min_rr=1.8,           # RULE-18-RESTORE: was 1.5
        stop_method=StopLossMethod.ATR,
        stop_atr_mult=2.0,
        stop_fixed_pct=2.5,
        stop_max_pct=8.0,
        stop_min_pct=1.5,
        target_rr_mult=2.0,
        target_min_pct=4.0,
        target_max_pct=12.0,
        max_concurrent_trades=2,
        position_size_pct=8.0,
        notes="QSE: سوق محدود → صفقات أقل.",
        # V40.4 Market Physics Matrix
        benchmark_ticker="QE_INDEX",
        min_turnover_local=1_000_000.0,      # 1M QAR
        atr_stop_min_pct=2.5,               # [2.5%, 5.0%]
        atr_stop_max_pct=5.0,
        dynamic_rr_normal=1.8,              # RULE-18-RESTORE: was 1.5
        dynamic_rr_outperform=1.8,
        data_provider_type="financial_statements",
        price_db_table="price_history",
        is_continuous_24_7=False,
    ),

    # =====================================================================
    # DFM - سوق دبي المالي
    # =====================================================================
    "DFM": MarketProfile(
        market_code="DFM",
        market_name="Dubai Financial Market",
        market_name_ar="سوق دبي المالي",
        currency="AED",
        weights=AnalyzerWeights(
            technical=38,
            volume=25,
            candlestick=17,
            fundamental=12,
            sentiment=5,
            sector=3,
        ),
        default_strategy=TradingStrategy.SWING,
        min_score_buy=67.0,
        min_score_strong=82.0,
        min_volume_filter=1_000_000,
        min_value_traded=2_000_000,
        min_rr=1.8,           # RULE-18-RESTORE: was 1.5
        stop_method=StopLossMethod.ATR,
        stop_atr_mult=2.0,
        stop_fixed_pct=2.5,
        stop_max_pct=8.0,
        stop_min_pct=1.5,
        target_rr_mult=2.0,
        target_min_pct=3.5,
        target_max_pct=12.0,
        max_concurrent_trades=3,
        position_size_pct=10.0,
        # V40.4 Market Physics Matrix
        benchmark_ticker="DFMGI",
        min_turnover_local=2_000_000.0,      # 2M AED
        atr_stop_min_pct=2.5,               # [2.5%, 6.0%]
        atr_stop_max_pct=6.0,
        dynamic_rr_normal=1.8,              # RULE-18-RESTORE: was 1.5
        dynamic_rr_outperform=2.0,
        data_provider_type="financial_statements",
        price_db_table="price_history",
        is_continuous_24_7=False,
    ),

    # =====================================================================
    # CRYPTO - العملات الرقمية
    # تقلب عالٍ → إعدادات مختلفة جداً
    # =====================================================================
    "CRYPTO": MarketProfile(
        market_code="CRYPTO",
        market_name="Cryptocurrency Market",
        market_name_ar="العملات الرقمية",
        currency="USD",
        weights=AnalyzerWeights(
            technical=45,     # المؤشرات التقنية الأهم
            volume=30,        # Volume حرجة للكريبتو
            candlestick=10,
            fundamental=0,    # لا أساسيات في كريبتو
            sentiment=12,     # الأخبار تحرك الكريبتو بقوة
            sector=3,
        ),
        default_strategy=TradingStrategy.BREAKOUT,
        min_score_buy=72.0,   # أعلى بسبب التقلب
        min_score_strong=85.0,
        min_volume_filter=1_000_000,
        min_value_traded=1_000_000,
        min_rr=2.0,           # R/R أعلى للكريبتو
        stop_method=StopLossMethod.ATR,
        stop_atr_mult=2.5,    # أوسع بسبب التقلب
        stop_fixed_pct=10.0,
        stop_max_pct=20.0,
        stop_min_pct=5.0,
        target_rr_mult=2.5,   # هدف أكبر
        target_min_pct=10.0,
        target_max_pct=50.0,
        max_concurrent_trades=2,
        position_size_pct=3.0,  # صغير جداً بسبب المخاطر
        rsi_overbought=75.0,
        rsi_oversold=25.0,
        rsi_extreme_high=88.0,
        rsi_extreme_low=15.0,
        notes="CRYPTO: تقلب عالٍ. حجم مركز 3% فقط. الأخبار مهمة.",
        # V40.4 Market Physics Matrix
        benchmark_ticker="BTC.D",           # هيمنة البيتكوين
        min_turnover_local=5_000_000.0,     # 5M USD
        atr_stop_min_pct=5.0,               # [5.0%, 15.0%]
        atr_stop_max_pct=15.0,
        dynamic_rr_normal=1.8,              # Normal 1.8, High-Vol 2.5
        dynamic_rr_outperform=2.5,
        data_provider_type="on_chain_tokenomics",
        price_db_table="crypto_prices",
        is_continuous_24_7=True,            # مستمر 24/7
    ),
}


# ─── شخصيات المتداولين ──────────────────────────────────────────────────────

PERSONA_PROFILES: Dict[str, PersonaProfile] = {

    # =====================================================================
    # SCALPER - مضارب سريع
    # T+1 فقط، صفقات صغيرة سريعة، وقف ضيق
    # =====================================================================
    "scalper": PersonaProfile(
        persona=PersonaType.SCALPER,
        name_ar="مضارب سريع",
        score_threshold_boost=-5.0,   # -5 على الحد الأدنى (أكثر مرونة)
        max_concurrent_trades=5,
        position_size_pct=8.0,
        risk_per_trade_pct=1.0,       # 1% خسارة أقصى للصفقة
        min_holding_days=0,
        max_holding_days=1,           # T+1 فقط
        min_rr_override=1.2,          # R/R أدنى مقبول
        require_volume_confirm=True,
        require_pattern_confirm=False,
        allowed_strategies=["T+1", "scalp"],
        allowed_signals=["STRONG_BUY", "BUY"],  # شراء فقط
        stop_tighter_factor=0.8,      # وقف أضيق بـ 20%
        target_higher_factor=0.8,     # هدف أصغر (خروج أسرع)
    ),

    # =====================================================================
    # TRADER - متداول swing
    # 3-10 أيام، متوازن، الأكثر شيوعاً
    # =====================================================================
    "trader": PersonaProfile(
        persona=PersonaType.TRADER,
        name_ar="متداول نشط",
        score_threshold_boost=0.0,    # لا تعديل على الحد الأدنى
        max_concurrent_trades=3,
        position_size_pct=10.0,
        risk_per_trade_pct=2.0,
        min_holding_days=2,
        max_holding_days=10,
        min_rr_override=None,         # استخدم R/R من السوق
        require_volume_confirm=True,
        require_pattern_confirm=False,
        allowed_strategies=["T+1", "swing"],
        allowed_signals=None,         # كل الإشارات
        stop_tighter_factor=1.0,
        target_higher_factor=1.0,
    ),

    # =====================================================================
    # INVESTOR - مستثمر متوسط المدى
    # أسابيع-شهور، يركز على الأساسيات، صبور
    # =====================================================================
    "investor": PersonaProfile(
        persona=PersonaType.INVESTOR,
        name_ar="مستثمر",
        score_threshold_boost=5.0,    # +5 (أكثر انتقائية)
        max_concurrent_trades=3,
        position_size_pct=15.0,       # مراكز أكبر
        risk_per_trade_pct=3.0,
        min_holding_days=14,
        max_holding_days=90,
        min_rr_override=2.0,          # R/R أعلى
        require_volume_confirm=False,  # السيولة أقل أهمية للاستثمار
        require_pattern_confirm=False,
        require_sector_trend=True,    # يشترط قطاع صاعد
        allowed_strategies=["swing", "position"],
        allowed_signals=["STRONG_BUY", "BUY", "ACCUMULATE"],
        stop_tighter_factor=1.5,      # وقف أوسع (صبور)
        target_higher_factor=1.5,     # هدف أكبر
    ),

    # =====================================================================
    # CONSERVATIVE - محافظ جداً
    # فقط أفضل الفرص، خسارة محدودة جداً
    # =====================================================================
    "conservative": PersonaProfile(
        persona=PersonaType.CONSERVATIVE,
        name_ar="محافظ",
        score_threshold_boost=15.0,   # +15 (انتقائية عالية جداً)
        max_concurrent_trades=2,
        position_size_pct=5.0,        # مراكز صغيرة
        risk_per_trade_pct=1.0,
        min_holding_days=7,
        max_holding_days=30,
        min_rr_override=2.5,          # R/R عالٍ جداً
        require_volume_confirm=True,
        require_pattern_confirm=True,  # يشترط نمط شمعة واضح
        require_sector_trend=True,
        allowed_strategies=["swing", "position"],
        allowed_signals=["STRONG_BUY", "BUY"],
        stop_tighter_factor=1.0,
        target_higher_factor=1.2,
    ),
}


import os
import json
import copy
from pathlib import Path

# Path to active settings overrides
ACTIVE_SETTINGS_PATH = Path(__file__).parent.resolve() / "active_settings.json"

def load_active_settings() -> dict:
    """تحميل الإعدادات المخصصة النشطة من ملف json"""
    if ACTIVE_SETTINGS_PATH.exists():
        try:
            with open(ACTIVE_SETTINGS_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[UnifiedConfig] Error loading active_settings.json: {e}")
    return {}


# ============================================================================
# UNIFIED CONFIG RESOLVER
# ============================================================================

class UnifiedConfig:
    """
    دمج MarketProfile + PersonaProfile لإنتاج إعدادات نهائية
    هي النقطة الوحيدة التي يحتاجها CoreScoringEngine
    """

    def __init__(
        self,
        market_code: str,
        persona_name: str = "trader",
        custom_overrides: Dict[str, Any] = None
    ):
        base_market = MARKET_PROFILES.get(market_code.upper())
        base_persona = PERSONA_PROFILES.get(persona_name.lower())

        if not base_market:
            raise ValueError(f"سوق غير معروف: {market_code}. الخيارات: {list(MARKET_PROFILES.keys())}")
        if not base_persona:
            raise ValueError(f"شخصية غير معروفة: {persona_name}. الخيارات: {list(PERSONA_PROFILES.keys())}")

        # Deep-copy standard profiles to prevent mutating global constants
        self.market_profile = copy.deepcopy(base_market)
        self.persona_profile = copy.deepcopy(base_persona)

        # Apply persistent active settings overrides
        active_settings = load_active_settings()
        
        # Apply market overrides
        market_overrides = active_settings.get("markets", {}).get(market_code.upper(), {})
        for key, value in market_overrides.items():
            if hasattr(self.market_profile, key):
                setattr(self.market_profile, key, value)
                
        # Apply market weights overrides specifically
        if "weights" in market_overrides and self.market_profile.weights:
            for w_key, w_val in market_overrides["weights"].items():
                if hasattr(self.market_profile.weights, w_key):
                    setattr(self.market_profile.weights, w_key, w_val)

        # Apply persona overrides
        persona_overrides = active_settings.get("personas", {}).get(persona_name.lower(), {})
        for key, value in persona_overrides.items():
            if hasattr(self.persona_profile, key):
                setattr(self.persona_profile, key, value)

        # تطبيق التخصيصات الإضافية
        self.custom_overrides = custom_overrides or {}

    @property
    def min_score_buy(self) -> float:
        """الحد الأدنى للشراء بعد تعديل الشخصية"""
        base = self.market_profile.min_score_buy
        return self.persona_profile.get_min_score(base)

    @property
    def min_rr(self) -> float:
        """R/R الأدنى بعد تعديل الشخصية"""
        return self.persona_profile.get_min_rr(self.market_profile.min_rr)

    @property
    def position_size_pct(self) -> float:
        return self.custom_overrides.get(
            "position_size_pct", self.persona_profile.position_size_pct
        )

    @property
    def max_concurrent_trades(self) -> int:
        return self.custom_overrides.get(
            "max_concurrent_trades", self.persona_profile.max_concurrent_trades
        )

    @property
    def weights(self) -> Dict[str, float]:
        return self.market_profile.weights.to_dict()

    @property
    def stop_method(self) -> StopLossMethod:
        return self.market_profile.stop_method

    @property
    def stop_atr_mult(self) -> float:
        base = self.market_profile.stop_atr_mult
        return round(base * self.persona_profile.stop_tighter_factor, 2)

    @property
    def target_rr_mult(self) -> float:
        base = self.market_profile.target_rr_mult
        return round(base * self.persona_profile.target_higher_factor, 2)

    def is_strategy_allowed(self, strategy: str) -> bool:
        return strategy in self.persona_profile.allowed_strategies

    def is_signal_allowed(self, signal: str) -> bool:
        if self.persona_profile.allowed_signals is None:
            return True
        return signal in self.persona_profile.allowed_signals

    def to_summary(self) -> dict:
        """ملخص الإعدادات المدمجة"""
        return {
            "market":        self.market_profile.market_code,
            "market_ar":     self.market_profile.market_name_ar,
            "persona":       self.persona_profile.persona.value,
            "persona_ar":    self.persona_profile.name_ar,
            "strategy":      self.market_profile.default_strategy.value,
            "min_score_buy": self.min_score_buy,
            "min_rr":        self.min_rr,
            "position_size": self.position_size_pct,
            "max_trades":    self.max_concurrent_trades,
            "stop_method":   self.stop_method.value,
            "weights":       self.weights,
            "holding_days":  f"{self.persona_profile.min_holding_days}-{self.persona_profile.max_holding_days}",
        }


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_market_profile(market_code: str) -> Optional[MarketProfile]:
    return MARKET_PROFILES.get(market_code.upper())


def get_persona_profile(persona_name: str) -> Optional[PersonaProfile]:
    return PERSONA_PROFILES.get(persona_name.lower())


def get_unified_config(market: str, persona: str = "trader", **overrides) -> UnifiedConfig:
    """الدالة الرئيسية للحصول على إعدادات موحدة"""
    return UnifiedConfig(market, persona, overrides)


def list_markets() -> List[str]:
    return list(MARKET_PROFILES.keys())


def list_personas() -> List[str]:
    return list(PERSONA_PROFILES.keys())


def get_all_configs_summary() -> dict:
    """ملخص كل الإعدادات المتاحة"""
    return {
        "markets":  {k: v.market_name_ar for k, v in MARKET_PROFILES.items()},
        "personas": {k: v.name_ar        for k, v in PERSONA_PROFILES.items()},
    }


# ============================================================================
# SIGNAL TRANSLATIONS
# ============================================================================

SIGNAL_TRANSLATIONS = {
    "STRONG_BUY":  "شراء قوي",
    "BUY":         "شراء",
    "ACCUMULATE":  "تجميع",
    "HOLD":        "احتفاظ",
    "REDUCE":      "تخفيف",
    "SELL":        "بيع",
    "STRONG_SELL": "بيع قوي",
    "REJECTED":    "مرفوض",
    "REJECTED_RR": "مرفوض - نسبة مخاطرة غير مقبولة",
    "NO_DATA":     "بيانات غير كافية",
}


def translate_signal(signal: str) -> str:
    return SIGNAL_TRANSLATIONS.get(signal, signal)


# ============================================================================
# TESTS
# ============================================================================

if __name__ == "__main__":
    print("=" * 60)
    print("🔧 Unified Config Engine - اختبار")
    print("=" * 60)

    # اختبار جميع الأسواق مع جميع الشخصيات
    for market in list_markets():
        for persona in list_personas():
            cfg = get_unified_config(market, persona)
            summary = cfg.to_summary()
            print(f"\n📊 {summary['market_ar']} | {summary['persona_ar']}")
            print(f"   Min Score: {summary['min_score_buy']:.0f}% | R/R: {summary['min_rr']} | "
                  f"Position: {summary['position_size']:.0f}%")
            print(f"   Strategy: {summary['strategy']} | "
                  f"Holding: {summary['holding_days']} days")

    print(f"\n✅ {len(list_markets())} أسواق × {len(list_personas())} شخصيات = "
          f"{len(list_markets()) * len(list_personas())} تكوين مختلف")
