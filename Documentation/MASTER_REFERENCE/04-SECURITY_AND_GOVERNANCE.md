# 04-SECURITY_AND_GOVERNANCE.md

> **الملف المرجعي الرابع** — الأمن + الصلاحيات + سير العمل + إدارة الفريق.
> مصدر الحقيقة لكل ما يخص الأمن والحوكمة.

---

## 1. حالات الأمان الحالية (بعد Phase P0 + P1)

### ✅ تم إصلاحه (Phase P0 — 2026-10-14)

| الثغرة | الحالة | التفاصيل |
|---|---|---|
| CRIT-1: DeepSeek API key مكشوف | ✅ مطهّر | `vps-service/ai/deepseek_news_service.py:42` — key محذوف، env-only |
| CRIT-2: Admin password مكشوف | ✅ مطهّر | `SESSION_HANDOFF_JIMMY.md` + `test_stats.js` — `[REDACTED]` |
| CRIT-3: IDOR في portfolio/accounts | ✅ مُصلح | `requireAuthAsync()` + منع hardcoded userId |
| CRIT-4: user-posts DELETE بدون auth | ✅ مُصلح | `requireAuthAsync()` + ownership check |
| CRIT-5: Google OAuth fail-open | ✅ مُصلح | fail-closed (length === 0 → reject ALL) |
| CRIT-6: data-engine/control بدون auth | ✅ مُصلح | `requireAdminAsync()` |
| CRIT-7: alerts/quick-add بدون auth | ✅ مُصلح | `requireAuthAsync()` |
| Rule 81: `--force` في 4 مواقع | ✅ مُعدم | abort + notify (no force push) |

### ✅ تم إصلاحه (Phase P1 — 2026-10-14)

| الثغرة | الحالة | التفاصيل |
|---|---|---|
| HIGH-1: Bearer tokens plaintext | ✅ مُصلح | SHA-256 hashing (`src/lib/token-hash.ts`) |
| HIGH-6: Token prefix في logs | ✅ مُصلح | hash logging بدلًا من raw token |

---

## 2. نظام المصادقة (Authentication)

### 3 آليات مصادقة

#### 1. NextAuth (Web — primary)
```typescript
// src/app/api/auth/[...nextauth]/route.ts
- GoogleProvider (إلزامي للإنتاج)
- CredentialsProvider (dev only — gated by ALLOW_FORM_LOGIN=true)
- Session: JWT (30 days)
- Cookies: httpOnly + sameSite:lax + secure=isHttps
```

#### 2. Bearer Token (Mobile — API tokens)
```typescript
// Token format: egx_${user.id}_${randomUUID()}_${Date.now()}
// Storage: SHA-256 hash في api_tokens table (P1 fix)
// Verification: hash(incoming) === stored_hash
// TTL: 30 days
// Migration: backward-compatible (plaintext fallback for 30 days)
```

#### 3. Admin Auth (Admin panel)
```typescript
// 3 methods (in order of priority):
// 1. X-Admin-Token header (base64(user:pass))
// 2. NextAuth session + isAdmin() + subscription_tier='admin'
// 3. ALLOW_ADMIN_BYPASS=true (default OFF — secure)
// Localhost bypass: DISABLED (BOOTCAMP-3 fix)
```

### Helper Functions
```typescript
// src/lib/auth-helper.ts
getSessionUserId()         // → userId | null (tries Bearer → admin_session → NextAuth)
requireAuthAsync()         // → userId | 401 (mandatory for protected routes)

// src/lib/admin-auth-server.ts
requireAdminAsync()        // → { ok, userId, error } | 401 (mandatory for admin routes)
isServerAdmin(email)      // → boolean
```

---

## 3. الصلاحيات (Authorization)

### Tiers
| Tier | الصلاحيات |
|---|---|
| `free` | وصول محدود + Trial (7 أيام) |
| `premium` | وصول كامل + سقف استخدام أعلى |
| `pro` | + advanced-portfolio + specialist-analysis |
| `vip_pass` | + VIPLiveSignalsFeed + AuditedPerformanceView |
| `developer` | + B2B API key + limits أعلى |
| `admin` | + `#admin` + `/admin/*` (server-side gate) |

### PROTECTED_VIEWS (تتطلب تسجيل دخول)
25+ view مثل: `stock-detail`, `portfolio`, `watchlist`, `reports`, `alerts-center`, `live-monitor`, `trading-memory`...

### Admin Gate (server-side)
```typescript
// src/app/admin/layout.tsx
// Check: localhost bypass OR isServerAdmin(email) OR subscription_tier='admin'
// غير ذلك → redirect('/')
```

