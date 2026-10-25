// src/modules/screener/components/screener-advanced/FilterField.tsx
// F-Phase3-Split-Screener — FilterField + CheckboxField: غلاف لفلاتر
// الـ form (Label + help tooltip + children) + checkbox مع help.

import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import type { FilterFieldProps, CheckboxFieldProps } from './types';

export function FilterField({ label, help, children }: FilterFieldProps) {
  return (
    <div className="space-y-1">
      <Label className="text-xs flex items-center gap-1">
        {label}
        {help && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="w-3 h-3 text-muted-foreground/70 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px] text-right">
                {help}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </Label>
      {children}
      {help && <p className="text-xs text-muted-foreground leading-tight">{help}</p>}
    </div>
  );
}

export function CheckboxField({
  label,
  help,
  checked,
  onChange,
}: CheckboxFieldProps) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(!!v)}
        className="mt-0.5"
      />
      <div className="space-y-0.5 flex-1">
        <Label className="text-xs cursor-pointer" onClick={() => onChange(!checked)}>
          {label}
        </Label>
        {help && <p className="text-xs text-muted-foreground leading-tight">{help}</p>}
      </div>
    </div>
  );
}
