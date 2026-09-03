#!/usr/bin/env python3
"""
Stock Notebook API Routes — مسارات API لإدارة النوتبوك
=========================================================
كل الـ logic في stock_notebook.py — هذه مجرد proxy routes.

Endpoints:
  GET  /api/notebooks/list              — قائمة كل النوتبوكس + ملخص
  GET  /api/notebooks/stats              — إحصائيات
  GET  /api/notebooks/<symbol>           — نوتبوك سهم كامل
  POST /api/notebooks/<symbol>/refresh   — إعادة بناء نوتبوك سهم
  POST /api/notebooks/build-all           — بناء جماعي
  POST /api/notebooks/<symbol>/lesson     — إضافة درس
  PUT  /api/notebooks/<symbol>/summary    — تعديل machine_summary

Author: Z.ai Code
Date: 2026-09-01
"""

from flask import Blueprint, request, jsonify
import sys
import os

# Add vps-service to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

notebook_bp = Blueprint('notebook_bp', __name__)


@notebook_bp.route('/api/notebooks/list', methods=['GET'])
def list_notebooks():
    """قائمة كل النوتبوكس + ملخص سريع لكل واحد."""
    try:
        from analyzers.stock_notebook import list_all_notebooks
        market = request.args.get('market', 'EGX')
        notebooks = list_all_notebooks(market)
        return jsonify({'success': True, 'notebooks': notebooks, 'count': len(notebooks)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@notebook_bp.route('/api/notebooks/stats', methods=['GET'])
def notebook_stats():
    """إحصائيات النوتبوك."""
    try:
        from analyzers.stock_notebook import get_notebook_stats
        market = request.args.get('market', 'EGX')
        stats = get_notebook_stats(market)
        return jsonify({'success': True, 'stats': stats})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@notebook_bp.route('/api/notebooks/<symbol>', methods=['GET'])
def get_notebook(symbol):
    """نوتبوك سهم كامل."""
    try:
        from analyzers.stock_notebook import load_stock_notebook
        market = request.args.get('market', 'EGX')
        notebook = load_stock_notebook(symbol, market)
        if notebook:
            return jsonify({'success': True, 'notebook': notebook})
        return jsonify({'success': False, 'error': 'النوتبوك غير موجود'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@notebook_bp.route('/api/notebooks/<symbol>/refresh', methods=['POST'])
def refresh_notebook(symbol):
    """إعادة بناء نوتبوك سهم من البيانات."""
    try:
        from analyzers.stock_notebook import build_or_refresh_notebook
        market = request.args.get('market', 'EGX')
        force = request.args.get('force', '1') == '1'
        notebook = build_or_refresh_notebook(symbol, force=force, market=market)
        return jsonify({'success': True, 'notebook': notebook})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@notebook_bp.route('/api/notebooks/build-all', methods=['POST'])
def build_all():
    """بناء جماعي لكل النوتبوكس."""
    try:
        from analyzers.stock_notebook import build_notebooks_for_universe
        market = request.args.get('market', 'EGX')
        force = request.args.get('force', '1') == '1'
        result = build_notebooks_for_universe('active', market=market, force=force)
        return jsonify({'success': True, 'result': result})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@notebook_bp.route('/api/notebooks/<symbol>/lesson', methods=['POST'])
def add_lesson_route(symbol):
    """إضافة درس جديد للنوتبوك."""
    try:
        from analyzers.stock_notebook import add_lesson
        data = request.get_json() or {}
        market = data.get('market', 'EGX')
        lesson = {
            'date': data.get('date', ''),
            'type': data.get('type', 'info'),
            'summary': data.get('summary', ''),
            'lesson': data.get('lesson', ''),
        }
        success = add_lesson(symbol, lesson, market=market)
        return jsonify({'success': success})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@notebook_bp.route('/api/notebooks/<symbol>/summary', methods=['PUT'])
def update_summary(symbol):
    """تعديل machine_summary لسهم."""
    try:
        from analyzers.stock_notebook import update_stock_notebook
        data = request.get_json() or {}
        market = data.get('market', 'EGX')
        updates = {'machine_summary': data.get('summary', {})}
        success = update_stock_notebook(symbol, updates, market=market)
        return jsonify({'success': success})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
