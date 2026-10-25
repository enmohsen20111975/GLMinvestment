"""
Hard Protections Engine
========================
محرك الحماية الصلبة — الطبقة الأولى: الحماية غير المرئية

بناءً على محضر الاجتماع 2026-05-23

الحماية الصلبة (Hard Protections):
- Max 15% في سهم واحد → قفل تلقائي
- Daily Loss > 5% → قفل 24 ساعة
- 3 خساير متتالية → قفل 72 ساعة
- VIX > 40 → Blackout
- CBE Decision في 48h → Pause

اللغة: دائماً "اقتراح" — مش "أمر". بس النظام يفرض ورا الكواليس.

POSITION-SIZING-024 — T+2 Settlement:
- دالة calculate_available_cash(user_id) تحسب السيولة المتاحة فعلياً
- أي عملية بيع تُسجّل في pending_settlements وتُخصم من السيولة المتاحة فوراً
- ولا تُضاف للسيولة المتاحة للشراء إلا بعد يومين (T+2)
- المعادلة: available = cash - pending_buys + pending_sells_settled
- pending_sells_settled = عمليات البيع التي مر عليها يومين أو أكثر
"""

from dataclasses import dataclass, field
from typing import Optional, List, Dict, Literal, Tuple
from datetime import datetime, timedelta
from enum import Enum
import json
import os
import sqlite3
import logging

logger = logging.getLogger(__name__)

# T+2 Settlement days (Business day convention: 2 calendar days is a common
# simplification for EGX retail — change here if CBE rules require B+2 strictly)
T2_SETTLEMENT_DAYS = 2

# Path to stocks.db (project-root / db / stocks.db)
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STOCKS_DB_PATH = os.environ.get(
    'STOCKS_DB_PATH',
    os.path.join(_PROJECT_ROOT, 'db', 'stocks.db'),
)

# Path to predictions.db (used by portfolio_routes for portfolio_state cash)
PREDICTIONS_DB_PATH = os.environ.get(
    'PREDICTIONS_DB_PATH',
    os.path.join(_PROJECT_ROOT, 'db', 'predictions.db'),
)


