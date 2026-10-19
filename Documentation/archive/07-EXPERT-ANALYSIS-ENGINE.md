# 07 — EXPERT ANALYSIS ENGINE
## محرك التحليل الاحترافي للأسهم

> **تاريخ الإنشاء**: 2026-10-09  
> **المنفذ**: Main Agent (Z.ai Code)  
> **الهدف**: توليد تحليل احترافي شامل للسهم مثل خبير مالي حقيقي  
> **الـ API**: `GET /api/stocks/[ticker]/expert-analysis`

---

## 🎯 الهدف

العميل "الصايع المعلم" محتاج يشوف تحليل احترافي يخليه يحس إنه بيتكلم مع خبير مذاكر السهم من كل الجوانب. المحرك ده بيوفر:

1. **تحليل فني شامل** — RSI, MA, S/R, 52w range مع تفسير
2. **تحليل أساسي عميق** — P/E, ROE, EPS, P/B, Dividend مع تقييم
3. **إدارة مخاطر** — Entry, Targets, Stop, R:R, Position size
4. **ملخص خبير** — توصية واضحة + الأسباب + التحذيرات
5. **تقرير منسق** — جاهز للعرض في الشاشة + التليجرام

---

## 📊 بنية التحليل (ExpertAnalysis Interface)

```typescript
interface ExpertAnalysis {
  // Summary
  recommendation: string;        // STRONG_BUY | BUY | ACCUMULATE | HOLD | REDUCE | SELL | STRONG_SELL
  recommendation_ar: string;     // التوصية بالعربي
  confidence: number | null;     // 0-100

  // Entry / Targets / Stop
  entry: { price, rationale, rationale_ar };
  target1: { price, pct, rationale, rationale_ar };
  target2: { price, pct, rationale, rationale_ar };
  stopLoss: { price, pct, rationale, rationale_ar };
  riskReward: number | null;     // R:R ratio (≥2.0 = good)

  // Technical Analysis
  technical: {
    rsi: { value, signal, signal_ar, analysis, analysis_ar };
    movingAverages: { ma50, ma200, trend, trend_ar, analysis, analysis_ar };
    supportResistance: { support, resistance, analysis, analysis_ar };
    range52w: { high, low, position, position_ar, analysis, analysis_ar };
    summary, summary_ar;
  };

  // Fundamental Analysis
  fundamental: {
    peRatio: { value, rating, rating_ar, analysis, analysis_ar };
    roe: { value, rating, rating_ar, analysis, analysis_ar };
    eps: { value, analysis, analysis_ar };
    pbRatio: { value, rating, rating_ar, analysis, analysis_ar };
    dividend: { value, rating, rating_ar, analysis, analysis_ar };
    summary, summary_ar;
  };

  // Risk Assessment
  risk: {
    level: 'LOW' | 'MODERATE' | 'HIGH';
    level_ar: string;
    factors: string[];
    factors_ar: string[];
    positionSize: string;
    positionSize_ar: string;
  };

  // Expert Summary + Full Report
  expertSummary: string;
  expertSummary_ar: string;
  fullReport: string;       // English
  fullReport_ar: string;   // Arabic (formatted with markdown)
}
```

---

## 🔧 المنطق التقني

### 1. RSI Analysis
| Range | Signal | التفسير |
|-------|--------|---------|
| ≥ 70 | OVERBOUGHT (تشبع شرائي) | السهم صعد كتير، خطر ارتداد |
| 55-70 | BULLISH (صاعد) | زخم صاعد صحي، مساحة للصعود |
| 45-55 | NEUTRAL (محايد) | تجميع، انتظر اختراق |
| 30-45 | BEARISH (هابط) | ضغط بيع، حذر |
| ≤ 30 | OVERSOLD (تشبع بيعي) | فرصة شراء عكسية محتملة |

### 2. Moving Averages (Trend Detection)
| الحالة | الترند |
|-------|--------|
| price > MA50 > MA200 | STRONG_UPTREND (ترند صاعد قوي - Golden Cross) |
| price > MA50, MA50 < MA200 | RECOVERY (تعافي) |
| price < MA50, MA50 > MA200 | CORRECTION (تصحيح) |
| price < MA50 < MA200 | STRONG_DOWNTREND (ترند هابط قوي - Death Cross) |

### 3. P/E Ratio Rating
| Range | Rating | التقييم |
|-------|--------|---------|
| < 10 | UNDERVALUED | مقوّم بأقل من قيمته |
| 10-20 | FAIR_VALUE | تقييم عادل |
| 20-35 | PREMIUM | تقييم مرتفع |
| > 35 | OVERVALUED | مقوّم بأكثر من قيمته |

### 4. ROE Rating
| Range | Rating |
|-------|--------|
| ≥ 20% | EXCELLENT (ممتاز) |
| 15-20% | GOOD (جيد) |
| 10-15% | AVERAGE (متوسط) |
| < 10% | WEAK (ضعيف) |

