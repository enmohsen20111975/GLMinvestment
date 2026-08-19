/**
 * Chart Generator for Telegram Posts
 * Generates chart images using canvas for social media sharing
 */

export interface PieChartData {
  label: string;
  value: number;
  color: string;
}

export interface BarChartData {
  label: string;
  value: number;
  color: string;
}

/**
 * Generate a pie chart as base64 PNG
 * Layout: Chart on top, legend below
 */
export function generatePieChartSVG(data: PieChartData[], options: {
  title?: string;
  size?: number;
  showLegend?: boolean;
  centerText?: string;
}): string {
  const { title, size = 400, showLegend = true, centerText } = options;

  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return '';

  const cx = size / 2 + 20; // Center with padding
  const cy = size / 2 + 50; // Offset for title
  const radius = (size / 2) - 40;

  let currentAngle = -Math.PI / 2; // Start from top
  const paths: string[] = [];
  const legendItems: Array<{ label: string; value: number; percentage: string; color: string }> = [];

  data.forEach((d, i) => {
    const percentage = d.value / total;
    const angle = percentage * 2 * Math.PI;

    // Calculate arc path
    const x1 = cx + radius * Math.cos(currentAngle);
    const y1 = cy + radius * Math.sin(currentAngle);
    const x2 = cx + radius * Math.cos(currentAngle + angle);
    const y2 = cy + radius * Math.sin(currentAngle + angle);

    const largeArc = angle > Math.PI ? 1 : 0;

    paths.push(
      `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z"
           fill="${d.color}" stroke="#fff" stroke-width="3"/>`
    );

    // Legend item - will be placed BELOW the chart
    const percentageText = (percentage * 100).toFixed(1);
    legendItems.push({
      label: d.label,
      value: d.value,
      percentage: percentageText,
      color: d.color
    });

    currentAngle += angle;
  });

  // SVG dimensions - chart width, legend below
  const svgWidth = size + 40;
  const chartHeight = size + 60;
  const legendHeight = showLegend ? data.length * 45 + 20 : 0;
  const svgHeight = chartHeight + legendHeight;

  let svg = `<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg" dir="rtl">`;

  // Background
  svg += `<rect width="100%" height="100%" fill="#ffffff"/>`;

  // Title
  if (title) {
    svg += `<text x="${cx}" y="35" font-family="Arial, sans-serif" font-size="24" font-weight="bold"
                 fill="#0f172a" text-anchor="middle">${title}</text>`;
  }

  // Chart group
  svg += `<g>`;
  svg += paths.join('\n');

  // Center circle (donut style)
  if (centerText) {
    const innerRadius = radius * 0.55;
    svg += `<circle cx="${cx}" cy="${cy}" r="${innerRadius}" fill="#ffffff"/>`;

    // Multi-line center text
    const lines = centerText.split('\n');
    const lineHeight = 32;
    const startY = cy - ((lines.length - 1) * lineHeight) / 2;

    lines.forEach((line, i) => {
      const fontSize = line.includes('%') ? 36 : 20;
      const fontWeight = line.includes('%') ? 'bold' : 'normal';
      const color = line.includes('نجاح') ? '#10b981' : '#0f172a';

      svg += `<text x="${cx}" y="${startY + i * lineHeight}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${fontWeight}"
                   fill="${color}" text-anchor="middle" dominant-baseline="middle">${line}</text>`;
    });
  }

  svg += '</g>';

  // Legend BELOW the chart
  if (showLegend && legendItems.length > 0) {
    const legendY = chartHeight + 20;
    const legendWidth = svgWidth - 40;
    const itemWidth = legendWidth / legendItems.length;

    legendItems.forEach((item, i) => {
      const x = 20 + i * itemWidth + itemWidth / 2;

      // Color box
      svg += `<rect x="${x - 15}" y="${legendY}" width="30" height="30" rx="6" fill="${item.color}"/>`;

      // Label
      svg += `<text x="${x}" y="${legendY + 50}" font-family="Arial, sans-serif" font-size="14" font-weight="bold"
                   fill="#1e293b" text-anchor="middle">${item.label}</text>`;

      // Value and percentage
      svg += `<text x="${x}" y="${legendY + 70}" font-family="Arial, sans-serif" font-size="12"
                   fill="#64748b" text-anchor="middle">${item.value.toLocaleString()} (${item.percentage}%)</text>`;
    });
  }

  svg += '</svg>';

  return svg;
}

/**
 * Generate a success rate pie chart for predictions
 */
