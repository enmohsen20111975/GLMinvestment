#!/usr/bin/env python3
"""
📤 Radar Card Publisher
========================
ينشر بطاقة رادار الميكرز اليومية على:
  - تليجرام (صورة + caption)
  - واتساب (caption فقط — واتساب Business API)

الـ workflow:
  1. يولّد البطاقة (radar_social_card.py)
  2. يبني caption عربي قصير بالتوصيات
  3. يبعت البطاقة كـ photo على تليجرام
  4. يسجّل في state file عشان النشر مايتكرّرش في نفس اليوم

الاستخدام:
  python3 radar_card_publisher.py              # نشر تلقائي (لو سمحت الجدولة)
  python3 radar_card_publisher.py --force      # نشر إجباري (تجاوز الجدولة)
  python3 radar_card_publisher.py --preview    # معاينة فقط بدون نشر
"""

import os
import sys
import json
import asyncio
import urllib.request
import urllib.parse
import urllib.error
import mimetypes
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

# Add paths
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

# ─────────────────────────────────────────────────────────────────────────────
# Load .env file manually (بدون python-dotenv)
# لازم نعمل ده قبل أي import من modules بتستخدم env vars
# ─────────────────────────────────────────────────────────────────────────────
def _load_env():
    """اقرأ .env يدوياً وضعه في os.environ (لو المفتاح مش موجود بالفعل)."""
    env_found_at = None
    for env_path in [PROJECT_ROOT / '.env', PROJECT_ROOT / 'news-agent' / '.env']:
        if env_path.exists():
            env_found_at = env_path
            with open(str(env_path), 'r') as f:
                for line in f:
                    line = line.strip()
                    if '=' in line and not line.startswith('#'):
                        key, val = line.split('=', 1)
                        key = key.strip()
                        val = val.strip()
                        if key and key not in os.environ:
                            os.environ[key] = val
            break
    return env_found_at

_ENV_PATH = _load_env()

# Debug: اطبع حالة env vars (بدون كشف القيم)
def _debug_env_status():
    """اطبع حالة متغيرات البيئة المهمة (بدون كشف القيم السرية)."""
    print(f'[ENV] .env loaded from: {_ENV_PATH or "NOT FOUND"}', flush=True)
    print(f'[ENV] PROJECT_ROOT: {PROJECT_ROOT}', flush=True)
    keys = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHANNEL_ID', 'TELEGRAM_CHAT_ID',
            'TELEGRAM_API_ID', 'TELEGRAM_API_HASH',
            'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_GROUP_ID']
    for k in keys:
        v = os.environ.get(k, '')
        if v:
            # اطبع أول 4 حروف بس للأمان
            masked = v[:4] + '...' + (v[-4:] if len(v) > 8 else '')
            print(f'[ENV] {k}: SET ({masked}, len={len(v)})', flush=True)
        else:
            print(f'[ENV] {k}: EMPTY/NOT SET', flush=True)

_debug_env_status()

# Imports
from analyzers.radar_social_card import generate_card, load_radar, pick_top_opportunities, pick_watchlist, compute_levels

# State file (مشان منعش التكرار)
STATE_FILE = Path(__file__).resolve().parent / 'radar_card_state.json'

OFFICIAL_LINKS = {
    'website': 'https://invist.m2y.net',
    'android': 'https://play.google.com/store/apps/details?id=com.egx.investment',
    'facebook': 'https://www.facebook.com/profile.php?id=61590600300048',
    'telegram': 'https://t.me/Arabian_investment_guide',
    'whatsapp': 'https://chat.whatsapp.com/L9hjEpJloAZAUvwMzB10Tc',
}

COMMUNITY_PROMPT = 'انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈'


def load_state() -> Dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding='utf-8'))
        except Exception:
            pass
    return {}


def save_state(state: Dict) -> None:
    try:
        STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')
    except Exception as e:
        print(f'[RadarPublisher] state save error: {e}', flush=True)