_PENDING_SETTLEMENTS_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS pending_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    ticker TEXT,
    side TEXT NOT NULL,                  -- 'buy' | 'sell'
    quantity REAL NOT NULL DEFAULT 0,
    price REAL NOT NULL DEFAULT 0,
    value REAL NOT NULL DEFAULT 0,        -- quantity * price
    trade_date TEXT NOT NULL,             -- ISO timestamp when trade executed
    settle_date TEXT NOT NULL,            -- trade_date + T2_SETTLEMENT_DAYS
    settled INTEGER NOT NULL DEFAULT 0,   -- 0 = pending, 1 = settled (auto-flagged after T+2)
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ps_user_side_settled ON pending_settlements(user_id, side, settled);
CREATE INDEX IF NOT EXISTS idx_ps_user_trade_date ON pending_settlements(user_id, trade_date);
"""


def _ensure_pending_settlements_schema(conn: sqlite3.Connection):
    """ضمان وجود جدول pending_settlements في stocks.db"""
    try:
        conn.executescript(_PENDING_SETTLEMENTS_SCHEMA_SQL)
        conn.commit()
    except sqlite3.Error as e:
        logger.error("فشل إنشاء schema pending_settlements: %s", e)


def _get_stocks_conn() -> sqlite3.Connection:
    """فتح اتصال بـ stocks.db"""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(STOCKS_DB_PATH, writable=False)
    conn.row_factory = sqlite3.Row
    return conn


def _get_predictions_conn() -> sqlite3.Connection:
    """فتح اتصال بـ predictions.db (يحتوي portfolio_state.cash)"""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(PREDICTIONS_DB_PATH, writable=False)
    conn.row_factory = sqlite3.Row
    return conn


def _get_cash_balance(user_id: str) -> float:
    """قراءة رصيد الكاش للمستخدم من predictions.db (portfolio_state) أو
    من portfolio_assets (لو نوع asset = 'cash'). fallback = 30000.
    """
    # 1) حاول predictions.db → portfolio_state.cash (آخر محفظة لليوزر)
    try:
        if os.path.exists(PREDICTIONS_DB_PATH):
            conn = _get_predictions_conn()
            row = conn.execute(
                "SELECT cash FROM portfolio_state WHERE user_id=? ORDER BY updated_at DESC LIMIT 1",
                (user_id,),
            ).fetchone()
            conn.close()
            if row and row['cash'] is not None:
                return float(row['cash'])
    except sqlite3.Error as e:
        logger.warning("calculate_available_cash: فشل قراءة portfolio_state.cash: %s", e)

    # 2) fallback: stocks.db → portfolio_assets (لو فيه type='cash')
    try:
        if os.path.exists(STOCKS_DB_PATH):
            conn = _get_stocks_conn()
            row = conn.execute(
                "SELECT SUM(current_value) as total FROM portfolio_assets WHERE user_id=? AND type='cash'",
                (user_id,),
            ).fetchone()
            conn.close()
            if row and row['total'] is not None and float(row['total']) > 0:
                return float(row['total'])
    except sqlite3.Error as e:
        logger.warning("calculate_available_cash: فشل قراءة portfolio_assets cash: %s", e)

    # 3) default
    return 30000.0


def _get_portfolio_value(user_id: str) -> float:
    """قراءة إجمالي قيمة المحفظة للمستخدم (cash + investments).

    المصادر بالترتيب:
      1. predictions.db → portfolio_state.value (آخر محفظة لليوزر)
      2. stocks.db → SUM(portfolio_assets.current_value) (لو فيه assets)
      3. default = 100000
    """
    # 1) predictions.db → portfolio_state.value
    try:
        if os.path.exists(PREDICTIONS_DB_PATH):
            conn = _get_predictions_conn()
            row = conn.execute(
                "SELECT value FROM portfolio_state WHERE user_id=? ORDER BY updated_at DESC LIMIT 1",
                (user_id,),
            ).fetchone()
            conn.close()
            if row and row['value'] is not None and float(row['value']) > 0:
                return float(row['value'])
    except sqlite3.Error as e:
        logger.warning("calculate_available_cash: فشل قراءة portfolio_state.value: %s", e)

    # 2) fallback: stocks.db → SUM(portfolio_assets.current_value)
    try:
        if os.path.exists(STOCKS_DB_PATH):
            conn = _get_stocks_conn()
            row = conn.execute(
                "SELECT COALESCE(SUM(current_value), 0) as total FROM portfolio_assets WHERE user_id=?",
                (user_id,),
            ).fetchone()
            conn.close()
            if row and row['total'] is not None and float(row['total']) > 0:
                return float(row['total'])
    except sqlite3.Error as e:
        logger.warning("calculate_available_cash: فشل قراءة portfolio_assets total: %s", e)

    # 3) default
    return 100000.0


def _settle_old_trades(conn: sqlite3.Connection, user_id: str):
    """تعليم الصفوف القديمة (>= T+2) كـ settled=1.
    نحدّث rows اللي side='sell' أو 'buy' اللي مر عليها T2_SETTLEMENT_DAYS.
    """
    cutoff_iso = (datetime.now() - timedelta(days=T2_SETTLEMENT_DAYS)).isoformat()
    try:
        conn.execute(
            "UPDATE pending_settlements SET settled=1 WHERE user_id=? AND settled=0 AND trade_date <= ?",
            (user_id, cutoff_iso),
        )
        conn.commit()
    except sqlite3.Error as e:
        logger.warning("calculate_available_cash: فشل settle_old_trades: %s", e)


def record_pending_trade(
    user_id: str,
    side: Literal['buy', 'sell'],
    ticker: str,
    quantity: float,
    price: float,
    trade_date: Optional[datetime] = None,
    notes: str = '',
) -> int:
    """تسجيل صفقة (شراء/بيع) في pending_settlements.

    Returns:
        int — id الصف الجديد، أو -1 لو فشل.
    """
    if side not in ('buy', 'sell'):
        raise ValueError(f"side must be 'buy' or 'sell', got: {side}")

    trade_dt = trade_date or datetime.now()
    value = float(quantity) * float(price)
    settle_dt = trade_dt + timedelta(days=T2_SETTLEMENT_DAYS)

    try:
        conn = _get_stocks_conn()
        _ensure_pending_settlements_schema(conn)
        cur = conn.execute(
            """INSERT INTO pending_settlements
               (user_id, ticker, side, quantity, price, value,
                trade_date, settle_date, settled, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)""",
            (user_id, ticker, side, float(quantity), float(price), value,
             trade_dt.isoformat(), settle_dt.isoformat(), notes),
        )
        conn.commit()
        row_id = cur.lastrowid or -1
        conn.close()
        return row_id
    except sqlite3.Error as e:
        logger.error("record_pending_trade failed: %s", e)
        return -1


def list_pending_settlements(user_id: str, only_unsettled: bool = False) -> List[Dict]:
    """قائمة التسويات المعلّقة للمستخدم (مرتبة من الأقدم للأحدث)."""
    try:
        conn = _get_stocks_conn()
        _ensure_pending_settlements_schema(conn)
        if only_unsettled:
            rows = conn.execute(
                """SELECT * FROM pending_settlements
                   WHERE user_id=? AND settled=0
                   ORDER BY trade_date ASC""",
                (user_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM pending_settlements
                   WHERE user_id=?
                   ORDER BY trade_date DESC, id DESC
                   LIMIT 200""",
                (user_id,),
            ).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except sqlite3.Error as e:
        logger.error("list_pending_settlements failed: %s", e)
        return []


