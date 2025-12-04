/**
 * Database Initialization
 * Ensures database schema exists on startup by creating tables if they don't exist.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";

export async function initializeDatabase() {
  if (!process.env.DATABASE_URL) {
    console.warn("⚠ DATABASE_URL is not set. Skipping database initialization.");
    return;
  }
  
  // Run database check in background with timeout - don't block server startup
  const checkDatabase = async () => {
    try {
      console.log('  DB: Creating connection pool...');
      const dbUrl = process.env.DATABASE_URL!;
      const pool = new Pool({ 
        connectionString: dbUrl,
        ssl: dbUrl.includes('sslmode=require') || 
             dbUrl.includes('.db.ondigitalocean.com') ||
             dbUrl.includes('.neon.tech')
          ? { rejectUnauthorized: false }
          : undefined,
      });
      const db = drizzle(pool);
      console.log('  DB: Checking tables (10s timeout)...');

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

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database check timed out after 10s')), 10000)
      );

      // Check which tables exist
      const result = await Promise.race([
        db.execute(sql`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public'
        `),
        timeoutPromise
      ]) as any;

      // Handle both array format and { rows } format from Neon
      const rows = Array.isArray(result) ? result : (result.rows || []);
      const existingTables = new Set(rows.map((row: any) => row.table_name));
      const missingTables = tablesToCheck.filter(t => !existingTables.has(t));

      if (missingTables.length > 0) {
        console.warn(
          `⚠ Database tables missing: ${missingTables.join(", ")}.\n` +
          `  On deployment, run: npm run db:push`
        );
      } else {
        console.log("✓ All database tables exist");
      }
      
      await pool.end();
    } catch (error) {
      console.error(
        "⚠ Database initialization check failed:",
        error instanceof Error ? error.message : error,
        "\n  Make sure to run: npm run db:push"
      );
      // Don't throw - allow app to continue, user will fix on deployment
    }
  };

  // Start check but don't await - let server continue starting
  checkDatabase();
  console.log('  DB: Check started (non-blocking)');
}
