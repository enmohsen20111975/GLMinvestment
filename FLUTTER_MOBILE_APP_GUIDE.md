# EGX Investment Platform - Flutter Mobile App API Guide

This document provides a complete reference for all API endpoints available for the Flutter mobile application.

## 🌐 API Base URLs

| Server | Base URL | Purpose |
|--------|----------|---------|
| **Next.js (Hostinger)** | `https://invist.m2y.net` | Main website, user authentication, portfolio management |
| **VPS API** | `http://72.61.137.86:8010` | Real-time stock data, technical indicators, alerts |

---

## 📊 VPS API Endpoints

**Base URL:** `http://72.61.137.86:8010`

The VPS API handles all data-intensive operations to reduce load on the shared hosting.

### 1. Health & Status

#### `GET /health`
Check API status and data availability.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-04-28T10:00:00",
  "data_sources": {
    "tradingview": true,
    "yfinance": true,
    "pandas": true
  },
  "database": {
    "total_stocks": 295,
    "stocks_with_prices": 237
  }
}
```

---

### 2. Stocks

#### `GET /api/stocks/all`
**Returns ALL 295 EGX stocks with prices.**

**Response:**
```json
{
  "success": true,
  "count": 237,
  "total_in_database": 295,
  "data": [
    {
      "symbol": "AALR",
      "exchange": "EGX",
      "price": 12.50,
      "open": 12.30,
      "high": 12.60,
      "low": 12.20,
      "volume": 150000,
      "change": 0.20,
      "change_percent": 1.62,
      "last_updated": "2026-04-28T10:00:00"
    },
    // ... all stocks
  ],
  "timestamp": "2026-04-28T10:00:00"
}
```

**Flutter Example:**
```dart
Future<List<Stock>> fetchAllStocks() async {
  final response = await http.get(
    Uri.parse('http://72.61.137.86:8010/api/stocks/all')
  );
  
  if (response.statusCode == 200) {
    final data = json.decode(response.body);
    return (data['data'] as List)
        .map((json) => Stock.fromJson(json))
        .toList();
  }
  throw Exception('Failed to load stocks');
}
```

---

#### `GET /api/stocks`
Get stocks with pagination and filtering.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | int | Number of results |
| `offset` | int | Pagination offset |
| `search` | string | Search by symbol |

**Example:** `GET /api/stocks?limit=20&search=COM`

**Response:**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {"symbol": "COMI", "price": 138.15, "change_percent": 1.2, ...},
    {"symbol": "DCOM", "price": 5.50, "change_percent": -0.5, ...}
  ]
}
```

---

#### `GET /api/stock/{symbol}`
Get single stock details.

**Example:** `GET /api/stock/COMI`

**Response:**
```json
{
  "success": true,
  "data": {
    "symbol": "COMI",
    "exchange": "EGX",
    "name": "Commercial International Bank",
    "current_price": 138.15,
    "previous_close": 136.50,
    "open_price": 137.00,
    "high_price": 139.00,
    "low_price": 136.50,
    "volume": 5250000,
    "change_amount": 1.65,
    "change_percent": 1.21,
    "last_updated": "2026-04-28T10:00:00"
  }
}
```

---

### 3. Indices

#### `GET /api/indices`
Get all EGX indices.

**Response:**
```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "symbol": "EGX30",
      "name": "EGX 30 Index",
      "current_value": 52521.60,
      "change_amount": 150.50,
      "change_percent": 0.29,
      "last_updated": "2026-04-28T10:00:00"
    },
    {"symbol": "EGX50", ...},
    {"symbol": "EGX70", ...},
    {"symbol": "EGX100", ...},
    {"symbol": "EGX30C", ...}
  ]
}
```

---

### 4. Historical Data

#### `GET /api/history/{symbol}`
Get historical price data.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | string | `1y` | Period: 1mo, 3mo, 6mo, 1y, 2y |

**Example:** `GET /api/history/COMI?period=6mo`

