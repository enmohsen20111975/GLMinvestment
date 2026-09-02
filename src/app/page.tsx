'use client'

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"

type Phase1Result = {
  strategy: string; trades: number; win_rate_pct: number; avg_return_pct: number;
  total_return_pct: number; max_drawdown_pct: number; profit_factor: number; avg_holding_days: number;
  exit_reasons: Record<string, number>; window: string;
}
type Phase2Result = {
  label: string; trades: number; win_rate_pct: number; avg_return_pct: number;
  total_return_pct: number; max_drawdown_pct: number; profit_factor: number;
  expectancy: number; avg_used_count?: number; flipped_count?: number;
  flip_rate_pct?: number; avg_rate_pct?: number;
}
type Payload = {
  meta: {
    data_source: string; windows: Record<string, string>;
    scenarios?: Record<string, string>; regime_modes?: Record<string, string>;
    exit_engine: string; rejection_rule?: string; production_modules?: string[];
    rules?: string[];
  }
  results_6mo?: Record<string, Phase1Result>
  results_full?: Record<string, Phase1Result>
  phase1_results?: { results_6mo: Record<string, Phase1Result>; results_full: Record<string, Phase1Result> }
  results?: Record<string, Phase2Result>
}

const V402_BASELINE = { trades: 15, win_rate_pct: 73.3, profit_factor: 9.80,
  total_return_pct: 66.2, max_drawdown_pct: 4.71, avg_holding_days: 5.0 }

function colorRet(v: number) {
  if (v > 0.01) return "text-emerald-600 dark:text-emerald-400 font-semibold"
  if (v < -0.01) return "text-red-600 dark:text-red-400 font-semibold"
  return "text-muted-foreground font-semibold"
}
function pct(v: number) { const s = v > 0 ? "+" : ""; return `${s}${v.toFixed(2)}%` }
function ddColor(v: number) {
  if (v > -10) return "text-emerald-600 dark:text-emerald-400 font-bold"
  if (v > -25) return "text-amber-600 dark:text-amber-400 font-bold"
  return "text-red-600 dark:text-red-400 font-bold"
}
function pfColor(v: number) {
  if (v >= 2.0) return "text-emerald-600 dark:text-emerald-400 font-bold"
  if (v >= 1.3) return "text-amber-600 dark:text-amber-400 font-semibold"
  return "text-red-600 dark:text-red-400 font-semibold"
}

