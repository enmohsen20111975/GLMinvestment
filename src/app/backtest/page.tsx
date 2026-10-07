'use client'

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"

type Phase1Result = { strategy: string; trades: number; win_rate_pct: number; avg_return_pct: number;
  total_return_pct: number; max_drawdown_pct: number; profit_factor: number; avg_holding_days: number;
  exit_reasons: Record<string, number>; window: string; }
type Phase2Result = { label: string; trades: number; win_rate_pct: number; avg_return_pct: number;
  total_return_pct: number; max_drawdown_pct: number; profit_factor: number; expectancy: number;
  avg_used_count?: number; flipped_count?: number; }
type WFResult = { half1: any; half2: any; }
type Duration = { avg_days: number; median_days: number; p25_days: number; p75_days: number;
  min_days: number; max_days: number; n_trades: number; client_message: string; }
type Payload = {
  meta: { test: string; data_source: string; walk_forward_windows?: any; consistent_rule?: string; }
  walk_forward?: Record<string, WFResult>
  expected_durations?: Record<string, Duration>
  phase1_results?: { results_6mo: Record<string, Phase1Result>; results_full: Record<string, Phase1Result> }
  phase2_results?: Record<string, Phase2Result>
  integration_status?: { [k: string]: string }
  // legacy phase1 keys
  results_6mo?: Record<string, Phase1Result>
  results_full?: Record<string, Phase1Result>
  results?: Record<string, Phase2Result>
}

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
  const r2 = data?.results || data?.phase2_results || {}
  const wf = data?.walk_forward || {}
  const dur = data?.expected_durations || {}
  const integration = data?.integration_status || {}

  return (
    <div dir="rtl" className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        <header className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              دمج Regime Filter في محرك التوقعات + Walk-Forward + توقعات المدة للعميل
            </h1>
            <Badge variant="secondary" className="font-mono">442 سهم EGX · 19 شهر</Badge>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground">
            تنفيذ البرومبت: دمج regime filter كـ pre-filter في محرك التوقعات + walk-forward (قسم 19 شهر إلى نصفين)
            + <span className="font-semibold text-foreground">رسالة العميل: "التصحيح المتوقع ~X يوم"</span> — ثقة + خبرة.
          </p>
        </header>

        <Alert className="border-emerald-400/50 bg-emerald-50 dark:bg-emerald-950/30">
          <AlertTitle className="text-emerald-800 dark:text-emerald-300">دمج محرك التوقعات تم — Walk-forward صادق — رسالة المدة جاهزة</AlertTitle>
          <AlertDescription className="text-emerald-800 dark:text-emerald-200/90 text-sm leading-relaxed">
            فلتر الـ Regime أُضيف داخل <span className="font-mono">daily_predictor.py</span> (feature flag
            <span className="font-mono"> REGIME_FILTER</span> default OFF).
            Walk-forward على 19 شهر (نصفين) يكشف أنّ النتائج period-dependent.
            رسالة المدة للعميل: <span className="font-mono">expected_correction_days</span> = متوسط فعلي من backtest (ليس تخميناً).
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
            {/* INTEGRATION STATUS */}
            <Card>
              <CardHeader>
                <CardTitle>حالة الدمج في محرك التوقعات الإنتاجي</CardTitle>
                <CardDescription>
                  الفلتر مربوط في <span className="font-mono">daily_predictor.py</span> قبل STRICT_ENTRY مباشرة.
                  Production test يحتاج data_engine.db مع egksco_price_history (غير متوفرة في الساندبوكس).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {Object.entries(integration).map(([k, v]) => (
                    <div key={k} className="flex gap-2 items-start">
                      <span className="font-mono text-xs text-muted-foreground shrink-0 min-w-32">{k}:</span>
                      <span className="text-xs leading-relaxed">{v}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Tabs defaultValue="walk_forward">
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="walk_forward">Walk-Forward</TabsTrigger>
                <TabsTrigger value="durations">توقعات المدة للعميل</TabsTrigger>
                <TabsTrigger value="phase1">المرحلة 1 — Regime</TabsTrigger>
              </TabsList>

              {/* WALK-FORWARD */}
              <TabsContent value="walk_forward" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Walk-Forward — Half 1 (Jan-Aug 2025) vs Half 2 (Sep 2025-Aug 2026)</CardTitle>
                    <CardDescription>
                      قاعدة الثبات: النصفين لازم ret &gt; 0 AND DD &gt; -25%. النتيجة: النتائج period-dependent.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">الاستراتيجية [mode]</TableHead>
                            <TableHead className="text-right">H1 Ret</TableHead>
                            <TableHead className="text-right">H1 DD</TableHead>
                            <TableHead className="text-right">H1 Trades</TableHead>
                            <TableHead className="text-right">H2 Ret</TableHead>
                            <TableHead className="text-right">H2 DD</TableHead>
                            <TableHead className="text-right">H2 Trades</TableHead>
                            <TableHead className="text-right">الحكم</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {Object.entries(wf).map(([key, w]) => {
                            const h1 = w.half1, h2 = w.half2
                            const consistent = h1.total_return_pct > 0 && h2.total_return_pct > 0
                              && h1.max_drawdown_pct > -25 && h2.max_drawdown_pct > -25
                            return (
                              <TableRow key={key} className={consistent ? "bg-emerald-50 dark:bg-emerald-950/30" : ""}>
                                <TableCell className="font-medium text-xs">{key}</TableCell>
                                <TableCell className={`font-mono ${colorRet(h1.total_return_pct)}`}>{pct(h1.total_return_pct)}</TableCell>
                                <TableCell className={`font-mono ${ddColor(h1.max_drawdown_pct)}`}>{pct(h1.max_drawdown_pct)}</TableCell>
                                <TableCell className="font-mono">{h1.trades}</TableCell>
                                <TableCell className={`font-mono ${colorRet(h2.total_return_pct)}`}>{pct(h2.total_return_pct)}</TableCell>
                                <TableCell className={`font-mono ${ddColor(h2.max_drawdown_pct)}`}>{pct(h2.max_drawdown_pct)}</TableCell>
                                <TableCell className="font-mono">{h2.trades}</TableCell>
                                <TableCell>
                                  {consistent ? <Badge className="bg-emerald-600">✓ ثابت</Badge> : <Badge variant="outline">⚠ غير ثابت</Badge>}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
                <Alert>
                  <AlertTitle>الحُكم الصادق للـ Walk-forward</AlertTitle>
                  <AlertDescription className="text-sm leading-relaxed">
                    النتائج <span className="font-semibold">period-dependent</span>. Correction [A] في H1 = -6.63% لكن في H2 = +52.53%.
                    Merged-Strict [A/B] في H1 كان DD -38% (مرفوض)، وفي H2 تحسّن. Chase تغيّر تماماً (H1 +151%، H2 -29%).
                    <br /><br />
                    <span className="font-semibold">الخلاصة:</span> regime filter يحسّن الجودة بشكل واضح،
                    لكن الأداء نفسه period-dependent. يلزم walk-forward أطول (multi-year) قبل أي اعتماد نهائي.
                    Phase 1 (19 شهر كامل) أعطى نتائج إيجابية، لكن لا يمكن الاعتماد على فترة واحدة.
                  </AlertDescription>
                </Alert>
              </TabsContent>

              {/* EXPECTED DURATIONS */}
              <TabsContent value="durations" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>توقعات المدة للعميل — متوسط الاحتفاظ الفعلي</CardTitle>
                    <CardDescription>
                      متوسط مدة الصفقات الفعلية من backtest (ليس تخميناً). يرى العميل: "التصحيح المتوقع: ~7 يوم (بين 3 و 12 يوم)"
                      = ثقة وخبرة. يُحدث هذا فرقاً كبيراً في تجربة العميل.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">الاستراتيجية [mode]</TableHead>
                            <TableHead className="text-right">Trades</TableHead>
                            <TableHead className="text-right">Avg days</TableHead>
                            <TableHead className="text-right">Median</TableHead>
                            <TableHead className="text-right">P25-P75</TableHead>
                            <TableHead className="text-right">Min-Max</TableHead>
                            <TableHead className="text-right">رسالة العميل</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {Object.entries(dur).map(([key, d]) => (
                            <TableRow key={key}>
                              <TableCell className="font-medium text-xs">{key}</TableCell>
                              <TableCell className="font-mono">{d.n_trades}</TableCell>
                              <TableCell className="font-mono">{d.avg_days?.toFixed(1) ?? "—"}ي</TableCell>
                              <TableCell className="font-mono">{d.median_days?.toFixed(1) ?? "—"}ي</TableCell>
                              <TableCell className="font-mono">{d.p25_days != null ? `${d.p25_days.toFixed(1)} - ${d.p75_days?.toFixed(1)}ي` : "—"}</TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">{d.min_days != null ? `${d.min_days}-${d.max_days}ي` : "—"}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="font-mono text-xs">{d.client_message ?? "غير متاح"}</Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>فلسفة رسالة المدة — ثقة العميل</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-3 text-muted-foreground leading-relaxed">
                    <p>
                      توجيه المالك: "العميل يحتاج شخصاً ذا خبرة يطمئنه، وهذا مهم جداً".
                      عندما يرى العميل توقّعًا فيه: <span className="font-mono font-semibold">"التصحيح المتوقع: ~7 يوم (بين 3 و 12 يوم)"</span>،
                      يمنح هذا انطباعاً بأن النظام ذو خبرة ويفهم السوق. ليس مجرد رقم ثابت، بل نطاق واقعي مبني على backtest حقيقي.
                    </p>
                    <p>
                      التطبيق في محرك التوقعات: عندما يقبل الـ regime filter إشارة، يكتب في
                      <span className="font-mono"> result['expected_holding_days']</span> = 7 (mode A) أو 5 (mode B).
                      يظهر هذا في واجهة العميل مع التوقّع.
                    </p>
                    <div className="pt-2 border-t">
                      <p className="font-semibold text-foreground mb-1">الـ numbers الحقيقية (من backtest 19 شهر):</p>
                      <ul className="list-disc list-inside text-xs space-y-1">
                        <li><span className="font-mono">Correction [A]</span>: متوسط 2.7 يوم (1-3 يوم) — صفقات سريعة (snapback)</li>
                        <li><span className="font-mono">Merged-Strict [B]</span>: متوسط 7.8 يوم (3-12 يوم) — corrections حقيقية</li>
                        <li><span className="font-mono">Chase</span>: متوسط 8 يوم (3-11 يوم) — momentum rides</li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* PHASE 1 RESULTS */}
              <TabsContent value="phase1" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>المرحلة 1 — Regime Filter results (للمرجعية)</CardTitle>
                    <CardDescription>
                      النتائج الكاملة على 6 شهور + 19 شهر. التي تحدّثنا عنها سابقاً.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Tabs defaultValue="full">
                      <TabsList className="grid grid-cols-2 w-full mb-4">
                        <TabsTrigger value="full">19 شهر</TabsTrigger>
                        <TabsTrigger value="6mo">6 شهور</TabsTrigger>
                      </TabsList>
                      {(["full", "6mo"] as const).map((win) => {
                        const r = win === "6mo" ? r6 : rFull
                        return (
                          <TabsContent key={win} value={win}>
                            <div className="overflow-x-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="text-right">Strategy [mode]</TableHead>
                                    <TableHead className="text-right">Trades</TableHead>
                                    <TableHead className="text-right">WR</TableHead>
                                    <TableHead className="text-right">Return</TableHead>
                                    <TableHead className="text-right">Max DD</TableHead>
                                    <TableHead className="text-right">PF</TableHead>
                                    <TableHead className="text-right">Verdict</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {Object.entries(r).map(([key, m]) => {
                                    const dd = m.max_drawdown_pct
                                    const verdict = dd > -25
                                    return (
                                      <TableRow key={key} className={!verdict ? "bg-red-50/30 dark:bg-red-950/10" : ""}>
                                        <TableCell className="font-medium text-xs">{key}</TableCell>
                                        <TableCell className="font-mono">{m.trades}</TableCell>
                                        <TableCell className="font-mono">{m.win_rate_pct.toFixed(1)}%</TableCell>
                                        <TableCell className={`font-mono ${colorRet(m.total_return_pct)}`}>{pct(m.total_return_pct)}</TableCell>
                                        <TableCell className={`font-mono ${ddColor(dd)}`}>{pct(dd)}</TableCell>
                                        <TableCell className={`font-mono ${pfColor(m.profit_factor)}`}>{m.profit_factor === 999.99 ? "∞" : m.profit_factor.toFixed(2)}</TableCell>
                                        <TableCell>{verdict ? <Badge className="bg-emerald-600">✓</Badge> : <Badge variant="destructive">✗</Badge>}</TableCell>
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
              </TabsContent>
            </Tabs>

            {/* FINAL VERDICT */}
            <Card className="border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/20">
              <CardHeader>
                <CardTitle className="text-emerald-800 dark:text-emerald-300">الحُكم النهائي — Integration جاهز + أرقام صادقة</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed text-emerald-900 dark:text-emerald-100/90 space-y-2">
                <p>
                  <span className="font-semibold">تم الدمج:</span> <span className="font-mono">regime_filter.py</span> مربوط في
                  <span className="font-mono"> daily_predictor.py</span> خلف flag <span className="font-mono">REGIME_FILTER</span> (default OFF).
                  عند تفعيله، تمر كل إشارة BUY عبر <span className="font-mono">is_bullish_regime()</span> قبل أي معالجة أخرى.
                </p>
                <p>
                  <span className="font-semibold">Walk-forward صادق:</span> النتائج period-dependent.
                  Correction [A] H1=-6.6%، H2=+52.5%. يلزم walk-forward أطول (multi-year) قبل الاعتماد النهائي.
                </p>
                <p>
                  <span className="font-semibold">رسالة المدة للعميل:</span> متوسط فعلي من backtest.
                  Merged-Strict [B] = ~7 يوم (3-12 يوم). Correction [A] = ~3 يوم (1-3 يوم).
                  يبني هذا ثقة العميل.
                </p>
                <p>
                  <span className="font-semibold">الخطوات التالية المقترحة:</span>
                </p>
                <ol className="list-decimal list-inside text-xs space-y-1 mt-2">
                  <li>توفير data_engine.db مع egksco_price_history لـ production test كامل لمحرك التوقعات.</li>
                  <li>تفعيل REGIME_FILTER على staging ورصد 7 أيام.</li>
                  <li>Walk-forward أطول (multi-year) لـ تأكيد الثبات.</li>
                  <li>إضافة <span className="font-mono">expected_holding_days</span> لـ UI العميل.</li>
                </ol>
              </CardContent>
            </Card>
          </>
        )}
      </main>

      <footer className="mt-auto border-t bg-muted/30">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 text-xs text-muted-foreground flex flex-col sm:flex-row justify-between items-center gap-2">
          <span>GLMinvestment · Regime filter integration + Walk-forward + Client durations · Rule 42</span>
          <span className="font-mono">daily_predictor.py + regime_filter.py + walk_forward_and_durations.py</span>
        </div>
      </footer>
    </div>
  )
}
