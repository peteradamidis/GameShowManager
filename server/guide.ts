import PDFDocument from "pdfkit";
import type { Response } from "express";

const COLORS = {
  primary: "#1a365d",
  secondary: "#2d3748",
  accent: "#d69e2e",
  text: "#2d3748",
  lightText: "#718096",
  heading: "#1a365d",
  subheading: "#2b6cb0",
  border: "#e2e8f0",
  bg: "#f7fafc",
  white: "#ffffff",
};

function addCoverPage(doc: PDFKit.PDFDocument) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLORS.primary);
  
  doc.fill(COLORS.accent)
    .fontSize(14)
    .font("Helvetica")
    .text("PRODUCTION GUIDE", 0, 180, { align: "center" });

  doc.fill(COLORS.white)
    .fontSize(38)
    .font("Helvetica-Bold")
    .text("Deal or No Deal", 0, 210, { align: "center" });

  doc.fontSize(28)
    .text("Contestant Management", 0, 260, { align: "center" })
    .text("System", 0, 295, { align: "center" });

  doc.moveTo(200, 340).lineTo(412, 340).lineWidth(2).stroke(COLORS.accent);

  doc.fill(COLORS.white)
    .fontSize(13)
    .font("Helvetica")
    .text("Complete User Guide & Reference Manual", 0, 360, { align: "center" });

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  doc.fill("#a0aec0")
    .fontSize(11)
    .text(`Version 1.0 | ${dateStr}`, 0, 700, { align: "center" });
}

function addHeader(doc: PDFKit.PDFDocument, title: string, level: number = 1) {
  if (level === 1) {
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 80).fill(COLORS.primary);
    doc.fill(COLORS.white)
      .fontSize(24)
      .font("Helvetica-Bold")
      .text(title, 50, 30, { width: doc.page.width - 100 });
    doc.y = 100;
  } else if (level === 2) {
    if (doc.y > 650) doc.addPage();
    doc.moveDown(0.8);
    doc.fill(COLORS.subheading)
      .fontSize(16)
      .font("Helvetica-Bold")
      .text(title, 50, undefined, { width: doc.page.width - 100 });
    doc.moveTo(50, doc.y + 2).lineTo(250, doc.y + 2).lineWidth(1).stroke(COLORS.accent);
    doc.moveDown(0.4);
  } else {
    if (doc.y > 670) doc.addPage();
    doc.moveDown(0.5);
    doc.fill(COLORS.secondary)
      .fontSize(13)
      .font("Helvetica-Bold")
      .text(title, 50, undefined, { width: doc.page.width - 100 });
    doc.moveDown(0.3);
  }
}

function addParagraph(doc: PDFKit.PDFDocument, text: string) {
  if (doc.y > 680) doc.addPage();
  doc.fill(COLORS.text)
    .fontSize(10.5)
    .font("Helvetica")
    .text(text, 50, undefined, { width: doc.page.width - 100, lineGap: 3 });
  doc.moveDown(0.4);
}

function addBulletList(doc: PDFKit.PDFDocument, items: string[]) {
  items.forEach((item) => {
    if (doc.y > 690) doc.addPage();
    doc.fill(COLORS.accent).fontSize(10.5).font("Helvetica").text("\u2022  ", 55, undefined, { continued: true });
    doc.fill(COLORS.text).font("Helvetica").text(item, { width: doc.page.width - 120, lineGap: 2 });
    doc.moveDown(0.15);
  });
  doc.moveDown(0.3);
}

function addNumberedList(doc: PDFKit.PDFDocument, items: string[]) {
  items.forEach((item, idx) => {
    if (doc.y > 690) doc.addPage();
    doc.fill(COLORS.subheading).fontSize(10.5).font("Helvetica-Bold").text(`${idx + 1}.  `, 55, undefined, { continued: true });
    doc.fill(COLORS.text).font("Helvetica").text(item, { width: doc.page.width - 120, lineGap: 2 });
    doc.moveDown(0.15);
  });
  doc.moveDown(0.3);
}

