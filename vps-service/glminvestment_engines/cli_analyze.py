#!/usr/bin/env python3
"""
cli_analyze.py — أداة سطر الأوامر لتحليل سهم واحد بكل المحركات
=================================================================
بياخد ملف CSV فيه بيانات OHLCV، بيشغّل كل المحركات على آخر شمعة،
وبيطبع تقرير كامل: Stage 2, VCP, Donchian, ATR Risk, Confluence.

ملاحظة: الملف بيستخدم relative imports داخل حزمة glminvestment_engines،
فلازم يتشغّل كـ module من داخل vps-service/:
    python3 -m glminvestment_engines.cli_analyze data/COMI.csv --symbol COMI
    python3 -m glminvestment_engines.cli_analyze data/EGX30.csv --symbol EGX30 --persona scalper --capital 50000

صيغة الـ CSV (غير حساس لحالة الأحرف):
    date,open,high,low,close,volume
    2024-01-01,10.5,10.8,10.4,10.7,1500000
    ...
"""
from __future__ import annotations

import argparse

import pandas as pd

from .engines.stage2_filter import analyze as analyze_stage2, classify_stage, Stage2Config
from .engines.vcp_detector import analyze as analyze_vcp, detect_vcp, VCPConfig
from .engines.donchian_breakout import analyze as analyze_donchian, detect_breakout, DonchianConfig
from .engines.atr_risk_engine import analyze as analyze_atr_risk, compute_risk_plan, ATRRiskConfig
from .engines.take_profit_tiers import (
    evaluate_position, position_from_risk_plan, TakeProfitConfig, PositionAction,
)
from .confluence.confluence_scorer import analyze as analyze_confluence, ConfluenceConfig
from .backtest.strategy_backtester import load_csv, run_backtest, print_report, BacktestConfig
from .core.base import SignalType


# ──────────────────────────────────────────────────────────────────────────
# Pretty printing
# ──────────────────────────────────────────────────────────────────────────

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"


def _color_for_signal(signal: str) -> str:
    if signal in ("STRONG_BUY", "BUY"):
        return GREEN
    if signal in ("STRONG_AVOID", "AVOID"):
        return RED
    return YELLOW


def _print_engine(name: str, result, color: str = CYAN) -> None:
    sig = result.signal
    sig_color = _color_for_signal(sig.signal_type.value)
    print(f"\n  {color}{BOLD}┌─ {name}{RESET}")
    print(f"  │ signal: {sig_color}{BOLD}{sig.signal_type.value}{RESET}  |  confidence: {sig.confidence:.2f}")
    print(f"  │ {sig.reason}")
    md = sig.metadata
    # أهم المفاتيح
    key_labels = {
        "stage": "المرحلة", "adx": "ADX", "sma200": "SMA200", "sma50": "SMA50",
        "found": "VCP موجود", "score": "VCP score", "num_contractions": "عدد الانكماشات",
        "contraction_ratios": "نسب الانكماش", "last_range_pct": "آخر نطاق",
        "volume_dryup": "جفاف الحجم", "vol_ratio": "نسبة الحجم",
        "breakout_20": "اختراق 20ي", "breakout_55": "اختراق 55ي",
        "volume_confirmed": "تأكيد حجم", "volume_ratio": "نسبة الحجم",
        "stop_loss": "وقف الخسارة", "stop_pct": "نسبة الوقف",
        "shares": "عدد الأسهم", "position_size_pct": "حجم المركز",
        "tier1": "Tier 1", "tier2": "Tier 2", "tier3": "Tier 3",
    }
    for k, label in key_labels.items():
        if k in md:
            v = md[k]
            if isinstance(v, float):
                v = f"{v:.4f}" if abs(v) < 1 else f"{v:.2f}"
            print(f"  │   {label}: {v}")
    print(f"  {color}└──────────────────────────────────────────{RESET}")


# ──────────────────────────────────────────────────────────────────────────
# Main analysis
# ──────────────────────────────────────────────────────────────────────────