**Response:**
```json
{
  "success": true,
  "data": {
    "symbol": "COMI",
    "period": "6mo",
    "points": 120,
    "rows": [
      {"date": "2026-04-28", "open": 137.0, "high": 139.0, "low": 136.5, "close": 138.15, "volume": 5250000},
      {"date": "2026-04-27", "open": 135.0, "high": 137.5, "low": 134.5, "close": 136.50, "volume": 4800000},
      // ... more days
    ],
    "summary": {
      "start_date": "2024-10-28",
      "end_date": "2026-04-28",
      "change_percent": 15.5
    }
  }
}
```

**Flutter Example:**
```dart
Future<List<PricePoint>> fetchHistory(String symbol, {String period = '1y'}) async {
  final response = await http.get(
    Uri.parse('http://72.61.137.86:8010/api/history/$symbol?period=$period')
  );
  
  if (response.statusCode == 200) {
    final data = json.decode(response.body);
    return (data['data']['rows'] as List)
        .map((json) => PricePoint.fromJson(json))
        .toList();
  }
  throw Exception('Failed to load history');
}
```

---

### 5. Technical Indicators

#### `GET /api/indicators/{symbol}`
Get technical indicators for a stock.

**Response:**
```json
{
  "success": true,
  "data": {
    "symbol": "COMI",
    "current_price": 138.15,
    "indicators": {
      "sma": {
        "5": 137.50,
        "10": 136.80,
        "20": 135.20,
        "50": 132.00
      },
      "ema": {
        "5": 137.80,
        "10": 137.00,
        "20": 135.80,
        "50": 133.50
      },
      "rsi": {
        "value": 64.43,
        "signal": "neutral"
      },
      "macd": {
        "macd": 1.25,
        "signal": 1.12,
        "histogram": 0.13,
        "trend": "bullish"
      },
      "bollinger_bands": {
        "upper": 142.50,
        "middle": 135.20,
        "lower": 127.90,
        "current": 138.15
      }
    }
  }
}
```

---

### 6. Price Alerts

#### `GET /api/alerts`
Get all price alerts.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | `active` | Filter: active, triggered, all |

**Response:**
```json
{
  "success": true,
  "count": 3,
  "alerts": [
    {
      "id": 1,
      "symbol": "COMI",
      "exchange": "EGX",
      "target_price": 150.0,
      "condition": "above",
      "status": "active",
      "created_at": "2026-04-28T09:00:00"
    }
  ]
}
```

---

#### `POST /api/alerts`
Create a new price alert.

**Request Body:**
```json
{
  "symbol": "COMI",
  "exchange": "EGX",
  "target_price": 150.0,
  "condition": "above"
}
```

**Conditions:** `above`, `below`, `crosses_up`, `crosses_down`

**Response:**
```json
{
  "success": true,
  "alert_id": 5
}
```

**Flutter Example:**
```dart
Future<bool> createAlert({
  required String symbol,
  required double targetPrice,
  required String condition,
}) async {
  final response = await http.post(
    Uri.parse('http://72.61.137.86:8010/api/alerts'),
    headers: {'Content-Type': 'application/json'},
    body: json.encode({
      'symbol': symbol,
      'target_price': targetPrice,
      'condition': condition,
    }),
  );
  return response.statusCode == 200;
}
```

---

#### `DELETE /api/alerts/{id}`
Delete a price alert.

---

### 7. Daily Reports

#### `GET /api/reports/daily`
Get daily market report with top gainers, losers, and sentiment.

**Response:**
```json
{
  "success": true,
  "data": {
    "report_date": "2026-04-28",
    "generated_at": "2026-04-28T10:00:00",
    "market_summary": {
      "total_stocks": 295,
      "gainers": 120,
      "losers": 95,
      "unchanged": 80,
      "average_change": 0.45
    },
    "top_gainers": [
      {"symbol": "SWDY", "current_price": 87.15, "change_percent": 5.2, "volume": 1500000},
      // ... top 10
    ],
    "top_losers": [
      {"symbol": "ABUK", "current_price": 8.50, "change_percent": -3.5, "volume": 800000},
      // ... top 10
    ],
    "most_active": [
      {"symbol": "CCAP", "current_price": 4.65, "change_percent": 2.1, "volume": 111443803},
      // ... top 10
    ],
    "market_sentiment": "bullish"
  }
}
```

---

### 8. Search

