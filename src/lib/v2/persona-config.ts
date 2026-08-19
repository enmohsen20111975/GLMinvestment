/**
 * Persona Configuration — Launch Version
 * 3 Personas only: Conservative, Balanced, Gambler
 * 
 * Per Meeting Minutes 2026-05-23:
 * - Conservative: Crypto hidden completely — no tab, no mention
 * - Balanced: Crypto visible — BTC + ETH only
 * - Gambler: Crypto visible — all + warning popup
 */

import type { PersonaType, PersonaConfig } from './types';

// ==================== ACTIVE PERSONAS (Launch) ====================

export const ACTIVE_PERSONAS: PersonaType[] = ['conservative', 'balanced', 'gambler'];

export const PERSONAS: PersonaConfig[] = [
  {
    id: 'conservative',
    name: 'المحافظ',
    nameEn: 'Conservative',
    emoji: '🛡️',
    description: 'حماية رأس المال أولاً',
    buyThreshold: 75,
    riskTolerance: 2,
    stopLossPercent: 6,
    targetMultiplier: 1.10,
    color: 'bg-blue-500',
    // Special: Crypto completely hidden for this persona
    cryptoAllowed: false,
    cryptoMaxPercent: 0,
    // Asset allocation per meeting
    allocations: {
      egx: 0.65,
      crypto: 0.0,
      gold: 0.20,
      cash: 0.15,
    },
    // Hard protections
    maxPositionPercent: 3,
    dailyLossLimitPercent: 1,
    stopLossDays: 90,
    warningPopup: false,
  },
  {
    id: 'balanced',
    name: 'المتوازن',
    nameEn: 'Balanced',
    emoji: '⚖️',
    description: 'توازن بين العائد والمخاطر',
    buyThreshold: 65,
    riskTolerance: 5,
    stopLossPercent: 10,
    targetMultiplier: 1.20,
    color: 'bg-yellow-500',
    // Crypto allowed: BTC + ETH only
    cryptoAllowed: true,
    cryptoMaxPercent: 15,
    // Asset allocation per meeting
    allocations: {
      egx: 0.50,
      crypto: 0.15,
      gold: 0.15,
      cash: 0.15,
    },
    // Hard protections
    maxPositionPercent: 7,
    dailyLossLimitPercent: 3,
    stopLossDays: 45,
    warningPopup: false,
  },
  {
    id: 'gambler',
    name: 'المقامر المحسّن',
    nameEn: 'Calculated Gambler',
    emoji: '🔥',
    description: 'مخاطر عالية جداً مع وعي',
    buyThreshold: 50,
    riskTolerance: 9,
    stopLossPercent: 15,
    targetMultiplier: 1.50,
    color: 'bg-red-600',
    // Crypto allowed: All coins
    cryptoAllowed: true,
    cryptoMaxPercent: 60,
    // Asset allocation per meeting
    allocations: {
      egx: 0.15,
      crypto: 0.60,
      gold: 0.0,
      cash: 0.10,
    },
    // Hard protections
    maxPositionPercent: 15,
    dailyLossLimitPercent: 5,
    stopLossDays: 10,
    warningPopup: true, // Mandatory warning before each recommendation
    warningMessage: '⚠️ 70% من المقامرين يخسرون رأس مالهم خلال سنة',
  },
];

// ==================== HELPER FUNCTIONS ====================

/**
 * Get persona config by ID
 */
export function getPersonaConfig(personaId: PersonaType | string): PersonaConfig {
  return PERSONAS.find(p => p.id === personaId) || PERSONAS[1]; // Default to balanced
}

/**
 * Check if persona is active (available for selection)
 */
export function isActivePersona(personaId: string): boolean {
  return ACTIVE_PERSONAS.includes(personaId as PersonaType);
}

/**
 * Check if crypto should be visible for persona
 */
export function isCryptoVisible(personaId: PersonaType | string): boolean {
  const persona = getPersonaConfig(personaId);
  return persona.cryptoAllowed === true;
}

/**
 * Get max crypto percentage for persona
 */
export function getCryptoMaxPercent(personaId: PersonaType | string): number {
  const persona = getPersonaConfig(personaId);
  return persona.cryptoMaxPercent || 0;
}

/**
 * Adjust recommendation based on persona
 */
export function applyPersonaAdjustments(
  score: number,
  personaId: PersonaType | string
): { recommendation: 'Strong Buy' | 'Buy' | 'Hold' | 'Avoid' | 'Strong Avoid'; adjustedScore: number } {
  const persona = getPersonaConfig(personaId);
  const threshold = persona.buyThreshold;
  
  let recommendation: 'Strong Buy' | 'Buy' | 'Hold' | 'Avoid' | 'Strong Avoid';
  
  if (score >= threshold + 15) {
    recommendation = 'Strong Buy';
  } else if (score >= threshold) {
    recommendation = 'Buy';
  } else if (score >= threshold - 20) {
    recommendation = 'Hold';
  } else if (score >= threshold - 35) {
    recommendation = 'Avoid';
  } else {
    recommendation = 'Strong Avoid';
  }
  
  const adjustedScore = Math.min(100, Math.max(0, score));
  
  return { recommendation, adjustedScore };
}

/**
 * Calculate stop loss based on persona and entry price
 */
export function calculatePersonaStopLoss(
  entryPrice: number,
  personaId: PersonaType | string
): number {
  const persona = getPersonaConfig(personaId);
  return entryPrice * (1 - persona.stopLossPercent / 100);
}

/**
 * Calculate target price based on persona
 */
export function calculatePersonaTargetPrice(
  entryPrice: number,
  personaId: PersonaType | string
): number {
  const persona = getPersonaConfig(personaId);
  return entryPrice * persona.targetMultiplier;
}

/**
 * Get max position size based on persona risk tolerance
 */
export function getMaxPositionSize(
  totalCapital: number,
  personaId: PersonaType | string
): number {
  const persona = getPersonaConfig(personaId);
  const maxPercent = persona.maxPositionPercent || 10;
  return totalCapital * (maxPercent / 100);
}

/**
 * Check if warning popup should be shown
 */
export function shouldShowWarningPopup(personaId: PersonaType | string): boolean {
  const persona = getPersonaConfig(personaId);
  return persona.warningPopup === true;
}

/**
 * Get warning message for gambler persona
 */
export function getWarningMessage(personaId: PersonaType | string): string | null {
  const persona = getPersonaConfig(personaId);
  return persona.warningMessage || null;
}
