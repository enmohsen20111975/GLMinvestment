# GLM5.3-S2-COPY-ANALYSIS — Copy Analysis Button Agent

**Task ID:** GLM5.3-S2-COPY-ANALYSIS
**Agent:** Copy Analysis Button Agent (S2)
**Commit:** `93f5064f`
**Branch:** `main` (pushed to `origin/main`)
**File modified:** `src/modules/predictions/components/MakerRadarTab.tsx` (+201 / −2)

## What was added

### 1. `formatProfessionalAnalysis(ticker, stockInfo, detail, radarStock)` helper

Builds the canonical Arabic share-ready text per the spec template. Returns a
multi-line string with the exact header / divider / bullet structure requested.

```text
📊 تقرير رادار السيولة وصانع السوق | [name] ([ticker])
━━━━━━━━━━━━━━━━━━━━
🔹 السعر الحالي: XX.XX ج.م
🔹 حالة السهم: [تجميع هادئ / تصريف ذكي / انطلاق وشيك]
🔹 سلوك صانع السوق (Wyckoff): [مرحلة التجميع / امتصاص العروض / اختبار القاع]
🔹 سيولة السهم ومؤشر MFI: — - [تدفق إيجابي / تدفق سلبي]
🔹 نطاق الدخول الآمن: من XX.XX إلى XX.XX ج.م
🔹 مستهدفات الحركة: هدف أول XX.XX ج.م | هدف ثانٍ XX.XX ج.م
🔹 وقف الخسارة الفولاذي: XX.XX ج.م (كسر بإغلاق)
━━━━━━━━━━━━━━━━━━━━
💡 رؤية المحلل: [signal]
📌 منصة GLM Investment — نظام كشف السيولة الذكية
```

### 2. `copyToClipboardWithFallback(text)` helper

1. **Modern API** — uses `navigator.clipboard.writeText(text)` but only when
   `window.isSecureContext === true` (HTTPS or localhost). Catches and warns
   on any exception, then continues to the fallback.
2. **Legacy fallback** — creates a hidden `<textarea>` and calls
   `document.execCommand('copy')`. Works on HTTP dev environments and old
   browsers that lack the modern clipboard API.

### 3. "نسخ التحليل الاحترافي" button (prominent, design-token styled)

Added to the `StockDetailDrawer` sticky header BEFORE `UnifiedPublishButton`:

- Icon: `Copy` from `lucide-react` (loading state: `Loader2` spinning)
- Text: `نسخ التحليل الاحترافي` (collapses to `نسخ` on mobile via `sm:hidden`)
- Variant: `default` (which resolves to `bg-primary` / `text-primary-foreground`)
- Additional classes: `bg-primary text-primary-foreground hover:bg-primary/90
  shadow-sm font-semibold` — **NO raw hex colors**
- On success: `toast.success('تم نسخ التحليل بنجاح!')`
- On failure: `toast.error('تعذّر نسخ التحليل — حاول مرة أخرى')`

## Rule Compliance

| Rule | Status |
|------|--------|
| Rule 27 (NO-FAKE-DATA) | ✅ Missing fields render as `—` (MFI is NOT in StockDetail API — never fabricated). Liquidity flow derived from real `roc10d`. Entry / target / stop values pulled ONLY from `detail.prediction`. |
| Rule 4 (NO-DELETION) | ✅ No existing buttons / features touched. The new button is ADDED to the header alongside `UnifiedPublishButton`, the track button, the "صفحة السهم" button, and the close button. |
| Rule 75 (PUSH-AFTER-EVERY-TASK) | ✅ Commit `93f5064f` pushed immediately after file modification. |
| Design tokens only | ✅ No raw `#hex` colors used in the new button. |

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit --skipLibCheck` (filtered for MakerRadarTab) | 6 errors — ALL pre-existing in `TradingPlanSection` (lines 3589 / 3608 / 3642). **0 NEW errors** introduced by this task. |
| `bun run lint` | Clean (0 errors / 0 warnings) |
| Pre-commit hook | PASS (3/3 guards: `check_no_raw_insert.py`, `check_no_hard_delete.py`, `pre-commit-ticker-registry`) |
| `curl http://localhost:3000` | HTTP 200 (36,952 bytes) — page renders |

## How to verify in the UI

1. Open the **Preview Panel** (or click "Open in New Tab").
2. Navigate to the **رادار الميكرز** (Maker Radar) tab.
3. Click on any stock ticker row to open the `StockDetailDrawer`.
4. In the drawer's sticky header (top-right), find the prominent **نسخ التحليل الاحترافي** button (with the Copy icon, primary-color background).
5. Click it → a sonner toast appears: `تم نسخ التحليل بنجاح!`.
6. Paste (`Ctrl/Cmd+V`) anywhere — the canonical share-ready analysis text appears.
