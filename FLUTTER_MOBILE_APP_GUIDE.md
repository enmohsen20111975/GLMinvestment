# EGX Investment Platform — Flutter Mobile App Guide
## Complete API Reference & App Architecture

---

# ═══════════════════════════════════════════════
# PART 1: COMPLETE API REFERENCE
# ═══════════════════════════════════════════════

## BASE URL
```
https://your-domain.com
```

---

## 1. AUTHENTICATION APIs

### 1.1 Register
```
POST /api/auth/register
Content-Type: application/json

Body: {
  "email": "user@example.com",
  "username": "ahmed",
  "password": "Abc12345",
  "risk_tolerance": "medium"  // optional: "low" | "medium" | "high"
}

Response: {
  "success": true,
  "message": "تم التسجيل بنجاح",
  "user": { "id": 1, "email": "...", "username": "ahmed", "default_risk_tolerance": "medium" },
  "api_key": "egx_xxxx..."
}
```

### 1.2 Login
```
POST /api/auth/[...nextauth]

Body (form-data): {
  "username_or_email": "ahmed",
  "password": "Abc12345",
  "callbackUrl": "/",
  "csrfToken": "..."
}

Response: NextAuth session with JWT cookie
```

### 1.3 Google OAuth
```
GET /api/auth/signin/google
→ Redirects to Google OAuth flow
```

### 1.4 Session Check
```
GET /api/auth/session

Response: {
  "user": { "id": 1, "email": "...", "name": "ahmed" },
  "expires": "2026-04-20T..."
}
```

---

## 2. MARKET APIs

### 2.1 Market Overview
```
GET /api/market/overview

Response: {
  "market_status": {
    "is_open": true,
    "is_market_hours": true,
    "status": "open",
    "cairo_time": "14:30"
  },
  "summary": {
    "total_stocks": 250,
    "gainers": 120,
    "losers": 80,
    "unchanged": 50,
    "total_volume": 1250000000,
    "total_value": 8500000000
  },
  "indices": [
    { "symbol": "EGX30", "name": "EGX 30", "name_ar": "مؤشر إيجيكس 30", "value": 28500.5, "previous_close": 28300, "change": 200.5, "change_percent": 0.71 }
  ],
  "top_gainers": [
    { "ticker": "COMI", "name_ar": "المصرية للاتصالات", "sector": "الاتصالات", "current_price": 18.5, "change_percent": 4.2, "volume": 5000000 }
  ],
  "top_losers": [...],
  "most_active": [...]
}
```

### 2.2 Market Status
```
GET /api/market/status

Response: {
  "is_market_hours": true,
  "status": "open",  // "open" | "closed" | "pre_market" | "post_market"
  "cairo_time": "14:30:00",
  "weekday": "الأحد",
  "next_trading_window": "الأحد 9:00 صباحاً",
  "minutes_until_open": 0,
  "minutes_until_close": 90,
  "market_hours": { "open": "09:00", "close": "15:00", "timezone": "Africa/Cairo", "trading_days": ["Sun","Mon","Tue","Wed","Thu"] }
}
```

### 2.3 Market Indices
```
GET /api/market/indices

Response: {
  "indices": [
    { "symbol": "EGX30", "name": "EGX 30", "name_ar": "مؤشر إيجيكس 30", "value": 28500.5, "previous_close": 28300, "change": 200.5, "change_percent": 0.71, "last_updated": "2026-04-19T14:30:00Z" }
  ],
  "total": 4
}
```

### 2.4 Live Data (All Stocks)
```
GET /api/market/live-data
GET /api/market/live-data?no_cache=true

Response: {
  "success": true,
  "source": "database",
  "fetched_at": "2026-04-19T14:30:00Z",
  "data_count": 250,
  "stocks": [
    { "ticker": "COMI", "name_ar": "المصرية للاتصالات", "current_price": 18.5, "change": 0.75, "change_percent": 4.2, "volume": 5000000, "last_updated": "..." }
  ]
}
```

### 2.5 Market AI Insights
```
GET /api/market/recommendations/ai-insights

Response: {
  "market_sentiment": "bullish",  // "bullish" | "bearish" | "neutral"
  "market_score": 68,
  "market_breadth": 0.55,
  "avg_change_percent": 1.2,
  "volatility_index": 15.3,
  "gainers": 120, "losers": 80, "unchanged": 50,
  "top_sectors": [
    { "sector": "الاتصالات", "avg_change": 2.5, "stock_count": 15 }
  ],
  "stock_statuses": [
    {
      "ticker": "COMI", "name": "Commerz International", "name_ar": "المصرية للاتصالات",
      "sector": "الاتصالات", "current_price": 18.5,
      "score": 78, "status": "Strong Buy", "status_ar": "شراء قوي",
      "components": { "quality": 82, "momentum": 75, "value": 68, "risk": 85 },
      "fair_value": 22.5, "upside_to_fair": 21.6,
      "verdict": "Strong Buy", "verdict_ar": "شراء قوي"
    }
  ],
  "decision": "السوق في وضع صعودي...",
  "risk_assessment": { "level": "medium", "description": "..." },
  "generated_at": "2026-04-19T14:30:00Z"
}
```

### 2.6 Sync Live Prices
```
POST /api/market/sync-live
Header: x-force-refresh: true  (optional)

Response: {
  "success": true,
  "source": "data-bridge",
  "fetched_at": "...",
  "data_count": 200,
  "matched_count": 180,
  "updated_count": 150,
  "details": { "updated_tickers": ["COMI", "ORAS", ...], "errors": [] }
}
```

---

## 3. GOLD & SILVER APIs

