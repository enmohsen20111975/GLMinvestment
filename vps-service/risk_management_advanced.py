"""
Risk Management Module - إدارة المخاطر
=======================================
كل قواعد إدارة المخاطر والتداول للمصري والعملات الرقمية

This module includes:
- Position sizing based on confidence
- Stop Loss calculations by stock type
- Target profit calculations
- Trailing stop logic
- Trading time advisor
- Portfolio management rules
"""

from typing import Dict, List, Optional, Tuple
from datetime import datetime, time
import math

# P0.6: Single source of truth for thresholds — engine_settings.py (Constitution Rule 11).
# استوردنا get_setting عشان نقرأ نسب الـ stop loss من نفس المصدر، بدل الـ dicts الثابتة.
try:
    from analyzers.engine_settings import get_setting as _get_engine_setting
    from analyzers.engine_settings import DEFAULT_SETTINGS as _ENGINE_DEFAULT_SETTINGS
    _ENGINE_SETTINGS_AVAILABLE = True
except ImportError:  # pragma: no cover - fallback لو engine_settings مش متاح
    _get_engine_setting = None
    _ENGINE_DEFAULT_SETTINGS = {}
    _ENGINE_SETTINGS_AVAILABLE = False

# ==================== POSITION SIZING ====================

def calculate_position_size(
    capital: float,
    confidence_score: float,
    max_risk_percent: float = 2.0
) -> Dict:
    """
    حساب حجم الصفقة بناءً على درجة الثقة
    
    حجم الصفقة = رأس المال × (درجة الثقة / 100)
    
    Args:
        capital: رأس المال الكلي
        confidence_score: درجة الثقة (-10 إلى +10)
        max_risk_percent: أقصى نسبة مخاطرة (افتراضي 2%)
    
    Returns:
        تفاصيل حجم الصفقة والقرار
    """
    if confidence_score >= 8:
        percentage = 0.10  # 10%
        risk_level = "عالية"
        action = "دخول بقوة"
    elif confidence_score >= 5:
        percentage = 0.05  # 5%
        risk_level = "متوسطة"
        action = "دخول بحذر"
    elif confidence_score >= 2:
        percentage = 0.02  # 2%
        risk_level = "منخفضة"
        action = "دخول بحذر شديد"
    else:
        percentage = 0
        risk_level = "لا شيء"
        action = "لا تدخل"
    
    position_size = capital * percentage
    max_loss = capital * (max_risk_percent / 100)
    
    return {
        'position_size': round(position_size, 2),
        'percentage_of_capital': round(percentage * 100, 1),
        'confidence_score': confidence_score,
        'risk_level': risk_level,
        'action': action,
        'max_acceptable_loss': round(max_loss, 2),
        'reason': get_position_reason(confidence_score)
    }


def get_position_reason(score: float) -> str:
    """سبب القرار"""
    if score >= 8:
        return "كل المؤشرات إيجابية - فرصة قوية"
    elif score >= 5:
        return "بعض المؤشرات إيجابية - احترس"
    elif score >= 2:
        return "مؤشرات ضعيفة - انتظر تأكيد أكتر"
    elif score >= -2:
        return "لا توجد إشارة واضحة - لا تدخل"
    else:
        return "مؤشرات سلبية - ابعد عن السهم ده"


# ==================== STOP LOSS ====================
# P0.6 (Constitution Rule 11 — single source of truth):
# الـ stop-loss percentages مبش متخزنة كـ hardcoded dict — بيتم قراءتها من
# `analyzers/engine_settings.py` عبر `get_stop_loss_pct()`. الـ constants
# `STOP_LOSS_EGX` / `STOP_LOSS_CRYPTO` اللي تحت ده بتـ backward-compat shims
# بتقرأ من engine_settings في كل access، فأي تعديل من الأدمن بـ يظهر فورًا.
# ⚠️ DEPRECATED: استخدم `get_stop_loss_pct(stock_type, market)` بدلًا من قراءة
# الـ dicts دي مباشرة. هتتشال في P1.x.

# قيم الـ fallback الافتراضية (لو engine_settings مش متاح)
_STOP_LOSS_FALLBACK_EGX: Dict[str, Dict] = {
    'large_bank':        {'percent': -7,  'examples': ['COMI', 'HRHO'], 'reason': 'سيولة عالية، أقل تقلب'},
    'medium_bank':        {'percent': -8,  'examples': ['SAUD', 'CAII'], 'reason': 'تقلب أعلى شوية'},
    'large_real_estate': {'percent': -10, 'examples': ['MNHD', 'ORHD'], 'reason': 'تقلب عالي، أزمة قطاع'},
    'small_real_estate': {'percent': -12, 'examples': [], 'reason': 'تقلب جامد، ممكن يعلق'},
    'large_industrial':  {'percent': -8,  'examples': ['SWDY', 'ESRS'], 'reason': 'تقلب متوسط'},
    'small_industrial':  {'percent': -10, 'examples': [], 'reason': 'تقلب عالي'},
    'speculative':       {'percent': -5,  'examples': [], 'reason': 'سريع، ممكن ينهار'},
    'suspended':         {'percent': 0,   'examples': [], 'reason': 'خطر إفلاس - لا تدخل'},
}

_STOP_LOSS_FALLBACK_CRYPTO: Dict[str, Dict] = {
    'bitcoin':       {'percent': -10, 'reason': 'أقل تقلب'},
    'ethereum':      {'percent': -12, 'reason': 'تقلب متوسط'},
    'large_altcoin': {'percent': -15, 'reason': 'تقلب عالي'},
    'small_altcoin': {'percent': -20, 'reason': 'تقلب جامد'},
    'meme_coin':     {'percent': -25, 'reason': 'مقامرة - لا تدخل إلا لو فاضي مالي'},
}


def get_stop_loss_pct(stock_type: str, market: str = 'EGX') -> float:
    """
    P0.6: قراءة نسبة الـ stop loss من `engine_settings` — المصدر الوحيد.

    Args:
        stock_type: نوع السهم/العملة (مثل 'large_bank', 'speculative',
                    'bitcoin', 'large_altcoin', ...).
        market: 'EGX' أو 'CRYPTO' (case-insensitive).

    Returns:
        نسبة الـ stop loss (سالب، مثل -7.0 لخسارة 7%). لو الـ stock_type
        غير معروف، بـ يرجّع fallback معقول:
            - EGX: speculative (-5)
            - CRYPTO: large_altcoin (-15)
    """
    market_norm = (market or 'EGX').upper()
    if market_norm not in ('EGX', 'CRYPTO'):
        # معاملة أي قيمة غير CRYPTO كـ EGX (السلوك الأصلي للـ dict)
        market_norm = 'EGX'
    key = f'stop_pct_{stock_type}_{market_norm.lower()}'
    # تحقق إن المفتاح معرّف في DEFAULT_SETTINGS — لو لأ، يبقى stock_type غريب
    # ونرجّع fallback معقول (speculative للـ EGX / large_altcoin للـ CRYPTO).
    if _ENGINE_SETTINGS_AVAILABLE and key in _ENGINE_DEFAULT_SETTINGS:
        return float(_get_engine_setting(key))
    # Fallback للـ hardcoded defaults (لو engine_settings مش متاح أو المفتاح غريب)
    if market_norm == 'CRYPTO':
        cfg = _STOP_LOSS_FALLBACK_CRYPTO.get(stock_type) or _STOP_LOSS_FALLBACK_CRYPTO['large_altcoin']
    else:
        cfg = _STOP_LOSS_FALLBACK_EGX.get(stock_type) or _STOP_LOSS_FALLBACK_EGX['speculative']
    return float(cfg['percent'])


def _get_stop_loss_reason(stock_type: str, market: str = 'EGX') -> str:
    """P0.6: نص السبب المرافق لنسبة الـ stop loss. قراءة فقط — ما بيتعدّلش."""
    market_norm = (market or 'EGX').upper()
    if market_norm not in ('EGX', 'CRYPTO'):
        market_norm = 'EGX'
    if market_norm == 'CRYPTO':
        cfg = _STOP_LOSS_FALLBACK_CRYPTO.get(stock_type) or _STOP_LOSS_FALLBACK_CRYPTO['large_altcoin']
    else:
        cfg = _STOP_LOSS_FALLBACK_EGX.get(stock_type) or _STOP_LOSS_FALLBACK_EGX['speculative']
    return cfg.get('reason', '')


def _build_stop_loss_dict(market: str) -> Dict[str, Dict]:
    """P0.6: ابني الـ stop-loss dict ديناميكيًا من engine_settings.

    ده المستخدم للـ deprecated `STOP_LOSS_EGX` / `STOP_LOSS_CRYPTO` shims
    وللـ `/api/risk/stock-types` endpoint. بيضمن إن الأدمن لو عدّل قيمة في
    engine_settings، تظهر في كل مكان.
    """
    market_norm = (market or 'EGX').upper()
    if market_norm == 'CRYPTO':
        base = _STOP_LOSS_FALLBACK_CRYPTO
    else:
        base = _STOP_LOSS_FALLBACK_EGX
    result = {}
    for stock_type, info in base.items():
        pct = get_stop_loss_pct(stock_type, market_norm)
        entry = {'percent': pct, 'reason': info['reason']}
        if 'examples' in info:
            entry['examples'] = info['examples']
        result[stock_type] = entry
    return result


