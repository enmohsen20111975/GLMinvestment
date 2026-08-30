#!/usr/bin/env python3
"""
send_message.py
===============
سكربت بسيط بيبعت رسالة تليجرام من stdin.

الاستخدام:
  echo "الرسالة" | python vps-service/telegram/send_message.py --market EGX

أو:
  python vps-service/telegram/send_message.py --market EGX < message.txt

بيستخدم TelegramNotifier من telegram_notifier.py.
"""

import sys
import os
import argparse
from pathlib import Path

# إضافة المسار
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from telegram_notifier import TelegramNotifier


def main():
    parser = argparse.ArgumentParser(description='إرسال رسالة تليجرام من stdin')
    parser.add_argument('--market', default='EGX', choices=['EGX', 'CRYPTO'],
                        help='السوق (EGX أو CRYPTO)')
    args = parser.parse_args()

    # اقرأ الرسالة من stdin
    message = sys.stdin.read().strip()
    if not message:
        print('[send_message] ⚠️ مفيش رسالة في stdin', flush=True)
        sys.exit(1)

    # لو الرسالة أطول من 4096 (حد تليجرام)، قسمها
    MAX_LENGTH = 4000  # شوية أقل من 4096 للأمان

    notifier = TelegramNotifier()
    if not notifier.enabled:
        print('[send_message] ⚠️ Telegram مش مفعّل (TELEGRAM_BOT_TOKEN أو TELEGRAM_CHAT_ID ناقص)', flush=True)
        sys.exit(1)

    # قسم الرسالة لو طويلة
    chunks = []
    if len(message) <= MAX_LENGTH:
        chunks.append(message)
    else:
        # قسم على أسطر
        lines = message.split('\n')
        current_chunk = ''
        for line in lines:
            if len(current_chunk) + len(line) + 1 > MAX_LENGTH:
                if current_chunk:
                    chunks.append(current_chunk)
                current_chunk = line
            else:
                current_chunk = current_chunk + '\n' + line if current_chunk else line
        if current_chunk:
            chunks.append(current_chunk)

    # ابعت كل chunk
    success_count = 0
    for i, chunk in enumerate(chunks):
        # لو فيه أكتر من chunk، ضيف رقم الجزء
        if len(chunks) > 1:
            chunk = f'📜 جزء {i+1}/{len(chunks)}\n\n{chunk}'
        if notifier._send(chunk):
            success_count += 1
            print(f'[send_message] ✅ تم إرسال الجزء {i+1}/{len(chunks)}', flush=True)
        else:
            print(f'[send_message] ⚠️ فشل إرسال الجزء {i+1}/{len(chunks)}', flush=True)

    print(f'[send_message] ✅ Done. {success_count}/{len(chunks)} sent.', flush=True)
    sys.exit(0 if success_count == len(chunks) else 1)


if __name__ == '__main__':
    main()