### 3.1 Gold/Silver Prices
```
GET /api/market/gold

Response: {
  "success": true,
  "source": "database",
  "fetched_at": "2026-04-19T14:30:00Z",
  "last_updated": "2026-04-19T14:00:00Z",
  "prices": {
    "karats": [
      { "key": "24", "name_ar": "عيار 24", "price_per_gram": 8047.31, "change": 15.5, "currency": "EGP" },
      { "key": "21", "name_ar": "عيار 21", "price_per_gram": 7041.4, "change": 13.5, "currency": "EGP" },
      { "key": "18", "name_ar": "عيار 18", "price_per_gram": 6035.48, "change": 11.6, "currency": "EGP" },
      { "key": "14", "name_ar": "عيار 14", "price_per_gram": 4694.26, "change": 9.0, "currency": "EGP" },
      { "key": "12", "name_ar": "عيار 12", "price_per_gram": 4023.66, "change": 7.7, "currency": "EGP" }
    ],
    "ounce": { "price": 250370, "change": 480, "currency": "EGP", "name_ar": "الأونصة" },
    "silver": { "price_per_gram": 134.83, "change": 2.1, "currency": "EGP", "name_ar": "فضة" },
    "silver_ounce": { "price": 4193.81, "change": 65, "currency": "EGP", "name_ar": "أونصة فضة" },
    "bullion": [
      { "key": "gold_pound", "name_ar": "الجنيه الذهب", "price": 66953.62, "change": 129 },
      { "key": "bullion_1g", "name_ar": "سبيكة 1 جرام", "price": 8449.68, "change": 162.7 },
      { "key": "bullion_5g", "name_ar": "سبيكة 5 جرام", "price": 41846.01, "change": 807.6 },
      { "key": "bullion_10g", "name_ar": "سبيكة 10 جرام", "price": 82887.29, "change": 1600 },
      { "key": "bullion_50g", "name_ar": "سبيكة 50 جرام", "price": 412424.64, "change": 7962 },
      { "key": "bullion_100g", "name_ar": "سبيكة 100 جرام", "price": 820825.62, "change": 15845 }
    ]
  }
}
```

### 3.2 Gold Price History
```
GET /api/market/gold/history?karat=24&days=30

Query Params:
  - karat: "24" | "21" | "18" | "silver" (default: "24")
  - days: 1-365 (default: 30)

Response: {
  "success": true,
  "karat": "24",
  "days": 30,
  "count": 30,
  "data": [
    { "date": "2026-04-19", "price": 8047.31, "change": 0.19, "currency": "EGP" },
    { "date": "2026-04-18", "price": 8031.81, "change": -0.15 }
  ]
}
```

### 3.3 Sync Gold Prices
```
POST /api/market/gold/sync

Response: {
  "success": true,
  "gold_updated": 7,
  "silver_updated": 2,
  "bullion_updated": 7,
  "currency_updated": 6,
  "source": "gold-api.com+open-er-api.com",
  "gold_prices": [...],
  "silver_prices": [...],
  "currency_rates": [...]
}
```

---

## 4. CURRENCY APIs

### 4.1 Currency Exchange Rates
```
GET /api/market/currency

Response: {
  "success": true,
  "fetched_at": "2026-04-19T14:30:00Z",
  "last_updated": "2026-04-19T12:00:00Z",
  "central_bank_rate": 50.85,
  "currencies": [
    { "code": "USD", "name_ar": "دولار أمريكي", "buy_rate": 51.81, "sell_rate": 52.31, "change": 0.15, "is_major": true },
    { "code": "EUR", "name_ar": "يورو", "buy_rate": 55.95, "sell_rate": 56.45, "change": 0.08 },
    { "code": "GBP", "name_ar": "جنيه إسترليني", "buy_rate": 65.28, "sell_rate": 66.08, "change": 0.22 },
    { "code": "SAR", "name_ar": "ريال سعودي", "buy_rate": 13.82, "sell_rate": 13.87, "change": 0.01 },
    { "code": "AED", "name_ar": "درهم إماراتي", "buy_rate": 14.11, "sell_rate": 14.16, "change": 0.02 },
    { "code": "KWD", "name_ar": "دينار كويتي", "buy_rate": 168.75, "sell_rate": 169.05, "change": -0.5 }
  ]
}
```

---

## 5. STOCKS APIs

### 5.1 List Stocks
```
GET /api/stocks
GET /api/stocks?query=بنك&sector=البنوك&page=1&page_size=20

Query Params:
  - query: search by name/ticker (Arabic or English)
  - sector: filter by sector
  - index: filter by index ("EGX30", "EGX70", "EGX100")
  - page: page number (default: 1)
  - page_size: items per page (default: 500)

Response: {
  "stocks": [
    {
      "ticker": "CIBK",
      "name": "Commercial International Bank",
      "name_ar": "البنك التجاري الدولي",
      "sector": "البنوك",
      "current_price": 85.5,
      "change": 1.5,
      "change_percent": 1.79,
      "volume": 3000000,
      "market_cap": 250000000000,
      "pe_ratio": 12.5,
      "previous_close": 84.0
    }
  ],
  "total": 250,
  "page": 1,
  "page_size": 500
}
```

### 5.2 Stock Detail
```
GET /api/stocks/{ticker}

Response: {
  "data": {
    "ticker": "CIBK",
    "name": "Commercial International Bank",
    "name_ar": "البنك التجاري الدولي",
    "sector": "البنوك",
    "industry": "Banks",
    "current_price": 85.5,
    "previous_close": 84.0,
    "open_price": 84.5,
    "high_price": 86.0,
    "low_price": 84.0,
    "volume": 3000000,
    "market_cap": 250000000000,
    "pe_ratio": 12.5,
    "pb_ratio": 2.1,
    "eps": 6.84,
    "roe": 18.5,
    "debt_to_equity": 0.45,
    "dividend_yield": 5.2,
    "is_active": true,
    "index_egx30": true,
    "index_egx70": true
  }
}
```

### 5.3 Stock Price History
```
GET /api/stocks/{ticker}/history?days=90

Response: {
  "success": true,
  "ticker": "CIBK",
  "data": [
    { "date": "2026-04-19", "open": 84.5, "high": 86.0, "low": 84.0, "close": 85.5, "volume": 3000000 },
    { "date": "2026-04-18", "open": 83.0, "high": 84.5, "low": 82.5, "close": 84.0, "volume": 2500000 }
  ],
  "summary": {
    "highest": 90.0, "lowest": 72.0, "avg_price": 81.5,
    "total_volume": 50000000, "start_price": 72.0, "end_price": 85.5, "change_percent": 18.75
  },
  "days": 90
}
```

### 5.4 Stock Recommendation (AI)
```
GET /api/stocks/{ticker}/recommendation

Response: {
  "ticker": "CIBK",
  "recommendation": {
    "action": "Strong Buy",
    "action_ar": "شراء قوي",
    "confidence": 78
  },
  "scores": {
    "total_score": 78, "technical_score": 72, "fundamental_score": 85,
    "momentum_score": 68, "risk_score": 15
  },
  "trend": { "direction": "up", "direction_ar": "صعودي" },
  "price_range": { "support": 78.0, "resistance": 92.0 },
  "target_price": 95.0,
  "key_strengths": ["مؤشرات أساسية قوية", "زخم إيجابي"],
  "key_risks": ["ضغوط تضخمية"]
}
```

