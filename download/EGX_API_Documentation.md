# EGX Investment Platform — API Documentation
## for Mobile App Development

**Base URL:** `http://localhost:3000` (development) / `https://your-domain.com` (production)

**Version:** Next.js App Router (API Routes)

**Authentication:** NextAuth (JWT-based, 30-day session expiry)

---

## Table of Contents

- [1. Authentication](#1-authentication)
  - [POST /api/auth/register](#post-apiauthregister)
  - [GET /api/auth/[...nextauth]](#get-apiauthnextauth)
- [2. Market Data](#2-market-data)
  - [GET /api/market/overview](#get-apimarketoverview)
  - [GET /api/market/status](#get-apimarketstatus)
  - [GET /api/market/indices](#get-apimarketindices)
  - [GET /api/market/live-data](#get-apimarketlive-data)
  - [GET /api/market/recommendations/ai-insights](#get-apimarketrecommendationsai-insights)
  - [POST /api/market/sync-live](#post-apimarketsync-live)
  - [POST /api/market/sync-historical](#post-apimarketsync-historical)
  - [GET /api/market/bulk-update](#get-apimarketbulk-update)
- [3. Gold & Currency](#3-gold--currency)
  - [GET /api/market/gold](#get-apimarketgold)
  - [GET /api/market/gold/history](#get-apimarketgoldhistory)
  - [GET /api/market/currency](#get-apimarketcurrency)
- [4. Stocks](#4-stocks)
  - [GET /api/stocks](#get-apistocks)
  - [GET /api/stocks/:ticker](#get-apistocksticker)
  - [GET /api/stocks/:ticker/history](#get-apistockstickerhistory)
  - [GET /api/stocks/:ticker/recommendation](#get-apistockstickerrecommendation)
  - [GET /api/stocks/:ticker/news](#get-apistockstickernews)
  - [GET /api/stocks/:ticker/professional-analysis](#get-apistockstickerprofessional-analysis)
- [5. V2 Recommendation Engine](#5-v2-recommendation-engine)
  - [GET /api/v2/recommend](#get-apiv2recommend)
  - [POST /api/v2/recommend](#post-apiv2recommend)
  - [GET /api/v2/stock/:symbol/analysis](#get-apiv2stocksymbolanalysis)
- [6. V2 Feedback & Self-Learning](#6-v2-feedback--self-learning)
  - [POST /api/v2/feedback/run](#post-apiv2feedbackrun)
  - [POST /api/v2/feedback/backtest](#post-apiv2feedbackbacktest)
  - [GET /api/v2/feedback/predictions](#get-apiv2feedbackpredictions)
  - [GET /api/v2/feedback/status](#get-apiv2feedbackstatus)
- [7. V2 Admin Config](#7-v2-admin-config)
  - [GET /api/v2/admin/config](#get-apiv2adminconfig)
  - [POST /api/v2/admin/config](#post-apiv2adminconfig)
- [8. Admin Operations](#8-admin-operations)
  - [POST /api/admin/auth](#post-apiadminauth)
  - [POST /api/admin/recommendations](#post-apiadminrecommendations)
  - [GET /api/admin/gold](#get-apiadmingold)
  - [POST /api/admin/gold](#post-apiaadmintgold)
  - [GET /api/admin/currency](#get-apiadmincurrency)
  - [POST /api/admin/currency](#post-apiadmincurrency)
- [9. Export / Import](#9-export--import)
  - [GET /api/export](#get-apiexport)
  - [POST /api/import](#post-apiimport)
- [10. Proxy](#10-proxy)
  - [ANY /api/proxy/:path*](#any-apiproxypath)
- [11. Data Types](#11-data-types)

---

## Conventions

| Convention | Value |
|---|---|
| **SDK Required** | Endpoints using `z-ai-web-dev-sdk` are server-side only; mobile apps must call these via the server API (they are NOT callable directly from mobile). |
| **No SDK** | Endpoints reading from the local SQLite database are safe to call directly from mobile. |
| **Admin Required** | Some endpoints require an admin password in the request body. |
| **Caching** | Several endpoints use in-memory caches with TTLs (15 min, 30 min). |
| **Response Format** | All responses are JSON. CSV exports return `text/csv` with UTF-8 BOM for Arabic support. |
| **Language** | Arabic (اللغة العربية) descriptions alongside English. UI text is RTL-ready. |

### Endpoint Categories for Mobile

| Category | Call from Mobile? | Notes |
|---|---|---|
| Market Overview, Status, Indices | Yes | DB-based, no SDK |
| AI Insights / Recommendations | Yes | DB-based, no SDK |
| Live Data, Sync-Live | Yes (read-only) | Uses SDK server-side |
| Stock Details, History, Recommendation | Yes | DB-based |
| Stock News | Yes | Uses SDK server-side (cached 30 min) |
| Professional Analysis | Yes | DB-based calculations |
| V2 Recommend / Analysis | Yes | DB-based calculations |
| V2 Feedback / Backtest | Yes | DB-based |
| Admin endpoints | No | Requires admin password |
| Sync-Historical, Bulk-Update | No | Server-side batch operations |
| Export / Import | Yes | File-based |
| Proxy | No | Internal routing |

---

## 1. Authentication

### POST /api/auth/register

Register a new user with email, username, and password.
تسجيل مستخدم جديد بالبريد الإلكتروني واسم المستخدم وكلمة المرور.

**Mobile Safe:** Yes

**Request Body:**
```json
{
  "email": "user@example.com",
  "username": "myusername",
  "password": "securepass123",
  "risk_tolerance": "medium"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `email` | `string` | Yes | البريد الإلكتروني |
| `username` | `string` | Yes | اسم المستخدم (min 3 chars) |
| `password` | `string` | Yes | كلمة المرور (min 8 chars) |
| `risk_tolerance` | `string` | No | `low`, `medium`, `high` (default: `medium`) |

**Response (200):**
```json
{
  "success": true,
  "message": "تم إنشاء الحساب بنجاح",
  "user": {
    "id": "cm5abc123",
    "email": "user@example.com",
    "username": "myusername",
    "default_risk_tolerance": "medium"
  },
  "api_key": "egx_cm5abc123_1719000000000"
}
```

**Error Responses:**

| Status | Error | Description |
|---|---|---|
| 400 | `البريد الإلكتروني مطلوب` | Email missing |
| 400 | `اسم المستخدم مطلوب` | Username missing |
| 400 | `كلمة المرور مطلوبة` | Password missing |
| 400 | `اسم المستخدم يجب أن يكون 3 أحرف على الأقل` | Username too short |
| 400 | `كلمة المرور يجب أن تكون 8 أحرف على الأقل` | Password too short |
| 409 | `البريد الإلكتروني مستخدم بالفعل` | Email already registered |
| 409 | `اسم المستخدم مستخدم بالفعل` | Username taken |

---

### GET /api/auth/[...nextauth]

NextAuth handler — supports Google OAuth and Credentials (username/email + password) authentication.
مصادقة NextAuth — يدعم تسجيل الدخول بـ Google أو ببيانات الاعتماد.

**Mobile Safe:** Yes (via NextAuth API)

**Supported Providers:**
1. **Google OAuth** — uses `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` env vars
2. **Credentials** — `username_or_email` + `password`

**Credentials Sign-In:**
POST body:
```json
{
  "username_or_email": "user@example.com",
  "password": "securepass123"
}
```

**Session:** JWT-based, `maxAge: 30 days` (30 × 24 × 60 × 60 seconds)

**JWT Token Fields:**
```json
{
  "id": "cm5abc123",
  "email": "user@example.com",
  "name": "My Username",
  "image": null,
  "subscription_tier": "free",
  "default_risk_tolerance": "medium",
  "username": "myusername",
  "is_active": true
}
```

**Session Object Fields:**
```json
{
  "user": {
    "id": "cm5abc123",
    "email": "user@example.com",
    "name": "My Username",
    "image": null,
    "subscription_tier": "free",
    "default_risk_tolerance": "medium",
    "username": "myusername",
    "is_active": true
  },
  "expires": "2025-08-15T00:00:00.000Z"
}
```

**Error Responses:**

| Status | Description |
|---|---|
| 401 | Invalid credentials |
| null | User not found or inactive |

---

## 2. Market Data

### GET /api/market/overview

Get comprehensive market overview including market status, summary statistics, indices, and top movers.
الحصول على نظرة شاملة على السوق تشمل الحالة والإحصائيات والمؤشرات وأكثر الأسهم تذبذباً.

**Mobile Safe:** Yes | **No SDK**

**Query Parameters:** None

**Response (200):**
```json
{
  "market_status": {
    "is_open": false,
    "is_market_hours": false,
    "status": "closed",
    "current_session": "closed",
    "next_trading_window": {
      "message": "السوق مغلق - يفتح الأحد ١٠:٠٠ صباحاً بتوقيت القاهرة"
    },
    "next_open": null,
    "next_close": null
  },
  "summary": {
    "total_stocks": 250,
    "gainers": 85,
    "losers": 120,
    "unchanged": 45,
    "egx30_stocks": 30,
    "egx70_stocks": 70,
    "egx100_stocks": 100,
    "egx30_value": 0
  },
  "indices": [
    {
      "symbol": "EGX30",
      "name": "EGX 30 Price Index",
      "name_ar": "مؤشر EGX 30",
      "value": 25000.5,
      "previous_close": 24800.0,
      "change": 200.5,
      "change_percent": 0.81,
      "last_updated": "2025-01-15T14:30:00.000Z"
    }
  ],
  "top_gainers": [
    {
      "ticker": "COMI",
      "name": "Commercial International Bank",
      "name_ar": "البنك التجاري الدولي",
      "current_price": 85.5,
      "price_change": 4.2,
      "volume": 1500000,
      "value_traded": 128250000
    }
  ],
  "top_losers": [
    {
      "ticker": "ORWE",
      "name": "Orascom Construction",
      "name_ar": "أوراسكوم للإنشاءات",
      "current_price": 320.0,
      "price_change": -5.5,
      "volume": 800000,
      "value_traded": 256000000
    }
  ],
  "most_active": [
    {
      "ticker": "COMI",
      "name": "Commercial International Bank",
      "name_ar": "البنك التجاري الدولي",
      "current_price": 85.5,
      "price_change": 4.2,
      "volume": 5000000,
      "value_traded": 427500000
    }
  ],
  "last_updated": "2025-01-15T15:00:00.000Z"
}
```

**Error Responses:**

| Status | Description |
|---|---|
| 500 | `Failed to fetch market overview` |

---

### GET /api/market/status

Get current EGX market status with Cairo timezone awareness. EGX trading hours: Sunday–Thursday 10:00–14:30 Cairo time.
الحصول على حالة سوق البورصة المصرية الحالية بتوقيت القاهرة.

**Mobile Safe:** Yes | **No SDK**

**Query Parameters:** None

**Response (200):**
```json
{
  "is_market_hours": false,
  "status": "closed",
  "cairo_time": "01/15/2025, 18:30:45",
  "weekday": "Wed",
  "next_trading_window": "Current session is active",
  "minutes_until_open": null,
  "minutes_until_close": null,
  "market_hours": {
    "open": "10:00",
    "close": "14:30",
    "timezone": "Africa/Cairo",
    "trading_days": "Sunday - Thursday"
  },
  "checked_at": "2025-01-15T16:30:45.000Z"
}
```

**Status Values:** `open`, `pre_market`, `post_market`, `weekend`, `closed`

**Error Responses:**

| Status | Description |
|---|---|
| 500 | `Failed to fetch market status` |

---

### GET /api/market/indices

Get all EGX market indices with their values, changes, and percentages.
الحصول على جميع مؤشرات سوق البورصة المصرية.

**Mobile Safe:** Yes | **No SDK**

**Query Parameters:** None

**Response (200):**
```json
{
  "indices": [
    {
      "symbol": "EGX30",
      "name": "EGX 30 Price Index",
      "name_ar": "مؤشر EGX 30",
      "value": 25000.5,
      "previous_close": 24800.0,
      "change": 200.5,
      "change_percent": 0.81,
      "last_updated": "2025-01-15T14:30:00.000Z"
    },
    {
      "symbol": "EGX70",
      "name": "EGX 70 Price Index",
      "name_ar": "مؤشر EGX 70",
      "value": 6500.0,
      "previous_close": 6480.0,
      "change": 20.0,
      "change_percent": 0.31,
      "last_updated": "2025-01-15T14:30:00.000Z"
    },
    {
      "symbol": "EGX100",
      "name": "EGX 100 Price Index",
      "name_ar": "مؤشر EGX 100",
      "value": 8200.0,
      "previous_close": 8150.0,
      "change": 50.0,
      "change_percent": 0.61,
      "last_updated": "2025-01-15T14:30:00.000Z"
    },
    {
      "symbol": "EGXEWI",
      "name": "EGX Equal Weighted Index",
      "name_ar": "مؤشر EGX المتساوي الأوزان",
      "value": 5800.0,
      "previous_close": 5780.0,
      "change": 20.0,
      "change_percent": 0.35,
      "last_updated": "2025-01-15T14:30:00.000Z"
    },
    {
      "symbol": "EGXHDG",
      "name": "EGX Hedged Index",
      "name_ar": "مؤشر EGX التحصيصي",
      "value": 12000.0,
      "previous_close": 11950.0,
      "change": 50.0,
      "change_percent": 0.42,
      "last_updated": "2025-01-15T14:30:00.000Z"
    }
  ],
  "total": 5
}
```

**Error Responses:**

| Status | Description |
|---|---|
| 500 | `Failed to fetch market indices` |

---

### GET /api/market/live-data

Fetch live stock data from external sources (Mubasher Misr, web search fallback). Results are cached for 15 minutes.
جلب بيانات الأسهم الحية من مصادر خارجية (مباشر). يتم تخزين النتائج مؤقتاً لمدة 15 دقيقة.

**Mobile Safe:** Yes | **Uses SDK server-side**

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `no_cache` | `string` | `false` | Set to `true` to bypass cache |

**Response (200):**
```json
{
  "success": true,
  "source": "mubasher",
  "fetched_at": "2025-01-15T15:00:00.000Z",
  "data_count": 150,
  "stocks": [
    {
      "ticker": "COMI",
      "name_ar": "البنك التجاري الدولي",
      "current_price": 85.5,
      "change": 3.5,
      "change_percent": 4.27,
      "volume": 1500000,
      "last_updated": "2025-01-15T15:00:00.000Z"
    }
  ],
  "from_cache": false
}
```

**Notes:**
- If no live data is found, `stocks` will be empty and `message` will describe the issue
- Source can be: `mubasher`, `aseelawap`, `search-page`, `search-snippets`, `error`
- Data capped at 300 stocks

---

### GET /api/market/recommendations/ai-insights

Get AI-powered market insights including market sentiment, score, sector analysis, and per-stock statuses with fair value calculations.
الحصول على رؤى السوق المدعومة بالذكاء الاصطناعي.

**Mobile Safe:** Yes | **No SDK**

**Query Parameters:** None

**Response (200):**
```json
{
  "market_sentiment": "bullish",
  "market_score": 62.5,
  "market_breadth": 34.0,
  "avg_change_percent": -1.25,
  "volatility_index": 0.78,
  "gainers": 85,
  "losers": 120,
  "unchanged": 45,
  "top_sectors": [
    {
      "name": "Financials",
      "count": 45,
      "avg_change_percent": 1.25
    }
  ],
  "stock_statuses": [
    {
      "ticker": "COMI",
      "name": "Commercial International Bank",
      "name_ar": "البنك التجاري الدولي",
      "sector": "Financials",
      "current_price": 85.5,
      "price_change": 4.27,
      "volume": 1500000,
      "value_traded": 128250000,
      "score": 82.3,
      "status": "strong",
      "components": {
        "momentum": 75.0,
        "liquidity": 80.0,
        "valuation": 85.0,
        "income": 70.0,
        "traded_value": 78.0
      },
      "fair_value": 105.0,
      "upside_to_fair": 22.8,
      "verdict": "undervalued",
      "verdict_ar": "مقوم بأقل من قيمته"
    }
  ],
  "decision": "accumulate_selectively",
  "risk_assessment": "medium",
  "generated_at": "2025-01-15T15:00:00.000Z"
}
```

**Decision Values:** `accumulate_selectively`, `hold_and_rebalance`, `reduce_risk`

**Risk Assessment Values:** `low`, `medium`, `high`

**Status Values (per stock):** `strong`, `positive`, `neutral`, `weak`

**Verdict Values:** `undervalued` (مقوم بأقل من قيمته), `fair` (عادل التقييم), `overvalued` (مقوم بأكثر من قيمته)

---

### POST /api/market/sync-live

Fetch live data from external sources and update the database with matched stocks. This is a write operation.
جلب البيانات الحية من مصادر خارجية وتحديث قاعدة البيانات.

**Mobile Safe:** No (write operation) | **Uses SDK server-side**

**Request Body:** None (empty JSON `{}`)

**Response (200):**
```json
{
  "success": true,
  "source": "mubasher",
  "fetched_at": "2025-01-15T15:00:00.000Z",
  "data_count": 150,
  "matched_count": 120,
  "updated_count": 85,
  "skipped_count": 35,
  "price_history_inserted": 60,
  "price_history_skipped": 25,
  "details": {
    "updated_tickers": ["COMI", "ORWE", "OCIC"],
    "skipped_tickers": ["TICK1", "TICK2"],
    "errors": []
  }
}
```

---

### POST /api/market/sync-historical

Sync historical price data from Mubasher for specified (or all) stocks. Maximum 20 tickers per request with 2-second rate limiting.
مزامنة البيانات التاريخية من موقع مباشر. الحد الأقصى 20 سهم لكل طلب.

**Mobile Safe:** No (batch write operation)

**Request Body:**
```json
{
  "tickers": ["COMI", "ORWE", "OCIC"]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `tickers` | `string[]` | No | If omitted, all active stocks are processed |

**Response (200):**
```json
{
  "success": true,
  "message": "تم تحديث 45 سجل تاريخي و 3 سهم بنجاح",
  "fetched_at": "2025-01-15T15:00:00.000Z",
  "requested_tickers": 3,
  "processed_tickers": 3,
  "total_price_history_inserted": 45,
  "total_price_history_skipped": 10,
  "total_stocks_updated": 3,
  "details": {
    "results": [
      {
        "ticker": "COMI",
        "stock_id": 1,
        "success": true,
        "current_data_updated": true,
        "price_history_inserted": 15,
        "price_history_skipped": 3,
        "historical_from_page": 18
      }
    ],
    "updated_tickers": ["COMI", "ORWE", "OCIC"],
    "failed_tickers": [],
    "errors": []
  }
}
```

**Error Responses:**

| Status | Description |
|---|---|
| 400 | `عدد الأسهم المطلوب يتجاوز الحد الأقصى (20)` — too many tickers |

---

### GET /api/market/bulk-update

Process a batch of stocks for bulk price update from Mubasher. Batch size is 20 stocks per request. Only one batch can run at a time.
تحديث مجمع لأسعار الأسهم على دفعات. حجم الدفعة 20 سهم.

**Mobile Safe:** No (long-running operation)

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `batch` | `number` | `1` | Batch number (1-indexed) |
| `refresh` | `string` | `false` | Set to `true` to bypass cache |

**Response (200):**
```json
{
  "success": true,
  "message": "تمت معالجة الدفعة 1/13: 15 محدث، 3 بدون تغيير، 2 فشل",
  "started_at": "2025-01-15T15:00:00.000Z",
  "completed_at": "2025-01-15T15:01:00.000Z",
  "is_running": false,
  "total_stocks": 250,
  "processed_stocks": 20,
  "batch_number": 1,
  "batch_size": 20,
  "total_batches": 13,
  "summary": {
    "price_updated": 15,
    "price_unchanged": 3,
    "failed": 2,
    "total_history_inserted": 100,
    "total_history_skipped": 50
  },
  "results": [
    {
      "ticker": "COMI",
      "stock_id": 1,
      "success": true,
      "current_price": 85.5,
      "previous_price": 82.0,
      "price_changed": true,
      "history_inserted": 8,
      "history_skipped": 2
    }
  ],
  "errors": ["TICK_X: فشل في جلب بيانات السهم من الموقع"]
}
```

**Error Responses:**

| Status | Description |
|---|---|
| 429 | `يوجد تحديث جارٍ بالفعل` — another bulk update is running |
| 400 | Invalid batch number |

---

## 3. Gold & Currency

### GET /api/market/gold

Get gold (24K, 21K, 18K) and silver prices from the database. Admin updates prices via /api/admin/gold.
الحصول على أسعار الذهب (عيار 24، 21، 18) والفضة من قاعدة البيانات.

**Mobile Safe:** Yes | **No SDK**

**Query Parameters:** None

**Response (200):**
```json
{
  "success": true,
  "source": "database",
  "fetched_at": "2025-01-15T15:00:00.000Z",
  "last_updated": "2025-01-15T12:00:00.000Z",
  "prices": {
    "karat_24": {
      "price_per_gram": 3500.0,
      "change": 15.0,
      "currency": "EGP",
      "name_ar": "عيار 24"
    },
    "karat_21": {
      "price_per_gram": 3062.5,
      "change": 13.1,
      "currency": "EGP",
      "name_ar": "عيار 21"
    },
    "karat_18": {
      "price_per_gram": 2625.0,
      "change": 11.25,
      "currency": "EGP",
      "name_ar": "عيار 18"
    },
    "ounce": {
      "price": 2650.0,
      "change": 10.5,
      "currency": "USD",
      "name_ar": "الأونصة"
    },
    "silver": {
      "price_per_gram": 42.5,
      "change": 0.5,
      "currency": "EGP",
      "name_ar": "فضة"
    },
    "silver_ounce": {
      "price": 30.0,
      "change": 0.2,
      "currency": "USD",
      "name_ar": "أونصة فضة"
    }
  }
}
```

---

### GET /api/market/gold/history

Get historical gold price data for a specific karat.
الحصول على البيانات التاريخية لأسعار الذهب لعيار محدد.

**Mobile Safe:** Yes | **No SDK**

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `karat` | `string` | `24` | Karat type: `24`, `21`, `18`, `ounce` |
| `days` | `number` | `30` | Number of days (1–365) |

**Response (200):**
```json
{
  "success": true,
  "karat": "24",
  "days": 30,
  "count": 22,
  "data": [
    {
      "date": "2025-01-15 10:30:00",
      "price": 3500.0,
      "change": 15.0,
      "currency": "EGP"
    },
    {
      "date": "2025-01-14 11:00:00",
      "price": 3485.0,
      "change": 5.0,
      "currency": "EGP"
    }
  ]
}
```

---

### GET /api/market/currency

Get currency exchange rates from the database. Admin updates rates via /api/admin/currency.
الحصول على أسعار صرف العملات من قاعدة البيانات.

**Mobile Safe:** Yes | **No SDK**

**Query Parameters:** None

**Response (200):**
```json
{
  "success": true,
  "source": "database",
  "fetched_at": "2025-01-15T15:00:00.000Z",
  "last_updated": "2025-01-15T12:00:00.000Z",
  "central_bank_rate": 50.5,
  "currencies": [
    {
      "code": "USD",
      "name_ar": "دولار أمريكي",
      "buy_rate": 50.25,
      "sell_rate": 50.75,
      "change": 0.15,
      "is_major": true,
      "last_updated": "2025-01-15T12:00:00.000Z"
    },
    {
      "code": "EUR",
      "name_ar": "يورو",
      "buy_rate": 54.0,
      "sell_rate": 54.8,
      "change": -0.1,
      "is_major": true,
      "last_updated": "2025-01-15T12:00:00.000Z"
    },
    {
      "code": "GBP",
      "name_ar": "جنيه إسترليني",
      "buy_rate": 63.0,
      "sell_rate": 64.0,
      "change": 0.25,
      "is_major": true,
      "last_updated": "2025-01-15T12:00:00.000Z"
    }
  ]
}
```

---

## 4. Stocks

### GET /api/stocks

List all stocks with pagination, search, and filtering.
عرض جميع الأسهم مع التصفح والبحث والفلترة.

**Mobile Safe:** Yes | **No SDK**

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `query` | `string` | — | Search by ticker, name, or Arabic name |
| `sector` | `string` | — | Filter by sector |
| `index` | `string` | — | Filter by index: `egx30`, `egx70`, `egx100` |
| `page` | `number` | `1` | Page number |
| `page_size` | `number` | `20` | Items per page (max 500) |

**Response (200):**
```json
{
  "stocks": [
    {
      "id": 1,
      "ticker": "COMI",
      "name": "Commercial International Bank",
      "name_ar": "البنك التجاري الدولي",
      "sector": "Financials",
      "industry": null,
      "current_price": 85.5,
      "previous_close": 82.0,
      "open_price": 83.0,
      "high_price": 86.0,
      "low_price": 82.5,
      "volume": 1500000,
      "market_cap": 170000000000,
      "pe_ratio": 12.5,
      "pb_ratio": 3.2,
      "dividend_yield": 4.5,
      "eps": 6.84,
      "roe": 22.5,
      "debt_to_equity": 0.5,
      "support_level": 78.0,
      "resistance_level": 92.0,
      "ma_50": 80.0,
      "ma_200": 75.0,
      "rsi": 65.0,
      "egx30_member": 1,
      "egx70_member": 1,
      "egx100_member": 1,
      "is_active": 1,
      "is_egx": 1,
      "last_update": "2025-01-15T14:30:00.000Z",
      "price_change": 4.27,
      "value_traded": 128250000
    }
  ],
  "total": 250,
  "page": 1,
  "page_size": 20,
  "total_pages": 13
}
```

---

### GET /api/stocks/:ticker

Get detailed information for a single stock by ticker symbol.
الحصول على معلومات تفصيلية لسهم واحد بالرمز.

**Mobile Safe:** Yes | **No SDK**

**URL Parameters:**

| Param | Type | Description |
|---|---|---|
| `ticker` | `string` | Stock ticker symbol (case-insensitive, e.g., `COMI`) |

**Response (200):**
```json
{
  "data": {
    "id": 1,
    "ticker": "COMI",
    "name": "Commercial International Bank",
    "name_ar": "البنك التجاري الدولي",
    "sector": "Financials",
    "current_price": 85.5,
    "previous_close": 82.0,
    "price_change": 4.27,
    "volume": 1500000,
    "market_cap": 170000000000,
    "pe_ratio": 12.5,
    "pb_ratio": 3.2,
    "dividend_yield": 4.5,
    "eps": 6.84,
    "roe": 22.5,
    "value_traded": 128250000
  }
}
```

**Error Responses:**

| Status | Description |
|---|---|
| 404 | `Stock not found` — No stock with given ticker |

---

### GET /api/stocks/:ticker/history

Get price history for a stock (OHLCV data) with summary statistics.
الحصول على السجل التاريخي لأسعار سهم (بيانات OHLCV).

**Mobile Safe:** Yes | **No SDK**

**URL Parameters:**

| Param | Type | Description |
|---|---|---|
| `ticker` | `string` | Stock ticker symbol |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `days` | `number` | `90` | Number of days of history |

**Response (200):**
```json
{
  "success": true,
  "ticker": "COMI",
  "data": [
    {
      "date": "2024-10-15",
      "open": 80.0,
      "high": 82.0,
      "low": 79.5,
      "close": 81.0,
      "volume": 1200000
    },
    {
      "date": "2024-10-16",
      "open": 81.0,
      "high": 83.0,
      "low": 80.5,
      "close": 82.5,
      "volume": 1100000
    }
  ],
  "summary": {
    "highest": 86.0,
    "lowest": 78.0,
    "avg_price": 82.5,
    "total_volume": 25000000,
    "start_price": 80.0,
    "end_price": 85.5,
    "change_percent": 6.88
  },
  "days": 90
}
```

---

### GET /api/stocks/:ticker/recommendation

Get AI-powered stock recommendation with technical analysis, scores, trend, and professional analysis.
الحصول على توصية السهم المدعومة بالذكاء الاصطناعي مع التحليل الفني والنتائج.

**Mobile Safe:** Yes | **No SDK** (calculations only)

**URL Parameters:**

| Param | Type | Description |
|---|---|---|
| `ticker` | `string` | Stock ticker symbol |

**Response (200):**
```json
{
  "ticker": "COMI",
  "stock_name": "Commercial International Bank",
  "stock_name_ar": "البنك التجاري الدولي",
  "recommendation": {
    "action": "buy",
    "action_ar": "شراء",
    "confidence": 0.72
  },
  "scores": {
    "total_score": 72,
    "technical_score": 68,
    "fundamental_score": 75,
    "momentum_score": 70,
    "risk_score": 35,
    "risk_adjusted_score": 65,
    "market_context_score": 60,
    "consensus_ratio": 70
  },
  "trend": {
    "direction": "bullish",
    "direction_ar": "صعودي"
  },
  "price_range": {
    "support": 78.0,
    "resistance": 92.0
  },
  "target_price": 95.0,
  "key_strengths": [
    { "title": "Strong ROE", "title_ar": "عائد على حقوق ملكية قوي" }
  ],
  "key_risks": [
    { "title": "Market volatility", "title_ar": "تذبذب السوق" }
  ],
  "professional_analysis": {
    "recommendation": "buy",
    "confidence": 75,
    "technical_signals": { ... },
    "fundamental_data": { ... },
    "entry_price": 83.0,
    "stop_loss": 76.0,
    "target_price": 95.0
  }
}
```

**Default Analysis (when no snapshot exists):**
If no deep insight snapshot is found, returns a default analysis with:
- `action: "hold"`, `action_ar: "احتفاظ"`, `confidence: 0.5`
- All scores at 50
- Note: `"Default analysis - no deep insight snapshot available"`

---

### GET /api/stocks/:ticker/news

Get stock-related news from web search with sentiment analysis. Results are cached for 30 minutes.
الحصول على أخبار السهم مع تحليل المشاعر. يتم تخزين النتائج مؤقتاً لمدة 30 دقيقة.

**Mobile Safe:** Yes | **Uses SDK server-side**

**URL Parameters:**

| Param | Type | Description |
|---|---|---|
| `ticker` | `string` | Stock ticker symbol |

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | `number` | `10` | Number of news items (1–20) |

**Response (200):**
```json
{
  "success": true,
  "ticker": "COMI",
  "stock_name_ar": "البنك التجاري الدولي",
  "news": [
    {
      "title": "ارتفاع أرباح البنك التجاري الدولي 15%",
      "title_ar": "ارتفاع أرباح البنك التجاري الدولي 15%",
      "source": "mubasher.info",
      "url": "https://www.mubasher.info/.../news-123",
      "published_at": "2025-01-14T10:00:00.000Z",
      "summary": "ارتفاع أرباح البنك التجاري الدولي بنسبة 15% في الربع الرابع...",
      "summary_ar": "ارتفاع أرباح البنك التجاري الدولي بنسبة 15% في الربع الرابع...",
      "sentiment": "positive",
      "sentiment_score": 0.75,
      "relevance_score": 0.95,
      "categories": ["earnings", "financials"]
    }
  ],
  "overall_sentiment": {
    "score": 0.35,
    "label": "positive",
    "label_ar": "إيجابي",
    "confidence": 0.8
  },
  "total_news": 8,
  "fetched_at": "2025-01-15T15:00:00.000Z"
}
```

**Sentiment Labels:** `positive`, `negative`, `neutral`

**News Categories:** `earnings`, `technical`, `sector`, `regulatory`, `dividend`, `ipo`, `indices`, `economy`, `partnership`, `general`

---

### GET /api/stocks/:ticker/professional-analysis

Get comprehensive professional analysis merging technical indicators with existing AI insight snapshot. Requires at least 5 days of price history.
الحصول على تحليل احترافي شامل يجمع بين المؤشرات الفنية وتحليل الذكاء الاصطناعي.

**Mobile Safe:** Yes | **No SDK**

**URL Parameters:**

| Param | Type | Description |
|---|---|---|
| `ticker` | `string` | Stock ticker symbol |

**Response (200):**
```json
{
  "success": true,
  "ticker": "COMI",
  "stock": {
    "ticker": "COMI",
    "name": "Commercial International Bank",
    "name_ar": "البنك التجاري الدولي",
    "sector": "Financials",
    "current_price": 85.5,
    "previous_close": 82.0,
    "price_change": 4.27,
    "volume": 1500000,
    "market_cap": 170000000000,
    "investment_type": "stock",
    "is_halal": 1,
    "egx30_member": 1,
    "egx70_member": 1,
    "egx100_member": 1
  },
  "professional": {
    "recommendation": "buy",
    "confidence": 75,
    "entry_price": 83.0,
    "stop_loss": 76.0,
    "target_price": 95.0,
    "technical_signals": { ... },
    "fundamental_data": { ... }
  },
  "ai_insight": {
    "recommendation": { "action": "buy", "confidence": 0.72 },
    "scores": { "total_score": 72, ... },
    "trend": { "direction": "bullish" },
    "probabilities": { ... },
    "technical_indicators": { ... },
    "execution_plan": { ... },
    "scenarios": { ... },
    "key_strengths": [ ... ],
    "key_risks": [ ... ],
    "decision_basis_ar": "...",
    "history_summary": { ... },
    "fetched_at": "2025-01-15T10:00:00.000Z"
  },
  "generated_at": "2025-01-15T15:00:00.000Z"
}
```

**Error Responses:**

| Status | Description |
|---|---|
| 404 | `Stock not found` |
| 422 | `Insufficient data` — less than 5 days of price history |

---

## 5. V2 Recommendation Engine

The V2 engine is a **pure calculation system** (no AI SDK dependency) using a 4-layer analysis:
1. **Safety Filter** — hard/soft rules to eliminate risky stocks
2. **Quality Scoring** — profitability, growth, safety, efficiency, valuation
3. **Momentum Analysis** — trend, support/resistance, signal confluence
4. **Fair Value** — Graham Number, P/E-based, DCF-light estimation

محرك التوصيات V2 — نظام حسابي نقي (4 طبقات) بدون اعتماد على الذكاء الاصطناعي.

### GET /api/v2/recommend

Get quick recommendations with default parameters (top 100 stocks).
الحصول على توصيات سريعة بالمعاملات الافتراضية.

**Mobile Safe:** Yes | **No SDK**

**Query Parameters:** None

**Response (200):**
```json
{
  "market": {
    "regime": "bull",
    "regimeMultiplier": 1.1,
    "sectorAverages": [
      {
        "sector": "Financials",
        "avgPE": 12.5,
        "avgPB": 2.8,
        "avgROE": 18.0,
        "avgDebtEquity": 1.2,
        "avgDividendYield": 5.0,
        "stockCount": 45
      }
    ],
    "fearCashPercent": 10,
    "totalStocksAnalyzed": 200,
    "passedSafetyFilter": 120,
    "recommendations": {
      "strongBuy": 15,
      "buy": 30,
      "hold": 50,
      "avoid": 20,
      "strongAvoid": 5
    }
  },
  "stocks": [
    {
      "ticker": "COMI",
      "name": "Commercial International Bank",
      "nameAr": "البنك التجاري الدولي",
      "sector": "Financials",
      "currentPrice": 85.5,
      "previousClose": 82.0,
      "safetyPassed": true,
      "violations": [],
      "redFlags": [],
      "qualityScore": {
        "total": 78,
        "profitability": { "score": 80, "roeVsSector": 1.2, "details": "..." },
        "growth": { "score": 72, "revenueCAGR": 12.0, "earningsCAGR": 15.0, "details": "..." },
        "safety": { "score": 85, "currentRatio": 1.8, "debtEquity": 0.5, "details": "..." },
        "efficiency": { "score": 70, "assetTurnover": 0.35, "details": "..." },
        "valuation": { "score": 75, "peVsSector": 1.0, "dividendYield": 4.5, "details": "..." }
      },
      "momentumScore": {
        "score": 72,
        "trendScore": {
          "score": 75,
          "weeklyMACDBullish": true,
          "dailyAbove50EMA": true,
          "dailyAbove200EMA": true,
          "rsiSweetSpot": true,
          "volumeAboveAvg": false,
          "details": "..."
        },
        "supportResistance": {
          "strongSupport": 78.0,
          "strongResistance": 95.0,
          "positionPercent": 45.0,
          "zone": "accumulation",
          "zoneAr": "منطقة تراكم"
        },
        "signalConfluence": {
          "qualityAligned": true,
          "technicalAligned": true,
          "volumeAligned": false,
          "alignedCount": 2,
          "requiredCount": 2,
          "allAligned": false
        },
        "volumeConfirm": false
      },
      "fairValue": {
        "grahamNumber": 92.5,
        "peBased": 88.0,
        "dcfLight": 85.0,
        "averageFairValue": 88.5,
        "upsidePotential": 3.5,
        "verdict": "fair",
        "verdictAr": "عادل التقييم",
        "details": {
          "eps": 6.84,
          "bookValuePerShare": 26.7,
          "growthRate": 10.0,
          "sectorTargetPE": 12.5,
          "riskFreeRate": 15.0,
          "marginOfSafety": 0.15
        }
      },
      "compositeScore": 76,
      "recommendation": "Buy",
      "recommendationAr": "شراء",
      "confidence": 72,
      "entryPrice": 83.0,
      "entryStrategy": {
        "immediateBuy": 100,
        "dipBuyPercent": 15,
        "dipBuyLevel": 72.0,
        "cashReserve": 10
      },
      "exitStrategy": {
        "targetPrice": 95.0,
        "stopLoss": 76.0,
        "timeHorizonMonths": 6
      },
      "positionSizing": {
        "kellyPercent": 15,
        "adjustedPercent": 10,
        "percentOfPortfolio": 8,
        "amountEGP": 80000,
        "sharesCount": 936,
        "maxRiskPerStock": 2
      },
      "riskAssessment": {
        "level": "Medium",
        "levelAr": "متوسط",
        "maxExpectedDrawdown": -12,
        "keyRisks": ["Market volatility", "Interest rate changes"]
      },
      "marketRegime": "bull",
      "analysisVersion": "2.0.0"
    }
  ],
  "generatedAt": "2025-01-15T15:00:00.000Z",
  "analysisVersion": "2.0.0"
}
```

---

### POST /api/v2/recommend

Generate personalized recommendations with investment parameters. Automatically logs predictions for the self-learning feedback loop.
إنشاء توصيات مخصصة بناءً على معاملات الاستثمار.

**Mobile Safe:** Yes | **No SDK**

**Request Body:**
```json
{
  "capital": 1000000,
  "timeHorizon": "6-12 months",
  "incomeStability": "stable",
  "age": 30,
  "sector": "Financials",
  "limit": 20
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `capital` | `number` | No | رأس المال المتاح (EGP) |
| `timeHorizon` / `time_horizon` | `string` | No | الأفق الزمني (e.g., "3-6 months", "1-3 years") |
| `incomeStability` / `income_stability` | `string` | No | استقرار الدخل: `stable`, `variable` |
| `age` | `number` | No | العمر |
| `sector` | `string` | No | القطاع المفضل |
| `limit` | `number` | No | Maximum number of recommendations |

**Response:** Same shape as GET `/api/v2/recommend`

---

### GET /api/v2/stock/:symbol/analysis

Deep single-stock analysis using the V2 4-layer engine. Clears config cache before analysis.
تحليل عميق لسهم واحد باستخدام محرك V2 (4 طبقات).

**Mobile Safe:** Yes | **No SDK**

**URL Parameters:**

| Param | Type | Description |
|---|---|---|
| `symbol` | `string` | Stock ticker (case-insensitive, auto-uppercased) |

**Response (200):** Same shape as a single `StockRecommendation` object from `/api/v2/recommend`

```json
{
  "ticker": "COMI",
  "name": "Commercial International Bank",
  "nameAr": "البنك التجاري الدولي",
  "sector": "Financials",
  "currentPrice": 85.5,
  "previousClose": 82.0,
  "safetyPassed": true,
  "violations": [],
  "redFlags": [],
  "qualityScore": { ... },
  "momentumScore": { ... },
  "fairValue": { ... },
  "compositeScore": 76,
  "recommendation": "Buy",
  "recommendationAr": "شراء",
  "confidence": 72,
  "entryPrice": 83.0,
  "entryStrategy": { ... },
  "exitStrategy": { ... },
  "positionSizing": { ... },
  "riskAssessment": { ... },
  "marketRegime": "bull",
  "analysisVersion": "2.0.0"
}
```

**Error Responses:**

| Status | Description |
|---|---|
| 404 | `Stock not found` |
| 422 | `Analysis failed` — insufficient data |

---

## 6. V2 Feedback & Self-Learning

The feedback loop validates past predictions, calculates accuracy, and auto-tunes weight parameters.
حلقة التغذية الراجعة — تتحقق من التنبؤات السابقة وتحسب الدقة وتعدّل الأوزان تلقائياً.

### POST /api/v2/feedback/run

Run the feedback loop to validate predictions and optionally run historical backtesting.
تشغيل حلقة التغذية الراجعة للتحقق من التنبؤات.

**Mobile Safe:** Yes | **No SDK**

**Request Body:**
```json
{
  "run_backtest": false
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `run_backtest` | `boolean` | No | Whether to also run historical backtesting |

**Response (200):**
```json
{
  "success": true,
  "timestamp": "2025-01-15T15:00:00.000Z",
  "predictions_validated": 45,
  "accuracy_summary": {
    "correct": 32,
    "incorrect": 13,
    "accuracy_percent": 71.1
  },
  "weight_adjustments": [
    {
      "parameter_name": "momentum_weight",
      "old_value": 0.30,
      "new_value": 0.32,
      "reason": "auto-tuned"
    }
  ],
  "backtest_results": {
    "total_stocks_tested": 200,
    "total_predictions_generated": 500,
    "accuracy_5d": 68.5,
    "accuracy_10d": 72.0,
    "accuracy_20d": 75.5,
    "by_sector": [
      { "sector": "Financials", "accuracy": 78.0, "count": 50 }
    ],
    "avg_quality_score_correct": 75.0,
    "avg_quality_score_incorrect": 55.0,
    "avg_momentum_score_correct": 70.0,
    "avg_momentum_score_incorrect": 48.0
  },
  "model_accuracy": {
    "overall": 71.1,
    "last_updated": "2025-01-15T15:00:00.000Z"
  },
  "message": "تم التحقق من 45 تنبؤ"
}
```

---

### POST /api/v2/feedback/backtest

Run historical backtesting — simulate predictions at past dates and validate against known actual prices. Seeds the prediction_logs table.
تشغيل الاختبار التاريخي — محاكاة التنبؤات في تواريخ سابقة والتحقق منها.

**Mobile Safe:** Yes | **No SDK**

**Request Body:**
```json
{
  "backtest_days": 60
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `backtest_days` | `number` | No | Days to look back (max 120, default 60) |

**Response (200):**
```json
{
  "success": true,
  "timestamp": "2025-01-15T15:00:00.000Z",
  "backtest": {
    "total_stocks_tested": 200,
    "total_predictions_generated": 500,
    "accuracy_5d": 68.5,
    "accuracy_10d": 72.0,
    "accuracy_20d": 75.5,
    "by_sector": [
      { "sector": "Financials", "accuracy": 78.0, "count": 50 }
    ],
    "avg_quality_score_correct": 75.0,
    "avg_quality_score_incorrect": 55.0,
    "avg_momentum_score_correct": 70.0,
    "avg_momentum_score_incorrect": 48.0
  },
  "message": "تم إنشاء 500 تنبؤ تاريخي من 200 سهم. الدقة: 5ي=68.5% | 10ي=72.0% | 20ي=75.5%"
}
```

---

### GET /api/v2/feedback/predictions

Get recent prediction logs with pagination.
الحصول على سجل التنبؤات الأخيرة مع التصفح.

**Mobile Safe:** Yes | **No SDK**

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | `number` | `50` | Max 200 |
| `offset` | `number` | `0` | Pagination offset |

**Response (200):**
```json
{
  "success": true,
  "count": 50,
  "predictions": [
    {
      "id": 1,
      "ticker": "COMI",
      "predicted_direction": "up",
      "actual_direction": "up",
      "is_correct": 1,
      "quality_score": 75,
      "momentum_score": 70,
      "predicted_at": "2025-01-10T10:00:00.000Z",
      "validated_at": "2025-01-15T10:00:00.000Z"
    }
  ]
}
```

---

### GET /api/v2/feedback/status

Get the current feedback loop status including accuracy metrics, prediction stats, model accuracy, and weight adjustment history.
الحصول على حالة حلقة التغذية الراجعة الحالية.

**Mobile Safe:** Yes | **No SDK**

**Query Parameters:** None

**Response (200):**
```json
{
  "success": true,
  "stats": {
    "total_predictions": 500,
    "validated_predictions": 300,
    "correct_predictions": 210,
    "accuracy_percent": 70.0
  },
  "model_accuracy": {
    "overall": 70.0,
    "last_updated": "2025-01-15T15:00:00.000Z"
  },
  "accuracy_history": [
    {
      "date": "2025-01-15",
      "accuracy": 70.0,
      "predictions_count": 50
    }
  ],
  "weight_adjustments": [
    {
      "parameter_name": "momentum_weight",
      "old_value": 0.30,
      "new_value": 0.32,
      "adjusted_by": "auto",
      "reason": "accuracy_improvement",
      "adjusted_at": "2025-01-15T12:00:00.000Z"
    }
  ]
}
```

---

## 7. V2 Admin Config

### GET /api/v2/admin/config

View current V2 engine configuration weights grouped by category, plus detected market regime.
عرض أوزان إعدادات محرك V2 الحالية مع نظام السوق المكتشف.

**Mobile Safe:** No (admin only)

**Response (200):**
```json
{
  "weights": [
    {
      "parameter_name": "momentum_weight",
      "display_name": "Momentum Weight",
      "current_value": 0.30,
      "default_value": 0.25,
      "min_value": 0.05,
      "max_value": 0.50,
      "parameter_group": "scoring",
      "description": "Weight assigned to momentum signals"
    }
  ],
  "groups": {
    "scoring": [ ... ],
    "safety": [ ... ],
    "valuation": [ ... ]
  },
  "regime": {
    "type": "bull",
    "multiplier": 1.1,
    "description": "Market is in bullish regime"
  },
  "totalParameters": 25
}
```

---

### POST /api/v2/admin/config

Update a configuration weight with circuit breaker protection (max ±20% change per update).
تحديث وزن إعدادي مع حماية قاطع الدائرة (تغيير أقصى ±20%).

**Mobile Safe:** No (admin only)

**Request Body:**
```json
{
  "parameter_name": "momentum_weight",
  "new_value": 0.32,
  "reason": "Improved backtest accuracy with higher momentum"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `parameter_name` | `string` | Yes | Name of the parameter |
| `new_value` | `number` | Yes | New value |
| `reason` | `string` | No | Reason for the change |

**Response (200):**
```json
{
  "success": true,
  "message": "Updated momentum_weight to 0.32",
  "weight": {
    "parameter_name": "momentum_weight",
    "current_value": 0.32
  }
}
```

**Error Responses:**

| Status | Description |
|---|---|
| 400 | Missing required fields |
| 422 | Update failed — circuit breaker limit exceeded or parameter not found |

---

## 8. Admin Operations

All admin endpoints require an `admin_password` field in the request body.
جميع نقاط نهاية الإدارة تتطلب كلمة مرور المسؤول.

### POST /api/admin/auth

Verify admin password for protected admin operations.
التحقق من كلمة مرور المسؤول.

**Mobile Safe:** No (admin only)

**Request Body:**
```json
{
  "password": "your_admin_password"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "تم التحقق بنجاح",
  "token": "admin_session_1719000000000"
}
```

**Error Responses:**

| Status | Description |
|---|---|
| 400 | `كلمة المرور مطلوبة` — password missing |
| 401 | `كلمة المرور غير صحيحة` — incorrect password |

---

### POST /api/admin/recommendations

Import adjusted recommendations (admin only, password required). Updates the `stock_deep_insight_snapshots` table via `json_set`.
استيراد التوصيات المعدلة (للمسؤول فقط).

**Mobile Safe:** No (admin only)

**Request Body:**
```json
{
  "password": "your_admin_password",
  "recommendations": [
    {
      "ticker": "COMI",
      "recommendation_action": "strong_buy",
      "recommendation_ar": "شراء قوي",
      "confidence_score": 85,
      "total_score": 82,
      "technical_score": 78,
      "fundamental_score": 85,
      "risk_score": 25,
      "trend_direction": "bullish",
      "target_price": 100.0,
      "stop_loss": 76.0,
      "entry_price": 83.0,
      "time_horizon": "6 months",
      "news_sentiment": "positive",
      "news_impact": "high",
      "notes": "Strong Q4 results"
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `password` | `string` | Yes | Admin password |
| `recommendations` | `array` | Yes | Array of recommendation objects |
| `recommendations[].ticker` | `string` | Yes | Stock ticker (mandatory) |
| `recommendations[].recommendation_action` | `string` | No | Valid values: `strong_buy`, `buy`, `accumulate`, `hold`, `sell`, `strong_sell` |
| `recommendations[].recommendation_ar` | `string` | No | Arabic action label |
| `recommendations[].confidence_score` | `number` | No | 0–100 |
| `recommendations[].total_score` | `number` | No | 0–100 |
| `recommendations[].technical_score` | `number` | No | 0–100 |
| `recommendations[].fundamental_score` | `number` | No | 0–100 |
| `recommendations[].risk_score` | `number` | No | 0–100 |
| `recommendations[].trend_direction` | `string` | No | `bullish`, `bearish`, `neutral`, `sideways` |
| `recommendations[].target_price` | `number` | No | Target price |
| `recommendations[].stop_loss` | `number` | No | Stop loss price |
| `recommendations[].entry_price` | `number` | No | Entry price |
| `recommendations[].time_horizon` | `string` | No | Time horizon |
| `recommendations[].news_sentiment` | `string` | No | News sentiment |
| `recommendations[].news_impact` | `string` | No | News impact level |
| `recommendations[].notes` | `string` | No | Admin notes |

**Response (200):**
```json
{
  "success": true,
  "message": "تم تحديث 3 توصية بنجاح",
  "updated_count": 3,
  "skipped_count": 0,
  "errors": [],
  "imported_at": "2025-01-15T15:00:00.000Z"
}
```

---

### GET /api/admin/gold

Get all gold prices (admin view with raw database metadata).
الحصول على جميع أسعار الذهب (عرض المسؤول).

**Mobile Safe:** No (admin only)

**Response (200):**
```json
{
  "success": true,
  "prices": [
    {
      "id": 1,
      "karat": "24",
      "price_per_gram": 3500.0,
      "change": 15.0,
      "currency": "EGP",
      "name_ar": "عيار 24",
      "updated_at": "2025-01-15T12:00:00.000Z",
      "updated_by": "admin"
    }
  ],
  "total": 6
}
```

---

### POST /api/admin/gold

Update gold prices (admin only, password required).
تحديث أسعار الذهب (للمسؤول فقط).

**Mobile Safe:** No (admin only)

**Request Body:**
```json
{
  "password": "your_admin_password",
  "prices": [
    { "karat": "24", "price_per_gram": 3550.0, "change": 50.0 },
    { "karat": "21", "price_per_gram": 3106.25, "change": 43.75 }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `password` | `string` | Yes | Admin password |
| `prices` | `array` | Yes | Array of price objects |
| `prices[].karat` | `string` | Yes | Karat identifier |
| `prices[].price_per_gram` | `number` | Yes | Must be > 0 |
| `prices[].change` | `number` | No | Price change |

**Response (200):**
```json
{
  "success": true,
  "message": "تم تحديث 2 سعر بنجاح",
  "updated_count": 2,
  "updated_at": "2025-01-15T15:00:00.000Z"
}
```

---

### GET /api/admin/currency

Get all currency rates (admin view with raw database metadata).
الحصول على جميع أسعار الصرف (عرض المسؤول).

**Mobile Safe:** No (admin only)

**Response (200):**
```json
{
  "success": true,
  "currencies": [
    {
      "id": 1,
      "code": "USD",
      "name_ar": "دولار أمريكي",
      "buy_rate": 50.25,
      "sell_rate": 50.75,
      "change": 0.15,
      "is_major": 1,
      "updated_at": "2025-01-15T12:00:00.000Z",
      "updated_by": "admin"
    }
  ],
  "total": 5
}
```

---

### POST /api/admin/currency

Update currency rates (admin only, password required).
تحديث أسعار الصرف (للمسؤول فقط).

**Mobile Safe:** No (admin only)

**Request Body:**
```json
{
  "password": "your_admin_password",
  "rates": [
    { "code": "USD", "buy_rate": 50.30, "sell_rate": 50.80, "change": 0.20 },
    { "code": "EUR", "buy_rate": 54.50, "sell_rate": 55.30, "change": 0.10 }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `password` | `string` | Yes | Admin password |
| `rates` | `array` | Yes | Array of rate objects |
| `rates[].code` | `string` | Yes | Currency code |
| `rates[].buy_rate` | `number` | Yes | Must be > 0 |
| `rates[].sell_rate` | `number` | Yes | Must be > 0 |
| `rates[].change` | `number` | No | Change amount |

**Response (200):**
```json
{
  "success": true,
  "message": "تم تحديث 2 عملة بنجاح",
  "updated_count": 2,
  "updated_at": "2025-01-15T15:00:00.000Z"
}
```

---

## 9. Export / Import

### GET /api/export

Export data in CSV or JSON format with Arabic support (UTF-8 BOM).
تصدير البيانات بصيغة CSV أو JSON مع دعم اللغة العربية.

**Mobile Safe:** Yes

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `type` | `string` | `stocks` | Export type (see below) |
| `format` | `string` | `csv` | `csv` or `json` |

**Export Types:**

| Type | Description | الوصف |
|---|---|---|
| `stocks` | All active stocks with full data | جميع الأسهم النشطة |
| `recommendations` | Stock recommendations summary | ملخص التوصيات |
| `ai-adjustment` | Comprehensive export for AI readjustment | ملف شامل لتعديل الذكاء الاصطناعي |
| `market-summary` | Market overview, indices, and sectors | ملخص السوق والمؤشرات والقطاعات |
| `watchlist` | User watchlist (requires auth) | قائمة المتابعة |
| `portfolio` | User portfolio (requires auth) | المحفظة |

**Response (CSV):**
- Content-Type: `text/csv; charset=utf-8`
- Content-Disposition: `attachment; filename="egx_{type}_{date}.csv"`
- UTF-8 BOM for Arabic text support

**Response (JSON):**
- Content-Type: `application/json`
- Content-Disposition: `attachment; filename="egx_{type}_{date}.json"`

**Example JSON response for `type=stocks`:**
```json
{
  "export_type": "stocks",
  "export_date": "2025-01-15",
  "total_records": 250,
  "stocks": [
    {
      "ticker": "COMI",
      "name": "Commercial International Bank",
      "name_ar": "البنك التجاري الدولي",
      "sector": "Financials",
      "current_price": 85.5,
      "price_change": 4.27,
      "volume": 1500000,
      "market_cap": 170000000000,
      "pe_ratio": 12.5,
      "pb_ratio": 3.2,
      "dividend_yield": 4.5,
      "eps": 6.84,
      "roe": 22.5,
      "debt_to_equity": 0.5,
      "rsi": 65.0,
      "ma_50": 80.0,
      "ma_200": 75.0,
      "support_level": 78.0,
      "resistance_level": 92.0,
      "egx30_member": "نعم",
      "egx70_member": "نعم",
      "egx100_member": "نعم"
    }
  ]
}
```

**AI-Adjustment Export** includes special fields for AI readjustment:
- `valid_actions`: `strong_buy`, `buy`, `accumulate`, `hold`, `sell`, `strong_sell`
- `valid_actions_ar`: `شراء قوي`, `شراء`, `تراكم`, `احتفاظ`, `بيع`, `بيع قوي`
- `instructions_en` and `instructions_ar`: guidance for AI to modify and re-import

---

### POST /api/import

Import data from CSV or JSON file uploads. Supports multipart/form-data.
استيراد البيانات من ملفات CSV أو JSON.

**Mobile Safe:** Yes

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | `File` | Yes | File to import (`.csv` or `.json`) |
| `type` | `string` | Yes | Import type: `stocks` or `watchlist` |

**Response (200):**
```json
{
  "success": true,
  "type": "stocks",
  "file_name": "stocks_import.csv",
  "file_size": 45678,
  "format": "csv",
  "total_rows": 250,
  "valid_rows": 245,
  "invalid_rows": 5,
  "columns": ["ticker", "name", "name_ar", "sector", "current_price"],
  "records": [
    {
      "ticker": "COMI",
      "name": "Commercial International Bank",
      "name_ar": "البنك التجاري الدولي"
    }
  ],
  "message": "تم تحليل 245 سجل بنجاح"
}
```

**Error Responses:**

| Status | Error (Arabic) | Description |
|---|---|---|
| 400 | `لم يتم اختيار ملف` | No file provided |
| 400 | `نوع الاستيراد غير صالح` | Invalid type (must be `stocks` or `watchlist`) |
| 400 | `صيغة الملف غير مدعومة` | Unsupported format (must be `.csv` or `.json`) |

---

## 10. Proxy

### ANY /api/proxy/:path*

Proxy all HTTP methods (GET, POST, PUT, DELETE, PATCH, OPTIONS) to the Python backend at `http://127.0.0.1:8100`.
وكيل لجميع طرق HTTP إلى الخادم الخلفي.

**Mobile Safe:** No (internal routing)

**URL Parameters:**

| Param | Type | Description |
|---|---|---|
| `path*` | `string` | Path segments to forward (e.g., `stocks/COMI`) |

**Headers:**
- Automatically includes `X-API-Key` header
- Forwards `Content-Type`, `Accept`, `Authorization` headers
- Adds CORS headers: `Access-Control-Allow-Origin: *`

**Notes:**
- Backend URL: `http://127.0.0.1:8100`
- All methods are supported
- Returns 502 if backend is unavailable

---

## 11. Data Types

### TypeScript Interfaces

#### Stock
```typescript
interface Stock {
  id?: number;
  ticker: string;
  name: string;
  name_ar: string;
  sector: string;
  industry: string;
  current_price: number;
  previous_close: number;
  open_price: number;
  high_price: number;
  low_price: number;
  volume: number;
  market_cap: number;
  pe_ratio: number;
  pb_ratio: number;
  dividend_yield: number;
  eps: number;
  roe: number;
  debt_to_equity: number;
  support_level: number;
  resistance_level: number;
  ma_50: number;
  ma_200: number;
  rsi: number;
  egx30_member: boolean;
  egx70_member: boolean;
  egx100_member: boolean;
  compliance_status?: string;
  is_active: boolean;
  is_egx: boolean;
  last_update: string;
  price_change?: number;        // computed
  value_traded?: number;        // computed
}
```

#### StockMini
```typescript
interface StockMini {
  ticker: string;
  name: string;
  name_ar: string;
  current_price: number;
  price_change: number | null;
  volume?: number;
}
```

#### StockListResponse
```typescript
interface StockListResponse {
  stocks: Stock[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}
```

#### MarketIndex
```typescript
interface MarketIndex {
  symbol: string;
  name: string;
  name_ar: string;
  value: number;
  previous_close: number;
  change: number;
  change_percent: number;
  last_updated: string | null;
}
```

#### MarketOverview
```typescript
interface MarketOverview {
  market_status: MarketStatus;
  summary: MarketSummary;
  indices: MarketIndex[];
  top_gainers: StockMini[];
  top_losers: StockMini[];
  most_active: StockMini[];
  last_updated: string;
}
```

#### MarketSummary
```typescript
interface MarketSummary {
  total_stocks: number;
  gainers: number;
  losers: number;
  unchanged: number;
  egx30_stocks: number;
  egx70_stocks: number;
  egx100_stocks: number;
  egx30_value: number;
}
```

#### MarketStatus
```typescript
interface MarketStatus {
  is_open: boolean;
  status: string;            // "open" | "closed" | "pre_market" | "post_market" | "weekend"
  next_open: string | null;
  next_close: string | null;
  current_session: string | null;
}
```

#### PriceHistoryPoint
```typescript
interface PriceHistoryPoint {
  date: string;    // "YYYY-MM-DD"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

#### PriceHistoryResponse
```typescript
interface PriceHistoryResponse {
  success: boolean;
  ticker: string;
  data: PriceHistoryPoint[];
  summary: PriceHistorySummary;
  days: number;
}
```

#### PriceHistorySummary
```typescript
interface PriceHistorySummary {
  highest: number;
  lowest: number;
  avg_price: number;
  total_volume: number;
  start_price: number;
  end_price: number;
  change_percent: number;
}
```

#### DeepAnalysis
```typescript
interface DeepAnalysis {
  ticker: string;
  stock_name: string;
  stock_name_ar: string;
  current_price: number;
  overall_score: number;
  technical_score: number;
  fundamental_score: number;
  risk_score: number;
  trend: string;
  trend_ar: string;
  action: string;
  action_ar: string;
  price_targets: {
    support: number;
    resistance: number;
    upside_target: number;
  };
  strengths: string[];
  risks: string[];
  technical_indicators: {
    rsi_signal: string;
    ma_signal: string;
    volume_signal: string;
    momentum: string;
  };
}
```

#### AiInsights
```typescript
interface AiInsights {
  market_sentiment: 'bullish' | 'bearish' | 'neutral';
  market_score: number;
  market_breadth: number;
  avg_change_percent: number;
  volatility_index: number;
  gainers: number;
  losers: number;
  unchanged: number;
  top_sectors: { name: string; count: number; avg_change_percent: number }[];
  stock_statuses: StockStatusItem[];
  decision: string;               // "accumulate_selectively" | "hold_and_rebalance" | "reduce_risk"
  risk_assessment: 'low' | 'medium' | 'high';
  generated_at: string;
}
```

#### StockStatusItem
```typescript
interface StockStatusItem {
  ticker: string;
  name: string;
  name_ar: string;
  sector: string;
  current_price: number;
  price_change: number;
  volume: number;
  value_traded: number;
  score: number;
  status: 'strong' | 'positive' | 'neutral' | 'weak';
  components: {
    momentum: number;
    liquidity: number;
    valuation: number;
    income: number;
    traded_value: number;
  };
  fair_value: number;
  upside_to_fair: number;
  verdict: 'undervalued' | 'fair' | 'overvalued';
  verdict_ar: string;
}
```

#### V2 Types

##### MarketRegime
```typescript
type MarketRegime = 'bull' | 'bear' | 'neutral';
```

##### SectorAverages
```typescript
interface SectorAverages {
  sector: string;
  avgPE: number;
  avgPB: number;
  avgROE: number;
  avgDebtEquity: number;
  avgDividendYield: number;
  avgNetMargin?: number;
  stockCount: number;
}
```

##### SafetyViolation
```typescript
interface SafetyViolation {
  rule: string;
  ruleAr: string;
  value: number;
  threshold: number;
  severity: 'hard' | 'soft';
}
```

##### RedFlag
```typescript
interface RedFlag {
  type: string;
  typeAr: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
}
```

##### QualityScore
```typescript
interface QualityScore {
  total: number;
  profitability: {
    score: number;
    roeVsSector: number;
    netMarginVsSector: number;
    epsGrowthYoY: number;
    details: string;
  };
  growth: {
    score: number;
    revenueCAGR: number;
    earningsCAGR: number;
    details: string;
  };
  safety: {
    score: number;
    currentRatio: number;
    interestCoverage: number;
    debtEquity: number;
    fcfPositive: number;
    details: string;
  };
  efficiency: {
    score: number;
    assetTurnover: number;
    details: string;
  };
  valuation: {
    score: number;
    peVsSector: number;
    priceToBook: number;
    dividendYield: number;
    details: string;
  };
}
```

##### MomentumResult
```typescript
interface MomentumResult {
  score: number;
  trendScore: {
    score: number;
    weeklyMACDBullish: boolean;
    dailyAbove50EMA: boolean;
    dailyAbove200EMA: boolean;
    rsiSweetSpot: boolean;
    volumeAboveAvg: boolean;
    details: string;
  };
  supportResistance: {
    strongSupport: number;
    strongResistance: number;
    positionPercent: number;
    zone: 'accumulation' | 'normal' | 'distribution';
    zoneAr: string;
  };
  signalConfluence: {
    qualityAligned: boolean;
    technicalAligned: boolean;
    volumeAligned: boolean;
    alignedCount: number;
    requiredCount: number;
    allAligned: boolean;
  };
  volumeConfirm: boolean;
}
```

##### FairValueResult
```typescript
interface FairValueResult {
  grahamNumber: number;
  peBased: number;
  dcfLight: number;
  averageFairValue: number;
  upsidePotential: number;
  verdict: 'undervalued' | 'fair' | 'overvalued';
  verdictAr: string;
  details?: {
    eps: number;
    bookValuePerShare: number;
    growthRate: number;
    sectorTargetPE: number;
    riskFreeRate: number;
    marginOfSafety: number;
  };
}
```

##### StockRecommendation (V2)
```typescript
interface StockRecommendation {
  ticker: string;
  name: string;
  nameAr: string;
  sector: string;
  currentPrice: number;
  previousClose: number;
  safetyPassed: boolean;
  violations: SafetyViolation[];
  redFlags: RedFlag[];
  qualityScore: QualityScore;
  momentumScore: MomentumResult;
  fairValue: FairValueResult;
  compositeScore: number;
  recommendation: 'Strong Buy' | 'Buy' | 'Hold' | 'Avoid' | 'Strong Avoid';
  recommendationAr: string;
  confidence: number;
  entryPrice: number;
  entryStrategy: {
    immediateBuy: number;
    dipBuyPercent: number;
    dipBuyLevel: number;
    cashReserve: number;
  };
  exitStrategy: {
    targetPrice: number;
    stopLoss: number;
    timeHorizonMonths: number;
  };
  positionSizing: {
    kellyPercent: number;
    adjustedPercent: number;
    percentOfPortfolio: number;
    amountEGP: number;
    sharesCount: number;
    maxRiskPerStock: number;
  };
  riskAssessment: {
    level: 'Low' | 'Medium' | 'High' | 'Very High';
    levelAr: string;
    maxExpectedDrawdown: number;
    keyRisks: string[];
  };
  marketRegime: MarketRegime;
  analysisVersion: string;
}
```

##### RecommendResponse (V2)
```typescript
interface RecommendResponse {
  market: {
    regime: MarketRegime;
    regimeMultiplier: number;
    indexYTDChange?: number;
    sectorAverages: SectorAverages[];
    fearCashPercent: number;
    totalStocksAnalyzed: number;
    passedSafetyFilter: number;
    recommendations: {
      strongBuy: number;
      buy: number;
      hold: number;
      avoid: number;
      strongAvoid: number;
    };
  };
  stocks: StockRecommendation[];
  generatedAt: string;
  analysisVersion: string;
}
```

#### User & Auth Types

##### User
```typescript
interface User {
  id: string;
  email: string;
  username: string;
  is_active: boolean;
  subscription_tier: string;
  default_risk_tolerance: string;
  created_at: string;
  last_login: string | null;
}
```

##### AuthResponse
```typescript
interface AuthResponse {
  message: string;
  user: {
    id: string;
    email: string;
    username: string;
    default_risk_tolerance?: string;
  };
  api_key: string;
}
```

#### Portfolio Types

##### UserAsset
```typescript
interface UserAsset {
  id: number;
  user_id: string;
  asset_type: string;
  asset_name: string;
  asset_ticker: string;
  stock_id: number | null;
  quantity: number;
  purchase_price: number;
  current_price: number;
  current_value: number;
  purchase_date: string;
  target_price: number | null;
  stop_loss_price: number | null;
  currency: string;
  notes: string | null;
  gain_loss: number | null;
  gain_loss_percent: number | null;
  is_active: boolean;
  auto_sync: boolean;
  created_at: string;
  stock?: Stock;
}
```

##### WatchlistItem
```typescript
interface WatchlistItem {
  id: number;
  user_id: string;
  stock_id: number;
  alert_price_above: number | null;
  alert_price_below: number | null;
  alert_change_percent: number | null;
  notes: string | null;
  added_at: string;
  stock?: Stock;
}
```

#### News Types

##### NewsItem
```typescript
interface NewsItem {
  title: string;
  title_ar: string;
  source: string;
  url: string;
  published_at: string;
  summary: string;
  summary_ar: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentiment_score: number;
  relevance_score: number;
  categories: string[];
}
```

---

## Quick Reference: All Endpoints Summary

| Method | Path | Description | Mobile Safe | SDK |
|---|---|---|---|---|
| `POST` | `/api/auth/register` | تسجيل مستخدم جديد | Yes | No |
| `GET/POST` | `/api/auth/[...nextauth]` | تسجيل الدخول (Google / Credentials) | Yes | No |
| `GET` | `/api/market/overview` | نظرة شاملة على السوق | Yes | No |
| `GET` | `/api/market/status` | حالة السوق الحالية | Yes | No |
| `GET` | `/api/market/indices` | مؤشرات السوق | Yes | No |
| `GET` | `/api/market/live-data` | بيانات حية من مباشر | Yes | Yes |
| `GET` | `/api/market/recommendations/ai-insights` | رؤى السوق بالذكاء الاصطناعي | Yes | No |
| `POST` | `/api/market/sync-live` | مزامنة البيانات الحية | No | Yes |
| `POST` | `/api/market/sync-historical` | مزامنة البيانات التاريخية | No | No |
| `GET` | `/api/market/bulk-update` | تحديث مجمع على دفعات | No | No |
| `GET` | `/api/market/gold` | أسعار الذهب والفضة | Yes | No |
| `GET` | `/api/market/gold/history` | تاريخ أسعار الذهب | Yes | No |
| `GET` | `/api/market/currency` | أسعار الصرف | Yes | No |
| `GET` | `/api/stocks` | قائمة الأسهم (بحث وفلترة) | Yes | No |
| `GET` | `/api/stocks/:ticker` | تفاصيل سهم واحد | Yes | No |
| `GET` | `/api/stocks/:ticker/history` | السجل التاريخي لأسعار سهم | Yes | No |
| `GET` | `/api/stocks/:ticker/recommendation` | توصية السهم بالذكاء الاصطناعي | Yes | No |
| `GET` | `/api/stocks/:ticker/news` | أخبار السهم | Yes | Yes |
| `GET` | `/api/stocks/:ticker/professional-analysis` | تحليل احترافي شامل | Yes | No |
| `GET` | `/api/v2/recommend` | توصيات V2 سريعة | Yes | No |
| `POST` | `/api/v2/recommend` | توصيات V2 مخصصة | Yes | No |
| `GET` | `/api/v2/stock/:symbol/analysis` | تحليل عميق لسهم واحد V2 | Yes | No |
| `POST` | `/api/v2/feedback/run` | تشغيل حلقة التغذية الراجعة | Yes | No |
| `POST` | `/api/v2/feedback/backtest` | اختبار تاريخي | Yes | No |
| `GET` | `/api/v2/feedback/predictions` | سجل التنبؤات | Yes | No |
| `GET` | `/api/v2/feedback/status` | حالة التغذية الراجعة | Yes | No |
| `GET` | `/api/v2/admin/config` | إعدادات محرك V2 | No | No |
| `POST` | `/api/v2/admin/config` | تحديث إعدادات V2 | No | No |
| `POST` | `/api/admin/auth` | التحقق من كلمة مرور المسؤول | No | No |
| `POST` | `/api/admin/recommendations` | استيراد التوصيات المعدلة | No | No |
| `GET` | `/api/admin/gold` | أسعار الذهب (عرض المسؤول) | No | No |
| `POST` | `/api/admin/gold` | تحديث أسعار الذهب | No | No |
| `GET` | `/api/admin/currency` | أسعار الصرف (عرض المسؤول) | No | No |
| `POST` | `/api/admin/currency` | تحديث أسعار الصرف | No | No |
| `GET` | `/api/export` | تصدير البيانات (CSV/JSON) | Yes | No |
| `POST` | `/api/import` | استيراد البيانات (CSV/JSON) | Yes | No |
| `ANY` | `/api/proxy/:path*` | وكيل للخادم الخلفي | No | No |

---

## Notes for Mobile App Development

1. **Base URL:** Configure `NEXT_PUBLIC_API_URL` environment variable for the API base URL
2. **Authentication:** Use NextAuth's JWT strategy. Store the session token securely. Session expires in 30 days.
3. **API Key:** On registration, an `api_key` is returned. Send it via `X-API-Key` header for authenticated requests.
4. **Caching:** Several endpoints cache responses server-side. Use `no_cache=true` parameter where available to bypass.
5. **Rate Limiting:** Sync endpoints have built-in rate limiting (2-second delays between stock fetches, max 20 tickers per request).
6. **Arabic Support:** All CSV exports include UTF-8 BOM. JSON responses include Arabic fields (`name_ar`, `action_ar`, etc.).
7. **V2 Engine:** The V2 recommendation engine is pure calculation (no external API calls), making it very fast and reliable for mobile.
8. **Market Hours:** EGX trades Sunday–Thursday, 10:00–14:30 Cairo time (Africa/Cairo). Use `/api/market/status` to determine current state.
9. **Pagination:** Stock lists use `page` and `page_size` parameters. Default page size is 20, max is 500.
10. **Error Handling:** All endpoints return consistent error JSON with `error` and optionally `detail` fields.
