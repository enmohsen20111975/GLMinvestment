/**
 * academy-encyclopedia/renderBody.tsx
 * ===================================
 * Inline markdown-like renderer for lesson section bodies. Supports **bold**
 * spans; newlines preserved via whitespace-pre-line on the wrapping <p>.
 *
 * Extracted from the original `AcademyEncyclopedia.tsx` (2,054 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 */

import * as React from 'react';

export function renderBody(body: string): React.ReactNode {
  // Split on ** for bold spans
  const parts = body.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-bold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    // Convert newlines to <br/> for the print template consistency
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}
