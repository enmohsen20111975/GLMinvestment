'use client';

import React, { useEffect } from 'react';
import { ThemeProvider } from 'next-themes';
import { SessionProvider } from 'next-auth/react';

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Keepalive ping to prevent server auto-shutdown on Hostinger
    if (process.env.NODE_ENV === 'production') {
      const ping = () => {
        fetch('/api/keepalive').catch(() => { /* silent */ });
      };
      ping(); // initial ping
      const interval = setInterval(ping, 60_000); // every 60 seconds
      return () => clearInterval(interval);
    }
  }, []);

  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
        {children}
      </ThemeProvider>
    </SessionProvider>
  );
}