#### `GET /api/search?q={query}`
Search for stocks by symbol.

**Example:** `GET /api/search?q=COM`

**Response:**
```json
{
  "success": true,
  "query": "COM",
  "count": 3,
  "results": [
    {"symbol": "COMI", "name": null, "current_price": 138.15, "change_percent": 1.2},
    {"symbol": "DCOM", "name": null, "current_price": 5.50, "change_percent": -0.5}
  ]
}
```

---

### 9. Exchanges

#### `GET /api/exchanges`
List all supported exchanges.

**Response:**
```json
{
  "success": true,
  "count": 10,
  "exchanges": [
    {"code": "EGX", "name": "Egyptian Exchange", "country": "Egypt", "currency": "EGP"},
    {"code": "NASDAQ", "name": "NASDAQ", "country": "USA", "currency": "USD"},
    {"code": "NYSE", "name": "New York Stock Exchange", "country": "USA", "currency": "USD"},
    {"code": "LSE", "name": "London Stock Exchange", "country": "UK", "currency": "GBP"},
    // ... more
  ]
}
```

---

### 10. Sync

#### `POST /api/sync`
Manually trigger data sync (updates all stock prices from TradingView).

**Response:**
```json
{
  "success": true,
  "stocks_updated": 237,
  "errors": []
}
```

---

## 🌐 Next.js API Endpoints

**Base URL:** `https://invist.m2y.net`

The Next.js API handles user authentication, portfolio management, and complex analysis.

### Authentication

#### `POST /api/auth/register`
Register new user.

#### `POST /api/auth/login`
User login.

#### `POST /api/auth/logout`
User logout.

#### `GET /api/auth/me`
Get current user profile.

---

### Portfolio Management

#### `GET /api/portfolio`
Get user's portfolio.

#### `POST /api/portfolio/holdings`
Add holding to portfolio.

#### `DELETE /api/portfolio/holdings/{id}`
Remove holding from portfolio.

#### `GET /api/portfolio/performance`
Get portfolio performance metrics.

---

### Watchlist

#### `GET /api/watchlist`
Get user's watchlist.

#### `POST /api/watchlist`
Add stock to watchlist.

#### `DELETE /api/watchlist/{symbol}`
Remove from watchlist.

---

### Analysis

#### `GET /api/analysis/{symbol}`
Get comprehensive stock analysis.

#### `GET /api/screener`
Stock screening with filters.

#### `GET /api/compare?symbols=COMI,HRHO,SWDY`
Compare multiple stocks.

---

### Database Sync

#### `POST /api/sync-live`
Sync live data from VPS to local database.

---

## 📱 Flutter Implementation Examples

### Stock Model
```dart
class Stock {
  final String symbol;
  final String exchange;
  final double price;
  final double open;
  final double high;
  final double low;
  final int volume;
  final double change;
  final double changePercent;
  final DateTime? lastUpdated;

  Stock({
    required this.symbol,
    required this.exchange,
    required this.price,
    required this.open,
    required this.high,
    required this.low,
    required this.volume,
    required this.change,
    required this.changePercent,
    this.lastUpdated,
  });

  factory Stock.fromJson(Map<String, dynamic> json) {
    return Stock(
      symbol: json['symbol'],
      exchange: json['exchange'] ?? 'EGX',
      price: (json['price'] ?? json['current_price'] ?? 0).toDouble(),
      open: (json['open'] ?? json['open_price'] ?? 0).toDouble(),
      high: (json['high'] ?? json['high_price'] ?? 0).toDouble(),
      low: (json['low'] ?? json['low_price'] ?? 0).toDouble(),
      volume: json['volume'] ?? 0,
      change: (json['change'] ?? json['change_amount'] ?? 0).toDouble(),
      changePercent: (json['change_percent'] ?? 0).toDouble(),
      lastUpdated: json['last_updated'] != null 
          ? DateTime.parse(json['last_updated']) 
          : null,
    );
  }
}
```