def _deprecated_stop_loss_egx() -> Dict[str, Dict]:
    """⚠️ DEPRECATED — استخدم get_stop_loss_pct(). يُعاد بناء الـ dict من engine_settings."""
    return _build_stop_loss_dict('EGX')


def _deprecated_stop_loss_crypto() -> Dict[str, Dict]:
    """⚠️ DEPRECATED — استخدم get_stop_loss_pct(). يُعاد بناء الـ dict من engine_settings."""
    return _build_stop_loss_dict('CRYPTO')


class _DeprecatedStopLossDict(dict):
    """⚠️ DEPRECATED: وكيل شفّاف (proxy) يقرأ من engine_settings في كل access.

    بيخلي STOP_LOSS_EGX و STOP_LOSS_CRYPTO يبدوا كأنهم dict ثابت عشان
    نحافظ على backward compatibility مع أي consumer بيعمل `STOP_LOSS_EGX[k]`
    أو `STOP_LOSS_EGX.get(k, default)`. لكن في الواقع بيرجع قيم حية من
    engine_settings. هتتشال في P1.x — استخدم get_stop_loss_pct().
    """

    def __init__(self, market: str):
        super().__init__()
        self._market = market

    def _refresh(self) -> Dict[str, Dict]:
        return _build_stop_loss_dict(self._market)

    def __getitem__(self, key: str) -> Dict:
        return self._refresh()[key]

    def get(self, key: str, default=None):
        return self._refresh().get(key, default)

    def __contains__(self, key: object) -> bool:
        return key in self._refresh()

    def __iter__(self):
        return iter(self._refresh())

    def __len__(self) -> int:
        return len(self._refresh())

    def keys(self):
        return self._refresh().keys()

    def values(self):
        return self._refresh().values()

    def items(self):
        return self._refresh().items()

    def __repr__(self) -> str:
        return f"_DeprecatedStopLossDict(market={self._market!r}, data={self._refresh()!r})"


# ⚠️ DEPRECATED (P0.6): use `get_stop_loss_pct(stock_type, market)` instead.
# الـ dicts دي بتـ backward-compat shims — أي تعديل في engine_settings
# بـ يظهر فورًا فيها. هتتشال في P1.x.
STOP_LOSS_EGX = _DeprecatedStopLossDict('EGX')
STOP_LOSS_CRYPTO = _DeprecatedStopLossDict('CRYPTO')


def detect_stock_type(symbol: str, sector: str = None, market_cap: str = None) -> str:
    """
    تحديد نوع السهم بناءً على الرمز والقطاع
    """
    symbol = symbol.upper()
    
    # Banks
    bank_symbols = ['COMI', 'HRHO', 'CIEB', 'SAUD', 'CAII', 'FAIT', 'ETAL', 'ADIB']
    if symbol in bank_symbols or (sector and 'بنك' in sector.lower()):
        if symbol in ['COMI', 'HRHO', 'CIEB']:
            return 'large_bank'
        return 'medium_bank'
    
    # Real Estate
    real_estate_symbols = ['MNHD', 'ORHD', 'MDCO', 'ALCN', 'HELI']
    if symbol in real_estate_symbols or (sector and 'عقار' in sector.lower()):
        if symbol in ['MNHD', 'ORHD']:
            return 'large_real_estate'
        return 'small_real_estate'
    
    # Industrial
    industrial_symbols = ['SWDY', 'ESRS', 'SPMD', 'ALCL', 'SKPC']
    if symbol in industrial_symbols or (sector and ('صناع' in sector.lower() or 'صناعة' in sector.lower())):
        if symbol in ['SWDY', 'ESRS']:
            return 'large_industrial'
        return 'small_industrial'
    
    # Check market cap
    if market_cap:
        mc = market_cap.lower()
        if 'large' in mc or 'كبير' in mc:
            return 'large_industrial'  # Default to large
        elif 'small' in mc or 'صغير' in mc:
            return 'speculative'
    
    return 'speculative'


def calculate_stop_loss(
    entry_price: float,
    stock_type: str = None,
    symbol: str = None,
    market: str = 'egx',
    custom_percent: float = None
) -> Dict:
    """
    حساب سعر Stop Loss
    
    Args:
        entry_price: سعر الدخول
        stock_type: نوع السهم
        symbol: رمز السهم
        market: السوق (egx أو crypto)
        custom_percent: نسبة مخصصة
    
    Returns:
        تفاصيل Stop Loss
    """
    if custom_percent is not None:
        stop_percent = custom_percent
        reason = "نسبة مخصصة"
    else:
        # P0.6: اقرأ من engine_settings عبر get_stop_loss_pct() — المصدر الوحيد.
        # معاملة أي قيمة غير 'crypto' كـ EGX (السلوك الأصلي).
        market_norm = 'CRYPTO' if (market or '').lower() == 'crypto' else 'EGX'
        resolved_stock_type = stock_type or ('large_altcoin' if market_norm == 'CRYPTO' else 'speculative')
        stop_percent = get_stop_loss_pct(resolved_stock_type, market_norm)
        reason = _get_stop_loss_reason(resolved_stock_type, market_norm)
    
    stop_price = entry_price * (1 + stop_percent / 100)
    risk_amount = entry_price - stop_price
    risk_percent = abs(stop_percent)
    
    return {
        'entry_price': entry_price,
        'stop_price': round(stop_price, 4),
        'stop_percent': round(stop_percent, 1),
        'risk_amount': round(risk_amount, 4),
        'risk_percent': round(risk_percent, 1),
        'stock_type': stock_type,
        'reason': reason,
        'warning': get_stop_loss_warning(stop_percent)
    }


def get_stop_loss_warning(stop_percent: float) -> str:
    """تحذير بناءً على نسبة Stop Loss"""
    if stop_percent >= -5:
        return "⚠️ Stop Loss ضيق - ممكن يضرب بسهولة"
    elif stop_percent >= -10:
        return "✅ Stop Loss مناسب"
    elif stop_percent >= -15:
        return "⚠️ Stop Loss واسع - تأكد من حجم الصفقة"
    else:
        return "🚨 Stop Loss واسع جداً - قلل حجم الصفقة أو لا تدخل"


# ==================== TARGETS ====================

def calculate_targets(
    entry_price: float,
    stop_price: float,
    risk_reward_ratios: List[float] = [1.5, 3, 5]
) -> Dict:
    """
    حساب أهداف الربح
    
    Target = سعر الدخول + (نسبة × مسافة Stop Loss)
    
    Args:
        entry_price: سعر الدخول
        stop_price: سعر Stop Loss
        risk_reward_ratios: نسب الربح للمخاطرة
    
    Returns:
        أهداف الربح مع تفاصيل
    """
    risk_distance = entry_price - stop_price  # مسافة المخاطرة
    
    targets = []
    sell_percentages = [50, 30, 20]  # نسب البيع عند كل هدف
    
    for i, ratio in enumerate(risk_reward_ratios):
        target_price = entry_price + (ratio * risk_distance)
        profit_percent = ((target_price - entry_price) / entry_price) * 100
        profit_amount = target_price - entry_price
        
        targets.append({
            'target_number': i + 1,
            'price': round(target_price, 4),
            'profit_percent': round(profit_percent, 1),
            'profit_amount': round(profit_amount, 4),
            'risk_reward_ratio': ratio,
            'sell_percent': sell_percentages[i],
            'action': f"بيع {sell_percentages[i]}% من الصفقة"
        })
    
    return {
        'entry_price': entry_price,
        'stop_price': stop_price,
        'risk_distance': round(risk_distance, 4),
        'targets': targets,
        'summary': {
            'best_case': f"لو وصلت كل الأهداف: ربح {round(((targets[-1]['price'] - entry_price) / entry_price) * 100, 1)}%",
            'conservative': f"لو وصلت الهدف الأول بس: ربح {round(targets[0]['profit_percent'], 1)}%"
        }
    }


# ==================== TRAILING STOP ====================

