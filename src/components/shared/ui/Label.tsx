'use client';

/**
 * Label — مكون موحد للنصوص الفرعية (micro labels)
 * ====================================================================
 * بدل ما تكتب 1,676 مرة:
 *   <span className="text-xs text-muted-foreground">العنوان</span>
 *
 * دلوقتي:
 *   <Label>العنوان</Label>
 *
 * يستخدم في 294 ملف → توفير ~1,676 سطر تكرار.
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface LabelProps {
  children: React.ReactNode;
  className?: string;
  size?: 'xs' | 'sm' | 'md';
  muted?: boolean;
}

const sizeMap = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
};

export function Label({ children, className, size = 'xs', muted = true }: LabelProps) {
  return (
    <span className={cn(sizeMap[size], muted && 'text-muted-foreground', className)}>
      {children}
    </span>
  );
}

export default Label;
