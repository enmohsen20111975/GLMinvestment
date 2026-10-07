"""
backtest/strategy_backtester.py — محاكاة تاريخية للمحركات
=========================================================
المصدر: منهجية "Curtis Faith — Way of the Turtle" + معايير الصناعة
        (Van Tharp لـ R-multiples،凱利公式 لـ position sizing).

الهدف:
    لو المحركات بتشتغل، لازم تثبت إنها بتعمل فلوس على بيانات تاريخية.
    من غير backtest، إحنا بنخمّن. الـ backtester ده بيمشي بار ببار على
    OHLCV تاريخي، بيفتح صفقات على إشارات الـ Confluence، ويديرها بـ
    Take-Profit Tiers، ويخرج إحصائيات صارمة:
      - Win Rate (نسبة الصفقات الرابحة)
      - Avg R (متوسط الـ R-multiple — مقياس Van Tharp)
      - Profit Factor (مجموع الأرباح ÷ مجموع الخسائر)
      - Max Drawdown (أكبر هبوط في منحنى رأس المال)
      - Expectancy (المتوسط المتوقع لكل صفقة بالجنيه)

منطق المحاكاة:
    1. امشي بار ببار من بعد فترة التسخين (warmup = 210 يوم لـ Stage 2)
    2. في كل بار، شغّل Confluence Engine على البيانات لحد دلوقتي
    3. لو الإشارة BUY/STRONG_BUY ومفيش صفقة مفتوحة → افتح صفقة
       بالـ ATR risk plan (وقف + حجم + tiers)
    4. لو فيه صفقة مفتوحة → شغّل Take-Profit management:
       - وقف؟ خروج خسارة (-1R)
       - Tier 1/2؟ بيع جزئي
       - 3R؟ خروج نهائي (+3R)
       - trailing؟ حدّث الوقف
    5. سجّل كل صفقة (دخول/خروج/R/سبب) وحدّث منحنى رأس المال
    6. بعد ما تخلص، احسب الإحصائيات واطبع التقرير

ملاحظات تصميمية:
    - صفقة واحدة لكل symbol في أي لحظة (تجنّب تعقيد multi-position)
    - الدخول على إغلاق البار (واقعي للأسواق اليومية)
    - وقف الخسارة ينفّذ على low البار (لو low ≤ stop → خرج على stop)
    - لا يوجد slippage/commissions في النموذج الأساسي (يُضاف لاحقاً)
    - cooldown بعد كل خسارة (تجنّب revenge trading)

طريقة الاستخدام:
    from backtest.strategy_backtester import run_backtest, BacktestConfig
    result = run_backtest(df, symbol="COMI", config=BacktestConfig())
    print_report(result)

    # أو من CLI:
    python3 -m backtest.strategy_backtester data/COMI.csv --symbol COMI
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd

from ..core.base import SignalType, RiskPlan
from ..confluence.confluence_scorer import analyze as analyze_confluence, ConfluenceConfig
from ..engines.atr_risk_engine import compute_risk_plan, ATRRiskConfig
from ..engines.take_profit_tiers import (
    evaluate_position, position_from_risk_plan, TakeProfitConfig,
    PositionAction, Position,
)


# ──────────────────────────────────────────────────────────────────────────
# Data structures
# ──────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class BacktestConfig:
    """إعدادات المحاكاة التاريخية."""
    # رأس المال المبدئي
    initial_capital: float = 100_000.0
    # فترة التسخين (لازم ≥ 210 لـ Stage 2 200-SMA)
    warmup_bars: int = 215
    # الحد الأدنى للإشارة اللي بتفتح صفقة
    min_signal: SignalType = SignalType.BUY  # BUY أو STRONG_BUY
    # Persona لـ ATR risk plan
    persona: str = "investor"
    # cooldown بعد الخسارة (عدد بارات ما تفتحش صفقة جديدة)
    cooldown_after_loss: int = 5
    # cooldown بعد أي خروج (تجنّب إعادة الدخول الفوري على نفس النموذج)
    cooldown_after_exit: int = 3
    # أقصى عدد صفقات في المحاكاة (0 = بلا حد)
    max_trades: int = 0
    # إعادة تقييم الإشارة كل N بارات (1 = كل بار، 5 = كل أسبوع تقريباً)
    signal_frequency: int = 1
    # هل نسمح بإعادة الدخول في نفس اليوم بعد الخروج؟
    allow_reentry_same_bar: bool = False
    # الـ configs اللي بتعدّيها للمحركات
    confluence_config: Optional[ConfluenceConfig] = None
    atr_config: Optional[ATRRiskConfig] = None
    take_profit_config: Optional[TakeProfitConfig] = None


@dataclass
class Trade:
    """سجل صفقة كاملة (دخول + خروج)."""
    symbol: str
    entry_date: pd.Timestamp
    entry_price: float
    exit_date: Optional[pd.Timestamp] = None
    exit_price: Optional[float] = None
    exit_reason: str = ""                # "EXIT_STOP", "SELL_TIER_1", "EXIT_FINAL", ...
    shares: int = 0
    risk_per_share: float = 0.0
    # R-multiples لكل جزء من المركز (لتتبع البيع التدريجي)
    partial_exits: list[dict] = field(default_factory=list)  # [{date, price, fraction, r_multiple}]
    # الـ R الإجمالي للصفقة (مرجّح بالأجزاء)
    total_r: float = 0.0
    # الربح/الخسارة بالجنيه
    pnl: float = 0.0
    # الإشارة الأصلية
    entry_signal: str = ""
    entry_score: float = 0.0
    entry_confidence: float = 0.0
    # مدة الصفقة بالأيام
    bars_held: int = 0


@dataclass
class BacktestResult:
    """نتيجة المحاكاة التاريخية."""
    symbol: str
    config: BacktestConfig
    trades: list[Trade] = field(default_factory=list)
    equity_curve: list[tuple[pd.Timestamp, float]] = field(default_factory=list)
    final_capital: float = 0.0
    # إحصائيات محسوبة
    total_trades: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0
    avg_r: float = 0.0
    avg_win_r: float = 0.0
    avg_loss_r: float = 0.0
    profit_factor: float = 0.0
    max_drawdown: float = 0.0
    max_drawdown_pct: float = 0.0
    expectancy: float = 0.0            # متوسط الـ PnL لكل صفقة
    total_return_pct: float = 0.0
    avg_bars_held: float = 0.0
    # توزيع أسباب الخروج
    exit_reasons: dict[str, int] = field(default_factory=dict)
    # أفضل/أسوأ صفقة
    best_trade_r: float = 0.0
    worst_trade_r: float = 0.0
    # عدد الإشارات اللي اتجاهلت (cooldown أو مفيش)
    signals_generated: int = 0
    signals_acted_on: int = 0

    def to_summary(self) -> dict:
        return {
            "symbol": self.symbol,
            "total_trades": self.total_trades,
            "win_rate": round(self.win_rate, 4),
            "avg_r": round(self.avg_r, 4),
            "profit_factor": round(self.profit_factor, 2),
            "max_drawdown_pct": round(self.max_drawdown_pct, 4),
            "expectancy": round(self.expectancy, 2),
            "total_return_pct": round(self.total_return_pct, 4),
            "final_capital": round(self.final_capital, 2),
        }


# ──────────────────────────────────────────────────────────────────────────
# Signal threshold helper
# ──────────────────────────────────────────────────────────────────────────

_SIGNAL_RANK = {
    SignalType.STRONG_BUY: 5,
    SignalType.BUY: 4,
    SignalType.NEUTRAL: 3,
    SignalType.AVOID: 2,
    SignalType.STRONG_AVOID: 1,
}


def _meets_threshold(signal: SignalType, minimum: SignalType) -> bool:
    """هل الإشارة توصل الحد الأدنى المطلوب؟"""
    return _SIGNAL_RANK.get(signal, 0) >= _SIGNAL_RANK.get(minimum, 0)


# ──────────────────────────────────────────────────────────────────────────
# Main backtest loop
# ──────────────────────────────────────────────────────────────────────────

def run_backtest(
    df: pd.DataFrame,
    symbol: str = "UNKNOWN",
    config: Optional[BacktestConfig] = None,
) -> BacktestResult:
    """
    شغّل المحاكاة التاريخية على بيانات OHLCV.

    Args:
        df: DataFrame بـ columns: open, high, low, close, volume (index = تاريخ)
        symbol: رمز السهم (للتسجيل)
        config: إعدادات المحاكاة

    Returns:
        BacktestResult فيه كل الصفقات + الإحصائيات + منحنى رأس المال.
    """
    cfg = config or BacktestConfig()

    # التحقق من الأعمدة
    required = {"open", "high", "low", "close", "volume"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"DataFrame ناقص أعمدة: {missing}. مطلوب: {required}")

    if len(df) < cfg.warmup_bars + 10:
        raise ValueError(
            f"بيانات غير كافية للمحاكاة ({len(df)} بار). مطلوب ≥ {cfg.warmup_bars + 10} "
            f"(warmup={cfg.warmup_bars} + 10 للتشغيل)."
        )

    result = BacktestResult(symbol=symbol, config=cfg, final_capital=cfg.initial_capital)
    capital = cfg.initial_capital
    open_trade: Optional[Trade] = None
    open_position: Optional[Position] = None
    open_risk_plan: Optional[RiskPlan] = None
    cooldown_remaining = 0

    # منحنى رأس المال (يبدأ من نهاية warmup)
    result.equity_curve.append((df.index[cfg.warmup_bars - 1], capital))

    # ── امشي بار ببار من بعد warmup ──
    for i in range(cfg.warmup_bars, len(df)):
        current_bar = df.iloc[i]
        current_date = df.index[i]
        history = df.iloc[:i + 1]  # كل البيانات لحد البار ده (شامل)

        # ── 1) إدارة صفقة مفتوحة (أولوية أعلى من فتح جديدة) ──
        if open_trade is not None and open_position is not None:
            decision = evaluate_position(open_position, history, cfg.take_profit_config)

            exit_this_bar = False
            partial_exit = False

            if decision.action == PositionAction.EXIT_STOP:
                # وقف الخسارة — خروج كامل على الوقف.
                # الـ R الفعلي = (exit - entry) / risk_per_share — مش دايماً -1R،
                # لأن الوقف ممكن يكون اتحرّك لـ breakeven (R=0) أو trailing (R>0).
                exit_price = open_position.stop_loss
                fraction = decision.sell_fraction
                r_mult = (exit_price - open_trade.entry_price) / open_trade.risk_per_share \
                    if open_trade.risk_per_share > 0 else 0.0
                pnl = (exit_price - open_trade.entry_price) * open_trade.shares * fraction
                # صنّف السبب بدقة: خسارة / breakeven / trailed out
                if r_mult < -0.05:
                    reason_label = "EXIT_STOP_LOSS"
                elif r_mult <= 0.05:
                    reason_label = "EXIT_BREAKEVEN"
                else:
                    reason_label = "EXIT_TRAILED"
                _record_partial(open_trade, current_date, exit_price, fraction,
                                r_multiple=r_mult, reason=reason_label)
                open_trade.pnl += pnl
                capital += pnl
                exit_this_bar = True
                open_trade.exit_reason = reason_label

            elif decision.action == PositionAction.EXIT_FINAL:
                # الهدف النهائي (3R) — خروج كامل
                exit_price = decision.target_price or float(current_bar["close"])
                fraction = decision.sell_fraction
                r_mult = (exit_price - open_trade.entry_price) / open_trade.risk_per_share
                pnl = (exit_price - open_trade.entry_price) * open_trade.shares * fraction
                _record_partial(open_trade, current_date, exit_price, fraction,
                                r_mult, "EXIT_FINAL")
                open_trade.pnl += pnl
                capital += pnl
                exit_this_bar = True
                open_trade.exit_reason = "EXIT_FINAL"

            elif decision.action == PositionAction.EXIT_TARGET:
                exit_price = decision.target_price or float(current_bar["close"])
                fraction = decision.sell_fraction
                r_mult = (exit_price - open_trade.entry_price) / open_trade.risk_per_share
                pnl = (exit_price - open_trade.entry_price) * open_trade.shares * fraction
                _record_partial(open_trade, current_date, exit_price, fraction,
                                r_mult, "EXIT_TARGET")
                open_trade.pnl += pnl
                capital += pnl
                exit_this_bar = True
                open_trade.exit_reason = "EXIT_TARGET"

            elif decision.action == PositionAction.SELL_TIER_1:
                # بيع ثلث عند 1R
                exit_price = decision.target_price or float(current_bar["close"])
                fraction = decision.sell_fraction
                r_mult = (exit_price - open_trade.entry_price) / open_trade.risk_per_share
                pnl = (exit_price - open_trade.entry_price) * open_trade.shares * fraction
                _record_partial(open_trade, current_date, exit_price, fraction,
                                r_mult, "SELL_TIER_1")
                open_trade.pnl += pnl
                capital += pnl
                open_position.remaining_fraction -= fraction
                if decision.new_stop_loss:
                    open_position.stop_loss = decision.new_stop_loss
                partial_exit = True

            elif decision.action == PositionAction.SELL_TIER_2:
                exit_price = decision.target_price or float(current_bar["close"])
                fraction = decision.sell_fraction
                r_mult = (exit_price - open_trade.entry_price) / open_trade.risk_per_share
                pnl = (exit_price - open_trade.entry_price) * open_trade.shares * fraction
                _record_partial(open_trade, current_date, exit_price, fraction,
                                r_mult, "SELL_TIER_2")
                open_trade.pnl += pnl
                capital += pnl
                open_position.remaining_fraction -= fraction
                partial_exit = True

            elif decision.action == PositionAction.UPDATE_TRAILING:
                if decision.new_stop_loss and decision.new_stop_loss > open_position.stop_loss:
                    open_position.stop_loss = decision.new_stop_loss

            # لو الخروج كامل، أقفل الصفقة
            if exit_this_bar:
                open_trade.exit_date = current_date
                open_trade.exit_price = open_trade.partial_exits[-1]["price"]
                open_trade.bars_held = i - cfg.warmup_bars  # تقريبي
                # حساب الـ R الإجمالي (مرجّح بالأجزاء)
                open_trade.total_r = sum(
                    p["r_multiple"] * p["fraction"] for p in open_trade.partial_exits
                )
                result.trades.append(open_trade)
                # cooldown
                if open_trade.total_r < 0:
                    cooldown_remaining = cfg.cooldown_after_loss
                else:
                    cooldown_remaining = cfg.cooldown_after_exit
                open_trade = None
                open_position = None
                open_risk_plan = None

        # ── 2) فتح صفقة جديدة (لو مفيش صفقة مفتوحة) ──
        if open_trade is None and cooldown_remaining <= 0:
            if cfg.max_trades == 0 or len(result.trades) < cfg.max_trades:
                if (i - cfg.warmup_bars) % cfg.signal_frequency == 0:
                    try:
                        conf = analyze_confluence(
                            history, symbol, persona=cfg.persona,
                            account_size=capital, config=cfg.confluence_config,
                        )
                    except Exception:
                        conf = None

                    if conf is not None:
                        result.signals_generated += 1
                        if _meets_threshold(conf.final_signal, cfg.min_signal):
                            # افتح صفقة! الدخول على إغلاق البار الحالي
                            entry_price = float(current_bar["close"])
                            plan = conf.risk_plan
                            if plan is None:
                                # لو مفيش risk plan (نادر مع BUY)، احسبه يدوياً
                                try:
                                    plan = compute_risk_plan(
                                        history, entry_price, cfg.persona,
                                        capital, cfg.atr_config,
                                    )
                                except Exception:
                                    plan = None

                            if plan is not None and plan.shares and plan.shares > 0:
                                result.signals_acted_on += 1
                                open_trade = Trade(
                                    symbol=symbol,
                                    entry_date=current_date,
                                    entry_price=entry_price,
                                    shares=plan.shares,
                                    risk_per_share=plan.risk_per_share,
                                    entry_signal=conf.final_signal.value,
                                    entry_score=conf.final_score,
                                    entry_confidence=conf.final_confidence,
                                )
                                open_risk_plan = plan
                                open_position = position_from_risk_plan(
                                    plan, symbol, current_date, plan.shares,
                                )

        if cooldown_remaining > 0:
            cooldown_remaining -= 1

        # ── 3) حدّث منحنى رأس المال ──
        # لو فيه صفقة مفتوحة، احسب القيمة السوقية
        if open_trade is not None and open_position is not None:
            unrealized = (float(current_bar["close"]) - open_trade.entry_price) * open_trade.shares * open_position.remaining_fraction
            equity = capital + unrealized
        else:
            equity = capital
        result.equity_curve.append((current_date, equity))

    # ── لو فيه صفقة لسه مفتوحة في الآخر، أقفلها على آخر إغلاق ──
    if open_trade is not None:
        last_bar = df.iloc[-1]
        exit_price = float(last_bar["close"])
        fraction = open_position.remaining_fraction if open_position else 1.0
        r_mult = (exit_price - open_trade.entry_price) / open_trade.risk_per_share if open_trade.risk_per_share > 0 else 0.0
        pnl = (exit_price - open_trade.entry_price) * open_trade.shares * fraction
        _record_partial(open_trade, df.index[-1], exit_price, fraction, r_mult, "EXIT_EOD")
        open_trade.pnl += pnl
        capital += pnl
        open_trade.exit_date = df.index[-1]
        open_trade.exit_price = exit_price
        open_trade.exit_reason = "EXIT_EOD"
        open_trade.total_r = sum(p["r_multiple"] * p["fraction"] for p in open_trade.partial_exits)
        result.trades.append(open_trade)

    result.final_capital = capital
    _compute_statistics(result)
    return result


def _record_partial(trade: Trade, date, price: float, fraction: float,
                    r_multiple: float, reason: str) -> None:
    """سجّل خروج جزئي على الصفقة."""
    trade.partial_exits.append({
        "date": date,
        "price": round(price, 4),
        "fraction": round(fraction, 4),
        "r_multiple": round(r_multiple, 4),
        "reason": reason,
    })


# ──────────────────────────────────────────────────────────────────────────
# Statistics computation
# ──────────────────────────────────────────────────────────────────────────

def _compute_statistics(result: BacktestResult) -> None:
    """احسب كل الإحصائيات من قائمة الصفقات."""
    trades = result.trades
    result.total_trades = len(trades)
    if not trades:
        return

    r_values = [t.total_r for t in trades]
    pnls = [t.pnl for t in trades]

    result.wins = sum(1 for r in r_values if r > 0)
    result.losses = sum(1 for r in r_values if r <= 0)
    result.win_rate = result.wins / result.total_trades if result.total_trades > 0 else 0.0

    result.avg_r = float(np.mean(r_values))
    win_rs = [r for r in r_values if r > 0]
    loss_rs = [r for r in r_values if r <= 0]
    result.avg_win_r = float(np.mean(win_rs)) if win_rs else 0.0
    result.avg_loss_r = float(np.mean(loss_rs)) if loss_rs else 0.0

    gross_profit = sum(p for p in pnls if p > 0)
    gross_loss = abs(sum(p for p in pnls if p <= 0))
    result.profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")

    result.expectancy = float(np.mean(pnls))
    result.total_return_pct = (result.final_capital - result.config.initial_capital) / result.config.initial_capital

    # Max drawdown من منحنى رأس المال
    equities = [e for _, e in result.equity_curve]
    peak = equities[0] if equities else 0.0
    max_dd = 0.0
    max_dd_pct = 0.0
    for eq in equities:
        if eq > peak:
            peak = eq
        dd = peak - eq
        if dd > max_dd:
            max_dd = dd
            max_dd_pct = dd / peak if peak > 0 else 0.0
    result.max_drawdown = max_dd
    result.max_drawdown_pct = max_dd_pct

    result.avg_bars_held = float(np.mean([t.bars_held for t in trades])) if trades else 0.0

    # توزيع أسباب الخروج
    exit_reasons: dict[str, int] = {}
    for t in trades:
        exit_reasons[t.exit_reason] = exit_reasons.get(t.exit_reason, 0) + 1
    result.exit_reasons = exit_reasons

    result.best_trade_r = max(r_values) if r_values else 0.0
    result.worst_trade_r = min(r_values) if r_values else 0.0


# ──────────────────────────────────────────────────────────────────────────
# Report printing
# ──────────────────────────────────────────────────────────────────────────

def print_report(result: BacktestResult, show_trades: int = 10) -> None:
    """اطبع تقرير المحاكاة بشكل مقروء."""
    cfg = result.config
    print()
    print("╔" + "═" * 68 + "╗")
    print(f"║  تقرير المحاكاة التاريخية — {result.symbol:<20}".ljust(70) + " ║")
    print("╚" + "═" * 68 + "╝")
    print(f"  رأس المال المبدئي:  {cfg.initial_capital:>14,.2f} جنيه")
    print(f"  رأس المال النهائي:  {result.final_capital:>14,.2f} جنيه")
    print(f"  العائد الكلي:        {result.total_return_pct:>+13.2%}")
    print(f"  أقصى خسارة تراكمية:  {result.max_drawdown_pct:>+13.2%}  ({result.max_drawdown:,.2f} جنيه)")
    print()
    print(f"  ── أداء الصفقات ──")
    print(f"  إجمالي الصفقات:      {result.total_trades:>14}")
    print(f"  صفقات رابحة:         {result.wins:>14}")
    print(f"  صفقات خاسرة:         {result.losses:>14}")
    print(f"  Win Rate:            {result.win_rate:>13.2%}")
    print(f"  Profit Factor:       {result.profit_factor:>14.2f}")
    print()
    print(f"  ── R-Multiples (Van Tharp) ──")
    print(f"  متوسط R:             {result.avg_r:>+13.3f}R")
    print(f"  متوسط R للربح:       {result.avg_win_r:>+13.3f}R")
    print(f"  متوسط R للخسارة:     {result.avg_loss_r:>+13.3f}R")
    print(f"  أفضل صفقة:           {result.best_trade_r:>+13.3f}R")
    print(f"  أسوأ صفقة:           {result.worst_trade_r:>+13.3f}R")
    print(f"  Expectancy:          {result.expectancy:>+14,.2f} جنيه/صفقة")
    print(f"  متوسط مدة الصفقة:    {result.avg_bars_held:>14.1f} بار")
    print()
    print(f"  ── توزيع أسباب الخروج ──")
    for reason, count in sorted(result.exit_reasons.items(), key=lambda x: -x[1]):
        pct = count / result.total_trades * 100 if result.total_trades > 0 else 0
        bar = "█" * int(pct / 2)
        print(f"    {reason:<20} {count:>4} ({pct:>5.1f}%) {bar}")
    print()
    print(f"  ── الإشارات ──")
    print(f"  إشارات مولّدة:       {result.signals_generated:>14}")
    print(f"  إشارات نُفّذت:        {result.signals_acted_on:>14}")
    if result.signals_generated > 0:
        print(f"  نسبة التنفيذ:        {result.signals_acted_on/result.signals_generated:>13.2%}")

    # اطبع أحدث/أهم الصفقات
    if show_trades > 0 and result.trades:
        print()
        print(f"  ── آخر {min(show_trades, len(result.trades))} صفقات ──")
        print(f"  {'#':<3}{'دخول':<12}{'سعر':>8}{'خروج':<12}{'سعر':>8}{'R':>8}{'سبب':<16}{'إشارة':<12}")
        print(f"  {'─'*90}")
        for idx, t in enumerate(result.trades[-show_trades:], 1):
            print(f"  {idx:<3}{str(t.entry_date.date()):<12}{t.entry_price:>8.2f}"
                  f"{str(t.exit_date.date()) if t.exit_date else '-':<12}"
                  f"{t.exit_price or 0:>8.2f}{t.total_r:>+8.2f}{t.exit_reason:<16}{t.entry_signal:<12}")

    # تقييم جودة الاستراتيجية
    print()
    print("  ── تقييم جودة الاستراتيجية ──")
    grade = _grade_strategy(result)
    print(f"  التقييم: {grade}")

    print()


def _grade_strategy(result: BacktestResult) -> str:
    """قيّم جودة الاستراتيجية بناءً على معايير Van Tharp."""
    if result.total_trades < 10:
        return "⚠️  بيانات غير كافية (أقل من 10 صفقات) — التقييم غير موثوق"
    score = 0
    reasons = []
    if result.win_rate >= 0.50:
        score += 1; reasons.append("win rate ≥ 50%")
    if result.profit_factor >= 1.5:
        score += 1; reasons.append("profit factor ≥ 1.5")
    if result.avg_r >= 0.3:
        score += 1; reasons.append(f"avg R ≥ 0.3 ({result.avg_r:.2f})")
    if result.max_drawdown_pct <= 0.25:
        score += 1; reasons.append("max drawdown ≤ 25%")
    if result.expectancy > 0:
        score += 1; reasons.append("expectancy موجبة")

    if score >= 4:
        return f"🟢 ممتاز (4-5/{score}) — {' | '.join(reasons)}"
    elif score >= 3:
        return f"🟡 مقبول (3/{score}) — {' | '.join(reasons)}"
    elif score >= 2:
        return f"🟠 ضعيف (2/{score}) — يحتاج تحسين"
    else:
        return f"🔴 سيئ (1/{score}) — الاستراتيجية تخسر، راجع المحركات"


# ──────────────────────────────────────────────────────────────────────────
# CSV loader
# ──────────────────────────────────────────────────────────────────────────

def load_csv(path: str | Path) -> pd.DataFrame:
    """
    حمّل ملف CSV فيه بيانات OHLCV.

    الأعمدة المتوقعة (غير حساسة لحالة الأحرف):
        date/timestamp, open, high, low, close, volume
    """
    df = pd.read_csv(path)
    # توحيد أسماء الأعمدة
    df.columns = [c.lower().strip() for c in df.columns]
    rename = {
        "timestamp": "date", "time": "date", "datetime": "date",
    }
    df = df.rename(columns=rename)
    if "date" not in df.columns:
        raise ValueError(f"الملف {path} مفيهوش عمود التاريخ (date/timestamp)")
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()
    required = ["open", "high", "low", "close", "volume"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"الملف ناقص أعمدة: {missing}")
    return df[required].astype(float)


# ──────────────────────────────────────────────────────────────────────────
# CLI entry point
# ──────────────────────────────────────────────────────────────────────────

def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(
        description="محاكاة تاريخية للمحركات على بيانات OHLCV",
    )
    parser.add_argument("csv", help="مسار ملف CSV فيه: date,open,high,low,close,volume")
    parser.add_argument("--symbol", default="UNKNOWN", help="رمز السهم")
    parser.add_argument("--capital", type=float, default=100_000, help="رأس المال المبدئي")
    parser.add_argument("--persona", default="investor", choices=["scalper", "investor"])
    parser.add_argument("--min-signal", default="BUY",
                        choices=["BUY", "STRONG_BUY"], help="أدنى إشارة للدخول")
    parser.add_argument("--warmup", type=int, default=215, help="فترة التسخين")
    parser.add_argument("--show-trades", type=int, default=15, help="عدد الصفقات المعروضة")
    args = parser.parse_args()

    df = load_csv(args.csv)
    print(f"محمل {len(df)} بار من {df.index[0].date()} لـ {df.index[-1].date()}")

    cfg = BacktestConfig(
        initial_capital=args.capital,
        warmup_bars=args.warmup,
        persona=args.persona,
        min_signal=SignalType[args.min_signal],
    )
    result = run_backtest(df, symbol=args.symbol, config=cfg)
    print_report(result, show_trades=args.show_trades)


if __name__ == "__main__":
    main()
