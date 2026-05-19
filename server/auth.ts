import { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import { storage } from "./storage";

declare module "express-session" {
  interface SessionData {
    userId: string;
    username: string;
    activeWorkspace: 'dond' | 'celeb';
  }
}

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized - Please log in" });
  }
  next();
}

export function getSessionConfig() {
  const sessionSecret = process.env.SESSION_SECRET || 'dev-secret-change-in-production';

  const PgSession = connectPgSimple(session);

  const store = new PgSession({
    pool: pool as any,
    tableName: 'session',
    createTableIfMissing: true,
    ttl: 7 * 24 * 60 * 60, // 7 days in seconds
    errorLog: (err: unknown) => {
      console.error('[SessionStore] store error:', err);
    },
  });

  return session({
    store,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'lax'
    }
  });
}

export async function createDefaultAdmin(): Promise<void> {
  try {
    const users = await storage.getAllUsers();
    if (users.length === 0) {
      const hashedPassword = await hashPassword("admin");
      await storage.createUser({
        username: "admin",
        password: hashedPassword
      });
      console.log("Default admin user created (username: admin, password: admin)");
      console.log("IMPORTANT: Change this password immediately in production!");
    }
  } catch (error) {
    console.error("Error creating default admin:", error);
  }
}
