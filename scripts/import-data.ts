#!/usr/bin/env npx tsx
/**
 * Data Import Script
 * 
 * Imports database tables and uploaded files from an export directory.
 * 
 * Usage: npm run import:data <path-to-export-dir>
 * 
 * WARNING: This will REPLACE existing data in the database!
 */

import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// Database connection
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// Tables to import (in order to respect foreign key dependencies)
// Order matters: parents before children
const TABLES_IN_ORDER = [
  "groups",
  "contestants",
  "record_days",
  "seat_assignments",
  "canceled_assignments",
  "availability_tokens",
  "contestant_availability",
  "booking_confirmation_tokens",
  "booking_messages",
  "block_types",
  "standby_assignments",
  "standby_confirmation_tokens",
  "system_config",
  "form_configurations",
];

// Tables to clear in reverse order (children before parents)
const TABLES_TO_CLEAR = [...TABLES_IN_ORDER].reverse();

// Directories to restore
const FILE_DIRS = [
  { source: "uploads", dest: "uploads" },
  { source: "storage", dest: "storage" },
];

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function clearTable(tableName: string) {
  try {
    await db.execute(sql.raw(`DELETE FROM ${tableName}`));
    console.log(`    ✓ Cleared ${tableName}`);
  } catch (error: any) {
    if (error.message?.includes("does not exist")) {
      console.log(`    ⚠ Table ${tableName} does not exist (skipping)`);
    } else {
      throw error;
    }
  }
}

async function importTable(tableName: string, exportDir: string) {
  const filePath = path.join(exportDir, "database", `${tableName}.json`);
  
  if (!fs.existsSync(filePath)) {
    console.log(`    ⚠ No data file for ${tableName} (skipping)`);
    return 0;
  }
  
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  
  if (!data || data.length === 0) {
    console.log(`    ⚠ No rows in ${tableName} (skipping)`);
    return 0;
  }
  
  // Get column names from first row
  const columns = Object.keys(data[0]);
  
  let imported = 0;
  
  for (const row of data) {
    const values = columns.map((col) => {
      const val = row[col];
      if (val === null || val === undefined) return "NULL";
      if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
      if (typeof val === "number") return String(val);
      // Escape single quotes and wrap in quotes
      return `'${String(val).replace(/'/g, "''")}'`;
    });
    
    const insertSql = `INSERT INTO ${tableName} (${columns.map(c => `"${c}"`).join(", ")}) VALUES (${values.join(", ")}) ON CONFLICT DO NOTHING`;
    
    try {
      await db.execute(sql.raw(insertSql));
      imported++;
    } catch (error: any) {
      console.error(`    ✗ Error inserting row: ${error.message}`);
    }
  }
  
  console.log(`    ✓ Imported ${imported}/${data.length} rows to ${tableName}`);
  return imported;
}

function copyDirectory(src: string, dest: string) {
  if (!fs.existsSync(src)) {
    console.log(`    ⚠ Source directory ${src} does not exist (skipping)`);
    return 0;
  }
  
  let fileCount = 0;
  
  function copyRecursive(srcPath: string, destPath: string) {
    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(destPath, { recursive: true });
    }
    
    const entries = fs.readdirSync(srcPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcFile = path.join(srcPath, entry.name);
      const destFile = path.join(destPath, entry.name);
      
      if (entry.isDirectory()) {
        copyRecursive(srcFile, destFile);
      } else {
        fs.copyFileSync(srcFile, destFile);
        fileCount++;
      }
    }
  }
  
  copyRecursive(src, dest);
  return fileCount;
}

async function main() {
  const exportDir = process.argv[2];
  
  if (!exportDir) {
    console.error("Usage: npm run import:data <path-to-export-dir>");
    console.error("Example: npm run import:data ./exports/export-2024-01-15T10-30-00");
    process.exit(1);
  }
  
  const fullExportPath = path.resolve(exportDir);
  
  if (!fs.existsSync(fullExportPath)) {
    console.error(`Export directory not found: ${fullExportPath}`);
    process.exit(1);
  }
  
  // Check for manifest
  const manifestPath = path.join(fullExportPath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error("manifest.json not found in export directory. Is this a valid export?");
    process.exit(1);
  }
  
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  
  console.log("\n╔════════════════════════════════════════╗");
  console.log("║     DATA IMPORT - Contestant System    ║");
  console.log("╚════════════════════════════════════════╝\n");
  
  console.log(`📦 Import from: ${fullExportPath}`);
  console.log(`📅 Export date: ${manifest.exportedAt}`);
  console.log(`📊 Tables: ${Object.keys(manifest.tables || {}).length}`);
  console.log(`📁 Files: ${Object.values(manifest.files || {}).reduce((a: number, b: any) => a + (b as number), 0)}`);
  
  console.log("\n⚠️  WARNING: This will REPLACE existing data in the database!");
  console.log("   Make sure you have a backup before proceeding.\n");
  
  const answer = await prompt("Type 'yes' to continue: ");
  
  if (answer.toLowerCase() !== "yes") {
    console.log("Import cancelled.");
    process.exit(0);
  }
  
  // Clear existing data
  console.log("\n🗑️  Clearing existing data...\n");
  
  for (const table of TABLES_TO_CLEAR) {
    await clearTable(table);
  }
  
  // Import database tables
  console.log("\n📊 Importing database tables...\n");
  
  const tableStats: Record<string, number> = {};
  
  for (const table of TABLES_IN_ORDER) {
    console.log(`  Importing ${table}...`);
    tableStats[table] = await importTable(table, fullExportPath);
  }
  
  // Restore file directories
  console.log("\n📁 Restoring file directories...\n");
  
  const fileStats: Record<string, number> = {};
  
  for (const { source, dest } of FILE_DIRS) {
    console.log(`  Restoring ${dest}/...`);
    const sourcePath = path.join(fullExportPath, source);
    const destPath = path.join(projectRoot, dest);
    
    const count = copyDirectory(sourcePath, destPath);
    fileStats[dest] = count;
    console.log(`    ✓ ${count} files restored`);
  }
  
  // Summary
  console.log("\n╔════════════════════════════════════════╗");
  console.log("║            IMPORT COMPLETE             ║");
  console.log("╚════════════════════════════════════════╝");
  console.log(`\n📊 Database: ${Object.values(tableStats).reduce((a, b) => a + b, 0)} total rows imported`);
  console.log(`📁 Files: ${Object.values(fileStats).reduce((a, b) => a + b, 0)} files restored`);
  console.log(`\n💡 Restart your application to see the imported data.\n`);
  
  await pool.end();
}

main().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