def calculate_trailing_stop(
    entry_price: float,
    current_price: float,
    stop_price: float,
    target_reached: int = 0
) -> Dict:
    """
    حساب Trailing Stop بعد الوصول للأهداف
    
    Args:
        entry_price: سعر الدخول
        current_price: السعر الحالي
        stop_price: Stop Loss الحالي
        target_reached: رقم الهدف اللي وصلناه (0, 1, 2, 3)
    
    Returns:
        Trailing Stop الجديد
    """
    # Calculate targets
    risk_distance = entry_price - stop_price
    targets = [
        entry_price + (1.5 * risk_distance),
        entry_price + (3 * risk_distance),
        entry_price + (5 * risk_distance)
    ]
    
    new_stop = stop_price
    message = ""
    
    if target_reached >= 1:
        new_stop = entry_price  # حرك لسعر الدخول
        message = "Stop Loss moved to entry - لو رجع، تخرج بـ 0 خسارة"
    
    if target_reached >= 2:
        new_stop = targets[0]  # حرك للهدف الأول
        message = f"Stop Loss moved to Target 1 ({round(targets[0], 4)}) - تخرج بربح"
    
    if target_reached >= 3:
        new_stop = targets[1]  # حوط للهدف الثاني
        message = f"Stop Loss moved to Target 2 ({round(targets[1], 4)}) - تخرج بربح أكبر"
    
    return {
        'original_stop': stop_price,
        'new_stop': round(new_stop, 4),
        'target_reached': target_reached,
        'current_profit_percent': round(((current_price - entry_price) / entry_price) * 100, 1),
        'protected_profit': round(((new_stop - entry_price) / entry_price) * 100, 1),
        'message': message,
        'action': get_trailing_action(target_reached)
    }


def get_trailing_action(target: int) -> str:
    """إجراء Trailing Stop"""
    actions = {
        0: "لم نصل لأي هدف - ابقى على Stop Loss الأصلي",
        1: "حرك Stop Loss لسعر الدخول - احمِ رأس مالك",
        2: "حرك Stop Loss للهدف الأول - احمِ أرباحك",
        3: "حرك Stop Loss للهدف الثاني - اترك الباقي للركض"
    }
    return actions.get(target, "غير محدد")


# ==================== TRADING TIME ADVISOR ====================

# EGX Trading Session: 10:00 AM - 2:30 PM (Cairo)
EGX_TRADING_TIMES = {
    'opening': {
        'start': time(10, 0),
        'end': time(10, 30),
        'status': 'تقلب عالي - اكتشاف الأسعار',
        'action': 'لا تدخل',
        'risk': 'high'
    },
    'settling': {
        'start': time(10, 30),
        'end': time(11, 30),
        'status': 'السوق يستقر - الاتجاه يتضح',
        'action': 'ممكن ندخل بحذر',
        'risk': 'medium'
    },
    'best': {
        'start': time(11, 30),
        'end': time(13, 0),
        'status': 'أفضل وقت للدخول',
        'action': 'الدخول هنا',
        'risk': 'low'
    },
    'pre_close': {
        'start': time(13, 0),
        'end': time(14, 0),
        'status': 'ممكن للمضاربة السريعة',
        'action': 'انتبه للإغلاق',
        'risk': 'medium'
    },
    'closing': {
        'start': time(14, 0),
        'end': time(14, 30),
        'status': 'إغلاق - تقلب - تسوية',
        'action': 'لا تدخل جديد',
        'risk': 'high'
    }
}

# Weekly trading days (EGX)
EGX_TRADING_DAYS = {
    'saturday': {
        'arabic': 'السبت',
        'status': 'بداية أسبوع - تجربة السوق',
        'action': 'انتبه، ممكن دخول بحذر',
        'score': 5
    },
    'sunday': {
        'arabic': 'الأحد',
        'status': 'الاتجاه يتضح',
        'action': 'أفضل يوم للدخول',
        'score': 9
    },
    'monday': {
        'arabic': 'الاثنين',
        'status': 'استمرار أو تصحيح',
        'action': 'ممكن دخول',
        'score': 7
    },
    'tuesday': {
        'arabic': 'الثلاثاء',
        'status': 'منتصف الأسبوع',
        'action': 'ممكن، بس أقل فرص',
        'score': 6
    },
    'wednesday': {
        'arabic': 'الأربعاء',
        'status': 'قبل الإغلاق',
        'action': 'لا تدخل جديد، راقب فقط',
        'score': 4
    },
    'thursday': {
        'arabic': 'الخميس',
        'status': 'إغلاق أسبوعي',
        'action': 'لا تدخل، ممكن بيع',
        'score': 3
    },
    'friday': {
        'arabic': 'الجمعة',
        'status': 'مغلق',
        'action': 'لا شيء',
        'score': 0
    }
}

# Crypto best times (24/7 but varying liquidity)
CRYPTO_TRADING_TIMES = {
    'avoid': {
        'start': time(3, 0),
        'end': time(5, 0),
        'status': 'سيولة ضعيفة، تقلب عشوائي',
        'action': 'تجنب',
        'timezone': 'Cairo'
    },
    'best': {
        'start': time(8, 0),
        'end': time(12, 0),
        'status': 'أمريكا بتصحى - سيولة عالية',
        'action': 'أفضل وقت',
        'timezone': 'Cairo'
    },
    'avoid_sunday': {
        'day': 'sunday',
        'status': 'إغلاق أسبوعي - تقلب غير متوقع',
        'action': 'تجنب'
    },
    'best_monday': {
        'day': 'monday',
        'status': 'أفضل يوم للدخول',
        'action': 'دخول'
    }
}


def get_trading_time_advice(market: str = 'egx') -> Dict:
    """
    نصيحة وقت التداول
    
    Args:
        market: السوق (egx أو crypto)
    
    Returns:
        نصيحة التداول الحالية
    """
    now = datetime.now()
    current_time = now.time()
    current_day = now.strftime('%A').lower()
    
    if market == 'egx':
        # Check if market is open
        if current_day == 'friday':
            return {
                'market': 'EGX',
                'is_open': False,
                'current_time': current_time.strftime('%H:%M'),
                'day': 'الجمعة',
                'status': 'السوق مغلق',
                'action': 'السوق مغلق يوم الجمعة',
                'next_open': 'السبت 10:00 صباحاً'
            }
        
        # Find current session
        current_session = None
        for session_name, session_info in EGX_TRADING_TIMES.items():
            if session_info['start'] <= current_time <= session_info['end']:
                current_session = session_name
                break
        
        is_open = time(10, 0) <= current_time <= time(14, 30)
        day_info = EGX_TRADING_DAYS.get(current_day, {})
        
        if current_session:
            session = EGX_TRADING_TIMES[current_session]
            return {
                'market': 'EGX',
                'is_open': is_open,
                'current_time': current_time.strftime('%H:%M'),
                'day': day_info.get('arabic', current_day),
                'session': current_session,
                'status': session['status'],
                'action': session['action'],
                'risk_level': session['risk'],
                'day_score': day_info.get('score', 5),
                'day_advice': day_info.get('action', ''),
                'is_best_time': current_session == 'best' and day_info.get('score', 0) >= 7
            }
        else:
            if current_time < time(10, 0):
                next_action = "السوق هيفتح الساعة 10:00 ص"
            elif current_time > time(14, 30):
                next_action = "السوق أغلق - بكرة إن شاء الله"
            else:
                next_action = "خارج وقت التداول"
            
            return {
                'market': 'EGX',
                'is_open': is_open,
                'current_time': current_time.strftime('%H:%M'),
                'day': day_info.get('arabic', current_day),
                'status': 'خارج الجلسة',
                'action': next_action,
                'day_score': day_info.get('score', 5)
            }
    
    else:  # Crypto
        # Crypto is 24/7 but check for best times
        is_avoid_time = time(3, 0) <= current_time <= time(5, 0)
        is_best_time = time(8, 0) <= current_time <= time(12, 0)
        is_avoid_day = current_day == 'sunday'
        is_best_day = current_day == 'monday'
        
        if is_avoid_time:
            status = "سيولة ضعيفة - تجنب"
            action = "استنى لحد الساعة 8 صباحاً"
            risk = 'high'
        elif is_best_time:
            status = "سيولة عالية - وقت ممتاز"
            action = "أفضل وقت للتداول"
            risk = 'low'
        elif is_avoid_day:
            status = "إغلاق أسبوعي - تقلب غير متوقع"
            action = "احترس اليوم"
            risk = 'medium'
        elif is_best_day:
            status = "أفضل يوم للدخول"
            action = "يوم ممتاز للتداول"
            risk = 'low'
        else:
            status = "سوق مفتوح"
            action = "تداول بحذر"
            risk = 'medium'
        
        return {
            'market': 'Crypto',
            'is_open': True,  # Always open
            'current_time': current_time.strftime('%H:%M'),
            'day': current_day,
            'status': status,
            'action': action,
            'risk_level': risk
        }


# ==================== PORTFOLIO MANAGEMENT ====================

PORTFOLIO_RULES = {
    'max_sector_percent': 30,  # قطاع واحد ≤ 30%
    'max_single_stock_percent': 10,  # سهم واحد ≤ 10%
    'min_cash_percent': 20,  # نقد ≥ 20%
    'recommended_stocks': (3, 5),  # 3-5 أسهم
    'warning_drawdown': 15,  # وقف لو خسارة 15%
    'take_profit_portfolio': 30,  # خد جزء لو ربح 30%
}


