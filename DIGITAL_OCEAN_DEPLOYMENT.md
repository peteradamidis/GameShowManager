# Digital Ocean Deployment Guide

This guide walks you through deploying the Contestant Management System to Digital Ocean App Platform.

---

## Prerequisites

- Digital Ocean account with App Platform access
- Your GitHub repository (code must be pushed)
- PostgreSQL database on Digital Ocean
- Database credentials

---

## Step 1: Create PostgreSQL Database on Digital Ocean

1. Go to **Databases** in Digital Ocean dashboard
2. Click **Create Database**
3. Select **PostgreSQL**
4. Configure:
   - Name: `contestant-db` (or your choice)
   - Region: Choose your region
   - Version: 14 or higher
5. Create the database
6. Go to **Connection Details** tab and copy:
   - Connection string (starts with `postgresql://`)
   - Or individual credentials (Host, Port, User, Password, DB)

---

## Step 2: Connect Your GitHub Repository

1. Go to **Apps** in Digital Ocean dashboard
2. Click **Create App**
3. Select **GitHub**
4. Authorize Digital Ocean to access your GitHub
5. Select your repository
6. Choose the branch to deploy (usually `main`)

---

## Step 3: Configure Build and Run Commands

In your app settings:

### Build Command
```bash
npm ci --include=dev && NODE_ENV=production node build.js
```

**How it works:**
- `npm ci --include=dev` - Installs ALL dependencies including devDependencies (required for build tools like autoprefixer, tailwindcss, etc.)
- `NODE_ENV=production` - Sets the environment to production mode
- `node build.js` - Runs the smart build script that:
  - Detects production environment (no REPL_ID and NODE_ENV=production)
  - Uses `vite.config.prod.ts` (without Replit plugins)
  - Builds client with Vite
  - Bundles server with esbuild
  - Outputs to `dist/`

**IMPORTANT:** The `--include=dev` flag is critical because build tools (autoprefixer, postcss, tailwindcss, esbuild) are in devDependencies. Without this flag, Digital Ocean prunes devDependencies before the build runs.

### Run Command
```bash
NODE_ENV=production node dist/index.js
```

### HTTP Port
- Should be automatically detected as `8080`
- If not, set it to `8080`

---

## Step 4: Set Environment Variables

In your app settings, go to **Environment** tab and add these variables:

```
DATABASE_URL=postgresql://[user]:[password]@[host]:[port]/[database]
PGHOST=[your-database-host]
PGPORT=5432
PGUSER=[your-database-user]
PGPASSWORD=[your-database-password]
PGDATABASE=[your-database-name]
SESSION_SECRET=[random-string-minimum-32-chars]
NODE_ENV=production
```

**How to get these values:**
- Open your Digital Ocean database connection details
- Copy the values from the connection string or individual fields

**To generate SESSION_SECRET:**
```bash
# Run locally to generate a random string
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then paste the output as `SESSION_SECRET`

---

## Step 5: Initialize Database Schema

**Critical:** The database schema must be initialized before the app runs.

### Option A: Add Pre-Deploy Task (Recommended)

If Digital Ocean supports pre-deploy tasks:
1. In app settings, look for **Buildpack** or **Pre-Deploy Commands**
2. Add: `npm run db:push`

### Option B: Manual Setup (After First Deployment)

1. After deployment completes, click on your app
2. Go to **Console**
3. Run:
   ```bash
   npm run db:push
   ```

### Option C: SSH and Setup

1. SSH into your app:
   ```bash
   doctl apps get [APP_ID] --format id
   ssh -i ~/.ssh/id_rsa root@[APP_HOSTNAME]
   ```

2. Navigate to app directory and run:
   ```bash
   npm run db:push
   ```

---

## Step 6: Deploy Your App

1. Click **Deploy** button
2. Wait for build to complete (usually 5-10 minutes)
3. Once deployment succeeds, you'll see a live URL

---

## Step 7: Import Your Data (Optional)

If you're migrating from another system:

1. Export your data locally:
   ```bash
   npx tsx scripts/export-data.ts
   ```

2. SSH into the app console (see Step 5 Option C)

3. Copy the export folder to your app

4. Run import:
   ```bash
   npx tsx scripts/import-data.ts ./path-to-export-folder
   ```

5. Restart your app

---

## Troubleshooting

### Build Fails

**Error: "Could not find the build directory"**
- Ensure `npm run build` completes successfully
- Check that `vite build` output includes `dist/public/` folder

**Solution:**
1. Test build locally first
2. Check GitHub repo has all necessary files
3. Re-trigger deployment

### App Won't Start

**Error: "No database host or connection string was set"**
- Missing DATABASE_URL environment variable
- Re-check Step 4 - make sure all env vars are set
- Restart the app after adding variables

**Error: "Could not find the database"**
- Database schema not initialized
- Run: `npm run db:push`
- If that fails, SSH in and check PostgreSQL connection

### Tabs/Content Not Loading

**Problem: Seating chart, forms, or other tabs show no content**

1. Check app logs:
   - Go to **Logs** tab in app settings
   - Look for API errors (500 status codes)

2. Open browser console (F12):
   - Check for network errors
   - Look for messages about missing env vars

3. Most common causes:
   - Missing DATABASE_URL
   - Database schema not initialized (`npm run db:push` not run)
   - Environment variables not set

### API Returns 500 Errors

Check app logs for specific error messages:
- "No database host" → Missing PGHOST, PGUSER, etc.
- "relation does not exist" → Database schema not initialized
- Connection timeout → Database unreachable, check PGHOST/PGPORT

---

## Monitoring

After deployment, regularly check:

1. **App Logs** - Look for errors
2. **Metrics** - CPU, memory, requests
3. **Database Health** - Check Digital Ocean database dashboard

---

## File Structure After Deploy

Your deployed app will have:

```
/app
├── dist/
│   ├── index.js           (compiled server)
│   ├── public/            (built frontend)
│   │   ├── index.html
│   │   ├── assets/
│   │   └── ...
├── uploads/               (contestant photos)
├── storage/               (email assets)
├── node_modules/
└── package.json
```

All uploaded files (photos, branding, etc.) are stored in `uploads/` and `storage/`.

---

## Getting Help

If deployment fails:

1. **Check app logs** - usually shows the specific problem
2. **Check environment variables** - most issues are missing env vars
3. **Run `npm run db:push`** - database schema must be initialized
4. **Review this guide** - verify all steps completed

---

## Key Differences from Local Development

| Aspect | Local | Digital Ocean |
|--------|-------|---------------|
| Port | 5000 | 8080 |
| NODE_ENV | development | production |
| Vite | Active (HMR) | Disabled (static files only) |
| Database | Local or cloud | Must be Digital Ocean PostgreSQL |
| File uploads | `./uploads`, `./storage` | Same directories |
