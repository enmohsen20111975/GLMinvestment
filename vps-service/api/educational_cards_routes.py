# DEPRECATED: This route is not registered in lightweight_server.py
#!/usr/bin/env python3
"""
Educational Cards Routes
=========================
Flask Blueprint لإدارة الكروت التعليمية للمنصة.

Endpoints:
- GET  /api/educational-cards/lessons            → قائمة الدروس المتاحة للنشر
- POST /api/educational-cards/generate           → توليد كارت أو سلسلة كروات
- GET  /api/educational-cards/list               → قائمة الكروات المولّدة
- GET  /api/educational-cards/<card_id>          → جلب كارت محدد
- GET  /api/educational-cards/<card_id>/image    → خدم صورة الكارت
- POST /api/educational-cards/<card_id>/publish  → نشر على تليجرام
- POST /api/educational-cards/generate-video     → توليد فيديو من كروات

ملاحظة قانونية:
- نستخدم "توقعات" وليس "توصيات" (للتوافق مع القوانين)
- النصوص بالعربية
- كل كارت ينتهي بـ 4 روابط رسمية + disclaimer

Author: دليل الاستثمار Platform
"""

import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, Any, List

from flask import Blueprint, request, jsonify, send_file

# Add vps-service root to path so we can import analyzers.*
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

educational_cards_bp = Blueprint(
    'educational_cards',
    __name__,
    url_prefix='/api/educational-cards',
)

# ============================================================================
# LAZY ENGINE INITIALIZATION
# ============================================================================

_engine = None


def get_engine():
    """تهيئة EducationalCardsEngine بشكل lazy (مرة واحدة فقط)"""
    global _engine
    if _engine is None:
        try:
            from analyzers.educational_cards_engine import EducationalCardsEngine
            _engine = EducationalCardsEngine()
        except Exception as e:
            print(f"[EducationalCards] Error initializing engine: {e}")
            return None
    return _engine


def _err(msg: str, status: int = 503, extra: Optional[Dict] = None):
    """Helper لإنشاء error response موحّد"""
    payload = {'success': False, 'error': msg}
    if extra:
        payload.update(extra)
    return jsonify(payload), status


def _ok(data: Any, extra: Optional[Dict] = None):
    """Helper لإنشاء success response موحّد"""
    payload = {'success': True, 'data': data}
    if extra:
        payload.update(extra)
    return jsonify(payload)


# ============================================================================
# /lessons — قائمة الدروس المتاحة للنشر
# ============================================================================

@educational_cards_bp.route('/lessons', methods=['GET'])
def list_lessons():
    """
    قائمة الدروس المتاحة للنشر

    Query:
        category (default 'all') — 'stocks' | 'crypto' | 'all'
    """
    engine = get_engine()
    if engine is None:
        return _err('Educational Cards engine not available')

    try:
        category = (request.args.get('category') or 'all').strip().lower()
        lessons = engine.get_lessons(category=category)

        # Slim view for listing (don't return full content)
        items = []
        for ls in lessons:
            items.append({
                'id': ls.get('id'),
                'title': ls.get('title'),
                'category': ls.get('category'),
                'difficulty': ls.get('difficulty'),
                'content_preview': ls.get('content_preview', ''),
                'course_id': ls.get('course_id'),
                'course_title': ls.get('course_title'),
            })

        return _ok({
            'items': items,
            'total': len(items),
            'category': category,
        }, {'timestamp': datetime.now().isoformat()})
    except Exception as e:
        return _err(f'Failed to list lessons: {e}', status=500)


# ============================================================================
# /generate — توليد كارت أو سلسلة كروات
# ============================================================================

