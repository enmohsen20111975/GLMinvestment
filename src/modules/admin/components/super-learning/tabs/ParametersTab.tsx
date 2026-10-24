/**
 * super-learning/tabs/ParametersTab.tsx
 * ======================================
 * The "البرمترات" tab — 3 parameter groups (technical / risk / decision),
 * each group rendered as a Card with a grid of slider controls (one per
 * BacktestParameters key). Modified parameters are highlighted with a violet
 * background. Ends with a "إعادة للقيم القياسية" reset button.
 */
'use client';

import React from 'react';
import { TrendingUp, Shield, Target, RotateCcw } from 'lucide-react';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { PERSONA_DEFAULTS, type BacktestParameters } from '@/hooks/useSuperLearningData';
import { PARAM_CONFIG } from '../constants';
import { safeToFixed } from '../helpers';

export interface ParametersTabProps {
  activePersona: string;
  parameters: BacktestParameters;
  updateParameter: (key: keyof BacktestParameters, value: number) => void;
  resetToDefaults: () => void;
}

export function ParametersTab({ activePersona, parameters, updateParameter, resetToDefaults }: ParametersTabProps) {
  return (
    <div className="space-y-4">
      {/* Parameters by Group */}
      {(['technical', 'risk', 'decision'] as const).map(group => (
        <Card key={group}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {group === 'technical' && <TrendingUp className="w-4 h-4 text-primary" />}
              {group === 'risk' && <Shield className="w-4 h-4 text-warning" />}
              {group === 'decision' && <Target className="w-4 h-4 text-primary" />}
              {group === 'technical' && 'المؤشرات الفنية'}
              {group === 'risk' && 'إدارة المخاطر'}
              {group === 'decision' && 'منطق القرار'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(Object.keys(PARAM_CONFIG) as Array<keyof BacktestParameters>)
                .filter(key => PARAM_CONFIG[key].group === group)
                .map(key => {
                  const cfg = PARAM_CONFIG[key];
                  const defaultValue = (PERSONA_DEFAULTS[activePersona] as BacktestParameters)[key];
                  const isModified = parameters[key] !== defaultValue;

                  return (
                    <div key={key} className={cn(
                      "space-y-1.5 p-3 rounded-lg border transition-colors",
                      isModified
                        ? "bg-violet-50/50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800"
                        : "bg-muted/30 border-transparent"
                    )}>
                      <div className="flex justify-between items-center gap-2">
                        <Label className="text-xs font-medium">{cfg.ar}</Label>
                        <Badge variant={isModified ? "default" : "outline"} className="text-xs font-mono">
                          {safeToFixed(parameters[key], key.includes('threshold') || key.includes('std') || key.includes('stop') || key.includes('target') || key.includes('multiplier') ? 1 : 0)}
                        </Badge>
                      </div>
                      <Slider
                        value={[parameters[key]]}
                        onValueChange={([v]) => updateParameter(key, v)}
                        min={cfg.min}
                        max={cfg.max}
                        step={cfg.step}
                        className="mt-1"
                      />
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">{cfg.min}</span>
                        <span className="text-xs text-muted-foreground">قياسي: {defaultValue}</span>
                        <span className="text-xs text-muted-foreground">{cfg.max}</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      ))}

      <Button variant="outline" onClick={resetToDefaults} className="gap-2">
        <RotateCcw className="w-4 h-4" />
        إعادة للقيم القياسية
      </Button>
    </div>
  );
}
