/**
 * patch-html2pdf.ts — Stub module.
 *
 * html2canvas has been directly patched in node_modules to support
 * oklch()/lab()/lch() color functions (Tailwind CSS v4).
 * See scripts/patch-html2canvas.js for the patch logic.
 *
 * This module exists as a no-op for backward compatibility
 * with existing imports across the codebase.
 */

export async function patchHtml2Canvas(): Promise<void> {
  // No-op: html2canvas is already patched at the node_modules level.
}

/**
 * Export an element to PDF using html2pdf.js.
 * html2canvas (bundled inside html2pdf.js) has been patched to handle oklch().
 */
export async function exportToPdf(
  element: HTMLElement,
  options: {
    filename: string;
    margin?: number[];
    orientation?: "portrait" | "landscape";
  }
): Promise<void> {
  const html2pdf = (await import("html2pdf.js")).default;
  await html2pdf()
    .set({
      margin: options.margin || [8, 8, 8, 8],
      filename: options.filename,
      image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: {
        unit: "mm",
        format: "a4",
        orientation: options.orientation || "portrait",
      },
    })
    .from(element)
    .save();
}
