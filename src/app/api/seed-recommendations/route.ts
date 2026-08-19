/**
 * API to seed expert recommendations from JSON file
 * GET /api/seed-recommendations
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { promises as fs } from 'fs';
import path from 'path';

// Path to JSON data file
const DATA_FILE = path.join(process.cwd(), 'data', 'recommendations.json');

interface ExpertData {
  code: string;
  name_ar: string;
  source: string;
  type: string;
  description: string;
}

interface RecommendationData {
  date: string;
  expert: string;
  ticker: string;
  action: string;
  price: number;
  type: string;
  target?: number;
  target2?: number;
  investTarget?: number;
  stopLoss?: number;
  buyFrom?: number;
  buyTo?: number;
  notes?: string;
}

interface DataFile {
  experts: ExpertData[];
  recommendations: RecommendationData[];
}

export async function GET() {
  try {
    const dbAny = db as any;
    
    console.log('[Seed] Starting database seed from JSON file...');
    
    // Read JSON file
    let data: DataFile;
    try {
      const fileContent = await fs.readFile(DATA_FILE, 'utf-8');
      data = JSON.parse(fileContent);
    } catch (e) {
      return NextResponse.json({
        success: false,
        error: 'ملف البيانات غير موجود أو تالف',
        path: DATA_FILE
      }, { status: 500 });
    }
    
    // Build expert lookup map
    const expertMap: Record<string, ExpertData> = {};
    for (const expert of data.experts) {
      expertMap[expert.code] = expert;
    }
    
    // Create expert track records
    let expertsCreated = 0;
    for (const expert of data.experts) {
      try {
        const existing = await dbAny.expertTrackRecord.findUnique({
          where: { expert_name: expert.code }
        });
        
        if (!existing) {
          await dbAny.expertTrackRecord.create({
            data: {
              id: randomUUID(),
              expert_name: expert.code,
              expert_source: expert.source,
              total_recommendations: 0,
              win_count: 0,
              loss_count: 0,
              win_rate: 0,
              avg_profit_pct: 0,
              avg_loss_pct: 0,
              total_profit_pct: 0,
              last_recommendation: null,
              updated_at: new Date()
            }
          });
          expertsCreated++;
        }
      } catch (e) {
        console.log(`[Seed] Expert ${expert.code} may already exist`);
      }
    }
    
    // Import recommendations
    let imported = 0;
    let skipped = 0;
    let errors: string[] = [];
    
    for (const rec of data.recommendations) {
      try {
        const expertInfo = expertMap[rec.expert];
        if (!expertInfo) {
          errors.push(`${rec.ticker}: الخبير ${rec.expert} غير معروف`);
          continue;
        }
        
        // Check for duplicate
        const existing = await dbAny.expertRecommendation.findFirst({
          where: {
            stock_symbol: rec.ticker,
            expert_name: rec.expert,
            session_date: rec.date
          }
        });
        
        if (existing) {
          skipped++;
          continue;
        }
        
        // Create recommendation
        await dbAny.expertRecommendation.create({
          data: {
            id: randomUUID(),
            stock_symbol: rec.ticker,
            expert_name: rec.expert,
            expert_source: expertInfo.source,
            action: rec.action,
            recommendation_type: rec.type,
            entry_price: rec.price,
            entry_price_from: rec.buyFrom || null,
            entry_price_to: rec.buyTo || null,
            target_price: rec.target || null,
            target_price_2: rec.target2 || null,
            investment_target: rec.investTarget || null,
            stop_loss: rec.stopLoss || null,
            session_date: rec.date,
            session_type: rec.type === 'quick' ? 'T0' : 'صباحية',
            status: 'PENDING',
            notes: rec.notes || null,
            updated_at: new Date()
          }
        });
        
        imported++;
        
        // Update expert count
        await dbAny.expertTrackRecord.update({
          where: { expert_name: rec.expert },
          data: {
            total_recommendations: { increment: 1 },
            last_recommendation: new Date(),
            updated_at: new Date()
          }
        });
        
      } catch (e) {
        errors.push(`${rec.ticker}: ${String(e)}`);
      }
    }
    
    return NextResponse.json({
      success: true,
      message: `تم استيراد ${imported} تحليل | تم تخطي ${skipped} (مكرر)`,
      summary: {
        experts_count: data.experts.length,
        experts_created: expertsCreated,
        recommendations_in_file: data.recommendations.length,
        recommendations_imported: imported,
        recommendations_skipped: skipped,
        errors: errors.length
      },
      experts: data.experts.map(e => ({ code: e.code, name: e.name_ar, source: e.source })),
      errors: errors.slice(0, 5)
    });
    
  } catch (error) {
    console.error('[Seed] Error:', error);
    return NextResponse.json({
      success: false,
      error: String(error)
    }, { status: 500 });
  }
}
