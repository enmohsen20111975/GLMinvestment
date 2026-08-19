# DEPRECATED: This route is not registered in lightweight_server.py
#!/usr/bin/env python3
"""
V2 Analysis Engine Routes
==========================
API Routes للمحرك التحليلي V2 - Plugin-Based

Endpoints:
- POST /api/v2/analyze                    → Run analysis on a ticker
- GET  /api/v2/day-trading-opportunities  → Get daily trading opportunities
- PUT  /api/v2/pipeline/<name>/engine/<engine>/toggle  → Toggle engine ON/OFF
- PUT  /api/v2/pipeline/<name>/engine/<engine>/weight  → Set engine weight
- GET  /api/v2/pipeline/<name>/summary    → Get pipeline configuration
- POST /api/v2/pipeline/save-preset       → Save current config as preset
- POST /api/v2/pipeline/load              → Load a preset
- GET  /api/v2/pipelines                  → List all pipelines
- GET  /api/v2/engines                    → List available engines

Author: دليل الاستثمار - M2Y Developers
"""

import sys
import json
from datetime import datetime
from pathlib import Path
from typing import Dict

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from flask import Blueprint, request, jsonify

# Import the orchestrator
from analysis_engine_v2 import get_orchestrator, AnalysisOrchestrator, PRESETS


# ============================================================================
# BLUEPRINT
# ============================================================================

v2_analytics_bp = Blueprint('v2_analytics', __name__, url_prefix='/api/v2')


# ============================================================================
# ANALYSIS ENDPOINT
# ============================================================================

@v2_analytics_bp.route('/analyze', methods=['POST'])
def analyze():
    """
    Run analysis on a ticker using specified pipeline.
    
    Body: {"ticker": "ABUK", "pipeline": "egx_aggressive", "stock_data": {...}}
    Returns: {"signal": "BUY", "score": 7.5, "confidence": 85, "engines": [...]}
    """
    try:
        data = request.get_json(force=True)
        ticker = data.get('ticker', '').strip().upper()
        pipeline = data.get('pipeline', 'egx_balanced')
        stock_data = data.get('stock_data', {})
        
        if not ticker:
            return jsonify({
                "success": False,
                "error": "Ticker is required",
            }), 400
        
        orchestrator = get_orchestrator()
        result = orchestrator.analyze(ticker, pipeline, stock_data)
        
        return jsonify({
            "success": True,
            "data": result,
        })
    
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
        }), 500


# ============================================================================
# DAY TRADING OPPORTUNITIES
# ============================================================================

@v2_analytics_bp.route('/day-trading-opportunities', methods=['GET'])
def day_trading_opportunities():
    """
    Get daily trading opportunities.
    
    Query params:
    - market: "egx" or "crypto" (default: "egx")
    - pipeline: pipeline name (default: "egx_aggressive")
    - min_score: minimum score threshold (default: 6.0)
    - force: force rescan (default: false)
    """
    try:
        from analyzers.day_trading_scanner import DayTradingScanner
        
        market = request.args.get('market', 'egx')
        pipeline = request.args.get('pipeline', 'egx_aggressive')
        min_score = float(request.args.get('min_score', '6.0'))
        force = request.args.get('force', 'false').lower() == 'true'
        
        scanner = DayTradingScanner(pipeline_name=pipeline)
        
        # Check cache first (unless force rescan)
        if not force:
            cached = scanner.get_cached_results()
            if cached and cached.get('opportunities'):
                # Check if cache is fresh (< 15 minutes)
                scan_time = cached.get('scan_time', '')
                if scan_time:
                    try:
                        scan_dt = datetime.fromisoformat(scan_time)
                        age = (datetime.now() - scan_dt).total_seconds()
                        if age < 900:  # 15 minutes
                            return jsonify({
                                "success": True,
                                "data": cached,
                                "cached": True,
                                "cache_age_seconds": int(age),
                            })
                    except:
                        pass
        
        # Run fresh scan
        results = scanner.scan(market=market, pipeline_name=pipeline, min_score=min_score)
        
        return jsonify({
            "success": True,
            "data": {
                "market": market,
                "pipeline": pipeline,
                "scan_time": scanner.last_scan_time,
                "count": len(results),
                "opportunities": results,
            },
            "cached": False,
        })
    
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
        }), 500


# ============================================================================
# PIPELINE MANAGEMENT
# ============================================================================

