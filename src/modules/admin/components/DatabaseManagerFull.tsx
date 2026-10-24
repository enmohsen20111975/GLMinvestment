/**
 * DatabaseManagerFull.tsx — re-export shim.
 *
 * The original 3,160-LOC implementation has been split into 13 modular files
 * under `./db-manager/`. This shim preserves the public import path so
 * consumers (`src/modules/admin/index.ts` + `src/modules/admin/components/AdminView.tsx`)
 * keep working without modification.
 *
 * See `./db-manager/DatabaseManagerFull.tsx` for the container.
 */

export { DatabaseManagerFull, default } from './db-manager/DatabaseManagerFull';
