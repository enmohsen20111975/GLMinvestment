/**
 * ⚠️⚠️⚠️ كنز منسي - مهم جداً ولم يستخدم بعد! ⚠️⚠️⚠️
 * TODO: يجب إضافة import لهذا hook في المكونات المناسبة
 * - إحضار نتائج التحليل حسب شخصية المستثمر
 * - يدعم أنواع مختلفة من الشخصيات (balanced, aggressive, conservative)
 * 
 * Use this hook to get persona-based analysis results
 */
'use client';

import { useState, useEffect, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_PYTHON_API || 'http://127.0.0.1:8010';

export interface PersonaResult {
  persona_type: string;
  persona_name: string;
  buy_threshold: number;
  accumulate_threshold: number;
  count: number;
  results: any[];
  analyzed_at: string;
}

export interface PersonaStatus {
  cached: boolean;
  count: number;
}

export function usePersonaResults(personaId: string = 'balanced') {
  const [data, setData] = useState<PersonaResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchResults = useCallback(async () => {
    if (!personaId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(
        `${API_BASE}/api/v2/persona/${personaId}/cached`,
        { cache: 'no-store' }
      );
      
      if (!response.ok) {
        if (response.status === 404) {
          setError('NO_CACHE');
        } else {
          setError('Failed to fetch results');
        }
        return;
      }
      
      const json = await response.json();
      if (json.success && json.data) {
        setData(json.data);
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  return { data, loading, error, refetch: fetchResults };
}

export function usePersonaStatus() {
  const [status, setStatus] = useState<Record<string, PersonaStatus>>({});
  const [allCached, setAllCached] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v2/persona/status`);
      const json = await response.json();
      
      if (json.success) {
        setStatus(json.status);
        setAllCached(json.all_personas_cached);
      }
    } catch (err) {
      console.error('Failed to fetch persona status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return { status, allCached, loading, refetch: fetchStatus };
}

export async function runDailyPersonaAnalysis(): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  try {
    const response = await fetch(
      `${API_BASE}/api/v2/admin/run-daily-persona-analysis`,
      { method: 'POST' }
    );
    
    const json = await response.json();
    return json;
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
