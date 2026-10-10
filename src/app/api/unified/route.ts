import { NextRequest, NextResponse } from 'next/server'
import { PYTHON_BACKEND_URL } from '@/lib/python-backend'
import { classifySignal, signalAr } from '@/lib/canonical-signal'

export const dynamic = 'force-dynamic'

const MARKET_PROFILES = {
  EGX: { code: 'EGX', name_ar: '??????? ???????', min_score: 65, min_rr: 1.5, position_pct: 5, max_trades: 10 },
  TADAWUL: { code: 'TADAWUL', name_ar: '????? ???????', min_score: 65, min_rr: 1.5, position_pct: 5, max_trades: 10 },
  KSE: { code: 'KSE', name_ar: '????? ??????', min_score: 65, min_rr: 1.5, position_pct: 5, max_trades: 10 },
  QSE: { code: 'QSE', name_ar: '????? ???', min_score: 65, min_rr: 1.5, position_pct: 5, max_trades: 10 },
  DFM: { code: 'DFM', name_ar: '??? ??? ??????', min_score: 65, min_rr: 1.5, position_pct: 5, max_trades: 10 },
  ADX: { code: 'ADX', name_ar: '??? ?????? ??????? ???????', min_score: 65, min_rr: 1.5, position_pct: 5, max_trades: 10 }
}

const PERSONA_PROFILES = {
  scalper: { id: 'scalper', name_ar: '????? ????', min_rr: 1.2, position_pct: 2, max_trades: 15, score_boost: -5 },
  trader: { id: 'trader', name_ar: '?????? ???', min_rr: 1.5, position_pct: 5, max_trades: 10, score_boost: 0 },
  investor: { id: 'investor', name_ar: '?????? ???', min_rr: 2.0, position_pct: 8, max_trades: 5, score_boost: 5 },
  conservative: { id: 'conservative', name_ar: '????? ????', min_rr: 2.5, position_pct: 10, max_trades: 3, score_boost: 15 }
}

// --- GET Handler -------------------------------------------------------------
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const action = searchParams.get('action') || 'markets'

  switch (action) {
    case 'markets':
      return NextResponse.json({
        markets: Object.values(MARKET_PROFILES),
        count: Object.keys(MARKET_PROFILES).length
      })

    case 'personas':
      return NextResponse.json({
        personas: Object.values(PERSONA_PROFILES),
        count: Object.keys(PERSONA_PROFILES).length
      })

    case 'config': {
      const market = searchParams.get('market') || 'EGX'
      const persona = searchParams.get('persona') || 'trader'

      const marketProfile = MARKET_PROFILES[market as keyof typeof MARKET_PROFILES]
      const personaProfile = PERSONA_PROFILES[persona as keyof typeof PERSONA_PROFILES]

      if (!marketProfile || !personaProfile) {
        return NextResponse.json({ error: 'Invalid market or persona' }, { status: 400 })
      }

      return NextResponse.json({
        config: {
          market: marketProfile.code,
          persona: personaProfile.id,
          min_score_buy: marketProfile.min_score + (personaProfile.score_boost || 0),
          min_rr: personaProfile.min_rr || marketProfile.min_rr,
          position_size: personaProfile.position_pct,
          max_trades: personaProfile.max_trades
        },
        market_profile: marketProfile,
        persona_profile: personaProfile,
        effective: {
          min_score_buy: marketProfile.min_score + (personaProfile.score_boost || 0),
          min_rr: personaProfile.min_rr || marketProfile.min_rr,
          position_size: personaProfile.position_pct,
          max_trades: personaProfile.max_trades,
          stop_atr_mult: 1.5,
          target_rr_mult: 2.0
        }
      })
    }

    default:
      return NextResponse.json({ error: `action ??? ?????: ${action}` }, { status: 400 })
  }
}

