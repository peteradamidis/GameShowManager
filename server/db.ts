import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

// Configure WebSocket for server-side Neon connection
neonConfig.webSocketConstructor = ws as any;

// Log database configuration status (don't throw - let app start for health checks)
if (!process.env.DATABASE_URL) {
  console.error("⚠ DATABASE_URL is not set. Database operations will fail.");
  console.error("  Set DATABASE_URL environment variable to your PostgreSQL connection string.");
}

// Create pool and db - will be null if DATABASE_URL is not set
export const pool = process.env.DATABASE_URL 
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

export const db = pool 
  ? drizzle({ client: pool, schema })
  : null;

// Helper to check if database is available
export function requireDb() {
  if (!db) {
    throw new Error("DATABASE_URL is not configured. Please set the DATABASE_URL environment variable.");
  }
  return db;
}
