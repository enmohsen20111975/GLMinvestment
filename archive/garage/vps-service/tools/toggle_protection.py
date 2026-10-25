#!/usr/bin/env python3
"""
Display Protection Toggle — Temporary Customer-Facing Filter Control
=====================================================================
أداة الحماية المؤقتة — تحكم في ما يُعرض للعملاء

تتيح تقييد العرض مؤقتًا على:
  - off (افتراضي): عرض كل شيء كما هو
  - morning_bell: عرض جرس الصباح فقط (أعلى توقع/يوم)
  - top_confidence: عرض أعلى N توقعات ثقة فقط
  - hide_weak: إخفاء الإشارات الضعيفة (evidence_count < threshold أو score < threshold)

التكوين يُحفظ في: db/display_protection.json
الـ Next.js API routes بتقرأ نفس الملف وتطبّق الفلتر.

الاستخدام:
  python3 vps-service/tools/toggle_protection.py status
  python3 vps-service/tools/toggle_protection.py off
  python3 vps-service/tools/toggle_protection.py morning_bell
  python3 vps-service/tools/toggle_protection.py top_confidence --top-n 3
  python3 vps-service/tools/toggle_protection.py hide_weak --min-evidence 4 --min-score 70
  python3 vps-service/tools/toggle_protection.py on   # = morning_bell (الأكثر أمانًا)

التفعيل فوري — الـ Next.js routes بتقرأ الملف كل طلب (مع cache 30 ثانية).
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
CONFIG_PATH = PROJECT_ROOT / "db" / "display_protection.json"

VALID_MODES = ["off", "morning_bell", "top_confidence", "hide_weak"]

DEFAULT_CONFIG = {
    "mode": "off",
    "top_n": 3,
    "min_evidence": 4,
    "min_score": 70,
    "min_confidence": 70,
    "enabled_at": None,
    "enabled_by": None,
    "reason": None,
}


def load_config() -> dict:
    """Load the protection config, returning defaults if missing."""
    if not CONFIG_PATH.exists():
        return dict(DEFAULT_CONFIG)
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        # Merge with defaults to ensure all keys exist
        merged = dict(DEFAULT_CONFIG)
        merged.update(cfg)
        return merged
    except (json.JSONDecodeError, OSError) as e:
        print(f"⚠️  خطأ في قراءة ملف التكوين: {e}")
        return dict(DEFAULT_CONFIG)


def save_config(cfg: dict) -> None:
    """Save the protection config."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def cmd_status(cfg: dict) -> None:
    """Print current protection status."""
    mode = cfg.get("mode", "off")
    print()
    print("=" * 56)
    print("  🛡️  حالة الحماية المؤقتة")
    print("=" * 56)
    print(f"  الوضع (mode):          {mode}")

    mode_desc = {
        "off": "🔴 معطّل — كل التوقعات معروضة",
        "morning_bell": "🟢 جرس الصباح فقط (أعلى توقع/يوم)",
        "top_confidence": f"🟡 أعلى {cfg.get('top_n', 3)} توقعات ثقة/يوم",
        "hide_weak": f"🟠 إخفاء الضعيف (يُبقي فقط evidence>={cfg.get('min_evidence', 4)} و score>={cfg.get('min_score', 70)})",
    }
    print(f"  الوصف:                 {mode_desc.get(mode, 'غير معروف')}")

    if cfg.get("enabled_at"):
        print(f"  فُعّل في:              {cfg['enabled_at']}")
    if cfg.get("enabled_by"):
        print(f"  فُعّل بواسطة:          {cfg['enabled_by']}")
    if cfg.get("reason"):
        print(f"  السبب:                 {cfg['reason']}")

    print()
    print(f"  📁 ملف التكوين: {CONFIG_PATH}")
    print()
    print("  الأوضاع المتاحة:")
    for m in VALID_MODES:
        marker = " ← حالي" if m == mode else ""
        print(f"    • {m}{marker}")
    print()
    print("  لتغيير الوضع:")
    print("    python3 vps-service/tools/toggle_protection.py <mode> [options]")
    print()


def cmd_set_mode(mode: str, args) -> None:
    """Set the protection mode."""
    if mode not in VALID_MODES:
        print(f"❌ وضع غير صالح: {mode}")
        print(f"   الأوضاع المتاحة: {', '.join(VALID_MODES)}")
        sys.exit(1)

    cfg = load_config()
    cfg["mode"] = mode

    # IMPORTANT: use `is not None` instead of truthiness check,
    # because 0 is a valid value for min_evidence / min_score / min_confidence
    # (means "disable this dimension's check"). `if args.min_evidence:` would
    # silently skip 0, leaving the default (4) in place — a critical bug.
    if mode == "top_confidence" and args.top_n is not None:
        cfg["top_n"] = args.top_n
    if mode == "hide_weak":
        if args.min_evidence is not None:
            cfg["min_evidence"] = args.min_evidence
        if args.min_score is not None:
            cfg["min_score"] = args.min_score
        if args.min_confidence is not None:
            cfg["min_confidence"] = args.min_confidence

    if mode == "off":
        cfg["enabled_at"] = None
        cfg["enabled_by"] = None
        cfg["reason"] = None
    else:
        cfg["enabled_at"] = datetime.now().isoformat()
        cfg["enabled_by"] = args.by or "cli"
        cfg["reason"] = args.reason

    save_config(cfg)
    print(f"✅ تم ضبط الوضع على: {mode}")
    cmd_status(cfg)


def main():
    parser = argparse.ArgumentParser(
        description="أداة الحماية المؤقتة — تحكم في ما يُعرض للعملاء"
    )
    parser.add_argument("mode", nargs="?", default="status",
                        help=f"الوضع: {' / '.join(VALID_MODES)} / status")
    parser.add_argument("--top-n", type=int, default=None,
                        help="لوضع top_confidence: عدد التوقعات المعروضة/يوم (default: 3)")
    parser.add_argument("--min-evidence", type=int, default=None,
                        help="لوضع hide_weak: أدنى evidence_count (default: 4)")
    parser.add_argument("--min-score", type=int, default=None,
                        help="لوضع hide_weak: أدنى master_score (default: 70)")
    parser.add_argument("--min-confidence", type=int, default=None,
                        help="لوضع hide_weak: أدنى confidence (default: 70)")
    parser.add_argument("--by", default=None,
                        help="اسم من فعّل الحماية (للسجل)")
    parser.add_argument("--reason", default=None,
                        help="سبب التفعيل (للسجل)")
    args = parser.parse_args()

    # Aliases
    if args.mode == "status":
        cmd_status(load_config())
    elif args.mode == "on":
        # 'on' = morning_bell (safest mode)
        cmd_set_mode("morning_bell", args)
    elif args.mode in VALID_MODES:
        cmd_set_mode(args.mode, args)
    else:
        print(f"❌ أمر غير معروف: {args.mode}")
        print(f"   الأوامر: status, {' , '.join(VALID_MODES)}, on (=morning_bell)")
        sys.exit(1)


if __name__ == "__main__":
    main()
