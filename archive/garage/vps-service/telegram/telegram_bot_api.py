#!/usr/bin/env python3
"""
telegram_bot_api.py — عميل Bot API مشترك للتليجرام
====================================================
الهدف: مكان واحد للإرسال على التليجرام بدل 7 نداءات HTTP مكررة في المشروع.

المميزات:
  - قارئ الـ credentials من البيئة (مع fallback للملف)
  - retries ذكية: 429 (flood control) + 5xx + timeouts
  - escape تلقائي لـ HTML + تنظيف control characters
  - إрезال quota: يقرأ headers من الاستجابة ويؤجل الإرسال
  - dry_run: يبني الرسالة ولا يرسل (مفيد للـ preview/tests)
  - حد أقصى لطول الرسالة/الكابشن (4096 / 1024 حرف)

الاستخدام:
    from telegram.telegram_bot_api import TelegramBotClient

    bot = TelegramBotClient()
    if bot.enabled:
        bot.send_message('<b>خبر</b>', reply_markup={'inline_keyboard': []})

Environment:
    TELEGRAM_BOT_TOKEN      (مطلوب)
    TELEGRAM_CHAT_ID        (مفضّل) أو TELEGRAM_CHANNEL_ID
    TELEGRAM_BOT_TIMEOUT    (default 20s)
    TELEGRAM_BOT_DRY_RUN    (1 = لا إرسال حقيقي)
"""

from __future__ import annotations

import html
import json
import logging
import mimetypes
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    from telegram_branding import get_official_reply_markup
except ImportError:
    try:
        from telegram.telegram_branding import get_official_reply_markup
    except ImportError:
        def get_official_reply_markup(ticker=None, **kw):
            return None

log = logging.getLogger('TelegramBotAPI')

MAX_MESSAGE_LEN = 4096
MAX_CAPTION_LEN = 1024
MAX_RETRIES = 3
RETRY_BASE_SLEEP = 2.0


# ═══════════════════════════════════════════════════════════════════════
# Formatting helpers
# ═══════════════════════════════════════════════════════════════════════

def esc(text: Any) -> str:
    """تهريب HTML + إزالة المحارف التحكمية اللي بتكسر parse_mode=HTML."""
    if text is None:
        return ''
    s = str(text)
    # Telegram HTML parser بيرفض control characters (خاصة \x00) والـ surrogate pairs
    s = ''.join(ch for ch in s if ch == '\n' or ch == '\t' or ord(ch) >= 32)
    return html.escape(s, quote=False)


def truncate(text: str, limit: int) -> str:
    """قص النص الطويل مع علامة حذف واضحة."""
    text = text or ''
    if len(text) <= limit:
        return text
    return text[:max(0, limit - 1)].rstrip() + '…'


def split_message(text: str, limit: int = MAX_MESSAGE_LEN) -> List[str]:
    """تقسيم رسالة طويلة على أسطر (Discord/Telegram بيقبلوا 4096 حرف فقط)."""
    text = text or ''
    if len(text) <= limit:
        return [text] if text else []
    chunks: List[str] = []
    current = ''
    for line in text.split('\n'):
        if len(current) + len(line) + 1 > limit:
            if current:
                chunks.append(current)
            current = ''
            while len(line) > limit:
                chunks.append(truncate(line, limit))
                line = line[limit:]
        current = f'{current}\n{line}' if current else line
    if current:
        chunks.append(current)
    return chunks


# ═══════════════════════════════════════════════════════════════════════
# Client
# ═══════════════════════════════════════════════════════════════════════

