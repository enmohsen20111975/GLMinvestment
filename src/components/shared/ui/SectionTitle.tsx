'use client';

/**
 * SectionTitle — مكون موحد لعناوين الأقسام
 * ====================================================================
 * بدل ما تكتب pattern متكرر في كل مكان:
 *   <h3 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground">
 *     <Icon className="w-3.5 h-3.5" />
 *     عنوان القسم
 *   </h3>
 *
 * دلوقتي:
 *   <SectionTitle icon={Activity}>عنوان القسم</SectionTitle>
 *
 * pattern متكرر ~200 مرة → توفير ~400 سطر.
 */

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SectionTitleProps {
  children: React.ReactNode;
  icon?: LucideIcon;
  iconClass?: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

const sizeMap = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
};

const iconSizeMap = {
  xs: 'w-3.5 h-3.5',
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
};

export function SectionTitle({
  children,
  icon: Icon,
  iconClass,
  size = 'xs',
  className,
}: SectionTitleProps) {
  return (
    <h3 className={cn(sizeMap[size], 'font-semibold flex items-center gap-1.5 text-muted-foreground', className)}>
      {Icon && <Icon className={cn(iconSizeMap[size], iconClass)} />}
      {children}
    </h3>
  );
}

export default SectionTitle;
