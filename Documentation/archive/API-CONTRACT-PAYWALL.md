# API Contract — Paywall System (BRAVO RESTRUCT-B-P1)

> **For:** Alpha (frontend) — to wire the UI paywall gates.
> **From:** Bravo (backend) — Python paywall layer implemented.
> **Status:** Final — per John's directive.

---

## Authentication Model (Trusted-Proxy)

```
Browser → Next.js (3000) → Python (8010)
                ↓
         Next.js auth (NextAuth)
                ↓
         sends headers:
           X-API-Key: <PROXY_API_KEY>
           X-User-Id: <user_id or empty>
           X-User-Tier: <tier or empty>
```

**Next.js MUST send these 3 headers on every Python backend call.** Python trusts them (trusted-proxy model — Python is NOT exposed directly to internet).

---

## Tier Hierarchy

```
guest (0) < free (1) < normal (2) < premium (3) < pro (4) < admin (5)
```

- **guest**: anonymous visitor (no `X-User-Id` header). Read-only limited.
- **free**: registered user, trial may be active or expired.
- **normal/premium/pro**: paid. Full access.
- **admin**: everything.

---

## Endpoint Classification

### 🟢 Guest-OK (no decorator — default)
| Endpoint | Notes |
|----------|-------|
| `GET /api/market-pulse` | market overview |
| `GET /api/market-overview` | market summary |
| `GET /api/stocks` | stock list (limited fields for guest) |
| `GET /api/stocks/<ticker>` | stock detail (limited) |
| `GET /api/flow/summary` | liquidity flow summary |
| `GET /api/flow/top` | top liquidity flows |
| `GET /api/flow/<ticker>` | ticker flow |
| `GET /api/flow/heatmap` | flow heatmap |
| `GET /api/liquidity/buckets` | canonical bucket classifier |
| `GET /api/market/overview` | public market overview |

### 🟡 Trial-Required (`@require_trial_or_paid`)
Free tier requires **active trial** (`trial_ends_at > NOW`). Paid tiers bypass.

| Endpoint | Notes |
|----------|-------|
| `GET /api/ai/live/scan` | AI live scan (advanced) |
| `GET /api/ai/live/signals` | AI live signals |
| `POST /api/ai/ask` | AI Q&A |
| `GET /api/ai/decision/<ticker>` | AI decision per ticker |

### 🔵 Registered-Only (`@require_role('free')`)
Any registered user (trial active OR expired).

| Endpoint | Notes |
|----------|-------|
| `POST /api/portfolio/*` | user portfolio |
| `POST /api/watchlist` | user watchlist |
| `POST /api/price-alerts` | user alerts |
| `GET /api/expert-recommendations/active` | expert recs |

### 🟠 Paid-Only (`@require_role('normal')`)
Normal/Premium/Pro/Admin only.

| Endpoint | Notes |
|----------|-------|
| `POST /api/backtest/*` | backtesting |
| `GET /api/advanced-analysis/*` | deep analysis |
| `GET /api/sniper/*` | sniper scans |

### 🔴 Admin-Only (`@require_admin`) — already done (B-P0)
74 endpoints in `admin_routes.py`.

---

## Response Shapes

### 403 — Insufficient Tier (guest hit a paid endpoint)
```json
{
  "success": false,
  "error": "insufficient_tier",
  "required_tier": "normal",
  "current_tier": "guest",
  "error_ar": "هذه الميزة تتطلب اشتراك normal أو أعلى"
}
```

### 402 — Trial Expired (free tier, trial ended)
```json
{
  "success": false,
  "error": "trial_expired",
  "reason": "trial_expired",
  "error_ar": "انتهت فترة التجربة. اشترك الآن للوصول الكامل.",
  "upgrade_required": true
}
```
**Alpha: show `TrialExpiredModal` (soft paywall — not hard block) when `status === 402`.**

---

## Frontend Integration (Alpha)

### 1. Next.js API routes MUST forward auth headers
```typescript
// src/lib/python-backend.ts
const headers: HeadersInit = {
  'X-API-Key': process.env.PROXY_API_KEY || '',
};
if (session?.user?.id) {
  headers['X-User-Id'] = session.user.id;
  headers['X-User-Tier'] = session.user.subscription_tier || 'free';
}
const res = await fetch(`${PYTHON_BACKEND}${path}`, { headers });
```

### 2. Handle 402 (trial expired) → soft paywall
```typescript
if (res.status === 402) {
  // Show TrialExpiredModal (soft — user can dismiss + browse limited)
  showTrialExpiredModal();
  return null;
}
if (res.status === 403) {
  const data = await res.json();
  // Show LockModal with required tier
  showLockModal(data.required_tier);
  return null;
}
```

### 3. Guest Mode UI
- Guest (no session) → can hit Guest-OK endpoints only.
- Any interaction with Trial/Paid endpoints → show `LoginOrGuestSheet` (light modal, not AuthView imprisonment).

---

## Canonical Values

| Key | Value | Source |
|-----|-------|--------|
| `TRIAL_DAYS_CANONICAL` | **14** | `auth_middleware.py` (B-P2 will enforce) |
| `TIER_ORDER` | guest→admin | `auth_middleware.py` |
| `PROXY_API_KEY` | env var | Next.js sends, Python verifies |

---

**Bravo — B-P1 implemented. Alpha: wire the UI per this contract.**
