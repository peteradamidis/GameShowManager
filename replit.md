# TV Game Show Contestant Management System

## Project Overview
An automated system for managing TV game show contestants that imports applicants from Cast It Reach (via Excel), identifies groups, manages availability, and intelligently assigns seats while maintaining demographic balance.

## Features Implemented

### Backend (Complete)
1. **Database Schema**
   - Contestants: name, age, gender, availability status, group membership, email, phone, address, medical info
   - Groups: automatically identified from "Attending With" column
   - Record Days: recording session management with status tracking
   - Seat Assignments: tracks contestant assignments to specific seats
     - **Uniqueness constraints**: one contestant per record day, one contestant per seat
     - Prevents duplicate bookings at database level
     - **Booking workflow fields**: firstNations, rating, location, medicalQuestion, criminalBankruptcy, castingCategory, notes, bookingEmailSent, confirmedRsvp, paperworkSent, paperworkReceived, signedIn, otdNotes, standbyReplacementSwaps

2. **Excel Import**
   - Parses Cast It Reach exports
   - Normalizes column names (handles "Attending With", "Name", "Age", "Gender", "Email", "Phone", "Address", "Medical Info")
   - Automatically identifies groups by matching names in "Attending With" column
   - Creates groups and links contestants
   - Captures additional contact and medical information if present in Excel file

3. **Auto-Assignment Algorithm**
   - Target: 60-70% female demographic balance
   - Keeps groups seated together
   - Studio layout: 7 blocks × 22 seats (154 total)
   - Seat arrangement: A1-A5, B1-B5, C1-C4, D1-D4, E1-E4 per block
   - Search strategy: 6 deterministic + 50 random orderings
   - Error recovery: best-effort cleanup on failure

4. **API Endpoints**
   - POST /api/import - Excel import with group detection
   - GET/POST /api/contestants - Contestant management
   - GET/POST /api/record-days - Record day management
   - PUT /api/record-days/:id/status - Status updates
   - POST /api/auto-assign - Intelligent seat assignment
   - GET/PUT/DELETE /api/seat-assignments - Seat management
     - **POST /api/seat-assignments - Manual seat assignment with duplicate prevention**
       - Validates contestant not already seated in record day
       - Validates seat not already occupied
       - Returns 409 on conflicts with clear error messages
     - **PATCH /api/seat-assignments/:id/workflow - Update booking workflow fields**
       - Updates workflow tracking fields (rating, location, medical, paperwork, sign-in, etc.)
       - Field validation prevents overwriting seat metadata
       - Only allowed workflow fields accepted
     - **DELETE /api/seat-assignments/:id - Remove contestant from record day**
       - Updates contestant status back to 'available'
     - **POST /api/seat-assignments/:id/cancel - Cancel and move to reschedule**
       - Preserves original seat and record day information
       - Updates contestant status to 'available'
   - **POST /api/seat-assignments/swap - Atomic seat swapping with database transactions**
   - **GET /api/canceled-assignments - Get all canceled assignments**
     - Includes contestant and record day details
   - **DELETE /api/canceled-assignments/:id - Remove from reschedule list**
   - **POST /api/availability/send - Generate availability check tokens**
   - **GET /api/availability/token/:token - Fetch contestant context for public form (no auth)**
   - **POST /api/availability/respond/:token - Submit availability responses (no auth)**
   - **GET /api/availability/status - Availability statistics overview**
   - **GET /api/availability/record-day/:recordDayId - Filter contestants by availability**

5. **Atomic Seat Swapping**
   - Database-level transactions using Drizzle ORM
   - Row-level locking (`FOR UPDATE`) prevents concurrent swaps
   - PostgreSQL advisory locks serialize empty-seat moves
   - Three-step swap process with unique temp locations (`TEMP_${sourceId}`)
   - Automatic rollback on any error
   - Guarantees: atomicity, isolation, consistency, durability

