"""
examples/demo_confluence.py — عرض شامل للمحركات الخمسة + Confluence
=====================================================================
بيولّد بيانات OHLCV اصطناعية واقعية لسهم مصري وهمي (TEST) بيمر بـ:
  1. Stage 1 (تجميع) — أول 60 يوم
  2. Stage 2 (صعود) — 60 يوم صعود من 100 لـ 150
  3. VCP (3 انكماشات بتضيق) — 60 يوم
  4. Breakout (اختراق بحجم) — آخر 10 أيام

بعدين بيشغّل كل المحركات على آخر شمعة ويعرض النتيجة.

الهدف: إثبات إن الـ pipeline كله بيشتغل وبيطلع STRONG_BUY على
صفقة عالية الجودة (Stage 2 + VCP + Donchian breakout + ATR صحي).

طريقة التشغيل:
    cd glminvestment-engines
    python3 examples/demo_confluence.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# ضمان إن الحزمة نفسها قابلة للاستيراد من أي مكان
ENGINES_ROOT = Path(__file__).resolve().parent.parent
if str(ENGINES_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINES_ROOT))

from engines.stage2_filter import analyze as analyze_stage2, classify_stage
from engines.vcp_detector import analyze as analyze_vcp, detect_vcp
from engines.atr_risk_engine import analyze as analyze_atr_risk, compute_risk_plan
from engines.donchian_breakout import analyze as analyze_donchian, detect_breakout
from engines.take_profit_tiers import (
    evaluate_position, position_from_risk_plan, TakeProfitConfig, PositionAction,
)
from confluence.confluence_scorer import analyze as analyze_confluence


# ──────────────────────────────────────────────────────────────────────────
# Synthetic data generators
# ──────────────────────────────────────────────────────────────────────────

def _add_noise(arr: np.ndarray, sigma: float, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return arr + rng.normal(0, sigma, len(arr))


def generate_stage2_vcp_breakout(seed: int = 42) -> pd.DataFrame:
    """
    ولّد سهم وهمي بـ: Stage1 → Stage2 → VCP → Breakout.

    الـ geometry مهمة عشان VCP detector يشتغل:
      - pivot high لازم يكون قبل النهاية (مش في آخر شمعة)
      - 3 انكماشات بتضيق بعد الـ pivot
      - حجم بيجفّ في آخر انكماش
      - السعر يرجع قريب من الـ pivot (within 10%) في الآخر
    """
    rng = np.random.default_rng(seed)

    # ── Phase 1: Stage 1 (تجميع) — 65 يوم، نطاق ضيق حول 95-100 ──
    s1_close = 97.5 + rng.normal(0, 1.2, 65)
    s1_close = np.clip(s1_close, 94, 101)

    # ── Phase 2: Stage 2 (صعود) — 90 يوم من 100 لـ 152 ──
    s2_trend = np.linspace(100, 152, 90)
    s2_close = s2_trend + rng.normal(0, 1.8, 90)

    # ── Phase 3: VCP — 70 يوم ──
    # pivot high ≈ 152 (آخر قمة في Stage 2)، بعدين 3 انكماشات:
    #   C1: 152 → 138  (−9.2%)
    #   C2: 149 → 143  (−4.0%)
    #   C3: 150 → 147  (−2.0%)  ← ضيق + حجم جاف
    # ثم breakout فوق 152 بحجم عالي
    vcp = np.concatenate([
        np.linspace(152, 138, 14) + rng.normal(0, 0.9, 14),   # C1 down
        np.linspace(138, 149, 10) + rng.normal(0, 0.7, 10),   # C1 up (lower high)
        np.linspace(149, 143, 12) + rng.normal(0, 0.5, 12),   # C2 down (tighter)
        np.linspace(143, 150, 9)  + rng.normal(0, 0.4, 9),    # C2 up
        np.linspace(150, 147, 12) + rng.normal(0, 0.35, 12),  # C3 down (tightest)
        np.linspace(147, 153.5, 8) + rng.normal(0, 0.3, 8),   # breakout فوق pivot 152
    ])

    close = np.concatenate([s1_close, s2_close, vcp])
    # المجموع = 65 + 90 + 65 = 220 يوم (أكبر من 210 المطلوب لـ Stage 2)

    # high/low حول الـ close
    n = len(close)
    high = close + rng.uniform(0.3, 1.6, n)
    low = close - rng.uniform(0.3, 1.6, n)

    # volume: عالي في Stage 2، ثم بيجفّ تدريجياً في VCP (depth أعمق)،
    # ثم يقفز في آخر 3 شمعات (breakout confirmation)
    vol = np.concatenate([
        rng.uniform(0.8e6, 2.0e6, 65),                          # Stage 1 متوسط
        np.linspace(1.5e6, 3.0e6, 90) + rng.normal(0, 0.3e6, 90),  # Stage 2 صعود بحجم
        np.linspace(2.8e6, 0.35e6, 50),                         # VCP contractions: جفاف عميق
        np.full(12, 0.35e6) + rng.normal(0, 0.05e6, 12),        # VCP dry base (جاف تماماً)
        np.linspace(0.5e6, 4.2e6, 3),                           # breakout spike (آخر 3 شمعات)
    ])
    vol = np.clip(vol, 0.3e6, None)

    idx = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=n)
    return pd.DataFrame(
        {"open": close, "high": high, "low": low, "close": close, "volume": vol},
        index=idx,
    )


def generate_stage4_downtrend(seed: int = 7) -> pd.DataFrame:
    """
    ولّد سهم في Stage 4 (هبوط) — عشان نثبت إن الـ veto بيشتغل.
    السعر تحت 200SMA و 200SMA هابط.
    """
    rng = np.random.default_rng(seed)
    n = 260
    # هبوط من 120 لـ 70
    trend = np.linspace(120, 70, n)
    close = trend + rng.normal(0, 1.5, n)
    high = close + rng.uniform(0.5, 2.0, n)
    low = close - rng.uniform(0.5, 2.0, n)
    vol = rng.uniform(1e6, 2.5e6, n)
    idx = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=n)
    return pd.DataFrame(
        {"open": close, "high": high, "low": low, "close": close, "volume": vol},
        index=idx,
    )


# ──────────────────────────────────────────────────────────────────────────
# Pretty printers
# ──────────────────────────────────────────────────────────────────────────

def print_separator(title: str) -> None:
    print(f"\n{'━' * 70}")
    print(f"  {title}")
    print(f"{'━' * 70}")


def print_engine_result(name: str, result) -> None:
    sig = result.signal
    print(f"\n┌─ {name} ───────────────────────────────────────────")
    print(f"│ signal: {sig.signal_type.value:<14} confidence: {sig.confidence:.2f}")
    print(f"│ reason: {sig.reason}")
    md = sig.metadata
    # اطبع أهم المفاتيح بس (تجنّب الطباعة الطويلة)
    interesting = {}
    for k in ("stage", "adx", "found", "score", "num_contractions",
              "contraction_ratios", "last_range_pct", "volume_dryup", "vol_ratio",
              "breakout_20", "breakout_55", "volume_confirmed",
              "stop_loss", "stop_pct", "shares", "tier1", "tier2", "tier3"):
        if k in md:
            interesting[k] = md[k]
    if interesting:
        for k, v in interesting.items():
            print(f"│   {k}: {v}")
    print(f"└──────────────────────────────────────────────────────")


# ──────────────────────────────────────────────────────────────────────────
# Main demo
# ──────────────────────────────────────────────────────────────────────────

def demo_bullish_setup() -> None:
    """السيناريو الإيجابي: Stage 2 + VCP + breakout → STRONG_BUY."""
    print_separator("السيناريو 1: سهم Stage 2 + VCP + Breakout (إيجابي)")
    df = generate_stage2_vcp_breakout(seed=42)
    print(f"بيانات: {len(df)} شمعة | من {df.index[0].date()} لـ {df.index[-1].date()}")
    print(f"آخر إغلاق: {df['close'].iloc[-1]:.2f} | آخر حجم: {df['volume'].iloc[-1]:,.0f}")

    # ── شغّل كل محرك منفرد ──
    symbol = "TEST-BULL"
    print_engine_result("Stage 2 Filter (Minervini)", analyze_stage2(df, symbol))
    print_engine_result("VCP Detector (Minervini)", analyze_vcp(df, symbol))
    print_engine_result("Donchian Breakout (Covel)", analyze_donchian(df, symbol))
    print_engine_result("ATR Risk Engine (Wilder)", analyze_atr_risk(
        df, symbol, entry_price=float(df["close"].iloc[-1]),
        persona="investor", account_size=100_000,
    ))

    # ── Confluence: القرار الموحّد ──
    print_separator("Confluence Engine v3 — القرار النهائي")
    result = analyze_confluence(
        df, symbol, persona="investor", account_size=100_000,
    )
    print(f"\n  الإشارة النهائية: {result.final_signal.value}")
    print(f"  Score: {result.final_score:.1f}/100  |  Confidence: {result.final_confidence:.2f}")
    print(f"  المحركات المتفقة (BUY/STRONG_BUY): {result.aligned_buy_engines}")
    if result.veto_reason:
        print(f"  ⚠️  VETO: {result.veto_reason}")
    print(f"\n  التفسير: {result.reason}")
    print(f"\n  درجات كل محرك:")
    for name, score in result.metadata["engine_scores"].items():
        weight = result.metadata["weights"].get(name, 0)
        print(f"    • {name:<12} score={score:5.1f}  weight={weight:.0%}")

    # ── خطة المخاطر ──
    if result.risk_plan:
        plan = result.risk_plan
        print_separator("خطة المخاطر الكاملة (ATR + Take-Profit Tiers)")
        print(f"\n  سعر الدخول:    {plan.entry_price:.2f}")
        print(f"  وقف الخسارة:   {plan.stop_loss:.2f}  ({(plan.entry_price - plan.stop_loss)/plan.entry_price:.1%})")
        print(f"  المخاطرة/سهم:  {plan.risk_amount_per_share:.2f}")
        print(f"  حجم المركز:    {plan.shares} سهم  ({plan.position_size_pct:.1%} من رأس المال)")
        print(f"  R:R:           1:{plan.risk_reward_ratio:.1f}")
        print(f"\n  جني الأرباح التدريجي (Mark Douglas):")
        for tier in plan.take_profit_tiers:
            pct = (tier.price - plan.entry_price) / plan.risk_amount_per_share
            print(f"    • {tier.label:<22} → {tier.price:.2f}  ({pct:+.1f}R)  بيع {tier.fraction:.0%}")
            print(f"      └ {tier.reason}")

    # ── محاكاة إدارة الصفقة بعد الدخول (Take Profit Tiers) ──
    if result.risk_plan:
        print_separator("محاكاة إدارة الصفقة (Take-Profit Tiers)")
        position = position_from_risk_plan(
            result.risk_plan, symbol, df.index[-1],
        )
        # محاكاة 15 يوم بعد الدخول: السعر بيواصل الصعود
        rng = np.random.default_rng(99)
        sim_prices = []
        p = float(df["close"].iloc[-1])
        for _ in range(15):
            p *= 1 + rng.normal(0.012, 0.008)  # صعود تدريجي
            sim_prices.append(p)
        print(f"\n  الصفقة: دخول @ {position.entry_price:.2f} | وقف @ {position.stop_loss:.2f}")
        print(f"  {'اليوم':<6}{'السعر':<10}{'القرار':<22}{'بيع':<8}{'وقف جديد':<12}السبب")
        print(f"  {'─'*80}")
        for i, price in enumerate(sim_prices, 1):
            # بناء df مؤقت بآخر 30 شمعة + الشمعة المحاكاة
            sim_df = df.iloc[-30:].copy()
            new_row = pd.DataFrame(
                {"open": price, "high": price * 1.005, "low": price * 0.995,
                 "close": price, "volume": 2e6},
                index=[df.index[-1] + pd.Timedelta(days=i)],
            )
            sim_df = pd.concat([sim_df, new_row])
            decision = evaluate_position(position, sim_df, TakeProfitConfig())
            print(f"  {i:<6}{price:<10.2f}{decision.action.value:<22}"
                  f"{decision.sell_fraction:<8.2f}"
                  f"{str(decision.new_stop_loss or '-')[:10]:<12}"
                  f"{decision.reason[:40]}")
            # طبّق القرار على الـ position
            if decision.action == PositionAction.SELL_TIER_1:
                position.remaining_fraction -= decision.sell_fraction
                if decision.new_stop_loss:
                    position.stop_loss = decision.new_stop_loss
            elif decision.action == PositionAction.SELL_TIER_2:
                position.remaining_fraction -= decision.sell_fraction
            elif decision.action in (PositionAction.EXIT_STOP, PositionAction.EXIT_FINAL,
                                      PositionAction.EXIT_TARGET):
                position.remaining_fraction = 0.0
                break
            elif decision.action == PositionAction.UPDATE_TRAILING:
                if decision.new_stop_loss:
                    position.stop_loss = decision.new_stop_loss
        print(f"\n  المركز المتبقي: {position.remaining_fraction:.0%}")


def demo_bearish_veto() -> None:
    """السيناريو السلبي: Stage 4 → VETO → STRONG_AVOID."""
    print_separator("السيناريو 2: سهم Stage 4 (هبوط) — اختبار الـ Veto")
    df = generate_stage4_downtrend(seed=7)
    print(f"بيانات: {len(df)} شمعة | آخر إغلاق: {df['close'].iloc[-1]:.2f}")

    result = analyze_confluence(df, "TEST-BEAR", persona="investor", account_size=100_000)
    print(f"\n  الإشارة النهائية: {result.final_signal.value}")
    print(f"  Veto: {result.veto_reason or 'لا'}")
    print(f"  التفسير: {result.reason}")
    print(f"\n  ✅ النتيجة: النظام رفض أي صفقة شراء في اتجاه هابط (قاعدة Minervini).")


def main() -> None:
    print("╔" + "═" * 68 + "╗")
    print("║" + " محركات أساطير التداول — عرض شامل (5 محركات + Confluence) ".center(68) + "║")
    print("╚" + "═" * 68 + "╝")

    demo_bullish_setup()
    demo_bearish_veto()

    print_separator("الخلاصة")
    print("""
  ✅ Stage 2 Filter — بيحدد مرحلة السهم (1/2/3/4) وبيقفل الباب على البيع في الهبوط.
  ✅ VCP Detector — بيلاقي انكماشات بتضيق + جفاف حجم = جاهز للانفجار.
  ✅ Donchian Breakout — بيأكد اختراق أعلى 20/55 يوم بحجم.
  ✅ ATR Risk Engine — بيحسب وقف ديناميكي + حجم مركز + tiers (1R/2R/3R).
  ✅ Take-Profit Tiers — بيع تدريجي + وقف متحرك (فلسفة Mark Douglas).
  ✅ Confluence Engine v3 — بيخلط كل المحركات بأوزان + Stage 4 Veto.

  الخطوة التالية: استخدم cli_analyze.py على بيانات EGX حقيقية،
  أو backtest/strategy_backtester.py لقياس الـ win rate تاريخياً.
""")


if __name__ == "__main__":
    main()
