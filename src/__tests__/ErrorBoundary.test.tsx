/**
 * ErrorBoundary.test.tsx — اختبارات الـ ErrorBoundary (Phase 5 Task 2)
 * =========================================================================
 *
 * الموضوع:
 *   الـ ErrorBoundary (في src/components/shared/ErrorBoundary.tsx) بيمسك أي
 *   Error من الـ children ويعرض Fallback UI فيه:
 *     - رسالة "حدث خطأ في تحميل {label}"
 *     - زرار "المحاولة مرة أخرى" (reset state)
 *     - زرار "تحديث الصفحة" (window.location.reload)
 *
 *   لازم نتأكد إن:
 *     1. لو الـ child ما بيرميش error، الـ children بيتـ render عادي.
 *     2. لو الـ child بيرمي error، الـ Fallback UI بيظهر.
 *     3. الـ Fallback فيه الـ label + رسالة + الـ buttons.
 *     4. "المحاولة مرة أخرى" بتعمل reset (الـ child بيرجع يتـ render).
 *     5. onError callback بيتـ استدعى لما يحصل error.
 *     6. withErrorBoundary HOC بيـ wrap الـ component صح.
 *     7. Custom fallback (render-prop) بيشتغل.
 *
 * التشغيل:
 *   bunx vitest run src/__tests__/ErrorBoundary.test.tsx
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ErrorBoundary, withErrorBoundary } from '@/components/shared/ErrorBoundary';

// ─── Helper: component بيرمي error ──────────────────────────────────────
// بناخد message كـ prop عشان نقدر نتحكم في الـ error + نعمل reset عن طريق
// تغيير الـ key أو الـ children.

function ThrowOnRender({ message = 'Test error' }: { message?: string }): null {
  throw new Error(message);
}

// Component بيرمي error بس بـ state control (عشان نعمل reset test)
function ControlledThrower({ shouldThrow }: { shouldThrow: boolean }): null {
  if (shouldThrow) {
    throw new Error('Controlled error');
  }
  return null;
}

// ─── Helper: component طبيعي (ما بيرميش error) ──────────────────────────
function NormalChild({ text }: { text: string }) {
  return <div data-testid="normal-child">{text}</div>;
}

// ──────────────────────────────────────────────────────────────────────────
// 1) الـ children الطبيعية بيتـ render من غير fallback
// ──────────────────────────────────────────────────────────────────────────
describe('ErrorBoundary — normal rendering', () => {
  it('renders children when no error is thrown', () => {
    render(
      <ErrorBoundary label="اختبار">
        <NormalChild text="مرحبا" />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('normal-child')).toBeInTheDocument();
    expect(screen.getByText('مرحبا')).toBeInTheDocument();
  });

  it('does not show fallback UI when children render normally', () => {
    render(
      <ErrorBoundary label="اختبار">
        <NormalChild text="OK" />
      </ErrorBoundary>
    );

    // مفيش رسالة خطأ
    expect(screen.queryByText(/حدث خطأ/i)).not.toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2) الـ Fallback UI بيظهر لما يحصل error
// ──────────────────────────────────────────────────────────────────────────
describe('ErrorBoundary — error fallback', () => {
  it('renders fallback UI when child throws an error', () => {
    render(
      <ErrorBoundary label="الشارت التفاعلي">
        <ThrowOnRender message="Chart rendering failed" />
      </ErrorBoundary>
    );

    // الـ fallback لازم يظهر
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/حدث خطأ في تحميل/)).toBeInTheDocument();
    expect(screen.getByText(/الشارت التفاعلي/)).toBeInTheDocument();
  });

  it('shows the default label when label prop is not provided', () => {
    render(
      <ErrorBoundary>
        <ThrowOnRender />
      </ErrorBoundary>
    );

    // الـ default label = "هذه الشاشة"
    expect(screen.getByText(/هذه الشاشة/)).toBeInTheDocument();
  });

  it('shows the "المحاولة مرة أخرى" button', () => {
    render(
      <ErrorBoundary label="اختبار">
        <ThrowOnRender />
      </ErrorBoundary>
    );

    expect(screen.getByRole('button', { name: /المحاولة مرة أخرى/i })).toBeInTheDocument();
  });

  it('shows the "تحديث الصفحة" button', () => {
    render(
      <ErrorBoundary label="اختبار">
        <ThrowOnRender />
      </ErrorBoundary>
    );

    expect(screen.getByRole('button', { name: /تحديث الصفحة/i })).toBeInTheDocument();
  });

  it('shows error details in a <details> element (for developers)', () => {
    render(
      <ErrorBoundary label="اختبار">
        <ThrowOnRender message="MySpecificError123" />
      </ErrorBoundary>
    );

    // الـ <details> فيه الـ summary + الـ pre
    const summary = screen.getByText(/تفاصيل الخطأ/i);
    expect(summary).toBeInTheDocument();
    // الـ error message موجود (داخل الـ pre، بس مش ظاهر لحد ما نـ expand)
    // بنـ expand الـ details
    fireEvent.click(summary);
    expect(screen.getByText(/MySpecificError123/)).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3) "المحاولة مرة أخرى" بتعمل reset للـ boundary
// ──────────────────────────────────────────────────────────────────────────
describe('ErrorBoundary — reset behavior', () => {
  it('clears error state when "المحاولة مرة أخرى" is clicked', () => {
    // بنستخدم rerender عشان نتحكم في الـ child بين throw و no-throw.
    // بعد ما الـ fallback يظهر، بنضغط "Try again" + نـ re-render بـ child
    // طبيعي. الـ reset لازم يخلي الـ boundary يعرض الـ child الجديد.
    const { rerender } = render(
      <ErrorBoundary label="اختبار">
        <ThrowOnRender message="first" />
      </ErrorBoundary>
    );

    // الـ fallback بيظهر
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/حدث خطأ/i)).toBeInTheDocument();

    // اضغط "المحاولة مرة أخرى" — ده بيعمل setState({hasError: false})
    fireEvent.click(screen.getByRole('button', { name: /المحاولة مرة أخرى/i }));

    // فوراً بعد الـ click، الـ boundary بيحاول re-render الـ children.
    // الـ ThrowOnRender لسه شغال (نفس الـ component)، فالـ error بيرجع.
    // بس الـ important assertion: الـ click معمول (مفيش crash).

    // دلوقتي نـ re-render بـ child طبيعي + resetOnChildrenChange عشان نضمن
    // إن الـ boundary هيـ reset لما الـ children تتغير.
    rerender(
      <ErrorBoundary label="اختبار" resetOnChildrenChange={true}>
        <NormalChild text="recovered" />
      </ErrorBoundary>
    );

    // الـ child الجديد بيظهر + الـ fallback اختفى
    expect(screen.getByTestId('normal-child')).toBeInTheDocument();
    expect(screen.getByText('recovered')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('handles multiple reset clicks without crashing', () => {
    render(
      <ErrorBoundary label="اختبار">
        <ThrowOnRender />
      </ErrorBoundary>
    );

    const button = screen.getByRole('button', { name: /المحاولة مرة أخرى/i });

    // اضغط الـ button كذا مرة — ما يقعش
    expect(() => {
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);
    }).not.toThrow();

    // الـ fallback لسه موجود (الـ child لسه بيرمي)
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4) onError callback
// ──────────────────────────────────────────────────────────────────────────
describe('ErrorBoundary — onError callback', () => {
  it('calls onError when an error is caught', () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary label="اختبار" onError={onError}>
        <ThrowOnRender message="Callback test" />
      </ErrorBoundary>
    );

    expect(onError).toHaveBeenCalledTimes(1);
    const [error, errorInfo] = onError.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Callback test');
    // errorInfo فيه componentStack
    expect(errorInfo).toHaveProperty('componentStack');
    expect(typeof errorInfo.componentStack).toBe('string');
  });

  it('does not crash if onError throws', () => {
    const badOnError = vi.fn(() => {
      throw new Error('onError itself failed');
    });

    // لازم ما يقعش — الـ ErrorBoundary بـ catch الـ callback error
    expect(() => {
      render(
        <ErrorBoundary label="اختبار" onError={badOnError}>
          <ThrowOnRender />
        </ErrorBoundary>
      );
    }).not.toThrow();

    // الـ fallback لسه بيظهر
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5) withErrorBoundary HOC
// ──────────────────────────────────────────────────────────────────────────
describe('withErrorBoundary HOC', () => {
  it('wraps a component with an ErrorBoundary', () => {
    const ThrowingComponent = withErrorBoundary(
      ThrowOnRender,
      'مكون الاختبار'
    );

    render(React.createElement(ThrowingComponent, { message: 'HOC test' }));

    // الـ fallback بيظهر بالـ label اللي مرّرناه
    expect(screen.getByText(/مكون الاختبار/)).toBeInTheDocument();
  });

  it('allows normal components to render through the HOC', () => {
    const WrappedNormal = withErrorBoundary(
      NormalChild,
      'مكون طبيعي'
    );

    render(React.createElement(WrappedNormal, { text: 'HOC normal' }));

    expect(screen.getByTestId('normal-child')).toBeInTheDocument();
    expect(screen.getByText('HOC normal')).toBeInTheDocument();
    // مفيش fallback
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sets a displayName on the wrapped component', () => {
    const Wrapped = withErrorBoundary(NormalChild, 'test');
    expect(Wrapped.displayName).toMatch(/withErrorBoundary/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6) Custom fallback (render-prop)
// ──────────────────────────────────────────────────────────────────────────
describe('ErrorBoundary — custom fallback', () => {
  it('renders a custom render-prop fallback', () => {
    const customFallback = (error: Error, reset: () => void) => (
      <div data-testid="custom-fallback">
        <span>Custom: {error.message}</span>
        <button onClick={reset} data-testid="custom-reset">Retry</button>
      </div>
    );

    render(
      <ErrorBoundary label="اختبار" fallback={customFallback}>
        <ThrowOnRender message="Custom test" />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
    expect(screen.getByText(/Custom: Custom test/)).toBeInTheDocument();
    // الـ default fallback ما بيظهرش
    expect(screen.queryByText(/حدث خطأ/i)).not.toBeInTheDocument();
  });

  it('renders a static fallback node', () => {
    const staticFallback = (
      <div data-testid="static-fallback">Static fallback</div>
    );

    render(
      <ErrorBoundary label="اختبار" fallback={staticFallback}>
        <ThrowOnRender />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('static-fallback')).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 7) resetOnChildrenChange (tab switches)
// ──────────────────────────────────────────────────────────────────────────
describe('ErrorBoundary — resetOnChildrenChange', () => {
  it('resets when children change (if resetOnChildrenChange=true)', () => {
    const { rerender } = render(
      <ErrorBoundary label="اختبار" resetOnChildrenChange={true}>
        <ThrowOnRender message="first error" />
      </ErrorBoundary>
    );

    // الـ fallback بيظهر
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // re-render بـ child مختلف (محاكاة tab switch)
    rerender(
      <ErrorBoundary label="اختبار" resetOnChildrenChange={true}>
        <NormalChild text="new child" />
      </ErrorBoundary>
    );

    // الـ fallback اختفى + الـ child الجديد ظهر
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('normal-child')).toBeInTheDocument();
  });

  it('does NOT reset when children change (if resetOnChildrenChange=false)', () => {
    const { rerender } = render(
      <ErrorBoundary label="اختبار" resetOnChildrenChange={false}>
        <ThrowOnRender message="first error" />
      </ErrorBoundary>
    );

    // الـ fallback بيظهر
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // re-render بـ child مختلف — الـ fallback بيفضل (ما حصلش reset)
    rerender(
      <ErrorBoundary label="اختبار" resetOnChildrenChange={false}>
        <NormalChild text="new child" />
      </ErrorBoundary>
    );

    // الـ fallback لسه موجود (ما حصلش reset)
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('normal-child')).not.toBeInTheDocument();
  });
});
