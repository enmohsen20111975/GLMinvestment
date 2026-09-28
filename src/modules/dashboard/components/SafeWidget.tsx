'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * SafeWidget - Error Boundary for Dashboard Widgets
 * يمنع الـ crash لو أي widget فيه خطأ
 */
export class SafeWidget extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[SafeWidget${this.props.name ? `:${this.props.name}` : ''}] Error:`, error);
    console.error('[SafeWidget] Component stack:', errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Card className="border-red-200 dark:border-red-800">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <div>
              <p className="text-sm font-medium text-red-600 dark:text-red-400">
                خطأ في تحميل {this.props.name || 'المكون'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                جرب تحديث الصفحة
              </p>
            </div>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}

/**
 * Higher-order component to wrap any component with SafeWidget
 */
export function withSafeWidget<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  name: string
) {
  return function SafeWrappedComponent(props: P) {
    return (
      <SafeWidget name={name}>
        <WrappedComponent {...props} />
      </SafeWidget>
    );
  };
}

export default SafeWidget;