### API Service
```dart
import 'package:http/http.dart' as http;
import 'dart:convert';

class EgxApiService {
  // VPS API for real-time data
  static const String vpsBaseUrl = 'http://72.61.137.86:8010';
  
  // Next.js API for user features
  static const String nextBaseUrl = 'https://invist.m2y.net';

  // =====================
  // VPS API Methods
  // =====================

  /// Get ALL stocks (295 EGX stocks)
  Future<List<Stock>> getAllStocks() async {
    final response = await http.get(
      Uri.parse('$vpsBaseUrl/api/stocks/all'),
    );
    
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return (data['data'] as List)
          .map((json) => Stock.fromJson(json))
          .toList();
    }
    throw Exception('Failed to load stocks');
  }

  /// Get single stock
  Future<Stock> getStock(String symbol) async {
    final response = await http.get(
      Uri.parse('$vpsBaseUrl/api/stock/$symbol'),
    );
    
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return Stock.fromJson(data['data']);
    }
    throw Exception('Stock not found');
  }

  /// Get all indices
  Future<List<Index>> getIndices() async {
    final response = await http.get(
      Uri.parse('$vpsBaseUrl/api/indices'),
    );
    
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return (data['data'] as List)
          .map((json) => Index.fromJson(json))
          .toList();
    }
    throw Exception('Failed to load indices');
  }

  /// Get historical data
  Future<List<PricePoint>> getHistory(String symbol, {String period = '1y'}) async {
    final response = await http.get(
      Uri.parse('$vpsBaseUrl/api/history/$symbol?period=$period'),
    );
    
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return (data['data']['rows'] as List)
          .map((json) => PricePoint.fromJson(json))
          .toList();
    }
    throw Exception('Failed to load history');
  }

  /// Get technical indicators
  Future<TechnicalIndicators> getIndicators(String symbol) async {
    final response = await http.get(
      Uri.parse('$vpsBaseUrl/api/indicators/$symbol'),
    );
    
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return TechnicalIndicators.fromJson(data['data']);
    }
    throw Exception('Failed to load indicators');
  }

  /// Create price alert
  Future<int> createAlert({
    required String symbol,
    required double targetPrice,
    required String condition,
  }) async {
    final response = await http.post(
      Uri.parse('$vpsBaseUrl/api/alerts'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        'symbol': symbol,
        'target_price': targetPrice,
        'condition': condition,
      }),
    );
    
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return data['alert_id'];
    }
    throw Exception('Failed to create alert');
  }

  /// Get price alerts
  Future<List<PriceAlert>> getAlerts({String status = 'active'}) async {
    final response = await http.get(
      Uri.parse('$vpsBaseUrl/api/alerts?status=$status'),
    );
    
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return (data['alerts'] as List)
          .map((json) => PriceAlert.fromJson(json))
          .toList();
    }
    throw Exception('Failed to load alerts');
  }

  /// Get daily market report
  Future<DailyReport> getDailyReport() async {
    final response = await http.get(
      Uri.parse('$vpsBaseUrl/api/reports/daily'),
    );
    
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return DailyReport.fromJson(data['data']);
    }
    throw Exception('Failed to load report');
  }

  /// Search stocks
  Future<List<Stock>> searchStocks(String query) async {
    final response = await http.get(
      Uri.parse('$vpsBaseUrl/api/search?q=$query'),
    );
    
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return (data['results'] as List)
          .map((json) => Stock.fromJson(json))
          .toList();
    }
    throw Exception('Search failed');
  }

  // =====================
  // Next.js API Methods
  // =====================

  /// Login user
  Future<User> login(String email, String password) async {
    final response = await http.post(
      Uri.parse('$nextBaseUrl/api/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({'email': email, 'password': password}),
    );
    
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return User.fromJson(data['user']);
    }
    throw Exception('Login failed');
  }

  /// Get portfolio
  Future<Portfolio> getPortfolio(String token) async {
    final response = await http.get(
      Uri.parse('$nextBaseUrl/api/portfolio'),
      headers: {'Authorization': 'Bearer $token'},
    );
    
    if (response.statusCode == 200) {
      final data = json.decode(response.body);
      return Portfolio.fromJson(data);
    }
    throw Exception('Failed to load portfolio');
  }
}
```

---

## 📋 API Summary Table

### VPS API (`http://72.61.137.86:8010`)