### 5.5 Stock Professional Analysis
```
GET /api/stocks/{ticker}/professional-analysis

Response: {
  "success": true,
  "ticker": "CIBK",
  "stock": { "ticker": "CIBK", "name_ar": "...", "sector": "...", ... },
  "professional": {
    "recommendation": "Strong Buy",
    "recommendation_ar": "شراء قوي",
    "confidence": 82,
    "target_price": 95.0,
    "stop_loss": 75.0,
    "time_horizon": "3-6 months",
    "scores": { "overall": 82, "technical": 75, "fundamental": 88, "risk": 20 }
  },
  "ai_insight": { "summary": "...", "key_points": [...] },
  "generated_at": "2026-04-19T14:30:00Z"
}
```

### 5.6 Stock News
```
GET /api/stocks/{ticker}/news?limit=10

Response: {
  "success": true,
  "ticker": "CIBK",
  "stock_name_ar": "البنك التجاري الدولي",
  "news": [
    {
      "title": "CIB raises provisions by 15%",
      "source": "Daily News Egypt",
      "url": "https://...",
      "published_at": "2026-04-18",
      "summary": "...",
      "sentiment": "positive",
      "sentiment_score": 0.7,
      "relevance_score": 0.9,
      "categories": ["earnings", "financial"]
    }
  ],
  "overall_sentiment": { "score": 0.65, "label": "positive", "label_ar": "إيجابي", "confidence": 0.8 },
  "total_news": 15,
  "fetched_at": "2026-04-19T14:30:00Z"
}
```

---

## 6. V2 RECOMMENDATION ENGINE APIs

### 6.1 AI Recommendations
```
GET /api/v2/recommend         (default: limit 500)
POST /api/v2/recommend
Body: {
  "capital": 100000,           // optional: investment capital in EGP
  "timeHorizon": "medium",     // optional: "short" | "medium" | "long"
  "incomeStability": "medium", // optional
  "age": 35,                   // optional
  "sector": "البنوك",          // optional: preferred sector
  "limit": 20                  // optional: max results
}

Response: {
  "market_analysis": {
    "regime": "bull", "regime_ar": "سوق صاعد", "regime_multiplier": 1.2,
    "sector_averages": {
      "avg_pe": 14.5, "avg_pb": 2.1, "avg_roe": 16.8, "avg_dividend_yield": 4.2
    }
  },
  "recommendations": [
    {
      "ticker": "CIBK",
      "name_ar": "البنك التجاري الدولي",
      "sector": "البنوك",
      "current_price": 85.5,
      "composite_score": 78,
      "recommendation": "Strong Buy",
      "recommendation_ar": "شراء قوي",
      "confidence": { "overall": 82, "data_quality": 85, "model_agreement": 79 },
      "quality_score": {
        "total": 82, "profitability": 88, "growth": 75, "financial_safety": 90,
        "efficiency": 78, "valuation": 72
      },
      "momentum_score": {
        "score": 72, "trend": "up", "support_resistance": "strong",
        "signal_confluence": 3, "volume_confirmation": true
      },
      "fair_value": {
        "average_fair_value": 95.0, "graham_number": 88.0,
        "pe_fair_value": 92.0, "dcf_fair_value": 105.0,
        "upside_potential": 11.1, "margin_of_safety": 12.5
      },
      "entry_strategy": {
        "immediate_buy_price": 86.0, "dip_buy_level": 80.0, "cash_reserve_pct": 30
      },
      "exit_strategy": {
        "target_price": 95.0, "stop_loss": 75.0, "time_horizon": "3-6 months"
      },
      "position_sizing": {
        "kelly_pct": 15, "adjusted_pct": 12, "shares_count": 14, "max_risk_per_stock": 2
      },
      "risk_assessment": {
        "level": "low", "max_drawdown": 12, "key_risks": ["sector_concentration"]
      },
      "data_quality": "high",
      "market_cap_category": "large"
    }
  ],
  "generated_at": "..."
}
```

### 6.2 Live Analysis
```
GET /api/v2/live-analysis

Response: Same as 6.1 + {
  "_live": {
    "analyzedAt": "2026-04-19T14:30:00Z",
    "processingTimeMs": 4500,
    "changes": [ { "ticker": "CIBK", "from": "Buy", "to": "Strong Buy", "reason": "..." } ],
    "aiCommentary": "...",
    "nextRefreshMinutes": 30,
    "engineVersion": "2.0.0"
  }
}
```

### 6.3 Individual Stock Analysis (V2)
```
GET /api/v2/stock/{symbol}/analysis

Response: Full single-stock analysis (same structure as item in recommendations array)
```

---

## 7. SMART TIPS APIs

### 7.1 Random Tip
```
GET /api/tips/random
GET /api/tips/random?trigger=dashboard_view
GET /api/tips/random?category=risk
GET /api/tips/random?action=categories
GET /api/tips/random?action=all&category=patience

Query Params:
  - trigger: "dashboard_view" | "stock_detail" | "recommendation_view" | "add_watchlist" | "sell_stock" | "buy_stock"
  - category: "patience" | "risk" | "analysis" | "egx_specific" | "psychology" | "general"
  - action: "random" (default) | "categories" | "all"

Response (random): {
  "success": true,
  "tip": { "id": 1, "content": "الصبر مفتاح النجاح في الاستثمار...", "category": "patience", "author": "EGX Platform" }
}

Response (categories): {
  "success": true,
  "categories": [
    { "id": "patience", "name_ar": "الصبر", "count": 20, "icon": "⏳" },
    { "id": "risk", "name_ar": "تجنب المخاطر", "count": 25, "icon": "⚠️" },
    { "id": "analysis", "name_ar": "التحليل", "count": 20, "icon": "📊" },
    { "id": "egx_specific", "name_ar": "البناء المصري", "count": 20, "icon": "🏛️" },
    { "id": "psychology", "name_ar": "علم نفس التداول", "count": 15, "icon": "🧠" }
  ]
}
```

---

## 8. USER DATA APIs

