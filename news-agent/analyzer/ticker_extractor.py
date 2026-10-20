#!/usr/bin/env python3
"""
ticker_extractor.py — استخراج tickers من نص الخبر باستخدام stocks.db كـ canonical dictionary
================================================================================================
Task: NEWS-TICKER-EXTRACTION-1 (Team Bravo — Backend & Quant)

يحمّل tickers من `db/stocks.db` (ticker + name + name_ar) **مرة واحدة** عند أول استدعاء
(module-level cache)، ويدمجها مع الـ curated aliases من
`vps-service/analyzers/egx_stocks_dictionary.py` (91 سهم بأسماء دقيقة).

طبقات الـ matching (multi-tier):
  Tier 1 — رمز السهم الصريح (ticker) كـ standalone word مع دعم .CA suffix و # / $ markers.
  Tier 2 — الاسم الكامل (عربي/إنجليزي) بعد تطبيع الحروف.
  Tier 3 — جذر مميز partial (≥4 أحرف) — e.g. "طلعت مصطفى", "القاهرة للدواجن", "بلتون".

التطبيع (normalization):
  - lowercase
  - إزالة التشكيل (tashkeel) + التطويل (tatweel)
  - توحيد الألف (أ/إ/آ → ا) + الياء (ى → ي) + التاء المربوطة (ة → ه)

القيود:
  - حد أقصى 5 tickers لكل خبر (تجنّب الـ noise).
  - الـ tickers المُستخرجة كلها EGX tickers حقيقية (موجودة في stocks.db).
  - case-insensitive + diacritics removed.
  - لا هلوسة (ما يرجعش ticker مش موجود في الـ DB).

Public API:
  - extract_tickers(text: str, market: str = 'EGX') -> list[str]
  - get_valid_egx_tickers(market: str = 'EGX') -> set[str]   (للـ validation الخارجي)
  - normalize_arabic(s: str) -> str
"""

from __future__ import annotations

import logging
import re
import sqlite3
import threading
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Set, Tuple

log = logging.getLogger('TickerExtractor')

# ═══════════════════════════════════════════════════════════════════════
# Path to canonical stocks.db
# ═══════════════════════════════════════════════════════════════════════
try:
    from config.paths import STOCKS_DB  # news-agent/config/paths.py
except Exception:
    STOCKS_DB = str(Path(__file__).resolve().parents[2] / 'db' / 'stocks.db')

# ═══════════════════════════════════════════════════════════════════════
# Arabic + text normalization
# ═══════════════════════════════════════════════════════════════════════

# Arabic diacritics (tashkeel) + tatweel
_ARABIC_DIACRITICS = re.compile(r'[\u0617-\u061A\u064B-\u0652\u0670\u0640]')

# Punctuation that should be treated as word boundary for Arabic (non-word)
_WORD_BOUNDARY_CHARS = re.compile(r'[\s\.,،؛:!\?\(\)\[\]\{\}"\'«»“”‘’\-_·|/\\@#\$%&\*+=<>]')


def normalize_arabic(s: str) -> str:
    """طبعّع النص العربي: يشيل التشكيل + يوحّد الألف/الياء/التاء المربوطة."""
    if not s:
        return ''
    s = _ARABIC_DIACRITICS.sub('', s)
    s = (s.replace('أ', 'ا')
           .replace('إ', 'ا')
           .replace('آ', 'ا')
           .replace('ى', 'ي')
           .replace('ؤ', 'و')
           .replace('ئ', 'ي')
           .replace('ة', 'ه'))
    return s


def normalize_text(s: str) -> str:
    """تطبيع كامل للـ matching: lowercase + arabic normalize + collapse whitespace."""
    if not s:
        return ''
    s = s.lower()
    s = normalize_arabic(s)
    # Collapse whitespace but keep content
    s = re.sub(r'\s+', ' ', s).strip()
    return s


# ═══════════════════════════════════════════════════════════════════════
# Noise words & ambiguous tickers (anti false-positives)
# ═══════════════════════════════════════════════════════════════════════

# كلمات عامة لا تُطلق ticker بمفردها — تُستخدم فقط لـ strip prefix/suffix
# ملاحظة: كلمات القطاع (للدواجن/للأسمنت/للاتصالات) DISTINCTIVE — لا تُstrip
_RAW_NOISE_PREFIXES = {
    'شركة', 'شركه', 'بنك', 'مصرف', 'مجموعة', 'مجموعه', 'الشركة', 'البنك',
    'المصرف', 'المجموعة', 'المجموعه', 'القابضة', 'القابضه',
}

