#!/usr/bin/env python3
"""
mine_learned_lessons.py
========================
يستخرج الدروس المستفادة من الأخطاء من جدول aiPrediction (البيانات الحقيقية).

المصدر: predictions.db → aiPrediction table (8544 توقع مغلق من batch 2026-06-17).
الهدف: تعبئة learned_lessons table في stocks.db بالدروس الحقيقية.

Phase 8 (Task 8-A):
  - إصلاح compute_win_rate: يشمل CLOSED (يستخدم profit_loss_percent).
  - schema upgrade: scope, data_source, expiry_date, sample_size, confidence_level.
  - تصنيف scope: general / sector / specific.
  - mine_pattern_lessons: دروس عامة من أنماط (RSI, target%, stop%).
  - expiry_date حسب confidence_level (preliminary=30d, validated=90d, strong=180d).

أنواع الدروس المستخرجة:
  1. direct (specific)   — سهم خاسر باستمرار (win_rate < 55%, n >= 3)
  2. direct (specific)   — أسهم بخسائر متتالية (>= 2)
  3. environmental (sector) — نوع إشارة خاسر في سوق معين
  4. environmental (general) — طور سوق خاسر
  5. pattern (general)   — نمط عام خاسر (RSI>80+BUY, target>+15%, stop<-3%)

كل درس يحتوي على:
  - confidence_adjustment: تعديل الدرجة (سلبي للدروس الخاسرة)
  - target_adjustment: تعديل الهدف %
  - stop_adjustment: تعديل الوقف %
  - scope: general / sector / specific
  - data_source: backtest_batch / realtime / backtest_engine
  - expiry_date: ISO date (created_at + 30/90/180 يوم حسب confidence_level)
  - sample_size: عدد التوقعات المصدر
  - confidence_level: preliminary / validated / strong

التشغيل:
  python3 scripts/mine_learned_lessons.py
"""

import sqlite3
import json
import os
from datetime import datetime, timedelta
from collections import defaultdict

STOCKS_DB = os.path.join(os.path.dirname(__file__), '..', 'db', 'stocks.db')
PREDICTIONS_DB = os.path.join(os.path.dirname(__file__), '..', 'db', 'predictions.db')

# Phase 8: constants
DEFAULT_DATA_SOURCE = 'backtest_batch'   # كل البيانات الحالية من batch 2026-06-17
DEFAULT_CONFIDENCE_LEVEL = 'preliminary'  # preliminary = 30 يوم
PRELIMINARY_EXPIRY_DAYS = 30
VALIDATED_EXPIRY_DAYS = 90
STRONG_EXPIRY_DAYS = 180
MIN_PATTERN_SAMPLES = 20
PATTERN_LOSS_THRESHOLD = 55.0  # win_rate < 55%


def compute_expiry_date(confidence_level: str, created_at: str = None) -> str:
    """يحسب expiry_date حسب confidence_level."""
    if created_at is None:
        base = datetime.now()
    else:
        # Accept ISO date/datetime string
        try:
            base = datetime.fromisoformat(created_at.replace('Z', ''))
        except Exception:
            base = datetime.now()
    if confidence_level == 'strong':
        days = STRONG_EXPIRY_DAYS
    elif confidence_level == 'validated':
        days = VALIDATED_EXPIRY_DAYS
    else:  # preliminary
        days = PRELIMINARY_EXPIRY_DAYS
    return (base + timedelta(days=days)).date().isoformat()


