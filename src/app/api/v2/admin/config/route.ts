import { NextRequest, NextResponse } from 'next/server';
import { loadWeights, getWeightsByGroup, updateWeight, detectMarketRegime, clearCache } from '@/lib/v2/config-service';
import { requireAdminAsync } from '@/lib/admin-auth-server';

/**
 * GET /api/v2/admin/config
 * View current configuration weights and regime.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const weightsMap = loadWeights();
    const regime = detectMarketRegime();

    const weights = Array.from(weightsMap.values());

    // Group by parameter_group
    const groups: Record<string, typeof weights> = {};
    for (const w of weights) {
      if (!groups[w.parameter_group]) groups[w.parameter_group] = [];
      groups[w.parameter_group].push(w);
    }

    return NextResponse.json({
      weights,
      groups,
      regime,
      totalParameters: weights.length,
    });
  } catch (error) {
    console.error('[GET /api/v2/admin/config] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load config', detail: String(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v2/admin/config
 * Update a configuration weight (with circuit breaker protection).
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdminAsync(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { parameter_name, new_value, reason } = body;

    if (!parameter_name || new_value === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: parameter_name, new_value' },
        { status: 400 }
      );
    }

    const success = updateWeight(
      parameter_name,
      Number(new_value),
      'admin',
      reason
    );

    if (!success) {
      return NextResponse.json(
        { error: 'Update failed. Check parameter name, bounds, or circuit breaker limits (±20%).' },
        { status: 422 }
      );
    }

    // Return updated weights
    clearCache();
    const updatedWeight = loadWeights().get(parameter_name);

    return NextResponse.json({
      success: true,
      message: `Updated ${parameter_name} to ${new_value}`,
      weight: updatedWeight,
    });
  } catch (error) {
    console.error('[POST /api/v2/admin/config] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update config', detail: String(error) },
      { status: 500 }
    );
  }
}
