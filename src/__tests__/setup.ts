/**
 * setup.ts — إعدادات vitest المشتركة (Phase 5 — Testing & QA)
 *
 * - بيـ import الـ jest-dom matchers (toBeInTheDocument, toHaveTextContent, ...)
 * - بيـ polyfill الـ matchMedia + ResizeObserver (Next.js UI components بتحتاجهم)
 * - بيـ suppress الـ React 18 act() warnings (الـ vitest بيـ handle تلقائياً)
 */
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// matchMedia polyfill (بتستخدمه shadcn/ui components)
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// ResizeObserver polyfill (بتستخدمه recharts + radix-ui)
if (typeof global !== 'undefined' && !global.ResizeObserver) {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

// IntersectionObserver polyfill (بتستخدمه بعض lazy-load components)
if (typeof global !== 'undefined' && !global.IntersectionObserver) {
  global.IntersectionObserver = class {
    root = null;
    rootMargin = '';
    thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as any;
}

// suppress console.error من React act() warnings في الـ error boundary tests
// (الـ ErrorBoundary نفسه بيعمل console.error، فلما نعمل test لـ fallback،
// vitest بيـ propagate الـ error للـ console. بنـ silence ده بـ filter).
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === 'string') {
    // Suppress: "The above error occurred in the <X> component:" (from React error boundary)
    // + "[ErrorBoundary:..." (from our ErrorBoundary logging)
    if (
      first.startsWith('The above error occurred') ||
      first.startsWith('[ErrorBoundary:') ||
      first.includes('React will try to recreate this component tree')
    ) {
      return;
    }
  }
  originalConsoleError(...(args as []));
};