export function generateSuccessRateChart(options: {
  success: number;
  failed: number;
  pending?: number;
  title?: string;
}): string {
  const { success, failed, pending = 0, title = 'معدل نجاح التوقعات' } = options;

  const data: PieChartData[] = [
    { label: 'حقق الهدف', value: success, color: '#10b981' },
    { label: 'وقف خسارة', value: failed, color: '#ef4444' },
  ];

  if (pending > 0) {
    data.push({ label: 'قيد التنفيذ', value: pending, color: '#3b82f6' });
  }

  const total = success + failed + pending;
  const successRate = total > 0 ? ((success / (success + failed)) * 100).toFixed(1) : '0';

  return generatePieChartSVG(data, {
    title,
    size: 400,
    showLegend: true,
    centerText: `نجاح\n${successRate}%`,
  });
}

/**
 * Generate a signal distribution chart
 */
export function generateSignalDistributionChart(signals: {
  buy: number;
  hold: number;
  sell: number;
  accumulate?: number;
}): string {
  const { buy, hold, sell, accumulate = 0 } = signals;
  
  const data: PieChartData[] = [
    { label: 'شراء', value: buy, color: '#10b981' },
    { label: 'تجميع', value: accumulate, color: '#3b82f6' },
    { label: 'احتفاظ', value: hold, color: '#f59e0b' },
    { label: 'بيع', value: sell, color: '#ef4444' },
  ].filter(d => d.value > 0);
  
  return generatePieChartSVG(data, {
    title: 'توزيع الإشارات',
    size: 280,
    showLegend: true,
  });
}

/**
 * Generate a performance bar chart
 */
export function generatePerformanceBarChart(data: BarChartData[], title: string): string {
  const maxValue = Math.max(...data.map(d => d.value));
  const chartWidth = 400;
  const chartHeight = 50 + data.length * 40;
  const barHeight = 25;
  const labelWidth = 80;
  const valueWidth = 60;
  
  let svg = `<svg width="${chartWidth}" height="${chartHeight}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect width="100%" height="100%" fill="#f8fafc"/>`;
  
  // Title
  svg += `<text x="${chartWidth / 2}" y="25" font-family="Arial, sans-serif" font-size="16" font-weight="bold" 
               fill="#1e293b" text-anchor="middle">${title}</text>`;
  
  // Bars
  data.forEach((d, i) => {
    const y = 45 + i * 40;
    const barWidth = maxValue > 0 ? (d.value / maxValue) * (chartWidth - labelWidth - valueWidth - 20) : 0;
    
    // Label
    svg += `<text x="${labelWidth - 10}" y="${y + 17}" font-family="Arial, sans-serif" font-size="12" 
                 fill="#374151" text-anchor="end">${d.label}</text>`;
    
    // Bar
    svg += `<rect x="${labelWidth}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="${d.color}"/>`;
    
    // Value
    svg += `<text x="${labelWidth + barWidth + 10}" y="${y + 17}" font-family="Arial, sans-serif" font-size="12" 
                 font-weight="bold" fill="#1e293b">${d.value.toFixed(1)}%</text>`;
  });
  
  svg += '</svg>';
  
  return svg;
}

/**
 * Generate a professional analysis card for Telegram
 */
