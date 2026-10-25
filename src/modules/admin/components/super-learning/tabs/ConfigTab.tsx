/**
 * super-learning/tabs/ConfigTab.tsx
 * ================================
 * The "الإعدادات" tab — basic backtest configuration form:
 * - start_date / end_date (date inputs)
 * - capital (number input)
 * - max_positions (number input)
 * - holding_days (number input)
 */
'use client';

import React from 'react';
import { Settings } from 'lucide-react';
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ConfigTabProps {
  config: {
    start_date: string;
    end_date: string;
    capital: number;
    max_positions: number;
    holding_days: number;
  };
  setConfig: React.Dispatch<React.SetStateAction<{
    start_date: string;
    end_date: string;
    capital: number;
    max_positions: number;
    holding_days: number;
  }>>;
}

export function ConfigTab({ config, setConfig }: ConfigTabProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="h-4 w-4" />
            إعدادات الاختبار
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">تاريخ البداية</Label>
              <Input type="date" value={config.start_date} onChange={(e) => setConfig(prev => ({ ...prev, start_date: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">تاريخ النهاية</Label>
              <Input type="date" value={config.end_date} onChange={(e) => setConfig(prev => ({ ...prev, end_date: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">رأس المال</Label>
              <Input type="number" value={config.capital} onChange={(e) => setConfig(prev => ({ ...prev, capital: Number(e.target.value) }))} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">أقصى صفقات</Label>
              <Input type="number" value={config.max_positions} onChange={(e) => setConfig(prev => ({ ...prev, max_positions: Number(e.target.value) }))} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">أيام الاحتفاظ</Label>
              <Input type="number" value={config.holding_days} onChange={(e) => setConfig(prev => ({ ...prev, holding_days: Number(e.target.value) }))} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