### Route Protection Patterns
```typescript
// Pattern 1: requireAuthAsync (user routes)
const userId = await requireAuthAsync();
if (!userId) return 401;

// Pattern 2: requireAdminAsync (admin routes)
const adminCheck = await requireAdminAsync();
if (!adminCheck.ok) return 401;

// Pattern 3: Ownership check
if (post.user_id !== authenticatedUserId) return 403;
```

---

## 4. Rate Limiting

### Routes المحميّة (4 من 463)
| Route | Limit |
|---|---|
| `/api/auth/login` | 5 req/min/IP |
| `/api/auth/register` | 5 req/min/IP |
| `/api/auth/google-signin` | 5 req/min/IP |
| `/api/b2b/signup` | 5 req/min/IP |

### Routes غير محميّة (تحتاج إضافة — Phase P2 future)
- `/api/admin/auth` (brute-force admin password)
- `/api/alerts/quick-add` (spam alerts)
- `/api/subscription/instapay/submit` (mass receipt uploads)
- `/api/redeem-promo` (brute-force promo codes)
- `/api/portfolio/accounts` (mass portfolio enumeration)

### Implementation
```typescript
// src/lib/rate-limiter.ts
- Token-bucket algorithm
- Composite key (IP + route)
- Configurable window (default 60s)
```

---

## 5. الأسرار والتكوين (Secrets Management)

### المبدأ (Rule 5 من دستور الأمان)
**لا أسرار في الكود** — كل secrets عبر environment variables فقط.

### env vars حرجة
| Var | كيفية التوليد |
|---|---|
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `ADMIN_SESSION_TOKEN` | `openssl rand -hex 32` |
| `BOT_API_SECRET` | `openssl rand -hex 32` |
| `DEEPSEEK_KEY` | من DeepSeek dashboard |
| `GOOGLE_CLIENT_*` | من Google Cloud Console |
| `SENTRY_DSN` | من Sentry dashboard |

### .env files
```
.env              # Development (gitignored)
.env.example      # Template (committed — no real secrets)
.env.production   # Production (gitignored — real values)
```

### .gitignore protections
```gitignore
.env
.env.local
.env.*.local
.env*
!.env.example     # Exception: template is safe to commit
```

---

## 6. OWASP Top 10 Coverage

### A01 Broken Access Control
- ✅ Fixed: 4 routes بدون auth أُصلحت (CRIT-3/4/6/7)
- ✅ Ownership checks في user-posts DELETE
- ⚠️ 273 من 463 routes بدون auth imports (أغلبها GET لبيانات عامة — مقبول)

### A02 Sensitive Data Exposure
- ✅ Bearer tokens الآن SHA-256 hashed (P1 fix)
- ⚠️ Admin token = `base64(user:pass)` — يمكن فكه بسهولة (Phase P2 future)
- ⚠️ Admin session cookie = static env var (Phase P2 future — per-user JWT)
- ✅ Receipts: MIME + extension + size validation (10MB max)

### A03 Injection (SQL + Command + XSS)
- ✅ **SQL injection**: 0 مخاطر مؤكدة — كل 22 ملف template-string queries تستخدم `?` placeholders
- ⚠️ **Command injection**: `admin/git-files/route.ts` يستخدم `execSync` (Phase P2: `execFile`)
- ✅ **XSS**: 2 hits `dangerouslySetInnerHTML` — كلاهما يحقن `JSON.stringify(schema)` آمنة

### A05 Security Misconfiguration
- ✅ `productionBrowserSourceMaps: false`
- ✅ `useSecureCookies: isHttps` (مرتبط بـ NEXTAUTH_URL)
- ✅ CORS: same-origin فقط (لا `*`)
- ⚠️ لا CSRF protection على `/api/bot/link-token` + `/api/admin/auth` (محتاج مراجعة)

### A06 Vulnerable Components
- ✅ `bcryptjs@3.0.3` (آمن، 12 salt rounds)
- ✅ `jsonwebtoken@9.0.3` (آمن، HS256)
- ✅ `next-auth@4.24.11` (آخر 4.x مدعوم)
- ✅ `better-sqlite3@11.10.0` (parameterized API)
- ⚠️ `zod@4.0.2` مُثبّت لكن غير مستخدم في أي route (Phase P2)

### A07 Authentication Failures
- ✅ Rate limiting على login/register/google-signin (5 req/min)
- ✅ Fail-closed Google OAuth (CRIT-5 fix)
- ✅ Unified error messages (no user enumeration)
- ⚠️ Bearer tokens: 30 يوم بدون refresh mechanism (Phase P2)

### A08 Insecure Deserialization
- ✅ `JSON.parse` على user input في try/catch (safe-by-design)
- ✅ لا `eval()` / `new Function()` على user input

### A10 SSRF
- ✅ External API URLs ثابتة (غير user-controlled)
- ⚠️ `data-engine/control/route.ts` يستخدم `DATA_ENGINE_URL` env (low risk)

---

