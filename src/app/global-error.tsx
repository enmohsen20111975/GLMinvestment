'use client';

/**
 * global-error.tsx — Global Error Boundary (PKG2 — Strict Engineering)
 * ====================================================================
 * WHY: Next.js App Router's `error.tsx` does NOT catch errors thrown
 * inside the root `layout.tsx` itself. Without `global-error.tsx`, a
 * crash in the root layout shows Next.js's default red error page
 * (no Arabic, no retry, no branding) — bad UX + no recovery path.
 *
 * This file REPLACES the entire <html> document, so it must render
 * its own <html>/<body> and must NOT depend on layout providers
 * (Providers.tsx, i18n context, theme provider, etc.) — those may be
 * the very thing that crashed.
 *
 * Contract (Next.js 14 App Router):
 *   - Must be a client component.
 *   - Receives { error, reset }.
 *   - reset() re-runs the failed render.
 */

import { useEffect } from 'react';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Surface to server logs (Next forwards console in dev/SSR).
    // eslint-disable-next-line no-console
    console.error('[GlobalErrorBoundary]', error);
  }, [error]);

  const isDev = process.env.NODE_ENV === 'development';

  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          fontFamily:
            "'Cairo','Tajawal',system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
          background: '#0a0f1c',
          color: '#e2e8f0',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '28rem',
            background: '#10172a',
            border: '1px solid rgba(148,163,184,0.15)',
            borderRadius: '0.75rem',
            padding: '1.5rem',
            textAlign: 'center',
          }}
        >
          <div
            aria-hidden
            style={{
              width: '3.5rem',
              height: '3.5rem',
              margin: '0 auto 0.75rem',
              borderRadius: '9999px',
              background: 'rgba(239,68,68,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.75rem',
            }}
          >
            ⚠️
          </div>

          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
            حدث خطأ حرج في التطبيق
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', margin: '0 0 1rem' }}>
            تعذّر تحميل الواجهة. يمكنك إعادة المحاولة أو العودة لاحقًا.
          </p>

          {isDev && (
            <pre
              dir="ltr"
              style={{
                textAlign: 'left',
                fontSize: '0.7rem',
                background: 'rgba(15,23,42,0.6)',
                borderRadius: '0.5rem',
                padding: '0.75rem',
                overflow: 'auto',
                maxHeight: '12rem',
                color: '#f87171',
                margin: '0 0 1rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {error.name}: {error.message}
              {error.digest ? `\ndigest: ${error.digest}` : ''}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={reset}
              style={{
                flex: 1,
                padding: '0.6rem 1rem',
                borderRadius: '0.5rem',
                border: 'none',
                background: '#6366f1',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              إعادة المحاولة
            </button>
            <a
              href="/"
              style={{
                flex: 1,
                padding: '0.6rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid rgba(148,163,184,0.3)',
                background: 'transparent',
                color: '#e2e8f0',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '0.875rem',
                display: 'inline-block',
              }}
            >
              العودة للرئيسية
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
