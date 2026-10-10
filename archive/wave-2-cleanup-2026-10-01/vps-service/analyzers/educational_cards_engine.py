#!/usr/bin/env python3
"""
🎓 Educational Cards Engine
============================
محرك توليد الكروت التعليمية للمنصة.

يستخرج الدروس من:
- src/data/learning-content.ts          (دروس الأسهم)
- src/data/crypto-learning-content.ts   (دروس العملات الرقمية)

وحوّلها إلى كروت PNG (1080×1350) عبر Playwright HTML→PNG،
ثم يدمج الكروت في فيديو MP4 عبر FFmpeg.

المتطلبات:
- Playwright (Chromium) للتحويل HTML→PNG (لو مش متاح → النص يفضل متاح بدون صورة)
- FFmpeg لتوليد الفيديو (لو مش متاح → بيرجع error واضح)

legal compliance:
- نستخدم "توقعات" وليس "توصيات"
- كل كارت ينتهي بالـ 4 روابط الرسمية + disclaimer "محتوى تعليمي — ليس توقعة استثمارية"

Author: دليل الاستثمار Platform
"""

import os
import re
import sys
import ast
import base64
import asyncio
import sqlite3
import subprocess
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List, Any, Tuple

# ─────────────────────────────────────────────────────────────────────────────
# Project paths
# ─────────────────────────────────────────────────────────────────────────────

_HERE = Path(__file__).resolve().parent
PROJECT_ROOT = Path(_HERE).parent.parent  # resolved dynamically
VPS_ROOT = Path(_HERE).parent             # resolved dynamically

# Output directory for generated card PNGs
OUTPUT_DIR = PROJECT_ROOT / 'public' / 'educational-cards'

# Source content files
LEARNING_CONTENT_TS = PROJECT_ROOT / 'src' / 'data' / 'learning-content.ts'
CRYPTO_LEARNING_CONTENT_TS = PROJECT_ROOT / 'src' / 'data' / 'crypto-learning-content.ts'

# Logo (square version)
LOGO_PATH = PROJECT_ROOT / 'public' / 'logo-square.png'

# ─────────────────────────────────────────────────────────────────────────────
# DB paths (mirror reports_engine.py approach)
# ─────────────────────────────────────────────────────────────────────────────

_DB_CANDIDATES = {
    'predictions_db': [
        PROJECT_ROOT / 'db' / 'predictions.db',
    ],
}


def _resolve_db(key: str) -> str:
    """أول مسار موجود لقاعدة البيانات، أو أول مسار مرشح كافتراضي."""
    for p in _DB_CANDIDATES.get(key, []):
        if p.exists():
            return str(p)
    cands = _DB_CANDIDATES.get(key, [])
    return str(cands[0]) if cands else ''


# ─────────────────────────────────────────────────────────────────────────────
# Branding constants
# ─────────────────────────────────────────────────────────────────────────────

PLATFORM_NAME = 'دليل الاستثمار'

OFFICIAL_LINKS = {
    'website': 'https://invist.m2y.net',
    'android': 'https://play.google.com/store/apps/details?id=com.egx.investment',
    'facebook': 'https://www.facebook.com/profile.php?id=61590600300048',
    'telegram': 'https://t.me/Arabian_investment_guide',
}

COMMUNITY_PROMPT = 'انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈'

DISCLAIMER_TEXT = '⚠️ محتوى تعليمي — ليس توقعة استثمارية'

COLOR_GOLD = '#d4af37'
COLOR_BG = '#0f172a'
COLOR_BG_LIGHT = '#1e293b'
COLOR_GREEN = '#10b981'
COLOR_ORANGE = '#f59e0b'
COLOR_RED = '#ef4444'
COLOR_TEXT = '#f8fafc'
COLOR_MUTED = '#94a3b8'

DIFFICULTY_MAP = {
    'مبتدئ': ('beginner', 'مبتدئ'),
    'متوسط': ('intermediate', 'متوسط'),
    'متقدم': ('advanced', 'متقدم'),
    'beginner': ('beginner', 'مبتدئ'),
    'intermediate': ('intermediate', 'متوسط'),
    'advanced': ('advanced', 'متقدم'),
}

# ─────────────────────────────────────────────────────────────────────────────
# Playwright availability check
# ─────────────────────────────────────────────────────────────────────────────

try:
    from playwright.async_api import async_playwright
    PLAYWRIGHT_AVAILABLE = True
    PLAYWRIGHT_IMPORT_ERROR = None
except Exception as _e:  # pragma: no cover
    PLAYWRIGHT_AVAILABLE = False
    PLAYWRIGHT_IMPORT_ERROR = str(_e)


