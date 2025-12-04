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

## 3. Replit-Specific Features (Require Modification for Local)

These features use Replit's infrastructure and would need replacement for local use:

### Gmail Integration (`server/gmail.ts`)
- Currently uses Replit Connectors OAuth (`REPLIT_CONNECTORS_HOSTNAME`, `REPL_IDENTITY`)
- **Local Alternative**: Set up Google OAuth 2.0 credentials via Google Cloud Console and modify the authentication flow to use standard OAuth

### Google Sheets Integration (`server/google-sheets.ts`)
- Same Replit Connectors OAuth system
- **Local Alternative**: Set up Google OAuth 2.0 with a service account or user credentials

### Object Storage (`server/objectStorage.ts`) - **WORKS LOCALLY**
- Automatically detects environment and uses appropriate storage:
  - **On Replit**: Uses `@replit/object-storage` package
  - **Locally**: Falls back to local file system storage in the `LOCAL_STORAGE_DIR` directory (defaults to `./storage`)
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

Ensure these folders exist for file uploads:

```
├── uploads/
│   ├── branding/     # Banner images, logos (e.g., dond_banner.png)
│   └── photos/       # Contestant photos
```

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

## 10. Summary: Required Modifications for Local Use

1. **Gmail/Sheets OAuth**: Replace Replit OAuth with standard Google OAuth 2.0 credentials
2. **Object Storage**: Works automatically! Falls back to local file system when not on Replit
3. **PostgreSQL**: Set up a local PostgreSQL database
4. **Environment Variables**: Create `.env` file with all required variables

---

## 11. Database Schema

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

## 12. Additional Notes

- The application uses TypeScript ES Modules (`"type": "module"` in package.json)
- Path aliases are configured: `@/` for client source, `@shared/` for shared code
- The Vite dev server handles both frontend HMR and proxies API requests to Express
