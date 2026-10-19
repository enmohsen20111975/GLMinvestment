# TASK-B — Resource Monitoring Backend

**Agent:** Z.ai Code (main)
**Task ID:** TASK-B
**Completed:** 2026-10-04

## Summary

Built the complete resource-monitoring backend: metrics DB (better-sqlite3 + auto-create), system metrics collector, 15s background collector hook in `instrumentation.ts`, three new admin API routes (`/history`, `/anomalies`, `/process-history`), and snapshot-on-demand in the existing `/api/admin/system-resources` route. Full tiered retention (raw 24h → 5min 7d → 1h 30d) + 5 anomaly types (threshold / spike / trend / memory_leak / recovered) with dedup.

## Files Created

| Path | Purpose |
|------|---------|
| `src/lib/metrics-collector.ts` | `collectSnapshot()` — reads CPU/RAM/Disk/PM2/Network/Load/NodeRSS |
| `src/lib/metrics-db.ts` | better-sqlite3 wrapper — schema, retention, anomaly detection |
| `src/app/api/admin/system-resources/history/route.ts` | GET time-series history with auto table selection |
| `src/app/api/admin/system-resources/anomalies/route.ts` | GET alerts + health_score (0-100) |
| `src/app/api/admin/system-resources/process-history/route.ts` | GET per-process history |

## Files Modified

| Path | Change |
|------|--------|
| `src/instrumentation.ts` | Added 15s background collector (preserved original 22 lines) |
| `src/app/api/admin/system-resources/route.ts` | Added fire-and-forget `collectSnapshot()` + `insertSnapshot()` in GET handler |

## Key APIs for Frontend Agent

### 1. `GET /api/admin/system-resources/history?range=1h`
Valid ranges: `15m | 1h | 6h | 24h | 7d | 30d` (default: `1h`)

Response shape:
```json
{
  "range": "1h",
  "points": [
    { "ts": "...", "cpu": 45.2, "mem_pct": 17.0, "disk_pct": 42.0,
      "pm2_online": 7, "pm2_total": 7, "load1": 0.8,
      "net_rx_kb": 12.5, "net_tx_kb": 5.2 }
  ],
  "summary": {
    "cpu_avg": 45.2, "cpu_max": 62.1, "cpu_current": 56.9,
    "mem_avg": 17.0, "mem_max": 18.5, "mem_current": 17.0,
    "disk_current": 42.0, "pm2_online_current": 7
  }
}
```

**Note:** `net_rx_kb` / `net_tx_kb` are `null` for `7d` / `30d` ranges (network not aggregated). Use `AreaChart` for CPU/RAM/Disk %, `LineChart` for PM2 counts.

### 2. `GET /api/admin/system-resources/anomalies?limit=50`
Response:
```json
{
  "alerts": [ { "id":1, "ts":"...", "resource":"cpu", "severity":"critical", "type":"threshold", "message":"CPU usage high at 92.5%", "value":92.5 } ],
  "health_score": 70,
  "health_severity": "warning",
  "count": 1
}
```
Health score = `max(0, 100 - Σpenalty)` where `critical=-15`, `warning=-5` (only counts alerts in last 15 min).

### 3. `GET /api/admin/system-resources/process-history?name=telegram-poster&range=1h`
Response:
```json
{
  "name": "telegram-poster",
  "range": "1h",
  "points": [ { "ts":"...", "cpu":5.2, "memory_mb":120.5, "restarts":0, "status":"online" } ],
  "count": 1
}
```

## DB Schema (in `db/metrics.db`)

5 tables auto-created on first use:
- `resource_snapshot_raw` — every 15s, kept 24h
- `resource_snapshot_5min` — 5-min aggregates, kept 7d
- `resource_snapshot_1h` — 1-hour aggregates, kept 30d
- `pm2_process_snapshot` — per-process, kept 24h
- `resource_alert` — alert log, kept 30d

All `db/*.db` files are gitignored.

## Anomaly Detection — 5 Types

1. **threshold** — CPU/RAM/Disk ≥85% → critical, ≥70% → warning. PM2 online < total → warning.
2. **spike** — current > 2× avg of last 10 readings (and ≥30% baseline).
3. **trend** — linear regression slope > 0.25/step (~1%/min over 10 readings).
4. **memory_leak** — RAM monotonically increasing for 20+ readings with >0.5% delta.
5. **recovered** — was critical in last 15 min + now <60%.

Dedup: skips if same `resource+type` alert exists within 5-30 min depending on type.

## Verification

- ✅ `bun run lint` — no errors in any new/modified file
- ✅ `bunx tsc --noEmit` — zero errors in new/modified files (pre-existing errors in unrelated files)
- ✅ Standalone `node --import tsx` test: DB auto-creates, snapshot inserts work, history query returns points, anomaly detection fires 4 alerts for high-CPU/RAM/Disk + PM2-down scenario, alert dedup prevents duplicates within 5-min window.
- ✅ Original `src/instrumentation.ts` content (lazy sql.js init notes) preserved.

## Backend Collector Schedule

| Action | Interval | Trigger |
|--------|----------|---------|
| `collectSnapshot()` + `insertSnapshot()` | every 15s | `setInterval` in `instrumentation.ts` |
| Initial snapshot | on server boot | immediate fire-and-forget |
| `runRetention()` | every ~15 min | every 60th collection |
| `detectAnomalies()` | every ~1 min | every 4th collection |

The interval is `unref()`ed so it doesn't keep the process alive.

## Forward-pointers

- Frontend agent: existing `SystemMonitorPanel.tsx` polls `/api/admin/system-resources` every 6s. Each poll now also writes a snapshot to the DB (so dashboard has immediate data on first open).
- `recharts` v2.15.4 already installed — use `AreaChart` for CPU/RAM/Disk %, `LineChart` for PM2 counts.
