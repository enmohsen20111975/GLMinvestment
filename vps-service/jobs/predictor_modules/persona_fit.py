"""
persona_fit.py — Strangler Pattern module (Phase 7.2)
=====================================================
Extracted VERBATIM from `vps-service/jobs/daily_predictor.py` (lines ~300-336).
The original function `compute_persona_fit()` is re-exported by daily_predictor.py
so callers see no behavior change.

Purpose:
    Compute persona_fit for each V40.2 recommendation from evidence proofs.
    Derives 4 category scores from V40.2 proofs and weights them via
    PERSONA_INPUT_WEIGHTS to produce a fit score (0-100) per persona.
"""
from __future__ import annotations

# Import the persona weight table from analyzers.adaptive_weights.
# Same import path as daily_predictor.py uses.
from analyzers.adaptive_weights import PERSONA_INPUT_WEIGHTS


def compute_persona_fit(proofs):
    """احسب persona_fit لكل ترشيح V40.2 من evidence proofs.

    بـ derive 4 category scores من proofs الـ V40.2:
      trend + dna  → price_action (momentum / candle structure)
      makers       → smc_vsa (هيكل صناع السوق)
      sector       → sector_heat (سخونة القطاع)
      fundamentals → fundamental (P/E + ROE + debt)
    وبـ weightها بـ PERSONA_INPUT_WEIGHTS عشان نحسب fit score (0-100) لكل شخصية.

    الرجوع:
        {'persona_fit': 'gambler'|'balanced'|'conservative',
         'fit_scores': {'gambler': float, 'balanced': float, 'conservative': float}}
    """
    proofs = proofs or {}

    def _has_check(key):
        return '✅' in str(proofs.get(key, ''))

    # trend + dna → price_action (كل واحد 50%، كحد أقصى 100)
    pa_count = (1 if _has_check('trend') else 0) + (1 if _has_check('dna') else 0)
    base_scores = {
        'price_action': min(100.0, (pa_count / 2.0) * 100.0),
        'smc_vsa':      100.0 if _has_check('makers') else 0.0,
        'sector_heat':  100.0 if _has_check('sector') else 0.0,
        'fundamental':  100.0 if _has_check('fundamentals') else 0.0,
    }

    fit_scores = {}
    for persona in ('gambler', 'balanced', 'conservative'):
        w = PERSONA_INPUT_WEIGHTS[persona]
        fit = sum(base_scores[c] * w[c]
                  for c in ('price_action', 'smc_vsa', 'sector_heat', 'fundamental'))
        fit_scores[persona] = round(fit, 1)

    best = max(fit_scores, key=fit_scores.get)
    return {'persona_fit': best, 'fit_scores': fit_scores}