def analyze_portfolio(
    holdings: List[Dict],
    total_capital: float,
    cash: float
) -> Dict:
    """
    تحليل المحفظة
    
    Args:
        holdings: قائمة الأسهم [{symbol, value, sector}]
        total_capital: رأس المال الكلي
        cash: النقد المتاح
    
    Returns:
        تحليل المحفظة مع توقعات
    """
    total_invested = sum(h.get('value', 0) for h in holdings)
    portfolio_value = total_invested + cash
    
    # Sector analysis
    sectors = {}
    for h in holdings:
        sector = h.get('sector', 'other')
        sectors[sector] = sectors.get(sector, 0) + h.get('value', 0)
    
    # Check rules
    violations = []
    warnings = []
    
    # Sector concentration
    for sector, value in sectors.items():
        percent = (value / portfolio_value) * 100
        if percent > PORTFOLIO_RULES['max_sector_percent']:
            violations.append({
                'rule': 'sector_concentration',
                'message': f"قطاع {sector} = {round(percent, 1)}% (أقصى {PORTFOLIO_RULES['max_sector_percent']}%)",
                'severity': 'high'
            })
    
    # Single stock concentration
    for h in holdings:
        percent = (h.get('value', 0) / portfolio_value) * 100
        if percent > PORTFOLIO_RULES['max_single_stock_percent']:
            violations.append({
                'rule': 'single_stock_concentration',
                'message': f"سهم {h.get('symbol')} = {round(percent, 1)}% (أقصى {PORTFOLIO_RULES['max_single_stock_percent']}%)",
                'severity': 'medium'
            })
    
    # Cash reserve
    cash_percent = (cash / portfolio_value) * 100
    if cash_percent < PORTFOLIO_RULES['min_cash_percent']:
        warnings.append({
            'rule': 'low_cash',
            'message': f"النقد = {round(cash_percent, 1)}% (مطلوب {PORTFOLIO_RULES['min_cash_percent']}% على الأقل)",
            'severity': 'medium'
        })
    
    # Number of stocks
    num_stocks = len(holdings)
    min_stocks, max_stocks = PORTFOLIO_RULES['recommended_stocks']
    if num_stocks < min_stocks:
        warnings.append({
            'rule': 'too_few_stocks',
            'message': f"عدد الأسهم = {num_stocks} (موصى به {min_stocks}-{max_stocks})",
            'severity': 'low'
        })
    elif num_stocks > max_stocks:
        warnings.append({
            'rule': 'too_many_stocks',
            'message': f"عدد الأسهم = {num_stocks} (موصى به {min_stocks}-{max_stocks})",
            'severity': 'low'
        })
    
    # Calculate health score
    health_score = 100
    health_score -= len(violations) * 15
    health_score -= len(warnings) * 5
    
    return {
        'portfolio_value': round(portfolio_value, 2),
        'invested': round(total_invested, 2),
        'cash': round(cash, 2),
        'cash_percent': round(cash_percent, 1),
        'num_holdings': num_stocks,
        'sectors': {k: round(v, 2) for k, v in sectors.items()},
        'violations': violations,
        'warnings': warnings,
        'health_score': max(0, health_score),
        'recommendations': get_portfolio_recommendations(violations, warnings, cash_percent)
    }


def get_portfolio_recommendations(violations: List, warnings: List, cash_percent: float) -> List[str]:
    """توقعات المحفظة"""
    recommendations = []
    
    if not violations and not warnings:
        recommendations.append("✅ محفظتك متوازنة - استمر")
    
    for v in violations:
        if v['rule'] == 'sector_concentration':
            recommendations.append("📉 قلل التعرض لقطاع واحد - خطر التركز")
        elif v['rule'] == 'single_stock_concentration':
            recommendations.append("📊 وزع أكثر - سهم واحد خطر كبير")
    
    for w in warnings:
        if w['rule'] == 'low_cash':
            recommendations.append("💰 زود النقد - فرص بتيجي فجأة")
        elif w['rule'] == 'too_few_stocks':
            recommendations.append("📈 زود عدد الأسهم - التركز خطر")
        elif w['rule'] == 'too_many_stocks':
            recommendations.append("📉 قلل عدد الأسهم - الصعب المتابعة")
    
    return recommendations


# ==================== THE 2% RULE ====================

def validate_trade_with_2_percent_rule(
    capital: float,
    entry_price: float,
    stop_price: float,
    shares: int
) -> Dict:
    """
    التحقق من قاعدة الـ 2%
    
    لو خسارة متوقعة > 2% من رأس المال:
        قلل حجم الصفقة أو لا تدخل
    """
    position_value = entry_price * shares
    max_loss_per_share = entry_price - stop_price
    total_potential_loss = max_loss_per_share * shares
    max_acceptable_loss = capital * 0.02  # 2%
    
    loss_percent = (total_potential_loss / capital) * 100
    is_acceptable = total_potential_loss <= max_acceptable_loss
    
    # Calculate safe shares
    safe_shares = int(max_acceptable_loss / max_loss_per_share) if max_loss_per_share > 0 else 0
    
    return {
        'position_value': round(position_value, 2),
        'potential_loss': round(total_potential_loss, 2),
        'potential_loss_percent': round(loss_percent, 2),
        'max_acceptable_loss': round(max_acceptable_loss, 2),
        'is_acceptable': is_acceptable,
        'current_shares': shares,
        'safe_shares': max(0, safe_shares),
        'recommendation': get_2_percent_recommendation(is_acceptable, loss_percent)
    }


def get_2_percent_recommendation(is_acceptable: bool, loss_percent: float) -> str:
    """توقعة قاعدة الـ 2%"""
    if is_acceptable:
        return "✅ الخسارة المحتملة ضمن الحد الآمن (2%)"
    elif loss_percent > 5:
        return "🚨 خطر! قلل الصفقة جداً أو لا تدخل"
    else:
        return f"⚠️ الخسارة {round(loss_percent, 1)}% تتجاوز 2% - قلل الحجم"


# ==================== EGYPTIAN MODEL ====================

def calculate_egyptian_confidence(
    news_alignment: float,  # 0-100
    volume_normal: float,   # 0-100
    sector_impact: float,   # 0-100
    technical_simple: float # 0-100
) -> Dict:
    """
    حساب درجة الثقة المصرية
    
    النموذج المصري = 
      40% أخبار/سياسة
      30% تحليل أساسي
      20% سلوك السوق
      10% تحليل فني مبسط
    """
    score = (
        news_alignment * 0.40 +
        volume_normal * 0.20 +
        sector_impact * 0.20 +
        technical_simple * 0.10
    ) - 50  # Convert to -50 to +50 scale
    
    # Convert to -10 to +10 scale
    confidence = score / 5
    
    return {
        'raw_score': round(score, 1),
        'confidence_score': round(confidence, 1),
        'breakdown': {
            'news_politics': round(news_alignment * 0.40, 1),
            'volume_behavior': round(volume_normal * 0.20, 1),
            'sector_impact': round(sector_impact * 0.20, 1),
            'technical': round(technical_simple * 0.10, 1)
        },
        'decision': get_confidence_decision(confidence),
        'position_size': calculate_position_size(100000, confidence)  # Example with 100k
    }


def get_confidence_decision(score: float) -> Dict:
    """القرار بناءً على درجة الثقة"""
    if score >= 8:
        return {'action': 'اشتري الآن', 'confidence': 'عالية', 'emoji': '🟢'}
    elif score >= 5:
        return {'action': 'اشتري بحذر', 'confidence': 'متوسطة', 'emoji': '🟡'}
    elif score >= 2:
        return {'action': 'انتظر', 'confidence': 'منخفضة', 'emoji': '🟠'}
    elif score >= -2:
        return {'action': 'لا تدخل', 'confidence': 'لا توجد', 'emoji': '⚪'}
    else:
        return {'action': 'لا تشتري', 'confidence': 'سلبية', 'emoji': '🔴'}


# ==================== NEWS TO NUMBERS ====================

NEWS_IMPACT_SCORES = {
    # أخبار مصرية
    'رفع الفايدة': {'بنوك': 2, 'عقارات': -2, 'صناعة': -1},
    'تعويم الجنيه': {'عقارات': 1, 'استيراد': -2, 'بنوك': 0},
    'طروحات حكومية': {'بترول': 3, 'استثمار': 2},
    'أزمة دولار': {'استيراد': -3, 'صناعة': -2},
    'أرباح قياسية': {'all': 3},
    'خسارة': {'all': -3},
    'تضخم': {'استهلاكية': -2, 'بنوك': 1},
    'قرض صندوق النقد': {'all': 2},
    'احتياطي النقد الأجنبي': {'all': 2},
    'عجز الموازنة': {'all': -1},
    # أخبار عملات رقمية
    'ETF approval': {'crypto': 3},
    'regulation negative': {'crypto': -3},
    'exchange hack': {'crypto': -2},
    'whale buy': {'crypto': 1},
    'whale sell': {'crypto': -1},
}