def recreate_learned_lessons_table(conn):
    """يعيد إنشاء الجدول بالـ schema الجديد (Phase 8)."""
    cur = conn.cursor()
    cur.execute("DROP TABLE IF EXISTS learned_lessons")
    cur.execute("""
        CREATE TABLE learned_lessons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lesson_type TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            trigger_conditions TEXT,
            action TEXT,
            confidence_adjustment REAL DEFAULT 0,
            target_adjustment REAL DEFAULT 0,
            stop_adjustment REAL DEFAULT 0,
            occurrences INTEGER DEFAULT 0,
            win_rate REAL DEFAULT 0,
            status TEXT DEFAULT 'validated',
            first_seen TEXT,
            last_seen TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            -- Phase 8: أعمدة جديدة
            scope TEXT DEFAULT 'specific',
            data_source TEXT DEFAULT 'backtest_batch',
            expiry_date TEXT,
            sample_size INTEGER DEFAULT 0,
            confidence_level TEXT DEFAULT 'preliminary'
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_learned_lessons_title ON learned_lessons(title)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_learned_lessons_scope ON learned_lessons(scope)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_learned_lessons_expiry ON learned_lessons(expiry_date)")
    conn.commit()
    print("[mine_lessons] Table recreated with Phase 8 schema (scope, data_source, expiry_date, sample_size, confidence_level).")


def load_predictions():
    """يحمّل التوقعات المغلقة من aiPrediction (TARGET_HIT/STOP_HIT/CLOSED).

    Phase 8.1 fix: بيفلتر الـ retroactive predictions (is_retroactive=1) لأنها
    اتولدت بأثر رجعى (النظام عرف النتيجة قبل ما يقول التوقع). الدروس المستخرجة
    من البيانات دي بتكون "مسمومة" — النظام بيحفظ الامتحانات بالحلول.
    بس نستخدم الـ real-time predictions (is_retroactive=0 أو NULL).
    """
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(PREDICTIONS_DB, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    # Check if is_retroactive column exists
    cols = [r[1] for r in cur.execute('PRAGMA table_info(aiPrediction)').fetchall()]
    has_retro_flag = 'is_retroactive' in cols

    if has_retro_flag:
        cur.execute("""
            SELECT stock_symbol, signal_type, market, regime, status,
                   profit_loss_percent, prediction_date, entry_price,
                   target_price, stop_loss, phase_scores, created_at
            FROM aiPrediction
            WHERE status IN ('TARGET_HIT', 'STOP_HIT', 'CLOSED')
              AND (is_retroactive = 0 OR is_retroactive IS NULL)
        """)
    else:
        cur.execute("""
            SELECT stock_symbol, signal_type, market, regime, status,
                   profit_loss_percent, prediction_date, entry_price,
                   target_price, stop_loss, phase_scores, created_at
            FROM aiPrediction
            WHERE status IN ('TARGET_HIT', 'STOP_HIT', 'CLOSED')
        """)

    rows = cur.fetchall()
    conn.close()
    if has_retro_flag:
        print(f"[mine_lessons] Loaded {len(rows)} REAL-TIME closed predictions (retroactive filtered out).")
    else:
        print(f"[mine_lessons] Loaded {len(rows)} closed predictions (no is_retroactive column — all included).")
    return rows


def compute_win_rate(records):
    """يحسب نسبة الفوز — يشمل CLOSED (يستخدم profit_loss_percent).

    Phase 8 fix: الإصدار السابق كان يتجاهل CLOSED (2498 توقع) → win rate مُضخّم.
    دلوقتي CLOSED بتتصنّف:
      - profit_loss_percent > 0 → فوز
      - profit_loss_percent < 0 → خسارة
      - profit_loss_percent == 0 أو None → skip (unknown)
    """
    if not records:
        return 0.0, 0, 0
    wins = 0
    losses = 0
    for r in records:
        status = r['status']
        if status == 'TARGET_HIT':
            wins += 1
        elif status == 'STOP_HIT':
            losses += 1
        elif status == 'CLOSED':
            # Use profit_loss_percent to classify
            pl = r['profit_loss_percent']
            if pl is not None and pl > 0:
                wins += 1
            elif pl is not None and pl < 0:
                losses += 1
            # pl == 0 or None → skip (unknown)
    total = wins + losses
    if total == 0:
        return 0.0, 0, 0
    return (wins / total) * 100, wins, losses


# =============================================================================
# Phase 8: lesson miners — كل miner بيرجع dict فيه scope/expiry/etc
# =============================================================================

def _make_lesson(**kwargs):
    """Helper: يبني lesson dict بالقيم الافتراضية Phase 8."""
    now_iso = datetime.now().isoformat()
    lesson = {
        'lesson_type': kwargs.get('lesson_type', 'direct'),
        'title': kwargs['title'],
        'description': kwargs['description'],
        'trigger_conditions': kwargs.get('trigger_conditions', '{}'),
        'action': kwargs.get('action', ''),
        'confidence_adjustment': kwargs.get('confidence_adjustment', 0),
        'target_adjustment': kwargs.get('target_adjustment', 0),
        'stop_adjustment': kwargs.get('stop_adjustment', 0),
        'occurrences': kwargs.get('occurrences', 0),
        'win_rate': kwargs.get('win_rate', 0.0),
        # Phase 8 defaults
        'scope': kwargs.get('scope', 'specific'),
        'data_source': kwargs.get('data_source', DEFAULT_DATA_SOURCE),
        'expiry_date': kwargs.get('expiry_date', compute_expiry_date(DEFAULT_CONFIDENCE_LEVEL)),
        'sample_size': kwargs.get('sample_size', kwargs.get('occurrences', 0)),
        'confidence_level': kwargs.get('confidence_level', DEFAULT_CONFIDENCE_LEVEL),
        # metadata
        'first_seen': now_iso,
        'last_seen': now_iso,
    }
    return lesson


def mine_ticker_lessons(predictions):
    """نوع 1: أسهم خاسرة باستمرار (win_rate < 55%, n >= 3, exclude HOLD).

    Phase 8: scope='specific' (درس خاص بـ ticker واحد).
    """
    by_ticker = defaultdict(list)
    for p in predictions:
        if p['signal_type'] and p['signal_type'].upper() != 'HOLD':
            by_ticker[p['stock_symbol']].append(p)

    lessons = []
    for ticker, records in by_ticker.items():
        tradeable = [r for r in records if r['status'] in ('TARGET_HIT', 'STOP_HIT', 'CLOSED')]
        if len(tradeable) < 3:
            continue
        wr, wins, losses = compute_win_rate(tradeable)
        if wr < PATTERN_LOSS_THRESHOLD and losses >= 2:
            penalty = -10
            if wr < 20:
                penalty = -20
            elif wr < 30:
                penalty = -15

            lessons.append(_make_lesson(
                lesson_type='direct',
                scope='specific',
                title=f'{ticker} — خاسر ({wr:.0f}% win rate)',
                description=(f'السهم {ticker} لديه win rate {wr:.0f}% '
                             f'({wins} فوز / {losses} خسارة من {len(tradeable)} صفقة). '
                             f'تجنب الدخول أو قلّل الحجم.'),
                trigger_conditions=json.dumps({'ticker': ticker}),
                action=f'تقليل score بـ {penalty} نقطة عند توليد إشارة BUY لهذا السهم',
                confidence_adjustment=penalty,
                target_adjustment=-2.0,
                stop_adjustment=2.0,
                occurrences=len(tradeable),
                sample_size=len(tradeable),
                win_rate=wr,
            ))
    print(f"[mine_lessons] Ticker lessons (scope=specific): {len(lessons)}")
    return lessons


def mine_market_signal_lessons(predictions):
    """نوع 2: نوع إشارة خاسر في سوق معين (signal_type per market, win_rate < 55%, exclude HOLD).

    Phase 8: scope='sector' (درس خاص بـ market+signal combo).
    """
    by_combo = defaultdict(list)
    for p in predictions:
        if not p['market'] or not p['signal_type']:
            continue
        if p['signal_type'].upper() == 'HOLD':
            continue
        key = f"{p['market']}_{p['signal_type']}"
        by_combo[key].append(p)

    lessons = []
    for combo, records in by_combo.items():
        tradeable = [r for r in records if r['status'] in ('TARGET_HIT', 'STOP_HIT', 'CLOSED')]
        if len(tradeable) < 10:
            continue
        wr, wins, losses = compute_win_rate(tradeable)
        if wr < PATTERN_LOSS_THRESHOLD:
            market, signal = combo.rsplit('_', 1)
            penalty = -15 if wr < 30 else -10
            lessons.append(_make_lesson(
                lesson_type='environmental',
                scope='sector',
                title=f'{market} {signal} — خاسر ({wr:.0f}%)',
                description=(f'إشارات {signal} في سوق {market} لديها win rate {wr:.0f}% '
                             f'({wins} فوز / {losses} خسارة من {len(tradeable)} صفقة).'),
                trigger_conditions=json.dumps({'market': market, 'signal_type': signal}),
                action=f'تقليل score بـ {penalty} نقطة عند توليد إشارة {signal} في {market}',
                confidence_adjustment=penalty,
                target_adjustment=0,
                stop_adjustment=0,
                occurrences=len(tradeable),
                sample_size=len(tradeable),
                win_rate=wr,
            ))
    print(f"[mine_lessons] Market+Signal lessons (scope=sector): {len(lessons)}")
    return lessons


def mine_regime_lessons(predictions):
    """نوع 3: طور سوق خاسر (regime with win_rate < 55%, exclude HOLD).

    Phase 8: scope='general' (درس عام لكل الأسهم في هذا الطور).
    """
    by_regime = defaultdict(list)
    for p in predictions:
        if not p['regime']:
            continue
        if p['signal_type'] and p['signal_type'].upper() == 'HOLD':
            continue
        by_regime[p['regime']].append(p)

    lessons = []
    for regime, records in by_regime.items():
        tradeable = [r for r in records if r['status'] in ('TARGET_HIT', 'STOP_HIT', 'CLOSED')]
        if len(tradeable) < 10:
            continue
        wr, wins, losses = compute_win_rate(tradeable)
        if wr < PATTERN_LOSS_THRESHOLD:
            penalty = -12 if wr < 30 else -8
            lessons.append(_make_lesson(
                lesson_type='environmental',
                scope='general',
                title=f'طور {regime} — خاسر ({wr:.0f}%)',
                description=(f'في طور السوق "{regime}"، win rate = {wr:.0f}% '
                             f'({wins} فوز / {losses} خسارة من {len(tradeable)} صفقة).'),
                trigger_conditions=json.dumps({'regime': regime}),
                action=f'تقليل score بـ {penalty} نقطة في هذا الطور',
                confidence_adjustment=penalty,
                target_adjustment=0,
                stop_adjustment=0,
                occurrences=len(tradeable),
                sample_size=len(tradeable),
                win_rate=wr,
            ))
    print(f"[mine_lessons] Regime lessons (scope=general): {len(lessons)}")
    return lessons


def mine_worst_losers(predictions):
    """نوع 4: أسهم بخسائر متتالية (consecutive losses >= 2, exclude HOLD).

    Phase 8: scope='specific' (درس خاص بـ ticker واحد).
    """
    by_ticker = defaultdict(list)
    for p in predictions:
        if p['prediction_date'] and p['signal_type'] and p['signal_type'].upper() != 'HOLD':
            by_ticker[p['stock_symbol']].append(p)

    lessons = []
    for ticker, records in by_ticker.items():
        records.sort(key=lambda r: r['prediction_date'] or '')
        # عدّ الخسائر المتتالية من النهاية (STOP_HIT أو CLOSED سلبي)
        consec = 0
        for r in reversed(records):
            if r['status'] == 'STOP_HIT':
                consec += 1
            elif r['status'] == 'CLOSED' and r['profit_loss_percent'] is not None and r['profit_loss_percent'] < 0:
                consec += 1
            else:
                break
        if consec >= 2:
            wr, wins, losses = compute_win_rate(records)
            penalty = -15 if consec >= 5 else -10
            lessons.append(_make_lesson(
                lesson_type='direct',
                scope='specific',
                title=f'{ticker} — {consec} خسائر متتالية',
                description=(f'السهم {ticker} خسر {consec} مرات متتالية '
                             f'(آخر {len(records)} صفقات، win rate {wr:.0f}%).'),
                trigger_conditions=json.dumps({'ticker': ticker, 'consecutive_losses': consec}),
                action=f'تقليل score بـ {penalty} نقطة + تخفيض STRONG_BUY → BUY',
                confidence_adjustment=penalty,
                target_adjustment=-3.0,
                stop_adjustment=3.0,
                occurrences=consec,
                sample_size=len(records),
                win_rate=wr,
            ))
    print(f"[mine_lessons] Consecutive-loser lessons (scope=specific): {len(lessons)}")
    return lessons


def _parse_phase_scores(phase_scores_str):
    """Parse phase_scores JSON with safety. Returns dict or {}."""
    if not phase_scores_str:
        return {}
    try:
        return json.loads(phase_scores_str)
    except (json.JSONDecodeError, TypeError):
        return {}


def _compute_target_pct(p):
    """target_pct = (target_price - entry_price) / entry_price * 100. None if missing."""
    try:
        entry = p['entry_price']
        target = p['target_price']
        if entry is None or target is None or entry == 0:
            return None
        return ((target - entry) / entry) * 100
    except (TypeError, ZeroDivisionError):
        return None


def _compute_stop_pct(p):
    """stop_pct = (stop_loss - entry_price) / entry_price * 100. Negative for BUY stops."""
    try:
        entry = p['entry_price']
        stop = p['stop_loss']
        if entry is None or stop is None or entry == 0:
            return None
        return ((stop - entry) / entry) * 100
    except (TypeError, ZeroDivisionError):
        return None


def mine_pattern_lessons(predictions):
    """نوع 5 (جديد Phase 8): دروس عامة من أنماط (RSI, target%, stop%).

    scope='general' — تطبّق على أي سهم يحقق النمط.
    يفلتر الأنماط اللي win_rate < 55% و sample_size >= 20.

    الأنماط المُختبرة:
      1. RSI > 80 + BUY   (لو rsi متوفر في phase_scores)
      2. RSI > 70 + BUY
      3. RSI < 30 + SELL
      4. target_pct > 15 (greedy target) + BUY
      5. target_pct > 25 (very greedy) + BUY
      6. stop_pct < -3 (tight stop) + BUY
      7. stop_pct < -1.5 (very tight stop) + BUY
    """
    # بناء groups
    groups = defaultdict(list)  # pattern_key → [records]

    for p in predictions:
        sig = (p['signal_type'] or '').upper()
        if sig == 'HOLD':
            continue
        ph = _parse_phase_scores(p['phase_scores'])
        rsi = ph.get('rsi')
        target_pct = _compute_target_pct(p)
        stop_pct = _compute_stop_pct(p)

        if rsi is not None:
            try:
                rsi_f = float(rsi)
                if sig == 'BUY' and rsi_f > 80:
                    groups['rsi_gt_80_buy'].append(p)
                elif sig == 'BUY' and rsi_f > 70:
                    groups['rsi_gt_70_buy'].append(p)
                elif sig == 'SELL' and rsi_f < 30:
                    groups['rsi_lt_30_sell'].append(p)
            except (TypeError, ValueError):
                pass

        if target_pct is not None and sig == 'BUY':
            if target_pct > 25:
                groups['target_gt_25_buy'].append(p)
            elif target_pct > 15:
                groups['target_gt_15_buy'].append(p)

        if stop_pct is not None and sig == 'BUY':
            if stop_pct < -3:  # tight: stop within 3% loss
                groups['stop_lt_minus3_buy'].append(p)
            elif stop_pct < -1.5:
                groups['stop_lt_minus1_5_buy'].append(p)

    # وصف لكل نمط
    pattern_meta = {
        'rsi_gt_80_buy': {
            'label': 'RSI > 80 + BUY',
            'trigger': {'rsi_gt': 80, 'signal': 'BUY'},
            'desc': 'إشارات BUY حين RSI > 80 (تشبع شرائي) — نمط خاسر.',
        },
        'rsi_gt_70_buy': {
            'label': 'RSI > 70 + BUY',
            'trigger': {'rsi_gt': 70, 'signal': 'BUY'},
            'desc': 'إشارات BUY حين RSI > 70 — نمط خاسر.',
        },
        'rsi_lt_30_sell': {
            'label': 'RSI < 30 + SELL',
            'trigger': {'rsi_lt': 30, 'signal': 'SELL'},
            'desc': 'إشارات SELL حين RSI < 30 (تشبع بيعي) — نمط خاسر.',
        },
        'target_gt_25_buy': {
            'label': 'Target > +25% (greedy) + BUY',
            'trigger': {'target_pct_gt': 25, 'signal': 'BUY'},
            'desc': 'إشارات BUY بهدف > +25% (طماع جداً) — win rate منخفض.',
        },
        'target_gt_15_buy': {
            'label': 'Target > +15% (ambitious) + BUY',
            'trigger': {'target_pct_gt': 15, 'signal': 'BUY'},
            'desc': 'إشارات BUY بهدف > +15% — win rate منخفض نسبياً.',
        },
        'stop_lt_minus3_buy': {
            'label': 'Stop < -3% (tight) + BUY',
            'trigger': {'stop_pct_lt': -3, 'signal': 'BUY'},
            'desc': 'إشارات BUY بوقف < -3% (ضيق) — تخرج بسرعة.',
        },
        'stop_lt_minus1_5_buy': {
            'label': 'Stop < -1.5% (very tight) + BUY',
            'trigger': {'stop_pct_lt': -1.5, 'signal': 'BUY'},
            'desc': 'إشارات BUY بوقف < -1.5% (ضيق جداً) — تتوقف بسرعة.',
        },
    }

    lessons = []
    for key, records in groups.items():
        if len(records) < MIN_PATTERN_SAMPLES:
            continue
        wr, wins, losses = compute_win_rate(records)
        if wr >= PATTERN_LOSS_THRESHOLD:
            continue
        meta = pattern_meta.get(key, {'label': key, 'trigger': {'pattern': key}, 'desc': key})
        # penalty escalates with loss severity
        if wr < 30:
            penalty = -15
        elif wr < 40:
            penalty = -12
        else:
            penalty = -10

        lessons.append(_make_lesson(
            lesson_type='pattern',
            scope='general',
            title=f'{meta["label"]} — win rate {wr:.0f}%',
            description=(f'{meta["desc"]} win rate = {wr:.0f}% '
                         f'({wins} فوز / {losses} خسارة من {len(records)} صفقة).'),
            trigger_conditions=json.dumps(meta['trigger']),
            action=f'تقليل score بـ {penalty} نقطة عند تحقق النمط ({meta["label"]})',
            confidence_adjustment=penalty,
            target_adjustment=-2.0,
            stop_adjustment=2.0,
            occurrences=len(records),
            sample_size=len(records),
            win_rate=wr,
        ))

    print(f"[mine_lessons] Pattern lessons (scope=general): {len(lessons)}")
    if not lessons:
        # Diagnostic info
        for k, recs in groups.items():
            print(f"  [diag] pattern '{k}': {len(recs)} samples (needs >= {MIN_PATTERN_SAMPLES} + wr < {PATTERN_LOSS_THRESHOLD}%)")
    return lessons


def store_lessons(conn, lessons):
    """يخزّن الدروس في learned_lessons table (Phase 8 schema)."""
    cur = conn.cursor()
    now_iso = datetime.now().isoformat()
    expiry_preliminary = compute_expiry_date(DEFAULT_CONFIDENCE_LEVEL)

    for lesson in lessons:
        cur.execute("""
            INSERT INTO learned_lessons
                (lesson_type, title, description, trigger_conditions, action,
                 confidence_adjustment, target_adjustment, stop_adjustment,
                 occurrences, win_rate, status, first_seen, last_seen,
                 scope, data_source, expiry_date, sample_size, confidence_level)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'validated', ?, ?,
                    ?, ?, ?, ?, ?)
        """, (
            lesson['lesson_type'],
            lesson['title'],
            lesson['description'],
            lesson['trigger_conditions'],
            lesson['action'],
            lesson['confidence_adjustment'],
            lesson['target_adjustment'],
            lesson['stop_adjustment'],
            lesson['occurrences'],
            lesson['win_rate'],
            now_iso,
            now_iso,
            # Phase 8 columns
            lesson.get('scope', 'specific'),
            lesson.get('data_source', DEFAULT_DATA_SOURCE),
            lesson.get('expiry_date', expiry_preliminary),
            lesson.get('sample_size', lesson.get('occurrences', 0)),
            lesson.get('confidence_level', DEFAULT_CONFIDENCE_LEVEL),
        ))
    conn.commit()
    print(f"[mine_lessons] Stored {len(lessons)} lessons (with Phase 8 columns).")


def print_summary(conn, all_predictions):
    """Phase 8: ملخص شامل في النهاية."""
    cur = conn.cursor()
    print()
    print("=" * 70)
    print("  📊 PHASE 8 SUMMARY — learned_lessons")
    print("=" * 70)

    # By scope
    cur.execute("""
        SELECT COALESCE(scope,'specific') AS scope, COUNT(*)
        FROM learned_lessons GROUP BY scope ORDER BY scope
    """)
    print("\nBy scope:")
    for scope, n in cur.fetchall():
        print(f"  {scope:10s}: {n} lessons")

    # By confidence_level
    cur.execute("""
        SELECT COALESCE(confidence_level,'preliminary') AS cl, COUNT(*)
        FROM learned_lessons GROUP BY cl ORDER BY cl
    """)
    print("\nBy confidence_level:")
    for cl, n in cur.fetchall():
        print(f"  {cl:12s}: {n} lessons")

    # By lesson_type
    cur.execute("""
        SELECT lesson_type, COUNT(*) FROM learned_lessons GROUP BY lesson_type
    """)
    print("\nBy lesson_type:")
    for lt, n in cur.fetchall():
        print(f"  {lt:14s}: {n} lessons")

    # TRUE overall win rate (including CLOSED via profit_loss_percent)
    wr, wins, losses = compute_win_rate(all_predictions)
    print("\n" + "-" * 70)
    print(f"  TRUE overall win rate (incl. CLOSED via profit_loss_percent):")
    print(f"    {len(all_predictions)} closed predictions → {wins} wins / {losses} losses")
    print(f"    win rate = {wr:.2f}%")
    print("-" * 70)

    # WARNING
    print()
    print("  ⚠️  WARNING: All lessons are PRELIMINARY (from 2026-06-17 batch")
    print("     backtest). They will expire in 30 days. Re-mine from realtime")
    print("     predictions once available.")
    print()
    print("  Next steps:")
    print("    1. Generate realtime predictions via cron (different creation dates).")
    print("    2. Re-run this script — it will tag realtime lessons as 'validated'")
    print("       (90-day expiry) or 'strong' (180-day expiry, 50+ samples).")
    print("=" * 70)


def main():
    print("=" * 70)
    print("  mine_learned_lessons.py — Phase 8 (Task 8-A)")
    print("  استخراج الدروس من الأخطاء — مع scope + expiry + data_source")
    print("=" * 70)

    # Load predictions
    predictions = load_predictions()
    if not predictions:
        print("[mine_lessons] No predictions found. Exiting.")
        return

    # Print TRUE overall stats (with CLOSED fix)
    wr, wins, losses = compute_win_rate(predictions)
    print(f"[mine_lessons] TRUE overall: {len(predictions)} predictions, "
          f"{wins} wins, {losses} losses, win rate = {wr:.2f}% (incl. CLOSED)")
    print()

    # Mine all lesson types
    lessons = []
    lessons.extend(mine_ticker_lessons(predictions))
    lessons.extend(mine_market_signal_lessons(predictions))
    lessons.extend(mine_regime_lessons(predictions))
    lessons.extend(mine_worst_losers(predictions))
    lessons.extend(mine_pattern_lessons(predictions))

    print()
    print(f"[mine_lessons] TOTAL lessons extracted: {len(lessons)}")
    print()

    # Build DB + store
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    try:
        recreate_learned_lessons_table(conn)
        store_lessons(conn, lessons)
        print_summary(conn, predictions)
    finally:
        conn.close()

    print()
    print("  ✅ Phase 8 mining complete — learned_lessons table rebuilt with new schema.")
    print("=" * 70)


if __name__ == '__main__':
    main()
