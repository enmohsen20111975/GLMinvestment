/**
 * Ensure databases exist
 * Creates necessary database files if they don't exist
 */

const fs = require('fs');
const path = require('path');

function ensureDatabases() {
  try {
    const dbDir = path.join(__dirname, '..', 'db');
    
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log('Created db directory');
    }

    // Check for main database
    const mainDb = path.join(dbDir, 'stocks.db');
    if (!fs.existsSync(mainDb)) {
      console.log('Main database will be created by Prisma');
    }

    console.log('Database check completed');
  } catch (error) {
    console.log('Note: Database check skipped:', error.message);
  }
}

ensureDatabases();