### 8.1 Watchlist
```
GET /api/user/watchlist
POST /api/user/watchlist  Body: { "ticker": "CIBK", "target_price": 90, "target_type": "above", "notes": "..." }
DELETE /api/user/watchlist/{id}

Response (GET): [
  { "id": 1, "ticker": "CIBK", "name_ar": "...", "sector": "...", "current_price": 85.5,
    "target_price": 90, "target_type": "above", "added_at": "..." }
]
```

### 8.2 Portfolio Assets
```
GET /api/user/assets?type=stock
POST /api/user/assets  Body: { "ticker": "CIBK", "quantity": 100, "avg_cost": 80.0, "type": "stock" }
PUT /api/user/assets/{id}  Body: { "quantity": 150, "avg_cost": 78.0 }
DELETE /api/user/assets/{id}
```

### 8.3 Portfolio Impact
```
GET /api/user/portfolio-impact

Response: {
  "total_value": 500000, "total_invested": 400000,
  "total_gain_loss": 100000, "total_gain_loss_percent": 25,
  "day_impact": 2500, "day_impact_percent": 0.5
}
```

### 8.4 Income/Expense Tracking
```
GET /api/user/income-expense
POST /api/user/income-expense  Body: { "type": "income", "amount": 50000, "description": "...", "date": "2026-04-01" }
DELETE /api/user/income-expense/{id}
```

---

## 9. EXPORT APIs

```
GET /api/export?type=stocks&format=json
GET /api/export?type=watchlist&format=csv
GET /api/export?type=portfolio&format=json
GET /api/export?type=market-summary&format=csv
GET /api/export?type=recommendations&format=json
GET /api/export?type=ai-adjustment&format=json

Types: "stocks" | "watchlist" | "portfolio" | "market-summary" | "recommendations" | "ai-adjustment"
Formats: "csv" | "json"
```

---

## 10. FEEDBACK / AI LEARNING APIs

### 10.1 Feedback Status
```
GET /api/v2/feedback/status

Response: {
  "success": true,
  "stats": { "total_predictions": 5000, "validated": 4277, "unvalidated": 723 },
  "model_accuracy": { "overall": 74.1, "fundamental": 53.6, "technical": 50.2, "predictions_validated": 4277, "last_evaluated": "2026-04-19" },
  "accuracy_history": [...],
  "weight_adjustments": [...]
}
```

### 10.2 Run Feedback Loop
```
POST /api/v2/feedback/run
Body: { "run_backtest": false }

Response: {
  "success": true, "predictions_validated": 50,
  "accuracy_summary": { "horizon_5d": { "direction_accuracy": 74.3 }, "overall_direction_accuracy": 74.1 },
  "weight_adjustments": [{ "parameter_name": "weight_profitability", "old_value": 0.4, "new_value": 0.42 }],
  "model_accuracy": { "overall": 74.1 }
}
```

---

## 11. ADMIN APIs

### 11.1 Admin Auth
```
POST /api/admin/auth
Body: { "password": "your-admin-password" }

Response: { "success": true, "message": "...", "token": "..." }
```

### 11.2 Admin Gold Management
```
GET /api/admin/gold
POST /api/admin/gold  Body: { "password": "...", "prices": [{ "karat": "24", "price_per_gram": 8050 }] }
```

### 11.3 Admin Currency Management
```
GET /api/admin/currency
POST /api/admin/currency  Body: { "password": "...", "rates": [{ "code": "USD", "buy_rate": 51.9, "sell_rate": 52.4 }] }
```

### 11.4 Admin Config Weights
```
GET /api/v2/admin/config
POST /api/v2/admin/config  Body: { "parameter_name": "weight_profitability", "new_value": 0.42, "reason": "..." }
```

---

## 12. WEBSOCKET (Socket.IO)

```
URL: ws://your-domain.com/?XTransformPort=3005

Events (Server → Client):
  - "market:update"       → { stocks: [...], timestamp }           every 5s
  - "market:status"       → { status, is_open, gainers_count, ... } every 5s
  - "ticker:update"       → { ticker, current_price, change, volume } every 3s per subscribed
  - "stock:alert"         → { ticker, price, direction, timestamp }

Events (Client → Server):
  - "subscribe:ticker"    → ticker: "CIBK"
  - "unsubscribe:ticker"  → ticker: "CIBK"
  - "getMarketOverview"   → triggers market:overview emit
```

---

# ═══════════════════════════════════════════════
# PART 2: FLUTTER APP ARCHITECTURE
# ═══════════════════════════════════════════════

---

## 🎨 DESIGN SYSTEM

### Color Palette (Dark/Light)

#### Primary Colors
```
LIGHT MODE                          DARK MODE
─────────────────────────────────    ─────────────────────────────────
Background:     #FFFFFF             Background:     #0F172A (slate-900)
Surface:        #F8FAFC             Surface:        #1E293B (slate-800)
Card:           #FFFFFF             Card:           #1E293B
Border:         #E2E8F0             Border:         #334155 (slate-700)

Primary:        #059669 (emerald-600)   →  #10B981 (emerald-500)
Primary Dark:   #047857             Primary:        #10B981
Accent:         #F59E0B (amber-500)  →  #FBBF24 (amber-400)

Profit/Gain:    #059669 (green-600)  →  #34D399 (green-400)
Loss/Fall:      #DC2626 (red-600)    →  #F87171 (red-400)
Warning:        #F59E0B (amber-500)  →  #FBBF24 (amber-400)
Info:           #0EA5E9 (sky-500)    →  #38BDF8 (sky-400)

Text Primary:   #0F172A             Text Primary:   #F8FAFC
Text Secondary: #64748B (slate-500)  Text Secondary: #94A3B8 (slate-400)
Text Muted:     #94A3B8 (slate-400)  Text Muted:     #64748B

Recommendation Badges:
  Strong Buy:  #059669 bg, white text
  Buy:         #10B981 bg, white text
  Hold:        #F59E0B bg, dark text
  Sell:        #EF4444 bg, white text
  Strong Sell: #991B1B bg, white text
```

### Typography
```
Font Family: Cairo (Google Fonts — Arabic-optimized)
  - Headings:  Cairo Bold (700)
  - Body:     Cairo Medium (500)
  - Numbers:  Cairo SemiBold (600)  or  Roboto Mono for prices
  - English:  Inter (clean, modern)

Font Sizes (sp):
  display:  32sp  →  Page titles
  title:    24sp  →  Section headers
  headline: 20sp  →  Card titles, stock names
  body:     16sp  →  Main content
  caption:  14sp  →  Labels, meta info
  small:    12sp  →  Timestamps, footnotes
```