@educational_cards_bp.route('/generate', methods=['POST'])
def generate_card():
    """
    توليد كارت أو سلسلة كروات

    Body:
        {
            "lesson_id": "stocks-001",         # required
            "style": "modern",                  # optional: 'modern' | 'classic' | 'minimal'
            "num_cards": 1,                     # optional (default 1); if > 1 → series
            "generate_video": false,            # optional; if true → also produce MP4
            "duration_per_card": 5              # optional (for video)
        }
    """
    engine = get_engine()
    if engine is None:
        return _err('Educational Cards engine not available')

    try:
        data = request.get_json(silent=True) or {}
        lesson_id = (data.get('lesson_id') or '').strip()
        style = (data.get('style') or 'modern').strip().lower()
        num_cards = int(data.get('num_cards', 1) or 1)
        generate_video = bool(data.get('generate_video', False))
        duration_per_card = int(data.get('duration_per_card', 5) or 5)

        if not lesson_id:
            return _err('lesson_id is required', status=400)

        if style not in ('modern', 'classic', 'minimal'):
            return _err(f"Invalid style: {style}. Must be one of: modern, classic, minimal", status=400)

        if num_cards < 1:
            num_cards = 1

        # Look up the lesson
        lesson = engine.get_lesson_by_id(lesson_id)
        if not lesson:
            return _err(f'Lesson not found: {lesson_id}', status=404)

        lesson_data = {
            'lesson_id': lesson['id'],
            'title': lesson['title'],
            'content': lesson['content'],
            'category': lesson['category'],
            'difficulty': lesson['difficulty'],
            'card_style': style,
        }

        # Generate single or series
        if num_cards == 1:
            lesson_data['card_number'] = '1/1'
            lesson_data['total_cards'] = 1
            result = engine.generate_card(lesson_data, card_style=style)
            cards_list = [result]
            total_cards = 1
            combined_text = result.get('text_content', '')
        else:
            result = engine.generate_series(lesson_data, num_cards=num_cards)
            cards_list = result.get('cards', [])
            total_cards = result.get('total_cards', len(cards_list))
            combined_text = result.get('text_content', '')

        # Optional video generation
        video_info: Optional[Dict] = None
        if generate_video and cards_list:
            # Collect image paths
            card_paths = [c.get('card_path') for c in cards_list if c.get('card_path')]
            if card_paths:
                ts = datetime.now().strftime('%Y%m%d_%H%M%S')
                video_output = str(Path(engine.output_dir) / f'edu_video_{ts}.mp4')
                video_result = engine.generate_video_from_cards(
                    cards=card_paths,
                    output_path=video_output,
                    duration_per_card=duration_per_card,
                )
                video_info = video_result
            else:
                video_info = {
                    'success': False,
                    'error': 'No card images available (Playwright may not be installed)',
                }

        response_data = {
            'lesson_id': lesson_id,
            'lesson_title': lesson['title'],
            'category': lesson['category'],
            'difficulty': lesson['difficulty'],
            'style': style,
            'num_cards': num_cards,
            'total_generated': total_cards,
            'cards': cards_list,
            'text_content': combined_text,
        }
        if video_info is not None:
            response_data['video'] = video_info

        return _ok(response_data, {'timestamp': datetime.now().isoformat()})
    except Exception as e:
        return _err(f'Failed to generate card(s): {e}', status=500)


# ============================================================================
# /list — قائمة الكروات المولّدة
# ============================================================================

@educational_cards_bp.route('/list', methods=['GET'])
def list_cards():
    """
    قائمة الكروات المولّدة محفوظة في DB

    Query:
        limit (default 50)
    """
    engine = get_engine()
    if engine is None:
        return _err('Educational Cards engine not available')

    try:
        limit = request.args.get('limit', 50, type=int)
        if limit < 1:
            limit = 50
        if limit > 500:
            limit = 500

        cards = engine.get_generated_cards(limit=limit)

        return _ok({
            'items': cards,
            'total': len(cards),
            'limit': limit,
        }, {'timestamp': datetime.now().isoformat()})
    except Exception as e:
        return _err(f'Failed to list cards: {e}', status=500)


# ============================================================================
# /<card_id> — جلب كارت محدد
# ============================================================================