def calculate_available_cash(user_id: str) -> Dict:
    """حساب السيولة المتاحة فعلياً مع مراعاة تسوية T+2.

    المعادلة:
        available = cash - pending_buys + pending_sells_settled

    حيث:
        cash                  — رصيد الكاش الحالي (من portfolio_state أو portfolio_assets)
        pending_buys          — إجمالي قيمة عمليات شراء لم تُسوَّ بعد (أحدث من T+2)
        pending_sells_settled — إجمالي قيمة عمليات بيع مر عليها يومين أو أكثر (settled=1)

    أي عملية بيع تُخصم من السيولة المتاحة فوراً (لأنها مُسجّلة كـ settled=0
    في البداية، ولا تنتقل لـ settled=1 إلا بعد T+2 يوم).

    Returns:
        dict {
            'cash': float,
            'pending_buys': float,
            'pending_sells_settled': float,
            'pending_sells_unsettled': float,
            'available_cash': float,
            'portfolio_value': float,      — إجمالي قيمة المحفظة (cash + investments)
            'settlement_days': int,
            't2_date': str,                — أقرب تاريخ تسوية قادم
            'user_id': str,
        }
    """
    # 1) تأكد من وجود الجدول + سجّل التسويات القديمة كـ settled
    try:
        conn = _get_stocks_conn()
        _ensure_pending_settlements_schema(conn)
        _settle_old_trades(conn, user_id)

        # 2) pending_buys = عمليات شراء لم تُسوَّ بعد (settled=0)
        #    هذه تمثّل كاش محجوز لكنه لم يُخصم رسمياً بعد من رصيد الكاش
        row = conn.execute(
            "SELECT COALESCE(SUM(value), 0) AS total FROM pending_settlements WHERE user_id=? AND side='buy' AND settled=0",
            (user_id,),
        ).fetchone()
        pending_buys = float(row['total']) if row else 0.0

        # 3) pending_sells_settled = عمليات بيع مر عليها T+2 (settled=1)
        #    كاش من بيوعات تم تسويتها ولم يُضاف بعد لرصيد الكاش الرسمي
        row = conn.execute(
            "SELECT COALESCE(SUM(value), 0) AS total FROM pending_settlements WHERE user_id=? AND side='sell' AND settled=1",
            (user_id,),
        ).fetchone()
        pending_sells_settled = float(row['total']) if row else 0.0

        # 4) pending_sells_unsettled = عمليات بيع داخل نافذة T+2 (settled=0)
        #    هذه تُخصم من السيولة المتاحة فوراً (لأن الكاش منها لسه غير متاح)
        row = conn.execute(
            "SELECT COALESCE(SUM(value), 0) AS total FROM pending_settlements WHERE user_id=? AND side='sell' AND settled=0",
            (user_id,),
        ).fetchone()
        pending_sells_unsettled = float(row['total']) if row else 0.0

        # 5) أقرب تاريخ تسوية قادم (لأقرب بيع غير مُسوّى)
        row = conn.execute(
            "SELECT settle_date FROM pending_settlements WHERE user_id=? AND settled=0 ORDER BY settle_date ASC LIMIT 1",
            (user_id,),
        ).fetchone()
        t2_date = row['settle_date'] if row else None

        conn.close()
    except sqlite3.Error as e:
        logger.error("calculate_available_cash failed: %s", e)
        pending_buys = 0.0
        pending_sells_settled = 0.0
        pending_sells_unsettled = 0.0
        t2_date = None

    # 6) اقرأ رصيد الكاش + قيمة المحفظة (بعد إغلاق conn الـ stocks)
    cash = _get_cash_balance(user_id)
    portfolio_value = _get_portfolio_value(user_id)

    # 7) المعادلة: available = cash - pending_buys + pending_sells_settled
    #    ملاحظة: pending_sells_unsettled هي بالفعل غير مُضافة لـ cash (لأنها لسه
    #    غير مُسوّاة)، فمش محتاجين نطرحها تاني.
    available = cash - pending_buys + pending_sells_settled

    return {
        'user_id': user_id,
        'cash': round(cash, 2),
        'pending_buys': round(pending_buys, 2),
        'pending_sells_settled': round(pending_sells_settled, 2),
        'pending_sells_unsettled': round(pending_sells_unsettled, 2),
        'available_cash': round(available, 2),
        'portfolio_value': round(portfolio_value, 2),
        'settlement_days': T2_SETTLEMENT_DAYS,
        't2_date': t2_date,
    }


