/**
 * GET /api/market/investing
 * 
 * Fetches EGX stock data from Investing.com as a supplementary data source.
 * Uses the z-ai-web-dev-sdk page_reader to extract stock fundamentals.
 * 
 * Query params:
 *   - type: "snapshot" (default) | "detail" 
 *   - symbol: stock ticker (required for type=detail)
 * 
 * This is a TEST integration — can be deleted if not needed.
 */
import { NextRequest, NextResponse } from 'next/server';

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
let cache: { data: unknown; timestamp: number } | null = null;

async function fetchInvestingPage(url: string) {
  const ZAI = await import('z-ai-web-dev-sdk').then(m => m.default || m);
  const zai = await ZAI.create();
  const result = await zai.functions.invoke('page_reader', { url });
  if (!result || !result.data || !result.data.html) {
    throw new Error('Failed to fetch page');
  }
  return result.data.html;
}

function extractJsonArray(html: string, marker: string) {
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const arrayStart = html.lastIndexOf(':[', idx) + 1;
  let depth = 0, end = arrayStart;
  for (let i = arrayStart; i < html.length && i < arrayStart + 5_000_000; i++) {
    if (html[i] === '[') depth++;
    if (html[i] === ']') depth--;
    if (depth === 0) { end = i + 1; break; }
  }
  try {
    return JSON.parse(html.substring(arrayStart, end));
  } catch {
    return null;
  }
}

