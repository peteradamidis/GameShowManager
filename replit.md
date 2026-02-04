# TV Game Show Contestant Management System

## Overview
This project is an automated system for managing TV game show contestants, designed to streamline contestant logistics for game show productions. It automates data handling, group identification, availability management, and intelligent seat assignment, with a focus on demographic balance (60-70% female target). The system aims to significantly reduce manual effort, improve efficiency in managing complex contestant-related tasks, and enhance the overall contestant experience for game show productions.

## User Preferences
I prefer detailed explanations.
Do not make changes to the folder `Z`.
Do not make changes to the file `Y`.

## System Architecture

### UI/UX Decisions
- **Design System:** Material Design-inspired UI using Shadcn components and Tailwind CSS.
- **Typography:** Inter font family.
- **Visualizations:** Studio layout visualization with 7 blocks, Podium Visualiser mode for photo-only view.
- **Interactive Elements:** Drag-and-drop seating chart with optimistic updates, Quick Move Mode for rapid seat changes.

### Technical Implementations
- **Backend:** Express.js with TypeScript.
- **Frontend:** React, Wouter for routing, TanStack Query for data management.
- **Database:** PostgreSQL (Neon) with Drizzle ORM.
- **Authentication:** Local username/password authentication (bcrypt hashing), session-based.
- **Data Import:** Parses Cast It Reach Excel exports, normalizes data, and identifies contestant groups with an improved multi-attribute disambiguation algorithm.
- **Auto-Assignment Algorithm:** Balances demographics (60-70% female), keeps groups together, and uses a heuristic search for optimal seating across 7 blocks (154 seats).
- **Seat Management:** Supports manual and group assignments, atomic seat swapping with concurrency control (PostgreSQL advisory locks), and standby assignment.
- **RX Day Mode:** Locks seating charts on recording days, enables Standby Seating System, Attendance Issue Tracking (No-Shows & Early Leavers), and Quick Move Mode.
- **Availability & Booking Confirmation:** Generates expiring tokens for availability responses and booking confirmations/declines, including bulk email functionality.
- **Contestant Photo Management:** Upload, deletion, and bulk import from Cast It Reach Gallery exports.
- **Automatic Backup System:** Hourly JSON and Excel backups of all system data.
- **Winners Page:** Tracks and displays contestants with winning money, with Excel export.
- **Mobility/Access Notes Indicator:** Visual highlights on the seating chart.
- **Booking Master Page:** Comprehensive workflow tracking with real-time WebSocket-based synchronization, inline editing, and response panel.
- **Rebooking History Tracking:** Full audit trail of contestant rebookings with atomic transaction support.
- **Attendance Issue Tracking:** Records no-shows and early leavers, updates lifetime counters, and provides a dedicated audit page.
- **Temporary Contestant Creation:** On-the-fly creation of placeholder contestants during seat booking.
- **Returning Standbys System:** Tracks standbys who attended a record day for fast-tracked rebooking.
- **Seat-Level Notes and Attending With Override:** Editable OTD notes and "Attending With" overrides on the seating chart, synced with Booking Master.
- **Email Copy Tracking for Paperwork:** Tracks when contestant emails are copied for external sending.
- **Post Record Document-Level Editing:** Editable fields in the Post Record tab with buffered saves and visual indicators for overridden values.
- **48-Hour Reminder Email System:** Dashboard widget for sending timed reminder emails to contestants and standbys.
- **Enhanced Reschedule Tab:** Includes email column, search, duplicate prevention, reschedule count, decline history, and rebooked status tracking.
- **History Page:** Consolidated audit trail for rebookings, attendance issues, and standby attendance.
- **RX Planning Tab:** Visual drag-and-drop tool for pre-planning episode lineups (localStorage only).
- **Noticeboard Video Support:** Supports video uploads for crew noticeboard.
- **Multi-User Management:** User account creation, viewing, and deletion with full system access.
- **Block Notes:** Editable text fields for producer annotations per seating block, per record day.
- **Producer & AP Assignment:** Assign Producer and Assistant Producer per record day.
- **Casting Card Version History:** Time-throttled backup/recovery system for casting cards.
- **Animated Welcome Message:** Configurable full-screen animated message per login session.

### Feature Specifications
- **Contestant Management:** Profiles, search, filtering by status, gender, rating, etc.
- **Record Day Management:** Tools for managing recording sessions.
- **Seating Chart:** Interactive interface for assigning, swapping, and removing contestants.
- **Reschedule Page:** Manages canceled assignments and rebooking.
- **API Endpoints:** Comprehensive RESTful APIs for all functionalities.

## External Dependencies
- **PostgreSQL:** Primary database.
- **Neon:** Cloud provider for PostgreSQL.
- **Cast It Reach:** Source for contestant data via Excel exports.
- **SMTP/Outlook Email:** Configurable SMTP for sending emails (supports Office 365, Exchange).
- **Google Sheets Integration:** Syncs booking master data to Google Sheets.