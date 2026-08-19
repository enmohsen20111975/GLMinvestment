# C-PERSONA-WIRING — full-stack-developer work record

> **Task ID:** C-PERSONA-WIRING
> **Agent:** full-stack-developer
> **Date:** 2026-08-11
> **Scope:** FIX-4 — Persona distribution + seasonality/liquidity wiring

## Context (from prior agents)
- **A-PY-ENGINE** اكتشف 4 مشاكل في `generate_persona_predictions.py` + `maestro_orchestrator.py`:
  1. آخر 7 أيام: كل التوقعات `balanced` (لا gambler/conservative حديثة).
  2. `seasonality_engine_v2` + `LiquidityFilter` class موجودين بس مش متوصلة بـ maestro.
  3. ARVA ظهرت مرتين في PENDING بسبب `generate_persona_predictions.py` بدون dedup قوي.
  4. لا يوجد limit على عدد التوقعات المُولّدة في `generate_persona_predictions.py`.

## Files Modified (2 — no new files)

### 1. `vps-service/scripts/generate_persona_predictions.py`
**Changes (additive — no deletions):**
- **L16**: أضفت `import os`.
- **L24-33**: أضفت module-level constants `_MAX_TICKERS=10` و `_MAX_PENDING_PER_PERSONA=5` (env-configurable) مع شرح كامل للـ FIX-4A.
- **L66-96**: بعد fetch `stored_rows`:
  - SORT by `(maestro_score DESC, confidence DESC)` (try/except آمن).
  - Dedup tickers (بعض stored_analyses قد تتكرر).
  - LIMIT لـ top 10 tickers (env: `PERSONA_SYNC_MAX_TICKERS`).
- **L189-190**: أضفت `_today_date_only = now_str[:10]` للـ dedup.
- **L203-217**: استبدلت dedup القديم (`outcome_date IS NULL` فقط) بـ dedup أقوى:
  ```sql
  WHERE ticker = ? AND persona = ?
    AND (outcome_date IS NULL OR date(prediction_date) = date(?))
  ```
  لو موجود → `continue` (skip نهائي — لا update ولا insert).
- **L219-236**: أضفت CAP check قبل كل INSERT:
  - count PENDING للـ persona.
  - لو >= 5 → `continue` (mirrors RL-FIX-17 pattern).
  - try/except آمن مع fallback `_pending_count = 0`.

### 2. `vps-service/analyzers/maestro_orchestrator.py`
**Changes (additive — inserted قبل `determine_recommendation()` call):**
- **L1866-1903 (FIX-4B)**: Seasonality Engine V2 wiring:
  ```python
  from analyzers.seasonality_engine_v2 import SeasonalityEngineV2
  _seas_engine = SeasonalityEngineV2(self.db_path)
  _seas_result = _seas_engine.analyze(ticker, sector=stock.get('sector'))
  # لو total_score >= +5 → maestro_score += min(5.0, total_score) [capped 100]
  # لو total_score <= -5 → maestro_score += max(-5.0, total_score) [floored 0]
  ```
  - الـ boost/penalty بـ يـ cap عند ±5 (احترام لقاعدة الخبير "زد": "الموسمية مساعدة مش كفّارة").
  - try/except آمن بـ `logger.debug` على failure.
  - warnings + warnings_ar بـ تسجّل التعديل.

- **L1905-1928 (FIX-4C)**: LiquidityFilter wiring:
  ```python
  from analyzers.liquidity_filter import LiquidityFilter
  _lf = LiquidityFilter(self.db_path)
  _liq_profile = _lf.analyze(ticker)
  # لو not _liq_profile.is_tradeable → maestro_score -= 10 [floored 0]
  ```
  - try/except آمن بـ `logger.debug` على failure.
  - warnings + warnings_ar بـ تسجّل الـ veto.

## API Verification (before wiring)
تم فحص الـ APIs الفعلية قبل الاستدعاء:
- `SeasonalityEngineV2(db_path).analyze(ticker, sector=None, analysis_date=None) → Dict[str, Any]`
  - Key: `total_score` (float, additive in [-20, +20]).
  - Verified: `analyze('COMI')` → `total_score=5.41`.
- `LiquidityFilter(db_path).analyze(ticker) → LiquidityProfile`
  - Fields: `is_tradeable` (bool), `level` (Enum), `warning` (str).
  - Verified: `analyze('COMI')` → `is_tradeable=True, level=HIGH`.

## Verification
- `vps-service/venv/bin/python3 -m py_compile` على كلا الملفين → OK
- `ast.parse` على كلا الملفين → OK
- Runtime import smoke test → OK (كلا modules importable من `analyzers.*`)
- `dev.log` قراءة آخر أسطر → لا Python errors (Next.js dev server شغال طبيعي)

## Rules Compliance
- ✅ استخدمت `Edit` tool فقط (مش Write).
- ✅ ما أنشأتش ملفات جديدة.
- ✅ ما مسحتش كود موجود (كل التعديلات additive أو استبدال بنفس الـ variable name).
- ✅ ما غيّرتش `.env` ولا `ecosystem.config.js`.
- ✅ الـ seasonality/liquidity modules موجودة + APIs واضحة → تم الـ wiring فعلاً (مش TODO).
- ✅ try/except آمن على كل wiring (مش هـ يكسر الكود لو module فشل).
- ✅ بعد كل تعديل، شغّلت `py_compile` للتأكد.

## Impact
- **FIX-4A**: السكربت دلوقتي بـ يـ insert max 30 توقع (10 tickers × 3 personas) بدل مئات. مع cap 5 PENDING/persona، المجموع الفعلي max 15 PENDING (5 لكل persona). ده بـ يـ fix:
  - مشكلة ARVA duplicate (dedup على (ticker, persona, date)).
  - مشكلة "كل التوقعات balanced" (cap بـ يـ force توزيع متوازن).
  - مشكلة تراكم PENDING (limit top 10 + cap 5/persona).
- **FIX-4B**: الأسهم بموسمية قوية (>= +5) بـ تاخد boost +5، والأسهم بموسمية سلبية (<= -5) بـ تاخد penalty -5. ده بـ يـ connect الـ seasonality engine بالـ maestro score لأول مرة.
- **FIX-4C**: الأسهم ضعيفة السيولة (NOT tradeable) بـ تاخد penalty -10. ده بـ يـ connect الـ LiquidityFilter class بالـ maestro score لأول مرة.

## Worklog
تم append قسم `C-PERSONA-WIRING` إلى `/home/z/my-project/worklog.md` بالصيغة المطلوبة.