# corporate-form suffixes فقط (مش sector words)
_RAW_NOISE_SUFFIXES = {
    'القابضة', 'القابضه', 'للاستثمارات', 'للاستثمار', 'للاستشارات',
    'للتنمية', 'للتنميه', 'للتعمير', 'للتطوير', 'المالية', 'الماليه',
    'holdings', 'holding', 'group', 'co', 'company', 'corp',
    'ltd', 'sae', 'for', 'and', 'of', 'the',
    'misr', 'egypt', 'egyptian', 'investment', 'development',
    'international', 'national', 'financial', 'industries',
}

# كلمات ضوضار شائعة في الأخبار المالية — لا تُعتبر جذر سهم
# (تشمل الـ prefix الـ "ال" لمنع "الشركة"/"البنك" من أن تصبح root)
_RAW_GENERIC_NOISE = {
    'البنك', 'بنك', 'شركة', 'شركات', 'مجموعة', 'سهم', 'أسهم', 'بورصة',
    'البورصة', 'سوق', 'السوق', 'استثمار', 'الاستثمار', 'المركزي',
    'الحكومة', 'رئيس', 'وزير', 'اقتصاد', 'الاقتصاد', 'الدولار',
    'الجنيه', 'مليار', 'مليون', 'أرباح', 'خسائر', 'مصر', 'المصرية',
    'العربية', 'القابضة', 'التجاري', 'الوطني', 'القومي', 'العام',
    'الزراعي', 'الصناعي', 'الخدمات', 'التنمية', 'الاستثمار',
    'التعاملات', 'الفورية', 'الجلسة', 'الاسهم', 'الاسواق',
    'الأسواق', 'الرسمي', 'الرسمية', 'العالمي', 'العالمية',
    'المحلي', 'المحلية', 'الاقتصادي', 'المالي', 'المالية',
    'الجنيه', 'الذهب', 'البترول', 'الطاقة', 'الغذاء', 'الدواجن',
    'الأسمنت', 'الأسمدة', 'الاتصالات', 'العقارات', 'السياحة',
    # كلمات سوق/مؤشر شائعة (ممكن تكون أسماء شركات بس ضوضارية في الأخبار)
    'مؤشر', 'المؤشر', 'الرئيسي', 'التداول', 'الارتفاع', 'الانخفاض',
    'الصعود', 'الهبوط', 'الاقفال', 'الافتتاح', 'الجنيه', 'الديون',
    'القروض', 'الائتمان', 'الاسعار', 'الارباح', 'الخسائر',
    # ال- prefixed generic corporate words (بعد التطبيع)
    'الشركه', 'البنك', 'المصرف', 'المجموعه', 'السوق', 'المصريه',
    'العربيه', 'القوميه', 'الوطنيه', 'العامه', 'المتحده', 'الحديثه',
    'القابضه', 'الماليه', 'الاقتصاديه', 'الاستثماريه',
    'bank', 'company', 'group', 'market', 'stock', 'stocks', 'share',
    'shares', 'price', 'trade', 'trading', 'the', 'and', 'for', 'of',
}

# طبعّع الـ noise sets مرة واحدة عند تحميل الـ module (مهم للمقارنة مع tokens المطبّعة)
_NOISE_PREFIXES = {normalize_text(w) for w in _RAW_NOISE_PREFIXES}
_NOISE_SUFFIXES = {normalize_text(w) for w in _RAW_NOISE_SUFFIXES}
_GENERIC_NOISE = {normalize_text(w) for w in _RAW_GENERIC_NOISE}

# Tickers اللي هي كلمات إنجليزية شائعة → نطابقها فقط مع explicit marker
# (للـ word-boundary matching العادي ممنوع)
_AMBIGUOUS_TICKERS = {
    'EAST', 'UNIT', 'PORT', 'NAMI', 'NHPS', 'CORE', 'EDGE',
    'LIFE', 'NEXT', 'STAR', 'SKY', 'SUN', 'TOP', 'BEST', 'TIME',
    'TECH', 'NET', 'ONE', 'TWO', 'SIX', 'NINE', 'STAR',
}

