// For cloud databases with self-signed certificates (Digital Ocean, etc.)
// This MUST be set before any database modules are imported
if (process.env.NODE_ENV === 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDatabase } from "./db-init";
import { warmupDatabaseConnection } from "./storage";

// Log startup info immediately for debugging
console.log('=== Server Starting ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT || '(not set, will use default)');
console.log('DATABASE_URL set:', !!process.env.DATABASE_URL);

const app = express();

// Health check endpoint for Digital Ocean / load balancers
// This must respond immediately before any async operations
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Startup status endpoint for debugging
app.get('/startup-status', (_req, res) => {
  res.status(200).json({
    nodeEnv: process.env.NODE_ENV,
    hasDbUrl: !!process.env.DATABASE_URL,
    hasSessionSecret: !!process.env.SESSION_SECRET,
    port: process.env.PORT || '(default)',
  });
});

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    console.log('Step 1: Initializing database...');
    // Initialize database schema on startup
    await initializeDatabase();
    console.log('Step 1: Database initialized');

    console.log('Step 2: Registering routes...');
    const server = await registerRoutes(app);
    console.log('Step 2: Routes registered');

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      res.status(status).json({ message });
      throw err;
    });

    // importantly only setup vite in development and after
    // setting up all the other routes so the catch-all route
    // doesn't interfere with the other routes
    console.log('Step 3: Setting up static serving...');
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }
    console.log('Step 3: Static serving ready');

    // ALWAYS serve the app on the port specified in the environment variable PORT
    // Digital Ocean sets PORT=8080, local development defaults to 5000
    // this serves both the API and the client.
    const isProduction = process.env.NODE_ENV === 'production';
    const defaultPort = isProduction ? '8080' : '5000';
    const port = parseInt(process.env.PORT || defaultPort, 10);
    
    console.log(`Starting server on port ${port}...`);
    
    server.listen({
      port,
      host: "0.0.0.0",
      reusePort: true,
    }, () => {
      log(`serving on port ${port}`);
      
      // Warm up database connection in background after server is ready
      console.log('Step 5: Warming up database connection...');
      warmupDatabaseConnection().then(success => {
        if (success) {
          console.log('Step 5: Database warmed up and ready');
        } else {
          console.warn('Step 5: Database warmup failed - first requests may be slow');
        }
      });
    });
  } catch (error) {
    console.error('=== FATAL STARTUP ERROR ===');
    console.error(error);
    process.exit(1);
  }
})();