## 7. سير العمل (Workflow)

### دورة العمل الإلزامية (Rule 76)
1. **قبل أي مهمة**:
   - `git pull --rebase origin main`
   - قراءة آخر 200-300 سطر من `worklog.md`
   - قراءة آخر 3-5 commits
2. **أثناء التنفيذ**:
   - كل تعديل موثّق بـ file:line
   - لا افتراضات — تحقق من الكود الفعلي
3. **بعد التنفيذ**:
   - `bun run lint` (0 errors)
   - `bunx tsc --noEmit --skipLibCheck` (0 errors في الملفات المعدّلة)
   - `python3 -m py_compile` على أي ملف Python لمسته
4. **قبل الـ commit**:
   - لا `--force` (Rule 81)
   - لا secrets في الكود
   - رسالة commit واضحة + مفصّلة

### Git Workflow
```bash
# Sync before work
git fetch origin main
git pull --rebase origin main

# Branch for risky work (optional)
git checkout -b feature/your-feature

# Commit with detailed message
git commit -m "feat(scope): description

Detailed explanation...
"

# Push (no --force ever)
git push origin main
# OR
git push origin feature/your-feature
```

### Commit Message Convention
```
type(scope): short description

type: feat | fix | docs | refactor | chore | test | style
scope: p0 | p1 | p2 | arch | ui | api | db | security
```

---

## 8. إدارة الفريق

### الأدوار
| الدور | المسؤوليات | المسموح |
|---|---|---|
| **المالك (محسن)** | قرارات نهائية + موافقات | كل شيء |
| **سوسو (CEO)** | إدارة الوكلاء + جودة + أمن | تنفيذ + رفع (لا --force) |
| **جيمي (GM)** | معماري + تحليل | Alpha + Bravo |
| **Alpha Team** | Frontend | `src/` فقط |
| **Bravo Team** | Backend | `vps-service/` + `scripts/` |

### قواعد الفريق
1. كل وكيل يحصل على Task ID + بريف مستقل + نطاق ملفات واضح
2. لا وكيلين يعدّلان نفس الملف بالتوازي
3. الوكلاء يقرؤون السياق الضروري فقط (ليس المستودع كله)
4. النتائج مختصرة: الأدلة + الملفات + الاختبارات + المخاطر + الأسئلة المفتوحة
5. سوسو مسؤول عن دمج النتائج + مراجعة التناقضات

---

## 9. التحديثات والتوثيق

### Rule 41 (DOCS-FIRST-LAST)
- قبل أي عمل: قراءة التوثيق
- بعد أي عمل: تحديث التوثيق

### Rule 70 (DOCUMENTATION-SECRETARY)
- كل تغيير جوهري يُوثّق في `CHANGELOG.md`
- كل مهمة تُسجّل في `worklog.md` (Task ID + Agent + Work Log + Stage Summary)

### Rule 82 (VERIFIABLE-PROOF-MANDATE)
- لا تقرير إصلاح بدون دليل رقمي
- Test Output + File diff مطلوبان لكل ادعاء

---

## 10. خطة الأمان المستقبلية (Phase P2+)

### أولوية عالية (P2)
1. Hash admin token (استبدال `base64(user:pass)` بـ random opaque token)
2. Per-user JWT لـ admin_session (بدلًا من static env var)
3. `execFile` بدلًا من `execSync` في `admin/git-files`
4. Rate limiting لـ admin/auth + alerts/quick-add + instapay/submit + redeem-promo
5. zod schemas لـ POST routes الحساسة
6. نقل receipts خارج `public/` + magic-byte verification

### أولوية متوسطة (P3)
1. CSRF protection على bot-link + admin-auth POST routes
2. توقيع admin_session cookie بـ HMAC
3. Token rotation على password change
4. Prometheus alerting rules
5. Central log aggregation (Loki/ELK)

---

## 11. الاستجابة للحوادث (Incident Response)

### إذا اكتُشف سر مكشوف
1. **فوري**: Rotate السر في الخدمة الخارجية (DeepSeek/GitHub/admin)
2. **خلال ساعة**: حذف السر من الكود + git history (`git filter-repo`)
3. **خلال يوم**: تدقيق كل الـ commits الأخيرة للتأكد من عدم وجود أسرار أخرى
4. **توثيق**: تسجيل الحادثة في `worklog.md` + إشعار المالك

### إذا اكتُشفت ثغرة أمنية
1. **تقييم**: مدى الخطورة (CRIT/HIGH/MED/LOW)
2. **إصلاح فوري** للـ CRIT/HIGH
3. **اختبار**: lint + tsc + py_compile
4. **رفع**: commit + push (بدون --force)
5. **توثيق**: تحديث هذا الملف + `worklog.md`

---

*آخر تحديث: 2026-10-14 by سوسو (CEO Agent)*
