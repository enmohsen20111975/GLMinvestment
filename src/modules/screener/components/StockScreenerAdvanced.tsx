// src/modules/screener/components/StockScreenerAdvanced.tsx
// F-Phase3-Split-Screener — Strangler shim.
// الأصل كان ملف واحد 2,517 LOC، تم تقسيمه إلى 11 ملف تحت
// `./screener-advanced/`. هذا الملف بيوفر backwards-compatible re-export
// عشان الـ importers اللي بياخدوا من `@/modules/screener/components/StockScreenerAdvanced`
// يفضلوا يشتغلوا من غير تغيير (Strangler pattern).
//
// Public API (preserved exactly):
//   - StockScreenerAdvanced (default-ish named export — main component)
//   - WhatsAppIcon          (inline SVG — lucide has no WhatsApp export)
//   - ExportDropdown         (reusable share/export dropdown)
//   - ExportDropdownProps    (type)
//
// اقرأ README في ./screener-advanced/ لخريطة الملفات.

export { StockScreenerAdvanced, WhatsAppIcon, ExportDropdown } from './screener-advanced/StockScreenerAdvanced';
export type { ExportDropdownProps } from './screener-advanced/types';
