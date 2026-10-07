# 📐 UNIFIED DATA CONTRACT — عقد التوحيد للمصدر الموحد للبيانات

**التاريخ:** 2026-10-07
**المرجع:** UI-AUDIT-1 + API-AUDIT-2 + TELEGRAM-AUDIT-1 + CALC-AUDIT-1 + CALC-DUP-1
**القاعدة:** Rule 67 (CALCULATION-CANONICAL) + Rule 27 (NO-FAKE-DATA)

---

## 🚨 الكارثة المكتشفة

**نفس السهم = بيانات مختلفة على 7 شاشات + التليجرام**

مثال: ETCL (المصرية للاتصالات) في نفس اللحظة بـ يطلع:

| الشاشة | signal | accumulation | rsi | support | resistance |
|--------|--------|--------------|-----|---------|------------|
| بطاقة إنفوجرافيك السهم | HOLD | ضغط شرائي قوي | 52 | 145 | 155 |
| بطاقة السيولة (رادار) | — | تجميع قوي ✅ | — | 142 | 158 |
| تفاصيل السهم (Stocks) | INSTITUTIONAL_BUY | تجميع قوي | 54 | 144 | 156 |
| الشارت التفاعلي | — | — | 50 (SMA-based ❌) | — | — |
| رادار السيولة | quiet_accum_strong | تجميع قوي | — | — | — |
| التوقعات | HOLD | — | 52 | — | — |
| تليجرام bot | متابعة | ضغط شرائي | 52 | 142 | 156 |

**النتيجة:** العميل بيشوف 3 إشارات + 3 أسعار دعم/مقاومة + 3 قيم RSI مختلفة → فقد الثقة في النظام.

## 🔢 الأرقام الفعلية للتناقضات

- **accumulation label:** 5 صيغ مختلفة (تجميع/تصريف، تجميع شهري، ضغط شرائي/بيعي، ...)
- **support/resistance:** 5+ صيغ fallback (×0.95، ×0.96، ×0.97، ×0.99، ×1.01، ×1.03، ×1.05، ×1.10)
- **RSI:** 3 صيغ (Wilder صح، SMA خاطئ، EMA بـ seed مختلف)
- **signal classification:** 4 أنظمة thresholds مختلفة (78/65/55، 75/60/50، 75/70/60، 70/50/30)
- **phase:** 4 taxonomies مختلفة كلها اسمها "phase"
- **target_price_2:** 3 routes بـ fabricate `target1 * 1.05` لو NULL (Rule 27 violation)

## ✅ الحل — UNIFIED DATA CONTRACT

كل metric له **مصدر واحد فقط** (canonical source). كل الشاشات + APIs + التليجرام لازم يقرأوا منه.

### المصادر الموحدة (Canonical Sources)