### Spacing & Radius
```
Border Radius:
  - Small:  8px   (badges, chips)
  - Medium: 12px  (cards)
  - Large:  16px  (modals, bottom sheets)
  - XL:     24px  (hero cards)

Spacing (based on 4px grid):
  - xs: 4px
  - sm: 8px
  - md: 16px
  - lg: 24px
  - xl: 32px
```

---

## 📱 SCREEN ARCHITECTURE (8 Main Tabs)

### Bottom Navigation Bar
```
┌──────────────────────────────────────────┐
│  🏠     📈     💼     🧠     ⚙️         │
│ الرئيسية  الأسهم  المحفظة  التحليلات  المزيد  │
│  + 🔔 notification bell (top right)       │
└──────────────────────────────────────────┘
```

---

### SCREEN 1: HOME (الرئيسية) — Dashboard

```
┌──────────────────────────────────┐
│  🌙 EGX منصة الاستثمار     🔔  │  ← App bar with theme toggle + notification bell
├──────────────────────────────────┤
│                                  │
│  ┌────────────────────────────┐  │
│  │ 💡 نصيحة ذكية               │  │  ← Smart Tip card (dismissible)
│  │ الصبر مفتاح النجاح في...   │  │
│  │          ✕                  │  │
│  └────────────────────────────┘  │
│                                  │
│  ⏰ السوق مفتوح ● 14:30 القاهرة│  ← Market status badge (green pulse)
│                                  │
│  ┌─────┐ ┌─────┐ ┌─────┐       │
│  │ 250 │ │ 120 │ │  80 │       │  ← 4 summary cards in 2x2 grid
│  │أسهم │ │ارتفاع│ │انخفاض│       │
│  └─────┘ └─────┘ └─────┘       │
│  ┌─────┐ ┌─────┐               │
│  │ 1.2B│ │ 8.5B│               │
│  │حجم  │ │قيمة │               │
│  └─────┘ └─────┘               │
│                                  │
│  📊 المؤشرات الرئيسية           │
│  ┌────────────────────────────┐  │
│  │ EGX30  28,500  ▲ 0.71%   │  │  ← Horizontal scrollable index cards
│  │ EGX70  5,200   ▼ 0.3%    │  │
│  │ EGX100 9,800   ▲ 0.15%   │  │
│  └────────────────────────────┘  │
│                                  │
│  🔥 أكثر الأسهم نشاطاً           │
│  ┌────────────────────────────┐  │
│  │ COMI  18.50  ▲ 4.2%       │  │  ← Top movers list
│  │ ORAS  52.30  ▲ 2.8%       │  │
│  │ CIBK  85.50  ▼ 1.2%       │  │
│  └────────────────────────────┘  │
│                                  │
│  🥇 الذهب والفضة               │  ← Gold/Silver quick card
│  ┌────────────────────────────┐  │
│  │ عيار24: 8,047 ج.م ▲0.19% │  │
│  │ فضة:   134.8 ج.م ▲1.5%   │  │
│  │ الجنيه: 66,953 ج.م        │  │
│  └────────────────────────────┘  │
│                                  │
│  💱 أسعار الصرف                 │
│  ┌────────────────────────────┐  │
│  │ 🇺🇸 USD  شراء: 51.81      │  │
│  │ 🇪🇺 EUR  شراء: 55.95      │  │
│  │ 🇬🇧 GBP  شراء: 65.28      │  │
│  └────────────────────────────┘  │
│                                  │
│  📈 مقياس المشاعر               │  ← Sentiment gauge
│  ┌────────────────────────────┐  │
│  │     ████████░░  68%       │  │
│  │     صعودي (Bullish)       │  │
│  └────────────────────────────┘  │
│                                  │
└──────────────────────────────────┘
```

---

### SCREEN 2: STOCKS (الأسهم)

```
┌──────────────────────────────────┐
│  🔍 ابحث عن سهم...             │  ← Search bar
├──────────────────────────────────┤
│  الكل | البنوك | الاتصالات | ...│  ← Sector filter chips (horizontal scroll)
├──────────────────────────────────┤
│                                  │
│  ┌────────────────────────────┐  │
│  │ COMI  المصرية للاتصالات   │  │  ← Stock list item
│  │ 18.50 ج.م  ▲ 4.2%  5M    │  │
│  │ ████████████░░░░  حجم      │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ CIBK  البنك التجاري الدولي │  │
│  │ 85.50 ج.م  ▲ 1.79%  3M   │  │
│  └────────────────────────────┘  │
│  ...                             │
│                                  │
│  ↓ تحميل المزيد...             │  ← Infinite scroll / pagination
└──────────────────────────────────┘
```

#### SCREEN 2.1: STOCK DETAIL (تفاصيل السهم)

