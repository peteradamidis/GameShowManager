# TV Game Show Contestant Management System

## Overview
This project is an automated system designed to manage TV game show contestants. It streamlines the process from applicant import to intelligent seat assignment, focusing on demographic balance and group cohesion. The system imports contestant data, identifies groups, manages availability, and assigns seats while ensuring a target female demographic balance of 60-70%. It aims to automate complex logistics for game show productions, reducing manual effort and improving efficiency.

## User Preferences
I prefer detailed explanations.
Do not make changes to the folder `Z`.
Do not make changes to the file `Y`.

## System Architecture

### UI/UX Decisions
- **Design System:** Material Design-inspired UI.
- **Typography:** Uses the Inter font family.
- **Components:** Utilizes Shadcn components and Tailwind CSS for styling.
- **Visualizations:** Studio layout visualization with 7 blocks.
- **Interactive Elements:** Drag-and-drop seating chart with optimistic UI updates.

### Technical Implementations
- **Backend:** Developed with Express.js and TypeScript.
- **Database:** PostgreSQL (Neon) managed with Drizzle ORM.
- **Frontend:** Built using React, Wouter for routing, and TanStack Query for data management.
- **Authentication:** Local username/password authentication for offline deployment.
    - **Session-based:** Uses express-session with server-side session storage.
    - **Password hashing:** bcrypt with 12 salt rounds.
    - **Default admin:** On first startup, creates admin user (username: `admin`, password: `admin`).
    - **Protected routes:** All /api routes require authentication except public endpoints.
    - **Public endpoints:** /api/auth/*, /api/availability-response, /api/booking-confirmation, /api/standby-confirmation.
    - **Environment variables:**
        - `SESSION_SECRET`: Required for production (generates sessions securely).
        - Set `NODE_ENV=production` for production deployment.
    - **API Endpoints:**
        - `POST /api/auth/login` - Login with username/password.
        - `POST /api/auth/logout` - Logout and destroy session.
        - `GET /api/auth/check` - Check if user is authenticated.
        - `POST /api/auth/change-password` - Change password (requires current password).
- **Data Import:** Parses Cast It Reach Excel exports, normalizes data, and automatically identifies contestant groups.
- **Auto-Assignment Algorithm:**
    - Aims for 60-70% female demographic balance.
    - Ensures groups are seated together.
    - Considers a studio layout of 7 blocks with 22 seats each (154 total).
    - Employs a heuristic search strategy (6 deterministic + 50 random orderings) with best-effort error recovery.
- **Seat Management:**
    - Supports manual seat assignment with uniqueness constraints (one contestant per record day, one contestant per seat).
    - Implements atomic seat swapping using database transactions, row-level locking, and PostgreSQL advisory locks for concurrency control.
    - Group seat assignment functionality for 2-4 contestants in consecutive seats within a block.
- **RX Day Mode (Seating Chart Lock):**
    - Lock/unlock feature for seating charts on recording days.
    - When locked, an amber "RX Day Mode" badge appears in the seating chart header.
    - Swapping two contestants while locked tracks their original positions for audit purposes.
    - Database stores `lockedAt` timestamp on record days and `originalBlockNumber`, `originalSeatLabel`, `swappedAt` on seat assignments.
    - API Endpoints:
        - `POST /api/record-days/:id/lock` - Lock record day for RX Day Mode
        - `POST /api/record-days/:id/unlock` - Unlock record day
        - `POST /api/seat-assignments/swap-tracked` - Swap two contestants with original position tracking
- **Availability Check System:**
    - Generates cryptographically strong, expiring tokens for contestants to respond to availability requests via a public form.
    - Allows group responses and provides an admin interface for bulk token generation and status tracking.
- **Booking Confirmation System:**
    - Generates unique, expiring tokens for contestants to confirm or decline bookings via a public form.
    - Automatically updates workflow statuses and handles declines by moving assignments to a reschedule list.
    - **Send Booking Emails:** Bulk email feature in Booking Master - select contestants and send booking confirmation emails with unique links.
    - **Public Confirmation Form:** Contestants receive emails with links to confirm/decline attendance, add dietary requirements, and ask questions.
- **Contestant Photo Management:** Supports uploading and deleting contestant photos, storing them on disk.
- **Reschedule Status Tracking:**
    - Contestants moved to reschedule (from standby) show "Reschedule" status badge in the contestant tab.
    - Yellow-colored badge distinguishes reschedule status from other statuses (Pending, Available, Assigned, Invited).
- **Automatic Backup System:**
    - Runs every 1 hour, creates both JSON and Excel backups simultaneously
    - JSON backup: `storage/backups/automatic-backup.json`
    - Excel backup: `storage/backups/automatic-backup.xlsx` (with separate worksheets for each data type)
    - Backs up ALL data: record days, contestants, groups, seat assignments, standbys, block types, canceled assignments
    - Includes error tracking with consecutive failure detection
    - Automatically stops after 5 consecutive failures to prevent log saturation
    - Manual backup available from Settings page
    - Download JSON or Excel backup files from Settings page
- **Contestant Deletion:**
    - Delete individual contestants from the Contestants tab
    - Confirmation dialog required before deletion
    - Cascades deletion to related seat assignments and standbys
- **Record Day Self-Service:**
    - Create, edit, and delete record days from the Record Days page
    - Delete operations protected by safety checks (prevents deletion if seat assignments exist)
    - Confirmation dialog required before deletion
- **Winners Page (Winning Money Tracking):**
    - Displays all contestants with recorded winning money from locked RX days.
    - Separated into two tabs: Players and Case Holders.
    - Each entry shows contestant info (photo, name, age, gender, rating), record day, block/seat, RX number, case number, and winning amount.
    - Winning money can be set/edited via modal on the Seating Chart page (when RX day is locked).
    - Database fields on `seat_assignments`: `rxNumber` (text), `caseNumber` (text), `winningMoneyRole` ('player' or 'case_holder'), `winningMoneyAmount` (integer).
    - **API Route Note:** The `/api/seat-assignments/with-winning-money` route MUST be registered BEFORE `/api/seat-assignments/:recordDayId` to prevent Express from capturing "with-winning-money" as a recordDayId parameter.
- **Medical Info Indicator (Seating Chart):**
    - Contestants with data in their `medicalInfo` field display a red medical plus icon on their seat card.
    - Icon appears next to the contestant's name on the seating chart.
    - Hovering over the icon shows a tooltip with the label "Medical Info" and the actual medical information text.
    - Makes it easy to identify contestants with medical needs at a glance.

### Feature Specifications
- **Contestant Management:** Comprehensive contestant profiles, search, selection, and filtering capabilities (by status, gender, rating, location, record day, availability response).
- **Record Day Management:** Tools for managing recording sessions and their statuses.
- **Seating Chart:** Interactive drag-and-drop interface for assigning, swapping, and removing contestants from seats. Includes functionality to assign any available contestant to an empty seat.
- **Reschedule Page:** Manages canceled assignments, allowing them to be made available or permanently removed.
- **Booking Master Page:** A complete workflow tracking system for bookings, including inline editing of workflow fields, checkbox tracking for stages (e.g., `bookingEmailSent`, `confirmedRsvp`), and bulk email sending for booking confirmations.
    - **Real-Time Synchronization:** WebSocket-based live updates across multiple devices/tabs.
        - Changes made on one device instantly appear on other devices viewing the same record day.
        - Supports collaborative workflow tracking with multiple team members.
        - Automatic reconnection on connection loss with proper record day subscription.
        - WebSocket endpoint: `/ws` with session cookie validation.
    - **Responses Panel:** Toggle panel showing all booking confirmation responses for the selected record day.
        - Filter by status: All, Pending, Confirmed, Declined
        - Shows contestant photo, seat, status, attending with info, dietary requirements/questions
        - Reply button to send follow-up emails to contestants with questions
        - Amber icon for dietary-related notes, blue icon for general questions
- **API Endpoints:** A comprehensive set of RESTful APIs for all system functionalities, including import, contestant management, record day management, seat assignments (manual, auto, group, swap), availability, booking confirmations, and photo management.

## External Dependencies
- **PostgreSQL:** Primary database for all system data.
- **Neon:** Cloud provider for PostgreSQL.
- **Cast It Reach:** Source of contestant data via Excel exports.
- **SMTP/Outlook Email:** Email sending via SMTP (Outlook/Exchange compatible). Configured in Settings page.
    - Supports any SMTP server including Office 365 (smtp.office365.com) and on-premises Exchange
    - Configuration stored in database for easy runtime changes
    - Alternative: Set environment variables (SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_EMAIL) for deployment security
    - All SMTP configuration endpoints require authentication
    - API Endpoints:
        - `GET /api/smtp/config` - Get current SMTP configuration (excludes password)
        - `POST /api/smtp/config` - Save SMTP configuration
        - `POST /api/smtp/test` - Test SMTP connection
        - `POST /api/smtp/test-email` - Send a test email
- **Google Sheets Integration:** (Active) Syncs booking master data to Google Sheets for external reporting.
    - API Endpoints:
        - `GET /api/google-sheets/config` - Get current configuration
        - `POST /api/google-sheets/config` - Set spreadsheet ID (body: `{ spreadsheetId: "..." }`)
        - `POST /api/google-sheets/sync` - Sync all booking data to the configured spreadsheet
        - `GET /api/google-sheets/data` - Read data from the configured spreadsheet
    - To use: Create a Google Sheet, copy the spreadsheet ID from the URL (the long string between /d/ and /edit), then call the config endpoint.
    - Data synced: Contestant name, ID, rating, gender, age, location, record day, seat, workflow status, RSVP status, and notes.
- **Booking Master to Server File Sync:** (Planned) Two-way sync between booking master and Excel file on user's server. User prefers local server solution over SharePoint for now. Awaiting server endpoint details (URL, format, authentication method).

## Backup System

### Automatic Backups
- Scheduler runs every hour after server startup
- First backup runs 1 minute after startup
- JSON backups are saved to `storage/backups/automatic-backup.json`
- Excel backups are saved to `storage/backups/automatic-backup.xlsx`
- Each backup overwrites the previous one

### Excel Backup Format
The Excel backup contains separate worksheets for:
- **Record Days:** ID, Date, RxNumber, Status, Notes
- **Contestants:** ID, Name, Age, Gender, Email, Phone, Location, Rating, Status, AttendingWith, GroupID, MedicalInfo, MobilityNotes
- **Seat Assignments:** ID, RecordDayID, ContestantID, Block, Seat, BookingEmailSent, ConfirmedRSVP, Notes
- **Standbys:** ID, RecordDayID, ContestantID, Status, Notes
- **Groups:** ID, ReferenceNumber
- **Block Types:** ID, RecordDayID, BlockNumber, BlockType
- **Canceled Assignments:** ID, RecordDayID, ContestantID, Reason, CanceledAt

### API Endpoints
- `GET /api/backup/status` - Returns scheduler status, last backup time, error info, consecutive failures count
- `GET /api/backup/summary` - Returns counts of all data (record days, contestants, etc.)
- `POST /api/backup/manual` - Triggers an immediate manual backup (creates both JSON and Excel)
- `GET /api/backup/download` - Downloads the JSON backup file
- `GET /api/backup/download-excel` - Downloads the Excel backup file
- `GET /api/backup/export` - Direct JSON export of all data (legacy endpoint)

### Settings Page
The Settings tab includes a "Data Backup" section with:
- Auto-backup status indicator (running/stopped)
- Last backup timestamp
- Error display if backups are failing
- Summary of data counts
- "Run Backup Now" button for manual backups
- "Download JSON" button to save JSON copy locally
- "Download Excel" button to save Excel copy locally

**Full documentation:** See `docs/backup-system.md` for complete backup system details including configuration options, API endpoints, and troubleshooting.