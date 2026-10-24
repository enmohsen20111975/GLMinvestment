// F-Phase3-Split-Academy: Strangler re-export shim.
// The original AcademyView.tsx (2,357 LOC) has been split into sub-components
// under ./academy/. This file preserves the public import path so consumers
// (src/modules/education/index.ts + dynamic imports in src/app/page.tsx)
// keep working without modification.
export { AcademyView } from './academy/AcademyView';
export { AcademyView as default } from './academy/AcademyView';