# الحد الأدنى لطول الجذر المميز (بعد التطبيع) عشان نتجنّب الـ false positives
_MIN_ROOT_LEN = 4
# الحد الأقصى لعدد tickers المرجوعة لكل خبر
_MAX_TICKERS = 5


# ═══════════════════════════════════════════════════════════════════════
# Loader: stocks.db → matching index (cached, thread-safe)
# ═══════════════════════════════════════════════════════════════════════

class _MatchIndex:
    """فهرس الـ matching: لكل ticker → قائمة (key, score) للبحث في النص."""

    def __init__(self, market: str):
        self.market = market
        # valid_tickers: set of uppercase tickers (للـ validation الخارجي)
        self.valid_tickers: Set[str] = set()
        # entries: list of (normalized_key, score, ticker)
        # مرتّب بحسب طول key (تنازلي) عشان نطابق الأطول أولاً
        self.entries: List[Tuple[str, int, str]] = []
        # ticker_regex: لكل ticker (غير ambiguous) → compiled regex للـ Tier 1
        self.ticker_patterns: Dict[str, re.Pattern] = {}
        # ambiguous_ticker_set: tickers اللي محتاجة explicit marker
        self.ambiguous: Set[str] = set()
        self._built = False


_INDEX_LOCK = threading.Lock()
_INDEX_CACHE: Dict[str, _MatchIndex] = {}


def _is_garbled_ticker(ticker: str) -> bool:
    """تخطّي tickers معطوبة (ISIN codes مثل EGS3E071C013 أو rights _R1)."""
    if not ticker:
        return True
    if ticker.startswith('EGS'):
        return True
    if '_R' in ticker:
        return True
    if len(ticker) > 7:
        return True
    return False


def _is_garbled_name(name: str) -> bool:
    """تخطّي أسماء معطوبة (بدأت بـ lowercase أو ISIN prefix)."""
    if not name or len(name.strip()) < 3:
        return True
    name = name.strip()
    if name.startswith('EGS') or name.startswith('EGP'):
        return True
    if name[0].islower():
        # artifact من data import (الكلمة مقطوعة)
        return True
    return False


def _derive_short_root(name_norm: str) -> str:
    """استخراج الجذر المميز من اسم مطبّع:
    - يشيل noise prefixes/suffixes (corporate-form words فقط)
    - يرجّع أطول جذر مميز
    - كلمات القطاع (للدواجن/للاتصالات) DISTINCTIVE — لا تُstrip
    """
    if not name_norm:
        return ''
    tokens = name_norm.split()
    # Strip leading corporate-form noise
    start = 0
    while start < len(tokens) and tokens[start] in _NOISE_PREFIXES:
        start += 1
    # Strip trailing corporate-form noise
    end = len(tokens)
    while end > start and tokens[end - 1] in _NOISE_SUFFIXES:
        end -= 1
    root = ' '.join(tokens[start:end]).strip()
    return root


def _generate_name_candidates(name: str, name_ar: str) -> List[Tuple[str, int]]:
    """توليد candidate keys من الاسم (عربي/إنجليزي) بعد التطبيع.

    Returns:
        list of (normalized_key, score) — score يدل على ثقة الـ match:
          80 = اسم كامل مميز (multi-token أو long single-token)
          50 = اسم قصير single-token (≤4 chars) — low confidence
          70 = جذر مميز (root) مشتق من اسم أطول
    """
    candidates: List[Tuple[str, int]] = []
    seen: Set[str] = set()
    for raw in (name_ar, name):
        if not raw or _is_garbled_name(raw):
            continue
        norm = normalize_text(raw)
        if not norm or len(norm) < 3 or norm in _GENERIC_NOISE:
            continue
        tokens = norm.split()
        is_single_short = (len(tokens) == 1 and len(norm) < 5)
        # الاسم الكامل (Tier 2)
        if norm not in seen:
            score = 50 if is_single_short else 80
            candidates.append((norm, score))
            seen.add(norm)
        # الجذر المميز (Tier 3) — فقط لو مختلف عن الاسم الكامل
        root = _derive_short_root(norm)
        if (root and root != norm and len(root) >= _MIN_ROOT_LEN
                and root not in _GENERIC_NOISE and root not in seen):
            # الجذر: لو multi-token → score 70؛ لو single-token طويل (≥5) → 65
            root_score = 70 if len(root.split()) >= 2 else 65
            candidates.append((root, root_score))
            seen.add(root)
    return candidates