function addTip(doc: PDFKit.PDFDocument, text: string) {
  if (doc.y > 660) doc.addPage();
  const startY = doc.y;
  doc.rect(50, startY, doc.page.width - 100, 0).fill(COLORS.bg);
  doc.fill(COLORS.subheading).fontSize(10).font("Helvetica-Bold").text("TIP: ", 60, startY + 8, { continued: true });
  doc.fill(COLORS.text).font("Helvetica").text(text, { width: doc.page.width - 130, lineGap: 2 });
  const endY = doc.y + 8;
  doc.rect(50, startY, doc.page.width - 100, endY - startY).lineWidth(0.5).stroke(COLORS.border);
  doc.rect(50, startY, 3, endY - startY).fill(COLORS.subheading);
  doc.y = endY + 5;
}

function addTableOfContents(doc: PDFKit.PDFDocument) {
  doc.addPage();
  doc.fill(COLORS.primary).fontSize(24).font("Helvetica-Bold").text("Table of Contents", 50, 50);
  doc.moveTo(50, 80).lineTo(250, 80).lineWidth(2).stroke(COLORS.accent);
  doc.y = 100;

  const sections = [
    "1. Getting Started",
    "2. Dashboard",
    "3. Noticeboard",
    "4. Contestants",
    "5. Availability Management",
    "6. Record Days",
    "7. Seating Chart",
    "8. Booking Master",
    "9. Players (Casting Cards & RX Planning)",
    "10. Standbys",
    "11. Booking Tracker",
    "12. Paperwork Tracker",
    "13. Reschedule",
    "14. Winners",
    "15. Attendance Issues",
    "16. Post Record",
    "17. History",
    "18. Settings",
    "19. Backup & Data Management",
    "20. Tips & Best Practices",
  ];

  sections.forEach((s) => {
    doc.fill(COLORS.text).fontSize(12).font("Helvetica").text(s, 60, undefined, { width: doc.page.width - 120 });
    doc.moveDown(0.35);
  });
}

