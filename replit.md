# TV Game Show Contestant Management System

## Overview
This project is an automated system for managing TV game show contestants, from applicant import to intelligent seat assignment. Its primary purpose is to streamline contestant logistics for game show productions by automating data handling, group identification, availability management, and seat assignment, ensuring demographic balance (60-70% female target). This system aims to reduce manual effort and improve efficiency in managing complex contestant-related tasks.

## User Preferences
I prefer detailed explanations.
Do not make changes to the folder `Z`.
Do not make changes to the file `Y`.

## System Architecture

### UI/UX Decisions
- **Design System:** Material Design-inspired UI utilizing Shadcn components and Tailwind CSS.
- **Typography:** Inter font family.
- **Visualizations:** Studio layout visualization with 7 blocks.
- **Interactive Elements:** Drag-and-drop seating chart with optimistic UI updates.

### Technical Implementations
- **Backend:** Express.js with TypeScript.
- **Frontend:** React, Wouter for routing, TanStack Query for data management.
- **Database:** PostgreSQL (Neon) managed with Drizzle ORM.
- **Authentication:** Local username/password authentication (bcrypt hashing), session-based. Default admin user created on first startup.
- **Data Import:** Parses Cast It Reach Excel exports, normalizes data, and identifies contestant groups.
- **Auto-Assignment Algorithm:** Balances demographics (60-70% female), keeps groups together, and uses a heuristic search for optimal seating across 7 blocks (154 seats).
- **Seat Management:** Supports manual and group assignments, atomic seat swapping with concurrency control (PostgreSQL advisory locks).
- **RX Day Mode (Seating Chart Lock):** Locks seating charts on recording days, tracks original positions during swaps for auditing.
- **Availability Check System:** Generates expiring tokens for contestants to respond to availability requests, supporting group responses and admin tracking.
- **Booking Confirmation System:** Generates expiring tokens for booking confirmations/declines, updates workflow statuses, and manages rescheduling. Includes bulk email functionality and a public confirmation form.
- **Contestant Photo Management:** Upload and deletion of contestant photos, stored on disk.
- **Reschedule Status Tracking:** Visually identifies contestants moved to a reschedule list.
- **Automatic Backup System:** Hourly JSON and Excel backups of all system data, with error tracking and manual backup options.
- **Contestant & Record Day Management:** Features for deleting contestants (cascades to related data) and managing record days with safety checks.
- **Winners Page (Winning Money Tracking):** Displays contestants with recorded winning money, filterable by type, with an Excel export feature. Includes specific fields for tracking prize details.
- **Mobility/Access Notes Indicator:** Visually highlights contestants with mobility notes on the seating chart.
- **Booking Master Page:** A comprehensive workflow tracking system with inline editing, checkbox tracking, and real-time WebSocket-based synchronization for collaborative use. Includes a responses panel to view booking confirmation details and facilitate follow-ups.

### Feature Specifications
- **Contestant Management:** Profiles, search, filtering by status, gender, rating, etc.
- **Record Day Management:** Tools for managing recording sessions.
- **Seating Chart:** Interactive interface for assigning, swapping, and removing contestants.
- **Reschedule Page:** Manages canceled assignments.
- **API Endpoints:** Comprehensive RESTful APIs for all functionalities.

## External Dependencies
- **PostgreSQL:** Primary database.
- **Neon:** Cloud provider for PostgreSQL.
- **Cast It Reach:** Source for contestant data via Excel exports.
- **SMTP/Outlook Email:** Configurable SMTP for sending emails (supports Office 365, Exchange).
- **Google Sheets Integration:** Syncs booking master data to Google Sheets for external reporting.
- **Booking Master to Server File Sync:** (Planned) Two-way sync with local server Excel files.