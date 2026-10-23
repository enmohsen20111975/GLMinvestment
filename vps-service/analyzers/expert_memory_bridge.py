"""
Expert Memory Bridge — توصيات الخبراء تعدّل ثقة الآلة (EXPERT-MEMORY-032)
==========================================================================
جسر بين جدول ExpertRecommendation (في stocks.db) والـ MasterAnalyzer.

الفلسفة:
---------
الآلة (THE BRAIN) بتعمل تحليلها الفني/الأساسي وتطلع signal + master_score.
لو فيه خبراء بشريين كمان بيقولوا نفس الإشارة → ثقة الآلة تزيد (توافق).
لو الخبراء بيقولوا العكس → الآلة تشك في نفسها وتخصم (تعارض).

القواعد:
--------
1. AI BUY + خبراء BUY → توافق → +min(8 * buy_count, 18)
2. AI SELL + خبراء SELL → توافق → +min(8 * sell_count, 18)
3. AI BUY + خبراء SELL (أو العكس) → تعارض → -min(10 * opposing_count, 25)
4. مفيش توصيات → الآلة ساكتة (silent, no adjustment, no crash)

الأمان:
-------
- قراءة فقط (mode=ro) — ما يحدثش lock مع الـ Node.js side.
- أي خطأ في الـ DB/الجدول/الأعمدة → return [] بصمت (NEVER raise).
- الجدول ممكن يكون فاضي أو غير موجود —Bridge يتعامل مع الاثنين.

Author: دليل الاستثمار (Hedge Fund Mindset)
"""

from __future__ import annotations

import logging
import os
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════════════════════
# DB Path Resolution
# ════════════════════════════════════════════════════════════════════════════
# نحاول نقرأ DB path من env var أو نرجع للـ default. الـ default يجب أن
# يطابق ما يستخدمه MasterAnalyzer (PROJECT_ROOT/db/stocks.db).

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_DEFAULT_STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')


def _resolve_db_path() -> str:
    """يرجع مسار stocks.db — يفضل env var، وإلا default آمن."""
    try:
        env_path = os.environ.get('STOCKS_DB_PATH') or os.environ.get('STOCKS_DB')
        if env_path and Path(env_path).exists():
            return env_path
    except Exception:
        pass
    return _DEFAULT_STOCKS_DB


# ════════════════════════════════════════════════════════════════════════════
# Dataclasses
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class ExpertRec:
    """توصية خبير واحدة."""
    expert_name: str
    expert_source: Optional[str]
    action: str           # BUY / SELL / HOLD / REDUCE / شراء واحتفاظ / الخ.
    entry_price: Optional[float]
    target_price: Optional[float]
    stop_loss: Optional[float]
    support_level: Optional[float]
    resistance_level: Optional[float]
    recommendation_reason: Optional[str]
    session_date: Optional[str]
    status: str


@dataclass
class ExpertConsensus:
    """نتيجة مقارنة توافق خبراء الآلة."""
    count: int = 0
    buy_count: int = 0
    sell_count: int = 0
    hold_count: int = 0
    agreed: bool = False        # هل الأغلبية توافق إشارة الآلة؟
    conflicted: bool = False
    consensus_action: str = ""  # "BUY" / "SELL" / "HOLD" / "MIXED"
    score_adjustment: float = 0.0
    notes: List[str] = field(default_factory=list)
    recs: List[ExpertRec] = field(default_factory=list)


# ════════════════════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════════════════════

def _normalize_symbol(sym: str) -> str:
    """يطبّع رمز السهم: يزيل اللاحقات (.CA, .SR, .KW) ويحول لـ uppercase."""
    if not sym:
        return ''
    s = str(sym).strip().upper()
    # شيل أي لاحقة بعد نقطة (مثل COMI.CA → COMI)
    if '.' in s:
        s = s.split('.')[0]
    # شيل المسافات الزيادة
    s = re.sub(r'\s+', '', s)
    return s


