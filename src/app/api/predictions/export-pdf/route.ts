/**
 * Predictions PDF Export API
 * ===========================
 * تصدير تقرير التوقعات بصيغة PDF
 * 
 * ⚠️ القاعدة الذهبية: Python = THE BRAIN, Next.js = DISPLAY ONLY
 * 
 * هذا الـ API يجلب البيانات من Python Backend ويولد PDF
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';

interface PredictionRecord {
  id: string;
  symbol: string;
  name?: string;
  signal_type: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  current_price?: number;
  status: string;
  hit_target: boolean;
  hit_stop: boolean;
  actual_return?: number;
  holding_days?: number;
  prediction_date: string;
  target_hit_date?: string;
  market: string;
  confidence: number;
}

// Generate HTML for PDF
function generateReportHTML(
  stats: any,
  predictions: PredictionRecord[],
  filters: { market?: string; days: number }
): string {
  const today = new Date().toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const successRate = stats.win_rate || 0;
  const totalPredictions = stats.total_predictions || 0;
  const targetsHit = stats.targets_hit || 0;
  const stopsHit = stats.stops_hit || 0;
  const avgReturn = stats.avg_return || 0;

  // Status badge color
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'TARGET_HIT': return '#10B981';
      case 'STOPPED': return '#EF4444';
      case 'EXPIRED': return '#F59E0B';
      default: return '#6B7280';
    }
  };

  const getStatusText = (status: string): string => {
    switch (status) {
      case 'TARGET_HIT': return 'تحقق الهدف ✓';
      case 'STOPPED': return 'ضرب الوقف ✗';
      case 'EXPIRED': return 'منتهي';
      case 'PENDING': return 'قيد التنفيذ';
      default: return status;
    }
  };

  // Generate predictions table rows
  const tableRows = predictions.slice(0, 50).map(p => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${p.symbol}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${p.name || '-'}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">
        <span style="padding: 2px 8px; border-radius: 4px; background: ${p.signal_type === 'BUY' ? '#dcfce7' : p.signal_type === 'SELL' ? '#fee2e2' : '#f3f4f6'}; color: ${p.signal_type === 'BUY' ? '#166534' : p.signal_type === 'SELL' ? '#991b1b' : '#374151'}; font-size: 12px;">
          ${p.signal_type === 'BUY' ? 'شراء' : p.signal_type === 'SELL' ? 'بيع' : p.signal_type === 'HOLD' ? 'انتظار' : p.signal_type}
        </span>
      </td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">${p.entry_price?.toFixed(2) || '-'}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">${p.target_price?.toFixed(2) || '-'}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">${p.stop_loss?.toFixed(2) || '-'}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">
        <span style="padding: 2px 8px; border-radius: 4px; background: ${getStatusColor(p.status)}20; color: ${getStatusColor(p.status)}; font-size: 12px;">
          ${getStatusText(p.status)}
        </span>
      </td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center; color: ${(p.actual_return || 0) >= 0 ? '#166534' : '#991b1b'};">
        ${p.actual_return !== undefined ? `${p.actual_return >= 0 ? '+' : ''}${p.actual_return.toFixed(2)}%` : '-'}
      </td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">${p.holding_days || '-'}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير التوقعات - دليل الاستثمار</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap');
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Cairo', 'Arial', sans-serif;
      background: #ffffff;
      color: #1f2937;
      line-height: 1.6;
    }
    
    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 15mm;
      margin: 0 auto;
      background: white;
    }
    
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 3px solid #10B981;
    }
    
    .logo {
      text-align: center;
      margin-bottom: 10px;
    }

    .logo img {
      max-width: 200px;
      height: auto;
      border-radius: 8px;
    }
    
    .title {
      font-size: 24px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 8px;
    }
    
    .subtitle {
      font-size: 14px;
      color: #6b7280;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
      margin-bottom: 30px;
    }
    
    .stat-card {
      background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      border: 1px solid #bbf7d0;
    }
    
    .stat-value {
      font-size: 32px;
      font-weight: 700;
      color: #166534;
    }
    
    .stat-label {
      font-size: 12px;
      color: #6b7280;
      margin-top: 5px;
    }
    
    .section-title {
      font-size: 18px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 15px;
      padding-right: 10px;
      border-right: 4px solid #10B981;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-bottom: 20px;
    }
    
    th {
      background: #f3f4f6;
      padding: 10px 8px;
      text-align: center;
      font-weight: 600;
      color: #374151;
      border-bottom: 2px solid #d1d5db;
    }
    
    td {
      padding: 8px;
      border-bottom: 1px solid #e5e7eb;
      text-align: center;
    }
    
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      font-size: 12px;
      color: #6b7280;
    }
    
    .footer-logo {
      color: #10B981;
      font-weight: 600;
    }
    
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { page-break-after: always; }
    }
  </style>
</head>
<body>
  <div class="page">
    <!-- Header -->
    <div class="header">
      <div class="logo"><img src="https://invist.m2y.net/logo-square.png" alt="دليل الاستثمار" /></div>
      <div class="title">تقرير تقييم التحليلات</div>
      <div class="subtitle">تاريخ التقرير: ${today} ${filters.market ? `| السوق: ${filters.market}` : ''} | الفترة: آخر ${filters.days} يوم</div>
    </div>
    
    <!-- Stats Grid -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${totalPredictions}</div>
        <div class="stat-label">إجمالي التوقعات</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: ${successRate >= 50 ? '#166534' : '#991b1b'};">${successRate.toFixed(1)}%</div>
        <div class="stat-label">نسبة النجاح</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${targetsHit}</div>
        <div class="stat-label">تحقق الهدف ✓</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: ${avgReturn >= 0 ? '#166534' : '#991b1b'};">${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(2)}%</div>
        <div class="stat-label">متوسط العائد</div>
      </div>
    </div>
    
    <!-- Predictions Table -->
    <div class="section-title">سجل التوقعات</div>
    <table>
      <thead>
        <tr>
          <th>السهم</th>
          <th>الاسم</th>
          <th>الإشارة</th>
          <th>سعر الدخول</th>
          <th>الهدف</th>
          <th>الوقف</th>
          <th>الحالة</th>
          <th>العائد</th>
          <th>الأيام</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
    
    <!-- Footer -->
    <div class="footer">
      <p>تم إنشاء هذا التقرير تلقائياً بواسطة <span class="footer-logo">دليل الاستثمار</span></p>
      <p style="margin-top: 5px;">جميع البيانات مستمدة من نظام التحليل المتقدم | هذا التقرير للأغراض المعلوماتية فقط</p>
      
      <!-- Social Sharing Text -->
      <div style="margin-top: 25px; padding: 20px; background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%); border-radius: 12px; border: 1px solid #bbf7d0;">
        <p style="font-size: 14px; color: #166534; font-weight: 600; margin-bottom: 10px;">
          انضم الآن إلى مجتمع المتداولين بلا مشاعر، ودع الأرقام تقود محفظتك! 📈
        </p>
        <div style="font-size: 11px; color: #374151; line-height: 1.8;">
          <p style="font-weight: 600; margin-bottom: 5px;">🔗 روابطنا الرسمية:</p>
          <p>🌐 الموقع الإلكتروني: <a href="https://invist.m2y.net" style="color: #10B981;">https://invist.m2y.net</a></p>
          <p>📱 تطبيق أندرويد: <a href="https://play.google.com/store/apps/details?id=com.egx.investment" style="color: #10B981;">Google Play</a></p>
          <p>📘 فيسبوك: <a href="https://www.facebook.com/profile.php?id=61590600300048" style="color: #10B981;">دليل الاستثمار</a></p>
          <p>✈️ تليجرام: <a href="https://t.me/Arabian_investment_guide" style="color: #10B981;">@Arabian_investment_guide</a></p>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

// Main GET handler
export async function GET(request: NextRequest) {
  try {
    console.log('[Predictions Export PDF] Generating report...');

    const searchParams = request.nextUrl.searchParams;
    const market = searchParams.get('market') || undefined;
    const days = parseInt(searchParams.get('days') || '30');

    // Fetch stats from Python Backend
    const statsUrl = `${PYTHON_BACKEND_URL}/api/predictions/tracking/legacy-stats?${market ? `market=${market}&` : ''}days=${days}`;
    console.log('[Predictions Export PDF] Fetching stats:', statsUrl);
    
    const statsResponse = await fetch(statsUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });

    if (!statsResponse.ok) {
      throw new Error(`Python backend returned ${statsResponse.status}`);
    }

    const statsData = await statsResponse.json();
    const stats = statsData.data || {};

    // Fetch history from Python Backend
    const historyUrl = `${PYTHON_BACKEND_URL}/api/predictions/tracking/history?${market ? `market=${market}&` : ''}days=${days}&limit=100`;
    const historyResponse = await fetch(historyUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });

    let predictions: PredictionRecord[] = [];
    if (historyResponse.ok) {
      const historyData = await historyResponse.json();
      predictions = (historyData.data || []).map((p: any) => ({
        id: String(p.id || p.prediction_id),
        symbol: p.symbol || p.stock_symbol,
        name: p.name || p.stock_name_ar,
        signal_type: p.signal_type || p.prediction_type,
        entry_price: Number(p.entry_price) || 0,
        target_price: Number(p.target_price) || 0,
        stop_loss: Number(p.stop_loss) || 0,
        current_price: Number(p.current_price) || 0,
        status: p.status,
        hit_target: p.hit_target === 1 || p.hit_target === true,
        hit_stop: p.hit_stop === 1 || p.hit_stop === true,
        actual_return: Number(p.actual_return) || undefined,
        holding_days: Number(p.holding_days || p.days_to_target) || undefined,
        prediction_date: p.prediction_date,
        target_hit_date: p.target_hit_date,
        market: p.market || 'EGX',
        confidence: Number(p.confidence || p.maestro_score) || 50
      }));
    }

    // Generate HTML
    const html = generateReportHTML(stats, predictions, { market, days });

    // Return HTML for frontend to convert to PDF
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });

  } catch (error) {
    console.error('[Predictions Export PDF] Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 });
  }
}
