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

### Feature Specifications
- **Contestant Management:** Comprehensive contestant profiles, search, selection, and filtering capabilities (by status, gender, rating, location, record day, availability response).
- **Record Day Management:** Tools for managing recording sessions and their statuses.
- **Seating Chart:** Interactive drag-and-drop interface for assigning, swapping, and removing contestants from seats. Includes functionality to assign any available contestant to an empty seat.
- **Reschedule Page:** Manages canceled assignments, allowing them to be made available or permanently removed.
- **Booking Master Page:** A complete workflow tracking system for bookings, including inline editing of workflow fields, checkbox tracking for stages (e.g., `bookingEmailSent`, `confirmedRsvp`), and bulk email sending for booking confirmations.
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
- **Gmail Integration:** (Temporary) Currently used for sending availability check emails via the Google Gmail connector. Will be replaced with Outlook once approval is received.
- **Outlook Integration:** (Planned) To replace Gmail for availability check and booking confirmation emails once user approval is obtained.
- **Google Sheets Integration:** (Active) Syncs booking master data to Google Sheets for external reporting.
    - API Endpoints:
        - `GET /api/google-sheets/config` - Get current configuration
        - `POST /api/google-sheets/config` - Set spreadsheet ID (body: `{ spreadsheetId: "..." }`)
        - `POST /api/google-sheets/sync` - Sync all booking data to the configured spreadsheet
        - `GET /api/google-sheets/data` - Read data from the configured spreadsheet
    - To use: Create a Google Sheet, copy the spreadsheet ID from the URL (the long string between /d/ and /edit), then call the config endpoint.
    - Data synced: Contestant name, ID, rating, gender, age, location, record day, seat, workflow status, RSVP status, and notes.
- **Booking Master to Server File Sync:** (Planned) Two-way sync between booking master and Excel file on user's server. User prefers local server solution over SharePoint for now. Awaiting server endpoint details (URL, format, authentication method).