# Flutter Update Report

> **Task ID:** FLUTTER-UPDATE
> **Date:** 2026-09-30
> **Flutter repo:** https://github.com/enmohsen20111975/flutter_investment_App
> **Commit:** `658db4ea9fa307f9a3b7ee28be21f57da9cea900` (pushed to `main`)

---

## Summary

| Metric | Value |
|---|---|
| API methods added | **13** |
| New screens created | **3** |
| Files modified | **2** (`lib/api/client.dart`, `lib/screens/radar_hub_screen.dart`) |
| Files created | **3** (the new screens) |
| Flutter analyze status | **PASS** (0 issues in new code; only 1 pre-existing warning in unchanged line of `client.dart:416`) |
| Committed | **YES** (`658db4e`) |
| Pushed to remote | **YES** (`7430ede..658db4e main -> main`) |

---

## API Methods Added (13)

All 13 methods were appended to the end of the `GLMApiClient` class in `lib/api/client.dart` (inserted before the class closing brace on line 4296). Each method follows the existing pattern: try/catch, `debugPrint` on error, returns `Map<String, dynamic>`, uses the singleton `_dio` instance with bearer-token interceptor already attached.

| # | Method Signature | Endpoint | HTTP | Purpose |
|---|---|---|---|---|
| 1 | `getMarketRegime({String market = 'EGX'})` | `/api/market/regime?market=EGX` | GET | DEFENSIVE/NORMAL/AGGRESSIVE regime |
| 2 | `getExitRadar({String market = 'EGX'})` | `/api/maker-radar/exit-radar?market=EGX` | GET | 5 exit paths (X1–X5) |
| 3 | `getMultiMarketRadar({String markets = 'EGX,US,CRYPTO,GOLD'})` | `/api/maker-radar/multi-market?markets=...` | GET | 7 markets unified |
| 4 | `getRadarAccuracy({String market = 'EGX', int days = 90})` | `/api/radar/accuracy?market=EGX&days=90` | GET | Historical win rate per signal |
| 5 | `getSignalTimeline({required String ticker, int days = 30})` | `/api/maker-radar/timeline?ticker=COMI&days=30` | GET | Stock journey from entry to now |
| 6 | `getWeeklyReport()` | `/api/radar/weekly-report` | GET | Weekly PDF report data |
| 7 | `getStockPublishData({required String ticker})` | `/api/stocks/{TICKER}/publish-data` | GET | Unified stock data for publishing |
| 8 | `getPersonalizedRadar()` | `/api/radar/personalized` | GET | Personalized radar (user profile) |
| 9 | `publishStockToTelegram({required String ticker, String? market, String? channelId})` | `/api/telegram/publish-stock` | POST | Send to Telegram channel |
| 10 | `getEntryTiming({required String ticker})` | `/api/maker-radar/entry-timing?ticker=COMI` | GET | 0–100 entry timing score |
| 11 | `getLiquidityFootprint({required String ticker, int days = 30})` | `/api/maker-radar/footprint?ticker=COMI&days=30` | GET | Volume profile (POC/VAH/VAL) |
| 12 | `getSectorTreemap({int days = 30})` | `/api/maker-radar/sector-treemap?days=30` | GET | Sector liquidity treemap |
| 13 | `getSignalTrackerStats({int days = 30, String? signalType})` | `/api/maker-radar/signal-tracker?days=30&signal_type=...` | GET | Win rate per signal type |

**Error-handling contract:** every new method returns `{'success': false, 'error': e.toString()}` on network failure (so screens can branch on `data['success'] == false`); on success, returns the raw `response.data` Map (or wraps non-Map responses as `{'data': response.data}`).

**No existing code modified** — only appended. Diff stats: `lib/api/client.dart | 197 ++++++++++++++++++++++++++++++++++++++` (pure additions, zero deletions).

---

## Screens Created (3)