def score_news_for_sector(news_title: str, sector: str) -> int:
    """
    تحويل الخبر لرقم
    
    Args:
        news_title: عنوان الخبر
        sector: القطاع
    
    Returns:
        درجة التأثير
    """
    score = 0
    title_lower = news_title.lower()
    
    for keyword, impacts in NEWS_IMPACT_SCORES.items():
        if keyword in title_lower or keyword in news_title:
            if sector in impacts:
                score += impacts[sector]
            elif 'all' in impacts:
                score += impacts['all']
    
    return score


def analyze_multiple_news(news_list: List[str], sector: str) -> Dict:
    """
    تحليل قائمة أخبار لقطاع معين
    """
    total_score = 0
    positive = 0
    negative = 0
    neutral = 0
    
    detailed = []
    for news in news_list:
        score = score_news_for_sector(news, sector)
        total_score += score
        
        if score > 0:
            positive += 1
            sentiment = 'positive'
        elif score < 0:
            negative += 1
            sentiment = 'negative'
        else:
            neutral += 1
            sentiment = 'neutral'
        
        detailed.append({
            'title': news[:100],
            'score': score,
            'sentiment': sentiment
        })
    
    return {
        'sector': sector,
        'total_score': total_score,
        'positive_count': positive,
        'negative_count': negative,
        'neutral_count': neutral,
        'overall_sentiment': 'bullish' if total_score > 3 else ('bearish' if total_score < -3 else 'neutral'),
        'details': detailed
    }


# ==================== PSYCHOLOGY RULES ====================

PSYCHOLOGY_RULES = [
    {
        'rule': 'لا تدخل سهم "الكل بيتكلم عنه"',
        'reason': 'لو الجميع يشتري = مفيش حد يشتري بعدك = هتعلق',
        'severity': 'high'
    },
    {
        'rule': 'لا تدخل بعد صعود 20%+ في يوم',
        'reason': 'غالباً pump = هينهار',
        'severity': 'high'
    },
    {
        'rule': 'لا تدخل سهم "نصيحة من صاحبك"',
        'reason': 'لو هو عارف = ليه قالك؟',
        'severity': 'medium'
    },
    {
        'rule': 'لا تدخل بكل فلوسك في سهم واحد',
        'reason': 'مهما كنت متأكد = ممكن يحصل أي حاجة',
        'severity': 'high'
    },
    {
        'rule': 'لا تتداول بفلوس محتاجها خلال شهر',
        'reason': 'السوق ممكن يعلقك شهور',
        'severity': 'high'
    },
    {
        'rule': 'لا تتداول وأنت "مزعوج" أو "متحمس"',
        'reason': 'القرار العاطفي = خسارة',
        'severity': 'high'
    }
]


def check_psychology_rules(
    stock_trending: bool = False,
    daily_change_percent: float = 0,
    from_friend_tip: bool = False,
    all_in: bool = False,
    needed_soon: bool = False,
    emotional_state: str = 'calm'
) -> Dict:
    """
    فحص قواعد السيكولوجية
    """
    violations = []
    
    if stock_trending:
        violations.append(PSYCHOLOGY_RULES[0])
    
    if daily_change_percent > 20:
        violations.append(PSYCHOLOGY_RULES[1])
    
    if from_friend_tip:
        violations.append(PSYCHOLOGY_RULES[2])
    
    if all_in:
        violations.append(PSYCHOLOGY_RULES[3])
    
    if needed_soon:
        violations.append(PSYCHOLOGY_RULES[4])
    
    if emotional_state in ['upset', 'excited', 'anxious', 'fearful']:
        violations.append(PSYCHOLOGY_RULES[5])
    
    return {
        'is_safe': len(violations) == 0,
        'violations': violations,
        'recommendation': "✅ أنت جاهز للتداول" if len(violations) == 0 else "⚠️ راجع نفسك قبل الدخول",
        'high_severity_count': sum(1 for v in violations if v['severity'] == 'high')
    }


# ==================== QUICK REFERENCE ====================

DECISION_TABLE = [
    {'scenario': 'سوق صاعد + قطاع صاعد + سهم قوي + خبر إيجابي + حجم عالي', 'action': 'اشتري الآن', 'confidence': 'عالية'},
    {'scenario': 'سوق صاعد + قطاع صاعد + سهم عادي + خبر إيجابي + حجم طبيعي', 'action': 'اشتري بحذر', 'confidence': 'متوسطة'},
    {'scenario': 'سوق صاعد + قطاع نازل + سهم قوي + خبر إيجابي', 'action': 'انتظر', 'confidence': 'منخفضة'},
    {'scenario': 'سوق نازل + أي حاجة', 'action': 'لا تدخل', 'confidence': '-'},
    {'scenario': 'سهم نازل 20%+ في يوم', 'action': 'لا تشتري', 'confidence': '-'},
    {'scenario': 'سهم صاعد 20%+ في يوم', 'action': 'لا تشتري', 'confidence': '-'},
    {'scenario': 'خبر "شائعة" بس', 'action': 'لا تدخل', 'confidence': '-'},
    {'scenario': 'حجم × 5 في يوم', 'action': 'راقب', 'confidence': '-'},
    {'scenario': '"الكل بيتكلم عنه"', 'action': 'لا تدخل', 'confidence': '-'},
    {'scenario': 'أنت "متحمس" أو "خايف"', 'action': 'لا تدخل', 'confidence': '-'},
]


# ==================== LEVERAGE (Crypto) ====================

def validate_leverage(
    leverage: float,
    position_size: float,
    stop_percent: float,
    capital: float
) -> Dict:
    """
    التحقق من الرافعة المالية (Crypto)
    
    □ لا تستخدم leverage > 2×
    □ أفضل: لا leverage خالص (spot)
    """
    if leverage <= 1:
        return {
            'is_safe': True,
            'leverage': leverage,
            'effective_position': position_size,
            'liquidation_price_percent': 0,
            'recommendation': '✅ Spot trading - آمن'
        }
    
    # Calculate liquidation
    liquidation_percent = -100 / leverage
    
    # Effective position
    effective_position = position_size * leverage
    
    # Risk check
    is_safe = leverage <= 2
    max_loss_percent = abs(stop_percent) * leverage
    
    return {
        'is_safe': is_safe,
        'leverage': leverage,
        'position_size': position_size,
        'effective_position': round(effective_position, 2),
        'liquidation_price_percent': round(liquidation_percent, 1),
        'max_loss_at_stop': round(max_loss_percent, 1),
        'recommendation': get_leverage_recommendation(leverage)
    }


def get_leverage_recommendation(leverage: float) -> str:
    if leverage <= 1:
        return "✅ Spot trading - آمن 100%"
    elif leverage <= 2:
        return "⚠️ رافعة مقبولة - استخدم stop loss أضيق"
    elif leverage <= 5:
        return "🚨 رافعة خطرة - خسارة 20% = إفلاس"
    else:
        return "💀 رافعة انتحارية - لا تستخدم!"


# ==================== TRADE PLAN CALCULATOR ====================
# نظام حاسبة الصفقة التفاعلية (Position Size Calculator)
# ياخد رأس المال + سعر الدخول + وقف الخسارة + الهدف
# ويطلع: عدد الأسهم، قيمة الصفقة، أقصى خسارة، R:R، القرار