| Method | Endpoint | Description | Returns |
|--------|----------|-------------|---------|
| GET | `/health` | Health check | Status, data sources |
| GET | `/api/stocks/all` | **ALL 295 stocks** | Complete list with prices |
| GET | `/api/stocks` | Stocks with pagination | Filtered list |
| GET | `/api/stock/{symbol}` | Single stock | Stock details |
| GET | `/api/indices` | EGX indices | EGX30, EGX50, etc. |
| GET | `/api/history/{symbol}` | Historical data | OHLCV data |
| GET | `/api/indicators/{symbol}` | Technical indicators | RSI, MACD, SMA, etc. |
| GET | `/api/alerts` | Price alerts | Alert list |
| POST | `/api/alerts` | Create alert | Alert ID |
| DELETE | `/api/alerts/{id}` | Delete alert | Success |
| GET | `/api/reports/daily` | Daily report | Market summary |
| GET | `/api/search?q=` | Search stocks | Matching stocks |
| GET | `/api/exchanges` | List exchanges | Supported exchanges |
| POST | `/api/sync` | Trigger sync | Updated count |

### Next.js API (`https://invist.m2y.net`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register user |
| POST | `/api/auth/login` | Login user |
| GET | `/api/auth/me` | Current user |
| GET | `/api/portfolio` | User portfolio |
| POST | `/api/portfolio/holdings` | Add holding |
| GET | `/api/watchlist` | User watchlist |
| POST | `/api/watchlist` | Add to watchlist |
| GET | `/api/analysis/{symbol}` | Stock analysis |
| GET | `/api/screener` | Stock screener |
| POST | `/api/sync-live` | Sync from VPS |

---

## 🔄 Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUTTER MOBILE APP                           │
│                                                                 │
│  ┌─────────────────┐              ┌─────────────────┐          │
│  │   Stock List    │              │   Portfolio     │          │
│  │   Charts        │              │   Watchlist     │          │
│  │   Indicators    │              │   User Profile  │          │
│  └────────┬────────┘              └────────┬────────┘          │
│           │                                │                    │
└───────────┼────────────────────────────────┼────────────────────┘
            │                                │
            ▼                                ▼
┌───────────────────────┐      ┌───────────────────────┐
│   VPS API             │      │   NEXT.JS API         │
│   Port 8010           │      │   invist.m2y.net      │
│                       │      │                       │
│ • ALL stocks (295)    │      │ • User auth           │
│ • Real-time prices    │      │ • Portfolio mgmt      │
│ • Historical data     │      │ • Watchlist           │
│ • Technical indicators│      │ • Complex analysis    │
│ • Price alerts        │      │ • Data sync           │
│ • Daily reports       │      │                       │
└───────────┬───────────┘      └───────────────────────┘
            │
            ▼
┌───────────────────────┐
│   TRADINGVIEW         │
│   yfinance            │
│   (Data Sources)      │
└───────────────────────┘
```

---

## 💡 Best Practices

### 1. Caching
Cache VPS API responses for 3-5 minutes to reduce server load.

```dart
class CachedApi {
  final _cache = <String, CacheEntry>{};
  
  Future<List<Stock>> getAllStocks() async {
    const cacheKey = 'all_stocks';
    
    if (_cache.containsKey(cacheKey) && !_cache[cacheKey]!.isExpired) {
      return _cache[cacheKey]!.data;
    }
    
    final stocks = await apiService.getAllStocks();
    _cache[cacheKey] = CacheEntry(data: stocks, expiresAt: DateTime.now().add(Duration(minutes: 3)));
    return stocks;
  }
}
```

### 2. Error Handling
Always handle network errors gracefully.

```dart
try {
  final stocks = await apiService.getAllStocks();
  // Display stocks
} on SocketException {
  showError('No internet connection');
} on TimeoutException {
  showError('Request timed out');
} catch (e) {
  showError('Failed to load data: $e');
}
```

### 3. Background Updates
Use background services to update alerts and prices.

```dart
Timer.periodic(Duration(minutes: 5), (timer) async {
  await apiService.checkAlerts();
});
```

---

## 📞 Support

For API issues or questions:
- Check `/health` endpoint for status
- Contact: [Your support email]

---

*Last Updated: 2026-04-28*