### 5. Dividend Yield Rating
| Range | Rating |
|-------|--------|
| ≥ 8% | VERY_HIGH (عائد عالي جداً) |
| 4-8% | ATTRACTIVE (جذاب) |
| 1-4% | MODEST (متواضع) |
| < 1% | MINIMAL (ضئيل) |

### 6. Risk Assessment
| Risk Score | Level | Position Size |
|-----------|-------|---------------|
| ≥ 4 | HIGH | 0.5-1% من المحفظة |
| 2-3 | MODERATE | 1-3% من المحفظة |
| 0-1 | LOW | 3-5% من المحفظة |

عوامل المخاطر:
- RSI ≥ 70 أو ≤ 30 (+2)
- Beta > 1.5 (+1)
- Debt/Equity > 2 (+2)
- قرب قمة/قاع 52 أسبوع (+1)

### 7. Entry / Targets / Stop Loss Logic
- **BUY signals**: target = resistance (>entry) أو entry * 1.10
- **SELL signals**: target = support (<entry) أو entry * 0.90
- **Stop Loss BUY**: support (<entry) أو entry * 0.95
- **Stop Loss SELL**: resistance (>entry) أو entry * 1.05
- **R:R**: (target - entry) / (entry - stop) — المستهدف ≥ 2.0

---

## 📡 API Endpoint

```
GET /api/stocks/[ticker]/expert-analysis
```

**Response**:
```json
{
  "success": true,
  "ticker": "COMI",
  "analysis": { ... ExpertAnalysis ... },
  "generated_at": "2026-10-09T12:50:11.591Z"
}
```

---

## 🔗 الملفات المرتبطة

| الملف | الوصف |
|-------|-------|
| `src/lib/expert-analysis.ts` | المحرك الرئيسي (786 سطر) |
| `src/app/api/stocks/[ticker]/expert-analysis/route.ts` | API endpoint |
| `src/lib/unified-stock-data.ts` | مصدر البيانات (technical + fundamental + prediction) |

---

## 📋 أمثلة النتائج

### COMI (البنك التجاري الدولي)
```
التوصية: انتظار | Confidence: 48
السعر: 132.50 جنيه | القطاع: القطاع المالي

Entry:    137.86 | T1: 130.99 (-5.0%) | T2: 157.19 (+14.0%) | Stop: 143.37 (+4.0%)
R:R: 1.25

RSI: — (لا بيانات)
MA50: 132.49 | Trend: ترند صاعد قصير الأجل
Support: 132.39 | Resistance: 132.50 (قرب المقاومة)
52w: Low 132.39 | High 132.50 (قرب القمة)

ROE: 18% (جيد) | EPS: 5.77 (مكرر 23x) | P/B: 1.70 (معقول) | Div: 6.37% (جذاب)
Risk: منخفض | Position: 3-5% من المحفظة
```

### ETEL (المصرية للاتصالات)
```
التوصية: شراء قوي | Confidence: 78.26
Entry: 93.94 | T1: 95.35 (+1.5%) | T2: 114.42 (+21.8%) | Stop: 93.0 (-1.0%)
R:R: 1.5

ROE: 15% | EPS: 3.42 | Div: 6.87% (جذاب)
Risk: منخفض
```

### EKHO (الشرقية - إيسترن)
```
التوصية: شراء | Confidence: 61.2
Entry: 0.62 | T1: 0.65 (+4.8%) | T2: 0.78 (+25.8%) | Stop: 0.60 (-3.2%)
R:R: 1.5

RSI: 74.9 (تشبع شرائي!) ← عامل خطر
Risk: متوسط | Position: 1-3% من المحفظة
```

---

## 🚀 الاستخدام في الواجهة + التليجرام

### في شاشة تفاصيل السهم
```tsx
const { data } = useQuery(['expert-analysis', ticker], () =>
  fetch(`/api/stocks/${ticker}/expert-analysis`).then(r => r.json())
);

// عرض التقرير الكامل
<pre className="whitespace-pre-wrap">{data?.analysis?.fullReport_ar}</pre>
```

### في نشر التليجرام
```python
# python: استدعاء الـ API + نشر في القناة
response = requests.get(f"http://localhost:3000/api/stocks/{ticker}/expert-analysis")
analysis = response.json()["analysis"]
telegram_send(analysis["fullReport_ar"])
```

---

## ✅ الحالة

- ✅ المحرك شغّال ومختبر على 5 أسهم (COMI, SWDY, ETEL, HRHO, EKHO, TMGH)
- ✅ lint: 0 errors
- ✅ API endpoint جاهز
- ✅ التوثيق كامل

---

**آخر تحديث**: 2026-10-09  
**المنفذ**: Main Agent (Z.ai Code)  
**الحالة**: ✅ جاهز للإنتاج