def analyze_stock(
    df: pd.DataFrame,
    symbol: str,
    persona: str = "investor",
    account_size: float = 100_000.0,
) -> None:
    """حلّل سهم واطبع التقرير الكامل."""
    print(f"\n{'═' * 70}")
    print(f"  تحليل {BOLD}{symbol}{RESET} — {len(df)} شمعة | "
          f"من {df.index[0].date()} لـ {df.index[-1].date()}")
    print(f"  آخر إغلاق: {BOLD}{df['close'].iloc[-1]:.2f}{RESET}  |  "
          f"آخر حجم: {df['volume'].iloc[-1]:,.0f}")
    print(f"  Persona: {persona}  |  رأس المال: {account_size:,.0f} جنيه")
    print(f"{'═' * 70}")

    # ── شغّل كل محرك منفرد ──
    entry_price = float(df["close"].iloc[-1])

    _print_engine("Stage 2 Filter (Minervini)", analyze_stage2(df, symbol))
    _print_engine("VCP Detector (Minervini)", analyze_vcp(df, symbol))
    _print_engine("Donchian Breakout (Covel)", analyze_donchian(df, symbol))
    _print_engine(
        "ATR Risk Engine (Wilder)",
        analyze_atr_risk(df, symbol, entry_price, persona, account_size),
    )

    # ── Confluence ──
    print(f"\n  {BOLD}{CYAN}╔─ Confluence Engine v3 — القرار النهائي ─{RESET}")
    result = analyze_confluence(df, symbol, persona=persona, account_size=account_size)
    sig_color = _color_for_signal(result.final_signal.value)
    print(f"  ║")
    print(f"  ║  الإشارة: {sig_color}{BOLD}{result.final_signal.value}{RESET}  "
          f"|  Score: {result.final_score:.1f}/100  |  Confidence: {result.final_confidence:.2f}")
    print(f"  ║  المحركات المتفقة: {result.aligned_buy_engines}")
    if result.veto_reason:
        print(f"  ║  {RED}⚠️  VETO: {result.veto_reason}{RESET}")
    print(f"  ║  {result.reason}")
    print(f"  ║")
    print(f"  ║  درجات كل محرك:")
    for name, score in result.metadata["engine_scores"].items():
        weight = result.metadata["weights"].get(name, 0)
        bar_len = int(score / 5)
        bar = "█" * bar_len
        print(f"  ║    {name:<12} {score:5.1f} ({weight:.0%}) {bar}")
    print(f"  {CYAN}╚──────────────────────────────────────────{RESET}")

    # ── خطة المخاطر ──
    if result.risk_plan:
        plan = result.risk_plan
        print(f"\n  {BOLD}{GREEN}✓ خطة المخاطر معتمدة:{RESET}")
        print(f"    دخول:      {plan.entry_price:.2f}")
        print(f"    وقف:       {plan.stop_loss:.2f}  ({(plan.entry_price-plan.stop_loss)/plan.entry_price:.1%})")
        print(f"    مخاطرة/سهم: {plan.risk_amount_per_share:.2f}")
        print(f"    الأسهم:    {plan.shares}  ({plan.position_size_pct:.1%} من رأس المال)")
        print(f"    R:R:       1:{plan.risk_reward_ratio:.1f}")
        print(f"    {BOLD}جني الأرباح التدريجي:{RESET}")
        for tier in plan.take_profit_tiers:
            r = (tier.price - plan.entry_price) / plan.risk_amount_per_share
            print(f"      • {tier.label:<22} → {tier.price:.2f}  ({r:+.1f}R)  بيع {tier.fraction:.0%}")

    # ── توصية نهائية ──
    print(f"\n  {BOLD}التوصية:{RESET} ", end="")
    if result.final_signal == SignalType.STRONG_BUY:
        print(f"{GREEN}{BOLD}شراء قوي{RESET} — تنفيذ موصى به بحجم كامل.")
    elif result.final_signal == SignalType.BUY:
        print(f"{GREEN}شراء{RESET} — تنفيذ بحجم مناسب مع اتباع خطة المخاطر.")
    elif result.final_signal == SignalType.NEUTRAL:
        print(f"{YELLOW}انتظر{RESET} — إشارات مختلطة، لا تدخل حتى يتضح التلاقي.")
    elif result.final_signal == SignalType.AVOID:
        print(f"{RED}تجنّب{RESET} — إشارات سلبية.")
    else:
        print(f"{RED}{BOLD}ممنوع الشراء{RESET} — مخاطرة عالية أو Stage 4.")
    print()


# ──────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="حلّل سهم بكل المحركات (Stage 2 + VCP + Donchian + ATR + Confluence)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
أمثلة (من داخل vps-service/):
  python3 -m glminvestment_engines.cli_analyze data/COMI.csv --symbol COMI
  python3 -m glminvestment_engines.cli_analyze data/EGX30.csv --symbol EGX30 --persona scalper --capital 50000
  python3 -m glminvestment_engines.cli_analyze data/COMI.csv --symbol COMI --backtest
        """,
    )
    parser.add_argument("csv", help="ملف CSV فيه: date,open,high,low,close,volume")
    parser.add_argument("--symbol", required=True, help="رمز السهم")
    parser.add_argument("--persona", default="investor", choices=["scalper", "investor"],
                        help="نوع المتداول (افتراضي: investor)")
    parser.add_argument("--capital", type=float, default=100_000,
                        help="رأس المال بالجنيه (افتراضي: 100,000)")
    parser.add_argument("--backtest", action="store_true",
                        help="شغّل محاكاة تاريخية بدل تحليل آخر شمعة فقط")
    parser.add_argument("--min-signal", default="BUY", choices=["BUY", "STRONG_BUY"],
                        help="أدنى إشارة للدخول في المحاكاة (افتراضي: BUY)")
    parser.add_argument("--warmup", type=int, default=215,
                        help="فترة التسخين للمحاكاة (افتراضي: 215)")
    args = parser.parse_args()

    df = load_csv(args.csv)
    print(f"محمل {len(df)} شمعة من {df.index[0].date()} لـ {df.index[-1].date()}")

    if args.backtest:
        cfg = BacktestConfig(
            initial_capital=args.capital,
            persona=args.persona,
            min_signal=SignalType[args.min_signal],
            warmup_bars=args.warmup,
        )
        result = run_backtest(df, symbol=args.symbol, config=cfg)
        print_report(result, show_trades=20)
    else:
        analyze_stock(df, args.symbol, persona=args.persona, account_size=args.capital)


# ──────────────────────────────────────────────────────────────────────────
# Entry point.
#
# ⚠️ بسبب relative imports، الملف ده لازم يتشغّل كـ module من داخل vps-service/:
#       python3 -m glminvestment_engines.cli_analyze <csv> --symbol <SYM> [...]
#   مش `python3 glminvestment_engines/cli_analyze.py` مباشرةً (هي فشل relative imports).
# ──────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    main()
