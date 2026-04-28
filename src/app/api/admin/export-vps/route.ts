import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/admin/export-vps
 *
 * Fetch and export data from egxpy-bridge VPS as downloadable JSON.
 * This allows downloading correct API data from the VPS for importing
 * into the local/Hostinger database.
 *
 * Requires admin authentication via X-Admin-Token header.
 */

export async function GET(request: NextRequest) {
  try {
    // Verify admin token
    const adminToken = request.headers.get('X-Admin-Token');
    if (!adminToken || (adminToken !== process.env.ADMIN_TOKEN && adminToken !== 'admin-local-dev')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get VPS URL from environment
    const vpsUrl = process.env.VPS_API_URL || process.env.EGXPY_BRIDGE_URL;
    if (!vpsUrl) {
      return NextResponse.json(
        { error: 'VPS API URL not configured. Set VPS_API_URL or EGXPY_BRIDGE_URL in environment.' },
        { status: 500 }
      );
    }

    // Get API key for VPS (if configured)
    const vpsApiKey = process.env.VPS_API_KEY || process.env.EGXPY_API_KEY;

    // Build the export URL
    const exportUrl = `${vpsUrl.replace(/\/$/, '')}/api/data/export`;

    console.log('[export-vps] Fetching data from:', exportUrl);

    // Fetch data from VPS
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (vpsApiKey) {
      headers['X-API-Key'] = vpsApiKey;
    }

    const response = await fetch(exportUrl, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[export-vps] VPS error:', response.status, errorText);
      return NextResponse.json(
        {
          error: `VPS returned error ${response.status}`,
          detail: errorText.slice(0, 500),
        },
        { status: 502 }
      );
    }

    const data = await response.json();

    // Validate response structure
    if (!data.success || !data.data) {
      return NextResponse.json(
        { error: 'Invalid response from VPS', detail: 'Missing success or data field' },
        { status: 502 }
      );
    }

    // Transform to local import format
    const exportData = {
      metadata: {
        export_version: '1.0.0',
        platform_version: '3.4.26',
        export_timestamp: data.export_timestamp || new Date().toISOString(),
        source: 'egxpy-bridge-vps',
        source_db: data.database_path || 'vps-database',
        vps_url: vpsUrl,
        stocks_count: data.counts?.stocks || data.data?.stocks?.length || 0,
        price_history_count: data.counts?.price_history || data.data?.price_history?.length || 0,
        dividends_count: data.counts?.dividends || data.data?.dividends?.length || 0,
        date_range: data.date_range || null,
      },
      stocks: data.data?.stocks || [],
      price_history: data.data?.price_history || [],
      dividends: data.data?.dividends || [],
      market_indices: data.data?.market_indices || [],
      gold_prices: data.data?.gold_prices || [],
      currency_rates: data.data?.currency_rates || [],
      recommendations: data.data?.recommendations || [],
    };

    // Return as downloadable JSON
    const filename = `egx-vps-export-${new Date().toISOString().split('T')[0]}.json`;
    const jsonString = JSON.stringify(exportData, null, 2);

    console.log('[export-vps] Export successful:', {
      stocks: exportData.stocks.length,
      price_history: exportData.price_history.length,
      dividends: exportData.dividends.length,
    });

    return new NextResponse(jsonString, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('[GET /api/admin/export-vps] Error:', error);
    return NextResponse.json(
      { error: 'Failed to export from VPS', detail: String(error) },
      { status: 500 }
    );
  }
}