```
┌──────────────────────────────────┐
│  ← CIBK  البنك التجاري    👁 ⭐│  ← Back + watchlist + share
├──────────────────────────────────┤
│  البنك التجاري الدولي           │
│  Commercial International Bank   │
│  🏷️ البنوك  │  EGX30  │  حلال  │
│                                  │
│  85.50 ج.م  ▲ +1.50 (+1.79%)   │  ← Large price display
│                                  │
│  ┌──────┬──────┬──────┬──────┐ │
│  │افتتاح│أعلى  │أدنى  │إغلاق│ │  ← 4 info chips
│  │84.50 │86.00 │84.00 │84.00 │ │
│  └──────┴──────┴──────┴──────┘ │
│                                  │
│  📊 الرسم البياني               │  ← Interactive chart
│  ┌────────────────────────────┐  │  (flutter_chart / fl_chart)
│  │     ╱╲    ╱╲              │  │
│  │   ╱   ╲╱╱  ╲╱╲           │  │  Line chart with:
│  │  ╱              ╲         │  │  - 7D / 1M / 3M / 6M / 1Y
│  │ ╱                ╲        │  │  - Pinch to zoom
│  └────────────────────────────┘  │
│  ┌──────────────────────────────┐│
│  │ 7 أيام  1 شهر  3 أشهر  سنة ││  ← Period selector
│  └──────────────────────────────┘│
│                                  │
│  💡 نصيحة: هل تعلم أن...       │  ← Contextual smart tip
│                                  │
│  📋 التحليل العميق              │  ← Accordion sections
│  ┌────────────────────────────┐  │
│  │ ▼ التوصية: شراء قوي  82%  │  │  ← Recommendation badge
│  ├────────────────────────────┤  │
│  │ ▼ المؤشرات المالية         │  │
│  │  P/E: 12.5  P/B: 2.1     │  │
│  │  ROE: 18.5%  EPS: 6.84   │  │
│  │  عائد الأرباح: 5.2%       │  │
│  ├────────────────────────────┤  │
│  │ ▼ المؤشرات الفنية          │  │
│  │  RSI: 62.5  متوسط50: 80.0│  │
│  │  دعم: 78.0  مقاومة: 92.0 │  │
│  ├────────────────────────────┤  │
│  │ ▼ نقاط القوة والمخاطر     │  │
│  │  ✅ مؤشرات أساسية قوية     │  │
│  │  ✅ زخم إيجابي             │  │
│  │  ⚠️ ضغوط تضخمية            │  │
│  ├────────────────────────────┤  │
│  │ ▼ الأهداف السعرية          │  │
│  │  🎯 السعر المستهدف: 95.0  │  │
│  │  🛑 وقف الخسارة: 75.0     │  │
│  │  ⏰ الأفق الزمني: 3-6 أشهر│  │
│  └────────────────────────────┘  │
│                                  │
│  📰 أخبار السهم                │  ← News section
│  ┌────────────────────────────┐  │
│  │ ✅ CIB raises provisions.. │  │
│  │    Daily News · 18 أبريل   │  │
│  ├────────────────────────────┤  │
│  │ ⚠️ Central Bank meeting..  │  │
│  │    Reuters · 17 أبريل      │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │  📤 مشاركة  │  📄 تصدير  │  │  ← Action buttons
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

---

### SCREEN 3: PORTFOLIO (المحفظة)

```
┌──────────────────────────────────┐
│  💼 المحفظة                     │
├──────────────────────────────────┤
│                                  │
│  ┌────────────────────────────┐  │
│  │ 💰 قيمة المحفظة            │  │
│  │ 500,000 ج.م                │  │
│  │ ▲ +100,000 (+25%)         │  │  ← Total P/L with sparkline
│  └────────────────────────────┘  │
│                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐    │
│  │المستثمر│ │الأرباح│ │تأثير │    │
│  │400K   │ │100K   │ │+2.5K │    │
│  └──────┘ └──────┘ └──────┘    │
│                                  │
│  ┌────────────────────────────┐  │
│  │ 🤖 توصية الذكاء الاصطناعي│  │
│  │ "تنويع المحفظة في 3 قطاعات│  │
│  │  ثقة: 82%                  │  │
│  └────────────────────────────┘  │
│                                  │
│  ⚠️ تنبيهات المخاطر            │
│  ┌────────────────────────────┐  │
│  │ ⚠️ تركيز مفرط في قطاع     │  │
│  │    البنوك (65%)             │  │
│  └────────────────────────────┘  │
│                                  │
│  📊 الأصول                      │
│  ┌────────────────────────────┐  │
│  │ CIBK  100 سهم  8,550 ج.م  │  │
│  │ ▲ +750 (+8.8%)            │  │
│  ├────────────────────────────┤  │
│  │ COMI  200 سهم  3,700 ج.م  │  │
│  │ ▼ -200 (-5.1%)            │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │      ＋ إضافة أصل          │  │  ← FAB button
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │ 📤 تصدير المحفظة  │ 📊 PDF │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

---

### SCREEN 4: ANALYSIS (التحليلات)

```
┌──────────────────────────────────┐
│  🧠 التحليلات الذكية            │
├──────────────────────────────────┤
│                                  │
│  🥇 الذهب والفضة (كارد مدمج)   │
│  ┌────────────────────────────┐  │
│  │ عيار24: 8,047  عيار21: 7,041│  │
│  │ عيار18: 6,035  فضة: 134.8 │  │
│  └────────────────────────────┘  │
│                                  │
│  📊 حالة السوق                  │
│  ┌────────────────────────────┐  │
│  │ المشاعر: صعودي 📈  68%    │  │
│  │ النظام: سوق صاعد × 1.2    │  │
│  └────────────────────────────┘  │
│                                  │
│  [شراء قوي] [شراء] [تثبيت] [بيع]│  ← Filter tabs
│                                  │
│  ┌────────────────────────────┐  │
│  │ CIBK  البنك التجاري الدولي │  │
│  │ 85.50 ج.م  │  78 نقطة      │  │
│  │ شراء قوي │ ثقة: 82%       │  │
│  │ 🎯 هدف: 95.0  🛑 وقف: 75.0│  │
│  │ ──── جودة: 82  زخم: 72 ──│  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ ORAS  أوراسكوم             │  │
│  │ 52.30 ج.م  │  65 نقطة      │  │
│  │ شراء     │ ثقة: 70%        │  │
│  │ 🎯 هدف: 60.0  🛑 وقف: 45.0│  │
│  └────────────────────────────┘  │
│  ...                             │
│                                  │
│  ─────── أنقر لتفاصيل أكثر ────│
└──────────────────────────────────┘
```

---

### SCREEN 5: MORE (المزيد) — Expanded Menu

```
┌──────────────────────────────────┐
│  ⚙️ المزيد                      │
├──────────────────────────────────┤
│                                  │
│  👁 قائمة المراقبة               │
│     5 أسهم                       │
│                                  │
│  📄 التقارير                    │
│     تقرير يومي + قطاعي          │
│                                  │
│  🎓 مركز التعلم                │
│     8 دورات · 30+ درس           │
│                                  │
│  🎮 المحاكاة                   │
│     تداول بأموال وهمية          │
│                                  │
│  ───────────────────────────     │
│  👤 الملف الشخصي                │
│  🌙 المظهر (فاتح/داكن)         │
│  🌐 اللغة (عربي/English)       │
│  📤 تصدير البيانات             │
│  ℹ️ عن التطبيق                  │
│  🔐 تسجيل الخروج                │
└──────────────────────────────────┘
```

---

### SCREEN 6: WATCHLIST (قائمة المراقبة)

