/**
 * Copy sql.js WASM files to standalone output
 * This script runs after build to ensure sql.js works in production
 */

const fs = require('fs');
const path = require('path');

function copySqlJsFiles() {
  try {
    const standaloneDir = path.join(__dirname, '..', '.next', 'standalone');
    
    if (!fs.existsSync(standaloneDir)) {
      console.log('No standalone directory found, skipping sql.js copy');
      return;
    }

    // sql.js wasm files location
    const nodeModulesSqlJs = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist');
    
    if (!fs.existsSync(nodeModulesSqlJs)) {
      console.log('sql.js not found in node_modules, skipping');
      return;
    }

    // Copy wasm files
    const wasmFiles = ['sql-wasm.wasm'];
    
    wasmFiles.forEach(file => {
      const source = path.join(nodeModulesSqlJs, file);
      const dest = path.join(standaloneDir, file);
      
      if (fs.existsSync(source)) {
        fs.copyFileSync(source, dest);
        console.log(`Copied ${file} to standalone directory`);
      }
    });

    console.log('sql.js files copied successfully');
  } catch (error) {
    console.log('Note: sql.js copy skipped:', error.message);
  }
}

copySqlJsFiles();
