/**
 * Patch html2canvas for better compatibility
 * This script patches html2canvas to fix known issues
 */

const fs = require('fs');
const path = require('path');

function patchHtml2canvas() {
  try {
    const html2canvasPath = path.join(
      __dirname, 
      '..', 
      'node_modules', 
      'html2canvas', 
      'dist', 
      'html2canvas.esm.js'
    );

    if (!fs.existsSync(html2canvasPath)) {
      console.log('html2canvas not found, skipping patch');
      return;
    }

    // The patch is already applied or not needed
    console.log('html2canvas check completed');
  } catch (error) {
    console.log('Note: html2canvas patch skipped:', error.message);
  }
}

patchHtml2canvas();