export default function Home() {
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/backtest-results.json", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d: Payload) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setErr(String(e)) })
    return () => { cancelled = true }
  }, [])

  const r6 = data?.results_6mo || data?.phase1_results?.results_6mo || {}
  const rFull = data?.results_full || data?.phase1_results?.results_full || {}
  const r2 = data?.results || {}

  return (
    <div dir="rtl" className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        <header className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              التقرير النهائي — Regime Filter + Average Down
            </h1>
            <Badge variant="secondary" className="font-mono">442 سهم EGX · 19 شهر</Badge>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground">
            تنفيذ البرومبت الكامل: المرحلة 1 (فلتر regime بنسختين) + المرحلة 2 (متوسط سعري ذكي). قاعدة الرفض:
            <span className="font-semibold text-foreground"> أي نسخة DD &gt; 25% تُرفض حتى لو العائد أعلى.</span>
          </p>
        </header>

        <Alert className="border-emerald-400/50 bg-emerald-50 dark:bg-emerald-950/30">
          <AlertTitle className="text-emerald-800 dark:text-emerald-300">بيانات EGX حقيقية · modules مرتبطة بالإنتاج · صفر محاكاة</AlertTitle>
          <AlertDescription className="text-emerald-800 dark:text-emerald-200/90 text-sm leading-relaxed">
            المصادر: <span className="font-mono">price_history.db</span> (442 سهم EGX، 288K شمعة) +
            <span className="font-mono"> vps-service/analyzers/regime_filter.py</span> (module إنتاجي جديد) +
            <span className="font-mono"> vps-service/analyzers/strict_entry_filters.py</span> (إضافة is_liquidity_grab_opportunity + evaluate_average_down).
            تم الرفع على GitHub + تحديث CONSTITUTION (Rule 42) + PROJECT_ANATOMY.
          </AlertDescription>
        </Alert>

        {err && (
          <Alert className="border-red-500 bg-red-50 dark:bg-red-950/30">
            <AlertTitle>تعذّر تحميل النتائج</AlertTitle>
            <AlertDescription className="font-mono text-xs">{err}</AlertDescription>
          </Alert>
        )}

        {!data && !err && (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}

        {data && (
          <>
            {/* VERDICT */}
            <Card className="border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/20">
              <CardHeader>
                <CardTitle className="text-emerald-800 dark:text-emerald-300">الحُكم النهائي — Correction [B] هو الأفضل جودة، Merged-Strict [B] الأفضل عائداً</CardTitle>
                <CardDescription className="text-emerald-800/80 dark:text-emerald-200/80">
                  Average Down مع الشروط الصارمة لم يُطلق أبداً (سلوك مقبول — الـ Average Down الذكي نادر، الأعمى ممنوع)
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed text-emerald-900 dark:text-emerald-100/90 space-y-2">
                <p>
                  <span className="font-semibold">Correction [B]</span> (Close &gt; SMA20 AND Close &gt; SMA50) على 19 شهر:
                  <span className="font-mono font-bold"> PF 18.54</span>، DD <span className="font-mono">-2.59%</span>، 5 صفقات فقط — جودة استثنائية ونادر.
                </p>
                <p>
                  <span className="font-semibold">Merged-Strict [B]</span> على 19 شهر:
                  <span className="font-mono font-bold"> +1594.91%</span> عائد، DD <span className="font-mono">-24.80%</span> (على حدود القاعدة)، PF 2.03، 130 صفقة.
                </p>
                <p>
                  <span className="font-semibold">Average Down (Phase 2):</span> مع الشروط الصارمة (break 3-8% + recovery 3 أيام + حجم + قرب SMA50 + لا ChoC)
                  لم يُطلق أبداً في backtest (avg_used=0). هذا سلوك مقبول — المتوسط الذكي نادر، الأعمى ممنوع.
                </p>
              </CardContent>
            </Card>

            <Tabs defaultValue="phase1">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="phase1">المرحلة 1 — Regime Filter</TabsTrigger>
                <TabsTrigger value="phase2">المرحلة 2 — Average Down</TabsTrigger>
              </TabsList>

              {/* PHASE 1 */}
              <TabsContent value="phase1" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>المرحلة 1 — 4 استراتيجيات × 3 أوضاع regime × فترتين</CardTitle>
                    <CardDescription>
                      قاعدة الرفض: DD &gt; 25% = ❌ مرفوض. 🟢 DD &lt; 10% | 🟡 DD 10-25% | 🔴 DD &gt; 25%.
                      mode A: Close &gt; SMA50 | mode B: Close &gt; SMA20 AND Close &gt; SMA50 | none: بدون فلتر.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Tabs defaultValue="full">
                      <TabsList className="grid grid-cols-2 w-full mb-4">
                        <TabsTrigger value="full">19 شهر (Jan 2025 - Aug 2026)</TabsTrigger>
                        <TabsTrigger value="6mo">6 شهور (Feb - Aug 2026)</TabsTrigger>
                      </TabsList>

                      {(["full", "6mo"] as const).map((win) => {
                        const r = win === "6mo" ? r6 : rFull
                        return (
                          <TabsContent key={win} value={win} className="space-y-3">
                            <div className="overflow-x-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="text-right">الاستراتيجية [mode]</TableHead>
                                    <TableHead className="text-right">صفقات</TableHead>
                                    <TableHead className="text-right">WR</TableHead>
                                    <TableHead className="text-right">العائد</TableHead>
                                    <TableHead className="text-right">Max DD</TableHead>
                                    <TableHead className="text-right">PF</TableHead>
                                    <TableHead className="text-right">الحكم</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  <TableRow className="bg-blue-50 dark:bg-blue-950/20 border-b-2 border-blue-200">
                                    <TableCell className="font-medium"><Badge className="bg-blue-600">V40.2 إنتاج</Badge></TableCell>
                                    <TableCell className="font-mono">{V402_BASELINE.trades}</TableCell>
                                    <TableCell className="font-mono">{V402_BASELINE.win_rate_pct}%</TableCell>
                                    <TableCell className={`font-mono ${colorRet(V402_BASELINE.total_return_pct)}`}>{pct(V402_BASELINE.total_return_pct)}</TableCell>
                                    <TableCell className={`font-mono ${ddColor(-V402_BASELINE.max_drawdown_pct)}`}>{pct(-V402_BASELINE.max_drawdown_pct)}</TableCell>
                                    <TableCell className={`font-mono ${pfColor(V402_BASELINE.profit_factor)}`}>{V402_BASELINE.profit_factor.toFixed(2)}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">baseline (6mo)</TableCell>
                                  </TableRow>

                                  {Object.entries(r).map(([key, m]) => {
                                    const dd = m.max_drawdown_pct
                                    const verdict = dd > -25
                                    const isBest = (key === "Correction [B]" && win === "full") || (key === "Merged-Strict [B]" && win === "full")
                                    return (
                                      <TableRow key={key} className={isBest ? "bg-emerald-50 dark:bg-emerald-950/30 border-l-4 border-emerald-500" : !verdict ? "bg-red-50/30 dark:bg-red-950/10" : ""}>
                                        <TableCell className="font-medium">{key}</TableCell>
                                        <TableCell className="font-mono">{m.trades}</TableCell>
                                        <TableCell className="font-mono">{m.win_rate_pct.toFixed(1)}%</TableCell>
                                        <TableCell className={`font-mono ${colorRet(m.total_return_pct)}`}>{pct(m.total_return_pct)}</TableCell>
                                        <TableCell className={`font-mono ${ddColor(dd)}`}>{pct(dd)}</TableCell>
                                        <TableCell className={`font-mono ${pfColor(m.profit_factor)}`}>{m.profit_factor === 999.99 ? "∞" : m.profit_factor.toFixed(2)}</TableCell>
                                        <TableCell>
                                          {verdict ? (
                                            <Badge className="bg-emerald-600">✓ مقبول</Badge>
                                          ) : (
                                            <Badge variant="destructive">✗ مرفوض</Badge>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    )
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          </TabsContent>
                        )
                      })}
                    </Tabs>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>منطق فلتر الـ Regime</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-3 text-muted-foreground leading-relaxed">
                    <div className="grid sm:grid-cols-3 gap-3">
                      <div className="p-3 rounded-md border bg-muted/30">
                        <p className="font-semibold text-foreground mb-1">🔴 none</p>
                        <p className="text-xs">baseline — يدخل في كل الإشارات بما فيها bear markets.</p>
                      </div>
                      <div className="p-3 rounded-md border bg-muted/30">
                        <p className="font-semibold text-foreground mb-1">🟡 mode A</p>
                        <p className="text-xs"><span className="font-mono">Close &gt; SMA50</span> — اتجاه صحي متوسط المدى.</p>
                      </div>
                      <div className="p-3 rounded-md border border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20">
                        <p className="font-semibold text-foreground mb-1">🟢 mode B (الأفضل)</p>
                        <p className="text-xs"><span className="font-mono">Close &gt; SMA20 AND Close &gt; SMA50</span> — تأكيد مزدوج.</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t">
                      <p className="font-semibold text-foreground mb-1">الخلاصة</p>
                      <p className="text-xs">
                        فلتر الـ regime حوّل Correction من خاسر (-4.45%) لرباح (+66.76% لـ mode A، +53.28% لـ mode B)
                        مع DD نزل من -47% لـ -7.7% و -2.6%. الميكانيزم اشتغل.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* PHASE 2 */}
              <TabsContent value="phase2" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>المرحلة 2 — Average Down: مع vs من غير</CardTitle>
                    <CardDescription>
                      سيناريو NO_AVG (بدون متوسط) vs AVG_DOWN (مع متوسط مرة واحدة لو تحققت is_liquidity_grab_opportunity).
                      الشروط الصارمة: كسر 3-8% + recovery 3 أيام + حجم + قرب SMA50 + لا ChoC.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">الاستراتيجية + الفترة + السيناريو</TableHead>
                            <TableHead className="text-right">صفقات</TableHead>
                            <TableHead className="text-right">Expectancy</TableHead>
                            <TableHead className="text-right">WR</TableHead>
                            <TableHead className="text-right">العائد الإجمالي</TableHead>
                            <TableHead className="text-right">Max DD</TableHead>
                            <TableHead className="text-right">PF</TableHead>
                            <TableHead className="text-right">avgUsed</TableHead>
                            <TableHead className="text-right">flipped</TableHead>
                            <TableHead className="text-right">الحكم</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {Object.entries(r2).map(([key, m]) => {
                            const isAvg = key.includes("AVG_DOWN")
                            return (
                              <TableRow key={key} className={isAvg ? "bg-amber-50/30 dark:bg-amber-950/10" : ""}>
                                <TableCell className="font-medium text-xs">{key}</TableCell>
                                <TableCell className="font-mono">{m.trades}</TableCell>
                                <TableCell className={`font-mono ${colorRet(m.expectancy)}`}>{pct(m.expectancy)}</TableCell>
                                <TableCell className="font-mono">{m.win_rate_pct.toFixed(1)}%</TableCell>
                                <TableCell className={`font-mono ${colorRet(m.total_return_pct)}`}>{pct(m.total_return_pct)}</TableCell>
                                <TableCell className={`font-mono ${ddColor(m.max_drawdown_pct)}`}>{pct(m.max_drawdown_pct)}</TableCell>
                                <TableCell className={`font-mono ${pfColor(m.profit_factor)}`}>{m.profit_factor === 999.99 ? "∞" : m.profit_factor.toFixed(2)}</TableCell>
                                <TableCell className="font-mono">{m.avg_used_count ?? 0}</TableCell>
                                <TableCell className="font-mono">{m.flipped_count ?? 0}</TableCell>
                                <TableCell>
                                  {isAvg ? (
                                    <Badge variant="outline" className="font-mono text-xs">🟡 محايد</Badge>
                                  ) : (
                                    <Badge variant="outline" className="font-mono text-xs">baseline</Badge>
                                  )}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>منطق Liquidity Grab Opportunity</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-3 text-muted-foreground leading-relaxed">
                    <div>
                      <p className="font-semibold text-foreground mb-1">الشروط الكمية الصارمة:</p>
                      <ol className="list-decimal list-inside text-xs space-y-1">
                        <li>السهم كسر قاع سابق بنسبة بين <span className="font-mono">3% و 8%</span> (أقل = ضعيف، أكتر = falling knife).</li>
                        <li>حجم شمعة الكسر أعلى من متوسط الحجم 20 يوم (<span className="font-mono">vol &gt; 1.1× avg</span>).</li>
                        <li>خلال <span className="font-mono">1-3 أيام</span> يرجع السعر فوق الدعم وفوق منتصف شمعة الكسر.</li>
                        <li>السعر قريب من SMA50 (within <span className="font-mono">8%</span>).</li>
                        <li>مفيش Change of Character هابط (no 3 consecutive lower-lows + lower-highs).</li>
                      </ol>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">قواعد المتوسط الصارمة:</p>
                      <ul className="list-disc list-inside text-xs space-y-1">
                        <li>مرة واحدة فقط كحد أقصى (<span className="font-mono">already_averaged</span> flag).</li>
                        <li>حجم المتوسط = <span className="font-mono">50%</span> من الصفقة الأصلية.</li>
                        <li>الـ stop الأصلي يظل كما هو — <span className="font-semibold">ممنوع التوسيع</span>.</li>
                        <li>الستوب بديل إلزامي — المتوسط قرار إضافي فقط.</li>
                      </ul>
                    </div>
                    <div className="pt-2 border-t">
                      <p className="font-semibold text-foreground mb-1">الحُكم الصادق للمرحلة 2:</p>
                      <p className="text-xs">
                        Average Down مع الشروط الصارمة <span className="font-semibold">لم يُطلق أبداً</span> في backtest 19 شهر (avg_used=0).
                        السبب: الشروط نادراً ما تتحقق أثناء holding مفتوح، ومعظم الصفقات تخرج قبل ما تظهر الفرصة.
                        هذا <span className="font-semibold">سلوك مقبول</span> — المتوسط الذكي نادر، الأعمى ممنوع.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* FINAL RECOMMENDATIONS */}
            <Card>
              <CardHeader>
                <CardTitle>التوصية النهائية — إيه اللي يدخل الإنتاج وإيه اللي يترفض</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3 text-muted-foreground leading-relaxed">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-md border border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20">
                    <p className="font-semibold text-emerald-800 dark:text-emerald-300 mb-2">✅ مقبول للإنتاج (خلف feature flag):</p>
                    <ul className="list-disc list-inside text-xs space-y-1">
                      <li><span className="font-mono">regime_filter.py</span> (mode='A' افتراضي)</li>
                      <li><span className="font-mono">evaluate_average_down()</span> كـ safety layer</li>
                      <li><span className="font-mono">Correction [B]</span> كـ pre-filter جوه V40.2</li>
                    </ul>
                  </div>
                  <div className="p-3 rounded-md border border-red-300 bg-red-50/50 dark:bg-red-950/20">
                    <p className="font-semibold text-red-800 dark:text-red-300 mb-2">❌ مرفوض للإنتاج:</p>
                    <ul className="list-disc list-inside text-xs space-y-1">
                      <li><span className="font-mono">Merged [الساذج]</span> — تخفيف العتبات = DEADCAT</li>
                      <li><span className="font-mono">Chase</span> — DD -66% حتى مع regime</li>
                      <li>المتوسط الأعمى (بدون is_liquidity_grab_opportunity)</li>
                      <li>أي نسخة DD &gt; 25%</li>
                    </ul>
                  </div>
                </div>
                <div className="pt-2 border-t">
                  <p className="font-semibold text-foreground mb-1">الخطوات المطلوبة قبل تفعيل V40_2_REGIME_FILTER:</p>
                  <ol className="list-decimal list-inside text-xs space-y-1">
                    <li>Walk-forward test: قسم البيانات لـ train/test periods.</li>
                    <li>ربط regime_filter بـ evaluate_strict_entry (pre-filter).</li>
                    <li>ربط evaluate_average_down بـ position_manager (per-trade state).</li>
                    <li>تفعيل الـ flag على staging ورصد لـ 7 أيام قبل الإنتاج.</li>
                  </ol>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>

      <footer className="mt-auto border-t bg-muted/30">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 text-xs text-muted-foreground flex flex-col sm:flex-row justify-between items-center gap-2">
          <span>GLMinvestment · Phase 1+2 — Regime Filter + Average Down · Rule 42 · الأرقام هي الحكم</span>
          <span className="font-mono">regime_filter.py + strict_entry_filters.py + phase1/2 scripts</span>
        </div>
      </footer>
    </div>
  )
}
