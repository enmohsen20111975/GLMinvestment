# 01 — المعمارية الكاملة

> **آخر تحديث:** 2026-10-25 | **Commit:** `a3d1d8b`

---

## 1. المعمارية الرباعية

```
Caddy (:81) — Gateway
  ├── Next.js (:3000) — DISPLAY ONLY
  ├── Python (:8010) — THE BRAIN (110 analyzers)
  ├── Data Engine (:5000) — Scrapers
  ├── WS Service (:3005) — socket.io
  └── Telegram Events (:3003) — relay
```

## 2. الخدمات (10)

| # | الخدمة | المنفذ | اللغة | الدور |
|---|--------|--------|------|-------|
| 1 | Caddy | 81 | Go | Gateway + Reverse Proxy |
| 2 | Next.js | 3000 | TypeScript | Display only |
| 3 | Python Backend | 8010 | Python | THE BRAIN |
| 4 | Data Engine | 5000 | Python | جلب البيانات |
| 5 | WS Service | 3005 | Bun | socket.io |
| 6 | Telegram Events | 3003 | Bun | relay |
| 7 | Ollama | 11434 | Go | LLM محلي |
| 8 | News Agent | — | Python | أخبار |
| 9 | Telegram Poster | — | Python | نشر |
| 10 | Telegram Bot | — | Python | بوت تفاعلي |

## 3. تدفق البيانات

```
Source → Data Engine → data_engine.db → stocks.db → Python Analyzers → predictions.db → API → Next.js → User
```

## 4. قواعد البيانات (9)

| DB | الحجم | الجداول | الدور |
|----|-------|---------|-------|
| stocks.db | 22 MB | 51 | operational (read-mostly) |
| predictions.db | 277 MB | 33 | THE BRAIN STORE |
| price_history.db | 97 MB | 2 | OHLCV يومي |
| intraday.db | 170 MB | 6 | سلاسل زمنية لحظية |
| data_engine.db | 52 MB | 19 | write target للـ scrapers |
| auth.db | 0.25 MB | 14 | مستخدمون + اشتراكات |
| news.db | 6 MB | 4 | أخبار |
| metrics.db | 6 MB | 3 | مراقبة الأداء |
| crypto.db | 0.03 MB | 3 | metadata كريبتو |

## 5. المكدس التقني

| الطبقة | التقنية |
|--------|---------|
| Framework | Next.js 16.1.3 (App Router, Turbopack dev / Webpack prod) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 + shadcn/ui (New York) |
| Database | Prisma 5.22 + better-sqlite3 |
| State | Zustand + TanStack Query v5 |
| Charts | lightweight-charts v5 + Recharts |
| Auth | NextAuth.js v4 |
| Real-time | socket.io (Bun) |
| AI | Ollama (glm-fast:latest) |
| Backend | Python FastAPI + Flask |