class ProtectionType(str, Enum):
    """أنواع الحماية"""
    MAX_POSITION = "max_position"           # حد أقصى للمركز
    DAILY_LOSS = "daily_loss"               # حد الخسارة اليومي
    CONSECUTIVE_LOSSES = "consecutive_losses"  # خساير متتالية
    VIX_BLACKOUT = "vix_blackout"           # انهيار السوق
    CBE_DECISION = "cbe_decision"           # قرار البنك المركزي
    PERSONA_LOCK = "persona_lock"           # قفل الشخصية


class ProtectionSeverity(str, Enum):
    """شدة الحماية"""
    WARNING = "warning"       # تحذير — يقدر يكمل
    SOFT_LOCK = "soft_lock"   # قفل ناعم — يقدر يعدّل
    HARD_LOCK = "hard_lock"   # قفل صلب — ما يقدرش يكمل


@dataclass
class ProtectionResult:
    """نتيجة فحص الحماية"""
    passed: bool
    protection_type: Optional[ProtectionType]
    severity: ProtectionSeverity
    message_ar: str
    message_en: str
    action_required: str
    lock_until: Optional[datetime] = None
    details: Dict = field(default_factory=dict)
    
    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "protection_type": self.protection_type.value if self.protection_type else None,
            "severity": self.severity.value,
            "message_ar": self.message_ar,
            "message_en": self.message_en,
            "action_required": self.action_required,
            "lock_until": self.lock_until.isoformat() if self.lock_until else None,
            "details": self.details
        }