def _ffmpeg_available() -> bool:
    """Check whether ffmpeg binary is on PATH."""
    try:
        result = subprocess.run(
            ['ffmpeg', '-version'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        return result.returncode == 0
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Helpers — TS source parsing
# ─────────────────────────────────────────────────────────────────────────────

def _unescape_ts_string(s: str) -> str:
    """تحويل string literal من TS source إلى قيمته الفعلية.

    The TS source uses escape sequences like \\n \\\\ \\' which we need to
    convert to actual characters. We wrap the captured text in single quotes
    and feed it to ast.literal_eval.
    """
    if not s:
        return ''
    try:
        # Wrap in single quotes — ast.literal_eval will process escape sequences
        return ast.literal_eval("'" + s + "'")
    except (ValueError, SyntaxError):
        # Fallback: manual replacement of common sequences
        out = s
        out = out.replace('\\n', '\n')
        out = out.replace('\\t', '\t')
        out = out.replace("\\'", "'")
        out = out.replace('\\"', '"')
        out = out.replace('\\\\', '\\')
        return out


# Regex for a TS string literal value (handling escape sequences)
_STR = r"((?:[^'\\]|\\.)*)"

# Course patterns — different shapes for stocks vs crypto
_STOCKS_COURSE_RE = re.compile(
    r"id:\s*'" + r"([^']+)" + r"'\s*,\s*"
    r"title:\s*'" + _STR + r"'\s*,\s*"
    r"description:\s*'" + _STR + r"'\s*,\s*"
    r"difficulty:\s*'([^']+)'\s*,\s*"
    r"icon:\s*'([^']+)'\s*,\s*"
    r"lessons:\s*\[(.*?)\]\s*,?\s*\}",
    re.DOTALL,
)

_STOCKS_LESSON_RE = re.compile(
    r"\{\s*title:\s*'" + _STR + r"'\s*,\s*content:\s*'" + _STR + r"'\s*\}",
    re.DOTALL,
)

_CRYPTO_COURSE_RE = re.compile(
    r"id:\s*'" + r"([^']+)" + r"'\s*,\s*"
    r"title:\s*'" + _STR + r"'\s*,\s*"
    r"titleEn:\s*'" + _STR + r"'\s*,\s*"
    r"description:\s*'" + _STR + r"'\s*,\s*"
    r"difficulty:\s*'([^']+)'\s*,\s*"
    r"icon:\s*'([^']+)'\s*,\s*"
    r"totalDuration:\s*'([^']*)'\s*,\s*"
    r"lessons:\s*\[(.*?)\]\s*\}",
    re.DOTALL,
)

# Crypto lessons are multi-line: each is { title: '...', duration: '...', content: '...' }
_CRYPTO_LESSON_BLOCK_RE = re.compile(r"\{[^{}]*?\}", re.DOTALL)
_FIELD_RE = lambda field: re.compile(rf"{field}:\s*'" + _STR + r"'", re.DOTALL)


def _parse_stocks_content(text: str) -> List[Dict]:
    """Parse courses/lessons from learning-content.ts."""
    lessons: List[Dict] = []
    title_field_re = _FIELD_RE('title')
    content_field_re = _FIELD_RE('content')

    for m in _STOCKS_COURSE_RE.finditer(text):
        course_id, course_title_raw, _desc, course_diff, _icon, lessons_block = m.groups()
        # Iterate over lessons (each is on one line)
        for lm in _STOCKS_LESSON_RE.finditer(lessons_block):
            lesson_title_raw, lesson_content_raw = lm.groups()
            lessons.append({
                'course_id': course_id,
                'course_title': _unescape_ts_string(course_title_raw),
                'title': _unescape_ts_string(lesson_title_raw),
                'content': _unescape_ts_string(lesson_content_raw),
                'category': 'stocks',
                'difficulty': course_diff,
            })
    # Fallback: if the strict course regex missed, scan per-lesson across whole file
    if not lessons:
        for lm in _STOCKS_LESSON_RE.finditer(text):
            lesson_title_raw, lesson_content_raw = lm.groups()
            lessons.append({
                'course_id': 'unknown',
                'course_title': 'دروس الأسهم',
                'title': _unescape_ts_string(lesson_title_raw),
                'content': _unescape_ts_string(lesson_content_raw),
                'category': 'stocks',
                'difficulty': 'مبتدئ',
            })
    return lessons


def _parse_crypto_content(text: str) -> List[Dict]:
    """Parse courses/lessons from crypto-learning-content.ts."""
    lessons: List[Dict] = []
    title_field_re = _FIELD_RE('title')
    content_field_re = _FIELD_RE('content')

    for m in _CRYPTO_COURSE_RE.finditer(text):
        course_id, course_title_raw, _titleEn, _desc, course_diff, _icon, _dur, lessons_block = m.groups()
        # Each lesson is a { ... } block — find them
        for blk in _CRYPTO_LESSON_BLOCK_RE.finditer(lessons_block):
            blk_text = blk.group(0)
            t_m = title_field_re.search(blk_text)
            c_m = content_field_re.search(blk_text)
            if t_m and c_m:
                lessons.append({
                    'course_id': course_id,
                    'course_title': _unescape_ts_string(course_title_raw),
                    'title': _unescape_ts_string(t_m.group(1)),
                    'content': _unescape_ts_string(c_m.group(1)),
                    'category': 'crypto',
                    'difficulty': course_diff,
                })
    return lessons


# ─────────────────────────────────────────────────────────────────────────────
# Helpers — content formatting (markdown-ish → HTML)
# ─────────────────────────────────────────────────────────────────────────────

def _escape_html(s: str) -> str:
    """Escape HTML special chars (but keep already-encoded entities alone)."""
    return (
        s.replace('&', '&amp;')
         .replace('<', '&lt;')
         .replace('>', '&gt;')
    )


def _format_content_to_html(content: str) -> str:
    """تحويل محتوى الدرس (markdown-ish) إلى HTML للمتصفح.

    Supports:
    - Paragraph breaks (\\n\\n → </p><p>)
    - Bold (**text** → <strong>text</strong>)
    - Bullet lists (- ... → <ul><li>)
    - Numbered lists (1. ... → <ol><li>)
    - KaTeX math ($...$, $$...$$) — kept as-is; auto-render will handle
    """
    if not content:
        return '<p class="empty">لا يوجد محتوى</p>'

    # Escape HTML first (KaTeX delimiters $ are safe — no escape needed)
    text = _escape_html(content)

    # Convert **bold** → <strong>bold</strong>
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)

    # Split into lines/blocks
    lines = text.split('\n')
    html_parts: List[str] = []
    list_open: Optional[str] = None  # 'ul' or 'ol'

    def _close_list():
        nonlocal list_open
        if list_open:
            html_parts.append(f'</{list_open}>')
            list_open = None

    for raw_line in lines:
        line = raw_line.rstrip()
        if not line:
            _close_list()
            html_parts.append('')  # paragraph break marker
            continue

        # Bullet list item
        bm = re.match(r'^[-•]\s+(.+)$', line)
        if bm:
            if list_open != 'ul':
                _close_list()
                html_parts.append('<ul>')
                list_open = 'ul'
            html_parts.append(f'<li>{bm.group(1)}</li>')
            continue

        # Numbered list item
        nm = re.match(r'^\d+\.\s+(.+)$', line)
        if nm:
            if list_open != 'ol':
                _close_list()
                html_parts.append('<ol>')
                list_open = 'ol'
            html_parts.append(f'<li>{nm.group(1)}</li>')
            continue

        # Regular paragraph line
        _close_list()
        html_parts.append(f'<p>{line}</p>')

    _close_list()

    # Join, collapsing empty <p></p> from blank lines
    out = '\n'.join(html_parts)
    # Remove empty paragraphs left over from blank lines
    out = re.sub(r'<p>\s*</p>', '', out)
    out = re.sub(r'\n{3,}', '\n\n', out)
    return out


def _make_preview(text: str, max_len: int = 120) -> str:
    """Generate a short text preview (first non-empty paragraph)."""
    if not text:
        return ''
    # Strip markdown bold markers
    cleaned = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    # Take first paragraph
    first_para = cleaned.split('\n\n')[0].strip()
    # Remove KaTeX math for preview
    first_para = re.sub(r'\$\$.*?\$\$', ' [معادلة] ', first_para, flags=re.DOTALL)
    first_para = re.sub(r'\$.*?\$', ' [معادلة] ', first_para, flags=re.DOTALL)
    # Remove list markers
    first_para = re.sub(r'^[-•]\s+', '', first_para, flags=re.MULTILINE)
    first_para = re.sub(r'^\d+\.\s+', '', first_para, flags=re.MULTILINE)
    # Collapse whitespace
    first_para = re.sub(r'\s+', ' ', first_para).strip()
    if len(first_para) > max_len:
        first_para = first_para[:max_len - 1] + '…'
    return first_para


def _slugify(s: str, max_len: int = 50) -> str:
    """Generate a filename-safe slug from Arabic/English text."""
    # Keep ASCII alphanumerics, replace everything else with -
    s = re.sub(r'[^\w\s-]', '', s, flags=re.UNICODE)
    s = re.sub(r'[\s_-]+', '-', s).strip('-')
    s = s.lower()
    if not s:
        s = 'card'
    return s[:max_len]


def _logo_base64() -> Optional[str]:
    """Load logo-square.png as base64 data URI for inline embedding in HTML."""
    try:
        if LOGO_PATH.exists():
            with open(LOGO_PATH, 'rb') as f:
                data = f.read()
            b64 = base64.b64encode(data).decode('ascii')
            return f'data:image/png;base64,{b64}'
    except Exception as e:
        print(f"[EducationalCardsEngine] logo load error: {e}")
    return None


def _gen_card_id() -> str:
    """Generate a unique card ID."""
    ts = datetime.now().strftime('%Y%m%d%H%M%S')
    rand = hashlib.md5(f"{ts}-{os.urandom(6).hex()}".encode()).hexdigest()[:8]
    return f"edu-{ts}-{rand}"


# ─────────────────────────────────────────────────────────────────────────────
# Main class
# ─────────────────────────────────────────────────────────────────────────────

class EducationalCardsEngine:
    """محرك توليد الكروت التعليمية.

    - بيجيب المحتوى التعليمي من src/data/learning-content.ts و crypto-learning-content.ts
    - بيوّلد كروت PNG (1080×1350) عبر Playwright
    - بيدمج الكروت في فيديو MP4 عبر FFmpeg
    - بيقفل على جدول educational_cards في predictions.db
    """

    def __init__(self):
        # Output directory for PNG cards
        self.output_dir = OUTPUT_DIR
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Predictions DB path
        self.predictions_db_path = _resolve_db('predictions_db')
        # Ensure parent dir exists
        try:
            Path(self.predictions_db_path).parent.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass

        # Parse lessons from TS files (cached)
        self._lessons_cache: Optional[List[Dict]] = None

        # Logo data URI
        self._logo_data_uri = _logo_base64()

        # Ensure DB table exists
        self._ensure_table()

    # ─────────────────────────────────────────────────────────────────────────
    # DB
    # ─────────────────────────────────────────────────────────────────────────

    def _ensure_table(self) -> None:
        """ينشئ جدول educational_cards في predictions.db لو مش موجود."""
        try:
            conn = sqlite3.connect(self.predictions_db_path)
            try:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS educational_cards (
                        id TEXT PRIMARY KEY,
                        lesson_id TEXT,
                        title TEXT,
                        category TEXT,
                        card_path TEXT,
                        text_content TEXT,
                        created_at TEXT DEFAULT (datetime('now')),
                        published_at TEXT,
                        status TEXT DEFAULT 'pending'
                    )
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_edu_cards_created ON educational_cards(created_at DESC)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_edu_cards_lesson ON educational_cards(lesson_id)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_edu_cards_status ON educational_cards(status)")
                conn.commit()
            finally:
                conn.close()
        except Exception as e:
            print(f"[EducationalCardsEngine] DB init error: {e}")

    def _db_connect(self) -> Optional[sqlite3.Connection]:
        try:
            return sqlite3.connect(self.predictions_db_path)
        except Exception as e:
            print(f"[EducationalCardsEngine] predictions.db connect error: {e}")
            return None

    # ─────────────────────────────────────────────────────────────────────────
    # Lesson parsing (public)
    # ─────────────────────────────────────────────────────────────────────────

    def _load_lessons(self) -> List[Dict]:
        """Parse both TS files once and cache the result."""
        if self._lessons_cache is not None:
            return self._lessons_cache

        all_lessons: List[Dict] = []

        # Stocks
        try:
            if LEARNING_CONTENT_TS.exists():
                text = LEARNING_CONTENT_TS.read_text(encoding='utf-8', errors='replace')
                stocks_lessons = _parse_stocks_content(text)
                for i, ls in enumerate(stocks_lessons, start=1):
                    ls['id'] = f"stocks-{i:03d}"
                    ls['content_preview'] = _make_preview(ls.get('content', ''))
                    all_lessons.append(ls)
                print(f"[EducationalCardsEngine] Loaded {len(stocks_lessons)} stocks lessons")
            else:
                print(f"[EducationalCardsEngine] learning-content.ts not found at {LEARNING_CONTENT_TS}")
        except Exception as e:
            print(f"[EducationalCardsEngine] Error parsing stocks content: {e}")

        # Crypto
        try:
            if CRYPTO_LEARNING_CONTENT_TS.exists():
                text = CRYPTO_LEARNING_CONTENT_TS.read_text(encoding='utf-8', errors='replace')
                crypto_lessons = _parse_crypto_content(text)
                for i, ls in enumerate(crypto_lessons, start=1):
                    ls['id'] = f"crypto-{i:03d}"
                    ls['content_preview'] = _make_preview(ls.get('content', ''))
                    all_lessons.append(ls)
                print(f"[EducationalCardsEngine] Loaded {len(crypto_lessons)} crypto lessons")
            else:
                print(f"[EducationalCardsEngine] crypto-learning-content.ts not found at {CRYPTO_LEARNING_CONTENT_TS}")
        except Exception as e:
            print(f"[EducationalCardsEngine] Error parsing crypto content: {e}")

        self._lessons_cache = all_lessons
        return all_lessons

    def get_lessons(self, category: str = 'all') -> List[Dict]:
        """قائمة الدروس المتاحة للنشر.

        Args:
            category: 'stocks' | 'crypto' | 'all'

        Returns:
            list of dicts: {id, title, category, difficulty, content_preview, course_id, course_title}
        """
        lessons = self._load_lessons()
        cat = (category or 'all').lower().strip()
        if cat in ('', 'all', 'الكل'):
            return list(lessons)
        return [ls for ls in lessons if ls.get('category') == cat]

    def get_lesson_by_id(self, lesson_id: str) -> Optional[Dict]:
        """Get a single lesson by its ID."""
        for ls in self._load_lessons():
            if ls.get('id') == lesson_id:
                return ls
        return None

    # ─────────────────────────────────────────────────────────────────────────
    # Card generation
    # ─────────────────────────────────────────────────────────────────────────

    def generate_card(self, lesson_data: Dict, card_style: str = 'modern') -> Dict:
        """توّلد كارت تعليمي واحد كـ PNG.

        Args:
            lesson_data: {title, content, category, difficulty} (or with lesson_id, card_number, total_cards)
            card_style: 'modern' | 'classic' | 'minimal'

        Returns:
            {success, card_path, card_url, text_content}
        """
        # Build text content
        title = lesson_data.get('title', 'درس تعليمي')
        content = lesson_data.get('content', '')
        category = lesson_data.get('category', 'stocks')
        difficulty = lesson_data.get('difficulty', 'مبتدئ')
        lesson_id = lesson_data.get('lesson_id') or lesson_data.get('id') or 'unknown'
        card_number = lesson_data.get('card_number', '1')
        total_cards = lesson_data.get('total_cards', 1)

        # Build text version (used in DB + as fallback)
        text_content = self._build_text_content(
            title=title,
            content=content,
            category=category,
            difficulty=difficulty,
            card_number=card_number,
            total_cards=total_cards,
        )

        # Try PNG generation
        card_path: Optional[str] = None
        card_url: Optional[str] = None

        if PLAYWRIGHT_AVAILABLE:
            try:
                # Build HTML
                html = self._build_html(
                    title=title,
                    content=content,
                    difficulty=difficulty,
                    card_number=card_number,
                    total_cards=total_cards,
                    card_style=card_style,
                )

                # Output filename
                ts = datetime.now().strftime('%Y%m%d_%H%M%S')
                slug = _slugify(title)
                filename = f"edu_{ts}_{slug}.png"
                output_path = self.output_dir / filename

                # Render via Playwright
                try:
                    asyncio.run(self._html_to_png(html, str(output_path), 1080, 1350))
                except RuntimeError:
                    # Event loop already running — try nest_asyncio
                    try:
                        import nest_asyncio
                        nest_asyncio.apply()
                        asyncio.run(self._html_to_png(html, str(output_path), 1080, 1350))
                    except Exception as e:
                        print(f"[EducationalCardsEngine] asyncio run error: {e}")
                except Exception as e:
                    print(f"[EducationalCardsEngine] Playwright render error: {e}")

                if output_path.exists():
                    card_path = str(output_path)
                    # URL relative to project public/ dir
                    card_url = f"/educational-cards/{filename}"
            except Exception as e:
                print(f"[EducationalCardsEngine] generate_card error: {e}")
        else:
            print(
                f"[EducationalCardsEngine] Playwright not available "
                f"({PLAYWRIGHT_IMPORT_ERROR}). Text-only mode."
            )

        # Save to DB
        card_id = _gen_card_id()
        self._save_card_to_db(
            card_id=card_id,
            lesson_id=lesson_id,
            title=title,
            category=category,
            card_path=card_path or '',
            text_content=text_content,
        )

        return {
            'success': True,
            'card_id': card_id,
            'card_path': card_path,
            'card_url': card_url,
            'text_content': text_content,
            'image_generated': card_path is not None,
        }

    def generate_series(self, lesson_data: Dict, num_cards: int = 5) -> Dict:
        """يقسم الدرس لعدة كروات ويولّد كل كارت.

        Args:
            lesson_data: {title, content, category, difficulty, lesson_id}
            num_cards: عدد الكروات المطلوب توليدها

        Returns:
            {success, cards: [{card_id, card_path, card_url, text_content}, ...], total_cards, text_content}
        """
        title = lesson_data.get('title', 'درس تعليمي')
        content = lesson_data.get('content', '')
        category = lesson_data.get('category', 'stocks')
        difficulty = lesson_data.get('difficulty', 'مبتدئ')
        lesson_id = lesson_data.get('lesson_id') or lesson_data.get('id') or 'unknown'
        card_style = lesson_data.get('card_style', 'modern')

        # Split content into N chunks
        chunks = self._split_content(content, num_cards)
        if not chunks:
            chunks = [content]

        actual_n = len(chunks)
        cards: List[Dict] = []
        all_text_parts: List[str] = []

        for idx, chunk in enumerate(chunks, start=1):
            sub_title = f"{title} ({idx}/{actual_n})"
            card_input = {
                'title': sub_title,
                'content': chunk,
                'category': category,
                'difficulty': difficulty,
                'lesson_id': lesson_id,
                'card_number': f"{idx}/{actual_n}",
                'total_cards': actual_n,
                'card_style': card_style,
            }
            result = self.generate_card(card_input, card_style=card_style)
            cards.append({
                'card_id': result.get('card_id'),
                'card_path': result.get('card_path'),
                'card_url': result.get('card_url'),
                'text_content': result.get('text_content', ''),
                'card_number': f"{idx}/{actual_n}",
            })
            all_text_parts.append(result.get('text_content', ''))

        combined_text = '\n\n' + ('─' * 40) + '\n\n'.join(all_text_parts)

        return {
            'success': True,
            'cards': cards,
            'total_cards': actual_n,
            'text_content': combined_text,
        }

    def generate_video_from_cards(
        self,
        cards: List[str],
        output_path: str,
        duration_per_card: int = 5,
    ) -> Dict:
        """يدمج الكروات في فيديو MP4.

        Args:
            cards: list of card image paths
            output_path: مسار ملف الفيديو الناتج (mp4)
            duration_per_card: مدة عرض كل كارت بالثواني

        Returns:
            {success, video_path, duration}
        """
        if not _ffmpeg_available():
            return {'success': False, 'error': 'FFmpeg not available'}

        if not cards:
            return {'success': False, 'error': 'No cards provided'}

        # Verify card files exist
        valid_cards: List[str] = []
        for c in cards:
            if c and Path(c).exists():
                valid_cards.append(c)
        if not valid_cards:
            return {'success': False, 'error': 'None of the card paths exist'}

        # Ensure output dir exists
        out_p = Path(output_path)
        out_p.parent.mkdir(parents=True, exist_ok=True)

        # Build ffmpeg command: each card as looped input for `duration_per_card` seconds,
        # then concat filter to merge them into one video.
        cmd: List[str] = ['ffmpeg', '-y']
        for card_path in valid_cards:
            cmd.extend(['-loop', '1', '-t', str(int(duration_per_card)), '-i', card_path])

        # Filter: scale each input to 1080x1350 (pad if needed) then concat
        # We embed scaling in the complex filtergraph to avoid conflict with -vf
        n = len(valid_cards)
        filter_parts = []
        for i in range(n):
            filter_parts.append(
                f'[{i}:v]scale=1080:1350:force_original_aspect_ratio=decrease,'
                f'pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[v{i}]'
            )
        concat_inputs = ''.join(f'[v{i}]' for i in range(n))
        filter_complex = ';'.join(filter_parts) + f';{concat_inputs}concat=n={n}:v=1:a=0[v]'
        cmd.extend([
            '-filter_complex', filter_complex,
            '-map', '[v]',
            '-pix_fmt', 'yuv420p',
            '-r', '30',
            str(out_p),
        ])

        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=120,
            )
            if result.returncode != 0:
                err = result.stderr.decode('utf-8', errors='replace')[-800:]
                return {'success': False, 'error': f'ffmpeg failed: {err}'}

            duration = n * int(duration_per_card)
            return {
                'success': True,
                'video_path': str(out_p),
                'duration': duration,
            }
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'ffmpeg timed out (>120s)'}
        except Exception as e:
            return {'success': False, 'error': f'ffmpeg error: {e}'}

    # ─────────────────────────────────────────────────────────────────────────
    # DB — list/get/publish
    # ─────────────────────────────────────────────────────────────────────────

    def get_generated_cards(self, limit: int = 50) -> List[Dict]:
        """قائمة الكروات المولّدة محفوظة في DB."""
        conn = self._db_connect()
        if conn is None:
            return []
        try:
            rows = conn.execute(
                "SELECT id, lesson_id, title, category, card_path, text_content, "
                "created_at, published_at, status "
                "FROM educational_cards ORDER BY created_at DESC LIMIT ?",
                (int(limit),)
            ).fetchall()
            result = []
            for r in rows:
                card_path = r[4] or ''
                card_url = None
                if card_path:
                    p = Path(card_path)
                    if p.exists():
                        # URL relative to project public/
                        try:
                            rel = p.relative_to(PROJECT_ROOT / 'public')
                            card_url = f"/{rel.as_posix()}"
                        except Exception:
                            card_url = f"/educational-cards/{p.name}"
                result.append({
                    'id': r[0],
                    'lesson_id': r[1],
                    'title': r[2],
                    'category': r[3],
                    'card_path': card_path,
                    'card_url': card_url,
                    'has_image': bool(card_path and Path(card_path).exists()),
                    'text_content': r[5],
                    'created_at': r[6],
                    'published_at': r[7],
                    'status': r[8],
                })
            return result
        except Exception as e:
            print(f"[EducationalCardsEngine] get_generated_cards error: {e}")
            return []
        finally:
            conn.close()

    def get_card_by_id(self, card_id: str) -> Optional[Dict]:
        """جلب كارت محدد من DB."""
        conn = self._db_connect()
        if conn is None:
            return None
        try:
            r = conn.execute(
                "SELECT id, lesson_id, title, category, card_path, text_content, "
                "created_at, published_at, status "
                "FROM educational_cards WHERE id = ?",
                (card_id,)
            ).fetchone()
            if not r:
                return None
            card_path = r[4] or ''
            card_url = None
            if card_path:
                p = Path(card_path)
                if p.exists():
                    try:
                        rel = p.relative_to(PROJECT_ROOT / 'public')
                        card_url = f"/{rel.as_posix()}"
                    except Exception:
                        card_url = f"/educational-cards/{p.name}"
            return {
                'id': r[0],
                'lesson_id': r[1],
                'title': r[2],
                'category': r[3],
                'card_path': card_path,
                'card_url': card_url,
                'has_image': bool(card_path and Path(card_path).exists()),
                'text_content': r[5],
                'created_at': r[6],
                'published_at': r[7],
                'status': r[8],
            }
        finally:
            conn.close()

    def publish_card_to_telegram(self, card_id: str) -> Dict:
        """نشر كارت على تليجرام.

        Returns:
            {success, telegram_message_id?, error?}
        """
        card = self.get_card_by_id(card_id)
        if not card:
            return {'success': False, 'error': 'Card not found'}

        try:
            # Lazy import — telegram client may not always be available
            sys.path.insert(0, str(VPS_ROOT))
            from telegram.auto_poster import TelegramAutoPoster  # type: ignore
            poster = TelegramAutoPoster()

            card_path = card.get('card_path') or ''
            caption = card.get('text_content', '')

            def _run_async(coro):
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    return loop.run_until_complete(coro)
                finally:
                    loop.close()

            if card_path and Path(card_path).exists():
                res = _run_async(poster.send_photo(card_path, caption=caption))
            else:
                res = _run_async(poster.send_message(caption))

            msg_id = None
            if isinstance(res, dict):
                msg_id = res.get('message_id') or res.get('id')
            elif isinstance(res, int):
                msg_id = res

            # Update DB
            conn = self._db_connect()
            if conn is not None:
                try:
                    conn.execute(
                        "UPDATE educational_cards SET status='published', "
                        "published_at=datetime('now') WHERE id=?",
                        (card_id,)
                    )
                    conn.commit()
                finally:
                    conn.close()

            return {
                'success': True,
                'telegram_message_id': msg_id,
                'card_id': card_id,
            }
        except ImportError:
            return {'success': False, 'error': 'Telegram poster not available'}
        except Exception as e:
            return {'success': False, 'error': f'Telegram publish error: {e}'}

    # ─────────────────────────────────────────────────────────────────────────
    # Internal: DB save
    # ─────────────────────────────────────────────────────────────────────────

    def _save_card_to_db(
        self,
        card_id: str,
        lesson_id: str,
        title: str,
        category: str,
        card_path: str,
        text_content: str,
    ) -> None:
        """حفظ الكارت في DB."""
        conn = self._db_connect()
        if conn is None:
            return
        try:
            conn.execute(
                "INSERT INTO educational_cards (id, lesson_id, title, category, card_path, text_content, status) "
                "VALUES (?, ?, ?, ?, ?, ?, 'pending')",
                (card_id, lesson_id, title, category, card_path, text_content)
            )
            conn.commit()
        except Exception as e:
            print(f"[EducationalCardsEngine] save card to DB error: {e}")
        finally:
            conn.close()

    # ─────────────────────────────────────────────────────────────────────────
    # Internal: text content builder
    # ─────────────────────────────────────────────────────────────────────────

    def _build_text_content(
        self,
        title: str,
        content: str,
        category: str,
        difficulty: str,
        card_number: str,
        total_cards: int,
    ) -> str:
        """بناء النص الكامل للكارت (يُستخدم للنشر على تليجرام بدون صورة)."""
        diff_class, diff_text = DIFFICULTY_MAP.get(difficulty, ('beginner', difficulty))
        cat_text = 'الأسهم' if category == 'stocks' else 'العملات الرقمية' if category == 'crypto' else category

        parts: List[str] = []
        parts.append(f"🎓 {PLATFORM_NAME} — كارت تعليمي")
        if total_cards and int(total_cards) > 1 if str(total_cards).isdigit() else False:
            parts.append(f"📋 الكارت {card_number}")
        parts.append(f"📘 {title}")
        parts.append(f"📊 التصنيف: {cat_text}  |  المستوى: {diff_text}")
        parts.append("")
        parts.append(content)
        parts.append("")
        parts.append(f"📢 {COMMUNITY_PROMPT}")
        parts.append("")
        parts.append("🔗 روابطنا الرسمية:")
        parts.append(f"🌐 {OFFICIAL_LINKS['website']}")
        parts.append(f"📱 {OFFICIAL_LINKS['android']}")
        parts.append(f"📘 {OFFICIAL_LINKS['facebook']}")
        parts.append(f"✈️ {OFFICIAL_LINKS['telegram']}")
        parts.append("")
        parts.append(DISCLAIMER_TEXT)
        return '\n'.join(parts)

    # ─────────────────────────────────────────────────────────────────────────
    # Internal: content splitter for series
    # ─────────────────────────────────────────────────────────────────────────

    def _split_content(self, content: str, num_cards: int) -> List[str]:
        """يقسم المحتوى إلى num_cards أقسام متوازنة.

        Strategy:
        1. Split by paragraphs (\\n\\n)
        2. If paragraphs >= num_cards → distribute evenly
        3. If fewer → split longest paragraphs further
        """
        if not content:
            return []
        if num_cards <= 1:
            return [content]

        # Split by double-newline (paragraphs)
        paragraphs = [p.strip() for p in re.split(r'\n\s*\n', content) if p.strip()]

        if len(paragraphs) >= num_cards:
            # Distribute paragraphs across N cards
            chunks: List[str] = []
            per = len(paragraphs) // num_cards
            extra = len(paragraphs) % num_cards
            idx = 0
            for i in range(num_cards):
                take = per + (1 if i < extra else 0)
                chunk = '\n\n'.join(paragraphs[idx:idx + take])
                chunks.append(chunk)
                idx += take
            return chunks

        # Fewer paragraphs than cards → split longest paragraphs by single newlines
        if len(paragraphs) < num_cards:
            # Expand: split each paragraph by single newlines
            lines: List[str] = []
            for p in paragraphs:
                lines.extend(p.split('\n'))
            lines = [l for l in lines if l.strip()]

            if len(lines) >= num_cards:
                per = len(lines) // num_cards
                extra = len(lines) % num_cards
                chunks = []
                idx = 0
                for i in range(num_cards):
                    take = per + (1 if i < extra else 0)
                    chunk = '\n'.join(lines[idx:idx + take])
                    chunks.append(chunk)
                    idx += take
                return chunks

            # Still fewer lines than cards → split by sentences
            sentences: List[str] = []
            for line in lines:
                # Split on Arabic and Latin sentence enders
                parts = re.split(r'(?<=[\.\!\?؟])\s+', line)
                sentences.extend([s for s in parts if s.strip()])

            if len(sentences) >= num_cards:
                per = len(sentences) // num_cards
                extra = len(sentences) % num_cards
                chunks = []
                idx = 0
                for i in range(num_cards):
                    take = per + (1 if i < extra else 0)
                    chunk = ' '.join(sentences[idx:idx + take])
                    chunks.append(chunk)
                    idx += take
                return chunks

            # Last resort: just duplicate content across cards (truncated)
            # Actually, return what we have even if fewer than requested
            return sentences if sentences else [content]

        return [content]

    # ─────────────────────────────────────────────────────────────────────────
    # Internal: HTML builder + Playwright
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    async def _html_to_png(html_content: str, output_path: str,
                           width: int = 1080, height: int = 1350) -> None:
        """تحويل HTML إلى PNG باستخدام Playwright (Chromium)."""
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            try:
                page = await browser.new_page(viewport={'width': width, 'height': height})
                await page.set_content(html_content, wait_until='networkidle')
                # Extra wait for KaTeX + fonts to fully render
                try:
                    await page.wait_for_timeout(1200)
                except Exception:
                    pass
                await page.screenshot(path=output_path, full_page=False)
            finally:
                await browser.close()

    def _build_html(
        self,
        title: str,
        content: str,
        difficulty: str,
        card_number: str,
        total_cards: int,
        card_style: str = 'modern',
    ) -> str:
        """يبني HTML كامل للكارت."""
        diff_class, diff_text = DIFFICULTY_MAP.get(difficulty, ('beginner', difficulty))
        content_html = _format_content_to_html(content)
        logo_html = ''
        if self._logo_data_uri:
            logo_html = (
                f'<img src="{self._logo_data_uri}" alt="logo" class="logo-img" />'
            )

        # Style variations
        style_extra = ''
        if card_style == 'classic':
            style_extra = """
            .title { font-weight: 900; letter-spacing: 0.5px; }
            .content { font-size: 26px; line-height: 1.9; }
            """
        elif card_style == 'minimal':
            style_extra = """
            body { padding: 80px 60px; }
            .header { margin-bottom: 50px; }
            .title { font-size: 38px; font-weight: 700; }
            .content { font-size: 26px; line-height: 1.9; color: #cbd5e1; }
            .footer { border-top: 1px solid rgba(212,175,55,0.2); }
            """

        return f"""<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"
          onload="renderMathInElement(document.body, {{delimiters: [
            {{left: '$$', right: '$$', display: true}},
            {{left: '$', right: '$', display: false}}
          ]}});"></script>
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    html, body {{
      width: 1080px; height: 1350px;
      font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
      background: linear-gradient(135deg, {COLOR_BG} 0%, {COLOR_BG_LIGHT} 100%);
      color: {COLOR_TEXT};
      overflow: hidden;
    }}
    body {{
      width: 1080px; height: 1350px;
      display: flex; flex-direction: column;
      padding: 60px;
    }}
    .header {{
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid {COLOR_GOLD};
    }}
    .header-left {{ display: flex; align-items: center; gap: 16px; }}
    .logo-img {{
      width: 60px; height: 60px;
      border-radius: 12px;
      border: 2px solid {COLOR_GOLD};
    }}
    .logo {{
      font-size: 36px; font-weight: 900; color: {COLOR_GOLD};
      letter-spacing: -0.5px;
    }}
    .card-number {{
      font-size: 24px; color: {COLOR_MUTED};
      font-weight: 600;
      background: rgba(212,175,55,0.1);
      padding: 8px 18px;
      border-radius: 20px;
      border: 1px solid rgba(212,175,55,0.3);
    }}
    .difficulty {{
      display: inline-block; padding: 8px 24px; border-radius: 20px;
      font-size: 18px; font-weight: 700;
      margin-bottom: 24px;
    }}
    .difficulty-beginner {{ background: rgba(16, 185, 129, 0.2); color: {COLOR_GREEN}; border: 1px solid {COLOR_GREEN}; }}
    .difficulty-intermediate {{ background: rgba(245, 158, 11, 0.2); color: {COLOR_ORANGE}; border: 1px solid {COLOR_ORANGE}; }}
    .difficulty-advanced {{ background: rgba(239, 68, 68, 0.2); color: {COLOR_RED}; border: 1px solid {COLOR_RED}; }}
    .title {{
      font-size: 42px; font-weight: 700; margin-bottom: 30px;
      color: {COLOR_GOLD}; line-height: 1.4;
    }}
    .content {{
      font-size: 28px; line-height: 1.8; flex: 1;
      color: #e2e8f0;
      overflow: hidden;
    }}
    .content p {{ margin-bottom: 18px; }}
    .content strong {{ color: {COLOR_GOLD}; font-weight: 700; }}
    .content ul, .content ol {{ margin: 12px 28px 18px; }}
    .content li {{ margin-bottom: 8px; }}
    .content .empty {{ color: {COLOR_MUTED}; font-style: italic; }}
    /* KaTeX display math: scroll-safe */
    .katex-display {{ margin: 18px 0; overflow-x: auto; overflow-y: hidden; }}
    .katex {{ font-size: 1.05em; color: {COLOR_TEXT}; }}
    .footer {{
      margin-top: 30px; padding-top: 24px;
      border-top: 2px solid rgba(212, 175, 55, 0.3);
      font-size: 18px;
    }}
    .footer-links {{ color: {COLOR_MUTED}; line-height: 2; }}
    .footer-links a {{ color: {COLOR_MUTED}; text-decoration: none; }}
    .disclaimer {{
      margin-top: 14px; font-size: 16px;
      color: #64748b; font-style: italic;
    }}
    {style_extra}
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      {logo_html}
      <div class="logo">{PLATFORM_NAME}</div>
    </div>
    <div class="card-number">{card_number}</div>
  </div>
  <div class="difficulty difficulty-{diff_class}">{diff_text}</div>
  <h1 class="title">{_escape_html(title)}</h1>
  <div class="content">{content_html}</div>
  <div class="footer">
    <div class="footer-links">
      🔗 روابطنا الرسمية:<br>
      🌐 invist.m2y.net<br>
      📱 play.google.com/store/apps/details?id=com.egx.investment<br>
      📘 facebook.com/profile.php?id=61590600300048<br>
      ✈️ t.me/Arabian_investment_guide
    </div>
    <div class="disclaimer">{DISCLAIMER_TEXT}</div>
  </div>
</body>
</html>"""


