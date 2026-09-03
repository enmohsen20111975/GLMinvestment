"""
circuit_breaker.py — Circuit Breaker للـ backtest (EGX-STRATEGY)
==================================================================
EGX-STRATEGY (2026-08-30): circuit breaker يوقف التداول بعد 3 خسائر متتالية.

المطلوب من المالك:
  "بعد 3 خسائر متتالية → وقف التداول لفترة (مثلاً 3-5 أيام تداول أو تقليل
   الحجم لـ 50%)."

المنطق:
  - نراقب الـ trades بالترتيب الزمني.
  - لو 3 خسائر متتالية → circuit_breaker_active = True.
  - لمدة cooldown_days (default=3) → نتخطى أي صفقة جديدة (أو نقلل حجمها 50%).
  - بعد cooldown_days → نرجع للتداول العادي + reset consecutive_losses.

الاستخدام:
  from utils.circuit_breaker import CircuitBreaker

  cb = CircuitBreaker()
  for trade in sorted_trades:
      if cb.is_blocked(trade['date']):
          continue  # skip
      # ... execute trade ...
      cb.record_trade(trade['date'], trade['return'])
"""
from __future__ import annotations
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta


# ─── العتبات ────────────────────────────────────────────────────────────────
CONSECUTIVE_LOSSES_LIMIT = 3      # 3 خسائر متتالية → circuit breaker
COOLDOWN_DAYS = 3                  # 3 أيام تداول وقف
REDUCED_SIZE_MULT = 0.5            # تقليل الحجم 50% (لو mode=reduce)


class CircuitBreaker:
    """Circuit breaker للـ backtest — يوقف التداول بعد 3 خسائر متتالية.

    States:
      - NORMAL: التداول العادي.
      - COOLDOWN: وقف التداول لمدة cooldown_days بعد 3 خسائر متتالية.
      - REDUCED: (optional) تقليل الحجم 50% بدل الوقف الكامل.
    """

    def __init__(
        self,
        consecutive_losses_limit: int = CONSECUTIVE_LOSSES_LIMIT,
        cooldown_days: int = COOLDOWN_DAYS,
        mode: str = 'block',  # 'block' أو 'reduce'
        reduced_size_mult: float = REDUCED_SIZE_MULT,
    ):
        self.consecutive_losses_limit = consecutive_losses_limit
        self.cooldown_days = cooldown_days
        self.mode = mode
        self.reduced_size_mult = reduced_size_mult

        # State
        self.consecutive_losses = 0
        self.blocked_until_date: Optional[str] = None  # YYYY-MM-DD
        self.total_blocks = 0
        self.total_reductions = 0
        self.trades_skipped = 0

    def _parse_date(self, date_str: str) -> Optional[datetime]:
        """Parse YYYY-MM-DD."""
        if not date_str:
            return None
        try:
            return datetime.strptime(date_str[:10], '%Y-%m-%d')
        except (ValueError, TypeError):
            return None

    def is_blocked(self, trade_date: str) -> bool:
        """هل التداول محظور في هذا التاريخ؟"""
        if not self.blocked_until_date:
            return False
        trade_dt = self._parse_date(trade_date)
        block_dt = self._parse_date(self.blocked_until_date)
        if not trade_dt or not block_dt:
            return False
        return trade_dt < block_dt

    def get_size_multiplier(self, trade_date: str) -> float:
        """رجّع multiplier لحجم المركز (1.0 = عادي، 0.5 = مقلل، 0.0 = محظور)."""
        if self.is_blocked(trade_date):
            if self.mode == 'block':
                self.trades_skipped += 1
                return 0.0
            elif self.mode == 'reduce':
                self.total_reductions += 1
                return self.reduced_size_mult
        return 1.0

    def record_trade(self, trade_date: str, trade_return: float) -> None:
        """سجّل نتيجة صفقة لتحديث الـ state."""
        # لو كنا في cooldown وانتهى → reset
        if self.blocked_until_date and not self.is_blocked(trade_date):
            self.blocked_until_date = None
            self.consecutive_losses = 0

        # تحديث consecutive_losses
        if trade_return <= 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0

        # لو وصلنا للحد → فعّل cooldown
        if self.consecutive_losses >= self.consecutive_losses_limit and not self.blocked_until_date:
            trade_dt = self._parse_date(trade_date)
            if trade_dt:
                block_dt = trade_dt + timedelta(days=self.cooldown_days)
                self.blocked_until_date = block_dt.strftime('%Y-%m-%d')
                self.total_blocks += 1
                self.consecutive_losses = 0  # reset بعد التفعيل

    def get_stats(self) -> Dict[str, Any]:
        """إحصائيات الـ circuit breaker."""
        return {
            'total_blocks': self.total_blocks,
            'total_reductions': self.total_reductions,
            'trades_skipped': self.trades_skipped,
            'current_consecutive_losses': self.consecutive_losses,
            'currently_blocked': self.blocked_until_date is not None,
            'blocked_until': self.blocked_until_date,
            'mode': self.mode,
            'cooldown_days': self.cooldown_days,
        }


def apply_circuit_breaker_to_trades(
    trades: List[Dict[str, Any]],
    mode: str = 'block',
    cooldown_days: int = COOLDOWN_DAYS,
    consecutive_limit: int = CONSECUTIVE_LOSSES_LIMIT,
) -> Dict[str, Any]:
    """طبّق circuit breaker على قائمة trades (للـ backtest).

    Args:
        trades: قائمة trades مرتبة زمنياً (كل trade فيه 'date' و 'return').
        mode: 'block' (skip) أو 'reduce' (تقليل حجم 50%).
        cooldown_days: مدة الوقف.
        consecutive_limit: عدد الخسائر المتتالية اللي بتفعّل الـ breaker.

    Returns:
        {
            'executed_trades': List[Dict],  # الصفقات اللي اتنفذت
            'skipped_trades': List[Dict],   # الصفقات اللي اتحذفت
            'stats': Dict,
        }
    """
    cb = CircuitBreaker(
        consecutive_losses_limit=consecutive_limit,
        cooldown_days=cooldown_days,
        mode=mode,
    )

    executed = []
    skipped = []

    for trade in sorted(trades, key=lambda x: x.get('date', '')):
        trade_date = trade.get('date', '')
        mult = cb.get_size_multiplier(trade_date)

        if mult == 0.0:
            # محظور → skip
            skipped.append(trade)
            continue

        # تعديل الـ return حسب الـ multiplier (لو reduce)
        if mult < 1.0:
            trade = {**trade, 'return': trade['return'] * mult}

        executed.append(trade)
        cb.record_trade(trade_date, trade['return'])

    return {
        'executed_trades': executed,
        'skipped_trades': skipped,
        'stats': cb.get_stats(),
    }