def _parse_session_date(s: Optional[str]) -> Optional[datetime]:
    """يحول نص التاريخ لـ datetime. يدعم:
       - "13-5-2026"  (day-month-year)
       - "2026-05-13" (ISO date)
       - "2026-06-04 19:06:57" (ISO datetime)
       - "13/5/2026"
       - None / "" → None
    """
    if not s:
        return None
    s = str(s).strip()
    if not s:
        return None

    # لو فيه طابع زمني (timestamp) كـ datetime('now') في الـ DB
    # ممكن يجي كـ "2026-06-04 19:06:57" — ناخد التاريخ فقط
    s_clean = s.split(' ')[0] if ' ' in s else s

    # جرّب صيغ متعددة
    formats = [
        '%Y-%m-%d',       # 2026-05-13
        '%d-%m-%Y',       # 13-5-2026 (لكن 13 يتعرف كـ day)
        '%d-%m-%y',
        '%d/%m/%Y',       # 13/5/2026
        '%d/%m/%y',
        '%Y/%m/%d',
        '%m-%d-%Y',       # لو الأمريكي
        '%m/%d/%Y',
    ]
    for fmt in formats:
        try:
            return datetime.strptime(s_clean, fmt)
        except ValueError:
            continue

    # محاولة أخيرة: ترتيب day-month-year بدون zero-padding
    # "13-5-2026" → 13 day, 5 month, 2026 year
    m = re.match(r'^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$', s_clean)
    if m:
        try:
            d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            # استخدم heuristic: لو الرقم الأول > 12 → هو اليوم
            if d > 12 and mo <= 12:
                return datetime(y, mo, d)
            # لو الرقم التاني > 12 → هو اليوم (American)
            if mo > 12 and d <= 12:
                return datetime(y, d, mo)
            # الاتنين <= 12 — افترض day-month-year (EGX convention)
            return datetime(y, mo, d)
        except (ValueError, OverflowError):
            return None

    return None


def _classify_action(action: str) -> str:
    """يصنّف فعل التوصية لـ BUY / SELL / HOLD / UNKNOWN.

    يدعم الأفعال الإنجليزية والعربية الشائعة في جدول ExpertRecommendation.
    """
    if not action:
        return 'UNKNOWN'
    a = str(action).strip().upper()

    # مجموعة الشراء (BUY group)
    buy_set = {
        'BUY', 'STRONG_BUY', 'STRONG BUY', 'ACCUMULATE', 'OVERWEIGHT', 'LONG',
        'AVG_BUY', 'AVG BUY', 'AVERAGE_BUY', 'AVERAGE BUY',
        'ADD', 'BUY_DIP', 'BUY DIP',
    }
    # مجموعة البيع (SELL group)
    sell_set = {
        'SELL', 'STRONG_SELL', 'STRONG SELL', 'REDUCE', 'UNDERWEIGHT', 'SHORT',
        'TRIM', 'EXIT', 'AVOID',
    }
    # مجموعة الانتظار (HOLD group)
    hold_set = {
        'HOLD', 'NEUTRAL', 'WAIT', 'WATCH', 'OBSERVE',
    }

    if a in buy_set:
        return 'BUY'
    if a in sell_set:
        return 'SELL'
    if a in hold_set:
        return 'HOLD'

    # مطابقة نصوص عربية شائعة في الجدول (لو الـ action نص عربي)
    a_lower = a.lower()
    a_ar = str(action).strip()  # النسخة الأصلية بدون uppercase (للعربي)
    # شراء واحتفاظ / شراء / تجميع
    if 'شراء' in a_ar or 'تجميع' in a_ar or 'احتفاظ' in a_ar:
        return 'BUY'
    # دعم / ارتداد (support / rebound) — افترض شراء عند الدعم
    if 'دعم' in a_ar or 'ارتداد' in a_ar:
        return 'BUY'
    # بيع / تخلص / خروج
    if 'بيع' in a_ar or 'تخلص' in a_ar or 'خروج' in a_ar or 'تصريف' in a_ar:
        return 'SELL'
    # انتظار / راقب
    if 'انتظار' in a_ar or 'راقب' in a_ar or 'مراقبة' in a_ar:
        return 'HOLD'
    # مضاربة / T+1 — افترض شراء (توصية دخول)
    if 'مضاربة' in a_ar or 't+1' in a_lower or 'تريدة' in a_ar or 'توصية' in a_ar:
        return 'BUY'

    return 'UNKNOWN'


def _is_buy_like_signal(signal: str) -> bool:
    """هل إشارة الآلة تميل للشراء؟"""
    if not signal:
        return False
    s = str(signal).upper().strip()
    return s in {'BUY', 'STRONG_BUY', 'STRONG BUY', 'ACCUMULATE', 'LONG', 'OVERWEIGHT'}


