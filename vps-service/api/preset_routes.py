#!/usr/bin/env python3
"""
preset_routes.py — مسارات API للفلاتر التكتيكية + Market Pills
=================================================================
Nuclear Directive ALPHA-support:
  GET /api/markets/pills — الأسواق الستة + عدد الأسهم.
  GET /api/presets/{market}/{preset} — الأسهم المُفلترة جاهزة (لا حساب في Node).

FastAPI router — يُركّب في main.py: app.include_router(preset_router).
Rule 27: أرقام حقيقية. لا وهم.

Standalone test:
    python3 vps-service/api/preset_routes.py --market EGX --preset golden_rr
"""
from __future__ import annotations
import os, sys, json
from pathlib import Path
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))
os.environ.setdefault('STOCKS_DB', str(PROJECT_ROOT / "db" / "stocks.db"))
os.environ.setdefault('DATA_ENGINE_DB', str(PROJECT_ROOT / "db" / "data_engine.db"))

# BRAVO Directive: unified responses + financial fields + ro DB.
from api.standard_responses import (
    standard_error, standard_success, enrich_opportunity,
    verify_market, SUPPORTED_MARKETS, ro_connect, ro_query,
)

router = APIRouter(prefix="/api", tags=["Preset Filters + Market Pills"])


class PresetResult(BaseModel):
    market: str
    preset: str
    preset_label: str
    count: int
    stocks: List[Dict[str, Any]]


@router.get("/markets/pills")
def market_pills() -> Dict[str, Any]:
    """Market Pills — الأسواق الستة + عدد الأسهم (لشريط الأزرار العلوي)."""
    from analyzers.preset_filters import get_market_pills
    try:
        pills = get_market_pills()
        return standard_success(pills, count=len(pills))
    except Exception as e:
        import sys; sys.stderr.write(f"[api] market_pills error: {e}\n")
        return standard_error()


@router.get("/presets/{market}/{preset}")
def get_preset_stocks(market: str, preset: str) -> Dict[str, Any]:
    """الأسهم المُفلترة حسب الـ preset (جاهزة من Python — لا حساب في Node).
    Unified fields: rr_ratio, risk_level, trend_direction, institutional_volume_pct."""
    from analyzers.preset_filters import apply_preset, PRESETS
    from liquidity_radar_v2 import scan_market
    if not verify_market(market):
        return standard_error(f"السوق {market} غير مدعوم — الأسواق: {SUPPORTED_MARKETS}", "unsupported_market")
    if preset not in PRESETS:
        return standard_error(f"الفلتر {preset} غير معروف — المتاح: {list(PRESETS)}", "unknown_preset")
    try:
        result = scan_market(market)
        filtered = apply_preset(result, preset)
        # enrich with unified financial fields + compact output.
        compact = []
        for s in filtered:
            ed = s.get('entry_defense', {}) or {}
            w = s.get('whale', {}) or {}
            f = s.get('fundamentals', {}) or {}
            enriched = enrich_opportunity(dict(s))
            compact.append({
                'ticker': s.get('ticker'), 'name': s.get('name'),
                'price': ed.get('entry_level'), 'defense': ed.get('defense_level'),
                'resistance': ed.get('resistance_level'),
                'net_flow_m': round(_to_float(w.get('net_flow_egp')) / 1e6, 1),
                'free_cf_b': round(_to_float(f.get('free_cash_flow')) / 1e9, 2) if f.get('free_cash_flow') else None,
                'tv_whale': s.get('tv_whale_spotted', False),
                'targets_available': s.get('targets_available', False),
                'preset_reason': s.get('preset_reason', ''),
                'preset_rr': s.get('preset_rr'),
                'preset_distance_pct': s.get('preset_distance_pct'),
                'preset_recovery_pct': s.get('preset_recovery_pct'),
                # BRAVO Directive: unified financial fields.
                'rr_ratio': enriched.get('rr_ratio'),
                'risk_level': enriched.get('risk_level'),
                'trend_direction': enriched.get('trend_direction'),
                'institutional_volume_pct': enriched.get('institutional_volume_pct'),
            })
        return standard_success(compact, market=market, preset=preset,
                                preset_label=PRESETS[preset]['label'], count=len(compact))
    except Exception as e:
        import sys; sys.stderr.write(f"[api] presets error: {e}\n")
        return standard_error()


def _to_float(v, default=0.0):
    if v is None: return default
    try: return float(str(v).replace('−','-').strip())
    except: return default


# Standalone CLI test (no server).
def main():
    import argparse
    p = argparse.ArgumentParser(description='Preset Filters + Market Pills (Nuclear Directive ALPHA-support)')
    p.add_argument('--market', default='EGX')
    p.add_argument('--preset', default=None, help='v82_accumulation|golden_rr|near_breakout|bottom_recovery')
    p.add_argument('--pills', action='store_true', help='print market pills')
    args = p.parse_args()
    if args.pills:
        from analyzers.preset_filters import get_market_pills
        pills = get_market_pills()
        print(json.dumps(pills, ensure_ascii=False, indent=2))
        return 0
    if args.preset:
        from analyzers.preset_filters import apply_preset, PRESETS
        from liquidity_radar_v2 import scan_market
        result = scan_market(args.market)
        filtered = apply_preset(result, args.preset)
        label = PRESETS.get(args.preset, {}).get('label', args.preset)
        print(f"\n{label} — {args.market}: {len(filtered)} سهم")
        for s in filtered[:10]:
            ed = s.get('entry_defense', {}) or {}
            print(f"  {s.get('ticker','?'):8} | دخول={ed.get('entry_level')} | {s.get('preset_reason','')}")
        return 0
    p.print_help()
    return 1


if __name__ == '__main__':
    sys.exit(main())

# Flask Blueprint compatibility for lightweight_server.py
try:
    from flask import Blueprint, jsonify, request
    preset_bp = Blueprint('preset_routes', __name__)

    @preset_bp.route('/api/markets/pills', methods=['GET'])
    def flask_market_pills():
        return jsonify(market_pills())

    @preset_bp.route('/api/presets/<market>/<preset>', methods=['GET'])
    def flask_preset_stocks(market, preset):
        try:
            res = get_preset_stocks(market, preset)
            return jsonify(res)
        except Exception as e:
            status_code = getattr(e, 'status_code', 500)
            detail = getattr(e, 'detail', str(e))
            return jsonify({'error': detail}), status_code
except ImportError:
    preset_bp = None
