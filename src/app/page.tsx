'use client'

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"

type Metrics = {
  strategy: string
  trades: number
  wins: number
  losses: number
  win_rate_pct: number
  avg_return_pct: number
  total_return_pct: number
  max_drawdown_pct: number
  profit_factor: number
  avg_holding_days: number
  exit_reasons: Record<string, number>
}

type MonthlyStat = { trades: number; wins: number; win_rate: number; ret_pct: number }
type DDAnalysis = {
  label: string
  max_dd_pct: number
  max_dd_at: string | null
  worst_trades: Array<{ date: string; ticker: string; ret: number; reason: string }>
  max_loss_streak: number
  monthly: Record<string, MonthlyStat>
}

type Payload = {
  meta: {
    data_source: string
    window: string
    n_tickers: number
    total_bars: number
    market_regime: string
    exit_engine: string
    regime_filter: string
    note: string
  }
  results: Record<string, Metrics>
  drawdown_analysis: Record<string, DDAnalysis>
  market_proxy?: {
    dates: string[]
    market_close: number[]
    market_ma50: Array<number | null>
    above_ma50: boolean[]
  }
}

const STRATEGIES = ["Correction", "Chase", "Merged", "Merged-Strict"] as const
const MODES = ["none", "stock", "both"] as const
const MODE_LABELS: Record<string, string> = {
  "none": "بدون فلتر",
  "stock": "فلتر السهم (close > MA50)",
  "both": "فلتر مزدوج (سهم + سوق)",
}
const MODE_EMOJI: Record<string, string> = { "none": "🔴", "stock": "🟢", "both": "🟡" }

// V40.2 documented baseline (6-month window Feb-Aug 2026)
const V402_BASELINE = {
  trades: 15, win_rate_pct: 73.3, profit_factor: 9.80,
  total_return_pct: 66.2, max_drawdown_pct: 4.71, avg_holding_days: 5.0,
}