@dataclass
class UserTradingState:
    """حالة تداول المستخدم"""
    user_id: str
    persona: str = "balanced"
    
    # تتبع الخساير
    daily_pnl: float = 0.0
    daily_pnl_percent: float = 0.0
    consecutive_losses: int = 0
    last_trade_result: Optional[str] = None
    
    # تتبع المراكز
    positions: Dict[str, float] = field(default_factory=dict)  # ticker -> percent
    total_capital: float = 100000.0
    
    # أقفال
    locked_until: Optional[datetime] = None
    lock_reason: Optional[str] = None
    
    # تواريخ
    last_trade_date: Optional[datetime] = None
    persona_set_at: datetime = field(default_factory=datetime.now)
    
    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "persona": self.persona,
            "daily_pnl": self.daily_pnl,
            "daily_pnl_percent": self.daily_pnl_percent,
            "consecutive_losses": self.consecutive_losses,
            "last_trade_result": self.last_trade_result,
            "positions": self.positions,
            "total_capital": self.total_capital,
            "locked_until": self.locked_until.isoformat() if self.locked_until else None,
            "lock_reason": self.lock_reason,
            "last_trade_date": self.last_trade_date.isoformat() if self.last_trade_date else None,
            "persona_set_at": self.persona_set_at.isoformat()
        }


