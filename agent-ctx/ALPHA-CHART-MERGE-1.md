# تكلیف: ALPHA-CHART-MERGE-1

> **موجہ لـ:** ألفا (Frontend)
> **من:** جون (المدير التنفيذي)
> **التاريخ:** 2026-10-19
> **الخطورة:** 🔴 CRITICAL — دمج 2526 سطر في مكون واحد
> **القواعد:** Rule 4 (NO-NEW-FILES), Rule 20 (Python=Brain), Rule 27 (NO-FAKE-DATA), Rule 67 (CALCULATION-CANONICAL), Rule 73 (SINGLE-DISPLAY-SOURCE)

---

## المطلوب

ادمج `ProfessionalTradingChart.tsx` (825 سطر) + `InteractiveChart.tsx` (1701 سطر) في **مكون واحد** باسم `InteractiveChart` في نفس المكان (`src/modules/market-analysis/components/InteractiveChart.tsx`).

### الـ flow الجديد:
```
أي شاشة فيها شارت → العميل يبدل بين:
  ├── TradingViewChart (الـ iframe الرسمي — يفضل زي ما هو، مش لمسه)
  └── InteractiveChart (الـ chart المدمج الجديد — فيه كل المميزات)
```

### المميزات المطلوبة في InteractiveChart المدمج:

**من InteractiveChart (الـ chart الفعلي):**
- Multi-pane layout (Volume / RSI / CMF / MACD كل في pane منفصل)
- SMC panels (Order Blocks / FVG / Sweeps)
- V20 Fusion metrics (VWAP / Golden Pocket / Risk profile)
- BOS markers + Smart markers
- MACD projection (future mirror)
- CMF overlay
- Live price update (WebSocket)
- BB squeeze highlight
- Auto Fibonacci retracement (7 levels)
- EMA9 + EMA21
- Regime badge (floating chip)
- Sanitize candles (defensive)
- fitContent context-aware (preserve user zoom)
- Props-only interface (FullChartProps)

**من ProfessionalTradingChart (الـ 7 أقسام):**
- §1 DecisionHeader (signal badge + entry/stop/target/R:R/techScore — BUY signals only)
- §2 Regime differentiation badge (falling knife / pullback / sideways / healthy uptrend) + MarketWarning
- §3 Chart area (الـ InteractiveChart الفعلي)
- §4 TradePlanCard (entry/stop/TP1/TP2 + R:R + position size % — BUY signals only)
- §5 ReasonsForDecision (5 cards)
- §6 CollapsibleTechnicalDetails (RSI/MACD/ATR/TechScore + InstitutionalDecisionPanel)
- §7 RescueClinicBanner (CTA → /rescue?ticker=)
- Buy-signal gate (HOLD/WAIT/SELL/AVOID → يخفي الـ trade plan + يعرض تحذير)
- Timeframe selector (DAY/WEEK/MONTH)
- Quick-add price alert
- Screenshot (html-to-image)
- Maximize toggle
- Refresh button
- Alert panel slide-over
- Live ticker (LIVE/DELAYED badge)
- StockSearchSelector in header
- Canonical decision data (from /api/stocks/[ticker]/unified)

### الـ props الجديدة (FullChartProps موسّعة):

```typescript
interface InteractiveChartProps extends FullChartProps {
  // === props من ProfessionalTradingChart ===
  // الـ data الفعلي (OHLCV + indicators + levels + decision + confluence)
  // الـ parent بـ fetch من /api/v2/chart/full-analysis + /api/stocks/[ticker]/unified
  // ويمررها كلها للـ InteractiveChart

  // OR: self-contained mode (لو الـ parent مش بـ fetch)
  initialTicker?: string;  // لو موجود → InteractiveChart بـ fetch بنفسه
  market?: string;         // default 'EGX'
  timeframe?: 'DAY' | 'WEEK' | 'MONTH';
}
```

### الـ data flow:

```
Mode 1 (props-only — من SingleStockAnalysisView):
  parent بـ fetch /api/v2/chart/full-analysis → يمرر OHLCV + indicators + levels + decision + confluence
  
Mode 2 (self-contained — من TradingChartView):
  InteractiveChart بـ fetch بنفسه:
  ① /api/stocks/[ticker]/unified → canonical signal/score/entry/stop/target
  ② /api/v2/chart/full-analysis?ticker=&timeframe=&limit=365 → OHLCV + indicators + levels + decision + confluence
```

### الـ files اللي هتتعدل:

| File | التعديل |
|---|---|
| `InteractiveChart.tsx` | **دمج** — يبقى فيه الـ chart الفعلي + الـ 7 أقسام |
| `ProfessionalTradingChart.tsx` | **شيل** — اتدمج في InteractiveChart |
| `TradingChartView.tsx` | **عدل** — يرندر InteractiveChart مباشرة (مش ProfessionalTradingChart) |
| `SingleStockAnalysisView.tsx` | **عدل** — يرندر InteractiveChart مباشرة (نفس الـ props) |
| `market-analysis/index.ts` | **عدل** — شيل export ProfessionalTradingChart |

### الـ bugs اللي لازم تـ fix في الدمج:

1. **regimeColor** — ProfessionalTradingChart بـ pass `marketRegime` (غلط). الصح `regimeColor`.
2. **bbSqueezeLevel** — بـ pass `bbSqueeze` (غلط). الصح `bbSqueezeLevel`.
3. **8 props ناقصة** — target3Price + livePrice + cmfData + macdProjection + smartMarkers + smcData + fusionMetrics.

في الدمج، كل الـ props دي هتبقى متاحة مباشرة (مش محتاجة wrapper).

### الاختبارات الصارمة:

- `bun run lint` → 0 errors.
- `npx tsc --noEmit` → 0 errors في الـ files المعدّلة.
- Agent Browser:
  - `#trading-chart` بيرندر InteractiveChart بكل المميزات (SMC + Fusion + BOS + decision header + trade plan).
  - `#stocks` → StockDetail → toggle → InteractiveChart.
  - PersonaTab → SingleStockAnalysisView → InteractiveChart.
  - مفيش regression في أي شاشة.

### المحظورات:
- 🚫 ما تلمسش `TradingViewChart.tsx` — يفضل زي ما هو.
- 🚫 ما تكسّرش الـ props interface القديم (FullChartProps) — وسّعه بس.
- 🚫 ما تـ inventش بيانات (Rule 27).
- 🚫 ما تـ pushش (Rule 75 معلّقة — جون هـ push).

---

**جون — الدمج ده شغل ألفا. هي اللي تنفّذ. أنا audit + فهم + brief.**