def _is_sell_like_signal(signal: str) -> bool:
    """هل إشارة الآلة تميل للبيع؟"""
    if not signal:
        return False
    s = str(signal).upper().strip()
    return s in {'SELL', 'STRONG_SELL', 'STRONG SELL', 'REDUCE', 'SHORT', 'UNDERWEIGHT', 'TRIM'}


def _to_float(val) -> Optional[float]:
    """يحوّل قيمة لـ float بشكل آمن، أو None لو فشل."""
    if val is None:
        return None
    try:
        f = float(val)
        if f != f:  # NaN
            return None
        return f
    except (TypeError, ValueError):
        return None


# ════════════════════════════════════════════════════════════════════════════
# Main Bridge Functions
# ════════════════════════════════════════════════════════════════════════════

def fetch_active_expert_recs(ticker: str, days: int = 30) -> List[ExpertRec]:
    """يقرأ جدول ExpertRecommendation من stocks.db (read-only).

    Args:
        ticker: رمز السهم
        days: عدد الأيام السابقة للنظر فيها (default 30)

    Returns:
        List[ExpertRec] — التوصيات النشطة للسهم خلال آخر `days` يوم.
        status IN ('PENDING', 'TARGET_HIT', 'ACTIVE') والحقل session_date /
        recommendation_date / created_at ضمن النافذة.

    آمن: لو الجدول غير موجود / فاضي / DB مقفول → return [] بصمت.
    """
    if not ticker:
        return []

    target_sym = _normalize_symbol(ticker)
    if not target_sym:
        return []

    db_path = _resolve_db_path()
    if not Path(db_path).exists():
        return []

    conn = None
    try:
        # mode=ro لتفادي lock contention مع الـ Node.js side
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(db_path, writable=False).__enter__()
        cur = conn.cursor()

        # تحقق إن الجدول موجود
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ExpertRecommendation'")
        if not cur.fetchone():
            return []

        # اقرأ الأعمدة المتاحة — بعض الـ deployments الـ schema مختلفة شوية
        cur.execute("PRAGMA table_info(ExpertRecommendation)")
        col_names = {row[1] for row in cur.fetchall()}
        if not col_names:
            return []

        # الأعمدة الاختيارية (لو مش موجودة في الـ schema نتجاهلها)
        candidate_cols = [
            'stock_symbol', 'expert_name', 'expert_source', 'action',
            'entry_price', 'target_price', 'stop_loss',
            'support_level', 'resistance_level',
            'recommendation_reason', 'notes',
            'session_date', 'recommendation_date', 'created_at', 'status',
        ]
        available_cols = [c for c in candidate_cols if c in col_names]
        if 'stock_symbol' not in available_cols or 'action' not in available_cols:
            return []  # أعمدة إجبارية ناقصة

        # بناء الـ SELECT الديناميكي
        select_sql = f"SELECT {', '.join(available_cols)} FROM ExpertRecommendation"
        # فلتر الـ status لو العمود موجود
        where_clauses: List[str] = []
        params: List = []
        if 'status' in available_cols:
            where_clauses.append("status IN ('PENDING', 'TARGET_HIT', 'ACTIVE')")
        if where_clauses:
            select_sql += " WHERE " + " AND ".join(where_clauses)
        # ترتيب: الأحدث أولًا (لو في created_at)
        if 'created_at' in available_cols:
            select_sql += " ORDER BY created_at DESC"
        select_sql += " LIMIT 200"  # safety cap

        cur.execute(select_sql, params)
        rows = cur.fetchall()
        if not rows:
            return []

        col_idx = {c: i for i, c in enumerate(available_cols)}
        cutoff_dt = datetime.now() - timedelta(days=days)

        recs: List[ExpertRec] = []
        for row in rows:
            try:
                # مطابقة الرمز
                raw_sym = row[col_idx['stock_symbol']]
                if _normalize_symbol(raw_sym) != target_sym:
                    continue

                # فلترة التاريخ: استخدم session_date → recommendation_date → created_at
                date_val: Optional[str] = None
                for date_col in ('session_date', 'recommendation_date', 'created_at'):
                    if date_col in col_idx:
                        v = row[col_idx[date_col]]
                        if v:
                            date_val = str(v)
                            break
                parsed_dt = _parse_session_date(date_val)
                if parsed_dt is None:
                    # لو مفيش تاريخ نهائيًا، اعتبره "حديث" وخذه (آمن للمستخدم)
                    pass
                elif parsed_dt < cutoff_dt:
                    # التوصية قديمة → تجاهلها
                    continue

                # سبب التوصية — الـ schema فيه `recommendation_reason` أو `notes`
                reason = None
                if 'recommendation_reason' in col_idx:
                    reason = row[col_idx['recommendation_reason']]
                if not reason and 'notes' in col_idx:
                    reason = row[col_idx['notes']]

                # قيم الأسعار (آمنة مع None)
                def _g(col: str) -> Optional[float]:
                    if col in col_idx:
                        return _to_float(row[col_idx[col]])
                    return None

                rec = ExpertRec(
                    expert_name=str(row[col_idx.get('expert_name', -1)] or 'خبير محلل') if 'expert_name' in col_idx else 'خبير محلل',
                    expert_source=str(row[col_idx['expert_source']]) if 'expert_source' in col_idx and row[col_idx['expert_source']] else None,
                    action=str(row[col_idx['action']] or '').strip(),
                    entry_price=_g('entry_price'),
                    target_price=_g('target_price'),
                    stop_loss=_g('stop_loss'),
                    support_level=_g('support_level'),
                    resistance_level=_g('resistance_level'),
                    recommendation_reason=reason,
                    session_date=date_val,
                    status=str(row[col_idx['status']] or 'PENDING') if 'status' in col_idx else 'PENDING',
                )
                recs.append(rec)
            except Exception:
                # تخطي صف فاسد بصمت
                continue

        return recs
    except sqlite3.Error as e:
        logger.debug(f"[ExpertMemoryBridge] sqlite error: {e}")
        return []
    except Exception as e:
        logger.debug(f"[ExpertMemoryBridge] fetch error: {e}")
        return []
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def compute_expert_consensus(ticker: str, ai_signal: str, days: int = 30) -> ExpertConsensus:
    """يقارن إشارة الآلة مع توافق خبراء البشر.

    Args:
        ticker: رمز السهم
        ai_signal: إشارة الآلة الحالية (BUY / SELL / HOLD / STRONG_BUY / الخ)
        days: نافذة الأيام (default 30)

    Returns:
        ExpertConsensus مع score_adjustment + notes بالعربي.

    القواعد:
        - AI BUY-like + خبراء BUY → agreed=True, +min(8 * buy_count, 18)
        - AI SELL-like + خبراء SELL → agreed=True, +min(8 * sell_count, 18)
        - AI BUY vs خبراء SELL (أو العكس) → conflicted=True, -min(10 * opposing_count, 25)
        - مفيش توصيات → silent (count=0, adjustment=0)
        - ملاحظات إضافية لو فيه أسعار دخول/وقف/هدف من الخبراء
    """
    consensus = ExpertConsensus()

    try:
        recs = fetch_active_expert_recs(ticker, days=days)
        if not recs:
            return consensus  # silent — مفيش توصيات

        consensus.recs = recs
        consensus.count = len(recs)

        # صنّف كل توصية
        for r in recs:
            cls = _classify_action(r.action)
            if cls == 'BUY':
                consensus.buy_count += 1
            elif cls == 'SELL':
                consensus.sell_count += 1
            elif cls == 'HOLD':
                consensus.hold_count += 1
            # UNKNOWN لا يُحسب في أي مجموعة

        # قرر إجماع الخبراء (majority)
        counts = {'BUY': consensus.buy_count, 'SELL': consensus.sell_count, 'HOLD': consensus.hold_count}
        max_count = max(counts.values())
        non_zero_groups = [k for k, v in counts.items() if v > 0]

        if max_count == 0 or len(non_zero_groups) == 0:
            consensus.consensus_action = 'MIXED'  # كلها UNKNOWN
        elif len(non_zero_groups) > 1 and counts[non_zero_groups[0]] == counts[non_zero_groups[1]]:
            # تعادل بين أكبر مجموعتين → MIXED
            consensus.consensus_action = 'MIXED'
        else:
            # الأغلبية واضحة
            consensus.consensus_action = max(counts, key=counts.get) if max_count > 0 else 'MIXED'

        # قارن بإشارة الآلة
        ai_buy = _is_buy_like_signal(ai_signal)
        ai_sell = _is_sell_like_signal(ai_signal)

        if ai_buy and consensus.consensus_action == 'BUY':
            # توافق شراء
            consensus.agreed = True
            consensus.score_adjustment = min(8.0 * consensus.buy_count, 18.0)
            consensus.notes.append(
                f"✓ توافق الخبراء: {consensus.buy_count} خبير يوصي بالشراء "
                f"(تحديث الثقة +{consensus.score_adjustment:.0f} نقطة)"
            )
        elif ai_sell and consensus.consensus_action == 'SELL':
            # توافق بيع
            consensus.agreed = True
            consensus.score_adjustment = min(8.0 * consensus.sell_count, 18.0)
            consensus.notes.append(
                f"✓ توافق الخبراء: {consensus.sell_count} خبير يوصي بالبيع "
                f"(تحديث الثقة +{consensus.score_adjustment:.0f} نقطة)"
            )
        elif ai_buy and consensus.consensus_action == 'SELL':
            # تعارض: الآلة BUY، الخبراء SELL
            consensus.conflicted = True
            opposing = consensus.sell_count
            consensus.score_adjustment = -min(10.0 * opposing, 25.0)
            consensus.notes.append(
                f"⚠ تعارض مع الخبراء: {opposing} خبير يوصي بالبيع بينما الآلة تقترح شراء "
                f"(خصم الثقة {consensus.score_adjustment:.0f} نقطة)"
            )
        elif ai_sell and consensus.consensus_action == 'BUY':
            # تعارض: الآلة SELL، الخبراء BUY
            consensus.conflicted = True
            opposing = consensus.buy_count
            consensus.score_adjustment = -min(10.0 * opposing, 25.0)
            consensus.notes.append(
                f"⚠ تعارض مع الخبراء: {opposing} خبير يوصي بالشراء بينما الآلة تقترح بيع "
                f"(خصم الثقة {consensus.score_adjustment:.0f} نقطة)"
            )
        else:
            # الحالات الباقية: AI HOLD مع أي إجماع، أو إجماع MIXED، أو
            # AI BUY/SELL مع إجماع HOLD — نضيف ملاحظة استشارية بدون تعديل
            if consensus.consensus_action == 'HOLD' and (ai_buy or ai_sell):
                consensus.notes.append(
                    f"ℹ الخبراء محايدون ({consensus.hold_count} توصية HOLD) — "
                    f"الآلة تقترح {ai_signal}، تابع بحذر"
                )
            elif consensus.consensus_action == 'MIXED' and consensus.count > 0:
                consensus.notes.append(
                    f"ℹ آراء الخبراء متضاربة ({consensus.buy_count} BUY / "
                    f"{consensus.sell_count} SELL / {consensus.hold_count} HOLD) — لا توافق واضح"
                )

        # ملاحظات استشارية على مستويات الأسعار (دخول/وقف/هدف/دعم/مقاومة)
        # نأخذ أول 3 توصيات فقط لتفادي الإغراق
        for r in recs[:3]:
            name = (r.expert_name or 'خبير').strip() or 'خبير'
            # وقف الخسارة
            if r.stop_loss and r.stop_loss > 0:
                consensus.notes.append(
                    f"📊 خبير {name}: حدد وقف الخسارة عند {r.stop_loss:.2f}"
                )
            # الهدف
            if r.target_price and r.target_price > 0:
                consensus.notes.append(
                    f"🎯 خبير {name}: حدد الهدف عند {r.target_price:.2f}"
                )
            # الدعم
            if r.support_level and r.support_level > 0:
                consensus.notes.append(
                    f"🛡 خبير {name}: حدد الدعم عند {r.support_level:.2f}"
                )
            # المقاومة
            if r.resistance_level and r.resistance_level > 0:
                consensus.notes.append(
                    f"🚧 خبير {name}: حدد المقاومة عند {r.resistance_level:.2f}"
                )

        # لوج ملخص
        try:
            adj_str = f"{'+' if consensus.score_adjustment >= 0 else ''}{consensus.score_adjustment:.0f}"
            logger.info(
                f"[EXPERT-MEMORY] {ticker}: count={consensus.count} "
                f"buy={consensus.buy_count} sell={consensus.sell_count} hold={consensus.hold_count} "
                f"consensus={consensus.consensus_action} agreed={consensus.agreed} "
                f"conflicted={consensus.conflicted} adj={adj_str}"
            )
        except Exception:
            pass

        return consensus
    except Exception as e:
        logger.debug(f"[ExpertMemoryBridge] consensus error: {e}")
        return consensus  # آمن: لا يكسر الـ analyze


__all__ = [
    'ExpertRec',
    'ExpertConsensus',
    'fetch_active_expert_recs',
    'compute_expert_consensus',
]
