/**
 * Stock Icon Utility
 * 
 * Returns the URL for a stock icon if it exists, otherwise returns null.
 * Icons are stored in /public/stock-icons/{ticker}.svg
 */

/**
 * Known stock icon filenames — kept in sync with public/stock-icons/*.svg.
 * Only tickers that actually have a file are listed here, so the UI never
 * requests a missing icon (which would 404 in the console).
 */
const KNOWN_ICONS = new Set([
  // Numeric tickers
  '1010', '1020', '1030', '1050', '1060', '1080', '1111', '1120', '1140', '1150', '1180', '1182', '1183',
  '1201', '1202', '1210', '1211', '1212', '1213', '1214', '1301', '1302', '1303', '1304',
  '1320', '1321', '1322', '1323', '1324', '1810', '1820', '1830', '1832', '1833', '1835',
  '2010', '2020', '2030', '2040', '2050', '2081', '2083', '2084', '2090', '2100', '2130', '2150', '2160', '2170', '2180', '2222',
  // EGX Tickers (uppercase)
  'A', 'AALR', 'AAYAN', 'ABAR', 'ABUK', 'ACAMD', 'ACAP', 'ACGC', 'ACTF', 'ADCI', 'ADIB', 'ADPC', 'ADRI',
  'AFDI', 'AFMC', 'AIH', 'AINS', 'AJWA', 'ALAQARIA', 'ALDEERA', 'ALFTAQA', 'ALG', 'ALIMTIAZ', 'ALSAFAT',
  'ALTIJARIA', 'ALUM', 'AMAR', 'AMER', 'AMOC', 'AQAR', 'ARABREC', 'AREEC', 'ARVA', 'ARZAN', 'ASCM', 'ASIYA',
  'ASPI', 'ATC', 'ATLC', 'AXPH', 'BAYANINV', 'BEYOUT', 'BIDI', 'BINV', 'BIOC', 'BOUBYAN', 'BOURSA', 'BPCC',
  'BURG', 'CABLE', 'CAED', 'CATTL', 'CCAP', 'CEFM', 'CERA', 'CFGH', 'CGC',
  // Full company names (SVG filenames with hyphens)
  'a-capital', 'abou-kir-fertilizers', 'acrow-misr', 'act-financial', 'advanced-pharmaceutical-packaging-co',
  'ajwa-for-food-industries-company-egypt', 'al-moasher-for-programming-and-information-dissemination',
  'alexandria-cement-co', 'alexandria-company-for-refractories', 'alexandria-containers-and-goods',
  'alexandria-flour-mills', 'alexandria-mineral-oils-company', 'alexandria-new-medical-center',
  'alexandria-pharmaceuticals', 'alnahda-industrial-co', 'arab-aluminum',
  'arab-co-for-asset-management-and-development', 'arab-cotton-ginning', 'arab-developers',
  'arab-development-and-real-estate-investment', 'arab-moltaka-investments-co', 'arab-pharmaceuticals',
  'arab-polvara-spinning-and-weaving-co', 'arab-valves-company', 'arabia-for-investment-and-development',
  'arabia-investments', 'arabian-cement-company', 'asek-company-for-mining-ascom',
  'aspire-capital-for-financial-investments', 'atlas-for-investment-and-food-industries', 'b-investments',
  'barbary-investment-big', 'belton-financial', 'bonyan-for-development-and-trade',
  'egyptian-real-estate', 'el-ahli-investment-and-development', 'el-badr-investment-and-development-bid',
  'general-company-for-land-reclamationdevelopment-and-reconstru', 'glaxosmithkline', 'misr-national-steel-ataqa',
  'rights-issue-of-al-tawfeek-leasing-company-atlease-1', 'the-arab-dairy-products-co-arab-dairy-panda',
]);

/**
 * Get the stock icon URL if it exists
 * @param ticker - Stock ticker symbol (e.g., "CIBC", "COMI", "ABUK")
 * @returns URL string if icon likely exists, null otherwise
 */
export function getStockIconUrl(ticker: string): string | null {
  if (!ticker) return null;
  
  const normalizedTicker = ticker.toUpperCase().trim();
  
  // Check exact match first
  if (KNOWN_ICONS.has(normalizedTicker)) {
    return `/stock-icons/${normalizedTicker}.svg`;
  }
  
  // Check lowercase version (for full company names)
  const lowerTicker = ticker.toLowerCase().trim();
  if (KNOWN_ICONS.has(lowerTicker)) {
    return `/stock-icons/${lowerTicker}.svg`;
  }
  
  // Unknown ticker — don't request a (probably missing) file. Returning null
  // lets the component fall back to the sector emoji instead of 404-ing.
  return null;
}

/**
 * Get a fallback icon based on sector
 */
export function getSectorIcon(sector: string | null | undefined): string {
  const sectorLower = (sector || '').toLowerCase();
  
  if (sectorLower.includes('financial') || sectorLower.includes('banks') || sectorLower.includes('banking')) {
    return '🏦';
  } else if (sectorLower.includes('real estate') || sectorLower.includes('property')) {
    return '🏢';
  } else if (sectorLower.includes('basic materials') || sectorLower.includes('mining') || sectorLower.includes('materials')) {
    return '⛏️';
  } else if (sectorLower.includes('consumer') || sectorLower.includes('food') || sectorLower.includes('retail')) {
    return '🛒';
  } else if (sectorLower.includes('healthcare') || sectorLower.includes('pharma') || sectorLower.includes('medical')) {
    return '💊';
  } else if (sectorLower.includes('technology') || sectorLower.includes('telecom') || sectorLower.includes('it')) {
    return '💻';
  } else if (sectorLower.includes('energy') || sectorLower.includes('oil') || sectorLower.includes('gas')) {
    return '⛽';
  } else if (sectorLower.includes('industrials') || sectorLower.includes('manufacturing')) {
    return '🏭';
  } else if (sectorLower.includes('construction') || sectorLower.includes('building')) {
    return '🏗️';
  } else if (sectorLower.includes('crypto') || sectorLower.includes('digital')) {
    return '₿';
  } else if (sectorLower.includes('utilities')) {
    return '💡';
  } else if (sectorLower.includes('communication') || sectorLower.includes('media')) {
    return '📡';
  } else if (sectorLower.includes('automotive') || sectorLower.includes('auto')) {
    return '🚗';
  } else if (sectorLower.includes('travel') || sectorLower.includes('tourism')) {
    return '✈️';
  } else if (sectorLower.includes('agriculture') || sectorLower.includes('farming')) {
    return '🌾';
  } else {
    return '📈';
  }
}

/**
 * Stock Icon Component Props
 */
export interface StockIconProps {
  ticker: string;
  name?: string;
  sector?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Default stock icon size classes
 */
export const STOCK_ICON_SIZES = {
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
};
