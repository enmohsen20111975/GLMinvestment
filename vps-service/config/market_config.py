"""
Market Configuration Engine
===========================
محرك إعدادات الأسواق

يحتوي على إعدادات كل سوق:
- ساعات التداول
- الأطر الزمنية المدعومة
- وقف الخسارة والهدف الافتراضي
- الحد الأدنى للسيولة
- العملة
- وغيرها

@authorM2yDevelopers Team
@version 1.0.0
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from enum import Enum


class MarketType(Enum):
    """أنواع الأسواق"""
    STOCK = "stock"           # أسهم عادية
    CRYPTO = "crypto"         # عملات رقمية
    FOREX = "forex"           # عملات أجنبية
    COMMODITY = "commodity"   # سلع


class MarketRegime(Enum):
    """حالات السوق"""
    BULL = "bull"      # صاعد
    BEAR = "bear"      # هابط
    RANGE = "range"    # متراوح


@dataclass
class MarketConfig:
    """إعدادات سوق واحد"""
    code: str                           # كود السوق (EGX, KSA, CRYPTO, etc.)
    name: str                           # اسم السوق
    name_ar: str                        # الاسم بالعربية
    market_type: MarketType             # نوع السوق
    
    # ساعات التداول
    trading_start: str = "10:00"        # بداية التداول
    trading_end: str = "14:30"          # نهاية التداول
    timezone: str = "Africa/Cairo"      # المنطقة الزمنية
    trading_days: List[int] = field(default_factory=lambda: [0, 1, 2, 3, 4])  # أيام التداول (0=الإثنين)
    
    # الأطر الزمنية المدعومة
    timeframes: List[str] = field(default_factory=lambda: ["daily", "weekly", "monthly"])
    
    # إعدادات المخاطر
    default_stop_loss: float = 7.0      # وقف الخسارة الافتراضي %
    default_target: float = 15.0        # الهدف الافتراضي %
    max_position_size: float = 10.0     # أقصى حجم مركز %
    min_risk_reward: float = 1.5        # أقل نسبة مخاطرة/عائد
    
    # السيولة
    min_volume: int = 1_000_000         # أقل حجم تداول
    min_value_traded: int = 1_000_000   # أقل قيمة تداول
    
    # العملة
    currency: str = "EGP"               # العملة
    currency_symbol: str = "ج.م"        # رمز العملة
    
    # TradingView
    tv_screener: str = "egypt"          # TradingView screener
    tv_exchange: str = "EGX"            # TradingView exchange
    
    # إعدادات خاصة
    allow_short: bool = False           # السماح بالبيع القصير
    has_futures: bool = False           # يتوفر به عقود مستقبلية
    has_options: bool = False           # يتوفر به خيارات
    
    # ملاحظات
    notes: str = ""


# ============================================================================
# MARKET CONFIGURATIONS
# ============================================================================

MARKET_CONFIGS: Dict[str, MarketConfig] = {
    
    # ═══════════════════════════════════════════════════════════════════════
    # EGX - البورصة المصرية
    # ═══════════════════════════════════════════════════════════════════════
    "EGX": MarketConfig(
        code="EGX",
        name="Egyptian Exchange",
        name_ar="البورصة المصرية",
        market_type=MarketType.STOCK,
        
        trading_start="10:00",
        trading_end="14:30",
        timezone="Africa/Cairo",
        trading_days=[6, 0, 1, 2, 3],  # الأحد للخميس (توقيت مصر)
        
        timeframes=["daily", "weekly", "monthly"],  # لا يوجد intraday (4.5 ساعة فقط)
        
        default_stop_loss=7.0,
        default_target=15.0,
        max_position_size=10.0,
        min_risk_reward=1.5,
        
        min_volume=1_000_000,
        min_value_traded=1_000_000,
        
        currency="EGP",
        currency_symbol="ج.م",
        
        tv_screener="egypt",
        tv_exchange="EGX",
        
        allow_short=False,
        has_futures=False,
        has_options=False,
        
        notes="EGX opens only 4.5 hours/day, intraday analysis not meaningful"
    ),
    
    # ═══════════════════════════════════════════════════════════════════════
    # Tadawul - السوق السعودي
    # ═══════════════════════════════════════════════════════════════════════
    "KSA": MarketConfig(
        code="KSA",
        name="Saudi Exchange (Tadawul)",
        name_ar="تداول السعودية",
        market_type=MarketType.STOCK,
        
        trading_start="10:00",
        trading_end="15:00",
        timezone="Asia/Riyadh",
        trading_days=[0, 1, 2, 3, 4],  # الأحد للخميس
        
        timeframes=["daily", "weekly", "monthly"],
        
        default_stop_loss=7.0,
        default_target=15.0,
        max_position_size=10.0,
        min_risk_reward=1.5,
        
        min_volume=5_000_000,
        min_value_traded=10_000_000,
        
        currency="SAR",
        currency_symbol="ر.س",
        
        tv_screener="saudi",
        tv_exchange="Tadawul",
        
        allow_short=False,
        has_futures=True,
        has_options=False,
        
        notes="Tadawul is the largest Arab stock exchange"
    ),
    
    # ═══════════════════════════════════════════════════════════════════════
    # KSE - بورصة الكويت
    # ═══════════════════════════════════════════════════════════════════════
    "KSE": MarketConfig(
        code="KSE",
        name="Kuwait Stock Exchange",
        name_ar="بورصة الكويت",
        market_type=MarketType.STOCK,
        
        trading_start="09:00",
        trading_end="13:30",
        timezone="Asia/Kuwait",
        trading_days=[0, 1, 2, 3, 4],
        
        timeframes=["daily", "weekly", "monthly"],
        
        default_stop_loss=7.0,
        default_target=12.0,
        max_position_size=8.0,
        min_risk_reward=1.5,
        
        min_volume=500_000,
        min_value_traded=500_000,
        
        currency="KWD",
        currency_symbol="د.ك",
        
        tv_screener="kuwait",
        tv_exchange="KSE",
        
        allow_short=False,
        has_futures=False,
        has_options=False,
    ),
    
    # ═══════════════════════════════════════════════════════════════════════
    # QSE - بورصة قطر
    # ═══════════════════════════════════════════════════════════════════════
    "QSE": MarketConfig(
        code="QSE",
        name="Qatar Stock Exchange",
        name_ar="بورصة قطر",
        market_type=MarketType.STOCK,
        
        trading_start="09:00",
        trading_end="13:00",
        timezone="Asia/Qatar",
        trading_days=[0, 1, 2, 3, 4],
        
        timeframes=["daily", "weekly", "monthly"],
        
        default_stop_loss=7.0,
        default_target=12.0,
        max_position_size=8.0,
        min_risk_reward=1.5,
        
        min_volume=500_000,
        min_value_traded=500_000,
        
        currency="QAR",
        currency_symbol="ر.ق",
        
        tv_screener="qatar",
        tv_exchange="QSE",
        
        allow_short=False,
        has_futures=False,
        has_options=False,
    ),
    
    # ═══════════════════════════════════════════════════════════════════════
    # DFM - سوق دبي المالي
    # ═══════════════════════════════════════════════════════════════════════
    "DFM": MarketConfig(
        code="DFM",
        name="Dubai Financial Market",
        name_ar="سوق دبي المالي",
        market_type=MarketType.STOCK,
        
        trading_start="10:00",
        trading_end="14:00",
        timezone="Asia/Dubai",
        trading_days=[0, 1, 2, 3, 4],
        
        timeframes=["daily", "weekly", "monthly"],
        
        default_stop_loss=7.0,
        default_target=12.0,
        max_position_size=8.0,
        min_risk_reward=1.5,
        
        min_volume=500_000,
        min_value_traded=1_000_000,
        
        currency="AED",
        currency_symbol="د.إ",
        
        tv_screener="dubai",
        tv_exchange="DFM",
        
        allow_short=False,
        has_futures=True,
        has_options=False,
    ),
    
    # ═══════════════════════════════════════════════════════════════════════
    # US - NYSE/NASDAQ (American Stock Market)
    # ═══════════════════════════════════════════════════════════════════════
    "US": MarketConfig(
        code="US",
        name="US Stock Market (NYSE/NASDAQ)",
        name_ar="البورصة الأمريكية",
        market_type=MarketType.STOCK,

        # 9:30 AM ET = 14:30 UTC, 4:00 PM ET = 21:00 UTC
        # Stored as the market-local convention (10:00 - 15:30 placeholder,
        # actual UTC conversion handled by analyzers/market_regime_engine.py).
        trading_start="09:30",
        trading_end="16:00",
        timezone="America/New_York",
        trading_days=[0, 1, 2, 3, 4],  # Mon-Fri

        timeframes=["daily", "weekly", "monthly"],

        default_stop_loss=5.0,
        default_target=12.0,
        max_position_size=8.0,
        min_risk_reward=1.5,

        # US markets are highly liquid — higher minimums in USD
        min_volume=1_000_000,
        min_value_traded=5_000_000,

        currency="USD",
        currency_symbol="$",

        tv_screener="america",
        tv_exchange="NASDAQ",

        allow_short=True,
        has_futures=True,
        has_options=True,

        notes="NYSE/NASDAQ — uses SPY/QQQ ETF proxies for regime detection. Higher liquidity thresholds in USD."
    ),

    # ═══════════════════════════════════════════════════════════════════════
    # CRYPTO - العملات الرقمية
    # ═══════════════════════════════════════════════════════════════════════
    "CRYPTO": MarketConfig(
        code="CRYPTO",
        name="Cryptocurrency Market",
        name_ar="سوق العملات الرقمية",
        market_type=MarketType.CRYPTO,
        
        trading_start="00:00",  # 24/7
        trading_end="23:59",
        timezone="UTC",
        trading_days=[0, 1, 2, 3, 4, 5, 6],  # كل الأيام
        
        timeframes=["1h", "4h", "daily", "weekly"],  # يدعم intraday
        
        default_stop_loss=15.0,  # أوسع بسبب التقلب
        default_target=40.0,     # أعلى بسبب التقلب
        max_position_size=3.0,   # أصغر بسبب المخاطرة
        min_risk_reward=2.0,     # أعلى
        
        min_volume=1_000_000,
        min_value_traded=1_000_000,
        
        currency="USD",
        currency_symbol="$",
        
        tv_screener="crypto",
        tv_exchange="BINANCE",
        
        allow_short=True,
        has_futures=True,
        has_options=True,
        
        notes="24/7 trading, higher volatility, use smaller positions"
    ),
    
    # ═══════════════════════════════════════════════════════════════════════
    # FOREX - سوق العملات
    # ═══════════════════════════════════════════════════════════════════════
    "FOREX": MarketConfig(
        code="FOREX",
        name="Foreign Exchange Market",
        name_ar="سوق العملات الأجنبية",
        market_type=MarketType.FOREX,
        
        trading_start="00:00",  # 24/5
        trading_end="23:59",
        timezone="UTC",
        trading_days=[0, 1, 2, 3, 4],
        
        timeframes=["5m", "15m", "1h", "4h", "daily", "weekly"],
        
        default_stop_loss=2.0,   # ضيق بسبب الرافعة
        default_target=4.0,      # ضعف الاستوب
        max_position_size=2.0,   # صغير جداً بسبب الرافعة
        min_risk_reward=2.0,
        
        min_volume=0,  # السيولة عالية جداً
        min_value_traded=0,
        
        currency="USD",
        currency_symbol="$",
        
        tv_screener="forex",
        tv_exchange="FX_IDC",
        
        allow_short=True,
        has_futures=True,
        has_options=True,
        
        notes="High leverage, tight stops, 24/5 trading"
    ),
    
    # ═══════════════════════════════════════════════════════════════════════
    # GOLD - الذهب
    # ═══════════════════════════════════════════════════════════════════════
    "GOLD": MarketConfig(
        code="GOLD",
        name="Gold Market",
        name_ar="سوق الذهب",
        market_type=MarketType.COMMODITY,
        
        trading_start="00:00",
        trading_end="23:59",
        timezone="UTC",
        trading_days=[0, 1, 2, 3, 4],
        
        timeframes=["1h", "4h", "daily", "weekly"],
        
        default_stop_loss=3.0,
        default_target=6.0,
        max_position_size=5.0,
        min_risk_reward=2.0,
        
        min_volume=0,
        min_value_traded=0,
        
        currency="USD",
        currency_symbol="$",
        
        tv_screener="cfd",
        tv_exchange="TVC",
        
        allow_short=True,
        has_futures=True,
        has_options=True,
        
        notes="Safe haven asset, inversely correlated with risk assets"
    ),
}


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_market_config(market_code: str) -> Optional[MarketConfig]:
    """الحصول على إعدادات سوق معين"""
    return MARKET_CONFIGS.get(market_code.upper())


def get_all_markets() -> Dict[str, MarketConfig]:
    """الحصول على كل الأسواق"""
    return MARKET_CONFIGS


def get_markets_by_type(market_type: MarketType) -> List[MarketConfig]:
    """الحصول على الأسواق حسب النوع"""
    return [config for config in MARKET_CONFIGS.values() if config.market_type == market_type]


def get_stock_markets() -> List[str]:
    """الحصول على أسواق الأسهم فقط"""
    return [code for code, config in MARKET_CONFIGS.items() if config.market_type == MarketType.STOCK]


def get_crypto_markets() -> List[str]:
    """الحصول على أسواق الكريبتو"""
    return [code for code, config in MARKET_CONFIGS.items() if config.market_type == MarketType.CRYPTO]


def is_market_open(market_code: str) -> bool:
    """التحقق من أن السوق مفتوح الآن"""
    from datetime import datetime
    import pytz
    
    config = get_market_config(market_code)
    if not config:
        return False
    
    # CRYPTO is always open
    if config.market_type == MarketType.CRYPTO:
        return True
    
    try:
        # Get current time in market timezone
        tz = pytz.timezone(config.timezone)
        now = datetime.now(tz)
        
        # Check day of week
        if now.weekday() not in config.trading_days:
            return False
        
        # Check time
        current_time = now.strftime("%H:%M")
        return config.trading_start <= current_time <= config.trading_end
        
    except Exception:
        return False


def get_regime_settings(market_code: str, regime: str) -> Dict[str, Any]:
    """
    الحصول على إعدادات حسب حالة السوق
    
    Args:
        market_code: كود السوق
        regime: حالة السوق (bull, bear, range)
    
    Returns:
        Dict: إعدادات معدلة حسب الحالة
    """
    config = get_market_config(market_code)
    if not config:
        return {}
    
    base_settings = {
        "stop_loss": config.default_stop_loss,
        "target": config.default_target,
        "max_position": config.max_position_size,
        "min_score": 60,
    }
    
    if regime == "bull":
        return {
            **base_settings,
            "stop_loss": config.default_stop_loss * 0.9,  # أضيق
            "target": config.default_target * 1.2,       # أعلى
            "max_position": config.max_position_size * 1.2,
            "min_score": 65,
        }
    elif regime == "bear":
        return {
            **base_settings,
            "stop_loss": config.default_stop_loss * 1.2,  # أوسع
            "target": config.default_target * 0.7,       # أقل
            "max_position": config.max_position_size * 0.5,
            "min_score": 80,  # يحتاج درجة أعلى للشراء
        }
    else:  # range
        return {
            **base_settings,
            "stop_loss": config.default_stop_loss * 0.85,
            "target": config.default_target * 0.8,
            "max_position": config.max_position_size * 0.8,
            "min_score": 60,
        }


def detect_market_from_ticker(ticker: str) -> str:
    """
    تحديد السوق من الـ ticker
    
    Examples:
        COMI → EGX
        1120.SR → KSA
        BTCUSDT → CRYPTO
        EURUSD → FOREX
    """
    ticker = ticker.upper()

    # US stock patterns — NYSE/NASDAQ tickers (all-caps 1-5 letters, no suffix)
    # Use a curated allow-list to avoid false positives with EGX tickers like "V"
    US_TICKER_HINTS = {
        "AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "NVDA", "META", "TSLA",
        "BRK.B", "BRK.B", "JPM", "V", "JNJ", "WMT", "MA", "PG", "UNH",
        "HD", "CVX", "MRK", "ABBV", "PFE", "KO", "PEP", "BAC", "TMO",
        "COST", "AVGO", "MCD", "CRM", "AMD", "NFLX", "ACN", "ADBE",
        "DHR", "ORCL", "CMCSA", "NEE", "TXN", "WFC", "PM", "IBM", "MS",
        "QCOM", "RTX", "HON", "UPS", "INTC", "CAT", "BA", "GE", "GM",
        "SPY", "QQQ", "DIA", "IWM",
    }
    if ticker in US_TICKER_HINTS:
        return "US"

    # Crypto patterns
    if any(x in ticker for x in ["USDT", "USDC", "BTC", "ETH", "BNB", "XRP"]):
        return "CRYPTO"
    
    # Forex patterns
    if len(ticker) == 6 and ticker[:3] in ["EUR", "GBP", "USD", "JPY", "CHF", "AUD", "CAD", "NZD"]:
        return "FOREX"
    
    # Gold/Silver
    if ticker in ["GOLD", "XAUUSD", "SILVER", "XAGUSD"]:
        return "GOLD"
    
    # Saudi patterns
    if ".SR" in ticker or ticker.isdigit():
        return "KSA"
    
    # Kuwait patterns
    if ".KW" in ticker:
        return "KSE"
    
    # Qatar patterns
    if ".QA" in ticker:
        return "QSE"
    
    # Dubai patterns
    if ".AE" in ticker:
        return "DFM"
    
    # Default to EGX
    return "EGX"


# ============================================================================
# INITIALIZATION
# ============================================================================

def print_market_summary():
    """طباعة ملخص الأسواق"""
    print("\n" + "="*60)
    print("📊 MARKET CONFIGURATION SUMMARY")
    print("="*60)
    
    for code, config in MARKET_CONFIGS.items():
        status = "🟢" if is_market_open(code) else "🔴"
        print(f"\n{status} {code}: {config.name_ar}")
        print(f"   Type: {config.market_type.value}")
        print(f"   Hours: {config.trading_start} - {config.trading_end}")
        print(f"   Stop Loss: {config.default_stop_loss}% | Target: {config.default_target}%")
        print(f"   Timeframes: {', '.join(config.timeframes)}")


if __name__ == "__main__":
    print_market_summary()
