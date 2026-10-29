'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
 AlertDialog,
 AlertDialogAction,
 AlertDialogCancel,
 AlertDialogContent,
 AlertDialogDescription,
 AlertDialogFooter,
 AlertDialogHeader,
 AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAppStore } from '@/lib/store';
export const PERSONAS = [{
  id: 'balanced',
  name: 'المتوازن',
  emoji: '⚖️',
  // FIX (FIX-TSC-BATCH-3): properties read by this file.
  buyThreshold: 70,
  description: 'مستثمر متوازن بين العوائد والمخاطر',
  cryptoAllowed: true,
  color: 'text-success',
  // Stubs consumed by callers (no longer shown since only one persona).
  gamblerDisclaimer: '',
}]; const getPersonaConfig = (_id?: string) => PERSONAS[0]; const shouldShowWarningPopup = (_id?: string) => false; const getWarningMessage = (_id?: string) => '';

import type { PersonaType } from '@/types/v2';

interface PersonaSelectorProps {
 onPersonaChange?: (personaId: PersonaType) => void;
 compact?: boolean;
 showDescription?: boolean;
}

export function PersonaSelector({ 
 onPersonaChange, 
 compact = false,
 showDescription = false 
}: PersonaSelectorProps) {
 const { persona, setPersona } = useAppStore();
 const [showGamblerWarning, setShowGamblerWarning] = useState(false);
 const [pendingPersona, setPendingPersona] = useState<PersonaType | null>(null);

 // Load saved persona from localStorage on mount
 useEffect(() => {
 const saved = localStorage.getItem('selectedPersona');
 if (saved && PERSONAS.find(p => p.id === saved)) {
 setPersona(saved as PersonaType);
 }
 }, [setPersona]);

 // Save persona to localStorage and notify parent
 const handlePersonaChange = (personaId: string) => {
 const typedPersonaId = personaId as PersonaType;
 
 // Check if this is gambler persona and show warning
 if (personaId === 'gambler' && persona !== 'gambler') {
 setPendingPersona(typedPersonaId);
 setShowGamblerWarning(true);
 return;
 }
 
 applyPersonaChange(typedPersonaId);
 };

 const applyPersonaChange = (personaId: PersonaType) => {
 setPersona(personaId);
 localStorage.setItem('selectedPersona', personaId);
 
 // Dispatch custom event for other components to listen
 window.dispatchEvent(new CustomEvent('personaChanged', { detail: personaId }));
 
 if (onPersonaChange) {
 onPersonaChange(personaId);
 }
 };

 const confirmGamblerPersona = () => {
 if (pendingPersona) {
 applyPersonaChange(pendingPersona);
 setPendingPersona(null);
 }
 setShowGamblerWarning(false);
 };

 const cancelGamblerPersona = () => {
 setPendingPersona(null);
 setShowGamblerWarning(false);
 };

 const currentPersona = getPersonaConfig(persona);

 if (compact) {
 return (
 <>
 <TooltipProvider>
 <Tooltip>
 <div className="inline-flex">
 <Select value={persona} onValueChange={handlePersonaChange}>
 <SelectTrigger className="w-[140px] h-9">
 <SelectValue>
 <span className="flex items-center gap-1">
 <span>{currentPersona.emoji}</span>
 <span className="text-sm">{currentPersona.name}</span>
 </span>
 </SelectValue>
 </SelectTrigger>
 <SelectContent>
 {PERSONAS.map((p) => (
 <SelectItem key={p.id} value={p.id}>
 <span className="flex items-center gap-2">
 <span>{p.emoji}</span>
 <span>{p.name}</span>
 <Badge variant="outline" className="ml-auto text-xs">
 {p.buyThreshold}+
 </Badge>
 </span>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <TooltipContent>
 <p>{currentPersona.description}</p>
 <p className="text-xs text-muted-foreground">
 عتبة الشراء: {currentPersona.buyThreshold}+
 </p>
 {currentPersona.cryptoAllowed === false && (
 <p className="text-xs text-warning">🚫 Crypto غير متاح</p>
 )}
 </TooltipContent>
 </Tooltip>
 </TooltipProvider>

 {/* Gambler Warning Dialog */}
 <AlertDialog open={showGamblerWarning} onOpenChange={setShowGamblerWarning}>
 <AlertDialogContent>
 <AlertDialogHeader>
 <AlertDialogTitle className="text-loss flex items-center gap-2">
 ⚠️ تحذير: شخصية المضارب
 </AlertDialogTitle>
 <AlertDialogDescription className="text-right">
 <div className="space-y-3 mt-4">
 <p className="font-bold text-loss text-lg">
 ⚠️ 70% من المضاربين يخسرون رأس مالهم خلال سنة
 </p>
 <p>
 هذه الشخصية مصممة للمخاطر العالية جداً. أنت توافق على:
 </p>
 <ul className="list-disc list-inside space-y-1 text-sm">
 <li>توزيع المحفظة: 60% Crypto، 15% EGX، 10% Cash</li>
 <li>Stop Loss: 15% — قد تخسر جزء كبير من رأس المال</li>
 <li>Time Stop: 10 أيام فقط — ضغط زمني عالي</li>
 <li>تحذير إجباري قبل كل تحليل</li>
 </ul>
 </div>
 </AlertDialogDescription>
 </AlertDialogHeader>
 <AlertDialogFooter className="flex-row-reverse gap-2">
 <AlertDialogCancel onClick={cancelGamblerPersona}>
 إلغاء
 </AlertDialogCancel>
 <AlertDialogAction 
 onClick={confirmGamblerPersona}
 className="bg-loss hover:bg-loss"
 >
 أوافق، أنا أفهم المخاطر
 </AlertDialogAction>
 </AlertDialogFooter>
 </AlertDialogContent>
 </AlertDialog>
 </>
 );
 }

 return (
 <>
 <Card className="overflow-hidden">
 <CardContent className="p-0">
 <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
 {PERSONAS.map((p) => (
 <button
 key={p.id}
 onClick={() => handlePersonaChange(p.id)}
 className={`
 p-4 text-center transition-all duration-200
 ${persona === p.id 
 ? `${p.color} text-foreground` 
 : 'bg-white hover:bg-muted dark:hover:bg-muted'
 }
 border-r last:border-r-0 border-border 
 `}
 >
 <div className="text-2xl mb-1">{p.emoji}</div>
 <div className="font-semibold text-sm">{p.name}</div>
 {persona === p.id && (
 <Badge variant="secondary" className="mt-1 text-xs">
 ✓ مفعّل
 </Badge>
 )}
 {showDescription && (
 <div className="text-xs mt-1 opacity-80">
 عتبة: {p.buyThreshold}+
 </div>
 )}
 {p.id === 'conservative' && (
 <div className="text-xs mt-1 opacity-70">🚫 بدون Crypto</div>
 )}
 {p.id === 'gambler' && (
 <div className="text-xs mt-1 text-loss">⚠️ تحذير عالي</div>
 )}
 </button>
 ))}
 </div>
 </CardContent>
 </Card>

 {/* Gambler Warning Dialog */}
 <AlertDialog open={showGamblerWarning} onOpenChange={setShowGamblerWarning}>
 <AlertDialogContent>
 <AlertDialogHeader>
 <AlertDialogTitle className="text-loss flex items-center gap-2">
 ⚠️ تحذير: شخصية المضارب
 </AlertDialogTitle>
 <AlertDialogDescription className="text-right">
 <div className="space-y-3 mt-4">
 <p className="font-bold text-loss text-lg">
 ⚠️ 70% من المضاربين يخسرون رأس مالهم خلال سنة
 </p>
 <p>
 هذه الشخصية مصممة للمخاطر العالية جداً. أنت توافق على:
 </p>
 <ul className="list-disc list-inside space-y-1 text-sm">
 <li>توزيع المحفظة: 60% Crypto، 15% EGX، 10% Cash</li>
 <li>Stop Loss: 15% — قد تخسر جزء كبير من رأس المال</li>
 <li>Time Stop: 10 أيام فقط — ضغط زمني عالي</li>
 <li>تحذير إجباري قبل كل تحليل</li>
 </ul>
 </div>
 </AlertDialogDescription>
 </AlertDialogHeader>
 <AlertDialogFooter className="flex-row-reverse gap-2">
 <AlertDialogCancel onClick={cancelGamblerPersona}>
 إلغاء
 </AlertDialogCancel>
 <AlertDialogAction 
 onClick={confirmGamblerPersona}
 className="bg-loss hover:bg-loss"
 >
 أوافق، أنا أفهم المخاطر
 </AlertDialogAction>
 </AlertDialogFooter>
 </AlertDialogContent>
 </AlertDialog>
 </>
 );
}

// Hook to get current persona
export function usePersona() {
 const { persona } = useAppStore();
 const personaInfo = getPersonaConfig(persona);

 return {
 personaId: persona,
 personaInfo,
 allPersonas: PERSONAS,
 isCryptoVisible: personaInfo.cryptoAllowed === true,
 showWarningPopup: shouldShowWarningPopup(persona),
 warningMessage: getWarningMessage(persona),
 };
}