@v2_analytics_bp.route('/pipeline/<pipeline_name>/engine/<engine_name>/toggle', methods=['PUT'])
def toggle_engine(pipeline_name, engine_name):
    """
    Toggle an engine ON/OFF in a pipeline.
    
    Body: {"enabled": true/false}
    """
    try:
        data = request.get_json(force=True)
        enabled = data.get('enabled', True)
        
        orchestrator = get_orchestrator()
        result = orchestrator.toggle_engine(pipeline_name, engine_name, enabled)
        
        if result.get('success'):
            return jsonify({"success": True, "data": result})
        else:
            return jsonify({"success": False, "error": result.get('error', 'Unknown error')}), 404
    
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v2_analytics_bp.route('/pipeline/<pipeline_name>/engine/<engine_name>/weight', methods=['PUT'])
def set_engine_weight(pipeline_name, engine_name):
    """
    Set the weight of an engine in a pipeline.
    
    Body: {"weight": 1.5}
    """
    try:
        data = request.get_json(force=True)
        weight = float(data.get('weight', 1.0))
        
        orchestrator = get_orchestrator()
        result = orchestrator.set_engine_weight(pipeline_name, engine_name, weight)
        
        if result.get('success'):
            return jsonify({"success": True, "data": result})
        else:
            return jsonify({"success": False, "error": result.get('error', 'Unknown error')}), 404
    
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v2_analytics_bp.route('/pipeline/<pipeline_name>/summary', methods=['GET'])
def pipeline_summary(pipeline_name):
    """Get summary of a pipeline configuration."""
    try:
        orchestrator = get_orchestrator()
        result = orchestrator.get_pipeline_summary(pipeline_name)
        
        if result.get('success'):
            return jsonify({"success": True, "data": result})
        else:
            return jsonify({"success": False, "error": result.get('error', 'Unknown error')}), 404
    
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v2_analytics_bp.route('/pipeline/save-preset', methods=['POST'])
def save_preset():
    """
    Save current pipeline state as a new preset.
    
    Body: {"pipeline": "egx_aggressive", "preset_name": "My Custom Preset"}
    """
    try:
        data = request.get_json(force=True)
        pipeline_name = data.get('pipeline', '')
        preset_name = data.get('preset_name', '')
        
        if not pipeline_name or not preset_name:
            return jsonify({
                "success": False,
                "error": "Both 'pipeline' and 'preset_name' are required",
            }), 400
        
        orchestrator = get_orchestrator()
        result = orchestrator.save_preset(pipeline_name, preset_name)
        
        if result.get('success'):
            return jsonify({"success": True, "data": result})
        else:
            return jsonify({"success": False, "error": result.get('error', 'Unknown error')}), 404
    
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v2_analytics_bp.route('/pipeline/load', methods=['POST'])
def load_preset():
    """
    Load a preset configuration.
    
    Body: {"preset_name": "egx_aggressive"}
    """
    try:
        data = request.get_json(force=True)
        preset_name = data.get('preset_name', data.get('pipeline', ''))
        
        if not preset_name:
            return jsonify({
                "success": False,
                "error": "preset_name is required",
            }), 400
        
        orchestrator = get_orchestrator()
        result = orchestrator.load_preset(preset_name)
        
        if result.get('success'):
            return jsonify({"success": True, "data": result})
        else:
            return jsonify({"success": False, "error": result.get('error', 'Unknown error')}), 404
    
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ============================================================================
# LIST ENDPOINTS
# ============================================================================

@v2_analytics_bp.route('/pipelines', methods=['GET'])
def list_pipelines():
    """List all available pipelines."""
    try:
        orchestrator = get_orchestrator()
        pipelines = orchestrator.list_pipelines()
        return jsonify({"success": True, "data": pipelines})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@v2_analytics_bp.route('/engines', methods=['GET'])
def list_engines():
    """List all available engine types."""
    from analysis_engine_v2 import AnalysisOrchestrator
    
    engines = []
    for name, engine_class in AnalysisOrchestrator.ENGINE_MAP.items():
        instance = engine_class()
        engines.append(instance.to_dict())
    
    return jsonify({"success": True, "data": engines})


@v2_analytics_bp.route('/presets', methods=['GET'])
def list_presets():
    """List all available presets with their configurations."""
    presets = []
    for name, config in PRESETS.items():
        presets.append(config.to_dict())
    
    # Include custom presets
    orchestrator = get_orchestrator()
    for name, config in orchestrator.custom_presets.items():
        if name not in PRESETS:
            presets.append(config.to_dict())
    
    return jsonify({"success": True, "data": presets})


# ============================================================================
# HEALTH CHECK
# ============================================================================

@v2_analytics_bp.route('/health', methods=['GET'])
def health():
    """Health check for the V2 analysis engine."""
    try:
        orchestrator = get_orchestrator()
        pipelines_count = len(orchestrator.pipelines)
        
        return jsonify({
            "success": True,
            "status": "healthy",
            "pipelines_count": pipelines_count,
            "engines_count": len(AnalysisOrchestrator.ENGINE_MAP),
            "timestamp": datetime.now().isoformat(),
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "status": "unhealthy",
            "error": str(e),
        }), 500
