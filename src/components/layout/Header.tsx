'use client';

import React, { useState } from 'react';
import { Search, Menu, RefreshCw, Wifi, WifiOff, Bell, Sun, Moon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useAppStore } from '@/lib/store';
import { useNotificationStore } from '@/lib/notification-store';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  const { sidebarOpen, toggleSidebar, searchQuery, setSearchQuery, setCurrentView, loadDashboard, marketOverview } = useAppStore();
  const [searchFocused, setSearchFocused] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setCurrentView('stocks');
    }
  };

  return (
    <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden flex-shrink-0"
          onClick={toggleSidebar}
        >
          <Menu className="w-5 h-5" />
        </Button>

        {/* Title */}
        <div className="min-w-0 mr-auto">
          <h2 className="text-lg font-bold text-foreground truncate">{title}</h2>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>

        {/* Market status indicator */}
        {marketOverview?.market_status && (
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs">
            {marketOverview.market_status.is_open ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">السوق مفتوح</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">السوق مغلق</span>
              </>
            )}
          </div>
        )}

        {/* Dark/Light mode toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="flex-shrink-0"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          aria-label={resolvedTheme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </Button>

        {/* Search */}
        <form onSubmit={handleSearch} className="relative hidden sm:block">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            placeholder="ابحث عن سهم..."
            className="w-48 md:w-64 pr-9 h-9 text-sm"
            dir="rtl"
          />
        </form>

        {/* Notifications */}
        <HeaderNotificationBell />

        {/* Refresh */}
        <Button
          variant="ghost"
          size="icon"
          className="flex-shrink-0 hidden sm:flex"
          onClick={() => {
            loadDashboard();
          }}
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
}

function HeaderNotificationBell() {
  const { unreadCount, setOpen } = useNotificationStore();

  return (
    <Button
      variant="ghost"
      size="icon"
      className="flex-shrink-0 relative"
      onClick={() => setOpen(true)}
      aria-label="الإشعارات"
    >
      <Bell className="w-4 h-4" />
      {unreadCount > 0 && (
        <Badge className="absolute -top-0.5 -left-0.5 h-4 min-w-4 px-1 text-[9px] bg-red-500 text-white border-0 animate-pulse">
          {unreadCount > 99 ? '99+' : unreadCount}
        </Badge>
      )}
    </Button>
  );
}
