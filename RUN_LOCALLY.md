# Running This Application Locally

This document outlines everything needed to run this TV Game Show Contestant Management System on your local computer.

---

## 1. System Prerequisites

- **Node.js**: Version 20+ recommended (uses ES Modules)
- **npm**: Comes with Node.js
- **PostgreSQL**: Version 14+ (Neon-compatible)

---

## 2. Environment Variables Required

Create a `.env` file in the project root with the following variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string (e.g., `postgresql://user:pass@host:5432/dbname`) | Yes |
| `PGHOST` | PostgreSQL host | Yes |
| `PGPORT` | PostgreSQL port (usually 5432) | Yes |
| `PGUSER` | PostgreSQL username | Yes |
| `PGPASSWORD` | PostgreSQL password | Yes |
| `PGDATABASE` | PostgreSQL database name | Yes |
| `SESSION_SECRET` | Random string for session encryption | Yes |
| `PORT` | Server port (defaults to 5000) | No |
| `NODE_ENV` | Set to `development` or `production` | No |
| `PRIVATE_OBJECT_DIR` | Directory for uploaded assets (currently `/EmailAssets`) | No |
| `LOCAL_STORAGE_DIR` | Directory for local file storage (defaults to `./storage`) | No |

### Example `.env` file:

```env
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/contestant_db
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=yourpassword
PGDATABASE=contestant_db
SESSION_SECRET=your-random-secret-string-here
PORT=5000
NODE_ENV=development
LOCAL_STORAGE_DIR=./storage
```

---

## 3. Feature Availability (Local vs Replit)

The application has been designed to work locally with graceful degradation. Here's what works where:

### Features That Work Everywhere (No Setup Required)
- **Contestant Management** - Import, view, edit, search contestants
- **Record Day Management** - Create and manage recording days
- **Seating Chart** - Manual seat assignments (drag & drop)
- **Auto-Assignment Algorithm** - Automatic seat assignment with demographic balancing
- **Group Management** - Manage contestant groups
- **Photo Upload** - Upload contestant photos
- **Email Asset Upload** - Upload banners and PDF attachments
- **Booking Confirmation Forms** - Public forms for contestants to confirm/decline
- **Object Storage** - Uses local file system (`./storage` directory)

### Features Requiring Google Integration
These features require either Replit Connectors (on Replit) or local OAuth setup:

| Feature | Without Integration |
|---------|---------------------|
| Send Booking Emails | Shows "Integration Disabled" error |
| Send Availability Emails | Shows "Integration Disabled" error |
| Poll Gmail Inbox | Shows "Integration Disabled" error |
| Google Sheets Sync | Shows "Integration Disabled" error |

**Note**: The app will NOT crash when these features are unavailable. It gracefully returns a 503 error with a helpful message.

### Checking Integration Status
You can check integration availability via the API:
```
GET /api/system/integrations
```
Returns:
```json
{
  "gmail": { "available": true/false, "message": "..." },
  "googleSheets": { "available": true/false, "message": "..." },
  "allAvailable": true/false
}
```

### Object Storage (`server/objectStorage.ts`) - **WORKS EVERYWHERE**
- Uses local file system storage in the `LOCAL_STORAGE_DIR` directory (defaults to `./storage`)
- Works identically on Replit and locally - no Replit-specific dependencies
- No modification needed - works out of the box!

---

## 4. Install Dependencies

```bash
npm install
```

---

## 5. Database Setup

1. Create a PostgreSQL database locally
2. Set the `DATABASE_URL` environment variable
3. Push the database schema:

```bash
npm run db:push
```

---

## 6. Run Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server (frontend + backend on port 5000) |
| `npm run build` | Build for production |
| `npm run start` | Run production build |
| `npm run check` | TypeScript type checking |
| `npm run db:push` | Push schema changes to database |

---

## 7. Folder Structure

The following folders are used for file storage:

