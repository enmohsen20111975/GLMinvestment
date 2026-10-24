/**
 * Python Backend Configuration
 * =============================
 * ملف موحد لكل الاتصالات بـ Python Backend
 * 
 * كل الـ API routes تستخدم هذا الملف
 * لا تستخدم أي URL آخر في أي مكان!
 */

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get Python Backend URL
 * ======================
 * الأولوية:
 * 1. Environment variable (PYTHON_BACKEND_URL)
 * 2. 127.0.0.1:8010 (IPv4 - لتجنب مشاكل DNS IPv6 ::1 في Node 18/20)
 */
const getPythonBackendUrl = (): string => {
  const ensureHttpPrefix = (url: string): string => {
    let cleanUrl = url;
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `http://${cleanUrl}`;
    }
    // في بيئة Server-side استبدل localhost بـ 127.0.0.1 لتفادي تفكيك DNS IPv6 (::1)
    if (typeof window === 'undefined' && cleanUrl.includes('localhost')) {
      cleanUrl = cleanUrl.replace('localhost', '127.0.0.1');
    }
    return cleanUrl;
  };

  // 1. Check environment variable first
  const envUrl = process.env.PYTHON_BACKEND_URL;
  if (envUrl) {
    return ensureHttpPrefix(envUrl);
  }

  // 2. Check other environment variables
  const altEnvUrl =
    process.env.VPS_API_URL ||
    process.env.PYTHON_API_URL ||
    process.env.EGXPY_SERVICE_URL ||
    process.env.EGX_VPS_API_URL ||
    process.env.EGXPY_BRIDGE_URL;

  if (altEnvUrl) {
    return ensureHttpPrefix(altEnvUrl);
  }

  // 3. Default: use 127.0.0.1:8010 (IPv4 المباشر على السيرفر)
  return 'http://127.0.0.1:8010';
};

// ============================================================================
// Exports
// ============================================================================

/**
 * The ONE and ONLY Python Backend URL
 * Use this everywhere!
 */
export const PYTHON_BACKEND_URL = getPythonBackendUrl();

/**
 * Build full URL for Python Backend API
 */
export function pythonApiUrl(path: string, params?: Record<string, string | number | boolean>): string {
  const url = new URL(`${PYTHON_BACKEND_URL}${path}`);
  
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });
  }
  
  return url.toString();
}

/**
 * Fetch from Python Backend with error handling
 */
export async function pythonFetch<T = any>(
  path: string, 
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: any;
    params?: Record<string, string | number | boolean>;
    timeout?: number;
  } = {}
): Promise<{ success: boolean; data?: T; error?: string }> {
  const { method = 'GET', body, params, timeout = 30000 } = options;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const url = pythonApiUrl(path, params);
    
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    const data = await response.json();
    
    return {
      success: response.ok,
      data,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    if (error?.name === 'AbortError') {
      return { success: false, error: 'انتهت مهلة الطلب' };
    }
    
    return { success: false, error: error?.message || 'خطأ في الاتصال' };
  }
}

/**
 * Health check for Python Backend
 */
export async function checkPythonBackendHealth(): Promise<{
  healthy: boolean;
  latency?: number;
  error?: string;
}> {
  const start = Date.now();
  
  try {
    const response = await fetch(`${PYTHON_BACKEND_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    
    const latency = Date.now() - start;
    
    if (response.ok) {
      return { healthy: true, latency };
    }
    
    return { healthy: false, error: `HTTP ${response.status}` };
  } catch (error: any) {
    return { healthy: false, error: error?.message || 'خطأ في الاتصال' };
  }
}

if (typeof window === 'undefined') {
  console.log(`[Python Backend] NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`[Python Backend] Using URL: ${PYTHON_BACKEND_URL}`);
}