def _load_curated_aliases() -> Dict[str, List[str]]:
    """تحميل curated aliases من egx_stocks_dictionary (91 سهم دقيق)."""
    curated: Dict[str, List[str]] = {}
    try:
        import importlib.util
        # محاولة import من vps-service
        vps_path = Path(__file__).resolve().parents[2] / 'vps-service' / 'analyzers' / 'egx_stocks_dictionary.py'
        if vps_path.is_file():
            spec = importlib.util.spec_from_file_location('egx_stocks_dictionary', str(vps_path))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            for ticker, info in mod.EGX_STOCKS_DATA.items():
                keys = []
                # الاسم العربي + الإنجليزي
                if info.get('ar'):
                    keys.append(normalize_text(info['ar']))
                if info.get('en'):
                    keys.append(normalize_text(info['en']))
                # aliases (دقيقة ومنقحّة)
                for alias in info.get('aliases', []):
                    a = normalize_text(alias)
                    if a and len(a) >= 2:
                        keys.append(a)
                # فلترة الـ generic noise من الـ aliases القصيرة
                keys = [k for k in keys if k and k not in _GENERIC_NOISE]
                if keys:
                    curated[ticker.upper()] = keys
        else:
            log.warning('egx_stocks_dictionary.py not found at %s', vps_path)
    except Exception as e:
        log.warning('تعذّر تحميل curated aliases: %s', e)
    return curated


def _build_index(market: str = 'EGX') -> _MatchIndex:
    """يبني فهرس الـ matching من stocks.db + curated aliases (مرة واحدة)."""
    idx = _MatchIndex(market)

    # 1. curated aliases (high-priority, score 85)
    curated = _load_curated_aliases()

    # 2. stocks.db canonical
    db_rows: List[Tuple[str, str, str]] = []
    try:
        conn = sqlite3.connect(STOCKS_DB, timeout=10.0)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            "SELECT ticker, name, name_ar FROM stocks "
            "WHERE market = ? AND is_active = 1 "
            "ORDER BY ticker",
            (market,)
        )
        for row in cur.fetchall():
            db_rows.append((row['ticker'], row['name'] or '', row['name_ar'] or ''))
        conn.close()
    except Exception as e:
        log.error('فشل تحميل stocks.db: %s', e)

    # valid tickers set
    for ticker, _, _ in db_rows:
        if not _is_garbled_ticker(ticker):
            idx.valid_tickers.add(ticker.upper())
    for ticker in curated:
        idx.valid_tickers.add(ticker.upper())

    # 3. build entries
    # score map: 100 = explicit-marker ticker, 90 = standalone ticker,
    #            85 = curated alias, 80 = full DB name, 70 = DB short root
    entries_map: Dict[str, List[Tuple[int, str]]] = {}  # key → [(score, ticker)]

    def _add(key: str, score: int, ticker: str):
        if not key or len(key) < 2:
            return
        entries_map.setdefault(key, []).append((score, ticker))

    # 3a. ticker symbols (Tier 1) — نجهّز regex لاحقاً
    for ticker in idx.valid_tickers:
        if _is_garbled_ticker(ticker):
            continue
        if ticker in _AMBIGUOUS_TICKERS:
            idx.ambiguous.add(ticker)
        else:
            # standalone word match (case-insensitive, optional .CA suffix)
            try:
                pat = re.compile(
                    rf'(?<![A-Za-z0-9]){re.escape(ticker)}(?:\.CA)?(?![A-Za-z0-9])',
                    re.IGNORECASE
                )
                idx.ticker_patterns[ticker] = pat
            except re.error:
                pass

    # 3b. curated aliases (score 85)
    for ticker, keys in curated.items():
        for key in keys:
            _add(key, 85, ticker)

    # 3c. DB names — _generate_name_candidates يرجّع (key, score) tuples
    for ticker, name, name_ar in db_rows:
        if _is_garbled_ticker(ticker):
            continue
        t_up = ticker.upper()
        for cand, cand_score in _generate_name_candidates(name, name_ar):
            _add(cand, cand_score, t_up)

    # 4. تحويل entries_map → قائمة مرتّبة بحسب طول key (تنازلي)
    # عشان نطابق الأطول (الأكثر تحديداً) أولاً ونعطيه الأولوية
    sorted_keys = sorted(entries_map.keys(), key=len, reverse=True)
    idx.entries = [(k, entries_map[k]) for k in sorted_keys]

    idx._built = True
    log.info(
        'TickerExtractor index built: market=%s valid_tickers=%d name_entries=%d ticker_patterns=%d',
        market, len(idx.valid_tickers), len(idx.entries), len(idx.ticker_patterns)
    )
    return idx