```
┌──────────────────────────────────┐
│  ← قائمة المراقبة (5)           │
├──────────────────────────────────┤
│                                  │
│  ┌────────────────────────────┐  │
│  │ 🔔 CIBK  البنك التجاري     │  │
│  │ 85.50 ج.م  ▲ 1.79%        │  │
│  │ هدف: > 90.00  ✅ لا يزال   │  │
│  │              🗑️            │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ 🔕 COMI  المصرية للاتصالات │  │
│  │ 18.50 ج.م  ▼ 2.1%         │  │
│  │ هدف: < 15.00  ❌ تجاوز!   │  │  ← Alert triggered
│  │              🗑️            │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │      ＋ إضافة سهم         │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

---

### SCREEN 7: REPORTS (التقارير)

```
Tab: [يومي] [قطاعي] [تحليلات] [توصيات]

┌──────────────────────────────────┐
│  📄 التقرير اليومي              │
├──────────────────────────────────┤
│  19 أبريل 2026 · القاهرة         │
│                                  │
│  ملخص السوق:                    │
│  ارتفع المؤشر الرئيسي 0.71%... │
│                                  │
│  القطاعات الأفضل أداءً:         │
│  🏆 الاتصالات  +2.5%           │
│  🥈 البنوك      +1.8%           │
│  🥉 العقارات    +1.2%           │
│                                  │
│  ┌────────────────────────────┐  │
│  │  📤 مشاركة  │  📄 تحميل PDF│  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

---

### SCREEN 8: LEARNING (مركز التعلم)

```
┌──────────────────────────────────┐
│  🎓 مركز التعلم                │
├──────────────────────────────────┤
│                                  │
│  تقدمك: ████████░░ 65%          │  ← Progress bar
│  20 من 30 درس                   │
│                                  │
│  ┌────────────────────────────┐  │
│  │ 📗 أساسيات الاستثمار       │  │
│  │ 6 دروس · مبتدئ · ████ 100%│  │  ← Course card
│  ├────────────────────────────┤  │
│  │ 📘 قراءة البيانات المالية  │  │
│  │ 6 دروس · متوسط · ██░░ 67% │  │
│  ├────────────────────────────┤  │
│  │ 📕 التحليل الأساسي         │  │
│  │ 6 دروس · متوسط · █░░░ 33% │  │
│  ├────────────────────────────┤  │
│  │ 📙 التحليل الفني للمبتدئين │  │
│  │ 5 دروس · مبتدئ · ░░░░ 0%  │  │
│  ├────────────────────────────┤  │
│  │ 📒 إدارة المحفظة           │  │
│  │ 5 دروس · متقدم · ░░░░ 0%  │  │
│  └────────────────────────────┘  │
│                                  │
│  📝 اختبارات سريعة             │
│  ┌────────────────────────────┐  │
│  │ اختبار التحليل الأساسي     │  │
│  │ 10 أسئلة · أفضل نتيجة: 8/10│  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

---

### SCREEN 9: SIMULATION (المحاكاة)

```
Tab: [لوحة التحكم] [تداول] [محفظتي] [السجل]

┌──────────────────────────────────┐
│  🎮 المحاكاة  │  💰 100,000 ج.م │  ← Virtual balance
├──────────────────────────────────┤
│                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐    │
│  │المحفظة│ │الأرباح│ │الصفقات│    │
│  │95,000 │ │+2,500 │ │  12  │    │
│  │▲ 2.8% │ │▲ 2.8% │ │      │    │
│  └──────┘ └──────┘ └──────┘    │
│                                  │
│  📊 أداء المحفظة               │
│  ┌────────────────────────────┐  │
│  │  chart sparkline...        │  │  ← Line chart
│  └────────────────────────────┘  │
│                                  │
│  💱 السوق (محاكاة)             │
│  ┌────────────────────────────┐  │
│  │ COMI  18.50  ▲  [+شراء]   │  │
│  │ ORAS  52.30  ▼  [+بيع]   │  │  ← Flashing prices
│  │ CIBK  85.50  ▲  [+شراء]   │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

---

### SCREEN 10: LOGIN / REGISTER

```
┌──────────────────────────────────┐
│                                  │
│         🏛️                      │
│    منصة EGX للاستثمار           │
│                                  │
│  ┌────────────────────────────┐  │
│  │  البريد الإلكتروني          │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │  كلمة المرور     👁         │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │      تسجيل الدخول          │  │  ← Primary button
│  └────────────────────────────┘  │
│                                  │
│  ───── أو ─────                  │
│                                  │
│  ┌────────────────────────────┐  │
│  │  🔵 G تسجيل بحساب Google   │  │  ← Google button
│  └────────────────────────────┘  │
│                                  │
│  ليس لديك حساب؟ تسجيل           │
│                                  │
└──────────────────────────────────┘
```

---

## 🏗️ FLUTTER PROJECT STRUCTURE

```
lib/
├── main.dart
├── app.dart
├── config/
│   ├── api_config.dart         ← Base URL, endpoints
│   ├── theme.dart              ← Light/Dark themes
│   └── constants.dart          ← Colors, sizes, strings
├── models/
│   ├── stock.dart
│   ├── gold_price.dart
│   ├── currency_rate.dart
│   ├── recommendation.dart
│   ├── portfolio_asset.dart
│   ├── watchlist_item.dart
│   ├── news_article.dart
│   ├── market_overview.dart
│   ├── smart_tip.dart
│   └── user.dart
├── services/
│   ├── api_service.dart        ← HTTP client (dio)
│   ├── auth_service.dart
│   ├── market_service.dart
│   ├── stock_service.dart
│   ├── gold_service.dart
│   ├── portfolio_service.dart
│   ├── watchlist_service.dart
│   ├── recommendation_service.dart
│   ├── notification_service.dart
│   └── websocket_service.dart  ← Socket.IO
├── providers/
│   ├── theme_provider.dart     ← Riverpod/Provider
│   ├── auth_provider.dart
│   ├── market_provider.dart
│   ├── stock_provider.dart
│   ├── portfolio_provider.dart
│   └── settings_provider.dart
├── screens/
│   ├── splash_screen.dart
│   ├── auth/
│   │   ├── login_screen.dart
│   │   └── register_screen.dart
│   ├── home/
│   │   └── home_screen.dart    ← Dashboard
│   ├── stocks/
│   │   ├── stocks_list_screen.dart
│   │   └── stock_detail_screen.dart
│   ├── portfolio/
│   │   └── portfolio_screen.dart
│   ├── analysis/
│   │   └── analysis_screen.dart ← Recommendations
│   ├── watchlist/
│   │   └── watchlist_screen.dart
│   ├── reports/
│   │   └── reports_screen.dart
│   ├── learning/
│   │   ├── learning_home_screen.dart
│   │   ├── lesson_screen.dart
│   │   └── quiz_screen.dart
│   ├── simulation/
│   │   ├── simulation_dashboard_screen.dart
│   │   ├── trading_screen.dart
│   │   └── portfolio_screen.dart
│   └── settings/
│       └── settings_screen.dart
├── widgets/
│   ├── stock_list_item.dart
│   ├── price_chart.dart         ← fl_chart
│   ├── sentiment_gauge.dart
│   ├── index_card.dart
│   ├── gold_price_card.dart
│   ├── currency_card.dart
│   ├── smart_tip_card.dart
│   ├── recommendation_card.dart
│   ├── score_badge.dart
│   ├── loading_skeleton.dart
│   ├── error_widget.dart
│   └── notification_badge.dart
└── utils/
    ├── formatters.dart          ← Number, date, percentage
    ├── validators.dart
    └── helpers.dart
```