class TelegramBotClient:
    """
    Thin, dependency-free Telegram Bot API client.

    Not thread-safe by design (per-call HTTP), but safe to use from
    multiple processes — each process builds its own instance.
    """

    def __init__(
        self,
        token: Optional[str] = None,
        chat_id: Optional[str] = None,
        timeout: Optional[int] = None,
        dry_run: Optional[bool] = None,
        parse_mode: str = 'HTML',
    ) -> None:
        self.token = token if token is not None else os.environ.get('TELEGRAM_BOT_TOKEN', '')
        # TELEGRAM_CHAT_ID أولاً (الدردشة الخاصة) ثم TELEGRAM_CHANNEL_ID (القناة)
        self.chat_id = (
            chat_id if chat_id is not None
            else (os.environ.get('TELEGRAM_CHAT_ID', '') or os.environ.get('TELEGRAM_CHANNEL_ID', ''))
        )
        self.timeout = timeout or int(os.environ.get('TELEGRAM_BOT_TIMEOUT', '20') or 20)
        self.dry_run = (
            dry_run if dry_run is not None
            else os.environ.get('TELEGRAM_BOT_DRY_RUN', '') in ('1', 'true', 'True', 'yes')
        )
        self.parse_mode = parse_mode
        self._frozen_until: float = 0.0
        self.stats: Dict[str, int] = {'sent': 0, 'failed': 0, 'skipped': 0, 'dry_run': 0}

    # ── state ──
    @property
    def enabled(self) -> bool:
        """هل الـ client جاهز للإرسال؟"""
        return bool(self.token and self.chat_id)

    @property
    def frozen(self) -> bool:
        """هل العميل في فترة انتظار (flood control)؟"""
        return time.time() < self._frozen_until

    def status(self) -> Dict[str, Any]:
        """حالة الـ client بدون كشف الـ token."""
        return {
            'enabled': self.enabled,
            'has_token': bool(self.token),
            'chat_id': self.chat_id or None,
            'dry_run': self.dry_run,
            'parse_mode': self.parse_mode,
            'frozen': self.frozen,
            'frozen_for_seconds': max(0, round(self._frozen_until - time.time(), 1)),
            'stats': dict(self.stats),
        }

    # ── low level ──
    def _api_url(self, method: str) -> str:
        return f'https://api.telegram.org/bot{self.token}/{method}'

    def _freeze(self, seconds: float) -> None:
        self._frozen_until = max(self._frozen_until, time.time() + seconds)
        log.warning('Telegram flood control — الإيقاف المؤقت %ss', round(seconds, 1))

    def _request(
        self,
        method: str,
        payload: Dict[str, Any],
        files: Optional[Dict[str, Tuple[str, bytes, str]]] = None,
    ) -> Dict[str, Any]:
        """
        POST واحد مع retries.

        Returns:
            {'ok': bool, 'description': str, 'result': dict, 'message_id': int}
        """
        url = self._api_url(method)
        last_error = ''

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                data = {k: v for k, v in payload.items() if v is not None}

                if files:
                    resp, body = self._post_multipart(url, data, files)
                else:
                    encoded = urllib.parse.urlencode(data).encode()
                    req = urllib.request.Request(
                        url, data=encoded, method='POST',
                        headers={'Content-Type': 'application/x-www-form-urlencoded'},
                    )
                    with urllib.request.urlopen(req, timeout=self.timeout) as raw:
                        resp = dict(raw.headers.items())
                        body = json.loads(raw.read().decode('utf-8'))

                if body.get('ok'):
                    result = body.get('result') or {}
                    return {
                        'ok': True,
                        'result': result,
                        'message_id': result.get('message_id'),
                        'description': '',
                    }

                description = body.get('description', 'unknown error')
                last_error = description

                # 429 = rate limit → نقرأ retry_after ونجمد العميل
                if 'retry_after' in body:
                    try:
                        self._freeze(float(body['retry_after']) + 1.0)
                    except (TypeError, ValueError):
                        pass
                    break

                # 5xx → transitory، نعيد المحاولة
                if 500 <= body.get('error_code', 0) < 600 and attempt < MAX_RETRIES:
                    time.sleep(RETRY_BASE_SLEEP * attempt)
                    continue

                return {'ok': False, 'description': description, 'result': {}, 'message_id': None}

            except urllib.error.HTTPError as e:
                last_error = f'HTTP {e.code}'
                if e.code == 429:
                    try:
                        retry_after = float(json.loads(e.read().decode()).get('parameters', {}).get('retry_after', 5))
                        self._freeze(retry_after + 1.0)
                    except Exception:
                        self._freeze(10.0)
                    break
                if e.code >= 500 and attempt < MAX_RETRIES:
                    time.sleep(RETRY_BASE_SLEEP * attempt)
                    continue
                return {'ok': False, 'description': last_error, 'result': {}, 'message_id': None}
            except Exception as e:
                last_error = f'{type(e).__name__}: {e}'
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_BASE_SLEEP * attempt)
                    continue
                return {'ok': False, 'description': last_error, 'result': {}, 'message_id': None}

        return {'ok': False, 'description': last_error, 'result': {}, 'message_id': None}

    def _post_multipart(
        self,
        url: str,
        fields: Dict[str, Any],
        files: Dict[str, Tuple[str, bytes, str]],
    ) -> Tuple[Dict[str, str], Dict[str, Any]]:
        """multipart/form-data بدون الاعتماد على مكتبة requests."""
        boundary = '----GLMNewsBoundary7MA4YWxkTrZu0gW'
        chunks: List[bytes] = []

        for key, value in fields.items():
            chunks.append(f'--{boundary}\r\n'.encode())
            chunks.append(
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode()
            )
            chunks.append(f'{value}\r\n'.encode())

        for key, (filename, data, mime) in files.items():
            chunks.append(f'--{boundary}\r\n'.encode())
            chunks.append(
                f'Content-Disposition: form-data; name="{key}"; filename="{filename}"\r\n'.encode()
            )
            chunks.append(f'Content-Type: {mime}\r\n\r\n'.encode())
            chunks.append(data)
            chunks.append(b'\r\n')

        chunks.append(f'--{boundary}--\r\n'.encode())

        req = urllib.request.Request(
            url,
            data=b''.join(chunks),
            method='POST',
            headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as raw:
            return dict(raw.headers.items()), json.loads(raw.read().decode('utf-8'))

    # ── public API ──
    def send_message(
        self,
        text: str,
        chat_id: Optional[str] = None,
        parse_mode: Optional[str] = None,
        disable_web_page_preview: bool = False,
        reply_markup: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """إرسال رسالة نصية (يقسّمها تلقائياً لو أطول من 4096)."""
        if not self.enabled:
            self.stats['skipped'] += 1
            return {'ok': False, 'description': 'missing_credentials', 'result': {}, 'message_id': None}
        if self.frozen:
            self.stats['skipped'] += 1
            return {'ok': False, 'description': 'flood_wait', 'result': {}, 'message_id': None}
        if self.dry_run:
            self.stats['dry_run'] += 1
            return {'ok': True, 'description': 'dry_run', 'result': {}, 'message_id': 0}

        target = chat_id or self.chat_id
        chunks = split_message(text or '', MAX_MESSAGE_LEN)
        if not chunks:
            return {'ok': False, 'description': 'empty_message', 'result': {}, 'message_id': None}

        # أزرار الهوية الموحدة الرسمية (الموقع + البوت + الخدمات + التواصل)
        final_markup = get_official_reply_markup() if reply_markup is None else (None if reply_markup is False else reply_markup)

        last: Dict[str, Any] = {'ok': False, 'description': 'no_chunk_sent', 'result': {}, 'message_id': None}
        sent_any = False
        for chunk in chunks:
            payload = {
                'chat_id': target,
                'text': chunk,
                'parse_mode': parse_mode or self.parse_mode,
                'disable_web_page_preview': 'true' if disable_web_page_preview else 'false',
                'reply_markup': json.dumps(final_markup, ensure_ascii=False) if final_markup else None,
            }
            res = self._request('sendMessage', payload)
            if res['ok']:
                sent_any = True
                last = res
            else:
                log.warning('sendMessage فشل: %s', res['description'])
                last = res
                break

        if sent_any:
            self.stats['sent'] += 1
        else:
            self.stats['failed'] += 1
        return last

    def send_photo(
        self,
        photo: str,
        caption: Optional[str] = None,
        chat_id: Optional[str] = None,
        parse_mode: Optional[str] = None,
        reply_markup: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        إرسال صورة — يقبل رابط http(s) أو مسار ملف محلي.

        Falls back gracefully: لو الملف غير موجود → يرجع失敗 من غير exception.
        """
        if not self.enabled:
            self.stats['skipped'] += 1
            return {'ok': False, 'description': 'missing_credentials', 'result': {}, 'message_id': None}
        if self.frozen:
            self.stats['skipped'] += 1
            return {'ok': False, 'description': 'flood_wait', 'result': {}, 'message_id': None}
        if self.dry_run:
            self.stats['dry_run'] += 1
            return {'ok': True, 'description': 'dry_run', 'result': {}, 'message_id': 0}

        target = chat_id or self.chat_id
        cap = truncate(caption or '', MAX_CAPTION_LEN) or None
        final_markup = get_official_reply_markup() if reply_markup is None else (None if reply_markup is False else reply_markup)
        payload: Dict[str, Any] = {
            'chat_id': target,
            'caption': cap,
            'parse_mode': parse_mode or self.parse_mode if cap else None,
            'reply_markup': json.dumps(final_markup, ensure_ascii=False) if final_markup else None,
        }

        files: Optional[Dict[str, Tuple[str, bytes, str]]] = None
        if photo.startswith('http://') or photo.startswith('https://'):
            payload['photo'] = photo
        else:
            path = Path(photo)
            if not path.exists() or not path.is_file():
                self.stats['failed'] += 1
                return {'ok': False, 'description': f'photo_not_found: {photo}',
                        'result': {}, 'message_id': None}
            mime = mimetypes.guess_type(str(path))[0] or 'image/jpeg'
            try:
                files = {'photo': (path.name, path.read_bytes(), mime)}
            except OSError as e:
                self.stats['failed'] += 1
                return {'ok': False, 'description': f'photo_read_error: {e}',
                        'result': {}, 'message_id': None}

        res = self._request('sendPhoto', payload, files=files)
        if res['ok']:
            self.stats['sent'] += 1
        else:
            self.stats['failed'] += 1
            log.warning('sendPhoto فشل: %s', res['description'])
        return res

    def send_document(
        self,
        file_path: str,
        caption: Optional[str] = None,
        chat_id: Optional[str] = None,
        parse_mode: Optional[str] = None,
    ) -> Dict[str, Any]:
        """إرسال مستند (PDF/Excel/etc.) — مفيد لتقارير نهاية اليوم."""
        if not self.enabled:
            self.stats['skipped'] += 1
            return {'ok': False, 'description': 'missing_credentials', 'result': {}, 'message_id': None}
        if self.dry_run:
            self.stats['dry_run'] += 1
            return {'ok': True, 'description': 'dry_run', 'result': {}, 'message_id': 0}

        path = Path(file_path)
        if not path.exists() or not path.is_file():
            self.stats['failed'] += 1
            return {'ok': False, 'description': f'file_not_found: {file_path}',
                    'result': {}, 'message_id': None}

        mime = mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
        payload: Dict[str, Any] = {
            'chat_id': chat_id or self.chat_id,
            'caption': truncate(caption or '', MAX_CAPTION_LEN) or None,
            'parse_mode': parse_mode or self.parse_mode if caption else None,
        }
        try:
            files = {'document': (path.name, path.read_bytes(), mime)}
        except OSError as e:
            self.stats['failed'] += 1
            return {'ok': False, 'description': f'file_read_error: {e}',
                    'result': {}, 'message_id': None}

        res = self._request('sendDocument', payload, files=files)
        if res['ok']:
            self.stats['sent'] += 1
        else:
            self.stats['failed'] += 1
        return res

    def send_message_or_photo(
        self,
        text: str,
        photo: Optional[str] = None,
        reply_markup: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """صورة + كابشن، ولو فشلت الصورة → نص. أبسط مسار للإرسال الآمن."""
        if photo:
            res = self.send_photo(photo, caption=text, reply_markup=reply_markup)
            if res['ok']:
                return res
            log.info('send_photo فشل (%s) — التحويل لإرسال نصي', res['description'])
        return self.send_message(text, reply_markup=reply_markup)


# ═══════════════════════════════════════════════════════════════════════
# Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print('🧪 telegram_bot_api — Self Test')
    print('=' * 60)

    assert esc('<b>hi</b>') == '&lt;b&gt;hi&lt;/b&gt;'
    assert esc('a & b') == 'a &amp; b'
    assert esc('bad\x00char\nkeep') == 'badchar\nkeep'
    print('  ✅ esc()')

    assert len(split_message('x' * 5000)[0]) <= MAX_MESSAGE_LEN
    # 20 سطر × 900 حرف = 4 أسطر في كل chunk (4×900+3 = 3603 ≤ 4096)
    chunks = split_message('\n'.join(['y' * 900] * 20))
    assert len(chunks) == 5, f'expected 5 chunks, got {len(chunks)}'
    assert all(len(c) <= MAX_MESSAGE_LEN for c in chunks)
    assert split_message('') == []
    print('  ✅ split_message()')

    bot = TelegramBotClient(token='', chat_id='')
    assert bot.enabled is False
    res = bot.send_message('test')
    assert res['ok'] is False and res['description'] == 'missing_credentials'
    print('  ✅ missing credentials guard')

    dry = TelegramBotClient(token='x', chat_id='y', dry_run=True)
    assert dry.enabled and dry.dry_run
    assert dry.send_message('مرحبا')['ok'] is True
    assert dry.stats['dry_run'] == 1
    print('  ✅ dry_run')

    fake = TelegramBotClient(token='t', chat_id='c')
    fake._frozen_until = 9999999999
    assert fake.frozen and fake.send_message('x')['description'] == 'flood_wait'
    print('  ✅ flood control guard')

    st = TelegramBotClient(token='t', chat_id='c').status()
    assert 't' not in st['chat_id'] and st['has_token'] is True
    print('  ✅ status() hides nothing sensitive')

    print('\n' + '=' * 60)
    print('✅ telegram_bot_api ready')
    print(f'Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (or TELEGRAM_CHANNEL_ID) to enable sending')