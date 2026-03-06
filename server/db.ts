import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

// Log database configuration status (don't throw - let app start for health checks)
if (!process.env.DATABASE_URL) {
  console.error("⚠ DATABASE_URL is not set. Database operations will fail.");
  console.error("  Set DATABASE_URL environment variable to your PostgreSQL connection string.");
}

// Enable SSL for all cloud databases in production
const needsSsl = process.env.NODE_ENV === 'production' || 
                 (process.env.DATABASE_URL && (
                   process.env.DATABASE_URL.includes('sslmode=require') ||
                   process.env.DATABASE_URL.includes('.ondigitalocean.com') ||
                   process.env.DATABASE_URL.includes('.neon.tech') ||
                   process.env.DATABASE_URL.includes('.supabase.') ||
                   process.env.DATABASE_URL.includes('.render.com')
                 ));

console.log(`  DB Module: SSL enabled=${needsSsl}`);

export const pool = process.env.DATABASE_URL 
  ? new Pool({ 
      connectionString: process.env.DATABASE_URL,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    })
  : null;

// CRITICAL: Handle idle client errors (e.g. Neon dropping idle connections).
// Without this, an unhandled 'error' event crashes the entire Node.js process.
if (pool) {
  pool.on('error', (err: Error) => {
    const code = (err as any).code;
    // 57P01 = administrator terminating connection (Neon idle timeout) — safe to ignore
    if (code === '57P01' || code === '57P02' || code === '57P03') {
      console.warn('[DB Pool] Idle client terminated by server (Neon timeout) — reconnecting automatically.');
    } else {
      console.error('[DB Pool] Unexpected client error:', err.message);
    }
  });
}

export const db = pool 
  ? drizzle(pool, { schema })
  : null;

// Helper to check if database is available
export function requireDb() {
  if (!db) {
    throw new Error("DATABASE_URL is not configured. Please set the DATABASE_URL environment variable.");
  }
  return db;
}