def calculate_position_plan(
    capital: float,
    entry_price: float,
    stop_loss: float,
    target_price: float = None,
    risk_percent: float = 2.0,
    confidence_score: float = 5,
    max_risk_percent: float = 2.0
) -> Dict:
    """
    حاسبة الصفقة الكاملة - المطلوبة من المستخدم

    المدخلات:
        capital: رأس المال الكلي
        entry_price: سعر الدخول
        stop_loss: سعر وقف الخسارة (لازم أقل من الدخول)
        target_price: سعر الهدف (اختياري - لحساب R:R)
        risk_percent: نسبة المخاطرة المسموحة من رأس المال (افتراضي 2%)
        confidence_score: درجة الثقة (-10 إلى +10)
        max_risk_percent: أقصى نسبة خسارة (افتراضي 2%)

    المخرجات:
        shares, position_value, max_loss, risk_reward, rr_verdict,
        verdict (صفقة / لا), reasons
    """
    reasons = []

    if entry_price <= 0 or stop_loss <= 0 or capital <= 0:
        return {
            'valid': False,
            'shares': 0,
            'position_value': 0,
            'max_loss': 0,
            'risk_per_share': 0,
            'risk_reward': 0,
            'rr_verdict': get_rr_verdict(0),
            'verdict': '❌ بيانات غير صالحة',
            'reasons': ['سعر الدخول ووقف الخسارة ورأس المال لازم أكبر من صفر'],
        }

    if stop_loss >= entry_price:
        return {
            'valid': False,
            'shares': 0,
            'position_value': 0,
            'max_loss': 0,
            'risk_per_share': 0,
            'risk_reward': 0,
            'rr_verdict': get_rr_verdict(0),
            'verdict': '❌ وقف خسارة غير صالح',
            'reasons': ['وقف الخسارة لازم يكون أقل من سعر الدخول'],
        }

    # المخاطرة لكل سهم
    risk_per_share = entry_price - stop_loss

    # أقصى خسارة مسموحة من رأس المال
    max_acceptable_loss = capital * (max_risk_percent / 100)

    # عدد الأسهم الآمن (اللي يحترم قاعدة الـ 2%)
    safe_shares = int(max_acceptable_loss / risk_per_share) if risk_per_share > 0 else 0
    position_value = safe_shares * entry_price
    actual_max_loss = safe_shares * risk_per_share

    # R:R
    risk_reward = 0.0
    if target_price and target_price > entry_price:
        risk_reward = round((target_price - entry_price) / risk_per_share, 2)
    rr_verdict = get_rr_verdict(risk_reward)

    # القرار
    verdict = "✅ صفقة مسموحة"
    if safe_shares <= 0:
        verdict = "❌ صفقة مرفوضة - الخسارة المحتملة تتجاوز الحد"
        reasons.append(f"وقف الخسارة {abs((stop_loss/entry_price-1)*100):.1f}% واسع جداً لرأس مالك")
    if target_price and risk_reward < 1.5:
        verdict = "⚠️ صفقة ضعيفة - R:R أقل من المطلوب"
        reasons.append(f"R:R = {risk_reward} أقل من 1.5 - الصفقة مش جديرة بالمخاطرة")
    elif target_price and risk_reward >= 3:
        reasons.append(f"R:R = {risk_reward} ممتاز ✅")

    # تعديل بحجم الثقة
    pos = calculate_position_size(capital, confidence_score, max_risk_percent)
    if safe_shares > 0 and pos['percentage_of_capital'] == 0:
        verdict = "❌ ثقة منخفضة - لا تدخل"
        reasons.append("درجة الثقة أقل من الحد الأدنى - لا تدخل")

    return {
        'valid': True,
        'confidence_action': pos['action'],
        'shares': safe_shares,
        'position_value': round(position_value, 2),
        'max_loss': round(actual_max_loss, 2),
        'max_acceptable_loss': round(max_acceptable_loss, 2),
        'risk_per_share': round(risk_per_share, 4),
        'risk_percent': round((risk_per_share / entry_price) * 100, 2),
        'risk_reward': risk_reward,
        'rr_verdict': rr_verdict,
        'verdict': verdict,
        'reasons': reasons,
    }


# ==================== R/R VERDICT ====================
# مؤشر R:R المرئي - يرجع اللون والحالة لعرضه في كل توصية

def get_rr_verdict(risk_reward: float) -> Dict:
    """
    تقييم R:R المرئي:
        >= 3   : ممتاز ✅ (أخضر)
        2-3    : جيد ✅ (أخضر)
        1.5-2  : مقبول ⚠️ (أصفر)
        1-1.5  : ضعيف ⚠️ (أصفر)
        < 1    : ممنوع ❌ (أحمر)
    """
    if risk_reward >= 3:
        return {'level': 'excellent', 'label_ar': 'ممتازة', 'emoji': '✅', 'color': 'green'}
    elif risk_reward >= 2:
        return {'level': 'good', 'label_ar': 'جيدة', 'emoji': '✅', 'color': 'green'}
    elif risk_reward >= 1.5:
        return {'level': 'acceptable', 'label_ar': 'مقبولة', 'emoji': '⚠️', 'color': 'yellow'}
    elif risk_reward >= 1:
        return {'level': 'weak', 'label_ar': 'ضعيفة', 'emoji': '⚠️', 'color': 'yellow'}
    else:
        return {'level': 'forbidden', 'label_ar': 'ممنوعة', 'emoji': '❌', 'color': 'red'}


# ==================== ANTI-FALLING-KNIFE ====================
# نظام "لا تشتري نازل" - قواعد صريحة تمنع الشراء في نزول

def evaluate_buy_safety(
    closes: List[float] = None,
    highs: List[float] = None,
    lows: List[float] = None,
    volumes: List[float] = None,
    rsi: float = None,
    required_higher_lows: int = 2,
    drop_threshold: float = -15.0,
    drop_window: int = 5
) -> Dict:
    """
    تقييم أمان الشراء قبل ما المستخدم يقرر يشتري بنفسه

    القواعد الصريحة:
        1. السهم لازم يعمل Higher Low مرتين على الأقل قبل الشراء
        2. RSI < 30 بس = مش سبب كافي - لازم تأكيد حجم أو شمعة انعكاس
        3. نزول حاد (>15% في 5 جلسات) من غير ارتداد = Falling Knife

    المخرجات:
        allowed, reasons[], higher_lows_count, higher_lows_met,
        falling_knife, rsi_trap
    """
    reasons = []
    higher_lows_met = False
    falling_knife = False
    rsi_trap = False
    higher_lows_count = 0

    # 1. فحص Higher Lows (مطلوب 2 على الأقل)
    if lows and len(lows) >= 6:
        # آخر 6 قيعان (3 أزواج متتالية)
        recent_lows = lows[-6:]
        hl = 0
        for i in range(1, len(recent_lows), 1):
            if recent_lows[i] > recent_lows[i - 1]:
                hl += 1
        # نعد التيارات الصاعدة في القيعان (Higher Lows متتالية)
        consecutive = 0
        best = 0
        for i in range(1, len(recent_lows)):
            if recent_lows[i] > recent_lows[i - 1]:
                consecutive += 1
                best = max(best, consecutive)
            else:
                consecutive = 0
        higher_lows_count = best
        higher_lows_met = higher_lows_count >= required_higher_lows
        if not higher_lows_met:
            reasons.append(
                f"⚠️ السهم معملش {required_higher_lows} Higher Lows متتالية "
                f"(عنده {higher_lows_count}) - لسه من غير قاع مؤكد"
            )

    # 2. فحص Falling Knife (نزول حاد من غير ارتداد)
    if closes and len(closes) >= drop_window + 1:
        start = closes[-(drop_window + 1)]
        end = closes[-1]
        if start > 0:
            change = ((end - start) / start) * 100
            if change < drop_threshold:
                falling_knife = True
                reasons.append(
                    f"🔴 Falling Knife: السهم نزل {change:.1f}% في {drop_window} جلسات - ابعد"
                )

    # 3. فخ RSI (RSI < 30 من غير تأكيد)
    if rsi is not None and rsi < 30:
        volume_confirmed = False
        reversal_confirmed = False

        if volumes and len(volumes) >= 2:
            avg_vol = sum(volumes[-6:]) / min(6, len(volumes))
            if volumes[-1] > avg_vol * 1.2:
                volume_confirmed = True

        if closes and len(closes) >= 2:
            # شمعة انعكاس = قاع + إغلاق أعلى من الافتتاح
            if closes[-1] > closes[-2]:
                reversal_confirmed = True

        if not (volume_confirmed or reversal_confirmed):
            rsi_trap = True
            reasons.append(
                "⚠️ RSI < 30 بس = مش سبب كافي للشراء - محتاج تأكيد حجم أو شمعة انعكاس"
            )

    allowed = not (falling_knife or rsi_trap or not higher_lows_met)

    if allowed and not reasons:
        reasons.append("✅ السهم عمل قاعين صاعدين - آمن للشراء المدروس")

    return {
        'allowed': allowed,
        'reasons': reasons,
        'higher_lows_count': higher_lows_count,
        'higher_lows_required': required_higher_lows,
        'higher_lows_met': higher_lows_met,
        'falling_knife': falling_knife,
        'rsi_trap': rsi_trap,
    }


# ==================== FORCED EXIT ENFORCEMENT ====================
# نظام "لا تحتفظ بالخسارة" - منع تغيير الوقف لتحت + إشارات إجبارية