6. **Availability Check System**
   - **Database Tables:**
     - availability_tokens: stores unique tokens with expiration (14 days)
     - contestant_availability: join table tracking responses per record day
   - **Token Generation:**
     - Cryptographically strong tokens (64-char hex)
     - One active token per contestant
     - Automatic revocation of old tokens
   - **Public Response Form:**
     - Standalone page at `/availability/respond/:token` (no auth required)
     - Shows contestant info, group members, record days
     - Yes/Maybe/No/Pending response options
     - Optional notes field
     - "Apply to group" feature propagates selections to group members
   - **Admin Management:**
     - Availability page with statistics dashboard
     - Bulk token generation with contestant/record day selection
     - Filter contestants by record day and response value
     - Track sent/responded/pending status
   - **Integration:**
     - Contestants page has built-in availability filtering
     - Filter by record day and response type (yes/maybe/no/pending)
   - **Security:**
     - Token validation (status, expiration checking)
     - Public endpoints rate-limited and monitored
     - Tokens marked as "used" after submission
   - **Email Integration:**
     - Email sending currently stubbed (requires RESEND_API_KEY and FROM_EMAIL secrets)
     - System generates tokens and response URLs ready for email delivery
     - Note: Email integration can be completed later by adding Resend API credentials

### Frontend (Complete)
- Material Design-inspired UI with Inter font
- Dashboard with statistics
- **Contestant table with import and detail view**
  - Click any row to view complete contestant information
  - Detail dialog shows:
    - Basic information (name, age, gender, status, group)
    - Contact information (email, phone, address) with icons
    - Medical information
  - Search and selection functionality
- Record day management cards
- **Interactive drag-and-drop seating chart**
  - Cross-block dragging (all 154 seats in single DnD context)
  - Drag contestant to another seat to swap positions
  - Drag to empty seats to move contestants
  - **Click empty seat to assign any contestant**
    - Shows all contestants not currently seated
    - Derived from latest data (useMemo) - no staleness issues
    - Database-level uniqueness constraints prevent duplicates
  - **Remove and Cancel buttons in hover card**
    - Remove: Deletes seat assignment, makes contestant available again
    - Cancel: Moves to reschedule list with original date preserved
    - Buttons always visible (not gated by data fetch)
  - Optimistic UI updates for instant feedback
  - Single atomic API call per swap/move
  - Automatic UI revert on errors
  - Built with @dnd-kit/core and @dnd-kit/sortable
- **Reschedule page**
  - Shows all canceled contestants with original record day and seat
  - Displays cancellation date and reason
  - "Make Available" button removes from canceled list
  - "Remove" button permanently deletes cancellation record
  - Contestants can be reassigned using Seating Chart or Auto-Assign
- **Booking Master page**
  - Complete booking workflow tracking system
  - Record day selector - switches between different shoot days
  - Auto-populates with contestants assigned via Seating Chart
  - Displays all 154 seats (assigned and empty) for selected record day
  - Inline editing for workflow fields:
    - Location, Rating, Medical Question (Y/N)
    - Criminal/Bankruptcy, Casting Category
    - Notes, OTD Notes, Standby/Replacement/Swaps
  - Checkbox tracking for workflow stages:
    - Booking Email Sent, Confirmed RSVP
    - Paperwork Sent, Paperwork Received
    - Signed In
  - Shows contestant details: name, age, phone, email, attending with, medical info
  - Excel export functionality matching Cast It Reach template format
  - Includes record day metadata in exported file
- Studio layout visualization with 7 blocks

## Studio Layout
- 6 blocks circle the stage (blocks 1-6)
- 1 standing block (block 7)
- Blocks 1-3 on top (rows reversed: A is bottom, E is top)
- Blocks 4-5-6 on bottom (left to right)
- Each block: 22 seats in 5 rows

## Known Limitations

### Auto-Assignment Algorithm
- Uses heuristic search (56 orderings) rather than exhaustive search
- May fail to find solution even when one exists if specific alternating sequences are required
- No formal database transaction support for auto-assignment (uses best-effort cleanup)
- Future improvements: DFS/BFS search, transaction support for auto-assignment

### Drag-and-Drop Implementation
- Requires source seat to have valid assignment ID (won't drag unassigned/mock data)
- Advisory lock hash collisions theoretically possible (but extremely unlikely)
- Frontend depends on backend for all state changes (no offline mode)

## Technology Stack
- Backend: Express.js, TypeScript
- Database: PostgreSQL (Neon) with Drizzle ORM
- Frontend: React, Wouter, TanStack Query
- UI: Shadcn components, Tailwind CSS

## Development Guidelines
- Always use database storage (not in-memory)
- Follow Material Design principles
- Use Inter font family
- Maintain 60-70% female demographic balance
- Keep groups seated together
