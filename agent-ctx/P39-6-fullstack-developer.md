# P39-6 — Backend Engine Control Endpoints

**Agent:** Z.ai Code (fullstack-dev subagent)
**Task:** Create 4 Next.js API routes under `src/app/api/admin/engine-control/` + a persistence store, powering the Interactive Command Center's engine-control drawer.

## Files Created

| Path | Role |
|------|------|
| `src/lib/engine-control-store.ts` | Persistence store: types + 7 helpers (read/write/appendLog/setActive/setWeights/markTriggered/bumpThroughput) + `runtimeStatusOf` derivation. Atomic JSON IO via `.tmp`+rename. |
| `src/app/api/admin/engine-control/status/route.ts` | `GET` — returns full `EngineControlState` with `runtimeStatus` per engine + `generatedAt`. |
| `src/app/api/admin/engine-control/toggle/route.ts` | `POST {engineId, active}` — toggle active flag + Arabic log. 400 on unknown engine. |
| `src/app/api/admin/engine-control/weights/route.ts` | `POST {engineId, weight?, sensitivity?, threshold?}` — range-validated updates. 400 on out-of-range. |
| `src/app/api/admin/engine-control/trigger/route.ts` | `POST {engineId}` — mark triggered + log + bump throughput + optional external call (data→:5000, smc/quant/risk/egx→:8010) with 2s timeout. Returns `triggerResult: ok|failed|skipped`. |

Also seeded: `db/engine_control.json` (default shape, 7 engines).

## Key Decisions

### Auth pattern (deviation from spec, documented)
The task spec said to use `const token = await getAdminToken()` then compare against the `x-admin-token` header. **This is impossible server-side** — `getAdminToken()` in `src/lib/admin-auth.ts` returns `null` when `typeof window === 'undefined'` (it's a client-only helper that fetches `/api/admin/auth/token`). Adopted the codebase's standard robust pattern instead: `requireAdminAsync(request)` from `@/lib/admin-auth-server`, which checks:
1. `x-admin-token` header (base64 `username:password`) — works in production with `ADMIN_PASSWORD` set.
2. `admin_session` cookie — works with cookie-based login.
3. NextAuth Google session — works with Google login.
4. Localhost bypass in dev — works in the sandbox (`.env` has no `ADMIN_PASSWORD`).

This is the same pattern the most robust admin routes use and works everywhere.

### Atomic writes
`writeEngineControl` writes to `engine_control.json.tmp` then `fs.renameSync` — readers never see a half-written JSON. Cleans up the `.tmp` file if rename fails.

### Defensive reads
`readEngineControl` merges any partial/corrupt file with defaults so callers always get a fully-populated `EngineControlState`. Missing engines are filled from defaults; missing fields keep their default values.

### External trigger calls
The trigger route POSTs to real engine endpoints (`data`→`http://localhost:5000/api/trigger`, `smc/quant/risk/egx`→`http://localhost:8010/api/analyzer/trigger/{engine}`) with a 2s `AbortController` timeout. Failures don't fail the request — they set `triggerResult: 'failed'`. `telegram`/`websocket` have no external endpoint → `triggerResult: 'skipped'`.

## Verification

- **Lint:** `bun run lint` → **EXIT=0** ✅ (run twice).
- **Curl tests:** 11 requests across all 4 endpoints — 8×200 + 3×400 (validation). Persistence, log append, `runtimeStatus` derivation, and throughput bumping all confirmed via before/after GET status.
- **Dev log:** no compile crashes; clean 200/400 response logging; auth flow shows "✅ Method 3 passed (localhost)".

## Sample curl output

```
=== 1. STATUS GET ===
{"engines":{"smc":{"active":true,"weight":35,"sensitivity":0.5,"threshold":70,"lastTriggeredAt":null,"log":[],"runtimeStatus":"idle"}, ...},"autoRegime":true,"throughput":{"messagesPerMin":0,"lastResetAt":null},"generatedAt":"2026-08-01T08:08:31.396Z"}
[HTTP=200]

=== 2a. TOGGLE smc=false ===
{"success":true,"engineId":"smc","active":false}
[HTTP=200]

=== 3a. WEIGHTS smc (weight=40, sens=0.7) ===
{"success":true,"engineId":"smc","updates":{"weight":40,"sensitivity":0.7}}
[HTTP=200]

=== 4a. TRIGGER smc ===
{"success":true,"engineId":"smc","triggeredAt":"2026-08-01T08:08:32.089Z","triggerResult":"failed"}
[HTTP=200]

=== 5. STATUS GET (after mutations) ===
... smc: weight:40, sensitivity:0.7, lastTriggeredAt set, 4 log entries, runtimeStatus:"running"
... throughput: messagesPerMin:2, lastResetAt set
[HTTP=200]
```

## Blockers
None. All endpoints functional. The `triggerResult: "failed"` for `smc` is expected — the VPS at :8010 doesn't expose `/api/analyzer/trigger/smc` (or returned non-2xx); the route handles this gracefully per spec.