@educational_cards_bp.route('/<card_id>', methods=['GET'])
def get_card(card_id: str):
    """جلب كارت محدد بالكامل"""
    engine = get_engine()
    if engine is None:
        return _err('Educational Cards engine not available')

    try:
        card = engine.get_card_by_id(card_id)
        if not card:
            return _err(f'Card not found: {card_id}', status=404)

        # Add image URL if image exists
        if card.get('has_image'):
            card['image_url'] = f'/api/educational-cards/{card_id}/image'

        return _ok(card, {'timestamp': datetime.now().isoformat()})
    except Exception as e:
        return _err(f'Failed to fetch card: {e}', status=500)


# ============================================================================
# /<card_id>/image — خدم صورة الكارت
# ============================================================================

@educational_cards_bp.route('/<card_id>/image', methods=['GET'])
def get_card_image(card_id: str):
    """خدم صورة الكارت كـ file response (PNG)"""
    engine = get_engine()
    if engine is None:
        return _err('Educational Cards engine not available')

    try:
        card = engine.get_card_by_id(card_id)
        if not card:
            return _err(f'Card not found: {card_id}', status=404)

        card_path = card.get('card_path')
        if not card_path or not os.path.exists(card_path):
            return _err('Image not available for this card (Playwright may not be installed)', status=404)

        return send_file(card_path, mimetype='image/png')
    except Exception as e:
        return _err(f'Failed to fetch card image: {e}', status=500)


# ============================================================================
# /<card_id>/publish — نشر على تليجرام
# ============================================================================

@educational_cards_bp.route('/<card_id>/publish', methods=['POST'])
def publish_card(card_id: str):
    """نشر كارت محدد على قناة التليجرام"""
    engine = get_engine()
    if engine is None:
        return _err('Educational Cards engine not available')

    try:
        result = engine.publish_card_to_telegram(card_id)
        if not result.get('success', False):
            return _err(
                result.get('error', 'Failed to publish card'),
                status=502,
                extra={'card_id': card_id},
            )

        return _ok(result, {
            'timestamp': datetime.now().isoformat(),
            'card_id': card_id,
        })
    except Exception as e:
        return _err(f'Failed to publish card: {e}', status=500)


# ============================================================================
# /generate-video — توليد فيديو من كروات
# ============================================================================

@educational_cards_bp.route('/generate-video', methods=['POST'])
def generate_video():
    """
    توليد فيديو MP4 من كروات محددة

    Body:
        {
            "card_ids": ["edu-...", "edu-..."],   # required (list of card IDs)
            "duration_per_card": 5                  # optional (default 5 seconds)
        }
    """
    engine = get_engine()
    if engine is None:
        return _err('Educational Cards engine not available')

    try:
        data = request.get_json(silent=True) or {}
        card_ids = data.get('card_ids') or []
        duration_per_card = int(data.get('duration_per_card', 5) or 5)

        if not card_ids or not isinstance(card_ids, list):
            return _err('card_ids (non-empty list) is required', status=400)

        if duration_per_card < 1:
            duration_per_card = 5

        # Resolve card image paths from DB
        card_paths: List[str] = []
        missing: List[str] = []
        for cid in card_ids:
            card = engine.get_card_by_id(cid)
            if not card:
                missing.append(cid)
                continue
            cp = card.get('card_path')
            if not cp or not os.path.exists(cp):
                missing.append(cid)
                continue
            card_paths.append(cp)

        if not card_paths:
            return _err(
                f'No valid card images found. Missing/invalid IDs: {missing}',
                status=404,
            )

        # Generate video
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        video_output = str(Path(engine.output_dir) / f'edu_video_{ts}.mp4')
        result = engine.generate_video_from_cards(
            cards=card_paths,
            output_path=video_output,
            duration_per_card=duration_per_card,
        )

        if not result.get('success', False):
            return _err(
                result.get('error', 'Failed to generate video'),
                status=500,
                extra={'requested_cards': len(card_ids), 'missing': missing},
            )

        # Add video URL relative to project public/
        video_path = result.get('video_path')
        video_url = None
        if video_path:
            try:
                rel = Path(video_path).relative_to(Path(engine.output_dir).parent)
                video_url = f'/{rel.as_posix()}'
            except Exception:
                video_url = f'/educational-cards/{Path(video_path).name}'

        result['video_url'] = video_url
        result['cards_used'] = len(card_paths)
        result['missing'] = missing

        return _ok(result, {'timestamp': datetime.now().isoformat()})
    except Exception as e:
        return _err(f'Failed to generate video: {e}', status=500)