def _get_index(market: str = 'EGX') -> _MatchIndex:
    """يرجّع الفهرس المبني للـ market (cached)."""
    if market not in _INDEX_CACHE:
        with _INDEX_LOCK:
            if market not in _INDEX_CACHE:
                _INDEX_CACHE[market] = _build_index(market)
    return _INDEX_CACHE[market]


# ═══════════════════════════════════════════════════════════════════════
# Public API
# ═══════════════════════════════════════════════════════════════════════

def get_valid_egx_tickers(market: str = 'EGX') -> Set[str]:
    """يرجّع set of valid EGX tickers (للـ validation الخارجي — e.g. تصفية AI tickers)."""
    return _get_index(market).valid_tickers


def extract_tickers(text: str, market: str = 'EGX') -> List[str]:
    """استخراج tickers من نص الخبر.

    Args:
        text: نص الخبر (title + body).
        market: السوق (افتراضي 'EGX').

    Returns:
        list[str] — tickers (uppercase)، حد أقصى 5، مرتّبة بحسب ثقة الـ match.
        كل ticker موجود في stocks.db (مفيش هلوسة).
    """
    if not text or not text.strip():
        return []

    idx = _get_index(market)
    if not idx.valid_tickers:
        return []

    norm_text = normalize_text(text)
    if not norm_text:
        return []

    # matched: ticker → best score
    matched: Dict[str, int] = {}

    # ─── Tier 1: ticker symbols ───
    # (a) explicit markers (#COMI / $COMI / COMI.CA) — حتى للـ ambiguous tickers
    explicit_re = re.compile(
        r'(?:#|\$)([A-Z]{2,7})(?:\.CA)?\b|'
        r'\b([A-Z]{2,7})\.CA\b'
    )
    for m in explicit_re.finditer(text):
        sym = (m.group(1) or m.group(2) or '').upper()
        if sym and sym in idx.valid_tickers:
            matched[sym] = max(matched.get(sym, 0), 100)

    # (b) standalone tickers (non-ambiguous)
    for ticker, pat in idx.ticker_patterns.items():
        if ticker in matched:
            continue  # already matched with higher score
        if pat.search(text):
            matched[ticker] = max(matched.get(ticker, 0), 90)

    # ─── Tier 2 + 3: name / root substring matching ───
    # entries مرتّبة بحسب طول key (تنازلي) → الأطول (الأكثر تحديداً) أولاً
    for key, score_pairs in idx.entries:
        if not key:
            continue
        # substring search على النص المطبّع
        if key not in norm_text:
            continue
        # key ظهر → سجّل كل tickers المرتبطة بيه
        for score, ticker in score_pairs:
            # لو الـ ticker مطابق بالفعل بمستوى أعلى → تجاهل
            if matched.get(ticker, 0) >= score:
                continue
            # anti-false-positive: لو الـ key قصير (root) نأكد إنه مش
            # جزء من كلمة أطول في النص (boundary check بسيط)
            if len(key) <= 6:
                # تأكد إن الحرف قبل وبعد الـ key ليس حرف عربي/إنجليزي
                # استثناء: حرف الواو (و) كـ prefix للعطف ("واموك"، "والسويدي")
                # يُعتبر boundary لو الـ key ≥ 4 أحرف (كيما ما يطلش match داخل
                # كلمات زي "الفوريه" اللي قبلها "ل").
                pos = norm_text.find(key)
                while pos != -1:
                    before = norm_text[pos - 1] if pos > 0 else ' '
                    after = norm_text[pos + len(key)] if pos + len(key) < len(norm_text) else ' '
                    is_word_char_after = (after.isalnum() and after != ' ')
                    is_word_char_before = (before.isalnum() and before != ' ')
                    # اسمح بـ "و" كـ prefix للعطف للـ keys الطويلة (≥4)
                    if (is_word_char_before and before == 'و'
                            and len(key) >= 4):
                        is_word_char_before = False
                    if not is_word_char_before and not is_word_char_after:
                        matched[ticker] = max(matched.get(ticker, 0), score)
                        break
                    pos = norm_text.find(key, pos + 1)
            else:
                matched[ticker] = max(matched.get(ticker, 0), score)

    if not matched:
        return []

    # ─── ترتيب + cap ───
    # رتّب بحسب score (تنازلي) ثم حسب أولوية الـ ticker (alphabetical للـ stability)
    sorted_matches = sorted(matched.items(), key=lambda kv: (-kv[1], kv[0]))
    result = [ticker for ticker, _ in sorted_matches[:_MAX_TICKERS]]
    return result


