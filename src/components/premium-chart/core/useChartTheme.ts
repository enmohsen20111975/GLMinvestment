/**
 * Premium Chart — useChartTheme
 * =====================================================================
 *
 * Hook يرجّع إعدادات المظهر حسب الوضع (dark/light).
 * يتحدث تلقائياً عند تغير الـ theme prop.
 */

import { useMemo } from 'react';
import { DARK_THEME, LIGHT_THEME, type ChartTheme } from '../types';

export function useChartTheme(theme: 'dark' | 'light' = 'dark'): ChartTheme {
  return useMemo(() => {
    return theme === 'light' ? LIGHT_THEME : DARK_THEME;
  }, [theme]);
}