# ============================================================================
# دروس منسقة (Infographic / PDF)
# ============================================================================

@educational_cards_bp.route('/generate-infographic', methods=['POST'])
def generate_infographic():
    """توليد صورة طويلة (Infographic) من درس كامل"""
    engine = get_engine()
    if engine is None:
        return _err('Educational cards engine not available')

    try:
        data = request.get_json(silent=True) or {}
        lesson_id = data.get('lesson_id', '')

        # جلب الدرس
        lessons = engine.get_lessons()
        lesson = None
        for ls in lessons:
            if ls['id'] == lesson_id:
                lesson = ls
                break

        if not lesson:
            return _err(f'Lesson not found: {lesson_id}', status=404)

        result = engine.generate_infographic(lesson)
        return _ok(result, {'timestamp': datetime.now().isoformat()})
    except Exception as e:
        return _err(f'Failed to generate infographic: {e}', status=500)


@educational_cards_bp.route('/generate-pdf', methods=['POST'])
def generate_pdf():
    """توليد PDF من درس"""
    engine = get_engine()
    if engine is None:
        return _err('Educational cards engine not available')

    try:
        data = request.get_json(silent=True) or {}
        lesson_id = data.get('lesson_id', '')

        lessons = engine.get_lessons()
        lesson = None
        for ls in lessons:
            if ls['id'] == lesson_id:
                lesson = ls
                break

        if not lesson:
            return _err(f'Lesson not found: {lesson_id}', status=404)

        result = engine.generate_pdf(lesson)
        return _ok(result, {'timestamp': datetime.now().isoformat()})
    except Exception as e:
        return _err(f'Failed to generate PDF: {e}', status=500)


# ============================================================================
# GIF متحرك
# ============================================================================

@educational_cards_bp.route('/generate-gif', methods=['POST'])
def generate_gif():
    """توليد GIF متحرك من درس"""
    engine = get_engine()
    if engine is None:
        return _err('Educational cards engine not available')

    try:
        data = request.get_json(silent=True) or {}
        lesson_id = data.get('lesson_id', '')
        num_frames = int(data.get('num_frames', 8))
        duration_per_frame = int(data.get('duration_per_frame', 1500))

        lessons = engine.get_lessons()
        lesson = None
        for ls in lessons:
            if ls['id'] == lesson_id:
                lesson = ls
                break

        if not lesson:
            return _err(f'Lesson not found: {lesson_id}', status=404)

        result = engine.generate_gif(lesson, num_frames=num_frames, duration_per_frame=duration_per_frame)
        return _ok(result, {'timestamp': datetime.now().isoformat()})
    except Exception as e:
        return _err(f'Failed to generate GIF: {e}', status=500)


@educational_cards_bp.route('/<path:filename>/file', methods=['GET'])
def serve_file(filename):
    """خدم أي ملف من مجلد الكروات التعليمية (PNG, PDF, GIF, MP4)"""
    import os
    from flask import send_from_directory, abort

    # منع path traversal
    if '/' in filename or '\\' in filename or '..' in filename:
        abort(404)

    file_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                             'analyzers', 'educational_cards_output')
    # محاولة في public/educational-cards/
    public_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                              'public', 'educational-cards')

    for d in [public_dir, file_path]:
        full_path = os.path.join(d, filename)
        if os.path.exists(full_path):
            return send_from_directory(d, filename)

    abort(404)