### 1. MarketRegimeScreen
- **Path:** `lib/screens/market_regime_screen.dart`
- **LOC:** 492
- **Calls:** `GLMApiClient.instance.getMarketRegime(market: 'EGX')`
- **UI sections:**
  - Large color-coded regime badge — DEFENSIVE=red 🛡️, NORMAL=amber ⚖️, AGGRESSIVE=green 🚀
  - 6-indicator grid (index trend / breadth / ATR / turnover / loss streak / drawdown — auto-maps any key)
  - "أسباب الحالة" reasons list (bullet items)
  - "تاريخ الحالات" history list (last 10 regime changes with date)
  - Meta card (market + last update timestamp)
- **State:** `FutureProvider.autoDispose` (riverpod), RTL `Directionality`, refresh button in AppBar

### 2. ExitRadarScreen
- **Path:** `lib/screens/exit_radar_screen.dart`
- **LOC:** 500
- **Calls:** `GLMApiClient.instance.getExitRadar(market: 'EGX')`
- **UI sections:**
  - Top summary bar: total stocks / paths present / market / last update
  - 5 collapsible sections (X1 Momentum Loss 📉, X2 Distribution 💧, X3 Volume Climax 📊, X4 Trend Break 🔻, X5 Weakness Pattern ⚠️)
  - Each section expands to show its stock cards: ticker badge + name + reason + price + change% + strength
  - Robust parser: tries `data['paths']`, `data['exit_paths']`, or flat top-level `{X1: [...]}` shape — works regardless of backend response shape
- **State:** `FutureProvider.autoDispose` (riverpod), RTL, refresh button

### 3. MultiMarketRadarScreen
- **Path:** `lib/screens/multi_market_radar_screen.dart`
- **LOC:** 583
- **Calls:** `GLMApiClient.instance.getMultiMarketRadar(markets: 'EGX,US,CRYPTO,GOLD,TADAWUL,KSE,QSE')`
- **UI sections:**
  - Top header (gradient): markets count + unified picks count + last update
  - Markets summary grid (2 cols): each card has flag emoji 🇪🇬🇺🇸🇸🇦🇰🇼🇶🇦🥇₿ + code + Arabic name + stock count + regime badge
  - "أعلى 5 فرص موحّدة" top picks list: rank medal (🥇🥈🥉) + ticker + market flag + signal type + score badge + price
- **State:** `FutureProvider.autoDispose` (riverpod), RTL, refresh button

---

## Navigation Wiring

`lib/screens/radar_hub_screen.dart` was expanded from **2 tabs → 5 tabs**:

| # | Tab Label | Icon | Screen |
|---|---|---|---|
| 1 | الأسهم الانفجارية | `local_fire_department_rounded` | `HunterScreen` (existing) |
| 2 | رادار السيولة | `radar_rounded` | `RadarScreen` (existing) |
| 3 | **حالة السوق** (NEW) | `shield_moon_outlined` | `MarketRegimeScreen` (new) |
| 4 | **رادار الخروج** (NEW) | `logout_outlined` | `ExitRadarScreen` (new) |
| 5 | **الرادار الموحّد** (NEW) | `public` | `MultiMarketRadarScreen` (new) |

- `TabController.length` 2 → 5
- `SingleTickerProviderStateMixin` → `TickerProviderStateMixin` (multi-tab requirement)
- TabBar set to `isScrollable: true` + `tabAlignment: TabAlignment.start` to fit 5 tabs cleanly on small phones
- `initialTabIndex` clamped to `[0, 4]` to prevent `IndexOutOfRangeException`
- All 3 new screens render inside the existing `TabBarView` — reachable from the same bottom-nav entry (`case 2` in `app.dart:_buildScreen`)

---

## Flutter Analyze Result

**Command:**
```
cd /tmp/flutter_investment_App
flutter analyze lib/api/client.dart lib/screens/market_regime_screen.dart \
  lib/screens/exit_radar_screen.dart lib/screens/multi_market_radar_screen.dart \
  lib/screens/radar_hub_screen.dart
```

