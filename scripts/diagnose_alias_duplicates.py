#!/usr/bin/env python3
"""
STOCKS-DEDUP-A-1 — Stage 1 + Stage 2 (diagnose + canonical decisions)
====================================================================

دي سكریپت تشخيص (dry-run) بـ يكتشف كل أزواج الـ alias duplicates في
`db/stocks.db.stocks` و يـ decide الـ canonical ticker لكل زوج.

الـ 3 معايير:
  (a) `name` (normalized lowercase strip) متطابق
  (b) `name_ar` (normalized) متطابق
  (c) manual review للأزواج اللي الاسم مختلف بس الجوهر واحد
      (زي truncation pattern + ticker-prefix pollution في name_ar)

الـ canonical decision logic (Rule 67 CALCULATION-CANONICAL + Rule 27 NO-FAKE-DATA):
  canonical = الصف اللي عنده:
    - name كامل مش مقطوع (أول حرف موجود)
    - name_ar عربي صح (فيه حروف [\u0600-\u06ff]) مش متسلسل بـ ticker
    - volume أعلى (الأكثر تداولاً = الأصلي عادةً)
    - ticker أقصر أو متطابق مع EGX official listing
  alias = الصف اللي عنده الاسم مقطوع / name_ar مضروب / volume أقل

⭐ dry-run فقط — ما يلمس أي حاجة في DB (Rule 1). SELECT بس.
⭐ لو فيه شك في زوج (مش واضح أنهي canonical) — بيرفعه في الـ JSON
   تحت `ambiguity_flag=true` مع توثيق السبب (Rule 27 — ما نفترضش).

Usage:
    python3 scripts/diagnose_alias_duplicates.py
    python3 scripts/diagnose_alias_duplicates.py --db db/stocks.db
    python3 scripts/diagnose_alias_duplicates.py --summary-only

Output:
    scripts/output/alias_pairs_<timestamp>.json
    scripts/output/alias_pairs_<timestamp>_summary.txt  (human-readable)

@author Bravo proxy (general-purpose)
@task STOCKS-DEDUP-A-1 (stages 1-3 only — migration stage 4 BLOCKED)
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple


def _utcnow_iso() -> str:
    """Timezone-aware UTC ISO timestamp (avoids datetime.utcnow() deprecation)."""
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _utcnow_compact() -> str:
    """Compact UTC timestamp for filenames: YYYYmmddTHHMMSSZ."""
    return datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')

# ============================================================================
# Paths (Rule 17 — RELATIVE-PATHS-ONLY)
# ============================================================================
_THIS_FILE = Path(__file__).resolve()
_SCRIPTS_DIR = _THIS_FILE.parent              # /home/z/my-project/scripts
_PROJECT_ROOT = _THIS_FILE.parents[1]         # /home/z/my-project
_DEFAULT_DB = _PROJECT_ROOT / 'db' / 'stocks.db'
_OUTPUT_DIR = _SCRIPTS_DIR / 'output'

# ============================================================================
# Helpers
# ============================================================================

_ARABIC_RE = re.compile(r'[\u0600-\u06ff]')
_UPPER_PREFIX_RE = re.compile(r'^[A-Z]{2,6}')
_PURE_NUMBER_RE = re.compile(r'^\d+$')


def _norm(s: Optional[str]) -> str:
    """Normalize a string for comparison: NFKC + strip + collapse spaces + lower."""
    if not s:
        return ''
    s = unicodedata.normalize('NFKC', str(s)).strip()
    s = re.sub(r'\s+', ' ', s)
    return s.lower()


def _has_arabic(s: Optional[str]) -> bool:
    """True if string contains Arabic characters."""
    return bool(s) and bool(_ARABIC_RE.search(s))


def _is_pure_number(s: str) -> bool:
    return bool(s) and bool(_PURE_NUMBER_RE.match(s.strip()))


def _looks_like_merged_ticker_name(symbol: str, name: str) -> bool:
    """
    Detect the legacy TradingView scraper bug:
      - symbol greedy-matched capital letters from "TICKER+Name"
      - so symbol = canonical_ticker + first_letter_of_Name
      - and name = rest of company name (first char dropped) + trailing 'D'

    Examples:
      symbol='LUTSL', name='otus For Agricultural Investments And DevelopmentD'
      symbol='KRDI'+'A' = 'KRDIA', name='l Khair River...D'

    We detect by: name ends with 'D' AND name's first char is lowercase
    AND symbol's last char matches the case-folded first letter of canonical.
    """
    if not symbol or not name:
        return False
    if len(symbol) < 3 or len(name) < 5:
        return False
    # Trailing 'D' (status badge from old TV DOM)
    if not name.endswith('D'):
        return False
    # First char of name is lowercase (suggests truncation of a CamelCase word)
    if not name[0].islower():
        return False
    # Symbol's last char (when lowercased) should equal name's first char
    # (e.g. LUTSL -> last='L' -> name starts with 'l' for 'Lotus'/'otus')
    # This is a soft signal — we don't require it but it strengthens the match.
    return True


def _looks_like_ticker_prefixed_name_ar(symbol: str, name_ar: str) -> bool:
    """
    Detect '<SYMBOL><name>D' pollution in the name_ar field.
    Example: name_ar='LUTSLotus For Agricultural...D' for symbol='LUTSL'.
    """
    if not symbol or not name_ar:
        return False
    if len(name_ar) <= len(symbol) + 2:
        return False
    if not name_ar.startswith(symbol):
        return False
    # After the symbol prefix, the remainder should look like an English name
    # (first char lowercase = truncation signature) and end with 'D'.
    remainder = name_ar[len(symbol):]
    if not remainder:
        return False
    if remainder[0].islower() and remainder.endswith('D'):
        return True
    return False


def _format_clean_ticker(raw: str) -> str:
    """
    Mirror of frontend `formatCleanTicker` (src/components/stocks/StocksView.tsx)
    and `scripts/clean_merged_tickers.py:format_clean_ticker`.

    Used to recover the canonical ticker from a polluted alias ticker:
      'LUTSL' -> 'LUTS'  (trim trailing capital that begins a CamelCase word)
      'KRDI' + 'A' = 'KRDIA' -> 'KRDI'
      'SPMD' + 'S' = 'SPMDS' -> 'SPMD'
    """
    if not raw:
        return raw
    if len(raw) <= 6:
        return raw
    m = _UPPER_PREFIX_RE.match(raw)
    if not m:
        return raw
    clean = m.group(0)
    while len(clean) > 2 and len(clean) < len(raw):
        nxt = raw[len(clean)]
        if nxt.islower():
            clean = clean[:-1]
        else:
            break
    return clean


# ============================================================================
# DB read-only loader
# ============================================================================

_DB_COLUMNS = (
    'id, ticker, name, name_ar, market, sector, current_price, '
    'previous_close, change_percent, volume, last_update, '
    'is_active, is_egx30, is_egx70, is_egx100, updated_at'
)


def _open_db_readonly(db_path: Path) -> sqlite3.Connection:
    """Open DB in READ-ONLY mode (Rule 1 — SELECT only)."""
    if not db_path.exists():
        raise FileNotFoundError(f"DB not found: {db_path}")
    uri = f"file:{db_path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=30.0)
    conn.row_factory = sqlite3.Row
    return conn


def _load_stocks(conn: sqlite3.Connection) -> List[Dict[str, Any]]:
    """Load all stocks rows for diagnosis."""
    cur = conn.cursor()
    # Verify the `stocks` table exists.
    cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='stocks'"
    )
    if cur.fetchone() is None:
        raise RuntimeError("table `stocks` not found in db")
    cur.execute(f"SELECT {_DB_COLUMNS} FROM stocks")
    rows = [dict(r) for r in cur.fetchall()]
    return rows


# ============================================================================
# Cluster detection (union-find)
# ============================================================================

def _detect_clusters(rows: List[Dict[str, Any]]) -> Dict[int, List[int]]:
    """
    Group row indices into clusters of likely duplicates using 4 signals:

      (a) normalized `name` matches (non-empty) within same market
      (b) normalized `name_ar` matches (non-empty) within same market
      (c) truncation pattern: row A's `name` == row B's `name` with the
          first character dropped (in same market)
      (d) ticker-prefix pollution signature: row's `name_ar` starts with
          its own ticker + ends with 'D' (legacy TradingView bug)

    Returns: dict {cluster_id: [row_indices]}
    """
    n = len(rows)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    # Group indices by market.
    by_market: Dict[str, List[int]] = {}
    for i, r in enumerate(rows):
        mkt = (r.get('market') or '').strip().upper() or 'UNKNOWN'
        by_market.setdefault(mkt, []).append(i)

    # (a) + (b) + (c): name / name_ar / truncation pairs (within-market).
    for mkt, idxs in by_market.items():
        # name -> [indices]
        name_idx: Dict[str, List[int]] = {}
        name_ar_idx: Dict[str, List[int]] = {}
        for i in idxs:
            nn = _norm(rows[i].get('name'))
            na = _norm(rows[i].get('name_ar'))
            if nn:
                name_idx.setdefault(nn, []).append(i)
            if na:
                name_ar_idx.setdefault(na, []).append(i)
        # (a) name clusters
        for arr in name_idx.values():
            if len(arr) > 1:
                base = arr[0]
                for j in arr[1:]:
                    union(base, j)
        # (b) name_ar clusters
        for arr in name_ar_idx.values():
            if len(arr) > 1:
                base = arr[0]
                for j in arr[1:]:
                    union(base, j)
        # (c) truncation pattern: row_i.name[1:] == row_j.name
        #     AND row_i looks like merged-ticker pollution.
        # Build a lookup: normalized_full_name -> first index that has it.
        full_name_lookup: Dict[str, int] = {}
        for i in idxs:
            nn = _norm(rows[i].get('name'))
            if nn and len(nn) > 3:
                full_name_lookup.setdefault(nn, i)
        for i in idxs:
            nn = _norm(rows[i].get('name'))
            if not nn or len(nn) < 4:
                continue
            tail = nn[1:]
            if tail in full_name_lookup:
                j = full_name_lookup[tail]
                if j != i:
                    # Truncation signal — link them.
                    union(i, j)

    # (d) ticker-prefix pollution does NOT directly link two rows; it tags
    #     a single row as a likely-alias candidate. The linking happens
    #     through (c) truncation. So we don't union here; we just mark.

    clusters: Dict[int, List[int]] = {}
    for i in range(n):
        clusters.setdefault(find(i), []).append(i)
    return {cid: arr for cid, arr in clusters.items() if len(arr) > 1}


# ============================================================================
# Canonical decision logic
# ============================================================================

def _is_likely_corrupted_volume(volume) -> bool:
    """
    Detect rows where the `volume` column was polluted with avg_volume data
    (a small float instead of an integer share count).
    Real share-volume is an int >= 100 for any actively-traded stock.
    """
    if volume is None:
        return False
    try:
        v = float(volume)
    except (TypeError, ValueError):
        return False
    if v <= 0:
        return False
    # If it's a small non-integer value, it's likely avg_volume bleed-through.
    if v < 100 and v != int(v):
        return True
    return False


def _names_look_like_different_companies(
    name_a: Optional[str],
    name_b: Optional[str],
    shared_name_ar: Optional[str],
) -> bool:
    """
    Heuristic to detect FALSE POSITIVE clusters where two DIFFERENT companies
    share a corrupted name_ar (and so were wrongly grouped together).

    Returns True if the names suggest these are different companies.

    Triggers:
      - Both names non-empty AND neither is a truncation of the other
      - AND the names are in different scripts (one Arabic, one English/Latin)
      - AND the shared name_ar does NOT match either name (i.e., name_ar is
        corrupted for at least one of them — they're not translations of the
        same company name).
    """
    na = _norm(name_a)
    nb = _norm(name_b)
    if not na or not nb or na == nb:
        return False
    # Truncation check (one name = other name with first char dropped)
    if len(na) >= 4 and len(nb) >= 4:
        if na[1:] == nb or nb[1:] == na:
            return False
    # Different scripts?
    a_arabic = _has_arabic(name_a)
    b_arabic = _has_arabic(name_b)
    if a_arabic == b_arabic:
        # Same script on both sides — could still be different companies,
        # but the heuristic here is for cross-script mismatch only.
        return False
    # One is Arabic, one is Latin. Now check if the shared name_ar matches
    # either name (i.e., one row is just a duplicate with Arabic-in-English-field).
    nar = _norm(shared_name_ar)
    if not nar:
        return False
    if nar == na or nar == nb:
        # The shared Arabic name matches one of the row names — likely a
        # duplicate-with-Arabic-in-English-field, not a false positive.
        return False
    # Names differ in script AND shared name_ar matches neither — strong
    # signal that these are two different companies with corrupted name_ar.
    return True


def _score_row(row: Dict[str, Any]) -> Tuple[int, List[str], List[str]]:
    """
    Score a row for canonical-ness. Higher canonical_score = more canonical.
    Returns (score, canonical_signals, alias_signals).
    """
    score = 0
    canonical_signals: List[str] = []
    alias_signals: List[str] = []

    ticker = (row.get('ticker') or '').strip()
    name = (row.get('name') or '').strip()
    name_ar = (row.get('name_ar') or '').strip()
    volume = row.get('volume') or 0
    last_update = (row.get('last_update') or '').strip()

    # --- canonical signals ---
    # 1. name_ar contains Arabic chars (proper Arabic name)
    if name_ar and _has_arabic(name_ar):
        score += 3
        canonical_signals.append('name_ar_has_arabic')
    # 2. name has first-char uppercase (looks complete, not truncated)
    if name and name[0].isupper():
        score += 1
        canonical_signals.append('name_first_char_uppercase')
    # 3. name is not the same as ticker (real name populated)
    if name and name.upper() != ticker.upper() and len(name) > len(ticker):
        score += 1
        canonical_signals.append('name_differs_from_ticker')
    # 4. ticker is short alpha (official EGX-style: 3-5 uppercase letters)
    if ticker and len(ticker) <= 5 and ticker.isalpha() and ticker.isupper():
        score += 1
        canonical_signals.append('ticker_short_alpha_official_style')

    # --- alias signals (negative score) ---
    # 5. name_ar starts with ticker + ends with 'D' (legacy TV bug)
    if _looks_like_ticker_prefixed_name_ar(ticker, name_ar):
        score -= 5
        alias_signals.append('name_ar_ticker_prefix_pollution')
    # 6. name looks like merged-ticker remainder (lowercase first char + trailing D)
    if _looks_like_merged_ticker_name(ticker, name):
        score -= 5
        alias_signals.append('name_is_merged_ticker_remainder')
    # 7. name's first char is lowercase (truncation signature) — soft signal
    if name and len(name) > 3 and name[0].islower():
        score -= 2
        alias_signals.append('name_first_char_lowercase_truncation')
    # 8. name_ar is English (no Arabic) but the row is in an Arabic-speaking market
    if name_ar and not _has_arabic(name_ar) and len(name_ar) > 3:
        score -= 1
        alias_signals.append('name_ar_is_english_swap')
    # 9. name_ar is NULL/empty
    if not name_ar:
        score -= 1
        alias_signals.append('name_ar_null_or_empty')
    # 10. ticker is ISIN-like (EGS + 9+ chars) — alias-style
    if ticker and len(ticker) >= 10 and ticker.upper().startswith('EGS'):
        score -= 2
        alias_signals.append('ticker_isin_like_egs_prefix')
    # 11. ticker has a clear alias suffix ('_R2', 'RE', 'EE', 'NE', 'N' suffix on a longer base)
    if ticker and ('_R2' in ticker.upper() or '_R3' in ticker.upper()):
        score -= 2
        alias_signals.append('ticker_has_r2_suffix')

    return score, canonical_signals, alias_signals


def _break_tie_by_data_quality(
    cluster_rows: List[Dict[str, Any]],
    idx_a: int,
    idx_b: int,
) -> Tuple[Optional[int], str]:
    """
    When two rows tie on _score_row, break the tie using objective data-quality
    signals: (1) higher volume, (2) more recent last_update, (3) shorter ticker.
    Returns (winner_idx or None if still tied, reason).

    Note: rows whose `volume` looks polluted (small float — avg_volume bleed-
    through) are treated as having NO volume signal (we don't penalize them,
    but we also don't reward them).
    """
    a = cluster_rows[idx_a]
    b = cluster_rows[idx_b]
    va_raw = a.get('volume') or 0
    vb_raw = b.get('volume') or 0
    # Treat corrupted-volume rows as if they had no volume signal.
    va = 0 if _is_likely_corrupted_volume(va_raw) else (va_raw or 0)
    vb = 0 if _is_likely_corrupted_volume(vb_raw) else (vb_raw or 0)
    # Volume signal (must differ by > 20% to be decisive)
    if va and vb and va != vb:
        ratio = min(va, vb) / max(va, vb)
        if ratio < 0.8:
            winner = idx_a if va > vb else idx_b
            win_vol = max(va, vb)
            lose_vol = min(va, vb)
            return winner, f'volume_tiebreak winner_vol={win_vol} loser_vol={lose_vol}'
    # If only one has volume > 0, that one wins
    if va and not vb:
        return idx_a, f'volume_tiebreak winner_has_volume={va} loser_no_volume_or_corrupted'
    if vb and not va:
        return idx_b, f'volume_tiebreak winner_has_volume={vb} loser_no_volume_or_corrupted'
    # Last_update recency (lexicographic ISO comparison works for ISO timestamps)
    la = (a.get('last_update') or '').strip()
    lb = (b.get('last_update') or '').strip()
    if la and lb and la != lb:
        winner = idx_a if la > lb else idx_b
        return winner, f'last_update_tiebreak winner={max(la, lb)} loser={min(la, lb)}'
    if la and not lb:
        return idx_a, f'last_update_tiebreak winner_has_timestamp loser_none'
    if lb and not la:
        return idx_b, f'last_update_tiebreak winner_has_timestamp loser_none'
    # Ticker length (shorter preferred)
    ta = (a.get('ticker') or '').strip()
    tb = (b.get('ticker') or '').strip()
    if ta and tb and len(ta) != len(tb):
        winner = idx_a if len(ta) < len(tb) else idx_b
        return winner, f'ticker_length_tiebreak winner_len={min(len(ta), len(tb))} loser_len={max(len(ta), len(tb))}'
    return None, 'still_tied_after_all_tiebreakers'


def _decide_canonical(
    cluster_rows: List[Dict[str, Any]],
) -> Tuple[Optional[int], str, List[str]]:
    """
    Given a cluster of 2+ rows (all same company), pick the canonical row index.
    Returns (canonical_idx, decision_reason, decision_signals).

    Decision rules (in priority order):
      1. Row WITHOUT alias signals + WITH Arabic name_ar → canonical.
      2. Row with higher volume (if volumes differ) → canonical.
      3. Row with more recent last_update → canonical.
      4. Row with shorter ticker (official-style) → canonical.

    If the scores tie OR the result is ambiguous (e.g., both rows have alias
    signals, or scores differ by < 2 with conflicting signals), we mark it
    AMBIGUOUS and return (None, 'ambiguous', reasons).

    Additional safety: if the cluster's two rows have names in different
    scripts (one Arabic, one Latin) AND the shared name_ar matches neither,
    we ALWAYS mark AMBIGUOUS (likely false positive — different companies
    sharing corrupted name_ar). Rule 27 — we do not invent a canonical.
    """
    if len(cluster_rows) == 1:
        return 0, 'single_row', []

    # FALSE-POSITIVE GUARD: different-language names that don't match the
    # shared name_ar → likely two different companies sharing corrupted data.
    # Check the first two rows of the cluster (the primary candidates).
    if len(cluster_rows) >= 2:
        r0, r1 = cluster_rows[0], cluster_rows[1]
        shared_name_ar = r0.get('name_ar') or r1.get('name_ar')
        if _names_look_like_different_companies(
            r0.get('name'), r1.get('name'), shared_name_ar,
        ):
            return None, 'ambiguous', [
                'FALSE_POSITIVE_GUARD: row names are in different scripts AND the '
                'shared name_ar matches neither name — likely two different '
                'companies sharing a corrupted name_ar (Rule 27 — do not invent canonical).',
                f'row0: name={r0.get("name")!r}  name_ar={r0.get("name_ar")!r}  ticker={r0.get("ticker")!r}',
                f'row1: name={r1.get("name")!r}  name_ar={r1.get("name_ar")!r}  ticker={r1.get("ticker")!r}',
            ]

    scored: List[Tuple[int, int, List[str], List[str]]] = []
    for idx, row in enumerate(cluster_rows):
        s, csig, asig = _score_row(row)
        scored.append((idx, s, csig, asig))

    # Sort: highest score first.
    scored.sort(key=lambda t: t[1], reverse=True)
    best_idx, best_score, best_csig, best_asig = scored[0]
    second_idx, second_score, second_csig, second_asig = scored[1]

    # Strong-decision check: best has >=2 alias signals difference OR
    # best has Arabic name_ar AND second has alias pollution.
    best_is_clear_canonical = (
        'name_ar_ticker_prefix_pollution' not in best_asig
        and 'name_is_merged_ticker_remainder' not in best_asig
    )
    second_is_clear_alias = (
        'name_ar_ticker_prefix_pollution' in second_asig
        or 'name_is_merged_ticker_remainder' in second_asig
    )

    if best_is_clear_canonical and second_is_clear_alias:
        reason_parts = []
        if 'name_ar_has_arabic' in best_csig:
            reason_parts.append('canonical has Arabic name_ar')
        if 'name_first_char_uppercase' in best_csig:
            reason_parts.append('canonical name is not truncated')
        if 'name_ar_ticker_prefix_pollution' in second_asig:
            reason_parts.append('alias has ticker-prefix pollution in name_ar')
        if 'name_is_merged_ticker_remainder' in second_asig:
            reason_parts.append('alias name is merged-ticker remainder')
        return best_idx, '; '.join(reason_parts) or 'clear alias signals', []

    # TRANSLATION-PAIR GUARD (Rule 27 — do not invent canonical):
    # If the two leading rows have name fields in DIFFERENT scripts (one
    # Latin-only, one Arabic-only) AND the shared name_ar matches one of
    # them, this is a translation pair. Data alone cannot determine which
    # ticker is canonical (official ticker status requires external EGX/KSE
    # listing lookup). Raise for John review instead of guessing.
    if not second_is_clear_alias:
        r_best_name = (cluster_rows[best_idx].get('name') or '').strip()
        r_second_name = (cluster_rows[second_idx].get('name') or '').strip()
        if r_best_name and r_second_name:
            best_ar = _has_arabic(r_best_name)
            second_ar = _has_arabic(r_second_name)
            if best_ar != second_ar:  # different scripts
                shared_nar = (
                    cluster_rows[best_idx].get('name_ar')
                    or cluster_rows[second_idx].get('name_ar')
                    or ''
                )
                nar_norm = _norm(shared_nar)
                na_norm = _norm(r_best_name)
                nb_norm = _norm(r_second_name)
                if nar_norm and (nar_norm == na_norm or nar_norm == nb_norm):
                    return None, 'ambiguous', [
                        'TRANSLATION_PAIR_GUARD: row names are in different scripts '
                        '(one Latin-only, one Arabic-only) and the shared name_ar '
                        'matches one of them. This is a translation pair — data '
                        'alone cannot determine which ticker is canonical (Rule 27 '
                        '— raise for John review with external EGX/KSE listing lookup).',
                        f'row_a: name={r_best_name!r}  name_ar={cluster_rows[best_idx].get("name_ar")!r}  ticker={cluster_rows[best_idx].get("ticker")!r}  score={best_score}',
                        f'row_b: name={r_second_name!r}  name_ar={cluster_rows[second_idx].get("name_ar")!r}  ticker={cluster_rows[second_idx].get("ticker")!r}  score={second_score}',
                    ]

    # If best_score - second_score >= 3 → confident.
    if best_score - second_score >= 3:
        return best_idx, f'score_diff={best_score - second_score}', []

    # If scores are close (diff < 3) but NOT tied, try the tiebreaker.
    # If scores are tied exactly, also try the tiebreaker.
    if best_score - second_score < 3:
        winner, reason = _break_tie_by_data_quality(cluster_rows, best_idx, second_idx)
        if winner is not None:
            return winner, f'tiebreak:{reason}', []

    # Otherwise — AMBIGUOUS. We'll let the caller raise it for review.
    return None, 'ambiguous', [
        f'best_idx={best_idx} score={best_score} signals={best_csig}+{best_asig}',
        f'second_idx={second_idx} score={second_score} signals={second_csig}+{second_asig}',
    ]


# ============================================================================
# Pair record builder
# ============================================================================

def _build_pair_record(
    cluster_rows: List[Dict[str, Any]],
    canonical_idx: Optional[int],
    alias_indices: List[int],
    decision_reason: str,
    ambiguity_reasons: List[str],
) -> Dict[str, Any]:
    """Build a single JSON-serializable pair record for one cluster."""

    if canonical_idx is None:
        # Ambiguous — emit a record covering the first 2 cluster rows so John
        # can see both candidates side-by-side. We pick row 0 as "primary"
        # ONLY for reporting (no canonical claim is made). Both tickers are
        # surfaced so John can review them with external EGX/KSE listing data.
        primary = cluster_rows[0]
        alias = cluster_rows[1] if len(cluster_rows) > 1 else None
        # For ambiguous pairs, canonical_candidate carries the primary
        # candidate's ticker (for review only) — canonical_decision stays None.
        canonical_ticker = primary.get('ticker')
        alias_ticker = alias['ticker'] if alias else None
    else:
        primary = cluster_rows[canonical_idx]
        # alias_indices[0] is the alias for this record
        alias = cluster_rows[alias_indices[0]]
        canonical_ticker = primary['ticker']
        alias_ticker = alias['ticker']

    # Compute price_diff + volume_ratio
    p1 = primary.get('current_price') or 0
    p2 = (alias.get('current_price') or 0) if alias else 0
    price_diff = round(abs(p1 - p2), 6) if (p1 or p2) else 0
    v1 = primary.get('volume') or 0
    v2 = (alias.get('volume') or 0) if alias else 0
    if v1 and v2:
        volume_ratio = round(min(v1, v2) / max(v1, v2), 4)
    else:
        volume_ratio = 0

    # Name evidence
    name_evidence = {
        'canonical_name': primary.get('name'),
        'alias_name': alias.get('name') if alias else None,
        'canonical_name_ar': primary.get('name_ar'),
        'alias_name_ar': alias.get('name_ar') if alias else None,
        'canonical_market': primary.get('market'),
        'alias_market': alias.get('market') if alias else None,
        'canonical_volume': primary.get('volume'),
        'alias_volume': alias.get('volume') if alias else None,
        'canonical_last_update': primary.get('last_update'),
        'alias_last_update': alias.get('last_update') if alias else None,
    }

    # Determine reason category
    if alias and (
        _looks_like_ticker_prefixed_name_ar(alias.get('ticker', ''), alias.get('name_ar') or '')
        or _looks_like_merged_ticker_name(alias.get('ticker', ''), alias.get('name') or '')
    ):
        reason = 'legacy_tradingview_scraper_bug_ticker_name_merge'
    elif alias and (alias.get('name_ar') is None or alias.get('name_ar') == ''):
        reason = 'alias_has_null_name_ar'
    elif alias and alias.get('name_ar') and not _has_arabic(alias.get('name_ar')):
        reason = 'alias_name_ar_is_english_swap'
    elif alias and alias.get('name') and primary.get('name') and _norm(alias.get('name')) == _norm(primary.get('name')):
        reason = 'normalized_name_match'
    else:
        reason = 'manual_review_match'

    ambiguity_flag = canonical_idx is None

    return {
        'canonical_candidate': canonical_ticker,
        'alias_candidate': alias_ticker,
        'market': primary.get('market'),
        'reason': reason,
        'price_diff': price_diff,
        'volume_ratio': volume_ratio,
        'name_evidence': name_evidence,
        'canonical_decision': canonical_ticker if not ambiguity_flag else None,
        'alias_to_archive': alias_ticker if not ambiguity_flag else None,
        'decision_reason': decision_reason if not ambiguity_flag else 'AMBIGUOUS — needs John review',
        'decision_confidence': 'low' if ambiguity_flag else ('high' if 'ambiguous' not in decision_reason else 'medium'),
        'ambiguity_flag': ambiguity_flag,
        'ambiguity_reasons': ambiguity_reasons if ambiguity_flag else [],
    }


# ============================================================================
# Main
# ============================================================================

def run_diagnosis(db_path: Path) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """
    Run the diagnosis. Returns (pair_records, stats).
    pair_records: list of pair dicts (one per canonical-vs-alias pair).
    stats: {total_clusters, total_pairs, ambiguous_pairs, clear_pairs, ...}
    """
    conn = _open_db_readonly(db_path)
    try:
        rows = _load_stocks(conn)
    finally:
        conn.close()

    clusters = _detect_clusters(rows)
    pair_records: List[Dict[str, Any]] = []
    stats = {
        'total_rows': len(rows),
        'total_clusters': len(clusters),
        'clear_pairs': 0,
        'ambiguous_pairs': 0,
        'clusters_with_3plus_rows': 0,
        'reason_counts': {},
    }

    for cid, row_idxs in clusters.items():
        cluster_rows = [rows[i] for i in row_idxs]
        canonical_idx, decision_reason, ambiguity_reasons = _decide_canonical(cluster_rows)

        if canonical_idx is None:
            # Ambiguous — emit one pair record covering the cluster
            # (using the first two rows as the "primary candidates")
            alias_indices = [i for i in range(len(cluster_rows)) if i != 0]
            rec = _build_pair_record(
                cluster_rows, None, alias_indices[:1],
                'ambiguous', ambiguity_reasons,
            )
            pair_records.append(rec)
            stats['ambiguous_pairs'] += 1
            stats['reason_counts'][rec['reason']] = stats['reason_counts'].get(rec['reason'], 0) + 1
            continue

        # Clear decision — emit one record per alias row.
        alias_indices = [i for i in range(len(cluster_rows)) if i != canonical_idx]
        if len(cluster_rows) >= 3:
            stats['clusters_with_3plus_rows'] += 1
        for ai in alias_indices:
            rec = _build_pair_record(
                cluster_rows, canonical_idx, [ai],
                decision_reason, [],
            )
            pair_records.append(rec)
            stats['clear_pairs'] += 1
            stats['reason_counts'][rec['reason']] = stats['reason_counts'].get(rec['reason'], 0) + 1

    stats['total_pairs'] = len(pair_records)
    return pair_records, stats


def _print_summary(records: List[Dict[str, Any]], stats: Dict[str, int], out_path: Path) -> None:
    """Write a human-readable summary .txt alongside the JSON."""
    lines: List[str] = []
    lines.append('=' * 78)
    lines.append('STOCKS-DEDUP-A-1 — alias duplicate diagnosis summary')
    lines.append(f'Generated: {_utcnow_iso()}Z')
    lines.append('=' * 78)
    lines.append(f'Total rows scanned:    {stats["total_rows"]}')
    lines.append(f'Total clusters (>=2):  {stats["total_clusters"]}')
    lines.append(f'Total pairs emitted:   {stats["total_pairs"]}')
    lines.append(f'  Clear pairs:         {stats["clear_pairs"]}')
    lines.append(f'  Ambiguous pairs:     {stats["ambiguous_pairs"]}')
    lines.append(f'Clusters with 3+ rows: {stats["clusters_with_3plus_rows"]}')
    lines.append('')
    lines.append('Reason counts:')
    for r, c in sorted(stats.get('reason_counts', {}).items(), key=lambda x: -x[1]):
        lines.append(f'  {c:>4}  {r}')
    lines.append('')
    lines.append('=' * 78)
    lines.append('PAIR RECORDS (canonical -> alias)')
    lines.append('=' * 78)
    for i, r in enumerate(records, 1):
        flag = '⚠️ AMBIGUOUS' if r['ambiguity_flag'] else '✓ clear'
        lines.append(f'[{i:>3}] {flag}  {r["canonical_candidate"] or "?"} -> {r["alias_candidate"] or "?"}  ({r["market"]})  reason={r["reason"]}')
        lines.append(f'      price_diff={r["price_diff"]}  volume_ratio={r["volume_ratio"]}')
        ev = r['name_evidence']
        lines.append(f'      canonical: name={ev.get("canonical_name")!r}  name_ar={ev.get("canonical_name_ar")!r}  vol={ev.get("canonical_volume")}')
        lines.append(f'      alias:     name={ev.get("alias_name")!r}  name_ar={ev.get("alias_name_ar")!r}  vol={ev.get("alias_volume")}')
        lines.append(f'      decision:  {r["decision_reason"]}')
        if r['ambiguity_flag']:
            for ar in r.get('ambiguity_reasons', []):
                lines.append(f'                 - {ar}')
        lines.append('')

    out_path.write_text('\n'.join(lines), encoding='utf-8')


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description='STOCKS-DEDUP-A-1 — diagnose alias duplicates in stocks.db (dry-run, read-only).',
    )
    parser.add_argument(
        '--db',
        default=str(_DEFAULT_DB),
        help=f'Path to stocks.db (default: {_DEFAULT_DB})',
    )
    parser.add_argument(
        '--summary-only',
        action='store_true',
        help='Print summary to stdout and skip writing JSON files.',
    )
    args = parser.parse_args(argv)

    db_path = Path(args.db).resolve()
    if not db_path.is_absolute():
        db_path = (_PROJECT_ROOT / db_path).resolve()

    print(f'[STOCKS-DEDUP-A-1] Diagnosing aliases in: {db_path}')
    print(f'[STOCKS-DEDUP-A-1] DB read-only mode (Rule 1 — SELECT only).')

    records, stats = run_diagnosis(db_path)

    # Print quick summary to stdout.
    print()
    print('=' * 60)
    print(f'Total rows scanned:    {stats["total_rows"]}')
    print(f'Total clusters (>=2):  {stats["total_clusters"]}')
    print(f'Total pairs emitted:   {stats["total_pairs"]}')
    print(f'  Clear pairs:         {stats["clear_pairs"]}')
    print(f'  Ambiguous pairs:     {stats["ambiguous_pairs"]}')
    print(f'Clusters with 3+ rows: {stats["clusters_with_3plus_rows"]}')
    print('=' * 60)

    if args.summary_only:
        return 0

    # Write JSON + summary .txt
    _OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = _utcnow_compact()
    json_path = _OUTPUT_DIR / f'alias_pairs_{ts}.json'
    summary_path = _OUTPUT_DIR / f'alias_pairs_{ts}_summary.txt'

    payload = {
        'task_id': 'STOCKS-DEDUP-A-1',
        'generated_at_utc': _utcnow_iso() + 'Z',
        'db_scanned': str(db_path),
        'stats': stats,
        'pairs': records,
        'notes': [
            'Dry-run output — no DB writes (Rule 1).',
            'Stage 4 (migration) is BLOCKED — requires owner authorization.',
            'Ambiguous pairs (ambiguity_flag=true) need John review before any merge (Rule 27).',
            'Canonical decisions follow Rule 67 (CALCULATION-CANONICAL): each company has exactly one canonical ticker.',
        ],
    }
    json_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, default=str),
        encoding='utf-8',
    )
    _print_summary(records, stats, summary_path)

    print(f'[STOCKS-DEDUP-A-1] JSON  written: {json_path}')
    print(f'[STOCKS-DEDUP-A-1] TXT   written: {summary_path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