// --- POST Handler -------------------------------------------------------------
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = body.action || 'analyze'

  switch (action) {
    case 'analyze': {
      const ticker = (body.ticker || '').toUpperCase()
      const market = (body.market || 'EGX').toUpperCase()
      const persona = (body.persona || 'trader').toLowerCase()

      if (!ticker) {
        return NextResponse.json({ error: '??? ????? ??? ????? (ticker)' }, { status: 400 })
      }

      try {
        const baseTicker = ticker.split('.')[0]
        const response = await fetch(`${PYTHON_BACKEND_URL}/api/v2/analysis/${baseTicker}`, {
          cache: 'no-store'
        })
        const data = await response.json()

        if (!data.success || !data.data) {
          return NextResponse.json({ error: data.error || '??? ???????' }, { status: 404 })
        }

        const analysis = data.data
        const risk = analysis.risk_profile || {}
        const personaProfile = PERSONA_PROFILES[persona as keyof typeof PERSONA_PROFILES]
        const scoreBoost = personaProfile ? personaProfile.score_boost : 0
        // AUDIT-FIX (2026-10-09): ????? fallback score=50 (Rule 27 NO-FAKE-DATA).
        // ?? master_score = null ? finalScore = null ? signal = null.
        const rawScore = analysis.master_score ?? null;
        const finalScore = rawScore === null ? null : Math.max(10, Math.min(95, rawScore + scoreBoost));

        // RULE-73 UNIFY: ?????? canonical classifySignal (78/65/55/40/25) ??? 75/60/50 ?????????.
        // ??? ???: ??? ????? ??? ????? BUY ??? ? ACCUMULATE ?? StockDetail = ????? ???? ?????.
        let signal: string | null = null;
        let signal_ar: string | null = null;
        if (finalScore !== null) {
          const canonical = classifySignal(finalScore);
          signal = canonical;
          signal_ar = signalAr(canonical);
        }

        const result = {
          ticker: analysis.ticker,
          market: analysis.market || market,
          persona,
          signal,
          signal_ar,
          score: finalScore,
          // AUDIT-FIX: ????? confidence=75 fallback (Rule 27)
          confidence: analysis.confidence ?? null,
          current_price: risk.entry_price || analysis.current_price || 0,
          entry_price: risk.entry_price || analysis.current_price || 0,
          stop_loss: risk.stop_loss_price || 0,
          stop_loss_pct: (risk.stop_pct || 0).toFixed(1),
          target_1: risk.target_price || 0,
          target_pct: (risk.target_pct || 0).toFixed(1),
          risk_reward: (risk.risk_reward_ratio || 0).toFixed(2),
          rsi: analysis.technical_score || 50,
          market_regime: analysis.session_phase || 'NEUTRAL',
          rsi_override: false,
          rr_valid: (risk.risk_reward_ratio || 0) >= (personaProfile?.min_rr || 1.5),
          rejection_reason: risk.is_valid_trade ? null : (risk.warnings && risk.warnings[0] ? risk.warnings[0] : '??? ???? ????????'),
          warnings: analysis.liquidity_warning ? [analysis.liquidity_warning] : [],
          technical_score: analysis.technical_score || 50,
          volume_score: analysis.timing_score || 50,
          candle_score: analysis.pattern_score || 50,
          buy_reasons: analysis.technical_summary ? [analysis.technical_summary] : [],
          sell_reasons: analysis.fundamental_summary ? [analysis.fundamental_summary] : [],
          market_regime_ar: analysis.market_regime_ar || '??? ?????',
          market_regime_strength: analysis.market_regime_strength || 0,
          sector_relative_score: analysis.sector_relative_score || 50
        }

        return NextResponse.json({
          success: true,
          result,
          config_used: {
            market,
            persona
          }
        })
      } catch (e) {
        console.error('Error forwarding analysis to Python:', e)
        return NextResponse.json({ error: '??? ??????? ????? ??????? ?? ????????' }, { status: 502 })
      }
    }

    case 'scan': {
      const market = (body.market || 'EGX').toUpperCase()
      const persona = (body.persona || 'trader').toLowerCase()
      const topN = body.top_n || 20

      const personaMap: Record<string, string> = {
        scalper: 'active_trader',
        trader: 'balanced',
        investor: 'cautious',
        conservative: 'conservative'
      }
      const pythonPersona = personaMap[persona] || 'balanced'

      try {
        const response = await fetch(`${PYTHON_BACKEND_URL}/api/v2/scanner/${pythonPersona}?market=${market}&cache=true`, {
          cache: 'no-store'
        })
        const data = await response.json()

        if (!data.success || !data.results) {
          return NextResponse.json({ error: data.error || '??? ?????' }, { status: 404 })
        }

        const results = data.results.map((item: Record<string, unknown>) => {
          const adj = item.persona_adjusted || {}
          const entryPrice = item.entry_price || item.current_price || 0
          
          return {
            ticker: item.ticker,
            market: item.market || market,
            persona,
            signal: adj.adjusted_signal || item.signal || 'HOLD',
            signal_ar: adj.adjusted_signal === 'BUY' ? '????' : adj.adjusted_signal === 'STRONG_BUY' ? '???? ???' : adj.adjusted_signal === 'SELL' ? '???' : '??????',
            score: adj.adjusted_score || item.master_score || 50,
            confidence: item.confidence || 75,
            current_price: entryPrice,
            entry_price: entryPrice,
            stop_loss: item.stop_loss || 0,
            stop_loss_pct: (item.stop_loss && entryPrice) ? (((entryPrice - item.stop_loss) / entryPrice) * 100).toFixed(1) : '0.0',
            target_1: item.target_price || 0,
            target_pct: (item.target_price && entryPrice) ? (((item.target_price - entryPrice) / entryPrice) * 100).toFixed(1) : '0.0',
            risk_reward: (item.risk_reward || item.risk_reward_ratio || 0).toFixed(2),
            rsi: item.technical_score || 50,
            market_regime: item.session_phase || 'NEUTRAL',
            rsi_override: false,
            rr_valid: item.rr_valid || false,
            rejection_reason: null,
            warnings: item.liquidity_warning ? [item.liquidity_warning] : [],
            technical_score: item.technical_score || 50,
            volume_score: item.timing_score || 50,
            candle_score: item.pattern_score || 50,
            buy_reasons: item.technical_summary ? [item.technical_summary] : [],
            sell_reasons: item.fundamental_summary ? [item.fundamental_summary] : []
          }
        })

        results.sort((a: Record<string, unknown>, b: Record<string, unknown>) => b.score - a.score)

        const stats = {
          strong_buy: results.filter((r: Record<string, unknown>) => r.signal === 'STRONG_BUY').length,
          buy: results.filter((r: Record<string, unknown>) => r.signal === 'BUY' || r.signal === 'STRONG_BUY').length,
          accumulate: results.filter((r: Record<string, unknown>) => r.signal === 'ACCUMULATE').length,
          hold: results.filter((r: Record<string, unknown>) => r.signal === 'HOLD').length,
          avg_score: results.length > 0 ? results.reduce((a: Record<string, unknown>, b: Record<string, unknown>) => a + b.score, 0) / results.length : 0,
          avg_rr: 0
        }

        return NextResponse.json({
          success: true,
          market,
          persona,
          analyzed: data.total_analyzed || results.length,
          found: results.length,
          stats,
          results: results.slice(0, topN),
          generated_at: new Date().toISOString()
        })
      } catch (e) {
        console.error('Error forwarding scan to Python:', e)
        return NextResponse.json({ error: '??? ??????? ????? ????? ?????????' }, { status: 502 })
      }
    }

    case 'compare': {
      const ticker = (body.ticker || '').toUpperCase()
      const market = (body.market || 'EGX').toUpperCase()

      if (!ticker) {
        return NextResponse.json({ error: 'ticker ?????' }, { status: 400 })
      }

      try {
        const baseTicker = ticker.split('.')[0]
        const comparison: Record<string, unknown> = {}

        const mappedPersonas = [
          { id: 'scalper', py: 'active_trader', name_ar: '????? ????' },
          { id: 'trader', py: 'balanced', name_ar: '?????? ???' },
          { id: 'investor', py: 'cautious', name_ar: '??????' },
          { id: 'conservative', py: 'conservative', name_ar: '?????' }
        ]

        const response = await fetch(`${PYTHON_BACKEND_URL}/api/v2/analysis/${baseTicker}`, {
          cache: 'no-store'
        })
        const data = await response.json()

        if (!data.success || !data.data) {
          return NextResponse.json({ error: '??? ????? ?????? ????????' }, { status: 404 })
        }

        const analysis = data.data
        const risk = analysis.risk_profile || {}

        for (const p of mappedPersonas) {
          const personaProfile = PERSONA_PROFILES[p.id as keyof typeof PERSONA_PROFILES]
          const scoreBoost = personaProfile ? personaProfile.score_boost : 0
          const finalScore = Math.max(10, Math.min(95, (analysis.master_score || 50) + scoreBoost))

          // RULE-73 UNIFY: canonical classifySignal (78/65/55/40/25) — ?? thresholds ?????.
          const canonical = classifySignal(finalScore);
          const signal = canonical;
          const signal_ar = signalAr(canonical);

          comparison[p.id] = {
            persona_ar: p.name_ar,
            signal,
            signal_ar,
            score: finalScore,
            confidence: analysis.confidence || 75,
            min_score: MARKET_PROFILES[market as keyof typeof MARKET_PROFILES]?.min_score || 65,
            stop_loss: risk.stop_loss_price || 0,
            target: risk.target_price || 0,
            rr: risk.risk_reward_ratio || 0,
            valid: (risk.risk_reward_ratio || 0) >= (personaProfile?.min_rr || 1.5),
            warnings: analysis.liquidity_warning ? [analysis.liquidity_warning] : []
          }
        }

        return NextResponse.json({
          ticker,
          market,
          comparison
        })
      } catch (e) {
        console.error('Error in compare action:', e)
        return NextResponse.json({ error: '??? ?? ????? ?????? ?????????' }, { status: 502 })
      }
    }

    default:
      return NextResponse.json({ error: `action ??? ?????: ${action}` }, { status: 400 })
  }
}
