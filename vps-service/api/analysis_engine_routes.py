# DEPRECATED: This route is not registered in lightweight_server.py
#!/usr/bin/env python3
"""
Analysis Engine Configuration Routes
======================================
يتحكم في إعدادات محرك التحليل (ON/OFF + وزن لكل محرك)

المحركات الأربعة:
- Fundamental (التحليل الأساسي)
- Technical (التحليل الفني)
- Candlestick (الشموع اليابانية)
- MeanRev (العودة للمتوسط)

Pipeline Presets:
- EGX Conservative
- EGX Aggressive
- EGX Balanced
- Crypto Scalp
"""

import os
import json
from flask import Blueprint, jsonify, request

analysis_engine_bp = Blueprint('analysis_engine', __name__, url_prefix='/api/analysis-engine')

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG_FILE = os.path.join(PROJECT_ROOT, 'db', 'analysis_engine_config.json')

# Default settings
DEFAULT_SETTINGS = {
    'engines': {
        'fundamental': {'enabled': True, 'weight': 40},
        'technical': {'enabled': True, 'weight': 30},
        'candlestick': {'enabled': True, 'weight': 20},
        'meanRev': {'enabled': True, 'weight': 10},
    },
    'activePreset': 'EGX Balanced',
}

PRESETS = {
    'EGX Conservative': {
        'fundamental': {'enabled': True, 'weight': 70},
        'technical': {'enabled': True, 'weight': 30},
        'candlestick': {'enabled': False, 'weight': 0},
        'meanRev': {'enabled': False, 'weight': 0},
    },
    'EGX Aggressive': {
        'fundamental': {'enabled': True, 'weight': 20},
        'technical': {'enabled': True, 'weight': 40},
        'candlestick': {'enabled': True, 'weight': 30},
        'meanRev': {'enabled': True, 'weight': 10},
    },
    'EGX Balanced': {
        'fundamental': {'enabled': True, 'weight': 40},
        'technical': {'enabled': True, 'weight': 30},
        'candlestick': {'enabled': True, 'weight': 20},
        'meanRev': {'enabled': True, 'weight': 10},
    },
    'Crypto Scalp': {
        'fundamental': {'enabled': False, 'weight': 0},
        'technical': {'enabled': True, 'weight': 50},
        'candlestick': {'enabled': True, 'weight': 30},
        'meanRev': {'enabled': True, 'weight': 20},
    },
}


def load_settings():
    """Load engine settings from config file"""
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r') as f:
                saved = json.load(f)
                # Merge with defaults
                settings = json.loads(json.dumps(DEFAULT_SETTINGS))
                settings.update(saved)
                return settings
    except Exception as e:
        print(f"[Analysis Engine] Error loading config: {e}")
    return json.loads(json.dumps(DEFAULT_SETTINGS))


def save_settings(settings):
    """Save engine settings to config file"""
    try:
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        with open(CONFIG_FILE, 'w') as f:
            json.dump(settings, f, indent=2)
        print(f"[Analysis Engine] Config saved: {settings.get('activePreset', 'custom')}")
    except Exception as e:
        print(f"[Analysis Engine] Error saving config: {e}")


def get_engine_config():
    """Get current engine configuration — used by other analyzers"""
    settings = load_settings()
    return settings.get('engines', DEFAULT_SETTINGS['engines'])


# Global config that other analyzers can import
CURRENT_CONFIG = get_engine_config()


@analysis_engine_bp.route('/config', methods=['GET'])
def get_config():
    """Get current engine configuration"""
    settings = load_settings()
    return jsonify({
        'success': True,
        'settings': settings,
        'presets': [
            {'name': name, 'engines': engines, 'description': get_preset_description(name)}
            for name, engines in PRESETS.items()
        ]
    })


@analysis_engine_bp.route('/config', methods=['POST'])
def update_config():
    """Update engine configuration
    
    Body:
    - action: 'toggle' | 'weight' | 'preset' | 'reset'
    - engine: 'fundamental' | 'technical' | 'candlestick' | 'meanRev'
    - enabled: boolean (for toggle)
    - weight: number 0-100 (for weight)
    - preset: string (for preset)
    """
    data = request.get_json() or {}
    action = data.get('action')
    engine = data.get('engine')
    settings = load_settings()
    
    if action == 'toggle':
        if engine not in settings['engines']:
            return jsonify({'success': False, 'error': f'Invalid engine: {engine}'}), 400
        settings['engines'][engine]['enabled'] = data.get('enabled', not settings['engines'][engine]['enabled'])
        settings['activePreset'] = None
        
    elif action == 'weight':
        if engine not in settings['engines']:
            return jsonify({'success': False, 'error': f'Invalid engine: {engine}'}), 400
        w = max(0, min(100, data.get('weight', 0)))
        settings['engines'][engine]['weight'] = w
        if w == 0:
            settings['engines'][engine]['enabled'] = False
        elif not settings['engines'][engine]['enabled']:
            settings['engines'][engine]['enabled'] = True
        settings['activePreset'] = None
        
    elif action == 'preset':
        preset = data.get('preset')
        if preset not in PRESETS:
            return jsonify({'success': False, 'error': f'Invalid preset: {preset}'}), 400
        settings['engines'] = json.loads(json.dumps(PRESETS[preset]))
        settings['activePreset'] = preset
        
    elif action == 'reset':
        settings = json.loads(json.dumps(DEFAULT_SETTINGS))
    else:
        return jsonify({'success': False, 'error': f'Invalid action: {action}'}), 400
    
    # Update global config
    global CURRENT_CONFIG
    CURRENT_CONFIG = settings['engines']
    
    save_settings(settings)
    
    return jsonify({
        'success': True,
        'message': f'تم تحديث {action}',
        'settings': settings,
    })


def get_preset_description(name):
    """Get description for a preset"""
    descriptions = {
        'EGX Conservative': 'تركيز على الأساسيات — للمستثمر طويل المدى',
        'EGX Aggressive': 'تركيز على الفني والشموع — للمضارب',
        'EGX Balanced': 'توازن بين كل المحركات — الافتراضي',
        'Crypto Scalp': 'بدون أساسيات — للعملات الرقمية',
    }
    return descriptions.get(name, '')
