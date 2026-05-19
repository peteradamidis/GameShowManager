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
      
      // Enable SSL for all cloud databases in production
      const needsSsl = process.env.NODE_ENV === 'production' || 
                       dbUrl.includes('sslmode=require') ||
                       dbUrl.includes('.ondigitalocean.com') ||
                       dbUrl.includes('.neon.tech') ||
                       dbUrl.includes('.supabase.') ||
                       dbUrl.includes('.render.com');
      
      console.log(`  DB Init: SSL enabled=${needsSsl}`);
      
      const pool = new Pool({ 
        connectionString: dbUrl,
        ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
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

      // Initialize the DOND CELEB workspace schema before ending the pool
      await initializeCelebSchema(pool);
      
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

// All tables to replicate into the celeb schema.
// The `users` table is intentionally excluded so authentication uses the shared
// public.users table via the search_path = celeb, public fallback.
const CELEB_TABLES = [
  'system_settings',
  'groups',
  'contestants',
  'record_days',
  'seat_assignments',
  'canceled_assignments',
  'availability_tokens',
  'contestant_availability',
  'booking_confirmation_tokens',
  'booking_messages',
  'block_types',
  'standby_assignments',
  'standby_confirmation_tokens',
  'standby_attendance_history',
  'prize_winners',
  'rebooking_history',
  'system_config',
  'form_configurations',
  'attendance_issues',
  'movement_history',
  'noticeboard_posts',
  'noticeboard_comments',
  'noticeboard_likes',
  'post_record_tracking',
  'casting_cards',
  'casting_card_versions',
  'birthday_entries',
  'block_notes',
  'rx_planning_entries',
];

export async function initializeCelebSchema(existingPool?: any) {
  if (!process.env.DATABASE_URL) return;

  const dbUrl = process.env.DATABASE_URL!;
  const needsSsl = process.env.NODE_ENV === 'production' ||
                   dbUrl.includes('sslmode=require') ||
                   dbUrl.includes('.ondigitalocean.com') ||
                   dbUrl.includes('.neon.tech') ||
                   dbUrl.includes('.supabase.') ||
                   dbUrl.includes('.render.com');

  const pool = existingPool || new Pool({
    connectionString: dbUrl,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 2,
  });

  const client = await pool.connect();
  try {
    // 0. Ensure 'AUDIENCE' enum value exists in the global block_type enum
    //    (Safe to run repeatedly — ADD VALUE IF NOT EXISTS is idempotent)
    try {
      await client.query(`ALTER TYPE block_type ADD VALUE IF NOT EXISTS 'AUDIENCE'`);
    } catch (e: any) {
      // Ignore "enum doesn't exist yet" during first-ever db:push
      if (!e.message?.includes('does not exist')) throw e;
    }

    // 1. Create the celeb schema
    await client.query('CREATE SCHEMA IF NOT EXISTS celeb');

    // 2. Check which tables already exist in celeb schema
    const existingResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'celeb'
    `);
    const existingCelebTables = new Set(existingResult.rows.map((r: any) => r.table_name));

    // 3. For each table that exists in public but not in celeb, create it
    let created = 0;
    for (const table of CELEB_TABLES) {
      if (existingCelebTables.has(table)) continue;

      // Check if public table exists first
      const publicCheck = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
      `, [table]);

      if (publicCheck.rows.length === 0) continue; // public table doesn't exist yet

      // Create celeb version using LIKE (copies columns, defaults, indexes, check constraints)
      await client.query(`
        CREATE TABLE IF NOT EXISTS celeb."${table}"
        (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING INDEXES)
      `);
      created++;
    }

    if (created > 0) {
      console.log(`[Celeb Schema] Created ${created} table(s) in celeb schema`);
    } else {
      console.log(`[Celeb Schema] All ${CELEB_TABLES.length} tables already exist in celeb schema`);
    }
  } catch (err: any) {
    console.warn('[Celeb Schema] Error during initialization:', err.message);
  } finally {
    client.release();
    // Only end pool if we created it here
    if (!existingPool) {
      await pool.end();
    }
  }
}
