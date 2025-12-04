/**
 * Database Initialization
 * Ensures database schema exists on startup by creating tables if they don't exist.
 */

import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { sql } from "drizzle-orm";

neonConfig.webSocketConstructor = ws as any;

export async function initializeDatabase() {
  if (!process.env.DATABASE_URL) {
    console.warn("⚠ DATABASE_URL is not set. Skipping database initialization.");
    return;
  }
  
  try {
    console.log('  DB: Creating connection pool...');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool);
    console.log('  DB: Checking tables...');

    // List of tables to check - they'll be created if missing
    const tablesToCheck = [
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

    // Check which tables exist
    const result = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);

    const existingTables = new Set((result as any).map((row: any) => row.table_name));
    const missingTables = tablesToCheck.filter(t => !existingTables.has(t));

    if (missingTables.length > 0) {
      console.warn(
        `⚠ Database tables missing: ${missingTables.join(", ")}.\n` +
        `  On deployment, run: npm run db:push`
      );
    } else {
      console.log("✓ All database tables exist");
    }
  } catch (error) {
    console.error(
      "⚠ Database initialization check failed:",
      error instanceof Error ? error.message : error,
      "\n  Make sure to run: npm run db:push"
    );
    // Don't throw - allow app to continue, user will fix on deployment
  }
}
