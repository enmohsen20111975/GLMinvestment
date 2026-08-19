import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    // First try to get from JSON file (always available)
    const jsonPath = join(process.cwd(), 'data', 'recommendations.json');
    let jsonExperts: any[] = [];

    if (existsSync(jsonPath)) {
      try {
        const jsonContent = readFileSync(jsonPath, 'utf-8');
        const jsonData = JSON.parse(jsonContent);
        jsonExperts = jsonData.experts || [];
      } catch (e) {
        console.warn('[Experts API] Could not read JSON file:', e);
      }
    }

    // Try to get from database as well
    let dbExperts: any[] = [];
    try {
      const dbAny = db as any;
      dbExperts = await dbAny.expertTrackRecord.findMany({
        orderBy: { success_rate: 'desc' }
      });
    } catch (dbError) {
      console.warn('[Experts API] DB error (non-critical):', dbError);
    }

    // Merge experts - prefer JSON data but include DB stats
    const mergedExperts = jsonExperts.map((jsonExpert: any) => {
      const dbRecord = dbExperts.find((d: any) => d.expert_name === jsonExpert.name_ar || d.expert_name === jsonExpert.code);
      return {
        code: jsonExpert.code,
        name_ar: jsonExpert.name_ar,
        source: jsonExpert.source,
        type: jsonExpert.type,
        description: jsonExpert.description,
        // Include DB stats if available
        total_recommendations: dbRecord?.total_recommendations || 0,
        successful_recommendations: dbRecord?.successful_recommendations || 0,
        failed_recommendations: dbRecord?.failed_recommendations || 0,
        success_rate: dbRecord?.success_rate || 0,
        avg_return: dbRecord?.avg_return || 0,
      };
    });

    // Add any DB-only experts
    for (const dbExpert of dbExperts) {
      if (!mergedExperts.find((e: any) => e.name_ar === dbExpert.expert_name || e.code === dbExpert.expert_name)) {
        mergedExperts.push({
          code: dbExpert.expert_name.substring(0, 2).toUpperCase(),
          name_ar: dbExpert.expert_name,
          source: 'database',
          type: 'unknown',
          description: '',
          total_recommendations: dbExpert.total_recommendations || 0,
          successful_recommendations: dbExpert.successful_recommendations || 0,
          failed_recommendations: dbExpert.failed_recommendations || 0,
          success_rate: dbExpert.success_rate || 0,
          avg_return: dbExpert.avg_return || 0,
        });
      }
    }

    return NextResponse.json({ success: true, data: mergedExperts, source: jsonExperts.length > 0 ? 'json+db' : 'db' });
  } catch (error) {
    console.error('[Experts API] Error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}