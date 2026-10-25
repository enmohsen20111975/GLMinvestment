'use client';

/**
 * persona/PersonaImageCardExport.tsx
 * ============================================================================
 * F-Phase3-Split-PersonaTab — Image card export wrapper (extracted).
 * ----------------------------------------------------------------------------
 * Originally lines 1693-1758 of `../PersonaTab.tsx`. Renders the shareable
 * PersonaImageCard inside an ImageCardExport wrapper (download PNG / publish
 * to Telegram). The render-prop children maps `items` → `PersonaPick[]` for
 * the underlying PersonaImageCard.
 * ============================================================================
 */

import React from 'react';
import { ImageCardExport } from '@/components/market/ImageCardExport';
import { PersonaImageCard, PersonaPick } from '@/components/market/PersonaImageCard';
import { MARKET_NAMES_AR, MarketType } from '@/lib/store';
import type { Persona, PersonaHeaderTheme } from './types';
import { getPersonaJsonKey, isLongTermPersona, cleanTicker } from './helpers';
import { MARKET_CODES } from '../helpers';
import type { StoredAnalysisItem, PersonaData } from '../types';

export interface PersonaImageCardExportProps {
  items: StoredAnalysisItem[];
  persona: Persona;
  market: MarketType;
  headerTheme: PersonaHeaderTheme;
}

export function PersonaImageCardExport({
  items,
  persona,
  market,
  headerTheme,
}: PersonaImageCardExportProps) {
  const isLongTerm = isLongTermPersona(persona);
  const _personaKey = getPersonaJsonKey(persona);

  return (
    <ImageCardExport
      title={`بطاقة ${headerTheme.title}`}
      description="حمّل صورة جاهزة للنشر أو انشرها مباشرة على قناة تيليجرام"
      filename={`${persona}-picks-${MARKET_CODES[market]}`}
      telegramCaption={`📊 ${headerTheme.emoji} ${headerTheme.title} — ${MARKET_NAMES_AR[market]}\n${headerTheme.subtitle}\n\nمنصة دليل الاستثمار | invist.m2y.net`}
      telegramMarket={MARKET_CODES[market]}
      // P26: 3 persona themes — emerald للمحافظ، amber للمتوازن، fuchsia للمغامر
      accentColor={isLongTerm ? '#15803d' : persona === 'balanced' ? '#d97706' : '#a21caf'}
      borderClass={
        isLongTerm
          ? 'border-profit'
          : persona === 'balanced'
            ? 'border-warning'
            : 'border-fuchsia-200'
      }
      bgClass={
        isLongTerm
          ? 'from-profit '
          : persona === 'balanced'
            ? 'from-warning via-yellow-50/40 '
            : 'from-fuchsia-50 via-pink-50/40 to-fuchsia-100/40'
      }
      hasData={items.length > 0}
      emptyHint={
        isLongTerm
          ? 'محرك التصطاد لسه بيدور على فرص تناسب المستثمر.'
          : persona === 'balanced'
            ? 'محرك التصطاد لسه بيدور على فرص تناسب المتوازن.'
            : 'محرك التصطاد لسه بيدور على فرص تناسب المضارب.'
      }
    >
      {(ref) => {
        const picks: PersonaPick[] = items.map((it) => {
          // P26: استخدم _personaKey + fallback للحقول العلوية للسهم
          const pd: PersonaData = it.analysisJson?.[_personaKey] || {
            verdict: it.recommendationAr || '',
            score: it.maestroScore || 0,
            reason: '',
            signal: it.recommendation || 'HOLD',
            entry: it.entry?.price ?? null,
            target: it.entry?.target ?? null,
            stop: it.entry?.stopLoss ?? null,
            timeframe:
              persona === 'balanced'
                ? '2-6 أسابيع'
                : persona === 'conservative'
                  ? '6-12 شهر'
                  : '1-5 أيام',
          };
          return {
            ticker: cleanTicker(it.ticker),
            name_ar: it.nameAr || cleanTicker(it.ticker),
            verdict: pd.verdict,
            score: pd.score,
            reason: pd.reason,
            conditions: pd.conditions,
            entry: pd.entry,
            target: pd.target,
            stop: pd.stop,
            timeframe: pd.timeframe,
            fair_value: pd.fair_value,
          };
        });
        return (
          <PersonaImageCard
            ref={ref}
            market={market}
            // P26: PersonaImageCard بيقبل 'investor'|'gambler' بس — مرّرله المفتاح المظبوط
            persona={_personaKey}
            picks={picks}
            lastUpdate={
              items[0]?.updatedAt
                ? new Date(items[0].updatedAt).toLocaleTimeString('ar-EG')
                : undefined
            }
          />
        );
      }}
    </ImageCardExport>
  );
}