def enforce_stop_loss(
    entry_price: float,
    current_price: float,
    stop_price: float,
    original_stop_price: float = None,
    forced_exit_pct: float = -8.0
) -> Dict:
    """
    إنفاذ وقف الخسارة:
        - "Stop Loss ثابت - ما تغيرهوش لتحت أبداً"
        - لو السهم نزل 8% من سعر الشراء → إشعار إجباري "اخرج فوراً"
        - "الخسارة ثابتة، الربح متغير"

    المدخلات:
        entry_price, current_price, stop_price (الوقف الحالي)
        original_stop_price: الوقف الأصلي (للتأكد إنه ما نزلش)
        forced_exit_pct: نسبة الخسارة اللي تطلق الإشعار الإجباري

    المخرجات:
        stop_violated, forced_exit, stop_lowered (ممنوع),
        distance_to_stop_pct, alert_level, message
    """
    if entry_price <= 0 or current_price <= 0 or stop_price <= 0:
        return {
            'valid': False,
            'stop_violated': False,
            'forced_exit': False,
            'stop_lowered': False,
            'distance_to_stop_pct': 0,
            'alert_level': 'unknown',
            'message': 'بيانات غير صالحة',
        }

    # المسافة للوقف (بالنسبة لسعر الدخول)
    distance_to_stop_pct = round(((current_price - stop_price) / entry_price) * 100, 2)

    # وقف الخسارة اتكسر؟
    stop_violated = current_price <= stop_price

    # الخسارة الحالية
    pnl_pct = ((current_price - entry_price) / entry_price) * 100

    # إشعار إجباري عند تجاوز حد الخسارة
    forced_exit = pnl_pct <= forced_exit_pct or stop_violated

    # هل الوقف اتغير لتحت (ممنوع)؟
    stop_lowered = False
    if original_stop_price is not None and stop_price < original_stop_price:
        stop_lowered = True

    # مستوى التنبيه
    if stop_lowered:
        alert_level = 'violation'
        message = "🚨 خطر: الوقف اتغير لتحت - ممنوع! رجّعه لسعره الأصلي"
    elif forced_exit:
        alert_level = 'critical'
        message = f"🚨 اخرج فوراً! الخسارة وصلت {pnl_pct:.1f}% (الحد {forced_exit_pct}%)"
    elif distance_to_stop_pct <= 3:
        alert_level = 'warning'
        message = f"⚠️ السهم قريب من الوقف ({distance_to_stop_pct:.1f}% فقط) - راقب بقوة"
    elif distance_to_stop_pct <= 6:
        alert_level = 'caution'
        message = f"🟡 السهم على بُعد {distance_to_stop_pct:.1f}% من الوقف - انتبه"
    else:
        alert_level = 'safe'
        message = f"✅ بعيد عن الوقف ({distance_to_stop_pct:.1f}%) - الوضع آمن"

    return {
        'valid': True,
        'stop_violated': stop_violated,
        'forced_exit': forced_exit,
        'stop_lowered': stop_lowered,
        'distance_to_stop_pct': distance_to_stop_pct,
        'pnl_pct': round(pnl_pct, 2),
        'alert_level': alert_level,
        'message': message,
    }


# ==================== DYNAMIC STOP LOSS (ATR-Based) ====================

def calculate_dynamic_stop_loss(
    entry_price: float,
    closes: List[float] = None,
    highs: List[float] = None,
    lows: List[float] = None,
    atr: float = None,
    atr_period: int = 14,
    multiplier: float = 2.0,
    symbol: str = None,
    market: str = 'egx',
    max_stop_pct: float = 15.0,  # P1.2: ATR-calc function default — أقصى مسافة وقف يسمح بيها حساب ATR. مفهوم مختلف عن engine_settings.position_max_stop_pct=10.0 (POSITION-LAYER hard cap) و prediction_optimizer.max_stop_pct=3.0 (PREDICTION-TIME filter).
    min_stop_pct: float = 2.0,
) -> Dict:
    """
    حساب وقف خسارة ديناميكي بناءً على ATR (التقلب الفعلي)
    بدل نسبة ثابتة — الوقف بيتغير حسب تقلب السهم

    Args:
        entry_price: سعر الدخول
        closes: قائمة أسعار الإغلاق الأخيرة
        highs: قائمة أعلى الأسعار الأخيرة
        lows: قائمة أدنى الأسعار الأخيرة
        atr: قيمة ATR الحالية (لو متاحة مسبقاً)
        atr_period: فترة حساب ATR (افتراضي 14)
        multiplier: مضاعف ATR للوقف (2.0 = متوسط، 3.0 = واسع)
        symbol: رمز السهم
        market: السوق
        max_stop_pct: أقصى وقف كنسبة مئوية
        min_stop_pct: أدنى وقف كنسبة مئوية

    Returns:
        وقف خسارة ديناميكي مع التفاصيل
    """
    # حساب ATR لو مش متوفر
    if atr is None or atr <= 0:
        if highs and lows and len(highs) >= atr_period and len(lows) >= atr_period:
            atr_values = []
            for i in range(1, min(atr_period + 1, len(highs))):
                tr = max(
                    highs[-i] - lows[-i],
                    abs(highs[-i] - closes[-i - 1]) if i < len(closes) else highs[-i] - lows[-i],
                    abs(lows[-i] - closes[-i - 1]) if i < len(closes) else lows[-i] - highs[-i],
                )
                atr_values.append(tr)
            if atr_values:
                atr = sum(atr_values) / len(atr_values)
        elif closes and len(closes) >= 2:
            # Fallback: استخدم مدى السعر الأخير
            recent_range = max(closes[-5:]) - min(closes[-5:]) if len(closes) >= 5 else closes[-1] * 0.02
            atr = recent_range / 2
        else:
            atr = entry_price * 0.02

    # حساب الوقف الديناميكي
    raw_stop_distance = multiplier * atr
    stop_price = entry_price - raw_stop_distance

    # تطبيق الحدود
    max_stop_distance = entry_price * (max_stop_pct / 100)
    min_stop_distance = entry_price * (min_stop_pct / 100)

    if raw_stop_distance > max_stop_distance:
        stop_price = entry_price - max_stop_distance
        stop_pct = max_stop_pct
        capped = True
    elif raw_stop_distance < min_stop_distance:
        stop_price = entry_price - min_stop_distance
        stop_pct = min_stop_pct
        capped = True
    else:
        stop_pct = (raw_stop_distance / entry_price) * 100
        capped = False

    risk_amount = entry_price - stop_price

    return {
        'entry_price': entry_price,
        'stop_price': round(stop_price, 4),
        'stop_pct': round(stop_pct, 2),
        'risk_amount': round(risk_amount, 4),
        'atr': round(atr, 4),
        'atr_multiplier': multiplier,
        'capped': capped,
        'method': 'ATR-based dynamic',
        'reason': f'وقف ديناميكي بناءً على ATR ({atr:.4f}) × {multiplier} — {"محدود" if capped else "حر"}',
    }


# ==================== DYNAMIC TARGETS (ATR-Based) ====================

def calculate_dynamic_targets(
    entry_price: float,
    stop_price: float,
    closes: List[float] = None,
    highs: List[float] = None,
    lows: List[float] = None,
    atr: float = None,
    atr_period: int = 14,
    min_rr: float = 1.5,
    max_targets: int = 3,
    regime: str = 'ranging',
) -> Dict:
    """
    حساب أهداف ربح ديناميكية بناءً على ATR والتقلب
    بدل نسبة ثابتة — الأهداف بتتغير حسب تقلب السهم وحجم حركته

    Args:
        entry_price: سعر الدخول
        stop_price: سعر وقف الخسارة (يحسب R:R من المسافة الفعلية)
        closes: قائمة أسعار الإغلاق الأخيرة
        highs: قائمة أعلى الأسعار الأخيرة
        lows: قائمة أدنى الأسعار الأخيرة
        atr: قيمة ATR الحالية (لو متاحة مسبقاً)
        atr_period: فترة حساب ATR
        min_rr: أقل نسبة R:R مقبولة
        max_targets: عدد الأهداف
        regime: حالة السوق (bull/bear/ranging)

    Returns:
        أهداف ربح ديناميكية مع تفاصيل
    """
    # حساب ATR لو مش متوفر
    if atr is None or atr <= 0:
        if highs and lows and len(highs) >= atr_period and len(lows) >= atr_period:
            atr_values = []
            for i in range(1, min(atr_period + 1, len(highs))):
                tr = max(
                    highs[-i] - lows[-i],
                    abs(highs[-i] - closes[-i - 1]) if i < len(closes) else highs[-i] - lows[-i],
                    abs(lows[-i] - closes[-i - 1]) if i < len(closes) else lows[-i] - highs[-i],
                )
                atr_values.append(tr)
            if atr_values:
                atr = sum(atr_values) / len(atr_values)
        elif closes and len(closes) >= 2:
            recent_range = max(closes[-5:]) - min(closes[-5:]) if len(closes) >= 5 else entry_price * 0.02
            atr = recent_range / 2
        else:
            atr = entry_price * 0.02

    # مسافة المخاطرة الفعلية
    risk_distance = entry_price - stop_price

    # مضاعفات ATR للأهداف (ديناميكية حسب R:R)
    # كل هدف = R × risk_distance حيث R يتغير بناءً على ATR
    # في سوق صاعد: أهداف أبعد (مضاعف أكبر)
    # في سوق هابط: أهداف أقرب (مضاعف أصغر)
    # في سوق متراوح: أهداف متوسطة
    regime_multipliers = {
        'bull': [1.5, 3.0, 5.0],
        'bear': [1.0, 1.5, 2.0],
        'ranging': [1.5, 2.5, 4.0],
    }
    multipliers = regime_multipliers.get(regime.lower(), regime_multipliers['ranging'])

    # تعديل المضاعفات بناءً على ATR (تقلب أعلى = أهداف أبعد)
    atr_pct = (atr / entry_price) * 100
    if atr_pct > 5:
        # تقلب عالي → أهداف أبعد قليلاً
        multipliers = [m * 1.2 for m in multipliers]
    elif atr_pct < 1.5:
        # تقلب منخفض → أهداف أقرب
        multipliers = [m * 0.8 for m in multipliers]

    targets = []
    sell_percentages = [50, 30, 20]

    for i in range(min(max_targets, len(multipliers))):
        ratio = multipliers[i]
        target_price = entry_price + (ratio * risk_distance)
        profit_percent = ((target_price - entry_price) / entry_price) * 100
        profit_amount = target_price - entry_price
        rr = ratio  # R:R = target_distance / risk_distance = ratio

        targets.append({
            'target_number': i + 1,
            'price': round(target_price, 4),
            'profit_percent': round(profit_percent, 2),
            'profit_amount': round(profit_amount, 4),
            'risk_reward_ratio': round(rr, 2),
            'sell_percent': sell_percentages[i] if i < len(sell_percentages) else 100 // (i + 1),
            'action': f"بيع {sell_percentages[i] if i < len(sell_percentages) else 100 // (i + 1)}% من الصفقة",
            'atr_based': True,
        })

    return {
        'entry_price': entry_price,
        'stop_price': stop_price,
        'risk_distance': round(risk_distance, 4),
        'atr': round(atr, 4),
        'atr_pct': round(atr_pct, 2),
        'targets': targets,
        'regime': regime,
        'regime_multipliers': multipliers,
        'summary': {
            'best_case': f"لو وصلت كل الأهداف: ربح {round(((targets[-1]['price'] - entry_price) / entry_price) * 100, 2)}%" if targets else "بدون أهداف",
            'conservative': f"لو وصلت الهدف الأول بس: ربح {round(targets[0]['profit_percent'], 2)}%" if targets else "بدون أهداف",
        }
    }


