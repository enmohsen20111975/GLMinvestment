"""
vps-service/tests/ — شبكة أمان الاختبارات الآلية (Phase 5 — Testing & QA)
==========================================================================

الـ package ده بيحوي كل اختبارات الـ backend:
  - test_risk_profile.py    : اختبارات الـ RiskProfile dataclass (LONG/SHORT + __post_init__).
  - test_v20_fusion.py      : اختبارات الـ V20 Fusion Engine (score 0-100 + risk 1.5R/3.0R).
  - test_db_manager.py      : اختبارات الـ DBManager (WAL + busy_timeout + reads).
  - test_circuit_breaker.py : اختبارات الـ CircuitBreaker (CLOSED → OPEN → HALF_OPEN).
  - test_router_e2e.py      : اختبار تكاملي للـ DecisionRouter.route('COMI', 'daily').

التشغيل:
    cd vps-service && python3 -m pytest tests/ -v

Author: دليل الاستثمار (Phase 5 — Testing & QA)
"""
