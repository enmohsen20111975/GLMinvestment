#!/usr/bin/env python3
"""
liquidity_radar_v2.py — رادار السيولة الصارم (4 أعمدة فقط)
=================================================================================
Task BRAVO-RADAR-V2 (Owner Directive 2026-10-14)

الهدف: تحويل الرادر من شاشة تسميات إلى منظار قرار بسيط وقابل للاعتماد.

الـ 4 أعمدة الإلزامية:
  1. الحوت فين؟       → صافي الكاش المطلق (EGP) فوق/تحت متوسط الفترة
  2. حالة السوق       → فلتر إلزامي (صاعد / هابط / عرضي / Risk-Off)
  3. المرحلة          → 3 حالات بس: بيبلع على الهادي / بيتحضر / بيصرف
  4. مستوى الدخول والدفاع → سعر مرجعي للدخول + مستوى كسر = خروج

القيود الحديدية:
  - ممنوع مصطلحات Wyckoff (Spring / SOS / Buying Climax / تصريف ذكي)
  - MFI لوحده ممنوع كدليل
  - أي سهم صافي تدفقه سالب أو حجمه ضعيف → ممنوع قائمة إيجابية
  - سوق هابط واضح → ممنوع إشارات تجميع/Pre-Surge
  - بيانات ناقصة → "بيانات غير كافية"
  - ممنوع أهداف صاعدة على أسهم هابطة

المصدر الكنسي:
  - db/stocks.db (stocks + stock_daily_prices + market_indices)
  - حجم التداول = volume × close (قيمة بالجنيه)
  - متوسط الفترة = 20 يوم

Usage:
    python3 scripts/liquidity_radar_v2.py                    # كل أسهم EGX
    python3 scripts/liquidity_radar_v2.py --market TADAWUL   # سوق محدد
    python3 scripts/liquidity_radar_v2.py --json             # JSON output
    python3 scripts/liquidity_radar_v2.py --ticker COMI      # سهم واحد
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"

# Task BRAVO-RADAR-V2: استيراد قاموس تعريب القطاعات
import importlib.util as _ilu
_sector_arabic_path = Path(__file__).resolve().parent / "sector_arabic.py"
if _sector_arabic_path.exists():
    _spec = _ilu.spec_from_file_location("sector_arabic", _sector_arabic_path)
    _sector_mod = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(_sector_mod)
    arabize_sector = _sector_mod.arabize_sector
else:
    def arabize_sector(sector: Any) -> str:
        if not sector or not isinstance(sector, str):
            return 'متفرقات'
        return sector.strip()

# ─── الثوابت الكمية الصارمة ──────────────────────────────────────────────
LOOKBACK_DAYS = 20              # متوسط الفترة لصافي التدفق
MIN_CANDLES = 30                # أقل عدد شموع لازم للحكم
MIN_TURNOVER_EGP = 3_000_000    # حد السيولة الأدنى (3M EGP) — أقل من كده = ضعيف
MARKET_BEAR_THRESHOLD = -2.0    # لو المؤشر change% ≤ -2% → سوق هابط واضح
MARKET_BULL_THRESHOLD = 1.0     # لو المؤشر change% ≥ +1% → سوق صاعد
# لو بين -2% و +1% → عرضي

# ─── Task B-26: خريطة العملات + المؤشرات لكل سوق (Multi-Market SSOT) ──
# كل سوق ليه عملته الحقيقية + رمز مؤشره (مع fallbacks لو المؤشر مش في DB)
MARKET_CURRENCY_MAP = {
    'EGX': {'currency': 'ج.م', 'currency_ar': 'جنيه مصري', 'currency_en': 'EGP'},
    'TADAWUL': {'currency': 'ر.س', 'currency_ar': 'ريال سعودي', 'currency_en': 'SAR'},
    'KSE': {'currency': 'د.ك', 'currency_ar': 'دينار كويتي', 'currency_en': 'KWD'},
    'QSE': {'currency': 'ر.ق', 'currency_ar': 'ريال قطري', 'currency_en': 'QAR'},
    'US': {'currency': '$', 'currency_ar': 'دولار أمريكي', 'currency_en': 'USD'},
    'CRYPTO': {'currency': '$', 'currency_ar': 'دولار', 'currency_en': 'USD'},
    'GOLD': {'currency': '$', 'currency_ar': 'دولار', 'currency_en': 'USD'},
}

# خريطة السوق → قائمة مؤشرات محتملة (نجرّبهم بالترتيب لواحد لواحد)
MARKET_INDEX_FALLBACKS = {
    'EGX': ['EGX30', 'EGX70', 'EGX100', 'EGX50'],
    'TADAWUL': ['TASI', 'TADAWUL', 'Saudi', 'SPSI'],
    'KSE': ['KSE', 'Boursa Kuwait', 'Kuwait', 'KPW'],
    'QSE': ['QSE', 'QE', 'Qatar', 'QSI'],
    'US': ['SPX', 'DJI', 'IXIC', 'US'],
    'CRYPTO': ['BTC', 'CRYPTO'],
    'GOLD': ['XAU', 'GOLD'],
}


def get_market_currency(market: str) -> Dict[str, str]:
    """رجّع عملة السوق الحقيقية (SSOT)."""
    return MARKET_CURRENCY_MAP.get(market.upper(), MARKET_CURRENCY_MAP['EGX'])

# 3 مراحل بس (ممنوع أي تسميات تانية)
PHASE_ABSORBING = "بيبلع على الهادي"      # صافي تدفق موجب قوي + حجم فوق المتوسط
PHASE_PREPARING = "بيتحضر"                 # صافي تدفق موجب ضعيف/محايد + هيكل صاعد
PHASE_DISTRIBUTING = "بيصرف"               # صافي تدفق سالب
PHASE_INSUFFICIENT = "بيانات غير كافية"


def log(msg: str) -> None:
    print(f"[liquidity_radar_v2] {msg}", flush=True)


def _to_float(v: Any, default: float = 0.0) -> float:
    if v is None:
        return default
    try:
        return float(str(v).replace('−', '-').replace('،', '').strip())
    except (ValueError, TypeError):
        return default


# ─── 1. فلتر حالة السوق (إلزامي أولًا) ─────────────────────────────────────


def detect_market_regime(conn: sqlite3.Connection, market: str) -> Dict[str, Any]:
    """فلتر حالة السوق الإلزامي (SSOT — Single Source of Truth).

    Task B-25 fix: نحسب change_pct من (current_value, previous_close) بدل
    الاعتماد على حقل change_percent الفاسد في الـ DB (كان بيرجع -32.9%
    بينما القيمة الحقيقية -0.83%). ده يضمن إن كل المستهلكين (liquidity_radar
    + commercial_feed + daily_predictor) يشوفوا نفس النسبة الصحيحة.

    يرجع:
       - regime: 'صاعد' / 'هابط' / 'عرضي' / 'Risk-Off'
       - change_pct: تغير المؤشر المحسوب من current/previous (مش من DB field)
       - index_symbol: رمز المؤشر المستخدم
    """
    # Task B-26: جرّب كل المؤشرات في قائمة fallbacks بالترتيب
    index_candidates = MARKET_INDEX_FALLBACKS.get(market, ['EGX30'])
    row = None
    index_symbol_used = index_candidates[0] if index_candidates else 'EGX30'

    for cand in index_candidates:
        try:
            row = conn.execute("""
                SELECT symbol, current_value, previous_close, change_percent
                FROM market_indices
                WHERE symbol = ? OR name LIKE ?
                ORDER BY last_update DESC
                LIMIT 1
            """, (cand, f'%{cand}%')).fetchone()
            if row is not None:
                index_symbol_used = row[0] if row[0] else cand
                break
        except Exception:
            continue

    # العملة الحقيقية للسوق
    currency_info = get_market_currency(market)

    if row is None:
        # fallback: لو مفيش مؤشر، اعتبر السوق "عرضي" (محايد)
        return {
            'regime': 'عرضي',
            'regime_en': 'sideways',
            'change_pct': 0.0,
            'index_symbol': index_symbol_used,
            'currency': currency_info['currency'],
            'currency_ar': currency_info['currency_ar'],
            'reason': f'مؤشر {market} غير متاح في DB — افتراض عرضي محايد (عملة: {currency_info["currency_ar"]})',
            'is_bear': False,
            'is_bull': False,
        }

    # Task B-25 SSOT: احسب change_pct من current_value و previous_close
    # (لا تعتمد على change_percent field — فاسد في بعض الصفوف)
    current_value = _to_float(row[1])
    previous_close = _to_float(row[2])
    if current_value > 0 and previous_close > 0:
        change_pct = ((current_value - previous_close) / previous_close) * 100.0
    else:
        # fallback: حاول من آخر شمعتين في stock_daily_prices (نفس مصدر market_regime_engine)
        # ده يضمن توحيد 100% بين liquidity_radar + daily_predictor
        try:
            candle_rows = conn.execute("""
                SELECT close FROM stock_daily_prices
                WHERE ticker = ? AND COALESCE(close, 0) > 0
                ORDER BY price_date DESC LIMIT 2
            """, (index_symbol_used,)).fetchall()
            if len(candle_rows) >= 2:
                c1 = _to_float(candle_rows[0][0])
                c2 = _to_float(candle_rows[1][0])
                if c1 > 0 and c2 > 0:
                    change_pct = ((c1 - c2) / c2) * 100.0
                else:
                    change_pct = _to_float(row[3])
            else:
                change_pct = _to_float(row[3])
        except Exception:
            change_pct = _to_float(row[3])

    if change_pct <= MARKET_BEAR_THRESHOLD:
        regime = 'هابط'
        regime_en = 'bear'
        is_bear = True
        is_bull = False
        reason = f'مؤشر {row[0]} هابط {change_pct:.2f}% (≤ -{abs(MARKET_BEAR_THRESHOLD)}%) — سوق Risk-Off'
        # لو هابط بقوة أكبر من -3% → Risk-Off صريح
        if change_pct <= -3.0:
            regime = 'Risk-Off'
            regime_en = 'risk_off'
            reason = f'مؤشر {row[0]} هابط بقوة {change_pct:.2f}% — Risk-Off صريح'
    elif change_pct >= MARKET_BULL_THRESHOLD:
        regime = 'صاعد'
        regime_en = 'bull'
        is_bear = False
        is_bull = True
        reason = f'مؤشر {row[0]} صاعد {change_pct:.2f}% (≥ +{MARKET_BULL_THRESHOLD}%)'
    else:
        regime = 'عرضي'
        regime_en = 'sideways'
        is_bear = False
        is_bull = False
        reason = f'مؤشر {row[0]} عرضي {change_pct:.2f}% (بين -{abs(MARKET_BEAR_THRESHOLD)}% و +{MARKET_BULL_THRESHOLD}%)'

    return {
        'regime': regime,
        'regime_en': regime_en,
        'change_pct': round(change_pct, 2),
        'index_symbol': row[0],
        'currency': currency_info['currency'],
        'currency_ar': currency_info['currency_ar'],
        'reason': reason,
        'is_bear': is_bear,
        'is_bull': is_bull,
    }


# ─── 2. الحوت فين؟ (صافي الكاش المطلق) ────────────────────────────────────


def compute_whale_flow(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """حساب صافي التدفق المطلق (EGP) + مقارنة بالمتوسط.

    المنطق:
      - لكل يوم: buy_value ≈ volume × close (لو close > open) → شراء
                 sell_value ≈ volume × close (لو close < open) → بيع
                 محايد → نص للاتنين
      - net_flow = sum(buy_value) - sum(sell_value) لآخر 20 يوم
      - avg_flow = متوسط القيمة المطلقة اليومية
      - whale_present = net_flow > 0 AND net_flow > avg_flow × 0.5
    """
    if len(candles) < MIN_CANDLES:
        return {
            'net_flow_egp': 0,
            'avg_daily_flow_egp': 0,
            'whale_present': False,
            'flow_strength': 'بيانات غير كافية',
            'reason': f'أقل من {MIN_CANDLES} شمعة متاحة',
        }

    # آخر LOOKBACK_DAYS شمعة
    recent = candles[-LOOKBACK_DAYS:]
    buy_value_total = 0.0
    sell_value_total = 0.0
    daily_flows = []

    for c in recent:
        close = _to_float(c.get('close'))
        open_ = _to_float(c.get('open'))
        vol = _to_float(c.get('volume'))
        if close <= 0 or vol <= 0:
            continue
        daily_value = vol * close  # قيمة بالجنيه

        if close > open_:
            # يوم صاعد → أغلبية شراء
            buy_value_total += daily_value
            daily_flows.append(daily_value)
        elif close < open_:
            # يوم هابط → أغلبية بيع
            sell_value_total += daily_value
            daily_flows.append(-daily_value)
        else:
            # محايد → نص نص
            buy_value_total += daily_value * 0.5
            sell_value_total += daily_value * 0.5
            daily_flows.append(0.0)

    net_flow = buy_value_total - sell_value_total
    avg_daily_flow = sum(abs(f) for f in daily_flows) / len(daily_flows) if daily_flows else 0

    # قوة التدفق
    if avg_daily_flow <= 0:
        flow_strength = 'بيانات غير كافية'
        whale_present = False
    elif net_flow > 0 and net_flow > avg_daily_flow * 0.5:
        flow_strength = 'تدفق موجب قوي'
        whale_present = True
    elif net_flow > 0:
        flow_strength = 'تدفق موجب ضعيف'
        whale_present = False
    elif net_flow < 0 and abs(net_flow) > avg_daily_flow * 0.5:
        flow_strength = 'تدفق سالب قوي (تصريف)'
        whale_present = False
    else:
        flow_strength = 'تدفق سالب ضعيف'
        whale_present = False

    reason = (
        f"صافي التدفق {net_flow/1e6:+.1f}M EGP خلال {LOOKBACK_DAYS} يوم "
        f"(متوسط يومي {avg_daily_flow/1e6:.1f}M) — {flow_strength}"
    )

    return {
        'net_flow_egp': round(net_flow, 0),
        'avg_daily_flow_egp': round(avg_daily_flow, 0),
        'whale_present': whale_present,
        'flow_strength': flow_strength,
        'reason': reason,
    }


# ─── 3. المرحلة (3 حالات فقط) ────────────────────────────────────────────


def classify_phase(
    whale: Dict[str, Any],
    market: Dict[str, Any],
    candles: List[Dict[str, Any]],
    stock_info: Dict[str, Any],
) -> Dict[str, Any]:
    """تصنيف المرحلة — 3 حالات فقط (ممنوع Wyckoff).

    القواعد الكمية الصارمة:
      - لو السوق هابط/Risk-Off → ممنوع تجميع/Pre-Surge → "بيصرف" أو "بيانات غير كافية"
      - لو بيانات ناقصة → "بيانات غير كافية"
      - لو صافي التدفق سالب → "بيصرف"
      - لو صافي التدفق موجب قوي + حجم فوق المتوسط + السعر فوق MA50 → "بيبلع على الهادي"
      - لو صافي التدفق موجب ضعيف + هيكل صاعد (close > MA20) → "بيتحضر"
      - غير كده → "بيصرف" (افتراضي محافظ)
    """
    # 1. بيانات ناقصة
    if whale['flow_strength'] == 'بيانات غير كافية':
        return {
            'phase': PHASE_INSUFFICIENT,
            'reason': whale['reason'],
        }

    # 2. السوق هابط → ممنوع تجميع
    if market['is_bear']:
        # لو حتى التدفق سالب → تأكيد تصريف
        if whale['net_flow_egp'] < 0:
            return {
                'phase': PHASE_DISTRIBUTING,
                'reason': f"سوق هابط + صافي تدفق سالب ({whale['net_flow_egp']/1e6:.1f}M) — تصريف",
            }
        # لو التدفق موجب بس السوق هابط → برضه "بيصرف" (محافظ)
        return {
            'phase': PHASE_DISTRIBUTING,
            'reason': f"سوق هابط ({market['change_pct']:.2f}%) — ممنوع تجميع في Risk-Off",
        }

    # 3. صافي تدفق سالب → تصريف
    if whale['net_flow_egp'] < 0:
        return {
            'phase': PHASE_DISTRIBUTING,
            'reason': f"صافي تدفق سالب ({whale['net_flow_egp']/1e6:.1f}M EGP) — تصريف",
        }

    # 4. حساب هيكل السعر الأخير
    closes = [_to_float(c.get('close')) for c in candles if _to_float(c.get('close')) > 0]
    if len(closes) < 20:
        return {
            'phase': PHASE_INSUFFICIENT,
            'reason': 'أقل من 20 شمعة للحكم على الهيكل',
        }
    ma20 = sum(closes[-20:]) / 20
    last_close = closes[-1]

    # 5. التدفق موجب قوي + السعر فوق MA20 → "بيبلع على الهادي"
    if whale['whale_present'] and last_close > ma20:
        return {
            'phase': PHASE_ABSORBING,
            'reason': (
                f"تدفق موجب قوي ({whale['net_flow_egp']/1e6:.1f}M EGP) "
                f"+ السعر فوق MA20 ({ma20:.2f}) — بيبلع على الهادي"
            ),
        }

    # 6. التدفق موجب ضعيف + هيكل صاعد → "بيتحضر"
    if whale['net_flow_egp'] > 0 and last_close > ma20:
        return {
            'phase': PHASE_PREPARING,
            'reason': (
                f"تدفق موجب ضعيف ({whale['net_flow_egp']/1e6:.1f}M EGP) "
                f"+ السعر فوق MA20 ({ma20:.2f}) — بيتحضر"
            ),
        }

    # 7. افتراضي محافظ → تصريف
    return {
        'phase': PHASE_DISTRIBUTING,
        'reason': 'التدفق موجب بس السعر تحت MA20 — محافظ: تصريف',
    }


# ─── 4. مستوى الدخول والدفاع ──────────────────────────────────────────────


def compute_entry_defense(
    candles: List[Dict[str, Any]],
    stock_info: Dict[str, Any],
) -> Dict[str, Any]:
    """حساب مستوى الدخول + مستوى الدفاع (الكسر = خروج).

    المنطق:
      - entry_level = آخر close (سعر مرجعي)
      - defense_level = أدنى قاع في آخر 10 أيام (لو مفيش → support من stocks table)
      - لو السعر كسر defense_level → خروج
    """
    if len(candles) < 10:
        # fallback لـ support من stocks table
        support = _to_float(stock_info.get('support'))
        resistance = _to_float(stock_info.get('resistance'))
        last_close = _to_float(stock_info.get('current_price'))
        if last_close <= 0:
            return {
                'entry_level': None,
                'defense_level': None,
                'reason': 'بيانات غير كافية لحساب المستويات',
            }
        return {
            'entry_level': round(last_close, 4),
            'defense_level': round(support, 4) if support > 0 else round(last_close * 0.95, 4),
            'resistance_level': round(resistance, 4) if resistance > 0 else None,
            'reason': f'مستويات من جدول stocks (support={support:.2f}, resistance={resistance:.2f})',
        }

    recent = candles[-10:]
    lows = [_to_float(c.get('low')) for c in recent if _to_float(c.get('low')) > 0]
    highs = [_to_float(c.get('high')) for c in recent if _to_float(c.get('high')) > 0]
    closes = [_to_float(c.get('close')) for c in recent if _to_float(c.get('close')) > 0]

    if not lows or not closes:
        return {
            'entry_level': None,
            'defense_level': None,
            'reason': 'بيانات غير كافية لحساب المستويات',
        }

    last_close = closes[-1]
    recent_low = min(lows)
    recent_high = max(highs) if highs else last_close

    # support من stocks table كـ fallback أعمق
    table_support = _to_float(stock_info.get('support'))
    table_resistance = _to_float(stock_info.get('resistance'))

    # defense = أدنى قاع في آخر 10 أيام (لو أعمق من table support، خلي table support)
    defense = min(recent_low, table_support) if table_support > 0 else recent_low
    # resistance = أعلى قمة في آخر 10 أيام (لو table resistance أعلى، خليه)
    resistance = max(recent_high, table_resistance) if table_resistance > 0 else recent_high

    reason = (
        f"دخول مرجعي {last_close:.2f} | دفاع {defense:.2f} "
        f"(أدنى قاع 10 أيام) | مقاومة {resistance:.2f}"
    )

    return {
        'entry_level': round(last_close, 4),
        'defense_level': round(defense, 4),
        'resistance_level': round(resistance, 4),
        'reason': reason,
    }


# ─── فحص السيولة الأدنى ──────────────────────────────────────────────────


def check_liquidity(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """فحص السيولة الأدنى. لو متوسط القيمة اليومية < 3M EGP → ضعيف."""
    if len(candles) < MIN_CANDLES:
        return {'liquid': False, 'reason': f'أقل من {MIN_CANDLES} شمعة'}

    recent = candles[-LOOKBACK_DAYS:]
    daily_values = []
    for c in recent:
        close = _to_float(c.get('close'))
        vol = _to_float(c.get('volume'))
        if close > 0 and vol > 0:
            daily_values.append(close * vol)

    if not daily_values:
        return {'liquid': False, 'reason': 'مفيش بيانات حجم'}

    avg_turnover = sum(daily_values) / len(daily_values)
    if avg_turnover < MIN_TURNOVER_EGP:
        return {
            'liquid': False,
            'reason': f'سيولة ضعيفة (متوسط {avg_turnover/1e6:.2f}M EGP < {MIN_TURNOVER_EGP/1e6}M)',
            'avg_turnover_egp': round(avg_turnover, 0),
        }

    return {
        'liquid': True,
        'reason': f'سيولة كافية (متوسط {avg_turnover/1e6:.2f}M EGP)',
        'avg_turnover_egp': round(avg_turnover, 0),
    }


# ─── المسح الكامل ──────────────────────────────────────────────────────────


def scan_ticker(conn: sqlite3.Connection, ticker: str, market: str, market_regime: Dict[str, Any]) -> Dict[str, Any]:
    """امسح سهم واحد ورجّع الـ 4 أعمدة."""
    # جلب بيانات السهم
    stock_row = conn.execute("""
        SELECT ticker, name, name_ar, market, sector, current_price,
               support, resistance, ma_50, ma_200, rsi, change_percent
        FROM stocks
        WHERE ticker = ? AND market = ?
    """, (ticker, market)).fetchone()

    if stock_row is None:
        return {
            'ticker': ticker,
            'market': market,
            'whale': {'whale_present': False, 'reason': 'السهم غير موجود'},
            'market_regime': market_regime,
            'phase': PHASE_INSUFFICIENT,
            'entry_defense': {'entry_level': None, 'defense_level': None},
            'reason': 'السهم غير موجود في قاعدة البيانات',
        }

    # بناء dict من stock_row باستخدام أسماء الأعمدة الصحيحة من الاستعلام الأول
    col_names = ['ticker', 'name', 'name_ar', 'market', 'sector', 'current_price',
                 'support', 'resistance', 'ma_50', 'ma_200', 'rsi', 'change_percent']
    stock_info = dict(zip(col_names, stock_row))

    # جلب الشموع
    candle_rows = conn.execute("""
        SELECT price_date, open, high, low, close, volume
        FROM stock_daily_prices
        WHERE ticker = ? AND COALESCE(close, 0) > 0 AND COALESCE(volume, 0) > 0
        ORDER BY price_date ASC
    """, (ticker,)).fetchall()
    candles = [dict(zip(['price_date', 'open', 'high', 'low', 'close', 'volume'], r)) for r in candle_rows]

    # 0. فحص السيولة أولًا
    liquidity = check_liquidity(candles)
    if not liquidity['liquid']:
        return {
            'ticker': ticker,
            'name': stock_info.get('name_ar') or stock_info.get('name') or ticker,
            'market': market,
            'sector': arabize_sector(stock_info.get('sector', '')),
            'whale': {
                'net_flow_egp': 0,
                'avg_daily_flow_egp': 0,
                'whale_present': False,
                'flow_strength': 'سيولة ضعيفة',
                'reason': liquidity['reason'],
            },
            'market_regime': market_regime,
            'phase': PHASE_INSUFFICIENT,
            'entry_defense': {'entry_level': None, 'defense_level': None, 'reason': 'سيولة ضعيفة'},
            'reason': f'سيولة ضعيفة — {liquidity["reason"]}',
        }

    # 1. الحوت فين؟
    whale = compute_whale_flow(candles)

    # 2. حالة السوق (تم حسابها مسبقًا)
    # market_regime passed in

    # 3. المرحلة
    phase_info = classify_phase(whale, market_regime, candles, stock_info)

    # 4. مستوى الدخول والدفاع
    entry_defense = compute_entry_defense(candles, stock_info)

    # السبب المختصر (جملة واحدة)
    short_reason = (
        f"{phase_info['reason']} | {whale['reason']}"
    )

    return {
        'ticker': ticker,
        'name': stock_info.get('name_ar') or stock_info.get('name') or ticker,
        'market': market,
        'sector': arabize_sector(stock_info.get('sector', '')),
        'whale': whale,
        'market_regime': market_regime,
        'phase': phase_info['phase'],
        'phase_reason': phase_info['reason'],
        'entry_defense': entry_defense,
        'reason': short_reason,
    }


def scan_market(market: str, tickers: Optional[List[str]] = None) -> Dict[str, Any]:
    """امسح سوق كامل ورجّع الـ 4 أعمدة لكل سهم."""
    if not STOCKS_DB.exists():
        return {'success': False, 'error': f'stocks.db غير موجود: {STOCKS_DB}'}

    conn = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    # 1. فلتر حالة السوق (إلزامي أولًا)
    market_regime = detect_market_regime(conn, market)
    log(f"حالة السوق ({market}): {market_regime['regime']} — {market_regime['reason']}")

    # 2. جلب قائمة الأسهم
    if tickers:
        ticker_list = tickers
    else:
        rows = conn.execute("""
            SELECT ticker FROM stocks
            WHERE market = ? AND is_active = 1 AND current_price IS NOT NULL AND current_price > 0
            ORDER BY ticker
        """, (market,)).fetchall()
        ticker_list = [r[0] for r in rows]

    log(f"جاري مسح {len(ticker_list)} سهم في سوق {market}...")

    results = []
    for i, ticker in enumerate(ticker_list):
        if (i + 1) % 50 == 0:
            log(f"  {i+1}/{len(ticker_list)}...")
        result = scan_ticker(conn, ticker, market, market_regime)
        results.append(result)

    conn.close()

    # إحصائيات سريعة
    phases = {}
    for r in results:
        p = r['phase']
        phases[p] = phases.get(p, 0) + 1

    return {
        'success': True,
        'market': market,
        'market_regime': market_regime,
        'scanned_count': len(results),
        'phases_breakdown': phases,
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'stocks': results,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="رادار السيولة الصارم — 4 أعمدة فقط")
    parser.add_argument('--market', type=str, default='EGX', help='السوق (EGX, TADAWUL, KSE, QSE)')
    parser.add_argument('--ticker', type=str, default=None, help='سهم محدد')
    parser.add_argument('--json', action='store_true', help='JSON output')
    args = parser.parse_args()

    tickers = [args.ticker] if args.ticker else None
    result = scan_market(args.market, tickers)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, default=str, indent=2))
    else:
        log("=" * 70)
        log("🛰️ رادار السيولة الصارم — 4 أعمدة فقط")
        log("=" * 70)
        mr = result.get('market_regime', {})
        log(f"السوق: {result.get('market')} | حالة السوق: {mr.get('regime')} ({mr.get('change_pct')}%)")
        log(f"السبب: {mr.get('reason')}")
        log(f"إجمالي الأسهم: {result.get('scanned_count')}")
        log(f"توزيع المراحل: {result.get('phases_breakdown')}")
        log("")
        log("أول 10 أسهم:")
        for s in result.get('stocks', [])[:10]:
            log(f"  {s['ticker']:10} | {s['phase']:25} | تدفق={s['whale'].get('net_flow_egp',0)/1e6:+.1f}M | دخول={s['entry_defense'].get('entry_level')} | دفاع={s['entry_defense'].get('defense_level')}")
            log(f"    السبب: {s['reason'][:120]}")
        log("")

    return 0


if __name__ == '__main__':
    sys.exit(main())