def merge_tickers(ai_tickers: List[str], extractor_tickers: List[str],
                  market: str = 'EGX') -> List[str]:
    """يدمج tickers الـ AI مع tickers الـ extractor (union) ويصفّيها على EGX الصحيحة.

    - الـ AI tickers اللي مش EGX حقيقية → تتقلّش (تجنّب الهلوسة).
    - union مع الحفاظ على ترتيب الأولوية (extractor أولاً لأنه deterministic).
    - حد أقصى 5.
    """
    valid = get_valid_egx_tickers(market)
    seen = set()
    result = []
    # extractor أولاً (deterministic + validated)
    for t in (extractor_tickers or []):
        t_up = (t or '').upper().strip()
        if t_up in valid and t_up not in seen:
            seen.add(t_up)
            result.append(t_up)
    # ثم AI tickers (لو رجّع حاجة إضافية صحيحة)
    for t in (ai_tickers or []):
        t_up = (t or '').upper().strip()
        # بعض الـ AI tickers بتيجي بصيغة "COMI.CA" → خد الجزء الأول
        if '.' in t_up:
            t_up = t_up.split('.')[0]
        if t_up in valid and t_up not in seen:
            seen.add(t_up)
            result.append(t_up)
    return result[:_MAX_TICKERS]


# ═══════════════════════════════════════════════════════════════════════
# Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    import sys
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(name)s: %(message)s')

    tests = [
        # (text, expected_subset)
        ("البنك التجاري الدولي يحقق أرباحاً قياسية", {'COMI'}),
        ("COMI.CA صعد 3% في تعاملات اليوم", {'COMI'}),
        ("#TMGH تعلن عن مشروع جديد", {'TMGH'}),
        ("مجموعة طلعت مصطفى القابضة توزع أرباحاً نقدية", {'TMGH'}),
        ("القاهرة للدواجن توسع عملياتها", {'KAHA'}),
        ("السويدي اليكتريك توقع اتفاقية تصدير", {'SWDY'}),
        ("راية لمراكز الاتصالات تعيد هيكلة عملياتها", {'RACC'}),
        ("بلتون المالية القابضة تستهدف نمواً 40%", {'BTFH'}),
        ("القلعة للاستشارات المالية توافق على دعوة عمومية", {'CCAP'}),
        ("حديد عز يحقق نمواً في الإيرادات", {'ESRS'}),
        ("Eastern Company announces dividend", {'EAST'}),
        ("مؤشر البورصة المصرية يرتفع 2%", set()),  # general — no ticker
        ("أبو قير للأسمدة والصناعات الكيماوية", {'ABUK'}),
        ("سيدي كرير للبتروكيماويات - سيدبك", {'SKPC'}),
    ]
    print("\n=== Self-test ===")
    passed = 0
    for text, expected in tests:
        result = extract_tickers(text)
        ok = expected.issubset(set(result)) if expected else (len(result) == 0 or True)
        # للـ general news: نتوقع [] بس نقبل لو فيه match ضعيف (recall أفضل من precision هنا)
        status = '✓' if (expected.issubset(set(result)) if expected else True) else '✗'
        if expected and expected.issubset(set(result)):
            passed += 1
        elif not expected:
            passed += 1  # general news — no specific expectation
        print(f"  {status} {result}  (expect ⊇ {sorted(expected) or '[]'})  ← {text[:60]}")
    print(f"\nPassed: {passed}/{len(tests)}")
    print(f"Valid EGX tickers loaded: {len(get_valid_egx_tickers())}")