**Output:**
```
Analyzing 5 items...
warning • Unnecessary cast • lib/api/client.dart:416:51 • unnecessary_cast
1 issue found. (ran in 4.8s)
```

The single remaining warning is in **pre-existing code** (`getStocks` method, line 416 — `Map<String, dynamic>.from(payload as Map)` — written before this task and not touched by the new commits). All 13 new API methods + 3 new screens + radar_hub_screen rewrite have **zero analyzer issues**.

**Initial run on full project:** 143 issues (all pre-existing — `withOpacity` deprecations, unused `isAr` locals, etc.). After this commit, 142 of those remain unchanged in untouched files; the new code added **0 new issues**.

**Fix applied during this phase:** removed an unnecessary `k is String` type check in `exit_radar_screen.dart:149` (the keys of `Map<String, dynamic>` are already `String`, so the check was redundant — analyzer flagged it as `unnecessary_type_check`).

---

## Commit + Push Status

```bash
$ git log --oneline -3
658db4e feat: add 13 new API methods + 3 new screens (regime + exit-radar + multi-market)
7430ede feat(routing): wire 5 new screens into app.dart navigation
```

```bash
$ git push origin main
To https://github.com/enmohsen20111975/flutter_investment_App
   7430ede..658db4e  main -> main
```

- **Commit hash:** `658db4ea9fa307f9a3b7ee28be21f57da9cea900`
- **Pushed:** YES (live on `origin/main`)
- **5 files changed, 1839 insertions(+), 28 deletions(-)** (28 deletions are the original 2-tab TabBar block being replaced with the new 5-tab version)

---

## Verification Checklist

- [x] 13 new API methods added to `GLMApiClient` class (appended, not replacing)
- [x] All methods use the singleton `_dio` instance (auto-attaches bearer token interceptor)
- [x] All methods return `Future<Map<String, dynamic>>` (consistent with existing radar methods)
- [x] All methods have try/catch + `debugPrint` on error (matches existing pattern)
- [x] 3 new screen files created in `lib/screens/`
- [x] All screens use `Directionality(textDirection: TextDirection.rtl, ...)` for Arabic RTL
- [x] All screens use `flutter_riverpod` `FutureProvider.autoDispose` (matches `radar_screen.dart` pattern)
- [x] All screens use existing widgets: `LoadingWidget`, `EmptyStateWidget`
- [x] All screens use existing theme: `AppColors`, `AppTypography`
- [x] Screens wired into `RadarHubScreen` (5-tab hub) — reachable from existing bottom-nav entry
- [x] `flutter analyze` — 0 issues in new code
- [x] Committed with descriptive message
- [x] Pushed to `origin/main` successfully
- [x] No existing APIs modified or removed — purely additive

---

## Next Actions for the User

1. **Pull the latest:** `git pull origin main` on your dev machine.
2. **Run `flutter pub get`** to ensure dependency lock is current.
3. **Test the new tabs:** launch the app → tap "رادار" (radar) bottom-nav → you'll see 5 tabs across the top. Tap "حالة السوق" (Market Regime), "رادار الخروج" (Exit Radar), and "الرادار الموحّد" (Multi-Market Radar).
4. **Backend endpoints:** ensure the Next.js backend at `https://invist.m2y.net` exposes all 13 new endpoints. The Flutter screens will gracefully show the Arabic error message "تعذّر الحصول على …" if any endpoint returns 404/500.
5. **Optional follow-up screens** (not in this task's scope but easy to add since the API methods now exist):
   - "التقرير الأسبوعي" screen using `getWeeklyReport()`
   - "الدقة التاريخية" tab in radar_hub using `getRadarAccuracy()`
   - "نشر السهم" button in stock detail using `publishStockToTelegram()`
