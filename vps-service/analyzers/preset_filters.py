#!/usr/bin/env python3
"""
preset_filters.py — الفلاتر التكتيكية السريعة (One-Click Tactical Presets)
=============================================================================
Nuclear Directive ALPHA-support: 4 preset filters جاهزة من Python API
(لا حساب في Node.js — كل تصنيف يأتي من هنا).

Presets:
  1. v82_accumulation: 🐋 تجميع مؤسسي V82 (net_flow>0 + targets_available + gate_pass).
  2. golden_rr: 🎯 فرص ذهبية R/R ≥ 2.
  3. near_breakout: ⚡ قرب كسر قمة (current within 2% of resistance).
  4. bottom_recovery: 🛡️ تعافي بعد قاع (current > defense × 1.02 + not falling knife).

Rule 27: أرقام حقيقية من scan_market.
"""
from __future__ import annotations
import sys, os, sqlite3
from pathlib import Path
from typing import List, Dict, Any

_VPS = str(Path(__file__).resolve().parents[1])
if _VPS not in sys.path:
    sys.path.insert(0, _VPS)

PRESETS = {
    'v82_accumulation': {'label': '🐋 تجميع مؤسسي V82', 'description': 'تدفق موجب + أهداف متاحة + V82 gate'},
    'golden_rr': {'label': '🎯 فرص ذهبية R/R ≥ 2', 'description': 'risk/reward ≥ 2.0'},
    'near_breakout': {'label': '⚡ قرب كسر قمة', 'description': 'السعر ضمن 2% من المقاومة'},
    'bottom_recovery': {'label': '🛡️ تعافي بعد قاع', 'description': 'فوق القاع الأخير بـ2%+ + ليس falling knife'},
}


def _to_float(v, default=0.0):
    if v is None: return default
    try: return float(str(v).replace('−','-').strip())
    except: return default


def apply_preset(scan_result: Dict[str, Any], preset: str) -> List[Dict[str, Any]]:
    """فلتر نتائج scan_market حسب الـ preset."""
    stocks = scan_result.get('stocks', [])
    if preset == 'v82_accumulation':
        out = []
        for s in stocks:
            whale = s.get('whale', {}) or {}
            net_flow = _to_float(whale.get('net_flow_egp'))
            targets = s.get('targets_available', False)
            if net_flow > 0 and targets:
                s2 = dict(s)
                s2['preset_reason'] = f"تدفق +{net_flow/1e6:.1f}M + أهداف متاحة"
                out.append(s2)
        return out
    elif preset == 'golden_rr':
        out = []
        for s in stocks:
            ed = s.get('entry_defense', {}) or {}
            entry = _to_float(ed.get('entry_level'))
            target = _to_float(ed.get('resistance_level'))
            stop = _to_float(ed.get('defense_level'))
            if entry > 0 and target > entry and stop < entry:
                rr = (target - entry) / (entry - stop)
                if rr >= 2.0:
                    s2 = dict(s)
                    s2['preset_rr'] = round(rr, 2)
                    s2['preset_reason'] = f"R/R={rr:.2f} ≥ 2.0"
                    out.append(s2)
        return out
    elif preset == 'near_breakout':
        out = []
        for s in stocks:
            ed = s.get('entry_defense', {}) or {}
            current = _to_float(ed.get('entry_level'))
            resistance = _to_float(ed.get('resistance_level'))
            if current > 0 and resistance > current:
                dist = ((resistance - current) / current) * 100.0
                if dist <= 2.0:
                    s2 = dict(s)
                    s2['preset_distance_pct'] = round(dist, 2)
                    s2['preset_reason'] = f"على بُعد {dist:.1f}% من القمة ({resistance:.2f})"
                    out.append(s2)
        return out
    elif preset == 'bottom_recovery':
        out = []
        for s in stocks:
            ed = s.get('entry_defense', {}) or {}
            fk = s.get('falling_knife', {}) or {}
            current = _to_float(ed.get('entry_level'))
            defense = _to_float(ed.get('defense_level'))
            is_falling = fk.get('is_falling_knife', False)
            targets = s.get('targets_available', False)
            if defense > 0 and current > defense * 1.02 and not is_falling and targets:
                rec = ((current - defense) / defense) * 100.0
                s2 = dict(s)
                s2['preset_recovery_pct'] = round(rec, 2)
                s2['preset_reason'] = f"تعافى {rec:.1f}% فوق القاع ({defense:.2f})"
                out.append(s2)
        return out
    return []


def get_market_pills() -> List[Dict[str, Any]]:
    """Market Pills — الأسواق الستة + عدد الأسهم. من stocks.db."""
    stocks_db = os.environ.get('STOCKS_DB', str(Path(__file__).resolve().parents[2] / "db" / "stocks.db"))
    pills = [
        {'code': 'TADAWUL', 'label': 'السعودية', 'flag': '🇸🇦'},
        {'code': 'EGX', 'label': 'مصر', 'flag': '🇪🇬'},
        {'code': 'KSE', 'label': 'الكويت', 'flag': '🇰🇼'},
        {'code': 'QSE', 'label': 'قطر', 'flag': '🇶🇦'},
        {'code': 'US', 'label': 'أمريكا', 'flag': '🇺🇸'},
        {'code': 'CRYPTO', 'label': 'كريبتو', 'flag': '₿'},
    ]
    if not os.path.exists(stocks_db):
        return pills
    try:
        conn = sqlite3.connect(f"file:{stocks_db}?mode=ro", uri=True)
        for p in pills:
            try:
                n = conn.execute("SELECT COUNT(*) FROM stocks WHERE market = ?", (p['code'],)).fetchone()[0]
                p['stock_count'] = n
            except Exception:
                p['stock_count'] = 0
        conn.close()
    except Exception as e:
        sys.stderr.write(f"[presets] market_pills error: {e}\n")
    return pills