export function generateGuide(res: Response) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    info: {
      Title: "Deal or No Deal - Contestant Management System Guide",
      Author: "Production Team",
      Subject: "User Guide",
    },
    autoFirstPage: false,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="DOND-System-Guide.pdf"');
  doc.pipe(res);

  doc.addPage();
  addCoverPage(doc);
  addTableOfContents(doc);

  // ───────────────── 1. Getting Started ─────────────────
  addHeader(doc, "1. Getting Started");
  addParagraph(doc, "The Deal or No Deal Contestant Management System is designed to streamline the entire contestant lifecycle for the show's production. From importing contestant data through to managing seating arrangements, sending booking confirmations, and tracking winners, this system automates and organises the complex logistics of running a game show production.");
  
  addHeader(doc, "Logging In", 2);
  addParagraph(doc, "Navigate to the system URL in your web browser. You will be presented with a login screen. Enter your username and password to access the system. Your account will be created by a system administrator.");
  addTip(doc, "If you forget your password, contact your system administrator to reset it.");

  addHeader(doc, "Navigation", 2);
  addParagraph(doc, "The system uses a sidebar menu on the left side of the screen for navigation. Click on any menu item to navigate to that section. The sidebar can be collapsed by clicking the toggle button at the top of the page to give you more screen space.");

  addHeader(doc, "System Overview", 2);
  addParagraph(doc, "The system is organised into the following main sections:");
  addBulletList(doc, [
    "Dashboard - Overview of upcoming record days and key statistics",
    "Noticeboard - Crew announcements and important notices",
    "Contestants - Central database of all contestant information",
    "Availability - Send and track availability checks",
    "Record Days - Create and manage recording sessions",
    "Seating Chart - Interactive seat assignment for each record day",
    "Booking Master - Comprehensive booking workflow management",
    "Players - Casting cards, RX planning, and podium stories",
    "Standbys - Manage standby contestants for each record day",
    "Booking Tracker - Track booking confirmation responses",
    "Paperwork Tracker - Track contestant paperwork and email distribution",
    "Reschedule - Manage rescheduled and cancelled contestants",
    "Winners - Track contestants who have won money",
    "Attendance Issues - Record no-shows and early leavers",
    "Post Record - Post-recording session data management",
    "History - Complete audit trail of all system changes",
    "Settings - System configuration, user management, and customisation",
  ]);

  // ───────────────── 2. Dashboard ─────────────────
  addHeader(doc, "2. Dashboard");
  addParagraph(doc, "The Dashboard is your home screen and provides a quick overview of the production status at a glance.");

  addHeader(doc, "Key Features", 2);
  addBulletList(doc, [
    "Upcoming Record Days - Shows the next scheduled recording sessions with date, RX number, and seat fill status",
    "Today's Birthdays - Displays any contestants with birthdays today so you can acknowledge them",
    "48-Hour Reminder Widget - Highlights record days within 48 hours that may need reminder emails sent to contestants",
    "Quick Statistics - Overview of total contestants, record days, and booking status",
    "Download Guide - Access this guide document directly from the dashboard",
  ]);

  addHeader(doc, "48-Hour Reminder Emails", 2);
  addParagraph(doc, "When a record day is within 48 hours, the dashboard will show a reminder widget. You can click to send timed reminder emails to all booked contestants and standbys for that record day. This helps ensure contestants remember their upcoming appearance.");

  // ───────────────── 3. Noticeboard ─────────────────
  addHeader(doc, "3. Noticeboard");
  addParagraph(doc, "The Noticeboard serves as an internal communication tool for the production crew.");

  addHeader(doc, "Key Features", 2);
  addBulletList(doc, [
    "Create text-based announcements for the crew",
    "Upload images and videos to share with the team",
    "Posts appear in reverse chronological order (newest first)",
    "All crew members can view noticeboard posts after logging in",
    "Supports video uploads for visual briefings and updates",
  ]);

  // ───────────────── 4. Contestants ─────────────────
  addHeader(doc, "4. Contestants");
  addParagraph(doc, "The Contestants page is the central hub for managing all contestant data. This is where you import, view, search, filter, and edit contestant profiles.");

  addHeader(doc, "Importing Contestants", 2);
  addParagraph(doc, "The system is designed to import contestant data from Cast It Reach Excel exports. To import:");
  addNumberedList(doc, [
    "Click the 'Import from Excel' button at the top of the page",
    "Select your Cast It Reach export file (.xlsx format)",
    "The system will automatically parse the data, normalise names, and identify contestant groups",
    "Review the import summary showing new contestants and any updates",
    "Confirm the import to add the data to the system",
  ]);
  addTip(doc, "The import process uses intelligent group identification to automatically detect contestants who are attending together based on the 'Attending With' field in the Cast It Reach export.");

  addHeader(doc, "Contestant Profiles", 2);
  addParagraph(doc, "Each contestant has a detailed profile containing:");
  addBulletList(doc, [
    "Name, email, phone number, and demographic information",
    "Age, gender, and location details",
    "Attending With information (for group identification)",
    "Rating (1-5 stars) for production assessment",
    "Booking status and availability history",
    "Photo (uploadable or imported from Cast It Reach Gallery)",
    "Mobility and access notes for accessibility requirements",
    "Distance from studio (for logistics planning)",
    "Notes and comments from the production team",
  ]);

  addHeader(doc, "Search & Filtering", 2);
  addParagraph(doc, "The contestants page offers powerful search and filtering capabilities:");
  addBulletList(doc, [
    "Text search - Search by name, email, phone, or location",
    "Status filter - Filter by booking status (Available, Booked, etc.)",
    "Gender filter - Filter by gender for demographic balance planning",
    "Rating filter - Multi-select rating filter (select multiple star ratings to show)",
    "Group filter - View contestants by their group associations",
  ]);

  addHeader(doc, "Editing Contestants", 2);
  addParagraph(doc, "Click on any contestant to view and edit their details. Changes are saved automatically. You can update any field including name, contact information, ratings, and notes.");

  addHeader(doc, "Rating System", 2);
  addParagraph(doc, "Contestants can be rated from 1 to 5 stars. This rating is used across the system and can be changed from multiple locations including the contestants page, the seating chart, and the booking master. Rating changes propagate throughout the entire system instantly.");

  addHeader(doc, "Photo Management", 2);
  addParagraph(doc, "You can manage contestant photos in several ways:");
  addBulletList(doc, [
    "Upload individual photos directly to a contestant's profile",
    "Bulk import photos from a Cast It Reach Gallery export (ZIP file)",
    "Delete or replace existing photos",
    "Photos appear on casting cards, seating charts, and throughout the system",
  ]);

  // ───────────────── 5. Availability Management ─────────────────
  addHeader(doc, "5. Availability Management");
  addParagraph(doc, "The Availability Management page allows you to send availability checks to contestants and track their responses.");

  addHeader(doc, "How It Works", 2);
  addNumberedList(doc, [
    "Select a record day you want to check availability for",
    "Choose the contestants you want to send availability checks to",
    "The system generates unique, expiring tokens for each contestant",
    "Contestants receive an email with a link to confirm or decline their availability",
    "Responses are tracked in real-time and displayed on the page",
  ]);

  addHeader(doc, "Response Tracking", 2);
  addParagraph(doc, "The system tracks all availability responses with timestamps. You can see at a glance who has responded, who is available, who has declined, and who hasn't responded yet.");
  addTip(doc, "Availability tokens expire after a set period. If a contestant hasn't responded in time, you may need to send a fresh availability check.");

  // ───────────────── 6. Record Days ─────────────────
  addHeader(doc, "6. Record Days");
  addParagraph(doc, "Record Days represent scheduled recording sessions. Each record day has its own seating arrangement, booking workflow, and tracking.");

  addHeader(doc, "Creating a Record Day", 2);
  addNumberedList(doc, [
    "Click 'Create Record Day' on the Record Days page",
    "Enter the date, RX number (episode reference), and any notes",
    "The system will create a fresh seating chart with 7 blocks and 154 seats",
    "You can then begin assigning contestants to seats",
  ]);

  addHeader(doc, "Record Day Status", 2);
  addParagraph(doc, "Record days progress through the following statuses:");
  addBulletList(doc, [
    "Upcoming - Future record days awaiting contestant assignment",
    "Active - Currently being managed (availability checks, booking)",
    "RX Day - The actual recording day with locked seating and standby management",
    "Completed - Recording finished, post-production data available",
  ]);

  addHeader(doc, "RX Day Mode", 2);
  addParagraph(doc, "On the actual recording day, the system enters 'RX Day Mode' which provides:");
  addBulletList(doc, [
    "Locked seating chart to prevent accidental changes",
    "Standby Seating System for managing last-minute replacements",
    "Attendance Issue Tracking for recording no-shows and early leavers",
    "Quick Move Mode for rapid seat changes when needed",
    "Real-time updates across all connected users via WebSocket",
  ]);

  addHeader(doc, "Producer & AP Assignment", 2);
  addParagraph(doc, "Each record day can have a Producer and Assistant Producer assigned. This is set on the record day details and helps track who is responsible for each session.");

  // ───────────────── 7. Seating Chart ─────────────────
  addHeader(doc, "7. Seating Chart");
  addParagraph(doc, "The Seating Chart is an interactive visual interface for managing where contestants sit during recording. It displays the studio layout with 7 blocks containing a total of 154 seats.");

  addHeader(doc, "Layout Overview", 2);
  addParagraph(doc, "The studio is divided into 7 blocks, each containing multiple seats. The visual layout represents the actual physical studio arrangement, making it easy to plan seating based on camera angles and production requirements.");

  addHeader(doc, "Assigning Contestants", 2);
  addParagraph(doc, "There are several ways to assign contestants to seats:");
  addBulletList(doc, [
    "Manual Assignment - Click on an empty seat and select a contestant from the dropdown",
    "Group Assignment - Assign a group of contestants together, keeping them in adjacent seats",
    "Auto-Assignment - The system can automatically fill seats using a smart algorithm that balances demographics (targeting 60-70% female), keeps groups together, and optimises placement across all 7 blocks",
    "Drag and Drop - Drag contestants between seats to rearrange them",
  ]);

  addHeader(doc, "Seat Swapping", 2);
  addParagraph(doc, "You can swap two contestants between seats by dragging one onto another. The system uses atomic swapping with database-level concurrency control (advisory locks) to prevent conflicts when multiple users are editing simultaneously.");

  addHeader(doc, "Quick Move Mode", 2);
  addParagraph(doc, "Quick Move Mode allows rapid seat changes. When activated, simply click a contestant and then click the destination seat to move them instantly. This is especially useful during RX Day when speed is essential.");

  addHeader(doc, "Podium Visualiser Mode", 2);
  addParagraph(doc, "The Podium Visualiser provides a photo-only view of the seating chart, showing contestant photos in their assigned positions. This gives a quick visual overview of who is sitting where.");

  addHeader(doc, "Block Notes", 2);
  addParagraph(doc, "Each seating block has an editable notes field where producers can add annotations. These notes are specific to each block and each record day, and are saved automatically.");

  addHeader(doc, "Visual Indicators", 2);
  addParagraph(doc, "The seating chart displays several visual indicators:");
  addBulletList(doc, [
    "Colour-coded borders for contestant ratings",
    "Mobility/Access icons for contestants with special requirements",
    "Gender indicators for demographic balance at a glance",
    "Group indicators showing which contestants are attending together",
    "Standby badges for standby contestants during RX Day",
  ]);

  addHeader(doc, "Rating Changes from Seating Chart", 2);
  addParagraph(doc, "You can change a contestant's rating directly from the seating chart without navigating away. Right-click or use the context menu on a seated contestant to adjust their rating. Changes propagate throughout the entire system immediately.");

  // ───────────────── 8. Booking Master ─────────────────
  addHeader(doc, "8. Booking Master");
  addParagraph(doc, "The Booking Master is a comprehensive workflow tracking page that provides a complete view of all contestants assigned to a record day and their booking status.");

  addHeader(doc, "Key Features", 2);
  addBulletList(doc, [
    "Real-time synchronisation via WebSocket - changes appear instantly for all users",
    "Inline editing - click on any field to edit it directly in the table",
    "Response Panel - quick-access panel for managing booking responses",
    "Bulk email functionality for sending booking confirmations",
    "Google Sheets integration for syncing data externally",
    "Filter and sort by status, block, name, and more",
    "OTD (On The Day) notes for production-specific information",
    "Attending With override for last-minute group changes",
  ]);

  addHeader(doc, "Booking Workflow", 2);
  addNumberedList(doc, [
    "Contestants are assigned to seats on the seating chart",
    "They automatically appear on the Booking Master for that record day",
    "Send booking confirmation emails (individually or in bulk)",
    "Track responses (confirmed, declined, no response)",
    "Manage any rebookings or changes as needed",
    "On RX Day, the system tracks attendance and any issues",
  ]);

  addHeader(doc, "Sending Booking Confirmations", 2);
  addParagraph(doc, "The Booking Master allows you to send booking confirmation emails to contestants. Each email contains a unique token link that the contestant can use to confirm or decline their booking. You can send these individually or in bulk.");

  addHeader(doc, "Rebooking History", 2);
  addParagraph(doc, "The system maintains a full audit trail of all rebookings. When a contestant is rebooked from one record day to another, the change is recorded with timestamps, providing complete traceability.");

  // ───────────────── 9. Players ─────────────────
  addHeader(doc, "9. Players (Casting Cards & RX Planning)");
  addParagraph(doc, "The Players page is a multi-tabbed workspace for casting card management, RX planning, and podium stories.");

  addHeader(doc, "Casting Cards Tab", 2);
  addParagraph(doc, "Casting cards are visual profiles of contestants used during production. The system provides a full-featured editor for creating and customising casting cards.");
  
  addHeader(doc, "Creating Casting Cards", 3);
  addBulletList(doc, [
    "Casting cards are automatically created when you select a contestant",
    "The card pulls in the contestant's photo, name, age, location, and other details",
    "You can import casting cards from PowerPoint (.pptx) files for bulk creation",
    "Each card is fully editable with rich text formatting",
  ]);

  addHeader(doc, "Editing Casting Cards", 3);
  addParagraph(doc, "The casting card editor supports:");
  addBulletList(doc, [
    "Full-screen editing mode for detailed work",
    "Rich text formatting (bold, italic, underline, strikethrough) for body text",
    "Font size adjustment for header fields (name, occupation, tagline) using toolbar buttons or field-specific arrows",
    "Font size adjustment for body text with precise control",
    "Text colour formatting for body text",
    "Photo positioning - zoom, pan, and rotate the contestant's photo within the card",
    "Tagline toggle - show or hide the tagline field",
    "Sponsor category field for production categorisation",
    "Auto-populated companion information from group data",
    "Manual companion editing for additional attendees",
  ]);

  addHeader(doc, "Casting Card Version History", 3);
  addParagraph(doc, "The system automatically creates time-throttled backups of casting cards. You can view and restore previous versions if needed, providing a safety net for accidental changes.");

  addHeader(doc, "Printing Casting Cards", 3);
  addParagraph(doc, "Casting cards can be printed directly from the system. The print layout is optimised for A4 paper and includes all card details formatted for production use.");

  addHeader(doc, "RX Planning Tab", 2);
  addParagraph(doc, "The RX Planning tab provides a visual drag-and-drop tool for pre-planning episode lineups.");
  addBulletList(doc, [
    "Drag casting cards into episode slots to plan lineups",
    "Visual preview of casting cards within the planning view",
    "Plan multiple episodes at once",
    "Planning data is stored locally for flexible, non-destructive planning",
  ]);

  addHeader(doc, "Podium Stories Tab", 2);
  addParagraph(doc, "The Podium Stories tab provides a block-by-block view for tracking contestant stories during recording.");
  addBulletList(doc, [
    "Block-by-block view showing contestants in their seating positions",
    "Direct tagging of contestants with story notes",
    "Editable story notes for each contestant",
    "Case number assignment for tracking",
    "Booking status indicators showing each contestant's current status",
  ]);

  // ───────────────── 10. Standbys ─────────────────
  addHeader(doc, "10. Standbys");
  addParagraph(doc, "The Standbys page manages standby contestants for each record day. Standbys are contestants who are on call in case a booked contestant doesn't show up.");

  addHeader(doc, "Key Features", 2);
  addBulletList(doc, [
    "Assign contestants as standbys for specific record days",
    "Track standby confirmation status",
    "During RX Day, quickly assign standbys to empty seats",
    "Returning Standbys System - tracks standbys who attended a record day for fast-tracked rebooking in future sessions",
    "Standby-specific booking confirmation emails",
  ]);

  addHeader(doc, "Returning Standbys", 2);
  addParagraph(doc, "When a standby contestant attends a record day but doesn't get to play, the system tracks this. These 'returning standbys' can be prioritised for future bookings as they've already gone through the preparation process.");

  // ───────────────── 11. Booking Tracker ─────────────────
  addHeader(doc, "11. Booking Tracker");
  addParagraph(doc, "The Booking Tracker (also called Booking Responses) provides a focused view of booking confirmation responses across all record days.");

  addHeader(doc, "Features", 2);
  addBulletList(doc, [
    "See all pending, confirmed, and declined bookings in one view",
    "Track response timestamps",
    "Identify contestants who haven't responded",
    "Quick actions for follow-up communication",
  ]);

  // ───────────────── 12. Paperwork Tracker ─────────────────
  addHeader(doc, "12. Paperwork Tracker");
  addParagraph(doc, "The Paperwork Tracker manages the distribution of contestant paperwork and emails.");

  addHeader(doc, "Features", 2);
  addBulletList(doc, [
    "Track when contestant emails are copied for external sending",
    "Email copy tracking for paperwork distribution",
    "Status tracking for paperwork completion",
    "Integration with the booking workflow",
  ]);

  // ───────────────── 13. Reschedule ─────────────────
  addHeader(doc, "13. Reschedule");
  addParagraph(doc, "The Reschedule page manages contestants who have been removed from their assigned record day and need to be rebooked.");

  addHeader(doc, "Key Features", 2);
  addBulletList(doc, [
    "Email column for quick contact information access",
    "Search functionality to find specific rescheduled contestants",
    "Duplicate prevention to avoid double-booking",
    "Reschedule count tracking - see how many times a contestant has been rescheduled",
    "Decline history showing past decline responses",
    "Rebooked status tracking to see if a rescheduled contestant has been placed again",
  ]);

  // ───────────────── 14. Winners ─────────────────
  addHeader(doc, "14. Winners");
  addParagraph(doc, "The Winners page tracks contestants who have won money on the show.");

  addHeader(doc, "Features", 2);
  addBulletList(doc, [
    "Record winning amounts for contestants",
    "View all winners across all record days",
    "Excel export of winner data for production accounting",
    "Sort and filter winners by date, amount, or name",
  ]);

  // ───────────────── 15. Attendance Issues ─────────────────
  addHeader(doc, "15. Attendance Issues");
  addParagraph(doc, "The Attendance Issues page provides a dedicated audit page for tracking no-shows and early leavers.");

  addHeader(doc, "How It Works", 2);
  addBulletList(doc, [
    "Record no-shows when a booked contestant doesn't appear",
    "Record early leavers when a contestant leaves before recording finishes",
    "Lifetime counters track how many times each contestant has had attendance issues",
    "Full audit trail with timestamps and notes",
    "This data can inform future booking decisions",
  ]);

  // ───────────────── 16. Post Record ─────────────────
  addHeader(doc, "16. Post Record");
  addParagraph(doc, "The Post Record page manages data that needs to be captured after a recording session is complete.");

  addHeader(doc, "Features", 2);
  addBulletList(doc, [
    "Post Record tab with editable fields for each contestant",
    "Buffered saves with visual indicators for overridden values",
    "Document-level editing for production notes",
    "Track post-recording actions and follow-ups",
  ]);

  // ───────────────── 17. History ─────────────────
  addHeader(doc, "17. History");
  addParagraph(doc, "The History page provides a consolidated audit trail for all significant system events.");

  addHeader(doc, "What's Tracked", 2);
  addBulletList(doc, [
    "Rebooking history - every time a contestant is moved between record days",
    "Attendance issues - all no-shows and early leavers",
    "Standby attendance - which standbys attended which record days",
    "Timestamps and user information for complete accountability",
  ]);

  // ───────────────── 18. Settings ─────────────────
  addHeader(doc, "18. Settings");
  addParagraph(doc, "The Settings page provides system configuration options.");

  addHeader(doc, "User Management", 2);
  addBulletList(doc, [
    "Create new user accounts for crew members",
    "View all existing user accounts",
    "Delete user accounts when no longer needed",
    "All users have full system access",
  ]);

  addHeader(doc, "Animated Welcome Message", 2);
  addParagraph(doc, "You can configure a full-screen animated welcome message that appears once per login session. This can be used for daily briefings, important announcements, or motivational messages. The message supports advanced styling options including colours and formatting.");

  addHeader(doc, "Announcement Popup", 2);
  addParagraph(doc, "Configure a popup announcement that appears on the dashboard. This is useful for time-sensitive information that all crew members need to see.");

  addHeader(doc, "Email Configuration", 2);
  addParagraph(doc, "The system supports configurable SMTP settings for sending emails. It works with Office 365, Exchange, and other SMTP providers. Email settings are configured in the system environment.");

  addHeader(doc, "Download Guide", 2);
  addParagraph(doc, "Download this comprehensive system guide as a PDF document from the Settings page.");

  // ───────────────── 19. Backup ─────────────────
  addHeader(doc, "19. Backup & Data Management");
  addParagraph(doc, "The system includes robust backup capabilities to protect your production data.");

  addHeader(doc, "Automatic Backups", 2);
  addBulletList(doc, [
    "The system automatically creates backups every hour",
    "Backups include all system data: contestants, record days, assignments, and more",
    "Backups are saved in both JSON and Excel (.xlsx) format",
    "Backup files are stored in the system's storage directory",
  ]);

  addHeader(doc, "Manual Backup", 2);
  addParagraph(doc, "You can trigger a manual backup at any time from the Backup page. This creates an immediate snapshot of all system data.");

  addHeader(doc, "Data Import & Export", 2);
  addBulletList(doc, [
    "Import contestants from Cast It Reach Excel exports",
    "Import photos from Cast It Reach Gallery exports",
    "Import casting cards from PowerPoint files",
    "Export winner data to Excel",
    "Export seating charts and booking data",
    "Google Sheets integration for live data syncing",
  ]);

  // ───────────────── 20. Tips ─────────────────
  addHeader(doc, "20. Tips & Best Practices");

  addHeader(doc, "General Workflow", 2);
  addNumberedList(doc, [
    "Import contestant data from Cast It Reach at the start of each production cycle",
    "Create record days for all planned recording sessions",
    "Send availability checks to contestants well in advance",
    "Use the auto-assignment feature for initial seating, then fine-tune manually",
    "Send booking confirmations through the Booking Master",
    "Use the 48-hour reminder feature to ensure contestants remember their booking",
    "On RX Day, use Quick Move Mode and the Standby system for rapid changes",
    "Record attendance issues promptly for accurate tracking",
    "Complete Post Record data entry after each session",
  ]);

  addHeader(doc, "Keyboard Shortcuts (Casting Cards)", 2);
  addBulletList(doc, [
    "Ctrl+B - Bold text (body text)",
    "Ctrl+I - Italic text (body text)",
    "Ctrl+U - Underline text (body text)",
  ]);

  addHeader(doc, "Multi-User Usage", 2);
  addParagraph(doc, "The system supports multiple simultaneous users. Key points to remember:");
  addBulletList(doc, [
    "The Booking Master uses WebSocket for real-time synchronisation between users",
    "Seat swapping uses database-level locking to prevent conflicts",
    "Changes made by one user will appear for other users automatically in most areas",
    "If you notice any data discrepancy, refresh the page to get the latest state",
  ]);

  addHeader(doc, "Data Safety", 2);
  addBulletList(doc, [
    "The system auto-saves your work continuously",
    "Automatic hourly backups protect against data loss",
    "Casting card version history lets you restore previous versions",
    "Always verify changes after bulk imports to ensure data accuracy",
  ]);

  // ───────────────── Footer on all pages ─────────────────
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    if (i === 0) continue;
    doc.fill(COLORS.lightText)
      .fontSize(8)
      .font("Helvetica")
      .text(
        `Deal or No Deal - System Guide | Page ${i + 1}`,
        50,
        doc.page.height - 35,
        { width: doc.page.width - 100, align: "center" }
      );
  }

  doc.end();
}
