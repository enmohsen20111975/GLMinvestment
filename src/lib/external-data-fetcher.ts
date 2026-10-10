/**
 * External Data Fetcher Service
 *
 * Fetches missing fundamental data from external sources:
 * - VPS fundamentals endpoint
 * - TradingView data (via VPS)
 * - Stores the data in the local databases
 *
 * This ensures Fair Value calculations have the data they need.
 */

import { getVpsServiceUrl, fetchFundamentals, fetchPremiumAnalysis, type VpsFundamentals } from './vps-adapter'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FundamentalData {
  ticker: string
  market_cap?: number
  pe_ratio?: number
  pb_ratio?: number
  ps_ratio?: number
  ev_to_ebitda?: number
  dividend_yield?: number
  roe?: number
  roa?: number
  debt_to_equity?: number
  current_ratio?: number
  eps?: number
  book_value_per_share?: number
  shares_outstanding?: number
  sector?: string
  industry?: string
  total_equity?: number
  revenue?: number
  net_income?: number
  source?: string
  fetched_at?: string
}

export interface BatchFetchResult {
  total: number
  success: number
  failed: number
  errors: string[]
  data: FundamentalData[]
}

// ---------------------------------------------------------------------------
// VPS Fundamentals Fetcher
// ---------------------------------------------------------------------------

const VPS_TIMEOUT_MS = 15_000

/**
 * Fetch fundamentals for a single stock from VPS
 */
export async function fetchStockFundamentalsFromVps(ticker: string): Promise<FundamentalData | null> {
  const baseUrl = getVpsServiceUrl()
  if (!baseUrl) {
    console.warn('[ExternalData] VPS URL not configured')
    return null
  }

  try {
    // Try the fundamentals endpoint first
    const response = await fetch(
      `${baseUrl}/api/fundamentals/${encodeURIComponent(ticker.toUpperCase())}`,
      {
        signal: AbortSignal.timeout(VPS_TIMEOUT_MS),
        headers: { 'Accept': 'application/json' }
      }
    )

    if (!response.ok) {
      // Try premium endpoint as fallback
      const premiumResponse = await fetch(
        `${baseUrl}/api/premium/${encodeURIComponent(ticker.toUpperCase())}`,
        {
          signal: AbortSignal.timeout(VPS_TIMEOUT_MS),
          headers: { 'Accept': 'application/json' }
        }
      )

      if (!premiumResponse.ok) {
        return null
      }

      const premiumData = await premiumResponse.json() as { fundamentals?: VpsFundamentals }

      if (premiumData.fundamentals) {
        return {
          ticker: ticker.toUpperCase(),
          ...premiumData.fundamentals,
          source: 'vps-premium',
          fetched_at: new Date().toISOString()
        }
      }

      return null
    }

    const data = await response.json() as VpsFundamentals | { data: VpsFundamentals }

    // Handle both direct and wrapped responses
    const fundamentals = 'ticker' in data ? data : data.data

    return {
      ticker: ticker.toUpperCase(),
      market_cap: fundamentals.market_cap,
      pe_ratio: fundamentals.pe_ratio,
      pb_ratio: fundamentals.pb_ratio,
      ps_ratio: fundamentals.ps_ratio,
      ev_to_ebitda: fundamentals.ev_to_ebitda,
      dividend_yield: fundamentals.dividend_yield,
      roe: fundamentals.roe,
      roa: fundamentals.roa,
      debt_to_equity: fundamentals.debt_to_equity,
      current_ratio: fundamentals.current_ratio,
      eps: fundamentals.eps,
      book_value_per_share: fundamentals.book_value_per_share,
      shares_outstanding: fundamentals.shares_outstanding,
      sector: fundamentals.sector,
      industry: fundamentals.industry,
      source: 'vps-fundamentals',
      fetched_at: new Date().toISOString()
    }
  } catch (err) {
    console.warn(`[ExternalData] Failed to fetch fundamentals for ${ticker}:`, err)
    return null
  }
}

/**
 * Fetch fundamentals for multiple stocks with rate limiting
 */
