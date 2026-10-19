# UNIFY-RISK-TELEGRAM — Work Record

**Agent:** main-agent
**Task ID:** UNIFY-RISK-TELEGRAM
**Date:** 2026-10-05
**Branch:** main

## Summary

Disambiguated 4 risk-management files and 2 Telegram senders by adding
clear CANONICAL / SUPPLEMENTARY docstrings (Rule 54). No files were archived
because the only "suspected-orphan" candidate turned out to have 1 importer
(a standalone CLI script), so per Rule 16 (VERIFY-BEFORE-DELETE) it was
disambiguated instead of removed.

## Task A — Risk files (4)

### Verification (grep-based, Rule 16)

| File | Lines | Class/Exports | Importers (production) | Importers (scripts/tests) | Verdict |
|---|---:|---|---|---|---|
| `analyzers/risk.py` | 285 | `RiskAssessment`, `RiskManager` | `api/public_routes.py`, `api/risk_routes.py`, `analyzers/__init__.py` | — | **CANONICAL** (per-trade evaluator) |
| `analyzers/risk_adaptive.py` | 701 | `RiskManagerAdaptive`, `RiskProfile`, `SELL_SIGNALS` | `analyzers/master_analyzer.py`, `analyzers/__init__.py` | — | **CANONICAL** (adaptive stops) |
| `analyzers/risk_manager.py` | 690 | `RiskManager` (portfolio), `PortfolioRiskManager`, `PositionSizingResult` | NONE | `scripts/true_forward_test.py` (1 importer; uses `PortfolioRiskManager` only) | **SUPPLEMENTARY** (not in main pipeline) |
| `risk_management_advanced.py` | 1878 | functional API (no class) | `api/risk_routes.py`, `analyzers/engine_settings.py` (comments only), `analyzers/prediction_optimizer.py` (comments only) | `tests/unit/test_regression_settings_consistency.py`, `tests/unit/test_stop_loss_settings.py` | **CANONICAL** (advanced functional API) |

### Findings vs task hypothesis

The task hypothesis said `risk_manager.py` is "imported by NO ONE (check!)".
After grep verification (Rule 16):

- The `PositionSizingResult` dataclass IS imported by NO ONE outside the file. ✅
- The `RiskManager` class (portfolio-level, different signature from `risk.py`)
  IS imported by NO ONE outside the file. ✅
- The `PortfolioRiskManager` class IS imported by exactly ONE standalone CLI
  script: `scripts/true_forward_test.py`. ⚠️ Not strictly orphaned.

Therefore the file was NOT archived (would break the script). Instead it
received a SUPPLEMENTARY docstring explaining:

1. It is not in the main application pipeline.
2. The `RiskManager` class here has a different signature than `risk.py`'s
   `RiskManager` (portfolio+regime-based vs capital+risk_percent).
3. Future cleanup option: pair-archive this file together with
   `true_forward_test.py` if that script is retired.

### Action taken

| File | Action | Commit |
|---|---|---|
| `analyzers/risk.py` | Added CANONICAL docstring (per-trade RiskAssessment) | `523f832` |
| `analyzers/risk_adaptive.py` | Added CANONICAL docstring (adaptive stops) | `f91ee92` |
| `analyzers/risk_manager.py` | Added SUPPLEMENTARY docstring (forward-test script only) | `b4fcc5b` |
| `risk_management_advanced.py` | Added CANONICAL docstring (advanced functional API) | `5fdfc6b` |

## Task B — Telegram senders (2)

### Verification (grep-based, Rule 16)

| File | Lines | Class | Importers | Verdict |
|---|---:|---|---|---|
| `telegram/telegram_client.py` | 1232 | `TelegramService` + singleton `telegram_service` | `api/telegram_routes.py` (3 places), `ai/telegram_signal_importer.py`, `telegram/__init__.py` | **CANONICAL** (Telethon user account, bi-directional) |
| `telegram/telegram_notifier.py` | 389 | `TelegramNotifier` | `api/telegram_routes.py` (8 places), `scripts/telegram_live_monitor.py`, `jobs/daily_closer.py` | **CANONICAL** (HTTP Bot API, send-only) |

### Rule 54 (PICK ONE) — Clarification

Both senders ARE used in production. They serve genuinely different
protocols/purposes, so consolidating them would break functionality:

- `telegram_client.py`    = Telethon, USER account, BI-DIRECTIONAL
                            (receive channel messages + reply/forward).
                            Heavyweight, async, requires session file.
- `telegram_notifier.py`  = HTTP Bot API, BOT account, SEND-ONLY
                            (target-hit alerts, daily/weekly reports,
                            intraday alerts, closing scorecards).
                            Lightweight, synchronous, no Telethon.

For new OUTBOUND-only notification code, PREFER `telegram_notifier.py`
(lighter, no Telethon dependency).
For RECEIVING messages or acting as a Telegram user, use `telegram_client.py`.

### Action taken

| File | Action | Commit |
|---|---|---|
| `telegram/telegram_client.py` | Added CANONICAL docstring (Telethon user account, bi-directional) | `1c35b38` |
| `telegram/telegram_notifier.py` | Added CANONICAL docstring (HTTP Bot API, send-only) | `fd955d9` |

## Rules compliance

- ✅ Rule 4 (no new files) — only docstrings edited, no new files created.
- ✅ Rule 16 (VERIFY-BEFORE-DELETE) — grepped every file's importers before
  deciding archive vs disambiguate.
- ✅ Rule 26 (commit + push after each change) — 6 separate commits, each
  pushed to `origin/main`.
- ✅ Rule 54 (pick one) — explicitly clarified which file is canonical for
  which use-case.
- ✅ Stash + pull --rebase + stash pop before every push (all "Already up
  to date." — no upstream divergence).
- ✅ Python AST syntax validation after each edit.
- ✅ `bun run lint` clean (exit 0).
- ✅ `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` → 200.

## What was archived

**Nothing.** The only "suspected-orphan" file (`analyzers/risk_manager.py`)
turned out to have one importer (`scripts/true_forward_test.py`), so it was
disambiguated instead of removed (Rule 16). No Telegram files were orphaned;
both are in active production use.

## What was disambiguated

6 files, all with explicit CANONICAL/SUPPLEMENTARY docstring blocks:

1. `analyzers/risk.py`                       → CANONICAL per-trade RiskAssessment
2. `analyzers/risk_adaptive.py`              → CANONICAL adaptive stops (signal/volatility/liquidity)
3. `analyzers/risk_manager.py`               → SUPPLEMENTARY (forward-test script only)
4. `risk_management_advanced.py`             → CANONICAL advanced functional API
5. `telegram/telegram_client.py`            → CANONICAL Telethon user-account client (bi-directional)
6. `telegram/telegram_notifier.py`           → CANONICAL HTTP Bot API outbound notifier (send-only)

## What remains / Notes for next agent

- The 4 risk files still exist as separate files (different purposes, not merged).
- The 2 Telegram senders still exist as separate files (different protocols, not merged).
- `archive/orphaned/` directory remains empty.
- **Future cleanup option**: if `scripts/true_forward_test.py` is retired,
  pair-archive it together with `analyzers/risk_manager.py` (they form a
  small isolated module that's not in the main pipeline).
- The duplicate `RiskManager` class name (in `risk.py` vs `risk_manager.py`)
  is now explicitly called out in both docstrings to prevent future confusion.
