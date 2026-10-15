# GARAGE — Dead/Retired Components

## Moved from src/ to GARAGE/components/

| File | Original Path | Reason | Restore Command |
|------|--------------|--------|-----------------|
| eid-predictions-widget.tsx | src/components/eid-predictions-widget.tsx | Not imported anywhere — dead code | `mv GARAGE/components/eid-predictions-widget.tsx src/components/` |
| MarketStatusImageCard.tsx | src/components/market/MarketStatusImageCard.tsx | Not imported anywhere — dead code | `mv GARAGE/components/MarketStatusImageCard.tsx src/components/market/` |
| WhatsAppToast.tsx | src/components/notifications/WhatsAppToast.tsx | Not imported anywhere — dead code | `mv GARAGE/components/WhatsAppToast.tsx src/components/notifications/` |

## Note
- `src/components/ui/*` components (sidebar, pagination, carousel, etc.) are kept in place
  because they are shadcn/ui library components that may be needed in future.
- Only files with ZERO imports across the entire codebase were moved.
