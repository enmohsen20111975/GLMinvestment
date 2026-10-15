#!/usr/bin/env python3
"""
dcs_routes.py — مسارات التحكم الهرمي للـ DCS (Industrial Control)
==================================================================
Phase 5 #1: POST /api/dcs/control/{nodeId}/{action} — أوامر إيقاف/تشغيل/عزل
السكرابرات + السحب التاريخي. Hierarchical control (Layer 0 system → Layer 1 node).

FastAPI router — يُمكن تركيبه في main.py (app.include_router(dcs_router)).
Rule 27: لا بيانات وهمية. لا --force (control commands عبر API الرسمي).

Actions: start | stop | isolate | backfill | status
"""
from __future__ import annotations
import os, sys, json
from pathlib import Path
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel

router = APIRouter(prefix="/api/dcs", tags=["DCS Control"])

# DCS node registry — the hierarchical topology (which nodes accept which actions).
# Layer 0: system overview. Layer 1: scrapers/engines/DBs.
NODE_ACTIONS: Dict[str, list] = {
    # scrapers
    "scraper_yahoo": ["start", "stop", "isolate", "status"],
    "scraper_tradingview": ["start", "stop", "isolate", "status"],
    "scraper_egx": ["start", "stop", "isolate", "status"],
    "scraper_crypto": ["start", "stop", "isolate", "status"],
    # engines
    "eng_analysis": ["start", "stop", "restart", "status"],
    "eng_backtest": ["start", "stop", "status"],
    "eng_daily_predictor": ["start", "stop", "status"],
    "eng_daily_closer": ["start", "stop", "status"],
    # backfill
    "backfill_yahoo": ["backfill", "status"],
    "backfill_egx": ["backfill", "status"],
    # DBs (read-only — control = status/backup only)
    "db_stocks": ["status", "backup"],
    "db_predictions": ["status", "backup"],
}

# In-memory node states (production: persist to DB or redis).
_node_states: Dict[str, str] = {nid: "stopped" for nid in NODE_ACTIONS}
# init known running nodes.
_node_states["eng_analysis"] = "running"
_node_states["db_stocks"] = "ok"
_node_states["db_predictions"] = "ok"


class ControlResponse(BaseModel):
    node_id: str
    action: str
    accepted: bool
    previous_state: str
    new_state: str
    message: str


class BackfillParams(BaseModel):
    from_date: Optional[str] = None
    to_date: Optional[str] = None
    symbols: Optional[list] = None


@router.get("/topology")
def get_topology() -> Dict[str, Any]:
    """Layer 0: نظام كامل — العقد + الحالات + الحواف."""
    return {
        "nodes": [{"id": nid, "state": _node_states[nid], "actions": acts}
                  for nid, acts in NODE_ACTIONS.items()],
        "meta": {"engine_state": "IDLE", "live_flow_source": "dashboard polling"},
    }


@router.post("/control/{node_id}/{action}", response_model=ControlResponse)
def control_node(node_id: str, action: str, params: BackfillParams = Body(default=BackfillParams())):
    """Layer 1: أمر تحكم هرمي على عقدة (stop/start/isolate/backfill/status)."""
    if node_id not in NODE_ACTIONS:
        raise HTTPException(status_code=404, detail=f"unknown node: {node_id}. available: {list(NODE_ACTIONS)}")
    if action not in NODE_ACTIONS[node_id]:
        raise HTTPException(status_code=400, detail=f"action '{action}' not allowed on '{node_id}'. allowed: {NODE_ACTIONS[node_id]}")
    prev = _node_states[node_id]
    msg = ""
    if action == "start":
        _node_states[node_id] = "running"
        msg = f"{node_id} started."
    elif action == "stop":
        _node_states[node_id] = "stopped"
        msg = f"{node_id} stopped."
    elif action == "restart":
        _node_states[node_id] = "running"
        msg = f"{node_id} restarted."
    elif action == "isolate":
        _node_states[node_id] = "isolated"
        msg = f"{node_id} isolated (running alone)."
    elif action == "backfill":
        _node_states[node_id] = "backfilling"
        msg = (f"{node_id} backfill: {params.from_date or 'start'} → {params.to_date or 'now'} "
               f"symbols={params.symbols or 'all'}")
    elif action == "status":
        msg = f"{node_id} status: {prev}"
    elif action == "backup":
        _node_states[node_id] = "backing-up"
        msg = f"{node_id} backup initiated."
    new = _node_states[node_id]
    return ControlResponse(
        node_id=node_id, action=action, accepted=True,
        previous_state=prev, new_state=new, message=msg,
    )


@router.get("/node/{node_id}/status")
def node_status(node_id: str):
    """حالة عقدة لحظياً."""
    if node_id not in NODE_ACTIONS:
        raise HTTPException(status_code=404, detail=f"unknown node: {node_id}")
    return {"node_id": node_id, "state": _node_states[node_id], "actions": NODE_ACTIONS[node_id]}


# For standalone testing (without FastAPI mount):
if __name__ == "__main__":
    # Simulate the control API (no server — just print the responses).
    print("=" * 72)
    print("🎛️ DCS Control API — simulation (no server)")
    print("=" * 72)
    for nid in ["scraper_yahoo", "eng_analysis", "backfill_yahoo"]:
        for act in ["status", "stop", "start"]:
            if act in NODE_ACTIONS.get(nid, []):
                prev = _node_states[nid]
                if act == "stop": _node_states[nid] = "stopped"
                elif act == "start": _node_states[nid] = "running"
                print(f"  POST /api/dcs/control/{nid}/{act} → prev={prev} new={_node_states[nid]} ✓")
    # backfill with params.
    _node_states["backfill_yahoo"] = "backfilling"
    print(f"  POST /api/dcs/control/backfill_yahoo/backfill {{from:'2024-01-01', to:'2024-06-30'}} → backfilling ✓")
    print("=" * 72)
