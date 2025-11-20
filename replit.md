# TV Game Show Contestant Management System

## Project Overview
An automated system for managing TV game show contestants that imports applicants from Cast It Reach (via Excel), identifies groups, manages availability, and intelligently assigns seats while maintaining demographic balance.

## Features Implemented

### Backend (Complete)
1. **Database Schema**
   - Contestants: name, age, gender, availability status, group membership
   - Groups: automatically identified from "Attending With" column
   - Record Days: recording session management with status tracking
   - Seat Assignments: tracks contestant assignments to specific seats

2. **Excel Import**
   - Parses Cast It Reach exports
   - Normalizes column names (handles "Attending With", "Name", "Age", "Gender")
   - Automatically identifies groups by matching names in "Attending With" column
   - Creates groups and links contestants

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
   - **POST /api/seat-assignments/swap - Atomic seat swapping with database transactions**

5. **Atomic Seat Swapping**
   - Database-level transactions using Drizzle ORM
   - Row-level locking (`FOR UPDATE`) prevents concurrent swaps
   - PostgreSQL advisory locks serialize empty-seat moves
   - Three-step swap process with unique temp locations (`TEMP_${sourceId}`)
   - Automatic rollback on any error
   - Guarantees: atomicity, isolation, consistency, durability

### Frontend (Complete)
- Material Design-inspired UI with Inter font
- Dashboard with statistics
- Contestant table with import functionality
- Record day management cards
- **Interactive drag-and-drop seating chart**
  - Cross-block dragging (all 154 seats in single DnD context)
  - Drag contestant to another seat to swap positions
  - Drag to empty seats to move contestants
  - Optimistic UI updates for instant feedback
  - Single atomic API call per swap/move
  - Automatic UI revert on errors
  - Built with @dnd-kit/core and @dnd-kit/sortable
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