# ─────────────────────────────────────────────────────────────────────────────
# CLI entry point (for manual testing)
# ─────────────────────────────────────────────────────────────────────────────


    def generate_infographic(self, lesson_data: Dict) -> Dict:
        """
        توليد صورة طويلة (Infographic) للدرس كامل.
        الأبعاد: 1080×طول متغير حسب المحتوى (min 2000px)
        """
        import base64
        try:
            title = lesson_data.get('title', 'درس تعليمي')
            content = lesson_data.get('content', '')
            category = lesson_data.get('category', 'stocks')
            difficulty = lesson_data.get('difficulty', 'مبتدئ')

            # معالجة المحتوى - تحويل \n لـ HTML
            content_html = content.replace('\\n', '\n')
            paragraphs = content_html.split('\n')

            body_html = ''
            for para in paragraphs:
                para = para.strip()
                if not para:
                    continue
                # تحويل **bold** لـ <strong>
                para = para.replace('**', '<strong>', 1)
                if '**' in para:
                    para = para.replace('**', '</strong>', 1)
                # KaTeX inline
                para = para.replace('$', '<span class="math-inline">', 1)
                if '$' in para:
                    para = para.replace('$', '</span>', 1)
                body_html += f'<p>{para}</p>\n'

            # تقدير الارتفاع
            estimated_height = max(2000, 400 + len(paragraphs) * 60)

            html = f"""<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"
        onload="renderMathInElement(document.body,{{delimiters:[{{left:'$$',right:'$$',display:true}},{{left:'$',right:'$',display:false}}]}});"></script>
<style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{
  width: 1080px; min-height: {estimated_height}px;
  font-family: 'Cairo', sans-serif;
  background: linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
  color: #f8fafc; padding: 60px;
  display: flex; flex-direction: column;
}}
.header {{
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 40px; padding-bottom: 30px;
  border-bottom: 3px solid #d4af37;
}}
.logo {{
  font-size: 40px; font-weight: 900; color: #d4af37;
  display: flex; align-items: center; gap: 15px;
}}
.logo-icon {{
  width: 60px; height: 60px; border-radius: 12px;
  background: linear-gradient(135deg, #d4af37, #f59e0b);
  display: flex; align-items: center; justify-content: center;
  font-size: 32px;
}}
.category-badge {{
  padding: 10px 25px; border-radius: 25px;
  font-size: 20px; font-weight: 600;
  background: rgba(212, 175, 55, 0.15); color: #d4af37;
  border: 1px solid rgba(212, 175, 55, 0.3);
}}
.title {{
  font-size: 52px; font-weight: 900; margin-bottom: 30px;
  color: #d4af37; line-height: 1.5;
  text-shadow: 0 2px 10px rgba(212, 175, 55, 0.2);
}}
.difficulty-row {{
  display: flex; gap: 15px; margin-bottom: 40px;
}}
.diff-tag {{
  padding: 8px 20px; border-radius: 20px;
  font-size: 18px; font-weight: 600;
}}
.diff-beginner {{ background: rgba(16, 185, 129, 0.2); color: #10b981; }}
.diff-intermediate {{ background: rgba(245, 158, 11, 0.2); color: #f59e0b; }}
.diff-advanced {{ background: rgba(239, 68, 68, 0.2); color: #ef4444; }}
.content {{
  font-size: 30px; line-height: 1.9; flex: 1;
  color: #e2e8f0;
}}
.content p {{
  margin-bottom: 20px;
}}
.content strong {{
  color: #d4af37; font-weight: 700;
}}
.content .math-inline {{
  color: #60a5fa; font-style: italic;
}}
.section-divider {{
  height: 2px; background: linear-gradient(90deg, transparent, #d4af37, transparent);
  margin: 30px 0;
}}
.footer {{
  margin-top: 50px; padding-top: 30px;
  border-top: 3px solid rgba(212, 175, 55, 0.3);
}}
.footer-box {{
  background: rgba(212, 175, 55, 0.08);
  border: 1px solid rgba(212, 175, 55, 0.2);
  border-radius: 16px; padding: 25px;
}}
.footer-title {{
  font-size: 24px; font-weight: 700; color: #d4af37;
  margin-bottom: 15px;
}}
.footer-links {{
  font-size: 20px; color: #94a3b8; line-height: 2.2;
}}
.footer-links a {{
  color: #60a5fa; text-decoration: none;
}}
.disclaimer {{
  margin-top: 15px; font-size: 18px;
  color: #64748b; font-style: italic;
  text-align: center;
}}
</style>
</head>
<body>
  <div class="header">
    <div class="logo">
      <div class="logo-icon">📈</div>
      دليل الاستثمار
    </div>
    <div class="category-badge">{("الأسهم" if category == "stocks" else "عملات رقمية")}</div>
  </div>

  <div class="difficulty-row">
    <span class="diff-tag diff-{'beginner' if difficulty == 'مبتدئ' else 'intermediate' if difficulty == 'متوسط' else 'advanced'}">{difficulty}</span>
  </div>

  <h1 class="title">{title}</h1>

  <div class="section-divider"></div>

  <div class="content">
    {body_html}
  </div>

  <div class="footer">
    <div class="footer-box">
      <div class="footer-title">🔗 روابطنا الرسمية</div>
      <div class="footer-links">
        🌐 الموقع الإلكتروني: https://invist.m2y.net<br>
        📱 تطبيق أندرويد: https://play.google.com/store/apps/details?id=com.egx.investment<br>
        📘 فيسبوك: https://www.facebook.com/profile.php?id=61590600300048<br>
        ✈️ تليجرام: https://t.me/Arabian_investment_guide
      </div>
      <div class="disclaimer">⚠️ محتوى تعليمي — ليس توقعة استثمارية</div>
    </div>
  </div>
</body>
</html>"""

            filename = f"infographic_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
            filepath = os.path.join(self.output_dir, filename)

            if PLAYWRIGHT_AVAILABLE:
                import asyncio
                async def render():
                    from playwright.async_api import async_playwright
                    async with async_playwright() as p:
                        browser = await p.chromium.launch()
                        page = await browser.new_page(viewport={'width': 1080, 'height': estimated_height})
                        await page.set_content(html, wait_until='networkidle')
                        await page.wait_for_timeout(2000)  # انتظار KaTeX
                        await page.screenshot(path=filepath, full_page=True)
                        await browser.close()
                asyncio.run(render())
            else:
                return {'success': False, 'error': 'Playwright not available'}

            return {
                'success': True,
                'infographic_path': filepath,
                'infographic_url': f'/educational-cards/{filename}',
                'width': 1080,
                'estimated_height': estimated_height,
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def generate_pdf(self, lesson_data: Dict) -> Dict:
        """
        توليد PDF من الدرس.
        يستخدم Playwright لتحويل HTML → PDF.
        """
        try:
            # استخدم نفس HTML بتاع الـ infographic بس بـ format PDF
            info_result = self.generate_infographic(lesson_data)
            if not info_result.get('success'):
                return info_result

            # تحويل الـ PNG لـ PDF (أو نولّد PDF مباشرة من HTML)
            html_path = info_result['infographic_path'].replace('.png', '.html')
            pdf_path = info_result['infographic_path'].replace('.png', '.pdf')

            if PLAYWRIGHT_AVAILABLE:
                import asyncio
                async def render_pdf():
                    from playwright.async_api import async_playwright
                    async with async_playwright() as p:
                        browser = await p.chromium.launch()
                        page = await browser.new_page()
                        # استخدم نفس HTML بتاع الـ infographic
                        await page.goto(f'file://{info_result["infographic_path"]}')
                        await page.wait_for_timeout(2000)
                        await page.pdf(path=pdf_path, format='A4', print_background=True)
                        await browser.close()
                # ملاحظة: Playwright PDF بيحتاج Chromium headless
                # كبديل، نستخدم الصورة المولّدة ونحوّلها لـ PDF
                try:
                    from PIL import Image
                    img = Image.open(info_result['infographic_path'])
                    img = img.convert('RGB')
                    img.save(pdf_path, 'PDF', resolution=150.0)
                except Exception:
                    # لو PIL مش متاح، نرجع مسار الـ PNG
                    return {
                        'success': True,
                        'pdf_path': info_result['infographic_path'],
                        'pdf_url': info_result['infographic_url'],
                        'note': 'PDF generation needs PIL, returning PNG instead'
                    }

            return {
                'success': True,
                'pdf_path': pdf_path,
                'pdf_url': f'/educational-cards/{os.path.basename(pdf_path)}',
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ================================================================
    # GIF متحرك
    # ================================================================

    def generate_gif(self, lesson_data: Dict, num_frames=8, duration_per_frame=1500) -> Dict:
        """
        توليد GIF متحرك من الدرس.
        كل فريم يظهر جزء من المحتوى تدريجياً.
        """
        try:
            title = lesson_data.get('title', 'درس تعليمي')
            content = lesson_data.get('content', '')

            # تقسيم المحتوى لـ num_frames أجزاء
            lines = content.split('\n')
            lines = [l.strip() for l in lines if l.strip()]

            if len(lines) < num_frames:
                num_frames = len(lines)

            # توليد فريم لكل جزء
            frames = []
            for i in range(num_frames):
                visible_lines = lines[:i+1]
                visible_content = '\n'.join(visible_lines)

                frame_data = {
                    **lesson_data,
                    'content': visible_content,
                    'title': title,
                    'card_number': f'{i+1}/{num_frames}',
                    'total_cards': num_frames,
                }

                result = self.generate_card(frame_data)
                if result.get('success') and result.get('card_path'):
                    frames.append(result['card_path'])

            if not frames:
                return {'success': False, 'error': 'No frames generated'}

            # دمج الفريمات في GIF
            gif_path = os.path.join(self.output_dir, f"gif_{datetime.now().strftime('%Y%m%d_%H%M%S')}.gif")

            try:
                from PIL import Image
                images = [Image.open(f).convert('RGB') for f in frames]
                images[0].save(
                    gif_path,
                    save_all=True,
                    append_images=images[1:],
                    duration=duration_per_frame,
                    loop=0
                )
            except Exception as e:
                return {'success': False, 'error': f'GIF creation failed: {e}'}

            return {
                'success': True,
                'gif_path': gif_path,
                'gif_url': f'/educational-cards/{os.path.basename(gif_path)}',
                'num_frames': len(frames),
                'duration_ms': duration_per_frame,
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}


if __name__ == '__main__':
    _main()