class HardProtectionEngine:
    """محرك الحماية الصلبة"""
    
    # حدود الحماية من المحضر
    MAX_POSITION_PERCENT = 15.0      # أقصى 15% في سهم واحد
    DAILY_LOSS_LIMIT_PERCENT = 5.0   # خسارة يومية أقصاها 5%
    CONSECUTIVE_LOSSES_LIMIT = 3     # 3 خساير متتالية
    VIX_BLACKOUT_THRESHOLD = 40      # VIX > 40 = blackout
    PERSONA_LOCK_DAYS = 30           # تغيير الشخصية كل 30 يوم
    
    def __init__(self):
        self.user_states: Dict[str, UserTradingState] = {}
        self.cbe_events: List[Dict] = []  # أحداث البنك المركزي
        self.current_vix: float = 20.0
    
    # ==================== فحوصات الحماية ====================
    
    def check_all_protections(
        self,
        user_id: str,
        ticker: str,
        trade_value_percent: float,
        current_vix: Optional[float] = None
    ) -> ProtectionResult:
        """
        فحص كل الحمايات قبل تنفيذ صفقة
        
        الترتيب مهم:
        1. قفل المستخدم
        2. VIX Blackout
        3. CBE Decision
        4. Daily Loss
        5. Consecutive Losses
        6. Max Position
        """
        state = self._get_or_create_state(user_id)
        
        # 1. فحص قفل المستخدم
        if state.locked_until and datetime.now() < state.locked_until:
            return ProtectionResult(
                passed=False,
                protection_type=ProtectionType.CONSECUTIVE_LOSSES if state.lock_reason == "consecutive_losses" else ProtectionType.DAILY_LOSS,
                severity=ProtectionSeverity.HARD_LOCK,
                message_ar=f"حسابك مقفل حتى {state.locked_until.strftime('%H:%M')} — {state.lock_reason}",
                message_en=f"Account locked until {state.locked_until.strftime('%H:%M')} — {state.lock_reason}",
                action_required="wait",
                lock_until=state.locked_until
            )
        
        # 2. فحص VIX
        vix = current_vix or self.current_vix
        if vix > self.VIX_BLACKOUT_THRESHOLD:
            return ProtectionResult(
                passed=False,
                protection_type=ProtectionType.VIX_BLACKOUT,
                severity=ProtectionSeverity.HARD_LOCK,
                message_ar="السوق حذر — لا توقعات اليوم",
                message_en="Market caution — no recommendations today",
                action_required="blackout",
                details={"vix": vix, "threshold": self.VIX_BLACKOUT_THRESHOLD}
            )
        
        # 3. فحص CBE Decision
        cbe_check = self._check_cbe_events()
        if not cbe_check.passed:
            return cbe_check
        
        # 4. فحص Daily Loss
        if state.daily_pnl_percent <= -self.DAILY_LOSS_LIMIT_PERCENT:
            lock_until = datetime.now() + timedelta(hours=24)
            state.locked_until = lock_until
            state.lock_reason = "daily_loss"
            
            return ProtectionResult(
                passed=False,
                protection_type=ProtectionType.DAILY_LOSS,
                severity=ProtectionSeverity.HARD_LOCK,
                message_ar="حان وقت المراجعة — استراحة مقترحة 24 ساعة",
                message_en="Time for review — 24 hour break suggested",
                action_required="lock_24h",
                lock_until=lock_until,
                details={"daily_loss_percent": state.daily_pnl_percent}
            )
        
        # 5. فحص Consecutive Losses
        if state.consecutive_losses >= self.CONSECUTIVE_LOSSES_LIMIT:
            lock_until = datetime.now() + timedelta(hours=72)
            state.locked_until = lock_until
            state.lock_reason = "consecutive_losses"
            
            return ProtectionResult(
                passed=False,
                protection_type=ProtectionType.CONSECUTIVE_LOSSES,
                severity=ProtectionSeverity.HARD_LOCK,
                message_ar="قاعدة الـ 3: استراحة إجبارية للحماية 72 ساعة",
                message_en="Rule of 3: Mandatory 72-hour break for protection",
                action_required="lock_72h",
                lock_until=lock_until,
                details={"consecutive_losses": state.consecutive_losses}
            )
        
        # 6. فحص Max Position
        new_position_percent = state.positions.get(ticker, 0) + trade_value_percent
        if new_position_percent > self.MAX_POSITION_PERCENT:
            max_allowed = self.MAX_POSITION_PERCENT - state.positions.get(ticker, 0)
            return ProtectionResult(
                passed=False,
                protection_type=ProtectionType.MAX_POSITION,
                severity=ProtectionSeverity.SOFT_LOCK,
                message_ar=f"توقعة: 15% كحد أقصى للتنويع — يمكنك إضافة {max_allowed:.1f}% فقط",
                message_en=f"Recommendation: 15% max for diversification — you can add {max_allowed:.1f}% only",
                action_required="reduce_size",
                details={
                    "current_position": state.positions.get(ticker, 0),
                    "requested": trade_value_percent,
                    "max_allowed": max_allowed
                }
            )
        
        # كل الحمايات فحصت بنجاح
        return ProtectionResult(
            passed=True,
            protection_type=None,
            severity=ProtectionSeverity.WARNING,
            message_ar="تم التحقق — يمكنك المتابعة",
            message_en="Verified — you can proceed",
            action_required="proceed"
        )
    
    def check_persona_change(self, user_id: str, new_persona: str) -> ProtectionResult:
        """فحص تغيير الشخصية — ممنوع التغيير إلا كل 30 يوم"""
        state = self._get_or_create_state(user_id)
        
        days_since_change = (datetime.now() - state.persona_set_at).days
        
        if days_since_change < self.PERSONA_LOCK_DAYS:
            days_remaining = self.PERSONA_LOCK_DAYS - days_since_change
            return ProtectionResult(
                passed=False,
                protection_type=ProtectionType.PERSONA_LOCK,
                severity=ProtectionSeverity.SOFT_LOCK,
                message_ar=f"شخصيتك محددة — مراجعة بعد {days_remaining} يوم",
                message_en=f"Your persona is set — review in {days_remaining} days",
                action_required="wait",
                details={
                    "days_remaining": days_remaining,
                    "current_persona": state.persona
                }
            )
        
        return ProtectionResult(
            passed=True,
            protection_type=ProtectionType.PERSONA_LOCK,
            severity=ProtectionSeverity.WARNING,
            message_ar="يمكنك تغيير شخصيتك",
            message_en="You can change your persona",
            action_required="proceed"
        )
    
    # ==================== تحديث الحالة ====================
    
    def record_trade(
        self,
        user_id: str,
        ticker: str,
        result: Literal["profit", "loss"],
        pnl_percent: float,
        position_percent: float
    ):
        """تسجيل نتيجة صفقة"""
        state = self._get_or_create_state(user_id)
        
        # تحديث الخساير المتتالية
        if result == "loss":
            state.consecutive_losses += 1
            state.daily_pnl_percent -= abs(pnl_percent)
        else:
            state.consecutive_losses = 0
            state.daily_pnl_percent += pnl_percent
        
        state.last_trade_result = result
        state.last_trade_date = datetime.now()
        
        # تحديث المراكز
        if result == "profit" or result == "loss":
            if ticker in state.positions:
                state.positions[ticker] -= position_percent
                if state.positions[ticker] <= 0:
                    del state.positions[ticker]
    
    def add_position(self, user_id: str, ticker: str, percent: float):
        """إضافة مركز جديد"""
        state = self._get_or_create_state(user_id)
        state.positions[ticker] = state.positions.get(ticker, 0) + percent
    
    def reset_daily(self, user_id: str):
        """إعادة تعيين الخسارة اليومية (يتم استدعاؤها مع بداية يوم جديد)"""
        state = self._get_or_create_state(user_id)
        state.daily_pnl = 0.0
        state.daily_pnl_percent = 0.0
        
        # فك القفل لو خلص
        if state.locked_until and datetime.now() >= state.locked_until:
            state.locked_until = None
            state.lock_reason = None
    
    # ==================== أحداث الماكرو ====================
    
    def set_vix(self, vix: float):
        """تحديث قيمة VIX"""
        self.current_vix = vix
    
    def add_cbe_event(self, event_date: datetime, event_type: str, description: str):
        """إضافة حدث للبنك المركزي"""
        self.cbe_events.append({
            "date": event_date,
            "type": event_type,
            "description": description
        })
    
    def _check_cbe_events(self) -> ProtectionResult:
        """فحص أحداث البنك المركزي"""
        now = datetime.now()
        
        for event in self.cbe_events:
            event_date = event["date"]
            time_until = (event_date - now).total_seconds() / 3600  # hours
            
            # لو الحدث خلال 48 ساعة
            if 0 <= time_until <= 48:
                return ProtectionResult(
                    passed=False,
                    protection_type=ProtectionType.CBE_DECISION,
                    severity=ProtectionSeverity.HARD_LOCK,
                    message_ar="السوق ينتظر حدثاً — الانتظار أحكم",
                    message_en="Market awaits event — waiting is wiser",
                    action_required="pause",
                    details={
                        "event_type": event["type"],
                        "event_description": event["description"],
                        "hours_until": time_until
                    }
                )
        
        return ProtectionResult(
            passed=True,
            protection_type=None,
            severity=ProtectionSeverity.WARNING,
            message_ar="لا توجد أحداث حرجة",
            message_en="No critical events",
            action_required="proceed"
        )
    
    # ==================== مساعدات ====================
    
    def _get_or_create_state(self, user_id: str) -> UserTradingState:
        """الحصول على أو إنشاء حالة المستخدم"""
        if user_id not in self.user_states:
            self.user_states[user_id] = UserTradingState(user_id=user_id)
        return self.user_states[user_id]
    
    def get_user_state(self, user_id: str) -> Optional[dict]:
        """الحصول على حالة المستخدم"""
        if user_id in self.user_states:
            return self.user_states[user_id].to_dict()
        return None
    
    def get_all_locks(self) -> Dict[str, dict]:
        """الحصول على كل الأقفال النشطة"""
        locks = {}
        now = datetime.now()
        for user_id, state in self.user_states.items():
            if state.locked_until and now < state.locked_until:
                locks[user_id] = {
                    "locked_until": state.locked_until.isoformat(),
                    "reason": state.lock_reason
                }
        return locks


# إنشاء instance عام
hard_protection_engine = HardProtectionEngine()


__all__ = [
    'HardProtectionEngine', 'ProtectionType', 'ProtectionSeverity',
    'ProtectionResult', 'UserTradingState', 'hard_protection_engine',
    # POSITION-SIZING-024: T+2 Settlement helpers
    'calculate_available_cash', 'record_pending_trade',
    'list_pending_settlements', 'T2_SETTLEMENT_DAYS',
]