function colorRet(v: number) {
  if (v > 0.01) return "text-emerald-600 dark:text-emerald-400 font-semibold"
  if (v < -0.01) return "text-red-600 dark:text-red-400 font-semibold"
  return "text-muted-foreground font-semibold"
}
function pct(v: number) {
  const s = v > 0 ? "+" : ""
  return `${s}${v.toFixed(2)}%`
}
function ddColor(v: number) {
  if (v > -20) return "text-emerald-600 dark:text-emerald-400 font-bold"
  if (v > -35) return "text-amber-600 dark:text-amber-400 font-bold"
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

  return (
    <div dir="rtl" className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        <header className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              اختبار فلتر الـ Regime — الأثر على الـ DD والـ PF
            </h1>
            <Badge variant="secondary" className="font-mono">442 سهم EGX · 19 شهر</Badge>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground">
            بناءً على طلبك: فلتر regime إجباري (ممنوع الدخول لو السهم تحت MA50). النتيجة:
            <span className="font-semibold text-foreground"> Correction + per-stock MA50 = أول variant يحقق DD &lt; 10% (PF 3.09).</span>
          </p>
        </header>

        <Alert className="border-emerald-400/50 bg-emerald-50 dark:bg-emerald-950/30">
          <AlertTitle className="text-emerald-800 dark:text-emerald-300">بيانات EGX حقيقية · 3 أوضاع فلتر · 19 شهر</AlertTitle>
          <AlertDescription className="text-emerald-800 dark:text-emerald-200/90 text-sm leading-relaxed">
            <span className="font-mono">{data?.meta?.total_bars ?? "—"}</span> شمعة على <span className="font-semibold">442 سهم EGX</span>،
            نافذة <span className="font-mono">{data?.meta?.window ?? "—"}</span>.
            حالة السوق: <span className="font-mono">{data?.meta?.market_regime ?? "—"}</span>.
            3 أوضاع: بدون فلتر / per-stock MA50 / مزدوج (سهم + سوق). نفس محرك الخروج. no lookahead.
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
                <CardTitle className="text-emerald-800 dark:text-emerald-300">الحُكم — فلتر الـ Regime اشتغل. Correction [stock] هو الفائز.</CardTitle>
                <CardDescription className="text-emerald-800/80 dark:text-emerald-200/80">
                  أول variant يحقق شرطك (DD &lt; 20-25%): Correction + per-stock MA50 = DD -9% فقط، PF 3.09
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed text-emerald-900 dark:text-emerald-100/90 space-y-2">
                <p>
                  <span className="font-semibold">الاكتشاف الكبير:</span> فلتر per-stock MA50 حوّل Correction
                  من <span className="font-mono">-4.45%</span> (خاسر) لـ <span className="font-mono font-bold">+34.51%</span> (رباح)
                  مع DD نزل من <span className="font-mono">-47%</span> لـ <span className="font-mono font-bold">-9%</span> فقط
                  و PF قفز من <span className="font-mono">1.05</span> لـ <span className="font-mono font-bold">3.09</span>.
                  السبب: الفلتر منع الدخول في bear markets (يوليو-أغسطس 2025) وبالتالي منع دخول الأسهم اللي نازلة تحت MA50 = falling knives.
                </p>
                <p>
                  <span className="font-semibold">لكن العدد صغير:</span> 12 صفقة بس في 19 شهر. ده عالي الجودة بس نادر.
                  Merged-Strict [stock] لسه الأعلى عائدًا (<span className="font-mono">+166%</span>) بس DD لسه <span className="font-mono">-44%</span> (فوق حدك).
                </p>
                <p className="text-xs pt-2 border-t border-emerald-300/50">
                  <span className="font-semibold">تنبيه:</span> فلتر "both" (سهم + سوق) <span className="font-semibold">قتل العائد</span> في معظم الاستراتيجيات.
                  السوق الـ proxy بتاعنا ممكن يكون متشدد زيادة. الـ per-stock MA50 لوحده هو الـ sweet spot.
                </p>
              </CardContent>
            </Card>

            {/* MAIN COMPARISON TABLE */}
            <Card>
              <CardHeader>
                <CardTitle>المقارنة الكاملة — 4 استراتيجيات × 3 أوضاع فلتر</CardTitle>
                <CardDescription>
                  كل صف = استراتيجية + وضع فلتر. 🟢 DD &lt; 20% | 🟡 DD 20-35% | 🔴 DD &gt; 35%
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">الاستراتيجية + الفلتر</TableHead>
                        <TableHead className="text-right">صفقات</TableHead>
                        <TableHead className="text-right">WR</TableHead>
                        <TableHead className="text-right">العائد</TableHead>
                        <TableHead className="text-right">Max DD</TableHead>
                        <TableHead className="text-right">PF</TableHead>
                        <TableHead className="text-right">streak</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {/* V40.2 baseline row */}
                      <TableRow className="bg-blue-50 dark:bg-blue-950/20 border-b-2 border-blue-200">
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-blue-600">V40.2 إنتاج</Badge>
                            <span className="text-xs text-muted-foreground">(6 شهور فقط)</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono">{V402_BASELINE.trades}</TableCell>
                        <TableCell className="font-mono">{V402_BASELINE.win_rate_pct}%</TableCell>
                        <TableCell className={`font-mono ${colorRet(V402_BASELINE.total_return_pct)}`}>{pct(V402_BASELINE.total_return_pct)}</TableCell>
                        <TableCell className={`font-mono ${ddColor(-V402_BASELINE.max_drawdown_pct)}`}>{pct(-V402_BASELINE.max_drawdown_pct)}</TableCell>
                        <TableCell className={`font-mono ${pfColor(V402_BASELINE.profit_factor)}`}>{V402_BASELINE.profit_factor.toFixed(2)}</TableCell>
                        <TableCell className="font-mono text-muted-foreground">—</TableCell>
                      </TableRow>

                      {STRATEGIES.map((strat) => (
                        MODES.map((mode) => {
                          const key = `${strat} [${mode}]`
                          const m = data.results[key]
                          if (!m) return null
                          const dd = data.drawdown_analysis[key]
                          const isWinner = key === "Correction [stock]"
                          const passesDD = m.max_drawdown_pct > -20
                          return (
                            <TableRow key={key} className={isWinner ? "bg-emerald-50 dark:bg-emerald-950/30 border-l-4 border-emerald-500" : ""}>
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span>{strat}</span>
                                  <Badge variant="outline" className="font-mono text-xs">{MODE_EMOJI[mode]} {mode}</Badge>
                                  {isWinner && <Badge className="bg-emerald-600">✓ DD&lt;20%</Badge>}
                                </div>
                              </TableCell>
                              <TableCell className="font-mono">{m.trades}</TableCell>
                              <TableCell className="font-mono">{m.win_rate_pct.toFixed(1)}%</TableCell>
                              <TableCell className={`font-mono ${colorRet(m.total_return_pct)}`}>{pct(m.total_return_pct)}</TableCell>
                              <TableCell className={`font-mono ${ddColor(m.max_drawdown_pct)}`}>{pct(m.max_drawdown_pct)}</TableCell>
                              <TableCell className={`font-mono ${pfColor(m.profit_factor)}`}>{m.profit_factor.toFixed(2)}</TableCell>
                              <TableCell className="font-mono text-muted-foreground">{dd.max_loss_streak}</TableCell>
                            </TableRow>
                          )
                        })
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* DD analysis per strategy */}
            <Card>
              <CardHeader>
                <CardTitle>تحليل الـ Drawdown — إمتى الخسائر + الأشهر الكارثية</CardTitle>
                <CardDescription>المقارنة بين الأوضاع لكل استراتيجية. الأخضر = تحسن، الأحمر = تأذّى.</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="Correction">
                  <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full mb-4">
                    {STRATEGIES.map((s) => (
                      <TabsTrigger key={s} value={s} className="font-mono text-xs sm:text-sm">{s}</TabsTrigger>
                    ))}
                  </TabsList>

                  {STRATEGIES.map((strat) => (
                    <TabsContent key={strat} value={strat} className="space-y-4">
                      {/* mode comparison for this strategy */}
                      <div className="grid sm:grid-cols-3 gap-3">
                        {MODES.map((mode) => {
                          const key = `${strat} [${mode}]`
                          const m = data.results[key]
                          const dd = data.drawdown_analysis[key]
                          return (
                            <div key={mode} className={`p-3 rounded-md border ${mode === "stock" ? "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20" : "bg-muted/30"}`}>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-lg">{MODE_EMOJI[mode]}</span>
                                <span className="font-semibold text-sm">{MODE_LABELS[mode]}</span>
                              </div>
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between"><span className="text-muted-foreground">صفقات</span><span className="font-mono">{m.trades}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">العائد</span><span className={`font-mono ${colorRet(m.total_return_pct)}`}>{pct(m.total_return_pct)}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">Max DD</span><span className={`font-mono ${ddColor(m.max_drawdown_pct)}`}>{pct(m.max_drawdown_pct)}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">PF</span><span className={`font-mono ${pfColor(m.profit_factor)}`}>{m.profit_factor.toFixed(2)}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">streak</span><span className="font-mono">{dd.max_loss_streak}</span></div>
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {/* monthly breakdown for "stock" mode (the winner) */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-2">
                          الأداء الشهري لـ {strat} [stock] (الوضع الفائز):
                        </p>
                        <div className="max-h-72 overflow-y-auto rounded-md border">
                          <Table>
                            <TableHeader className="sticky top-0 bg-background z-10">
                              <TableRow>
                                <TableHead className="text-right">الشهر</TableHead>
                                <TableHead className="text-right">صفقات</TableHead>
                                <TableHead className="text-right">WR</TableHead>
                                <TableHead className="text-right">العائد</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(() => {
                                const key = `${strat} [stock]`
                                const dd = data.drawdown_analysis[key]
                                if (!dd || !dd.monthly) return null
                                return Object.entries(dd.monthly).map(([month, v]) => (
                                  <TableRow key={month} className={v.ret_pct < -10 ? "bg-red-50 dark:bg-red-950/20" : v.ret_pct > 20 ? "bg-emerald-50 dark:bg-emerald-950/20" : ""}>
                                    <TableCell className="font-mono text-xs">{month}</TableCell>
                                    <TableCell className="font-mono">{v.trades}</TableCell>
                                    <TableCell className="font-mono">{v.win_rate}%</TableCell>
                                    <TableCell className={`font-mono ${colorRet(v.ret_pct)}`}>{pct(v.ret_pct)}</TableCell>
                                  </TableRow>
                                ))
                              })()}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              </CardContent>
            </Card>

            {/* Filter logic explanation */}
            <Card>
              <CardHeader>
                <CardTitle>منطق فلتر الـ Regime — كيف يعمل</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3 text-muted-foreground leading-relaxed">
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-md border bg-muted/30">
                    <p className="font-semibold text-foreground mb-1">🔴 none (بدون فلتر)</p>
                    <p className="text-xs">الـbaseline الأصلي. يدخل في كل الإشارات بما فيها bear markets. ده اللي خسر في يوليو-أغسطس 2025.</p>
                  </div>
                  <div className="p-3 rounded-md border border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20">
                    <p className="font-semibold text-foreground mb-1">🟢 stock (فلتر السهم)</p>
                    <p className="text-xs">يدخل فقط لو <span className="font-mono">close &gt; MA50</span> للسهم نفسه. يمنع دخول الأسهم في ترند هابط. الـ sweet spot.</p>
                  </div>
                  <div className="p-3 rounded-md border bg-amber-50/30 dark:bg-amber-950/10">
                    <p className="font-semibold text-foreground mb-1">🟡 both (فلتر مزدوج)</p>
                    <p className="text-xs">stock MA50 + market proxy MA50. متشدد زيادة، قتل العائد في معظم الحالات.</p>
                  </div>
                </div>
                <div className="pt-2 border-t">
                  <p className="font-semibold text-foreground mb-1">Market proxy</p>
                  <p className="text-xs">
                    بنينا index للسوق المصري (equal-weighted daily return لـ442 سهم ثم cumulative).
                    الفلتر "both" يتطلب إن السهم فوق MA50 <span className="font-semibold">و</span> السوق كله فوق MA50.
                    النتيجة: متشدد زيادة لأن السوق الـproxy كان bearish في فترات طويلة.
                    حالة السوق على مدار 19 شهر: <span className="font-mono">{data.meta.market_regime}</span>.
                  </p>
                </div>
                <div className="pt-2 border-t">
                  <p className="font-semibold text-foreground mb-1">الخلاصة</p>
                  <p className="text-xs">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">Correction [stock]</span> هو
                    الـ variant الوحيد اللي بـ يحقق DD &lt; 20% (سجل -9% بس). PF 3.09 ممتاز. لكن 12 صفقة فقط في 19 شهر = نادر جدًا.
                    الخيار العملي: استخدامه كـ <span className="font-semibold">pre-filter inside V40.2</span> مش كنظام مستقل.
                  </p>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>

      <footer className="mt-auto border-t bg-muted/30">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 text-xs text-muted-foreground flex flex-col sm:flex-row justify-between items-center gap-2">
          <span>GLMinvestment · اختبار فلتر الـ Regime · DD &lt; 20% هو المعيار · الأرقام هي الحكم</span>
          <span className="font-mono">vps-service/strategies_merge/regime_filter + scripts/regime_filter_backtest.py</span>
        </div>
      </footer>
    </div>
  )
}
