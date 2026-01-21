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
- **Contestant Photo Management:** Upload and deletion of contestant photos, stored on disk. Includes Gallery PDF Import feature to bulk import photos from Cast It Reach Gallery exports - extracts images and matches them to contestants by name.
- **Reschedule Status Tracking:** Visually identifies contestants moved to a reschedule list.
- **Automatic Backup System:** Hourly JSON and Excel backups of all system data, with error tracking and manual backup options.
- **Contestant & Record Day Management:** Features for deleting contestants (cascades to related data) and managing record days with safety checks.
- **Winners Page (Winning Money Tracking):** Displays contestants with recorded winning money, filterable by type, with an Excel export feature. Includes specific fields for tracking prize details.
- **Mobility/Access Notes Indicator:** Visually highlights contestants with mobility notes on the seating chart.
- **Booking Master Page:** A comprehensive workflow tracking system with inline editing, checkbox tracking, and real-time WebSocket-based synchronization for collaborative use. Includes a responses panel to view booking confirmation details and facilitate follow-ups.
- **Standby Seating System:** Allows drag-and-drop assignment of standbys to any empty seats on the seating chart. Only works in RX Mode (locked day). The Standbys panel appears next to Block 7 with amber styling when the day is locked. Standbys have priority ordering (1 = first in line) with up/down arrow buttons for reordering. Lower priority numbers appear first in the list.
- **Rebooking History Tracking:** Full audit trail of contestant rebookings with atomic transaction support using PostgreSQL advisory locks. Tracks from/to record days, block/seat positions, optional reason, timestamp, and user. Displayed in Booking Responses page with collapsible sections.
- **Improved Group Linking Algorithm:** Uses multi-attribute disambiguation to correctly link contestants with identical names. The algorithm prioritizes reciprocal mentions (both parties list each other), then uses phone prefix matching (same household), suburb/location matching, and age proximity as secondary signals. When multiple candidates share a name and confidence is low, the system logs the ambiguity and defers to manual linking instead of guessing incorrectly.
- **Manual Group Linking:** When automatic group detection fails (contestants with different surnames, typos in "Attending With" data, etc.), producers can manually link 2+ contestants into a group via the Contestants page. Select multiple ungrouped contestants to see the purple "Link Together" button, or select a grouped contestant to see the orange "Unlink from Group" button. Groups auto-delete when reduced to less than 2 members.
- **Attendance Issue Tracking (No-Shows & Early Leavers):** When a day is locked (RX Day Mode), hovering over occupied seats reveals "No-Show" and "Early Leaver" buttons. Marking a contestant with either issue removes them from their seat, increments their lifetime counter (noShowCount or earlyLeaverCount), and creates an audit record. The dedicated Attendance Issues page displays all recorded incidents with filtering by type and contestant name search, showing cumulative counts per contestant.
- **Temporary Contestant Creation:** When booking seats, a "New Contestant" button in the assign dialog allows on-the-fly creation of placeholder contestants who haven't been imported from Cast It Reach yet. These temporary contestants are marked with `isTemporary: true` in the database and can be updated later after proper audition. The form captures name (required), gender (required), age, phone, email, and notes.
- **Podium Visualiser Mode:** A camera icon toggle in the seating chart toolbar activates a photo-only view showing contestant photos (or initials) with first names, hiding all stats and labels for a clean visual representation of the audience podium.
- **Returning Standbys System:** Tracks standbys who attended a record day for fast-tracked rebooking. The Standbys panel includes two tabs: "Standbys" (current standbys with checkboxes to mark attendance when day is locked) and "Returners" (showing returning standbys with their attendance history including block number, PB/NPB type, and confirmation status). When standbys are marked as attended, their status is updated to 'returning_standby' and attendance history records are created in the standbyAttendanceHistory table.
- **Seat-Level Notes and Attending With Override:** Enables tracking changes after invitations are sent. The seating chart hover card displays editable OTD notes (with debounced autosave) that sync with the Booking Master OTD Notes column via WebSocket. Producers can also override the "Attending With" value at the assignment level when guests change - overrides are displayed with a purple "UPDATED" badge on both the seating chart and Booking Master page while preserving the original contestant data.
- **Email Copy Tracking for Paperwork:** Tracks when contestant emails are copied for external sending (e.g., via Adobe Sign website). When "Copy Visible Emails" is clicked in the Paperwork Tracker, assignments are marked with an `emailsCopiedAt` timestamp. Copied-but-unsent assignments display an amber "Copied" badge. A "New Only" filter option shows only confirmations that haven't been copied yet, helping production distinguish between already-processed and new confirmations.
- **Post Record Document-Level Editing:** The Post Record tab has a single "Edit" button in the header that toggles edit mode for the entire document. When in edit mode, all text/number/date/select fields become editable, while checkboxes remain immediately actionable for workflow completion tracking. Changes are buffered locally until "Done" is clicked, then all modifications are saved at once. Override values (Name, Phone, Email, Contestant Type, RX Day, Prize Wheel) are displayed in purple to indicate they differ from source data. The TX section fields (TX EP Number, TX EP Date) are also editable with proper date format handling.
- **48-Hour Reminder Email System:** Dashboard widget that shows record days within 48 hours with separate buttons to send reminder emails to contestants and standbys. Emails match the established Deal or No Deal aesthetic with banner, gold accents, and booking details. Tracks when reminders were sent (contestantReminderSentAt, standbyReminderSentAt on record days). Contestant reminders go to confirmed bookings; standby reminders include a yellow "STANDBY" notice. System prevents accidental resends by showing checkmark when already sent.
- **Standby Movement Notes Display:** When adding notes to standbys through the seating chart, notes now appear on the standby hover card and copy to the Booking Master NOTES column.
- **Enhanced Reschedule Tab:** Added email column and search capability to filter by name, attending with, and email address.

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