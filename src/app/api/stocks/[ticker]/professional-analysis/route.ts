/**
 * Professional Analysis API - يقرأ من Python Backend
 * 
 * يحول response من Python format:
 * Python: { success: true, data: {...analysis} }
 * Frontend: { success: true, data: {...analysis} }
 */

import { NextRequest, NextResponse } from 'next/server';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const tickerUpper = ticker.toUpperCase();
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(
      `${PYTHON_BACKEND_URL}/api/professional-analysis/${tickerUpper}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        cache: 'no-store'
      }
    );
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn(`[Professional Analysis API] Python backend returned ${response.status} for ${tickerUpper}`);
      return NextResponse.json({
        success: true,
        data_available: false,
        ticker: tickerUpper,
        data: null,
        message: 'لا توجد بيانات تحليل متوفرة لهذا السهم حالياً'
      }, { status: 200 });
    }
    
    const pythonData = await response.json();
    
    // Extract the analysis data from Python response
    // Python returns: { success: true, data: {...analysis} }
    // Frontend expects: { success: true, data: {...analysis} }
    const analysisData = pythonData.data || pythonData;
    
    return NextResponse.json({
      success: true,
      source: 'python_backend',
      ticker: tickerUpper,
      data: analysisData
    });
    
  } catch (error: any) {
    console.error('[Professional Analysis API] Error:', error);
    
    if (error?.name === 'AbortError') {
      return NextResponse.json({
        success: false,
        error: 'انتهت مهلة الطلب',
        python_backend: PYTHON_BACKEND_URL
      }, { status: 504 });
    }
    
    return NextResponse.json({
      success: false,
      error: 'خطأ في الاتصال بالخادم',
      details: error?.message,
      python_backend: PYTHON_BACKEND_URL
    }, { status: 500 });
  }
}