export function generateAnalysisCard(options: {
  title: string;
  subtitle?: string;
  stats: Array<{ label: string; value: string | number; color?: string }>;
  topStocks?: Array<{ ticker: string; signal: string; price: number }>;
  platformName?: string;
  links?: { website?: string; android?: string; ios?: string };
}): string {
  const { 
    title, 
    subtitle, 
    stats, 
    topStocks = [], 
    platformName = 'دليل الاستثمار',
    links = { website: 'https://invist.m2y.net' }
  } = options;
  
  const width = 600;
  const height = 400 + (topStocks.length * 50) + (links.website ? 60 : 0);
  
  let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" dir="rtl">`;
  
  // Background gradient
  svg += `<defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0f172a"/>
      <stop offset="100%" style="stop-color:#1e293b"/>
    </linearGradient>
    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#059669"/>
      <stop offset="100%" style="stop-color:#0d9488"/>
    </linearGradient>
  </defs>`;
  
  // Background
  svg += `<rect width="100%" height="100%" fill="url(#bgGrad)"/>`;
  
  // Header
  svg += `<rect width="100%" height="80" fill="url(#headerGrad)"/>`;
  svg += `<text x="${width - 30}" y="35" font-family="Arial, sans-serif" font-size="22" font-weight="bold" 
               fill="white" text-anchor="end">${title}</text>`;
  if (subtitle) {
    svg += `<text x="${width - 30}" y="60" font-family="Arial, sans-serif" font-size="14" 
                 fill="rgba(255,255,255,0.8)" text-anchor="end">${subtitle}</text>`;
  }
  
  // Platform name
  svg += `<text x="30" y="50" font-family="Arial, sans-serif" font-size="14" font-weight="bold" 
               fill="white">${platformName}</text>`;
  
  // Stats grid
  const statsY = 110;
  const statWidth = (width - 60) / stats.length;
  
  stats.forEach((stat, i) => {
    const x = 30 + i * statWidth;
    svg += `<rect x="${x}" y="${statsY}" width="${statWidth - 10}" height="70" rx="12" fill="rgba(255,255,255,0.1)"/>`;
    svg += `<text x="${x + statWidth/2 - 5}" y="${statsY + 35}" font-family="Arial, sans-serif" font-size="20" font-weight="bold" 
                 fill="${stat.color || '#10b981'}" text-anchor="middle">${stat.value}</text>`;
    svg += `<text x="${x + statWidth/2 - 5}" y="${statsY + 55}" font-family="Arial, sans-serif" font-size="11" 
                 fill="#94a3b8" text-anchor="middle">${stat.label}</text>`;
  });
  
  // Top stocks
  if (topStocks.length > 0) {
    const stocksY = statsY + 90;
    svg += `<text x="${width - 30}" y="${stocksY}" font-family="Arial, sans-serif" font-size="14" font-weight="bold" 
                 fill="#10b981" text-anchor="end">🚀 أفضل الفرص</text>`;
    
    topStocks.forEach((stock, i) => {
      const y = stocksY + 30 + i * 45;
      svg += `<rect x="30" y="${y}" width="${width - 60}" height="40" rx="10" fill="rgba(16,185,129,0.1)" stroke="rgba(16,185,129,0.3)" stroke-width="1"/>`;
      svg += `<text x="${width - 50}" y="${y + 25}" font-family="Arial, sans-serif" font-size="14" font-weight="bold" 
                   fill="white" text-anchor="end">${stock.ticker}</text>`;
      svg += `<text x="50" y="${y + 25}" font-family="Arial, sans-serif" font-size="12" 
                   fill="#94a3b8">${stock.price.toFixed(2)} ج.م</text>`;
      svg += `<rect x="${width - 140}" y="${y + 10}" width="80" height="20" rx="10" fill="${stock.signal.includes('شراء') ? '#10b981' : stock.signal.includes('بيع') ? '#ef4444' : '#f59e0b'}20"/>`;
      svg += `<text x="${width - 100}" y="${y + 24}" font-family="Arial, sans-serif" font-size="10" font-weight="bold" 
                   fill="${stock.signal.includes('شراء') ? '#10b981' : stock.signal.includes('بيع') ? '#ef4444' : '#f59e0b'}" text-anchor="middle">${stock.signal}</text>`;
    });
  }
  
  // Footer with links
  const footerY = height - 70;
  svg += `<rect x="0" y="${footerY}" width="100%" height="70" fill="rgba(0,0,0,0.3)"/>`;
  
  // Disclaimer
  svg += `<text x="${width / 2}" y="${footerY + 20}" font-family="Arial, sans-serif" font-size="10" 
               fill="#64748b" text-anchor="middle">⚠️ هذا التحليل لأغراض تعليمية فقط ولا يعتبر نصيحة استثمارية</text>`;
  
  // Links
  if (links.website) {
    svg += `<text x="${width / 2}" y="${footerY + 45}" font-family="Arial, sans-serif" font-size="12" font-weight="bold" 
                 fill="#10b981" text-anchor="middle">🌐 ${links.website}</text>`;
    svg += `<text x="${width / 2}" y="${footerY + 60}" font-family="Arial, sans-serif" font-size="10" 
                 fill="#94a3b8" text-anchor="middle">📱 حمّل التطبيق: Android & iOS</text>`;
  }
  
  svg += '</svg>';
  
  return svg;
}

/**
 * Convert SVG string to PNG buffer using sharp (server-side).
 * Sharp is installed as an optionalDependency and ready to use.
 *
 * Returns a real PNG buffer (image/png) suitable for Telegram sendPhoto,
 * file uploads, or any consumer that expects binary PNG bytes.
 */
export async function svgToBuffer(svg: string): Promise<Buffer | null> {
  try {
    const sharp = (await import('sharp')).default;
    const pngBuffer = await sharp(Buffer.from(svg, 'utf-8'))
      .png()
      .toBuffer();
    return pngBuffer;
  } catch (error) {
    console.error('Failed to convert SVG to PNG buffer:', error);
    return null;
  }
}