---

## 📦 RECOMMENDED FLUTTER PACKAGES

```yaml
dependencies:
  flutter:
    sdk: flutter

  # State Management
  flutter_riverpod: ^2.5.0       # or provider/getit
  riverpod_annotation: ^2.3.0

  # HTTP
  dio: ^5.4.0                    # HTTP client
  retrofit: ^4.1.0               # Type-safe API client
  json_annotation: ^4.9.0        # JSON serialization

  # WebSocket
  socket_io_client: ^3.0.0       # Real-time data

  # Charts
  fl_chart: ^0.69.0              # Line, candlestick, pie charts

  # UI
  google_fonts: ^6.2.0           # Cairo + Inter fonts
  cached_network_image: ^3.3.0   # Image caching
  shimmer: ^3.0.0                # Loading skeletons
  flutter_svg: ^2.0.9            # SVG icons
  lucide_icons: ^0.460.0         # Icon set (same as web)

  # Navigation
  go_router: ^14.0.0             # Declarative routing

  # Storage
  shared_preferences: ^2.2.0     # Local storage
  hive: ^2.2.3                   # NoSQL local DB
  hive_flutter: ^1.1.0

  # Theme
  flex_color_scheme: ^7.3.1      # Material 3 theming

  # Auth
  flutter_appauth: ^7.0.0        # OAuth (Google sign-in)
  local_auth: ^2.2.0             # Biometric auth

  # PDF / Share
  share_plus: ^10.0.0            # Native sharing
  path_provider: ^2.1.0          # File access
  pdf: ^3.11.0                   # PDF generation

  # Notifications
  flutter_local_notifications: ^17.0.0
  firebase_messaging: ^15.0.0    # Push notifications

  # Utilities
  intl: ^0.19.0                  # Date/number formatting
  url_launcher: ^6.3.0           # Open URLs
  pull_to_refresh: ^2.0.0        # Pull to refresh
  infinite_scroll_pagination: ^4.0.0
  carousel_slider: ^5.0.0        # Horizontal scrolling
  percent_indicator: ^4.2.0      # Circular progress
  animated_text_kit: ^4.2.2      # Text animations

dev_dependencies:
  flutter_test:
    sdk: flutter
  build_runner: ^2.4.0
  json_serializable: ^6.8.0
  retrofit_generator: ^8.1.0
  flutter_lints: ^5.0.0
```

---

## 🔄 STATE MANAGEMENT (Riverpod)

```dart
// Example providers
@riverpod
Future<MarketOverview> marketOverview(MarketOverviewRef ref) {
  return ref.read(apiServiceProvider).getMarketOverview();
}

@riverpod
Future<List<Stock>> stocks(StocksRef ref, {String? query, String? sector}) {
  return ref.read(apiServiceProvider).getStocks(query: query, sector: sector);
}

@riverpod
Future<StockDetail> stockDetail(StockDetailRef ref, String ticker) {
  return ref.read(apiServiceProvider).getStockDetail(ticker);
}

@riverpod
Stream<MarketUpdate> marketUpdates(MarketUpdatesRef ref) {
  return ref.read(websocketServiceProvider).marketUpdates;
}
```

---

## 📐 KEY UI PATTERNS

### RTL Support
```dart
// In MaterialApp
MaterialApp(
  theme: ThemeData(
    fontFamily: 'Cairo',
  ),
  locale: Locale('ar'),
  localizationsDelegates: [...],
  // All layouts auto-RTL in Arabic
);

// For numbers (LTR within RTL)
Text(
  '85.50 ج.م',
  textDirection: TextDirection.ltr,
  style: TextStyle(fontFamily: 'Roboto Mono'),
);
```

### Pull-to-Refresh
```dart
RefreshIndicator(
  onRefresh: () => ref.refresh(marketOverviewProvider.future),
  child: ListView(...),
);
```

### Skeleton Loading
```dart
Shimmer.fromColors(
  baseColor: Colors.grey[300]!,
  highlightColor: Colors.grey[100]!,
  child: ListView.builder(itemCount: 5, itemBuilder: skeletonCard),
);
```

### Price Flash Animation
```dart
AnimatedSwitcher(
  duration: Duration(milliseconds: 500),
  child: Text(
    price,
    key: ValueKey(price),
    style: TextStyle(
      color: isUp ? Colors.green : Colors.red,
      fontWeight: FontWeight.bold,
    ),
  ),
);
```

---

## 🚀 RECOMMENDED DEVELOPMENT PHASES

### Phase 1: Core (2 weeks)
1. Project setup (themes, routing, API client)
2. Auth screens (login, register, Google OAuth)
3. Home/Dashboard screen
4. Stocks list + search + detail
5. Bottom navigation

### Phase 2: Features (2 weeks)
6. Watchlist CRUD
7. Portfolio management
8. Gold/Silver prices + history chart
9. Currency rates
10. Smart tips
11. Notifications

### Phase 3: Advanced (2 weeks)
12. AI Recommendations (V2 engine)
13. Reports (daily, sector, recommendations)
14. Learning center (courses + quizzes)
15. Trading simulation
16. PDF export + share

### Phase 4: Polish (1 week)
17. Dark/Light theme
18. RTL fine-tuning
19. Offline caching (Hive)
20. Push notifications (Firebase)
21. Performance optimization
22. App Store / Play Store submission
