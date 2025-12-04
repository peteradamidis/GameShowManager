import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

// Log database configuration status (don't throw - let app start for health checks)
if (!process.env.DATABASE_URL) {
  console.error("⚠ DATABASE_URL is not set. Database operations will fail.");
  console.error("  Set DATABASE_URL environment variable to your PostgreSQL connection string.");
}

// Create pool with SSL support for cloud databases (Digital Ocean, Neon, etc.)
export const pool = process.env.DATABASE_URL 
  ? new Pool({ 
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('sslmode=require') || 
           process.env.DATABASE_URL.includes('.db.ondigitalocean.com') ||
           process.env.DATABASE_URL.includes('.neon.tech')
        ? { rejectUnauthorized: false }
        : undefined,
    })
  : null;

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
