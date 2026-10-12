/**
 * Predictions Database Client
 * ============================
 * Database: db/predictions.db
 * Purpose: AI predictions, expert recommendations, prediction tracking
 */

import { PrismaClient } from '@prisma/predictions-client'
import path from 'path'

const globalForPredictions = globalThis as unknown as {
  predictionsDb: PrismaClient | undefined
}

const dbPath = path.join(process.cwd(), 'db', 'predictions.db')

export const predictionsDb =
  globalForPredictions.predictionsDb ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
    datasourceUrl: `file:${dbPath}`
  })

if (process.env.NODE_ENV !== 'production') globalForPredictions.predictionsDb = predictionsDb

// Re-export types
export type { AiPrediction, ExpertRecommendation, ExpertTrackRecord, PredictionLog } from '@prisma/predictions-client'