| # | Metric | Canonical Source | ملف المرجع |
|---|--------|-----------------|-----------|
| 1 | **signal classification** | `predictions.db.predictions.signal` (الجدول الموحد) | `vps-service/utils/canonical_signal.py::classify_signal()` |
| 2 | **accumulation** | `vps-service/utils/canonical_signal.py::classify_accumulation(buy_pct)` | نفسه |
| 3 | **money_flow_state** | `vps-service/utils/canonical_signal.py::classify_money_flow()` | نفسه |
| 4 | **stock_phase** | `vps-service/utils/canonical_signal.py::classify_stock_phase()` | نفسه |
| 5 | **volume_ratio** | `vps-service/utils/canonical_signal.py::classify_volume_ratio()` | نفسه |
| 6 | **ATR** | `vps-service/analyzers/indicators/atr.py::calc_atr()` (Wilder's) | Rule 67 |
| 7 | **RSI** | `vps-service/analyzers/indicators/rsi.py::calc_rsi()` (Wilder's) | Rule 67 |
| 8 | **SMA/EMA/MACD** | `vps-service/analyzers/indicators/ma.py` | Rule 67 |
| 9 | **VWAP** | `vps-service/analyzers/technical_analyzer.py::calc_vwap()` | Rule 67 |
| 10 | **OBV** | `vps-service/analyzers/technical_analyzer.py::calc_obv()` | Rule 67 |
| 11 | **support/resistance** | `stocks.db.stocks.support` + `stocks.db.stocks.resistance` (pre-computed) | Rule 67 |
| 12 | **master_score** | `predictions.db.predictions.master_score` (raw) | لا recomputation |
| 13 | **target_price/2/3** | `predictions.db.predictions.target_price/2/3` (raw) — NO fabrication | Rule 27 |
| 14 | **stop_loss** | `predictions.db.predictions.stop_loss` (raw) — NO fabrication | Rule 27 |
| 15 | **buy_pct/sell_pct** | `vps-service/utils/shared_liquidity.py::compute_money_flow()` | Rule 67 |
| 16 | **price (live)** | `stocks.db.stocks.current_price` + `last_update` | FRESHNESS GUARD |

### 1. النظام المرجعي للتوقعات (canonical predictions source)
```
predictions.db.predictions table
  ↳ signal, master_score, entry_price, target_price, target_price_2, stop_loss
  ↳ analysis_json (analysis_reason, who_is_buying, hmm_regime, target_3, support, resistance)
```

**Route:** `GET /api/predictions/honest-tracking/list?ticker=ETEL`
- raw passthrough — NO mutation, NO fabrication
- كل الشاشات تقرأ منه

### 2. النظام المرجعي لبيانات الرادار (canonical radar source)
```
scripts/output/maker_radar_<MARKET>_<date>.json
  ↳ current_price, buy_pct, sell_pct, accumulation, money_flow_state, phase
  ↳ data_quality, staleness_days, live_price (FRESHNESS GUARD)
```

**Route:** `GET /api/maker-radar?market=EGX`
- reads cache JSON + enriches with live prices from stocks.db

### 3. النظام المرجعي للمؤشرات الفنية (canonical indicators source)
```
stocks.db.stocks table (pre-computed by Python canonical)
  ↳ rsi, ma_50, ma_200, support, resistance, smc_signal, trend
```

**Route:** `GET /api/stocks/[ticker]` (direct SQLite read — NO recomputation)

---

## 📋 خطة الترحيل (3 مراحل)

### المرحلة الأولى: إنشاء TS port + إصلاح fabrications (اليوم)
1. ✅ `vps-service/utils/canonical_signal.py` (Python)
2. ⚠️ `src/lib/canonical-signal.ts` (TypeScript port — للـ frontend + APIs)
3. ⚠️ Fix 3 fabrication sites:
   - `src/app/api/stocks/[ticker]/comprehensive/route.ts:184-222` (support/resistance rewrite)
   - `src/app/api/stocks/[ticker]/publish-data/route.ts:397-405` (target2/stop/support fabrication)
   - `src/app/api/smart-confluence/analysis/[symbol]/route.ts:47-72` (hardcoded neutral fallback)

### المرحلة الثانية: ترحيل UI components (الأسبوع ده)
4. `src/modules/stock-analysis/components/StockDetail.tsx` (6 fabrications)
5. `src/modules/publishing/components/UnifiedPublishButton.tsx` (5 fabrications)
6. `src/modules/stock-analysis/components/ComprehensiveStockAnalysis.tsx:134` (missing ACCUMULATE/REDUCE)
7. `src/modules/charts/components/TradingViewChart.tsx` (RSI = SMA — خطأ)
8. `src/modules/charts/components/InteractiveChart.tsx` (EMA seed مختلف)
9. `src/modules/stock-analysis/components/StocksView.tsx:1551-1570` (client-side overbought/oversold)
10. `src/modules/specialist-analysis/components/SpecialistAnalysisView.tsx:874-943` (non-canonical labels)

### المرحلة الثالثة: ترحيل Telegram (الأسبوع الجاي)
11. `vps-service/telegram/auto_poster.py` (highest-volume publisher)
12. `src/modules/publishing/lib/stock-publish-text.ts` (admin publish button)
13. `vps-service/telegram/liquidity_alerts.py` (uses stalest data)
14. `vps-service/telegram/telegram_interactive_bot.py`
15. `vps-service/telegram/telegram_target_hit_tracker.py`
16. `vps-service/telegram/telegram_chart_generator.py`
17. `vps-service/analyzers/reports_engine.py`

### المرحلة الرابعة: حذف التكرارات (deprecate routes)
18. `/api/maestro/route.ts` (duplicates `/api/maestro/overview`)
19. `/api/stocks/[ticker]/professional-analysis` (duplicates `/api/stocks/[ticker]/recommendation`)
20. `/api/predictions/tracking/list` (subset of `/api/predictions/honest-tracking/list`)
21. `/api/mobile/stocks/[ticker]` (drops important fields — mobile users see less)

---

## 🎯 قاعدة جديدة (UNIFIED-DATA-CONTRACT)

> **أي شاشة/API/Telegram** يعرض أي metric من القائمة الـ 16 فوق، لازم يقرأ من الـ Canonical Source المحدد. أي recomputation client-side أو fallback بـ hardcoded values = bug.

**الفحص الذاتي:**
```bash
# 1. تأكد إن canonical_signal.py شغّال
python3 vps-service/utils/canonical_signal.py

# 2. تأكد إن مفيش fabrications
grep -rn "0.95\|0.96\|0.97\|1.05\|1.06" src/app/api/stocks/ --include="*.ts" | grep -E "support|resistance|stop"

# 3. تأكد إن canonical_signal مستورد في كل ملف بيعرض accumulation
grep -rn "canonical_signal\|canonical-signal" src/ vps-service/ --include="*.ts" --include="*.tsx" --include="*.py"

# 4. تأكد إن RSI بـ Wilder's (مش SMA) في كل ملفات الـ charts
grep -rn "calc_rsi\|computeRSI" src/modules/charts/
```

## أوامر السرفر بعد تطبيق المرحلة الأولى

```bash
cd /root/GLMinvestment
git pull origin main

# شغّل self-test
python3 vps-service/utils/canonical_signal.py

# شغّل الرادار لإعادة توليد الإشارات بـ canonical
python3 scripts/maker_radar.py --market EGX --json-only

# تحقق إن ETCL بيقول نفس الكلام على كل الشاشات
python3 -c "
import json
data = json.load(open('scripts/output/maker_radar_EGX_20261007.json'))
for r in data.get('all_results', []):
    if r.get('ticker') == 'ETEL':
        print(f'ETEL (radar): accum={r[\"accumulation\"]} flow={r[\"money_flow_state\"]} src={r[\"price_source\"]}')
"
```

النتيجة المتوقعة: ETEL بيقول "تجميع قوي" + "🟢 سيولة داخلة" + "live" على كل الشاشات + التليجرام.
