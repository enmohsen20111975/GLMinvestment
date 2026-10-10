'use client';

/**
 * ErrorBoundary — React Error Boundary للـ UI Resilience (Phase 4 Task 3)
 * ========================================================================
 *
 * المشكلة (قبل Phase 4):
 *   لو فيه Error صغير في `TradingChartView` أو `AdminView` (زي null reference
 *   في بيانات السهم، أو Recharts rendering error)، Next.js بيبيض الشاشة كلها
 *   (White Screen of Death) والمستخدم لازم يعمل Refresh يدوياً.
 *
 * الحل:
 *   `ErrorBoundary` بيمسك أي Error من الـ children ويعرض رسالة "حدث خطأ في
 *   تحميل هذه الشاشة" + زرار "المحاولة مرة أخرى" و "تحديث الصفحة".
 *   الشاشة اللي حصل فيها الخطأ هي اللي بتتأثر بس — باقي الـ App بيفضل شغّال.
 *
 *   الـ Error Boundary ده بيتـ used عن طريق:
 *     1. `withErrorBoundary(Component, label)` HOC — بيـ wrap أي component.
 *     2. `<ErrorBoundary label="..."><HeavyComponent /></ErrorBoundary>` مباشرة.
 *
 * Usage (HOC pattern — recommended for dynamic imports):
 *   const TradingChartView = withErrorBoundary(
 *     dynamic(() => import('./TradingChartView'), { ssr: false }),
 *     'الشارت التفاعلي',
 *   );
 *
 * Usage (direct wrapping):
 *   <ErrorBoundary label="لوحة الأدمن">
 *     <AdminView />
 *   </ErrorBoundary>
 *
 * التصميم:
 *   - "Try again" بيعمل reset للـ boundary state (مفيش refresh — مفيد لو
 *     الخطأ كان transient زي race condition).
 *   - "Refresh" بيعمل window.location.reload() (الحل الأخير لو الـ state
 *     بقى corrupted).
 *   - Error details في <details> element (collapsible) عشان الـ debug.
 *   - onError callback للـ logging (ممكن يتبعت لـ Sentry/LogRocket بعدين).
 *
 * Author: دليل الاستثمار (Phase 4 — Resilience & Observability)
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErrorBoundaryProps {
  /** الـ children اللي محتاجين حماية */
  children: ReactNode;
  /** اسم الشاشة/المكون (للـ message + الـ logging) */
  label?: string;
  /** Fallback مخصص (optional — لو مش موجود، بنستخدم الـ default UI) */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** callback لما يحصل error (للـ logging / Sentry) */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** ارتفاع الـ container للـ fallback (default: min-h-[400px]) */
  height?: string;
  /** Reset الـ boundary state تلقائياً لما الـ children تتغير (useful for
   * tab switches — لما المستخدم ينتقل لتبويب تاني، الـ boundary يـ reset) */
  resetOnChildrenChange?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// ---------------------------------------------------------------------------
// Default Fallback UI
// ---------------------------------------------------------------------------

function DefaultFallback({
  label,
  error,
  onReset,
  onRefresh,
  height,
}: {
  label: string;
  error: Error | null;
  onReset: () => void;
  onRefresh: () => void;
  height: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center ${height} p-6 sm:p-8 text-center`}
      dir="rtl"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex flex-col items-center max-w-md">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 mb-4">
          <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
        </div>
        <h2 className="text-lg sm:text-xl font-bold mb-2 text-foreground">
          حدث خطأ في تحميل {label}
        </h2>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          نعتذر عن المشكلة. يمكنك المحاولة مرة أخرى أو تحديث الصفحة بالكامل.
          باقي أجزاء المنصة تستمر في العمل بشكل طبيعي.
        </p>

        {error && (
          <details className="mb-6 w-full text-right">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors mb-2">
              تفاصيل الخطأ (للمطورين)
            </summary>
            <pre className="text-left text-xs bg-muted/50 rounded-md p-3 overflow-auto max-h-32 border border-border/50" dir="ltr">
              <code>{error.name}: {error.message}</code>
            </pre>
          </details>
        )}

        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <button
            onClick={onReset}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            المحاولة مرة أخرى
          </button>
          <button
            onClick={onRefresh}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors text-sm font-medium"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            تحديث الصفحة
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ErrorBoundary Class Component
// ---------------------------------------------------------------------------

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // Update state so the next render shows the fallback UI.
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log to console for developer visibility
    const label = this.props.label || 'Unknown';
    console.error(`[ErrorBoundary:${label}] Caught error:`, error, errorInfo);

    // Auto-reload on ChunkLoadError caused by new deployment
    if (
      typeof window !== 'undefined' &&
      (error?.name === 'ChunkLoadError' ||
        error?.message?.includes('Loading chunk') ||
        error?.message?.includes('ChunkLoadError'))
    ) {
      const storageKey = 'last_chunk_error_reload';
      const lastReload = Number(sessionStorage.getItem(storageKey) || 0);
      const now = Date.now();
      if (now - lastReload > 15000) {
        sessionStorage.setItem(storageKey, String(now));
        console.warn(`[ErrorBoundary:${label}] ChunkLoadError detected, reloading page to fetch latest build chunks...`);
        window.location.reload();
        return;
      }
    }

    // Store errorInfo for the details display
    this.setState({ errorInfo });

    // Call optional onError callback (for Sentry/LogRocket/etc.)
    if (this.props.onError) {
      try {
        this.props.onError(error, errorInfo);
      } catch (callbackErr) {
        console.error(`[ErrorBoundary:${label}] onError callback failed:`, callbackErr);
      }
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // Reset the boundary if children changed (e.g., user navigated to a
    // different tab) AND resetOnChildrenChange is enabled.
    if (
      this.props.resetOnChildrenChange &&
      this.state.hasError &&
      prevProps.children !== this.props.children
    ) {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
      });
    }
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleRefresh = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, label = 'هذه الشاشة', fallback, height = 'min-h-[400px]' } = this.props;

    if (hasError) {
      // Custom render-prop fallback
      if (typeof fallback === 'function') {
        return fallback(error || new Error('Unknown error'), this.handleReset);
      }
      // Custom static fallback
      if (fallback !== undefined) {
        return fallback;
      }
      // Default fallback UI
      return (
        <DefaultFallback
          label={label}
          error={error}
          onReset={this.handleReset}
          onRefresh={this.handleRefresh}
          height={height}
        />
      );
    }

    return children;
  }
}

// ---------------------------------------------------------------------------
// withErrorBoundary — HOC for wrapping dynamic imports
// ---------------------------------------------------------------------------

/**
 * Wrap a component with an ErrorBoundary. Useful for `next/dynamic` imports:
 *
 *   const TradingChartView = withErrorBoundary(
 *     dynamic(() => import('./TradingChartView'), { ssr: false }),
 *     'الشارت التفاعلي',
 *   );
 *
 * The wrapped component has its own isolated ErrorBoundary — an error in
 * TradingChartView won't crash the rest of the page.
 *
 * @param Component The component to wrap (usually a `next/dynamic` result).
 * @param label Human-readable Arabic label for the error message.
 * @param boundaryProps Optional extra props for the ErrorBoundary (onError, etc.)
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  label: string,
  boundaryProps?: Omit<ErrorBoundaryProps, 'children' | 'label'>,
): React.ComponentType<P> {
  const displayName = Component.displayName || Component.name || 'Component';

  const Wrapped = (props: P) => (
    <ErrorBoundary label={label} {...boundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  Wrapped.displayName = `withErrorBoundary(${displayName})`;
  return Wrapped;
}

export default ErrorBoundary;
