#!/usr/bin/env python3
"""i18n key merger — adds new translation keys to messages/{ar,en}.json.

Usage:
  python3 scripts/_i18n_merge.py

This file is intended to be hand-edited before each run with the new keys
to add. It will merge keys (recursively) without overwriting existing keys
unless --overwrite is passed (it WILL detect duplicates and refuse by default).

After successful merge, it prints the new total key counts and exits 0.
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AR_PATH = ROOT / 'messages' / 'ar.json'
EN_PATH = ROOT / 'messages' / 'en.json'

# ============================================================================
# NEW KEYS TO ADD — edit this before each run.
# Both ar_new and en_new must have EXACTLY the same structure.
# ============================================================================
ar_new = {
    "predictions": {
        "makerRadar": {
            "title": "رادار الميكرز",
            "paths": {
                "A_pre_surge": {
                    "label": "Pre-Surge (تجميع مبكر)",
                    "short": "Pre-Surge",
                    "descShort": "تراكم مبكر جداً",
                    "descLong": "السهم بيتجمّع قبل الانفجار — أعلى أولوية"
                },
                "B_quiet_accumulation_strong": {
                    "label": "تحت الميكروسكوب",
                    "short": "ميكروسكوب",
                    "descShort": "تراكم صامت قوي",
                    "descLong": "مال كبير بيدخل بهدوء — فرصة دخول متدرّج"
                },
                "C_quiet_accumulation_weak": {
                    "label": "تجميع ضعيف",
                    "short": "ضعيف",
                    "descShort": "تراكم صامت ضعيف",
                    "descLong": "إشارات مبكرة — للمتابعة والمراقبة"
                },
                "D_explosive_surge": {
                    "label": "موجة انفجارية",
                    "short": "منفجر",
                    "descShort": "انفجار حجمي",
                    "descLong": "تأكيد، الدخول للمتابعة لا للاصطياد"
                },
                "E_early_break": {
                    "label": "اختراق مبكر",
                    "short": "اختراق",
                    "descShort": "كسر مبكر محتمل",
                    "descLong": "فرصة قبل التشكّل — اختراق نطاق ضيق"
                }
            },
            "signals": {
                "volume_high_recurring": "حجم متكرر",
                "buy_pressure": "ضغط شرائي",
                "compressed": "ضغط نطاق",
                "volume_not_low": "حجم صحي",
                "not_explosive": "غير منفجر",
                "no_distribution": "لا توزيع",
                "volume_gradient": "تصاعد حجم",
                "range_compressed": "نطاق مضغوط",
                "near_ma10": "قرب MA10",
                "buy_days": "أيام شراء"
            },
            "kpi": {
                "scanned": "إجمالي الأسهم المفحوصة",
                "underMicroscope": "تحت الميكروسكوب",
                "explosive": "موجات منفجرة",
                "tracked": "أسهم متابَعة"
            },
            "pathSections": {
                "preSurge": {
                    "title": "Pre-Surge — متوقعة الانفجار",
                    "subtitle": "أعلى أولوية — السهم بيتجمع قبل الانفجار"
                },
                "explosive": {
                    "title": "🔥 الأسهم المنفجرة الآن",
                    "subtitle": "حجم فجائي + حركة قوية — تنبيه فوري"
                },
                "microscope": {
                    "title": "🎯 تحت الميكروسكوب",
                    "subtitle": "تجميع هادئ — أسهم بتتراكم قبل ما تنفجر"
                },
                "earlyBreak": {
                    "title": "⚡ اختراق مبكر",
                    "subtitle": "خروج من نطاق ضيق بحجم — أول إشارة اختراق"
                }
            },
            "table": {
                "rank": "#",
                "ticker": "السهم",
                "price": "السعر",
                "changePct": "التغير%",
                "roc10": "ROC10",
                "roc20": "ROC20",
                "relVolume": "حجم نسبي",
                "rebounds": "الارتدادات",
                "spark": "سبارك",
                "liquidityPct": "سيولة %",
                "netFlow": "Net Flow",
                "cycleUp": "دورة الصعود",
                "accDist": "تجميع/تصريف",
                "freq": "التردد",
                "expected": "المتوقع",
                "activation": "التفعيل",
                "priceHeader": "السعر",
                "movement": "الحركة",
                "stars": "⭐"
            },
            "buttons": {
                "refresh": "تحديث",
                "rerunRadar": "تشغيل الرادار",
                "warmupCache": "إعادة قراءة الكاش",
                "rerunRadarTitle": "شغّل الرادار من جديد (Python script)",
                "generateTodayTitle": "ولّد توقعات اليوم",
                "publishRadar": "نشر الرادار",
                "publishStock": "نشر التحليل",
                "openStockDetail": "افتح صفحة السهم الكاملة",
                "untrack": "إزالة من المتابعة",
                "track": "أضف للمتابعة"
            },
            "toast": {
                "radarWarmed": "تم تحديث الرادار ({sec}s)",
                "warmupFailed": "فشل تشغيل الرادار",
                "predictionsStarted": "بدأ توليد التوقعات...",
                "predictionsGenerated": "تم توليد التوقعات بنجاح!",
                "predictionsFailed": "فشل توليد التوقعات",
                "trackAdded": "تمت إضافة {ticker} للمتابعة",
                "trackRemoved": "تمت إزالة {ticker} من المتابعة",
                "trackFailed": "فشل تحديث المتابعة"
            },
            "cache": {
                "fresh": "طازج {sec}ث",
                "stale": "قديم {min}د",
                "warmupRunning": "الرادار قيد التشغيل...",
                "lastError": "آخر خطأ",
                "dbSource": "قاعدة البيانات المستخدمة"
            },
            "empty": {
                "noStocks": "لا توجد أسهم مطابقة",
                "noStocksHint": "جرّب فلتراً آخر أو حدّث بعد قليل",
                "noTracked": "⚠️ لا توجد أسهم في قائمة المتابعة — افتح أي سهم واضغط ⭐ لإضافته",
                "noSignals": "لا توجد إشارات واضحة من fundamentals حالياً"
            },
            "drawer": {
                "title": "تحليل سهم: {ticker}",
                "priceSummary": "ملخص السعر ({days} يوم)",
                "daysTracked": "{days} يوم · من {price}",
                "positionSizeTitle": "حجم المركز المقترح من المحفظة"
            },
            "stats": {
                "roc10d": "ROC 10 أيام",
                "range20d": "مدى 20 يوم",
                "avgVol20": "متوسط حجم 20 يوم",
                "avgTurnover20": "متوسط سيولة 20 يوم"
            },
            "publishContent": {
                "title": "رادار الميكرز",
                "header": "رادار الميكرز — {title}",
                "stocksCount": "{count} أسهم"
            }
        }
    }
}

en_new = {
    "predictions": {
        "makerRadar": {
            "title": "Maker Radar",
            "paths": {
                "A_pre_surge": {
                    "label": "Pre-Surge (early accumulation)",
                    "short": "Pre-Surge",
                    "descShort": "Very early accumulation",
                    "descLong": "Stock is accumulating before the breakout — highest priority"
                },
                "B_quiet_accumulation_strong": {
                    "label": "Under the Microscope",
                    "short": "Microscope",
                    "descShort": "Strong silent accumulation",
                    "descLong": "Big money entering quietly — gradual entry opportunity"
                },
                "C_quiet_accumulation_weak": {
                    "label": "Weak Accumulation",
                    "short": "Weak",
                    "descShort": "Weak silent accumulation",
                    "descLong": "Early signals — for monitoring and tracking"
                },
                "D_explosive_surge": {
                    "label": "Explosive Wave",
                    "short": "Explosive",
                    "descShort": "Volume explosion",
                    "descLong": "Confirmed — entry for monitoring, not for catching"
                },
                "E_early_break": {
                    "label": "Early Breakout",
                    "short": "Breakout",
                    "descShort": "Potential early breakout",
                    "descLong": "Opportunity before formation — narrow range breakout"
                }
            },
            "signals": {
                "volume_high_recurring": "Recurring volume",
                "buy_pressure": "Buy pressure",
                "compressed": "Range tight",
                "volume_not_low": "Healthy volume",
                "not_explosive": "Not explosive",
                "no_distribution": "No distribution",
                "volume_gradient": "Volume gradient",
                "range_compressed": "Compressed range",
                "near_ma10": "Near MA10",
                "buy_days": "Buy days"
            },
            "kpi": {
                "scanned": "Total Stocks Scanned",
                "underMicroscope": "Under Microscope",
                "explosive": "Explosive Waves",
                "tracked": "Tracked Stocks"
            },
            "pathSections": {
                "preSurge": {
                    "title": "Pre-Surge — Expected Breakout",
                    "subtitle": "Highest priority — stock accumulating before breakout"
                },
                "explosive": {
                    "title": "🔥 Stocks Exploding Now",
                    "subtitle": "Sudden volume + strong move — immediate alert"
                },
                "microscope": {
                    "title": "🎯 Under the Microscope",
                    "subtitle": "Quiet accumulation — stocks building up before exploding"
                },
                "earlyBreak": {
                    "title": "⚡ Early Breakout",
                    "subtitle": "Breakout of narrow range with volume — first breakout signal"
                }
            },
            "table": {
                "rank": "#",
                "ticker": "Stock",
                "price": "Price",
                "changePct": "Change%",
                "roc10": "ROC10",
                "roc20": "ROC20",
                "relVolume": "Rel Vol",
                "rebounds": "Rebounds",
                "spark": "Spark",
                "liquidityPct": "Liquidity %",
                "netFlow": "Net Flow",
                "cycleUp": "Up Cycle",
                "accDist": "Accum/Dist",
                "freq": "Frequency",
                "expected": "Expected",
                "activation": "Activation",
                "priceHeader": "Price",
                "movement": "Movement",
                "stars": "⭐"
            },
            "buttons": {
                "refresh": "Refresh",
                "rerunRadar": "Run Radar",
                "warmupCache": "Re-read cache",
                "rerunRadarTitle": "Re-run the radar (Python script)",
                "generateTodayTitle": "Generate today's predictions",
                "publishRadar": "Publish Radar",
                "publishStock": "Publish Analysis",
                "openStockDetail": "Open full stock page",
                "untrack": "Remove from tracking",
                "track": "Add to tracking"
            },
            "toast": {
                "radarWarmed": "Radar updated ({sec}s)",
                "warmupFailed": "Failed to run radar",
                "predictionsStarted": "Prediction generation started...",
                "predictionsGenerated": "Predictions generated successfully!",
                "predictionsFailed": "Failed to generate predictions",
                "trackAdded": "{ticker} added to tracking",
                "trackRemoved": "{ticker} removed from tracking",
                "trackFailed": "Failed to update tracking"
            },
            "cache": {
                "fresh": "Fresh {sec}s",
                "stale": "Stale {min}m",
                "warmupRunning": "Radar is running...",
                "lastError": "Last error",
                "dbSource": "Database source used"
            },
            "empty": {
                "noStocks": "No matching stocks",
                "noStocksHint": "Try a different filter or refresh shortly",
                "noTracked": "⚠️ No stocks in the tracking list — open any stock and tap ⭐ to add it",
                "noSignals": "No clear fundamentals signals currently"
            },
            "drawer": {
                "title": "Stock analysis: {ticker}",
                "priceSummary": "Price summary ({days} days)",
                "daysTracked": "{days} days · from {price}",
                "positionSizeTitle": "Suggested position size from portfolio"
            },
            "stats": {
                "roc10d": "ROC 10 days",
                "range20d": "20-day range",
                "avgVol20": "Avg volume 20d",
                "avgTurnover20": "Avg liquidity 20d"
            },
            "publishContent": {
                "title": "Maker Radar",
                "header": "Maker Radar — {title}",
                "stocksCount": "{count} stocks"
            }
        }
    }
}

# ============================================================================
# Merge logic
# ============================================================================

def collect_keys(obj, prefix=''):
    keys = set()
    for k, v in obj.items():
        full = f'{prefix}.{k}' if prefix else k
        if isinstance(v, dict):
            keys.update(collect_keys(v, full))
        else:
            keys.add(full)
    return keys


def deep_merge(base: dict, new: dict, path: str = '') -> tuple[dict, list[str]]:
    """Merge `new` into `base` recursively. Returns (merged, conflicts).

    A conflict is when both sides have a leaf string at the same key but with
    DIFFERENT values. We refuse the merge in that case.
    """
    conflicts: list[str] = []
    for k, v in new.items():
        full_path = f'{path}.{k}' if path else k
        if k not in base:
            base[k] = v
        else:
            if isinstance(base[k], dict) and isinstance(v, dict):
                base[k], sub_conflicts = deep_merge(base[k], v, full_path)
                conflicts.extend(sub_conflicts)
            elif isinstance(base[k], dict) or isinstance(v, dict):
                conflicts.append(f'{full_path} (type mismatch)')
            elif base[k] != v:
                conflicts.append(f'{full_path} (ar/en value mismatch: {base[k]!r} vs {v!r})')
            # else: identical — skip
    return base, conflicts


def run():
    ar = json.loads(AR_PATH.read_text(encoding='utf-8'))
    en = json.loads(EN_PATH.read_text(encoding='utf-8'))

    ar_before = len(collect_keys(ar))
    en_before = len(collect_keys(en))

    ar, ar_conflicts = deep_merge(ar, ar_new)
    en, en_conflicts = deep_merge(en, en_new)

    if ar_conflicts:
        print('AR conflicts:', file=sys.stderr)
        for c in ar_conflicts:
            print(f'  - {c}', file=sys.stderr)
        sys.exit(1)
    if en_conflicts:
        print('EN conflicts:', file=sys.stderr)
        for c in en_conflicts:
            print(f'  - {c}', file=sys.stderr)
        sys.exit(1)

    # Cross-locale parity check on the new keys
    ar_new_keys = collect_keys(ar_new)
    en_new_keys = collect_keys(en_new)
    if ar_new_keys != en_new_keys:
        only_ar = ar_new_keys - en_new_keys
        only_en = en_new_keys - ar_new_keys
        print('STRUCTURE MISMATCH between ar_new and en_new:', file=sys.stderr)
        if only_ar: print(f'  only in ar_new: {sorted(only_ar)}', file=sys.stderr)
        if only_en: print(f'  only in en_new: {sorted(only_en)}', file=sys.stderr)
        sys.exit(1)

    AR_PATH.write_text(json.dumps(ar, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    EN_PATH.write_text(json.dumps(en, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    ar_after = len(collect_keys(ar))
    en_after = len(collect_keys(en))
    added = len(ar_new_keys)

    print(f'OK — added {added} keys')
    print(f'ar.json: {ar_before} -> {ar_after}')
    print(f'en.json: {en_before} -> {en_after}')
    print(f'parity: ar==en: {ar_after == en_after}')


if __name__ == '__main__':
    run()