```
├── uploads/
│   ├── branding/     # Banner images, logos (e.g., dond_banner.png)
│   └── photos/       # Contestant photos
├── storage/          # Created automatically by object storage
│   └── uploads/      # Email assets and uploaded files
```

Note: The `storage/` directory is created automatically when files are uploaded through the application.

---

## 8. Key Dependencies

### Backend
- **Express.js** - Web server
- **Drizzle ORM** - Database ORM
- **@neondatabase/serverless** - PostgreSQL driver (works with standard PostgreSQL too)
- **googleapis** - Gmail & Google Sheets API
- **multer** - File upload handling
- **express-session** - Session management

### Frontend
- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **TailwindCSS** - Styling
- **Shadcn UI** - Component library
- **TanStack Query** - Data fetching and caching
- **Wouter** - Client-side routing

### Other
- **TypeScript** - Type safety throughout
- **ws** - WebSocket support
- **xlsx** - Excel file parsing for contestant imports

---

## 9. Port Configuration

The application runs on port **5000** by default. Both the API and frontend are served together from this single port.

To change the port, set the `PORT` environment variable.

---

## 10. Setting Up Local Google OAuth (Optional)

To enable Gmail and Google Sheets features locally, you need to set up Google OAuth 2.0:

### Step 1: Create Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Gmail API and Google Sheets API

### Step 2: Configure OAuth Consent Screen
1. Go to "APIs & Services" > "OAuth consent screen"
2. Choose "External" user type
3. Fill in app name and contact details
4. Add scopes: `gmail.send`, `gmail.readonly`, `spreadsheets`

### Step 3: Create OAuth Credentials
1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Choose "Web application"
4. Add authorized redirect URIs (e.g., `http://localhost:5000/auth/callback`)
5. Download the JSON credentials

### Step 4: Get Refresh Token
Use the OAuth Playground or a script to get a refresh token with your credentials.

### Step 5: Add Environment Variables
```env
GMAIL_CLIENT_ID=your-client-id
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REFRESH_TOKEN=your-refresh-token
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REFRESH_TOKEN=your-refresh-token
```

### Step 6: Modify Code (Future Enhancement)
The code in `server/gmail.ts` and `server/google-sheets.ts` would need modification to check for these environment variables and use standard OAuth instead of Replit Connectors. The `isGmailAvailable()` and `isGoogleSheetsAvailable()` functions have placeholder comments for this.

---

## 11. Summary: Running Locally

| Component | Status |
|-----------|--------|
| Core Application | Works fully |
| Contestant Management | Works fully |
| Seating Chart | Works fully |
| File Uploads | Works fully (local storage) |
| Booking Forms | Works fully |
| Send Emails | Requires Google OAuth setup |
| Google Sheets Sync | Requires Google OAuth setup |

**Quick Start (No Google Integration):**
1. Clone repo to your machine
2. Set up PostgreSQL database
3. Create `.env` file with database credentials
4. Run `npm install`
5. Run `npm run db:push`
6. Run `npm run dev`

The app will work for all core features. Email and Sheets features will show helpful error messages.

---

## 12. Database Schema

The database schema is defined in `shared/schema.ts` and includes tables for:

- `contestants` - Contestant profiles and information
- `groups` - Group management for contestants attending together
- `recordDays` - Recording day scheduling
- `seatAssignments` - Seat assignments with booking workflow fields
- `canceledAssignments` - Tracking canceled/rescheduled contestants
- `availabilityTokens` - Tokens for availability check responses
- `contestantAvailability` - Contestant availability for specific record days
- `bookingConfirmationTokens` - Tokens for booking confirmations
- `bookingConfirmationResponses` - Responses to booking confirmations
- `standbys` - Standby contestant management
- `systemConfig` - System configuration and email templates
- `contestantMessages` - Message history with contestants

---

## 13. Additional Notes

- The application uses TypeScript ES Modules (`"type": "module"` in package.json)
- Path aliases are configured: `@/` for client source, `@shared/` for shared code
- The Vite dev server handles both frontend HMR and proxies API requests to Express
