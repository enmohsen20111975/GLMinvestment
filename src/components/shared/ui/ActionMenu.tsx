'use client';

/**
 * ActionMenu — BLUEPRINT-UNIFIED-SCREENS (Phase 1, Component 8/8)
 * ====================================================================
 * قائمة منسدلة أنيقة تجمع خيارات (نسخ، مشاركة، تصدير صورة، تنبيه)
 * وتلغي فوضى الأزرار المتراصة.
 *
 * بـ يستخدم shadcn/ui DropdownMenu (موجود بالفعل).
 * Rule 30: Emerald + Amber (ممنوع أزرق).
 */
import React from 'react';
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuSeparator,
 DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { MoreVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ActionMenuItem {
 /** معرّف فريد (يتـ return في onSelect). */
 id: string;
 /** النص العربي. */
 label: string;
 /** أيقونة lucide. */
 icon?: React.ComponentType<{ className?: string }>;
 /** لو true → العنصر خطر (لون loss). */
 danger?: boolean;
 /** disabled. */
 disabled?: boolean;
}

export interface ActionMenuProps {
 items: ActionMenuItem[];
 /** callback عند الاختيار. */
 onSelect?: (id: string) => void;
 /** trigger label (default: أيقونة ⋮). */
 triggerLabel?: string;
 /** trigger variant. */
 triggerVariant?: 'icon' | 'button';
 className?: string;
 align?: 'start' | 'center' | 'end';
}

export function ActionMenu({
 items,
 onSelect,
 triggerLabel,
 triggerVariant = 'icon',
 className,
 align = 'end',
}: ActionMenuProps) {
 if (!items || items.length === 0) return null;

 return (
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 {triggerVariant === 'button' ? (
 <Button
 variant="outline"
 size="sm"
 className={cn('gap-1.5', className)}
 >
 {triggerLabel || 'خيارات'}
 <MoreVertical className="size-3.5" />
 </Button>
 ) : (
 <Button
 variant="ghost"
 size="sm"
 className={cn('size-8 p-0', className)}
 aria-label="خيارات"
 >
 <MoreVertical className="size-4" />
 </Button>
 )}
 </DropdownMenuTrigger>
 <DropdownMenuContent align={align} dir="rtl">
 {items.map((item, idx) => {
 const Icon = item.icon;
 return (
 <React.Fragment key={item.id}>
 {idx > 0 && <DropdownMenuSeparator />}
 <DropdownMenuItem
 disabled={item.disabled}
 onClick={() => onSelect?.(item.id)}
 className={cn(
 'gap-2 cursor-pointer',
 item.danger && 'text-loss focus:text-loss'
 )}
 >
 {Icon && <Icon className="size-4" />}
 <span>{item.label}</span>
 </DropdownMenuItem>
 </React.Fragment>
 );
 })}
 </DropdownMenuContent>
 </DropdownMenu>
 );
}
