# 04 — مرجع الـ APIs

> **آخر تحديث:** 2026-10-25 | **Commit:** `a3d1d8b`

---

## 1. إحصائيات

| النوع | العدد |
|-------|-------|
| Next.js API routes | 464 |
| Python backend endpoints | ~500 |
| Admin API routes (محدّث) | 72 (كان 88) |
| Active screens consuming APIs | 63 |

## 2. أهم الـ Endpoints

### رادار السيولة
| Endpoint | الدور |
|----------|-------|
| `GET /api/v2/liquidity-radar?market=EGX` | الرادار الأساسي (cache reader) |
| `GET /api/maker-radar/track` | تتبع الإشارات |
| `GET /api/radar/accuracy?market=EGX&days=90` | دقة التوقعات |
| `GET /api/radar/personalized` | رادار مخصص (auth) |
| `POST /api/maker-radar/signal-tracker/verify` | تحقق من الإشارات |

### تحليل الأسهم
| Endpoint | الدور |
|----------|-------|
| `GET /api/stocks/[ticker]/unified` | قرار موحد (SSOT) |
| `GET /api/v2/chart/full-analysis?ticker=X` | تحليل شامل |
| `GET /api/analysis/[ticker]` | تحليل master_analyzer |
| `GET /api/portfolio/rescue` | إنقاذ سهم خسران |

### إدارة الأدمن
| Endpoint | الدور |
|----------|-------|
| `GET /api/admin/system-health` | صحة النظام |
| `GET /api/admin/system-resources` | CPU/RAM/DB |
| `GET /api/admin/db-backup` | نسخ احتياطي |
| `GET /api/admin/engines-status` | حالة المحركات |

## 3. قواعد الـ API

- كل admin routes محمية بـ `requireAdminAsync`
- كل response فيها `success: boolean`
- لا fabrication: لو البيانات ناقصة → `null` + رسالة واضحة
- `normalizeMarketCode()` يقبل أي string (DEFECT: LOW — محتاج validation)

## 4. Live Console

| Endpoint | الدور |
|----------|-------|
| `GET /api/admin/db-backup/logs?job=ID` | سجلات عملية الرفع |
| `GET /api/admin/db-backup/status?job=ID` | حالة العملية |
