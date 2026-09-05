/**
 * Analysis Engine Configuration API
 * ===================================
 * يتحكم في إعدادات محرك التحليل (ON/OFF + وزن لكل محرك)
 *
 * GET: الحصول على الإعدادات الحالية
 * POST: تحديث الإعدادات (toggle engines, set weights, apply presets)
 *
 * المحركات الأربعة:
 * - Fundamental (التحليل الأساسي)
 * - Technical (التحليل الفني)
 * - Candlestick (الشموع اليابانية)
 * - MeanRev (العودة للمتوسط)
 *
 * Pipeline Presets:
 * - EGX Conservative: Fundamental 70%, Technical 30%, Candlestick OFF, MeanRev OFF
 * - EGX Aggressive: Fundamental 20%, Technical 40%, Candlestick 30%, MeanRev 10%
 * - EGX Balanced: Fundamental 40%, Technical 30%, Candlestick 20%, MeanRev 10%
 * - Crypto Scalp: Fundamental OFF, Technical 50%, Candlestick 30%, MeanRev 20%
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import fs from 'fs';
import path from 'path';

export const revalidate = 30; // Cache for 30s

interface EngineConfig {
  enabled: boolean;
  weight: number; // 0-100
}

interface AnalysisEngineSettings {
  engines: {
    fundamental: EngineConfig;
    technical: EngineConfig;
    candlestick: EngineConfig;
    meanRev: EngineConfig;
  };
  activePreset: string | null;
  lastUpdated: string;
}

const CONFIG_PATH = path.join(process.cwd(), 'db', 'analysis_engine_config.json');

const DEFAULT_SETTINGS: AnalysisEngineSettings = {
  engines: {
    fundamental: { enabled: true, weight: 40 },
    technical: { enabled: true, weight: 30 },
    candlestick: { enabled: true, weight: 20 },
    meanRev: { enabled: true, weight: 10 },
  },
  activePreset: 'EGX Balanced',
  lastUpdated: new Date().toISOString(),
};

const PRESETS: Record<string, AnalysisEngineSettings['engines']> = {
  'EGX Conservative': {
    fundamental: { enabled: true, weight: 70 },
    technical: { enabled: true, weight: 30 },
    candlestick: { enabled: false, weight: 0 },
    meanRev: { enabled: false, weight: 0 },
  },
  'EGX Aggressive': {
    fundamental: { enabled: true, weight: 20 },
    technical: { enabled: true, weight: 40 },
    candlestick: { enabled: true, weight: 30 },
    meanRev: { enabled: true, weight: 10 },
  },
  'EGX Balanced': {
    fundamental: { enabled: true, weight: 40 },
    technical: { enabled: true, weight: 30 },
    candlestick: { enabled: true, weight: 20 },
    meanRev: { enabled: true, weight: 10 },
  },
  'Crypto Scalp': {
    fundamental: { enabled: false, weight: 0 },
    technical: { enabled: true, weight: 50 },
    candlestick: { enabled: true, weight: 30 },
    meanRev: { enabled: true, weight: 20 },
  },
};

function loadSettings(): AnalysisEngineSettings {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return { ...DEFAULT_SETTINGS, ...data };
    }
  } catch { /* use defaults */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: AnalysisEngineSettings): void {
  try {
    const dbDir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('[Analysis Engine] Failed to save config:', e);
  }
}

/**
 * GET: Return current engine configuration
 */
export async function GET() {
  const settings = loadSettings();

  return NextResponse.json({
    success: true,
    settings,
    presets: Object.entries(PRESETS).map(([name, engines]) => ({
      name,
      engines,
      description: getPresetDescription(name),
    })),
  });
}

/**
 * POST: Update engine configuration
 *
 * Body options:
 * - action: 'toggle' | 'weight' | 'preset' | 'reset'
 * - engine: 'fundamental' | 'technical' | 'candlestick' | 'meanRev'
 * - enabled: boolean (for toggle action)
 * - weight: number 0-100 (for weight action)
 * - preset: string (for preset action)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, engine, enabled, weight, preset } = body;

    const settings = loadSettings();

    switch (action) {
      case 'toggle': {
        if (!engine || !['fundamental', 'technical', 'candlestick', 'meanRev'].includes(engine)) {
          return NextResponse.json(
            { success: false, error: 'Invalid engine name. Use: fundamental, technical, candlestick, meanRev' },
            { status: 400 }
          );
        }
        settings.engines[engine as keyof typeof settings.engines].enabled = enabled ?? !settings.engines[engine as keyof typeof settings.engines].enabled;
        settings.activePreset = null; // Custom config
        break;
      }

      case 'weight': {
        if (!engine || !['fundamental', 'technical', 'candlestick', 'meanRev'].includes(engine)) {
          return NextResponse.json(
            { success: false, error: 'Invalid engine name' },
            { status: 400 }
          );
        }
        const w = Math.max(0, Math.min(100, weight || 0));
        settings.engines[engine as keyof typeof settings.engines].weight = w;
        if (w === 0) {
          settings.engines[engine as keyof typeof settings.engines].enabled = false;
        } else if (!settings.engines[engine as keyof typeof settings.engines].enabled) {
          settings.engines[engine as keyof typeof settings.engines].enabled = true;
        }
        settings.activePreset = null;
        break;
      }

      case 'preset': {
        if (!preset || !PRESETS[preset]) {
          return NextResponse.json(
            { success: false, error: `Invalid preset. Available: ${Object.keys(PRESETS).join(', ')}` },
            { status: 400 }
          );
        }
        settings.engines = JSON.parse(JSON.stringify(PRESETS[preset]));
        settings.activePreset = preset;
        break;
      }

      case 'reset': {
        Object.assign(settings, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action. Use: toggle, weight, preset, reset' },
          { status: 400 }
        );
    }

    settings.lastUpdated = new Date().toISOString();
    saveSettings(settings);

    // Also forward to Python backend if available
    try {
      const vpsUrl = process.env.PYTHON_BACKEND_URL || 'http://localhost:8010';
      await fetch(`${vpsUrl}/api/analysis-engine/config?XTransformPort=8010`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Python backend not available — settings saved locally
    }

    return NextResponse.json({
      success: true,
      message: `تم تحديث ${action === 'toggle' ? 'حالة المحرك' : action === 'weight' ? 'وزن المحرك' : action === 'preset' ? 'الإعداد المسبق' : 'الإعدادات'}`,
      settings,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

function getPresetDescription(name: string): string {
  switch (name) {
    case 'EGX Conservative': return 'تركيز على الأساسيات، تحليل فني خفيف — مناسب للمستثمر طويل المدى';
    case 'EGX Aggressive': return 'تركيز على الفني والشموع — مناسب للمضارب';
    case 'EGX Balanced': return 'توازن بين كل المحركات — الافتراضي';
    case 'Crypto Scalp': return 'بدون أساسيات، فني + شموع + عودة للمتوسط — للعملات الرقمية';
    default: return '';
  }
}