# ==================== DYNAMIC TRAILING STOP (Price-Following) ====================

def calculate_dynamic_trailing_stop(
    entry_price: float,
    current_price: float,
    highest_price: float = None,
    closes: List[float] = None,
    highs: List[float] = None,
    lows: List[float] = None,
    atr: float = None,
    atr_period: int = 14,
    trailing_pct: float = None,
    method: str = 'atr',
) -> Dict:
    """
    حساب وقف خسارة متحرك ديناميكي يتبع حركة السعر
    — بيرتغير كل ما السعر يتحرك (مش نسبة ثابتة)

    Args:
        entry_price: سعر الدخول
        current_price: السعر الحالي
        highest_price: أعلى سعر وصله السهم من وقت الدخول
        closes: قائمة أسعار الإغلاق الأخيرة
        highs: قائمة أعلى الأسعار الأخيرة
        lows: قائمة أدنى الأسعار الأخيرة
        atr: قيمة ATR الحالية
        atr_period: فترة حساب ATR
        trailing_pct: نسبة التتبع (لو مطلوبة بدل ATR)
        method: 'atr' أو 'percentage' أو 'chandelier'

    Returns:
        وقف متحرك ديناميكي مع التفاصيل
    """
    if highest_price is None or highest_price < current_price:
        highest_price = current_price

    # حساب ATR لو مش متوفر
    if atr is None or atr <= 0:
        if highs and lows and len(highs) >= atr_period and len(lows) >= atr_period:
            atr_values = []
            for i in range(1, min(atr_period + 1, len(highs))):
                tr = max(
                    highs[-i] - lows[-i],
                    abs(highs[-i] - (closes[-i - 1] if i < len(closes) else lows[-i])),
                    abs(lows[-i] - (closes[-i - 1] if i < len(closes) else highs[-i])),
                )
                atr_values.append(tr)
            if atr_values:
                atr = sum(atr_values) / len(atr_values)
        elif closes and len(closes) >= 2:
            recent_range = max(closes[-5:]) - min(closes[-5:]) if len(closes) >= 5 else current_price * 0.02
            atr = recent_range / 2
        else:
            atr = current_price * 0.02

    if method == 'atr':
        # ATR-based trailing: stop = highest_high - (multiplier × ATR)
        # المضاعف 3x للمستثمر (أوسع، بيسمح للسهم يتحرك أكتر)
        trailing_distance = 3.0 * atr
        new_stop = highest_price - trailing_distance

        # لا ينزل الوقف تحت نقطة الدخول أبداً
        if new_stop < entry_price:
            new_stop = entry_price * 1.01  # Breakeven + 1%

    elif method == 'percentage':
        # Percentage-based trailing: stop = highest_price × (1 - trailing_pct/100)
        pct = trailing_pct or 5.0
        new_stop = highest_price * (1 - pct / 100)

        # لا ينزل الوقف تحت نقطة الدخول
        if new_stop < entry_price:
            new_stop = entry_price * 1.01

    elif method == 'chandelier':
        # Chandelier Exit: stop = highest_high - (3 × ATR)
        # نفس ATR method بس باسم مختلف للوضوح
        trailing_distance = 3.0 * atr
        new_stop = highest_price - trailing_distance
        if new_stop < entry_price:
            new_stop = entry_price * 1.01

    else:
        # Default: ATR-based
        trailing_distance = 3.0 * atr
        new_stop = highest_price - trailing_distance
        if new_stop < entry_price:
            new_stop = entry_price * 1.01

    # التأكد إن الوقف فوق السعر الحالي (لو السهم نزل للوقف، يتفعل)
    stop_triggered = current_price <= new_stop

    # الربح المحمي
    protected_profit_pct = ((new_stop - entry_price) / entry_price) * 100

    return {
        'entry_price': entry_price,
        'current_price': current_price,
        'highest_price': round(highest_price, 4),
        'stop_price': round(new_stop, 4),
        'stop_method': method,
        'atr': round(atr, 4),
        'trailing_distance': round(trailing_distance, 4),
        'protected_profit_pct': round(protected_profit_pct, 2),
        'stop_triggered': stop_triggered,
        'message': (
            f"الوقف المتحرك الديناميكي: {round(new_stop, 4)} "
            f"(أعلى قمة: {round(highest_price, 4)} - {3.0}× ATR: {round(trailing_distance, 4)})"
            f" — الربح المحمي: {round(protected_profit_pct, 2)}%"
        ),
        'action': 'اخرج فوراً' if stop_triggered else 'استمر — الوقف بيتحرك مع السهم',
    }


# ==================== DYNAMIC R:R CALCULATOR ====================

def calculate_dynamic_rr(
    entry_price: float,
    current_price: float,
    stop_price: float,
    target_price: float,
) -> Dict:
    """
    حساب R:R ديناميكي بناءً على الأسعار الحالية
    — بيحسب R:R الحقيقي وقت التقييم مش وقت الدخول

    Args:
        entry_price: سعر الدخول الأصلي
        current_price: السعر الحالي
        stop_price: وقف الخسارة الحالي (ممكن يكون متحرك)
        target_price: الهدف الحالي

    Returns:
        R:R ديناميكي مع التقييم
    """
    risk = current_price - stop_price
    reward = target_price - current_price

    if risk <= 0:
        return {
            'risk_reward_ratio': 0,
            'risk_amount': 0,
            'reward_amount': 0,
            'verdict': get_rr_verdict(0),
            'message': 'الوقف فوق السعر الحالي — الصفقة في خسارة',
        }

    rr = reward / risk

    return {
        'risk_reward_ratio': round(rr, 2),
        'risk_amount': round(risk, 4),
        'reward_amount': round(reward, 4),
        'risk_pct': round((risk / current_price) * 100, 2),
        'reward_pct': round((reward / current_price) * 100, 2),
        'verdict': get_rr_verdict(rr),
        'message': f'R:R = {rr:.2f}:1 — {"ممتاز" if rr >= 3 else "جيد" if rr >= 2 else "مقبول" if rr >= 1.5 else "ضعيف" if rr >= 1 else "ممنوع"}',
    }


# ==================== TRAILING STOP EXPLANATION ====================
# نظام "لا تبيع في القاع" - توضيح إن الوقف المتحرك بيصعد بس مش بينزل

def explain_trailing_stop(
    entry_price: float,
    current_price: float,
    current_stop: float
) -> Dict:
    """
    يوضح للمستخدم إزاي الـ Trailing Stop بيتحرك:
        - الوقف بيتحرك لأعلى بس (لما السعر يطلع)
        - والوقف ما بينزلش لما السعر ينزل
        - عشان كده متخافش تبيع في القاع

    المخرجات:
        moves_only_up, rule, example, locked_profit_pct
    """
    locked_profit_pct = round(((current_stop - entry_price) / entry_price) * 100, 2) if entry_price > 0 else 0
    return {
        'moves_only_up': True,
        'rule': 'الوقف المتحرك بيصعد مع السعر لفوق بس - وما بينزلش لما السعر ينزل',
        'current_stop': round(current_stop, 4),
        'locked_profit_pct': locked_profit_pct,
        'example': (
            f"لو السهم طلع لـ {current_price:.2f} والوقف عند {current_stop:.2f}، "
            f"ولو نزل السهم لـ {current_price * 0.9:.2f} يفضل الوقف {current_stop:.2f} "
            f"(ما بينزلش) - يعني محمي بـ {locked_profit_pct:.1f}% ربح"
        ),
    }