export async function fetchBatchFundamentals(
  tickers: string[],
  options?: {
    concurrency?: number
    delayMs?: number
    onProgress?: (done: number, total: number) => void
  }
): Promise<BatchFetchResult> {
  const concurrency = options?.concurrency ?? 5
  const delayMs = options?.delayMs ?? 200 // 200ms between batches to avoid rate limiting

  const results: FundamentalData[] = []
  const errors: string[] = []

  for (let i = 0; i < tickers.length; i += concurrency) {
    const batch = tickers.slice(i, i + concurrency)

    const batchResults = await Promise.all(
      batch.map(async (ticker) => {
        try {
          const data = await fetchStockFundamentalsFromVps(ticker)
          return { ticker, data }
        } catch (err) {
          return { ticker, error: String(err) }
        }
      })
    )

    for (const result of batchResults) {
      if ('data' in result && result.data) {
        results.push(result.data)
      } else if ('error' in result) {
        errors.push(`${result.ticker}: ${result.error}`)
      }
    }

    // Report progress
    if (options?.onProgress) {
      options.onProgress(Math.min(i + concurrency, tickers.length), tickers.length)
    }

    // Delay between batches
    if (i + concurrency < tickers.length && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  return {
    total: tickers.length,
    success: results.length,
    failed: tickers.length - results.length,
    errors,
    data: results
  }
}

// ---------------------------------------------------------------------------
// Default sector averages for Egyptian market
// Used when we can't fetch real data
// ---------------------------------------------------------------------------

export const DEFAULT_SECTOR_DATA: Record<string, { avgPE: number; avgPB: number; avgROE: number }> = {
  'Banks': { avgPE: 6.5, avgPB: 1.2, avgROE: 20 },
  'Financial Services': { avgPE: 8.0, avgPB: 1.5, avgROE: 15 },
  'Real Estate': { avgPE: 10.0, avgPB: 1.0, avgROE: 12 },
  'Construction': { avgPE: 12.0, avgPB: 1.3, avgROE: 10 },
  'Food & Beverages': { avgPE: 14.0, avgPB: 2.0, avgROE: 18 },
  'Healthcare': { avgPE: 15.0, avgPB: 2.5, avgROE: 14 },
  'Telecommunications': { avgPE: 8.5, avgPB: 1.8, avgROE: 22 },
  'Utilities': { avgPE: 10.0, avgPB: 1.2, avgROE: 12 },
  'Materials': { avgPE: 9.0, avgPB: 1.4, avgROE: 16 },
  'Energy': { avgPE: 7.0, avgPB: 1.1, avgROE: 12 },
  'Industrials': { avgPE: 11.0, avgPB: 1.6, avgROE: 14 },
  'Consumer Discretionary': { avgPE: 16.0, avgPB: 2.2, avgROE: 15 },
  'Consumer Staples': { avgPE: 13.0, avgPB: 1.8, avgROE: 16 },
  'Information Technology': { avgPE: 20.0, avgPB: 3.0, avgROE: 18 },
  '_global': { avgPE: 12.0, avgPB: 1.5, avgROE: 15 }
}

/**
 * Estimate PE ratio from sector average if not available
 */
export function estimatePEFromSector(sector: string | null | undefined): number {
  if (!sector) return DEFAULT_SECTOR_DATA['_global'].avgPE
  return DEFAULT_SECTOR_DATA[sector]?.avgPE ?? DEFAULT_SECTOR_DATA['_global'].avgPE
}

/**
 * Estimate PB ratio from sector average if not available
 */
export function estimatePBFromSector(sector: string | null | undefined): number {
  if (!sector) return DEFAULT_SECTOR_DATA['_global'].avgPB
  return DEFAULT_SECTOR_DATA[sector]?.avgPB ?? DEFAULT_SECTOR_DATA['_global'].avgPB
}

/**
 * Get sector averages for a stock
 */
export function getSectorAverages(sector: string | null | undefined): { avgPE: number; avgPB: number; avgROE: number } {
  if (!sector) return DEFAULT_SECTOR_DATA['_global']
  return DEFAULT_SECTOR_DATA[sector] ?? DEFAULT_SECTOR_DATA['_global']
}

// ---------------------------------------------------------------------------
// Historical data fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch historical price data from VPS
 */
export async function fetchStockHistoryFromVps(
  ticker: string,
  period: string = '1y'
): Promise<Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>> {
  const baseUrl = getVpsServiceUrl()
  if (!baseUrl) {
    console.warn('[ExternalData] VPS URL not configured')
    return []
  }

  try {
    const response = await fetch(
      `${baseUrl}/api/history/${encodeURIComponent(ticker.toUpperCase())}?period=${period}`,
      {
        signal: AbortSignal.timeout(VPS_TIMEOUT_MS),
        headers: { 'Accept': 'application/json' }
      }
    )

    if (!response.ok) {
      return []
    }

    const data = await response.json() as Array<{
      date: string
      open?: number
      high?: number
      low?: number
      close?: number
      volume?: number
    }> | { data: Array<{ date: string; open?: number; high?: number; low?: number; close?: number; volume?: number }> }

    // Handle both direct array and wrapped response
    const history = Array.isArray(data) ? data : (data as { data: unknown[] }).data || []

    return history.map(h => ({
      date: h.date,
      open: h.open ?? 0,
      high: h.high ?? 0,
      low: h.low ?? 0,
      close: h.close ?? 0,
      volume: h.volume ?? 0
    }))
  } catch (err) {
    console.warn(`[ExternalData] Failed to fetch history for ${ticker}:`, err)
    return []
  }
}

// ---------------------------------------------------------------------------
// Data enrichment - combine VPS data with local data
// ---------------------------------------------------------------------------

/**
 * Enrich a stock record with external fundamental data
 */
export function enrichStockWithFundamentals(
  stock: Record<string, unknown>,
  fundamentals: FundamentalData | null
): Record<string, unknown> {
  if (!fundamentals) return stock

  return {
    ...stock,
    // Only override if local value is missing or 0
    market_cap: stock.market_cap || fundamentals.market_cap || stock.market_cap,
    pe_ratio: stock.pe_ratio || fundamentals.pe_ratio || stock.pe_ratio,
    pb_ratio: stock.pb_ratio || fundamentals.pb_ratio || stock.pb_ratio,
    ps_ratio: stock.ps_ratio || fundamentals.ps_ratio || stock.ps_ratio,
    dividend_yield: stock.dividend_yield || fundamentals.dividend_yield || stock.dividend_yield,
    roe: stock.roe || fundamentals.roe || stock.roe,
    roa: stock.roa || fundamentals.roa || stock.roa,
    debt_to_equity: stock.debt_to_equity || fundamentals.debt_to_equity || stock.debt_to_equity,
    eps: stock.eps || fundamentals.eps || stock.eps,
    book_value_per_share: stock.book_value_per_share || fundamentals.book_value_per_share || stock.book_value_per_share,
    shares_outstanding: stock.shares_outstanding || fundamentals.shares_outstanding || stock.shares_outstanding,
    sector: stock.sector || fundamentals.sector || stock.sector,
    industry: stock.industry || fundamentals.industry || stock.industry,
    _fundamentals_source: fundamentals.source,
    _fundamentals_fetched_at: fundamentals.fetched_at
  }
}