def should_publish_today(state: Dict) -> bool:
    """هل النشر تم اليوم بالفعل؟"""
    last = state.get('last_radar_card')
    if not last:
        return False
    try:
        last_dt = datetime.fromisoformat(last)
        return last_dt.date() == datetime.now().date()
    except Exception:
        return False


def _path_emoji_short(path: Optional[str]) -> str:
    """RADAR-QUICK-WINS (Priority 4): emoji + short Arabic label per radar path."""
    table = {
        'A_pre_surge': '🚀 تراكم مبكر جداً',
        'B_quiet_accumulation_strong': '🎯 تراكم صامت قوي',
        'C_quiet_accumulation_weak': '🔍 تراكم صامت ضعيف',
        'D_explosive_surge': '🔥 انفجار حجمي',
        'E_early_break': '⚡ كسر مبكر محتمل',
    }
    if not path:
        return '📡 رادار'
    return table.get(path, f'📡 {path}')


def _signal_stars(count: Optional[int], total: int = 6) -> str:
    """RADAR-QUICK-WINS (Priority 2): render signal_count as a 5-star meter
    using unicode chars (for Telegram caption). Returns an empty string if
    `count` is None (path doesn't track signal_count)."""
    if count is None or total <= 0:
        return ''
    clamped = max(0, min(int(count), total))
    stars = max(1, (clamped * 5 + total - 1) // total)  # ceil division → 1..5
    return '⭐' * stars + '☆' * (5 - stars)


def _resolve_signal_count(stock: Dict) -> Optional[int]:
    """Pull signal_count from whichever details block is populated."""
    qd = stock.get('quiet_details') or {}
    if qd and qd.get('signal_count') is not None:
        return int(qd.get('signal_count') or 0)
    pd = stock.get('pre_surge_details') or {}
    if pd and pd.get('signal_count') is not None:
        return int(pd.get('signal_count') or 0)
    return None


def build_caption(radar: Dict, picks: list, watchlist: list) -> str:
    """يبني caption عربي قصير للبطاقة.

    RADAR-QUICK-WINS (Priority 4): كل سهم بيتعرض في 5 سطور منفصلة عشان
    المستخدم يقدر يقراها بسرعة على تليجرام — دخول، هدف 1، هدف 2، وقف
    الخسارة، وقوة الإشارة بنجوم.
    """
    date_str = datetime.now().strftime('%Y-%m-%d')
    lines = []
    lines.append(f'🎯 <b>رادار الميكرز — {date_str}</b>')
    lines.append(f'📊 مفحوصين: {radar.get("total_scanned", 0)} | تحت الميكروسكوب: {radar.get("under_microscope_count", 0)}')
    lines.append('━━━━━━━━━━━━━━━━━━━')
    lines.append('')
    lines.append('⭐ <b>التوصيات الرئيسية:</b>')
    for i, s in enumerate(picks, 1):
        ticker = s.get('ticker', '???')
        levels = compute_levels(s)
        confidence = s.get('confidence_score', 0) or 0
        direction = s.get('expected_dir', '') or ''
        path = s.get('path')
        path_label = _path_emoji_short(path)

        entry = float(levels.get('entry', 0) or 0)
        # RADAR-QUICK-WINS (Priority 4): target_1 = levels['target']; target_2
        # is derived as +10% above target_1 (matches the Smart Entry Card
        # calculation in TradingPlanSection.tsx). stop_loss comes from
        # levels['stop'] when present, otherwise -6% of entry.
        target_1 = float(levels.get('target', 0) or 0)
        target_2 = float(levels.get('target_2', 0) or (target_1 * 1.10 if target_1 else 0))
        stop_loss = float(levels.get('stop', 0) or (entry * 0.94 if entry else 0))

        # Gain / loss percentages (graceful when entry is 0/missing)
        t1_gain = ((target_1 - entry) / entry * 100) if (entry > 0 and target_1 > 0) else 0
        t2_gain = ((target_2 - entry) / entry * 100) if (entry > 0 and target_2 > 0) else 0
        sl_loss = ((stop_loss - entry) / entry * 100) if (entry > 0 and stop_loss > 0) else 0

        sig_count = _resolve_signal_count(s)
        sig_max = 6 if (path in (None, 'B_quiet_accumulation_strong', 'C_quiet_accumulation_weak')) else (4 if path == 'A_pre_surge' else 0)
        sig_stars = _signal_stars(sig_count, sig_max) if sig_max else ''

        lines.append(
            f'{i}. {path_label.split(" ", 1)[0]} <b>{ticker}</b> — {path_label.split(" ", 1)[1] if " " in path_label else path_label}'
        )
        lines.append(f'   💰 الدخول: {entry:.2f}')
        if target_1 > 0:
            lines.append(f'   🎯 الهدف 1: {target_1:.2f} (+{t1_gain:.1f}%)')
        if target_2 > 0:
            lines.append(f'   🎯 الهدف 2: {target_2:.2f} (+{t2_gain:.1f}%)')
        if stop_loss > 0:
            lines.append(f'   🛑 وقف الخسارة: {stop_loss:.2f} ({sl_loss:.1f}%)')
        if sig_count is not None and sig_max:
            lines.append(f'   📊 قوة الإشارة: {sig_count}/{sig_max} {sig_stars}')
        if direction:
            lines.append(f'   🧭 {direction}')
    if watchlist:
        lines.append('')
        watch_str = ' • '.join(s.get('ticker', '???') for s in watchlist)
        lines.append(f'👁️ <b>قائمة المراقبة:</b> {watch_str}')
    lines.append('━━━━━━━━━━━━━━━━━━━')
    lines.append('')
    lines.append(COMMUNITY_PROMPT)
    lines.append('')
    lines.append('🔗 روابطنا الرسمية:')
    lines.append(f'🌐 {OFFICIAL_LINKS["website"]}')
    lines.append(f'📱 أندرويد: play.google.com/EGX')
    lines.append(f'✈️ {OFFICIAL_LINKS["telegram"]}')
    lines.append(f'💬 واتساب: {OFFICIAL_LINKS["whatsapp"]}')
    lines.append('')
    lines.append('⚠️ تحليل تلقائي — ليس نصيحة استثمارية')
    return '\n'.join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Telegram sender (صورة + caption)
# ─────────────────────────────────────────────────────────────────────────────
def _send_telegram_photo(bot_token: str, chat_id: str, photo_path: Path, caption: str) -> Dict:
    """يبعت صورة + caption لتليجرام."""
    url = f'https://api.telegram.org/bot{bot_token}/sendPhoto'
    try:
        with open(photo_path, 'rb') as f:
            file_data = f.read()
        filename = photo_path.name
        mime = mimetypes.guess_type(str(photo_path))[0] or 'image/png'

        boundary = '----WebKitFormBoundaryRadarCardPublisher'
        body = (
            f'--{boundary}\r\n'
            f'Content-Disposition: form-data; name="chat_id"\r\n\r\n{chat_id}\r\n'
            f'--{boundary}\r\n'
            f'Content-Disposition: form-data; name="caption"\r\n\r\n{caption[:1024]}\r\n'
            f'--{boundary}\r\n'
            f'Content-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n'
            f'--{boundary}\r\n'
            f'Content-Disposition: form-data; name="photo"; filename="{filename}"\r\n'
            f'Content-Type: {mime}\r\n\r\n'
        ).encode('utf-8') + file_data + f'\r\n--{boundary}--\r\n'.encode('utf-8')

        req = urllib.request.Request(
            url,
            data=body,
            headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            ok = result.get('ok', False)
            # استخرج رسالة الخطأ من Telegram API
            error_desc = result.get('description', '') if not ok else ''
            return {
                'success': ok,
                'message_id': (result.get('result') or {}).get('message_id'),
                'error': error_desc or None,
                'raw': result,
            }
    except urllib.error.HTTPError as e:
        # HTTP error (4xx/5xx) — اقرأ body بتاع تليجرام للتفاصيل
        body = e.read().decode('utf-8', errors='ignore')
        try:
            err_data = json.loads(body)
            desc = err_data.get('description', body)
        except Exception:
            desc = body
        return {'success': False, 'error': f'HTTP {e.code}: {desc}'}
    except Exception as e:
        return {'success': False, 'error': str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# WhatsApp Business sender (caption only — واتساب Business API)
# ─────────────────────────────────────────────────────────────────────────────
def _send_whatsapp_text(token: str, phone_id: str, to: str, text: str) -> Dict:
    """يبعت نص على واتساب Business Cloud API."""
    url = f'https://graph.facebook.com/v18.0/{phone_id}/messages'
    payload = {
        'messaging_product': 'whatsapp',
        'to': to,
        'type': 'text',
        'text': {'body': text, 'preview_url': False},
    }
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode('utf-8'),
            headers={
                'Authorization': f'Bearer {token}',
                'Content-Type': 'application/json',
            },
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            return {'success': True, 'raw': result}
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='ignore')
        return {'success': False, 'error': f'HTTP {e.code}: {body}'}
    except Exception as e:
        return {'success': False, 'error': str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# Main publisher
# ─────────────────────────────────────────────────────────────────────────────
def publish_radar_card(force: bool = False, preview_only: bool = False) -> Dict:
    """ينشئ البطاقة + ينشرها على تليجرام وواتساب.

    Returns:
        {
            success: bool,
            preview_path: str (محلي),
            card_path: str,
            caption_preview: str (أول 200 حرف),
            telegram: {...},
            whatsapp: {...},
            state_updated: bool,
            error?: str,
        }
    """
    state = load_state()

    # 1) فحص الجدولة (إلا لو --force)
    if not force and not preview_only:
        if should_publish_today(state):
            return {
                'success': False,
                'skipped': True,
                'reason': 'already_published_today',
                'last_publish': state.get('last_radar_card'),
            }

    # 2) توليد البطاقة
    card_result = generate_card()
    if not card_result.get('success'):
        return {
            'success': False,
            'error': card_result.get('error', 'card generation failed'),
            'radar_date': card_result.get('radar_date'),
            'picks_count': card_result.get('picks_count', 0),
        }

    card_path = Path(card_result['path'])

    # 3) بناء caption
    radar = load_radar()
    if not radar:
        return {'success': False, 'error': 'radar missing after card generation'}
    picks = pick_top_opportunities(radar, top_n=4)
    watchlist = pick_watchlist(radar, exclude=[s.get('ticker') for s in picks], n=3)
    caption = build_caption(radar, picks, watchlist)

    # 4) معاينة فقط؟
    if preview_only:
        return {
            'success': True,
            'preview': True,
            'card_path': str(card_path),
            'caption': caption,
            'picks': [s.get('ticker') for s in picks],
            'watchlist': [s.get('ticker') for s in watchlist],
            'radar_date': radar.get('generated_at'),
        }

    # 5) النشر على تليجرام
    bot_token = os.environ.get('TELEGRAM_BOT_TOKEN', '')
    chat_id = os.environ.get('TELEGRAM_CHANNEL_ID', '') or os.environ.get('TELEGRAM_CHAT_ID', '')

    telegram_result = None
    if bot_token and chat_id:
        telegram_result = _send_telegram_photo(bot_token, chat_id, card_path, caption)
    else:
        telegram_result = {'skipped': True, 'reason': 'no_telegram_credentials'}

    # 6) النشر على واتساب Business
    wa_token = os.environ.get('WHATSAPP_TOKEN', '')
    wa_phone_id = os.environ.get('WHATSAPP_PHONE_ID', '')
    wa_to = os.environ.get('WHATSAPP_GROUP_ID', '')  # معرّف جروب واتساب

    whatsapp_result = None
    if wa_token and wa_phone_id and wa_to:
        # واتساب مايدعمش HTML — نبني caption نصي عادي
        plain_caption = caption.replace('<b>', '').replace('</b>', '')
        whatsapp_result = _send_whatsapp_text(wa_token, wa_phone_id, wa_to, plain_caption)
    else:
        whatsapp_result = {'skipped': True, 'reason': 'no_whatsapp_credentials'}

    # 7) تحديث state (فقط لو تليجرام نجح)
    state_updated = False
    if telegram_result and telegram_result.get('success'):
        state['last_radar_card'] = datetime.now().isoformat()
        state['last_card_path'] = str(card_path)
        state['last_picks'] = [s.get('ticker') for s in picks]
        state['last_telegram_message_id'] = telegram_result.get('message_id')
        save_state(state)
        state_updated = True

    # استخرج رسالة الخطأ لو موجودة
    final_error = None
    if not (telegram_result and telegram_result.get('success')):
        if telegram_result and telegram_result.get('error'):
            final_error = f'telegram: {telegram_result["error"]}'
        elif telegram_result and telegram_result.get('skipped'):
            final_error = f'telegram skipped: {telegram_result.get("reason", "unknown")}'
        else:
            final_error = 'telegram publish failed (unknown reason)'

    return {
        'success': bool(telegram_result and telegram_result.get('success')),
        'error': final_error,
        'card_path': str(card_path),
        'caption_preview': caption[:300],
        'picks': [s.get('ticker') for s in picks],
        'watchlist': [s.get('ticker') for s in watchlist],
        'radar_date': radar.get('generated_at'),
        'telegram': telegram_result,
        'whatsapp': whatsapp_result,
        'state_updated': state_updated,
    }


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Radar Card Publisher')
    parser.add_argument('--force', action='store_true', help='نشر إجباري (تجاوز جدولة نفس اليوم)')
    parser.add_argument('--preview', action='store_true', help='معاينة فقط بدون نشر')
    parser.add_argument('--json', action='store_true', help='إخراج JSON فقط (للـ API)')
    args = parser.parse_args()

    if args.json:
        # إخراج JSON صامت للـ API
        result = publish_radar_card(force=args.force, preview_only=args.preview)
        print(json.dumps(result, ensure_ascii=False, default=str))
        sys.exit(0 if result.get('success') else 1)

    print('═══ 📤 Radar Card Publisher ═══', flush=True)
    result = publish_radar_card(force=args.force, preview_only=args.preview)

    if args.preview:
        if result.get('success'):
            print(f'✅ Preview ready: {result["card_path"]}', flush=True)
            print(f'   Picks: {result.get("picks", [])}', flush=True)
            print(f'   Watchlist: {result.get("watchlist", [])}', flush=True)
            print(f'   Radar date: {result.get("radar_date")}', flush=True)
        else:
            print(f'❌ Preview failed: {result.get("error")}', flush=True)
            sys.exit(1)
    else:
        if result.get('skipped'):
            print(f'⏭️ Skipped: {result.get("reason")} (last: {result.get("last_publish")})', flush=True)
        elif result.get('success'):
            print(f'✅ Published successfully', flush=True)
            print(f'   Card: {result["card_path"]}', flush=True)
            print(f'   Picks: {result.get("picks", [])}', flush=True)
            print(f'   Watchlist: {result.get("watchlist", [])}', flush=True)
            tg = result.get('telegram') or {}
            wa = result.get('whatsapp') or {}
            print(f'   Telegram: msg_id={tg.get("message_id")} | skipped={tg.get("skipped", False)}', flush=True)
            print(f'   WhatsApp: success={wa.get("success")} | skipped={wa.get("skipped", False)}', flush=True)
        else:
            print(f'❌ Failed: {result.get("error") or "unknown error"}', flush=True)
            # اطبع تفاصيل تليجرام لو موجودة
            tg = result.get('telegram') or {}
            if tg:
                print(f'   Telegram result: success={tg.get("success")} | error={tg.get("error")} | skipped={tg.get("skipped")}', flush=True)
                raw = tg.get('raw')
                if raw:
                    print(f'   Telegram raw: {json.dumps(raw, ensure_ascii=False)[:300]}', flush=True)
            if result.get('card_path'):
                print(f'   Card was generated at: {result["card_path"]}', flush=True)
            sys.exit(1)
