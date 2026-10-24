# تکلیف: ALPHA-CHART-MERGE-1 (محدّث)

> **موجہ لـ:** ألفا (Frontend)
> **من:** جون (المدير التنفيذي)
> **التاريخ:** 2026-10-19 (تحديث 2)
> **الخطورة:** 🟠 HIGH — بس محتاط (دمج مميزات، مش نقل كود)

---

## المطلوب (بـ التبسيط)

**مش نقل كود.** كل مكون فيه أساسيات ثابتة — ما نلمسهاش. اللي نعمله:

1. **InteractiveChart** (1701 سطر) يفضل زي ما هو — **ما نلمسش الـ chart logic بتاعه.**
2. أضف له **المميزات الناقصة من ProfessionalTradingChart** كـ **props إضافية + render sections**:
   - DecisionHeader (signal + entry/stop/target/R:R)
   - TradePlanCard (BUY signals only)
   - ReasonsForDecision (5 cards)
   - CollapsibleTechnicalDetails
   - RescueClinicBanner
   - Buy-signal gate (HOLD/SELL → hide plan + show warning)
3. **نـ fix الـ 3 bugs**:
   - `regimeColor` (غلط: marketRegime → الصح: regimeColor)
   - `bbSqueezeLevel` (غلط: bbSqueeze → الصح: bbSqueezeLevel)
   - 8 props ناقصة (target3Price + livePrice + cmfData + macdProjection + smartMarkers + smcData + fusionMetrics + regimeColor)
4. **TradingChartView** يـ import InteractiveChart مباشرة.
5. **ProfessionalTradingChart** يتشال (مميزاته اتنقلت لـ InteractiveChart).

### القاعدة: InteractiveChart يكبر بـ ~200-300 سطر (الـ sections) — مش نقل 825 سطر كامل.

### الـ props الجديدة (تتضاف لـ FullChartProps):

```typescript
// إضافات من ProfessionalTradingChart (مش نقل كود — بس props + render)
interface InteractiveChartProps extends FullChartProps {
  // === من ProfessionalTradingChart ===
  canonical?: {
    signal?: string;        // BUY/HOLD/SELL
    entry_price?: number;
    stop_loss?: number;
    target_price?: number;
    target_price_2?: number;
    tech_score?: number;
    risk_reward?: number;
  };
  showDecisionHeader?: boolean;    // default: true
  showTradePlan?: boolean;         // default: true (BUY only)
  showReasons?: boolean;           // default: true
  showRescueCTA?: boolean;         // default: true
  initialTicker?: string;          // للـ self-contained mode
}
```

### الـ render الجديد في InteractiveChart:

```tsx
return (
  <div className="space-y-4">
    {/* §1 Decision Header (لو canonical موجود) */}
    {canonical && showDecisionHeader && <DecisionHeader ... />}

    {/* §2 Regime badge + Market warning (لو موجودين في props) */}

    {/* §3 الـ chart الفعلي — زي ما هو بالظبط (ما نلمسش) */}
    <div ref={chartContainerRef} />

    {/* §4 Trade Plan (BUY only — لو canonical.signal === 'BUY') */}
    {canonical?.signal === 'BUY' && showTradePlan && <TradePlanCard ... />}

    {/* §5 Reasons (5 cards) */}
    {showReasons && <ReasonsForDecision ... />}

    {/* §6 Collapsible Technical Details */}
    <CollapsibleTechnicalDetails ... />

    {/* §7 Rescue CTA */}
    {showRescueCTA && <RescueClinicBanner ticker={...} />}
  </div>
);
```

### الـ files اللي هتتعدل:

| File | التعديل |
|---|---|
| `InteractiveChart.tsx` | أضف props + render sections (زي ما هو + sections جديدة) |
| `TradingChartView.tsx` | import InteractiveChart مباشرة (شيل ProfessionalTradingChart) |
| `SingleStockAnalysisView.tsx` | يـ pass الـ props الجديدة (canonical + showDecisionHeader) |
| `ProfessionalTradingChart.tsx` | **شيل** (مميزاته اتنقلت) |
| `market-analysis/index.ts` | شيل export ProfessionalTradingChart |

### الاختبارات:
- `bun run lint` → 0 errors.
- `#trading-chart` بيرندر InteractiveChart بكل المميزات.
- `#stocks` → StockDetail → toggle → InteractiveChart.
- PersonaTab → SingleStockAnalysisView → InteractiveChart.
- مفيش regression.

### المحظورات:
- 🚫 ما تلمسش الـ chart logic بتاع InteractiveChart (الـ 1701 سطر).
- 🚫 ما تنقلش كود من ProfessionalTradingChart — بس اعمل render sections جديدة.
- 🚫 ما تكسّرش FullChartProps القديم — وسّعه بس.
- 🚫 ما تلمسش TradingViewChart.tsx.