function extractNextData(html: string) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'snapshot';
    const symbol = searchParams.get('symbol')?.toUpperCase();

    // === SNAPSHOT: All EGX30 stocks from Egypt equities page ===
    if (type === 'snapshot') {
      if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
        return NextResponse.json({ success: true, ...(cache.data as object), cached: true });
      }

      const html = await fetchInvestingPage('https://www.investing.com/equities/egypt');
      
      let egxStocks: Array<Record<string, unknown>> = [];
      
      // Primary: Egypt equities page
      const marker = '"symbol":"CCAP"';
      if (html.includes(marker)) {
        const stocks = extractJsonArray(html, marker);
        if (stocks) {
          egxStocks = stocks
            .filter((s: Record<string, unknown>) => String(s.exchangeId) === '33')
            .map((s: Record<string, unknown>) => ({
              symbol: s.symbol,
              name: s.name || '',
              instrumentId: s.id || '',
              lastPrice: s.last ? parseFloat(String(s.last)) : null,
              peRatio: s.peRatio != null ? parseFloat(String(s.peRatio)) : null,
              marketCap: s.marketCap ? parseFloat(String(s.marketCap)) : null,
              changeOneMonth: s.changeOneMonth ? parseFloat(String(s.changeOneMonth)) : null,
              changeOneYear: s.changeOneYear ? parseFloat(String(s.changeOneYear)) : null,
              volumeThreeMonths: s.volumeThreeMonths ? parseInt(String(s.volumeThreeMonths)) : null,
              beta: s.beta != null && s.beta !== undefined ? parseFloat(String(s.beta)) : null,
            }));
        }
      }

      // Fallback: EGX30 components page
      if (egxStocks.length === 0) {
        const egxHtml = await fetchInvestingPage('https://www.investing.com/indices/egx30-components');
        const comiMarker = '"symbol":"COMI"';
        if (egxHtml.includes(comiMarker)) {
          const stocks = extractJsonArray(egxHtml, comiMarker);
          if (stocks) {
            egxStocks = stocks
              .filter((s: Record<string, unknown>) => String(s.exchangeId) === '33')
              .map((s: Record<string, unknown>) => ({
                symbol: s.symbol,
                name: (s.name as Record<string, string>)?.title || (s.name as Record<string, string>)?.label || '',
                instrumentId: s.instrumentId || '',
                lastPrice: s.last ? parseFloat(String(s.last)) : null,
                change: s.change ? parseFloat(String(s.change)) : null,
                changePercent: s.changePercent ? parseFloat(String(s.changePercent)) : null,
                volume: s.avgVolume || s._liveVolume || null,
              }));
          }
        }
      }

      const result = {
        success: true,
        source: 'investing.com',
        fetched_at: new Date().toISOString(),
        exchange: 'EGX',
        stock_count: egxStocks.length,
        stocks: egxStocks,
      };

      cache = { data: result, timestamp: Date.now() };
      return NextResponse.json(result);
    }

    // === DETAIL: Individual stock data ===
    if (type === 'detail' && symbol) {
      const urlMap: Record<string, string> = {
        'COMI': 'com-intl-bk',
        'ORAS': 'orascom-construction-ltd',
        'ETEL': 'telecom-egypt',
        'CCAP': 'qalaa-holdings',
        'TMGH': 't-m-g-holding',
        'FWRY': 'fawry-banking-and-payment',
        'EFIH': 'e-finance',
        'EAST': 'eastern-tobacco',
        'GBCO': 'gb-auto',
        'ABUK': 'abu-qir-fertilizers',
        'ADIB': 'abu-dhabi-islamic-bank-egypt',
        'ORHD': 'orascom-hotels',
        'EMFD': 'emaar-misr-for-development-sae',
        'EFID': 'edita-food',
        'ISPH': 'ibnsina-pharma',
        'RMDA': 'tenth-of-ramadan-for-pharmaceutical',
        'RAYA': 'raya-holding',
        'PHDC': 'palm-hills-develop',
        'HRHO': 'efg-hermes-holdings',
        'MCQE': 'misr-cement',
        'AMOC': 'alexandria-mineral-oils',
        'HELI': 'misr-el-gadida-for-housing-dev',
        'ORWE': 'oriental-weavers',
        'JUFO': 'juhayna-food',
        'EGAL': 'egypt-aluminum',
        'BTFH': 'beltone-financial-hld',
        'ARCC': 'arabian-cement-co-sae',
        'OIH': 'orascom-invest',
        'EGCH': 'kima',
        'VLMR': 'valmore-holding',
        'VLMRA': 'valmore-holding',
      };

      const slug = urlMap[symbol];
      if (!slug) {
        return NextResponse.json({ success: false, message: `Symbol ${symbol} not found in URL map` }, { status: 404 });
      }

      const html = await fetchInvestingPage(`https://www.investing.com/equities/${slug}`);
      const nextData = extractNextData(html);

      if (!nextData) {
        return NextResponse.json({ success: false, message: 'Could not parse page data' }, { status: 500 });
      }

      const equityStore = nextData.props?.pageProps?.state?.equityStore;
      const instrument = equityStore?.instrument;
      const price = instrument?.price;
      const divs = nextData.props?.pageProps?.state?.dividendsStore?.summary;
      const technical = nextData.props?.pageProps?.state?.technicalStore?.technicalData;

      return NextResponse.json({
        success: true,
        source: 'investing.com',
        fetched_at: new Date().toISOString(),
        symbol,
        data: {
          price: {
            last: price?.last ? parseFloat(price.last) : null,
            open: price?.open ? parseFloat(price.open) : null,
            high: price?.high ? parseFloat(price.high) : null,
            low: price?.low ? parseFloat(price.low) : null,
            change: price?.change ? parseFloat(price.change) : null,
            changePercent: price?.changePcr ? parseFloat(price.changePcr) : null,
            currency: price?.currency,
            fiftyTwoWeekHigh: price?.fiftyTwoWeekHigh ? parseFloat(price.fiftyTwoWeekHigh) : null,
            fiftyTwoWeekLow: price?.fiftyTwoWeekLow ? parseFloat(price.fiftyTwoWeekLow) : null,
            volume: price?.volume ? parseInt(price.volume) : null,
          },
          instrument: {
            id: instrument?.base?.id,
            type: instrument?.base?.companyType,
            name: instrument?.englishName?.shortName,
          },
          dividends: divs ? {
            annualizedPayout: divs.annualized_payout,
            dividendYield: divs.dividend_yield ? parseFloat(divs.dividend_yield) : null,
            payoutRatio: divs.payout_ratio ? parseFloat(divs.payout_ratio) : null,
            fiveYearGrowth: divs.five_year_dividend_growth ? parseFloat(divs.five_year_dividend_growth) : null,
          } : null,
          technical: technical ? {
            rsi: technical.indicators?.rsi?.value,
            macd: technical.indicators?.macd?.value,
            summary: technical.indicators?.summary?.value,
            buy: technical.indicators?.summary?.buy,
            sell: technical.indicators?.summary?.sell,
            neutral: technical.indicators?.summary?.neutral,
            pivot: technical.pivotPoints?.pivot ? parseFloat(technical.pivotPoints.pivot) : null,
            support1: technical.pivotPoints?.s1 ? parseFloat(technical.pivotPoints.s1) : null,
            resistance1: technical.pivotPoints?.r1 ? parseFloat(technical.pivotPoints.r1) : null,
          } : null,
        },
      });
    }

    return NextResponse.json(
      { success: false, message: 'Invalid type. Use "snapshot" or "detail?symbol=COMI"' },
      { status: 400 }
    );
  } catch (err) {
    console.error('[Investing API] Error:', err);
    return NextResponse.json({
      success: false,
      message: 'Error fetching Investing.com data: ' + String(err),
    }, { status: 500 });
  }
}
