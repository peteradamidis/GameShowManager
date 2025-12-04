#!/usr/bin/env npx tsx
/**
 * Data Export Script
 * 
 * Exports all database tables and uploaded files to a portable format.
 * Creates a timestamped export directory with:
 * - database/ - JSON files for each table
 * - uploads/ - Copy of all uploaded files (photos, branding, etc.)
 * - storage/ - Copy of object storage files (email assets, etc.)
 * - manifest.json - Export metadata
 * 
 * Usage: npm run export:data
 */

import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// Database connection
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// Tables to export (in order to respect foreign key dependencies)
const TABLES = [
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

// Directories to copy
const FILE_DIRS = [
  { source: "uploads", dest: "uploads" },
  { source: "storage", dest: "storage" },
];

async function exportTable(tableName: string, exportDir: string) {
  console.log(`  Exporting ${tableName}...`);
  
  try {
    const result = await db.execute(sql.raw(`SELECT * FROM ${tableName}`));
    const rows = result.rows || [];
    
    const outputPath = path.join(exportDir, "database", `${tableName}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2));
    
    console.log(`    ✓ ${rows.length} rows exported`);
    return rows.length;
  } catch (error: any) {
    if (error.message?.includes("does not exist")) {
      console.log(`    ⚠ Table does not exist (skipping)`);
      return 0;
    }
    throw error;
  }
}

function copyDirectory(src: string, dest: string) {
  if (!fs.existsSync(src)) {
    console.log(`  ⚠ Directory ${src} does not exist (skipping)`);
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
  console.log("\n╔════════════════════════════════════════╗");
  console.log("║     DATA EXPORT - Contestant System    ║");
  console.log("╚════════════════════════════════════════╝\n");
  
  // Create export directory with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const exportDir = path.join(projectRoot, "exports", `export-${timestamp}`);
  
  fs.mkdirSync(path.join(exportDir, "database"), { recursive: true });
  
  console.log(`Export directory: ${exportDir}\n`);
  
  // Export database tables
  console.log("📊 Exporting database tables...\n");
  
  const tableStats: Record<string, number> = {};
  
  for (const table of TABLES) {
    tableStats[table] = await exportTable(table, exportDir);
  }
  
  // Copy file directories
  console.log("\n📁 Copying file directories...\n");
  
  const fileStats: Record<string, number> = {};
  
  for (const { source, dest } of FILE_DIRS) {
    console.log(`  Copying ${source}/...`);
    const sourcePath = path.join(projectRoot, source);
    const destPath = path.join(exportDir, dest);
    
    const count = copyDirectory(sourcePath, destPath);
    fileStats[source] = count;
    console.log(`    ✓ ${count} files copied`);
  }
  
  // Create manifest
  const manifest = {
    exportedAt: new Date().toISOString(),
    version: "1.0",
    tables: tableStats,
    files: fileStats,
    notes: [
      "Import using: npm run import:data <path-to-export-dir>",
      "Database tables are in ./database/*.json",
      "Uploaded files are in ./uploads/ and ./storage/",
    ],
  };
  
  fs.writeFileSync(
    path.join(exportDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  
  // Summary
  console.log("\n╔════════════════════════════════════════╗");
  console.log("║            EXPORT COMPLETE             ║");
  console.log("╚════════════════════════════════════════╝");
  console.log(`\n📦 Export saved to: ${exportDir}`);
  console.log(`\n📊 Database tables: ${Object.values(tableStats).reduce((a, b) => a + b, 0)} total rows`);
  console.log(`📁 Files copied: ${Object.values(fileStats).reduce((a, b) => a + b, 0)} files`);
  console.log(`\n💡 To import on another system, copy the export folder and run:`);
  console.log(`   npm run import:data ./exports/export-${timestamp}\n`);
  
  await pool.end();
}

main().catch((error) => {
  console.error("Export failed:", error);
  process.exit(1);
});
