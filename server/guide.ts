import PDFDocument from "pdfkit";
import type { Response } from "express";
import path from "path";
import fs from "fs";

const ASSETS_DIR = path.join(process.cwd(), "server", "guide-assets");

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
  tipBg: "#ebf8ff",
  tipBorder: "#3182ce",
  warningBg: "#fffbeb",
  warningBorder: "#d69e2e",
  noteBg: "#f0fff4",
  noteBorder: "#38a169",
  keyboardBg: "#edf2f7",
};

function addCoverPage(doc: PDFKit.PDFDocument) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLORS.primary);

  doc.rect(0, 0, doc.page.width, 6).fill(COLORS.accent);

  doc.fill(COLORS.accent)
    .fontSize(13)
    .font("Helvetica")
    .text("PRODUCTION GUIDE", 0, 200, { align: "center" });

  doc.fill(COLORS.white)
    .fontSize(40)
    .font("Helvetica-Bold")
    .text("Deal or No Deal", 0, 225, { align: "center" });

  doc.fontSize(30)
    .text("Contestant Management", 0, 275, { align: "center" })
    .text("System", 0, 312, { align: "center" });

  doc.moveTo(180, 360).lineTo(432, 360).lineWidth(2).stroke(COLORS.accent);

  doc.fill(COLORS.white)
    .fontSize(13)
    .font("Helvetica")
    .text("Complete User Guide & Reference Manual", 0, 380, { align: "center" });

  doc.fill("#a0aec0")
    .fontSize(11)
    .font("Helvetica")
    .text("Covers all features including Contestant Management, Seating Charts,", 0, 430, { align: "center" })
    .text("Booking Workflows, Casting Cards, RX Day Operations, and more.", 0, 445, { align: "center" });

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  doc.fill("#a0aec0")
    .fontSize(10)
    .text(`Version 2.0  |  ${dateStr}`, 0, 720, { align: "center" });
}

function addHeader(doc: PDFKit.PDFDocument, title: string, level: number = 1) {
  if (level === 1) {
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 80).fill(COLORS.primary);
    doc.rect(0, 80, doc.page.width, 3).fill(COLORS.accent);
    doc.fill(COLORS.white)
      .fontSize(24)
      .font("Helvetica-Bold")
      .text(title, 50, 28, { width: doc.page.width - 100 });
    doc.y = 105;
  } else if (level === 2) {
    if (doc.y > 640) doc.addPage();
    doc.moveDown(0.8);
    doc.fill(COLORS.subheading)
      .fontSize(15)
      .font("Helvetica-Bold")
      .text(title, 50, undefined, { width: doc.page.width - 100 });
    doc.moveTo(50, doc.y + 2).lineTo(250, doc.y + 2).lineWidth(1).stroke(COLORS.accent);
    doc.moveDown(0.4);
  } else {
    if (doc.y > 660) doc.addPage();
    doc.moveDown(0.5);
    doc.fill(COLORS.secondary)
      .fontSize(12)
      .font("Helvetica-Bold")
      .text(title, 50, undefined, { width: doc.page.width - 100 });
    doc.moveDown(0.3);
  }
}

function addParagraph(doc: PDFKit.PDFDocument, text: string) {
  if (doc.y > 680) doc.addPage();
  doc.fill(COLORS.text)
    .fontSize(10)
    .font("Helvetica")
    .text(text, 50, undefined, { width: doc.page.width - 100, lineGap: 3 });
  doc.moveDown(0.4);
}

function addBulletList(doc: PDFKit.PDFDocument, items: string[]) {
  items.forEach((item) => {
    if (doc.y > 690) doc.addPage();
    doc.fill(COLORS.accent).fontSize(10).font("Helvetica").text("\u2022  ", 60, undefined, { continued: true });
    doc.fill(COLORS.text).font("Helvetica").text(item, { width: doc.page.width - 130, lineGap: 2 });
    doc.moveDown(0.15);
  });
  doc.moveDown(0.3);
}

function addNumberedList(doc: PDFKit.PDFDocument, items: string[]) {
  items.forEach((item, idx) => {
    if (doc.y > 690) doc.addPage();
    doc.fill(COLORS.subheading).fontSize(10).font("Helvetica-Bold").text(`${idx + 1}.  `, 60, undefined, { continued: true });
    doc.fill(COLORS.text).font("Helvetica").text(item, { width: doc.page.width - 130, lineGap: 2 });
    doc.moveDown(0.15);
  });
  doc.moveDown(0.3);
}

function addCalloutBox(doc: PDFKit.PDFDocument, label: string, text: string, bgColor: string, borderColor: string, labelColor: string) {
  if (doc.y > 650) doc.addPage();
  const startY = doc.y;
  const x = 50;
  const w = doc.page.width - 100;

  doc.save();
  doc.rect(x + 4, startY, w - 4, 1000).fill(bgColor);
  doc.fill(labelColor).fontSize(9).font("Helvetica-Bold").text(label, x + 14, startY + 8, { continued: true, width: w - 24 });
  doc.fill(COLORS.text).font("Helvetica").fontSize(9.5).text("  " + text, { width: w - 28, lineGap: 2 });
  const endY = doc.y + 8;
  doc.restore();

  doc.save();
  doc.rect(x + 4, startY, w - 4, endY - startY).fill(bgColor);
  doc.fill(labelColor).fontSize(9).font("Helvetica-Bold").text(label, x + 14, startY + 8, { continued: true, width: w - 24 });
  doc.fill(COLORS.text).font("Helvetica").fontSize(9.5).text("  " + text, { width: w - 28, lineGap: 2 });
  doc.rect(x, startY, 4, endY - startY).fill(borderColor);
  doc.restore();

  doc.y = endY + 6;
}

function addTip(doc: PDFKit.PDFDocument, text: string) {
  addCalloutBox(doc, "TIP:", text, COLORS.tipBg, COLORS.tipBorder, COLORS.tipBorder);
}

function addWarning(doc: PDFKit.PDFDocument, text: string) {
  addCalloutBox(doc, "IMPORTANT:", text, COLORS.warningBg, COLORS.warningBorder, COLORS.warningBorder);
}

function addNote(doc: PDFKit.PDFDocument, text: string) {
  addCalloutBox(doc, "NOTE:", text, COLORS.noteBg, COLORS.noteBorder, COLORS.noteBorder);
}

function addScreenshot(doc: PDFKit.PDFDocument, _filename: string, caption: string) {
  const maxWidth = doc.page.width - 120;
  const boxHeight = 60;

  if (doc.y > 650) doc.addPage();

  doc.moveDown(0.3);
  const boxX = 60;
  const boxY = doc.y;

  doc.save();
  doc.rect(boxX, boxY, maxWidth, boxHeight).fill('#f0f4f8');
  doc.rect(boxX, boxY, maxWidth, boxHeight).lineWidth(0.5).stroke(COLORS.border);

  doc.fill(COLORS.lightText)
    .fontSize(9)
    .font("Helvetica-Oblique")
    .text("[ Screenshot: See this page in the live application ]", boxX, boxY + 18, { width: maxWidth, align: "center" });
  doc.restore();

  doc.y = boxY + boxHeight + 4;

  doc.fill(COLORS.lightText)
    .fontSize(8.5)
    .font("Helvetica-Oblique")
    .text(caption, 60, undefined, { width: maxWidth, align: "center" });
  doc.moveDown(0.5);
}

function addKeyboardShortcut(doc: PDFKit.PDFDocument, shortcut: string, description: string) {
  if (doc.y > 700) doc.addPage();
  doc.fill(COLORS.secondary).fontSize(9.5).font("Helvetica-Bold").text(shortcut, 70, undefined, { continued: true, width: 120 });
  doc.fill(COLORS.text).font("Helvetica").text("  " + description, { width: doc.page.width - 200 });
  doc.moveDown(0.1);
}

function addTableOfContents(doc: PDFKit.PDFDocument) {
  doc.addPage();
  doc.fill(COLORS.primary).fontSize(24).font("Helvetica-Bold").text("Table of Contents", 50, 50);
  doc.moveTo(50, 80).lineTo(250, 80).lineWidth(2).stroke(COLORS.accent);
  doc.y = 100;

  const sections = [
    { num: "1", title: "Getting Started", sub: "Login, navigation, and system overview" },
    { num: "2", title: "Dashboard", sub: "Home screen, statistics, and reminders" },
    { num: "3", title: "Noticeboard", sub: "Crew announcements and media sharing" },
    { num: "4", title: "Contestants", sub: "Importing, profiles, search, photos, and ratings" },
    { num: "5", title: "Availability Management", sub: "Sending availability checks and tracking responses" },
    { num: "6", title: "Record Days", sub: "Creating sessions, RX Day Mode, and producer assignment" },
    { num: "7", title: "Seating Chart", sub: "Interactive layout, drag-and-drop, Quick Move, and visual indicators" },
    { num: "8", title: "Booking Master", sub: "Workflow tracking, emails, and real-time sync" },
    { num: "9", title: "Players", sub: "Casting cards, RX Planning, and Podium Stories" },
    { num: "10", title: "Standbys", sub: "Standby management and returning standby tracking" },
    { num: "11", title: "Booking Tracker", sub: "Response tracking across all record days" },
    { num: "12", title: "Paperwork Tracker", sub: "Email copy tracking and paperwork distribution" },
    { num: "13", title: "Reschedule", sub: "Cancelled assignments and rebooking" },
    { num: "14", title: "Winners", sub: "Prize tracking and Excel export" },
    { num: "15", title: "Attendance Issues", sub: "No-shows, early leavers, and audit trail" },
    { num: "16", title: "Post Record", sub: "Post-recording data capture" },
    { num: "17", title: "History", sub: "Complete audit trail of all changes" },
    { num: "18", title: "Settings & Configuration", sub: "Email, users, announcements, and customisation" },
    { num: "19", title: "Backup & Data Management", sub: "Automatic backups and data safety" },
    { num: "20", title: "Tips & Best Practices", sub: "Workflow tips and production guidance" },
    { num: "21", title: "Keyboard Shortcuts & Quick Reference", sub: "Shortcuts, icons, and status codes" },
  ];

  sections.forEach((s) => {
    doc.fill(COLORS.subheading).fontSize(11.5).font("Helvetica-Bold").text(`${s.num}. ${s.title}`, 60, undefined, { width: doc.page.width - 120 });
    doc.fill(COLORS.lightText).fontSize(9).font("Helvetica").text(s.sub, 75, undefined, { width: doc.page.width - 140 });
    doc.moveDown(0.3);
  });
}

export function generateGuide(res: Response) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    bufferPages: true,
    info: {
      Title: "Deal or No Deal - Contestant Management System Guide",
      Author: "Production Team",
      Subject: "Complete User Guide & Reference Manual",
      Keywords: "deal or no deal, contestant management, seating chart, booking",
    },
    autoFirstPage: false,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="DOND-System-Guide.pdf"');
  doc.pipe(res);

  doc.addPage();
  addCoverPage(doc);
  addTableOfContents(doc);

  // ===================================================================
  // 1. GETTING STARTED
  // ===================================================================
  addHeader(doc, "1. Getting Started");
  addParagraph(doc, "The Deal or No Deal Contestant Management System is a comprehensive tool designed to streamline the entire contestant lifecycle for game show productions. From the moment contestants are first identified through casting, to their seating assignment, booking confirmation, recording day management, and post-record tracking, this system automates and organises every step of the process.");

  addParagraph(doc, "The system replaces manual spreadsheets and scattered communication with a centralised, real-time platform that all production team members can access simultaneously. Changes made by one user are instantly visible to others, ensuring everyone works from the same up-to-date information.");

  addHeader(doc, "Logging In", 2);
  addParagraph(doc, "When you first open the system in your web browser, you will see the login screen. Enter the username and password provided by your system administrator.");
  addScreenshot(doc, "login.png", "Figure 1.1 - The login screen. Enter your credentials to access the system.");
  addParagraph(doc, "After logging in successfully, you will be taken to the Dashboard. Your session will remain active for 24 hours, after which you will need to log in again.");
  addTip(doc, "If you forget your password, contact your system administrator who can reset it from the Settings page. Never share your login credentials with others.");

  addHeader(doc, "Navigation", 2);
  addParagraph(doc, "The system uses a sidebar menu on the left side of the screen for navigation. The sidebar contains links to every section of the system, organised by function. Here is what you will find:");
  addBulletList(doc, [
    "Dashboard - Your home screen with key statistics and upcoming events",
    "Noticeboard - Internal crew announcements and notices",
    "Contestants - The central database of all contestant information",
    "Availability - Send and track availability checks for record days",
    "Record Days - Create and manage recording sessions",
    "Seating - Interactive seat assignment chart for the studio",
    "Booking Master - Complete booking workflow and status management",
    "Players - Casting cards, RX planning tools, and podium stories",
    "Standbys - Manage standby contestants for each record day",
    "Booking Tracker - Track booking confirmation responses",
    "Paperwork - Track paperwork distribution and email copies",
    "Reschedule - Manage rescheduled and cancelled contestants",
    "Winners - Track prize winners and amounts",
    "Attendance Issues - Record no-shows and early leavers",
    "Post Record - Post-recording data capture and management",
    "History - Complete audit trail of all system changes",
    "Settings - System configuration, email setup, and user management",
  ]);
  addTip(doc, "You can collapse the sidebar by clicking the toggle button at the top of the page. This gives you more screen space when working with the seating chart or other wide views.");

  addHeader(doc, "Understanding the Workflow", 2);
  addParagraph(doc, "The typical production workflow follows these stages:");
  addNumberedList(doc, [
    "Import contestants from Cast It Reach Excel exports into the system",
    "Create Record Days for upcoming recording sessions",
    "Send Availability Checks to contestants for specific record days",
    "Review responses and assign available contestants to seats on the Seating Chart",
    "Use Auto-Assignment to intelligently fill seats balancing demographics and keeping groups together",
    "Send Booking Confirmations to assigned contestants with confirmation/decline links",
    "Track booking responses on the Booking Tracker and Booking Master pages",
    "Manage standbys and handle any last-minute changes before recording",
    "On RX Day, lock the seating chart and manage attendance, no-shows, and standby replacements",
    "After recording, capture post-record data, track winners, and manage reschedules",
  ]);

  // ===================================================================
  // 2. DASHBOARD
  // ===================================================================
  addHeader(doc, "2. Dashboard");
  addParagraph(doc, "The Dashboard is your home screen and the first page you see after logging in. It provides a quick overview of the production status, upcoming events, and key statistics at a glance.");
  addScreenshot(doc, "dashboard.png", "Figure 2.1 - The Dashboard showing upcoming record days, statistics, and quick actions.");

  addHeader(doc, "Dashboard Components", 2);
  addBulletList(doc, [
    "Upcoming Record Days - A card showing the next scheduled recording sessions with their date, RX number, and how many seats are filled versus the total capacity. Click on any record day to jump directly to its seating chart.",
    "Today's Birthdays - Displays any contestants who have a birthday today, so you can acknowledge them during recording or in communications.",
    "48-Hour Reminder Widget - When a record day is within 48 hours, this widget highlights it and provides a one-click button to send reminder emails to all booked contestants and standbys.",
    "System Guide Download - Quick access to download this guide document.",
    "Quick Statistics - Overview counts of total contestants, record days, and other production metrics.",
  ]);

  addHeader(doc, "48-Hour Reminder Emails", 2);
  addParagraph(doc, "The 48-hour reminder system is designed to reduce no-shows. When a record day is approaching:");
  addNumberedList(doc, [
    "The Dashboard will display a prominent reminder widget for any record day within 48 hours",
    "Click the 'Send Reminders' button to email all booked contestants for that day",
    "Separate reminder emails are also sent to standbys",
    "Each contestant receives personalised details about their booking including date, time, and any special instructions",
    "The system tracks which reminders have been sent to avoid duplicate emails",
  ]);
  addWarning(doc, "Always check that your SMTP email settings are correctly configured in Settings before sending reminder emails. Incorrectly configured email will result in failed sends.");

  // ===================================================================
  // 3. NOTICEBOARD
  // ===================================================================
  addHeader(doc, "3. Noticeboard");
  addParagraph(doc, "The Noticeboard serves as an internal communication board for the production crew. It provides a centralised place for announcements, updates, and shared media that all team members can see after logging in.");

  addHeader(doc, "Creating Posts", 2);
  addParagraph(doc, "To create a new noticeboard post:");
  addNumberedList(doc, [
    "Navigate to the Noticeboard page from the sidebar",
    "Type your announcement text in the input area at the top",
    "Optionally attach an image or video file to accompany your text",
    "Click 'Post' to publish the announcement immediately",
  ]);

  addHeader(doc, "Media Support", 2);
  addBulletList(doc, [
    "Text Posts - Simple text announcements visible to all crew members",
    "Image Attachments - Upload photos to share visual information (props, set changes, contestant references)",
    "Video Uploads - Share video briefings, set walkthroughs, or reference clips directly on the noticeboard",
    "Posts appear in reverse chronological order (newest first) so the most recent information is always at the top",
  ]);
  addTip(doc, "Use the noticeboard for daily call sheets, set changes, or important reminders that the whole crew needs to see. It replaces group emails and message chains with a single, always-accessible board.");

  // ===================================================================
  // 4. CONTESTANTS
  // ===================================================================
  addHeader(doc, "4. Contestants");
  addParagraph(doc, "The Contestants page is the central database for all contestant information. This is where you import new contestants, manage their profiles, search and filter the database, upload photos, and track contestant status throughout the production.");
  addScreenshot(doc, "contestants.png", "Figure 4.1 - The Contestants page showing the searchable, filterable contestant database.");

  addHeader(doc, "Importing Contestants from Cast It Reach", 2);
  addParagraph(doc, "The primary way to add contestants to the system is by importing Excel exports from Cast It Reach. The import process is designed to be fast and accurate:");
  addNumberedList(doc, [
    "Click the 'Import from Excel' button at the top of the Contestants page",
    "Select your Cast It Reach export file (.xlsx format)",
    "The system will parse the spreadsheet, extract contestant data, and normalise names and contact details",
    "An import preview will show you how many new contestants will be added and how many existing records will be updated",
    "The intelligent group identification algorithm automatically detects contestants who are attending together based on the 'Attending With' field",
    "Confirm the import to add all data to the system",
  ]);
  addNote(doc, "The import process uses a multi-attribute disambiguation algorithm to accurately identify contestant groups. It considers names, contact details, and relationship information to avoid false matches between unrelated contestants who happen to share similar names.");

  addHeader(doc, "Contestant Profiles", 2);
  addParagraph(doc, "Each contestant has a comprehensive profile containing all the information needed for production management:");
  addBulletList(doc, [
    "Personal Details - Full name, email address, phone number, date of birth, and age",
    "Demographics - Gender (used for 60-70% female demographic targeting in auto-assignment)",
    "Location - Suburb, state, and postcode with automatic distance calculation from the studio",
    "Attending With - Group information showing who this contestant is coming with",
    "Rating - 1 to 5 star production assessment rating, changeable from multiple pages",
    "Photo - Contestant headshot, uploadable directly or bulk-imported from Cast It Reach Gallery",
    "Booking Status - Current status (Available, Booked, Declined, etc.)",
    "Mobility & Access Notes - Special requirements flagged with visual indicators throughout the system",
    "Notes - Free-text field for production team comments and observations",
    "Occupation - Contestant's job, displayed on casting cards",
    "Lifetime Counters - Number of times booked, rescheduled, no-shows, etc.",
  ]);

  addHeader(doc, "Search & Filtering", 2);
  addParagraph(doc, "The Contestants page provides powerful tools to find exactly who you are looking for:");
  addBulletList(doc, [
    "Text Search - Type any part of a name, email, phone number, or location to instantly filter the list",
    "Status Filter - Filter by booking status (All, Available, Booked, Contacted, Declined, Rescheduled, etc.)",
    "Gender Filter - Filter by gender for demographic balance planning and reporting",
    "Rating Filter - Multi-select filter that lets you choose one or more star ratings (e.g. show only 4 and 5 star contestants)",
    "All filters work together - you can combine text search with status and gender filters for precise results",
  ]);

  addHeader(doc, "Rating System", 2);
  addParagraph(doc, "Contestants are rated from 1 to 5 stars by the production team. This rating is used throughout the system to help prioritise contestants for booking:");
  addBulletList(doc, [
    "Ratings can be changed from the Contestants page, the Seating Chart context menu, and the Booking Master",
    "When a rating is changed anywhere, it updates instantly across the entire system",
    "Rating colours appear on the seating chart as border highlights, making it easy to spot high and low rated contestants at a glance",
    "The multi-select rating filter on the contestants page lets you quickly view only contestants with specific ratings",
  ]);

  addHeader(doc, "Photo Management", 2);
  addParagraph(doc, "Contestant photos are used on casting cards, the seating chart, and the Podium Visualiser. You can manage photos in several ways:");
  addNumberedList(doc, [
    "Individual Upload - Click on a contestant profile and upload a photo directly. Supported formats include JPG, PNG, and WEBP up to 5MB.",
    "Bulk Import from Gallery - Export photos from Cast It Reach Gallery as a ZIP file, then import them. The system matches photos to contestants by name.",
    "Delete or Replace - Click the photo area on any contestant to delete the current photo or upload a replacement.",
  ]);
  addTip(doc, "For best results on casting cards, use square or portrait-oriented photos. The casting card editor allows you to zoom, pan, and reposition photos within the card frame.");

  addHeader(doc, "Temporary Contestants", 2);
  addParagraph(doc, "In some situations, you may need to create a placeholder contestant on the fly, for example when someone turns up unannounced. The system supports creating temporary contestants:");
  addBulletList(doc, [
    "Temporary contestants can be created quickly with minimal information (just a name)",
    "They can be assigned to seats immediately",
    "Their full details can be filled in later",
    "The system distinguishes temporary contestants from regular imports",
  ]);

  // ===================================================================
  // 5. AVAILABILITY MANAGEMENT
  // ===================================================================
  addHeader(doc, "5. Availability Management");
  addParagraph(doc, "Before booking contestants for a record day, you need to check their availability. The Availability Management page automates this process with personalised email invitations and response tracking.");

  addHeader(doc, "Sending Availability Checks", 2);
  addNumberedList(doc, [
    "Navigate to the Availability page from the sidebar",
    "Select the Record Day you want to check availability for from the dropdown",
    "Select the contestants you want to send availability checks to (use filters to narrow down the list)",
    "Click 'Send Availability Checks' to email all selected contestants",
    "Each contestant receives a personalised email with a unique link to respond",
    "The link contains a secure, expiring token that identifies the contestant and the specific record day",
  ]);

  addHeader(doc, "How Contestants Respond", 2);
  addParagraph(doc, "When a contestant receives an availability check email:");
  addBulletList(doc, [
    "They click the link in the email to open the availability response page",
    "They see the record day date and details",
    "They can click 'Available' or 'Not Available'",
    "Their response is recorded instantly in the system",
    "The response includes a timestamp for tracking",
  ]);

  addHeader(doc, "Tracking Responses", 2);
  addParagraph(doc, "The Availability page shows the status of all sent checks in real-time:");
  addBulletList(doc, [
    "Pending - Email sent but no response yet",
    "Available - Contestant confirmed they are available",
    "Not Available - Contestant declined",
    "Expired - Token expired before the contestant responded",
  ]);
  addWarning(doc, "Availability tokens expire after a set period (configurable in Settings). If a contestant hasn't responded, you may need to send a new availability check or contact them directly.");

  // ===================================================================
  // 6. RECORD DAYS
  // ===================================================================
  addHeader(doc, "6. Record Days");
  addParagraph(doc, "Record Days are the core organisational unit of the system. Each record day represents a scheduled recording session and has its own seating chart, booking workflow, standby list, and post-record data.");
  addScreenshot(doc, "record-days.png", "Figure 6.1 - The Record Days page showing all scheduled recording sessions.");

  addHeader(doc, "Creating a Record Day", 2);
  addNumberedList(doc, [
    "Navigate to the Record Days page from the sidebar",
    "Click the 'Create Record Day' button",
    "Enter the recording date, RX number (episode reference identifier), and any notes",
    "Click 'Create' to set up the record day",
    "The system automatically creates a fresh seating chart with 7 blocks totalling 154 seats",
    "You can immediately begin assigning contestants to seats",
  ]);

  addHeader(doc, "Record Day Properties", 2);
  addBulletList(doc, [
    "Date - The scheduled recording date",
    "RX Number - The episode reference number (e.g. RX001, RX002)",
    "Notes - Any production notes about this recording session",
    "Producer - The assigned producer for this session",
    "Assistant Producer (AP) - The assigned AP for this session",
    "Locked Status - Whether the seating chart is locked (RX Day Mode)",
    "Block Configuration - Which blocks are Case Holder (PB) vs Non-Playing Block (NPB)",
  ]);

  addHeader(doc, "RX Day Mode (Locking)", 2);
  addParagraph(doc, "On the actual recording day, you can 'lock' the record day to enter RX Day Mode. This special mode provides several features designed for live production:");
  addBulletList(doc, [
    "Locked Seating Chart - All seat changes require confirmation dialogs to prevent accidental moves. Drag-and-drop and Quick Move both require confirmation when locked.",
    "Standby Seating - Standbys can be dragged from the standby list directly onto empty seats. The system tracks these movements for the audit trail.",
    "Attendance Tracking - Mark contestants as no-shows or early leavers. The system updates lifetime counters automatically.",
    "Quick Move Mode - Enabled in both locked and unlocked modes, but when locked, all moves require confirmation. When unlocked, moves are instant.",
    "Real-Time WebSocket Updates - All changes are broadcast to connected users instantly, so the entire production team sees changes in real-time.",
    "Movement Tracking - Every seat swap and standby assignment during RX Day is logged with timestamps for the complete audit trail.",
  ]);
  addNote(doc, "Quick Move Mode works differently depending on lock status: When RX Lock is OFF, moves happen instantly without prompts. When RX Lock is ON, every move shows a confirmation dialog. This lets you use Quick Move for fast edits during preparation, while adding safety during live recording.");

  addHeader(doc, "Block Configuration", 2);
  addParagraph(doc, "The studio has 7 seating blocks. Each block can be configured as:");
  addBulletList(doc, [
    "PB (Playing Block / Case Holder) - Contestants in these blocks hold cases and may play the game",
    "NPB (Non-Playing Block) - Audience-facing blocks where contestants sit but don't hold cases",
    "Block types can be changed per record day to match the production's requirements",
    "The auto-assignment algorithm uses block configuration to place contestants appropriately",
  ]);

  addHeader(doc, "Producer & AP Assignment", 2);
  addParagraph(doc, "Each record day can have a Producer and Assistant Producer assigned. These assignments are displayed on the record day details and help track who is responsible for each session. To assign, simply select from the dropdown on the record day page.");

  // ===================================================================
  // 7. SEATING CHART
  // ===================================================================
  addHeader(doc, "7. Seating Chart");
  addParagraph(doc, "The Seating Chart is the interactive heart of the system. It displays the studio layout with 7 blocks containing a total of 154 seats, and provides drag-and-drop, click-to-assign, and auto-assignment capabilities for managing where contestants sit during recording.");
  addScreenshot(doc, "seating-chart.png", "Figure 7.1 - The interactive Seating Chart showing the studio block layout with assigned contestants.");

  addHeader(doc, "Studio Layout", 2);
  addParagraph(doc, "The seating chart visually represents the physical studio arrangement:");
  addBulletList(doc, [
    "Top Row: Blocks 1, 2, and 3 (displayed left to right)",
    "Bottom Row: Blocks 4, 5, and 6 (displayed left to right, mirrored for camera perspective)",
    "Standing Block: Block 7 (the standing/overflow area)",
    "Each block contains multiple numbered seats",
    "Seats show the contestant's name, photo (if available), and visual indicators",
  ]);

  addHeader(doc, "Assigning Contestants to Seats", 2);
  addParagraph(doc, "There are several methods for assigning contestants:");

  addHeader(doc, "Manual Assignment", 3);
  addNumberedList(doc, [
    "Click on any empty seat in the seating chart",
    "A search dialog appears where you can type a contestant name",
    "Select the contestant from the search results",
    "The contestant is immediately assigned to that seat",
    "The system validates location (distance from studio) and warns if the contestant is from interstate",
  ]);

  addHeader(doc, "Group Assignment", 3);
  addParagraph(doc, "When assigning a contestant who is part of a group (Attending With), the system can assign the entire group together to keep them in adjacent seats.");

  addHeader(doc, "Auto-Assignment Algorithm", 3);
  addParagraph(doc, "The Auto-Assignment feature uses a sophisticated algorithm to fill seats intelligently:");
  addBulletList(doc, [
    "Targets 60-70% female demographic balance across the audience",
    "Keeps groups together so contestants attending with friends/family sit adjacent",
    "Uses a heuristic search for optimal placement across all 7 blocks",
    "Considers block type (PB vs NPB) when placing contestants",
    "Respects existing assignments, only fills empty seats",
    "Can be run multiple times to fill remaining seats",
  ]);
  addTip(doc, "Run Auto-Assignment after manually placing any VIP contestants or groups with specific seating requirements. The algorithm will work around your manual placements.");

  addHeader(doc, "Drag and Drop", 3);
  addParagraph(doc, "You can drag contestants between seats to rearrange them:");
  addBulletList(doc, [
    "Click and hold on a seated contestant, then drag them to a new seat",
    "If the destination seat is empty, the contestant moves there",
    "If the destination seat is occupied, the two contestants swap positions",
    "The system uses atomic database operations with advisory locks to prevent conflicts during simultaneous edits",
    "When RX Lock is active, a confirmation dialog appears before the swap is executed",
    "When RX Lock is not active, the swap happens immediately",
  ]);

  addHeader(doc, "Quick Move Mode", 2);
  addParagraph(doc, "Quick Move Mode provides a faster alternative to drag-and-drop, especially useful when making many changes:");
  addNumberedList(doc, [
    "Click the 'Quick Move' button in the toolbar to activate the mode",
    "Click on a seated contestant to select them (they will be highlighted)",
    "Click on the destination seat to move them there",
    "If the destination is occupied, the two contestants swap",
    "Press Escape to deselect the current contestant",
    "Click the button again to turn off Quick Move Mode",
  ]);
  addNote(doc, "Quick Move without RX Lock: Moves happen instantly, no confirmation needed - perfect for preparation work. Quick Move with RX Lock: Every move shows a confirmation dialog - this adds safety during live recording.");

  addHeader(doc, "Podium Visualiser Mode", 2);
  addParagraph(doc, "Toggle the Podium Visualiser to switch to a photo-only view of the seating chart. This shows contestant photos in their assigned positions without text clutter, providing a quick visual overview of who is sitting where. This view is useful for producers and directors to get a sense of the visual composition of the audience.");

  addHeader(doc, "Block Notes", 2);
  addParagraph(doc, "Each seating block has an editable notes field at the bottom. Producers can type annotations here - for example, camera notes, special instructions, or reminders. Block notes are specific to each block and each record day, and they save automatically as you type.");

  addHeader(doc, "Visual Indicators on the Seating Chart", 2);
  addParagraph(doc, "The seating chart uses several visual cues to convey information at a glance:");
  addBulletList(doc, [
    "Rating Borders - Colour-coded left borders indicating the contestant's star rating",
    "Mobility/Access Icons - A visual indicator appears on seats where the contestant has mobility or access requirements noted",
    "Gender Indicators - Subtle indicators help track demographic balance across blocks",
    "Group Badges - Icons show which contestants are attending together",
    "Standby Badges - During RX Day, standbys seated from the standby list are marked",
    "Booking Status - Optional booking status indicators showing confirmed, pending, or declined",
    "Search Highlighting - When using the search bar, matching contestants are highlighted while non-matching ones are dimmed",
  ]);

  addHeader(doc, "Removing Contestants from Seats", 2);
  addParagraph(doc, "To remove a contestant from a seat, click on the occupied seat and select the 'Remove' option from the context menu. The contestant will be moved to the Reschedule page where they can be rebooked for a different record day.");

  // ===================================================================
  // 8. BOOKING MASTER
  // ===================================================================
  addHeader(doc, "8. Booking Master");
  addParagraph(doc, "The Booking Master is the comprehensive booking management interface. It shows every contestant assigned to a record day and provides tools for managing the entire booking workflow from confirmation emails to response tracking.");
  addScreenshot(doc, "booking-master.png", "Figure 8.1 - The Booking Master showing the complete booking workflow with inline editing.");

  addHeader(doc, "Real-Time Synchronisation", 2);
  addParagraph(doc, "The Booking Master uses WebSocket connections to synchronise data in real-time. When one user makes a change, it appears instantly on all other users' screens. This means:");
  addBulletList(doc, [
    "Multiple team members can work on the booking master simultaneously",
    "Changes to booking status, notes, and other fields are reflected immediately",
    "No need to refresh the page to see updates from other users",
    "Conflict resolution is handled automatically at the database level",
  ]);

  addHeader(doc, "Inline Editing", 2);
  addParagraph(doc, "Many fields on the Booking Master can be edited directly in the table by clicking on them. This includes:");
  addBulletList(doc, [
    "OTD (On The Day) Notes - Production notes for each contestant on this specific day",
    "Attending With Override - Override the default group information for this booking",
    "Booking status and notes",
    "Changes are saved automatically as you type or when you click away",
  ]);

  addHeader(doc, "Sending Booking Confirmation Emails", 2);
  addParagraph(doc, "The Booking Master allows you to send booking confirmation emails to contestants:");
  addNumberedList(doc, [
    "Select the contestants you want to send confirmations to",
    "Click 'Send Booking Emails' (individually or in bulk)",
    "Each email contains a unique secure link for the contestant to confirm or decline",
    "Emails use customisable templates configured in Settings",
    "The system tracks which emails have been sent and when",
  ]);

  addHeader(doc, "Google Sheets Integration", 2);
  addParagraph(doc, "The Booking Master data can be synced to Google Sheets for sharing with team members who don't have system access. This integration creates or updates a Google Sheet with the current booking data, making it easy to share read-only information externally.");

  addHeader(doc, "Rebooking History", 2);
  addParagraph(doc, "Every rebooking action is recorded with full audit trail. When a contestant is moved from one record day to another, the system creates a rebooking record with timestamps, the original and new record days, and the user who made the change. This is accessible from the History page.");

  // ===================================================================
  // 9. PLAYERS
  // ===================================================================
  addHeader(doc, "9. Players (Casting Cards, RX Planning & Podium Stories)");
  addParagraph(doc, "The Players page is a multi-tabbed workspace that brings together three related but distinct tools: Casting Cards for contestant profiles, RX Planning for episode lineup planning, and Podium Stories for tracking contestant stories during recording.");
  addScreenshot(doc, "players.png", "Figure 9.1 - The Players page showing the casting cards, RX Planning, and Podium Stories tabs.");

  addHeader(doc, "Casting Cards", 2);
  addParagraph(doc, "Casting cards are polished visual profiles of contestants used by producers and the on-set team. They contain the contestant's photo, name, occupation, age, location, and production notes in a professionally formatted layout.");

  addHeader(doc, "Creating Casting Cards", 3);
  addBulletList(doc, [
    "Casting cards are created by selecting a contestant from the system",
    "The card automatically pulls in the contestant's photo, name, age, location, and other details",
    "You can also bulk-import casting cards from PowerPoint (.pptx) files exported from other systems",
    "Each card stores its own data independently, allowing customisation without affecting the contestant profile",
  ]);

  addHeader(doc, "PowerPoint Import", 3);
  addParagraph(doc, "To import casting cards from PowerPoint:");
  addNumberedList(doc, [
    "Click 'Import from PPTX' on the Players page",
    "Select your PowerPoint file",
    "The system parses each slide, extracting text, images, and formatting",
    "A preview shows how each card will look before importing",
    "Confirm to import all cards into the system",
  ]);

  addHeader(doc, "The Casting Card Editor", 3);
  addParagraph(doc, "The editor provides comprehensive formatting tools:");
  addBulletList(doc, [
    "Full-Screen Mode - Expand the editor for detailed work on a single card",
    "Rich Text Formatting - Bold, italic, underline, and strikethrough for body text",
    "Font Size Control - Adjust font sizes for header fields (name, occupation, tagline, age/state) using the toolbar arrows. Body text font size is controlled separately.",
    "Text Colour - Apply colour formatting to body text for emphasis",
    "Photo Positioning - Zoom, pan, and rotate the contestant's photo within the card frame to get the perfect crop",
    "Tagline Toggle - Show or hide the tagline field depending on whether the contestant has one",
    "Sponsor Category - Tag contestants with sponsor categories for production tracking",
    "Companion Information - Auto-populated from group data, with manual editing for additional attendees",
  ]);
  addTip(doc, "Font size changes on header fields (name, occupation, tagline) are saved independently for each casting card. This allows you to adjust sizing for contestants with longer or shorter names.");

  addHeader(doc, "Casting Card Version History", 3);
  addParagraph(doc, "The system automatically creates time-throttled backups of casting cards. If you make accidental changes, you can view previous versions and restore any earlier version with a single click. This provides a safety net for the editing process.");

  addHeader(doc, "Printing Casting Cards", 3);
  addParagraph(doc, "Cards can be printed directly from the system. The print layout is optimised for A4 paper and includes all card details in a clean, professional format. You can print individual cards or all cards for a record day.");

  addHeader(doc, "RX Planning", 2);
  addParagraph(doc, "The RX Planning tab provides a visual drag-and-drop tool for pre-planning episode lineups before the recording day:");
  addBulletList(doc, [
    "Drag casting cards from the contestant list into episode planning slots",
    "Visual preview of each casting card within the planning grid",
    "Plan multiple episodes at once with different contestant lineups",
    "Rearrange contestants between episodes by dragging",
    "Planning data is stored locally in your browser for flexible, non-destructive planning that doesn't affect the main system",
    "Export or share your planning layouts with the production team",
  ]);
  addTip(doc, "RX Planning is ideal for producers who want to sketch out episode structures before committing to seat assignments. Because the data is stored locally, you can experiment freely without affecting the live system.");

  addHeader(doc, "Podium Stories", 2);
  addParagraph(doc, "The Podium Stories tab is used during and after recording to track contestant stories for each block:");
  addBulletList(doc, [
    "Block-by-Block View - See contestants organised by their seating block, matching the physical studio layout",
    "Direct Tagging - Click on a contestant to tag them with a story note or observation",
    "Editable Story Notes - Free-text notes for each contestant that can be updated in real-time",
    "Case Number Assignment - Assign case numbers to contestants for game tracking",
    "Booking Status Indicators - Each contestant shows their current booking status (confirmed, standby, etc.)",
    "Photo Display - Contestant photos are shown alongside their story notes for easy identification",
  ]);

  // ===================================================================
  // 10. STANDBYS
  // ===================================================================
  addHeader(doc, "10. Standbys");
  addParagraph(doc, "Standbys are contestants who are on call for a specific record day in case a booked contestant doesn't show up. The Standbys page provides tools for managing this critical backup system.");
  addScreenshot(doc, "standbys.png", "Figure 10.1 - The Standbys page showing standby management for record days.");

  addHeader(doc, "Managing Standbys", 2);
  addNumberedList(doc, [
    "Navigate to the Standbys page and select a record day",
    "Add contestants as standbys by searching and selecting from the database",
    "Each standby has a priority order that determines who gets seated first",
    "Drag and drop standbys to reorder their priority",
    "Send standby-specific booking confirmation emails to notify them of their standby status",
  ]);

  addHeader(doc, "Seating Standbys on RX Day", 2);
  addParagraph(doc, "During RX Day when the seating chart is locked:");
  addBulletList(doc, [
    "If a contestant is a no-show, their seat becomes available",
    "The highest-priority confirmed standby can be dragged from the standby list directly onto the empty seat",
    "The system records this as a standby seating event with full tracking",
    "The standby's status changes to 'Seated' and they appear on the seating chart",
    "Movement notes can be added to document why the standby was seated",
  ]);

  addHeader(doc, "Returning Standbys", 2);
  addParagraph(doc, "When a standby contestant attends a record day but doesn't get to play, the system tracks this. These 'returning standbys' can be fast-tracked for future bookings because:");
  addBulletList(doc, [
    "They have already been through the preparation process",
    "They are familiar with the studio and procedures",
    "They have demonstrated reliability by attending",
    "The system highlights them for easy identification in future booking sessions",
  ]);

  // ===================================================================
  // 11. BOOKING TRACKER
  // ===================================================================
  addHeader(doc, "11. Booking Tracker");
  addParagraph(doc, "The Booking Tracker provides a focused, cross-record-day view of all booking confirmation responses. While the Booking Master shows bookings for a single record day, the Booking Tracker aggregates responses across all days.");

  addHeader(doc, "Features", 2);
  addBulletList(doc, [
    "See all pending, confirmed, and declined bookings across all record days in one view",
    "Track response timestamps to see when contestants responded",
    "Identify contestants who haven't responded to follow up with them",
    "Filter by response status to focus on specific categories",
    "Quick actions for sending follow-up communications",
    "Sort by date, name, or status for different views",
  ]);

  // ===================================================================
  // 12. PAPERWORK TRACKER
  // ===================================================================
  addHeader(doc, "12. Paperwork Tracker");
  addParagraph(doc, "The Paperwork Tracker manages the distribution of contestant paperwork and the tracking of email copies.");

  addHeader(doc, "Features", 2);
  addBulletList(doc, [
    "Track when contestant emails are copied for external sending (to legal, compliance, etc.)",
    "Email copy tracking for paperwork distribution workflows",
    "Status tracking for paperwork completion per contestant",
    "Integration with the booking workflow to ensure paperwork is sent at the right time",
    "Filterable by record day and completion status",
  ]);

  // ===================================================================
  // 13. RESCHEDULE
  // ===================================================================
  addHeader(doc, "13. Reschedule");
  addParagraph(doc, "The Reschedule page manages contestants who have been removed from their assigned record day and need to be rebooked for a future session. This is a critical workflow for handling cancellations, declines, and no-shows.");
  addScreenshot(doc, "reschedule.png", "Figure 13.1 - The Reschedule page showing cancelled assignments awaiting rebooking.");

  addHeader(doc, "Key Features", 2);
  addBulletList(doc, [
    "Comprehensive List - All rescheduled contestants across all record days",
    "Email Column - Quick access to contestant email addresses for direct contact",
    "Search - Find specific rescheduled contestants by name",
    "Duplicate Prevention - The system warns you if you try to rebook a contestant who is already booked elsewhere",
    "Reschedule Count - See how many times each contestant has been rescheduled (helps identify problematic bookings)",
    "Decline History - View past decline responses from the contestant",
    "Rebooked Status - Track whether a rescheduled contestant has been successfully placed in a new record day",
  ]);

  addHeader(doc, "Rebooking Workflow", 2);
  addNumberedList(doc, [
    "Review the list of rescheduled contestants",
    "Check their decline history and reschedule count to understand the context",
    "Select an upcoming record day with available seats",
    "Assign the contestant to a seat on the new record day",
    "The system automatically updates the reschedule status and creates an audit trail entry",
  ]);

  // ===================================================================
  // 14. WINNERS
  // ===================================================================
  addHeader(doc, "14. Winners");
  addParagraph(doc, "The Winners page tracks all contestants who have won money on the show.");
  addScreenshot(doc, "winners.png", "Figure 14.1 - The Winners page showing prize winners with amounts and record day details.");

  addHeader(doc, "Features", 2);
  addBulletList(doc, [
    "Record winning amounts for any contestant",
    "View all winners across all record days with their winning amounts",
    "Sort winners by date, amount, or name",
    "Excel Export - Download a spreadsheet of all winner data for production accounting and reporting",
    "Winners are marked on the seating chart with a visual indicator",
    "Winning money can be edited or removed if recorded incorrectly",
  ]);

  // ===================================================================
  // 15. ATTENDANCE ISSUES
  // ===================================================================
  addHeader(doc, "15. Attendance Issues");
  addParagraph(doc, "The Attendance Issues page is the dedicated audit page for tracking no-shows and early leavers across all record days.");

  addHeader(doc, "Recording Attendance Issues", 2);
  addParagraph(doc, "During RX Day, when a contestant fails to appear or leaves early:");
  addNumberedList(doc, [
    "Open the seating chart for the active record day",
    "Find the contestant's seat and click on it",
    "Select 'No Show' or 'Early Leaver' from the context menu",
    "Add any relevant notes (e.g. reason given, time of departure)",
    "The system records the issue with a timestamp",
    "The contestant's lifetime no-show or early-leaver counter is updated automatically",
    "The seat becomes available for standby assignment",
  ]);

  addHeader(doc, "Attendance History", 2);
  addBulletList(doc, [
    "View all attendance issues across all record days",
    "Lifetime counters show how many times each contestant has had issues",
    "This data helps inform future booking decisions (frequent no-shows may be deprioritised)",
    "Full audit trail with timestamps and notes for every recorded issue",
    "Filter by record day or contestant to find specific incidents",
  ]);

  // ===================================================================
  // 16. POST RECORD
  // ===================================================================
  addHeader(doc, "16. Post Record");
  addParagraph(doc, "The Post Record page provides tools for capturing and managing data after a recording session is complete.");

  addHeader(doc, "Features", 2);
  addBulletList(doc, [
    "Editable fields for each contestant's post-record data",
    "Buffered saves - changes are batched and saved after a brief pause to prevent excessive database writes",
    "Visual indicators for overridden values - fields that have been manually edited show a subtle highlight so you know they differ from the original data",
    "Document-level editing for production notes and observations",
    "Track follow-up actions needed for specific contestants",
    "Data persists across sessions and is included in system backups",
  ]);

  // ===================================================================
  // 17. HISTORY
  // ===================================================================
  addHeader(doc, "17. History");
  addParagraph(doc, "The History page provides a consolidated, chronological audit trail of all significant system events. This is essential for production accountability and troubleshooting.");
  addScreenshot(doc, "history.png", "Figure 17.1 - The History page showing a consolidated audit trail of system events.");

  addHeader(doc, "What's Tracked", 2);
  addBulletList(doc, [
    "Rebooking History - Every time a contestant is moved between record days, with source day, destination day, and timestamp",
    "Attendance Issues - All no-shows and early leavers with notes and timestamps",
    "Standby Attendance - Which standbys attended which record days and whether they were seated",
    "Seat Movements (RX Day) - Every swap and move made during locked RX Day mode",
    "User Information - Which system user performed each action",
    "Timestamps - Precise date and time for every recorded event",
  ]);
  addTip(doc, "The History page is invaluable when you need to trace back what happened. For example, if a contestant claims they weren't notified, you can check the audit trail for their booking and email history.");

  // ===================================================================
  // 18. SETTINGS
  // ===================================================================
  addHeader(doc, "18. Settings & Configuration");
  addParagraph(doc, "The Settings page is the central hub for configuring the system. It's organised into tabs for different configuration areas.");
  addScreenshot(doc, "settings.png", "Figure 18.1 - The Settings page showing email configuration, user management, and system customisation.");

  addHeader(doc, "General Settings", 2);
  addBulletList(doc, [
    "System Guide Download - Access this guide document",
    "System Backup - Trigger manual backups of all system data",
    "Data Management - Tools for data maintenance and cleanup",
  ]);

  addHeader(doc, "Email Configuration", 2);
  addParagraph(doc, "The system sends emails for availability checks, booking confirmations, standby notifications, and reminders. Configure your SMTP settings here:");
  addBulletList(doc, [
    "SMTP Host - Your email server address (e.g. smtp.office365.com for Office 365)",
    "SMTP Port - Typically 587 for TLS or 465 for SSL",
    "SMTP Username - Your email login (often your full email address)",
    "SMTP Password - Your email account password or app-specific password",
    "Sender Name - The name that appears in the 'From' field of sent emails",
    "Reply-To Address - Where contestant replies should go",
  ]);
  addWarning(doc, "Test your email configuration by sending a test email from the Settings page before relying on it for production. Incorrect settings will cause all email sends to fail silently.");

  addHeader(doc, "Email Templates", 2);
  addParagraph(doc, "You can customise the content of all email types sent by the system:");
  addBulletList(doc, [
    "Availability Email - Subject, headline, introduction text, instructions, and footer",
    "Booking Confirmation Email - Headline, introduction, instructions, additional info, and footer",
    "Standby Email - Similar structure customised for standby communications",
    "Ticket Email - For contestant ticket distribution with important instructions",
    "Reminder Email - Customisable reminder message for the 48-hour reminders",
    "Each template supports HTML formatting for rich email content",
    "Email assets (images, logos) can be uploaded and referenced in templates",
  ]);

  addHeader(doc, "User Management", 2);
  addParagraph(doc, "Manage system access by creating, viewing, and deleting user accounts:");
  addBulletList(doc, [
    "Create new user accounts with a username and password",
    "View all existing user accounts",
    "Delete user accounts that are no longer needed",
    "Change your own password from the Settings page",
    "Change your own username if needed",
    "All users have full system access (there are no permission levels)",
  ]);

  addHeader(doc, "Animated Welcome Message", 2);
  addParagraph(doc, "Configure a full-screen animated welcome message that displays once per login session:");
  addBulletList(doc, [
    "Enable or disable the animated message",
    "Customise the message text and styling",
    "The message appears once per session (not on every page navigation)",
    "Useful for daily call information, special announcements, or morale messages",
  ]);

  addHeader(doc, "Announcement Popup", 2);
  addParagraph(doc, "Configure a popup announcement that appears on login:");
  addBulletList(doc, [
    "Enable or disable the popup",
    "Set the title and message content",
    "Useful for urgent notices or important information that must be acknowledged",
  ]);

  // ===================================================================
  // 19. BACKUP & DATA MANAGEMENT
  // ===================================================================
  addHeader(doc, "19. Backup & Data Management");
  addParagraph(doc, "The system includes automatic and manual backup capabilities to protect your production data.");

  addHeader(doc, "Automatic Hourly Backups", 2);
  addParagraph(doc, "The system runs automatic backups every hour:");
  addBulletList(doc, [
    "All contestant data, record days, seat assignments, standbys, and system settings are backed up",
    "Backups are saved as both JSON (raw data) and Excel (.xlsx) files",
    "Backup files are stored in the system's storage directory",
    "Each backup file is timestamped for easy identification",
    "Multiple backup files are retained so you can restore from different points in time",
  ]);

  addHeader(doc, "Manual Backups", 2);
  addParagraph(doc, "You can trigger a manual backup at any time from the Settings page. This is recommended:");
  addBulletList(doc, [
    "Before major data imports",
    "Before bulk operations or significant changes",
    "At the end of each production day",
    "Before system maintenance or updates",
  ]);

  addHeader(doc, "Data Safety", 2);
  addParagraph(doc, "Several features work together to protect your data:");
  addBulletList(doc, [
    "Auto-save - Changes are saved continuously as you work, no manual save button needed",
    "Hourly backups - Automatic protection against data loss",
    "Casting card version history - Restore previous versions of any casting card",
    "Audit trail - Complete history of all changes for accountability",
    "Database-level concurrency control - Advisory locks prevent conflicts when multiple users edit simultaneously",
    "WebSocket sync - Real-time updates prevent users from overwriting each other's changes",
  ]);
  addWarning(doc, "While the system has comprehensive backup and protection features, always verify changes after bulk imports to ensure data accuracy. Review the import summary carefully before confirming large imports.");

  // ===================================================================
  // 20. TIPS & BEST PRACTICES
  // ===================================================================
  addHeader(doc, "20. Tips & Best Practices");

  addHeader(doc, "Preparation Workflow", 2);
  addNumberedList(doc, [
    "Import contestants well ahead of recording dates so you have time to review and rate them",
    "Upload or import contestant photos early - they make the seating chart and casting cards much more useful",
    "Create record days as soon as dates are confirmed",
    "Send availability checks at least 2 weeks before recording to give contestants time to respond",
    "Use Auto-Assignment as a starting point, then manually adjust as needed",
    "Send booking confirmations promptly after seat assignment",
    "Review the 48-hour reminder widget on the Dashboard to catch any upcoming days that need reminders",
  ]);

  addHeader(doc, "RX Day Workflow", 2);
  addNumberedList(doc, [
    "Lock the record day to enter RX Day Mode before the recording session begins",
    "Use the seating chart to track arrivals - mark no-shows as they are identified",
    "Seat standbys using the drag-and-drop from the standby list when seats become available",
    "Use Quick Move Mode (with RX Lock on) for fast, confirmed seat changes during recording",
    "Record early leavers as they depart so the information is captured in real-time",
    "Use Podium Stories to tag and note contestant stories as they happen during recording",
    "Update block notes with any production observations during recording",
  ]);

  addHeader(doc, "Post-Record Workflow", 2);
  addNumberedList(doc, [
    "Capture post-record data while the information is fresh",
    "Record any winners and their amounts on the Winners page",
    "Review and process rescheduled contestants for future record days",
    "Check the History page to verify all events were properly recorded",
    "Trigger a manual backup after completing post-record work",
  ]);

  addHeader(doc, "General Tips", 2);
  addBulletList(doc, [
    "Use the search function on every page - it's the fastest way to find contestants",
    "Keep contestant ratings up to date - they drive visual indicators across the system",
    "Use mobility/access notes for any contestant with special requirements - these appear as visual alerts on the seating chart",
    "Check the noticeboard regularly for crew announcements",
    "If multiple team members are editing simultaneously, the WebSocket sync ensures everyone sees changes in real-time",
    "Use the Booking Master's inline editing for quick updates rather than navigating to individual contestant profiles",
    "Export winner data to Excel regularly for production accounting",
  ]);

  addHeader(doc, "Troubleshooting Common Issues", 2);
  addBulletList(doc, [
    "Emails not sending - Check SMTP configuration in Settings. Verify host, port, username, and password are correct. Send a test email.",
    "Contestant not appearing in search - Check if they have been imported. Use the 'All' status filter to ensure they are not being filtered out.",
    "Seating chart changes not saving - Check your internet connection. The system uses WebSocket for real-time sync, which requires a stable connection.",
    "Cannot move seats - If the record day is locked (RX Day Mode), you'll need to confirm each move via the dialog. If you want moves without prompts, unlock the day first.",
    "Photo not displaying - Ensure the photo is under 5MB and in a supported format (JPG, PNG, WEBP). Try re-uploading.",
    "Group assignment not keeping contestants together - Verify the 'Attending With' field is correctly set on the contestant profiles. The group algorithm uses this data.",
  ]);

  // ===================================================================
  // 21. KEYBOARD SHORTCUTS & QUICK REFERENCE
  // ===================================================================
  addHeader(doc, "21. Keyboard Shortcuts & Quick Reference");

  addHeader(doc, "Keyboard Shortcuts", 2);
  addKeyboardShortcut(doc, "Escape", "Deselect contestant in Quick Move Mode");
  addKeyboardShortcut(doc, "Click + Drag", "Move a contestant between seats (drag-and-drop)");
  addKeyboardShortcut(doc, "Click (Quick Move)", "Select/move a contestant in Quick Move Mode");

  addHeader(doc, "Status Codes Quick Reference", 2);
  addBulletList(doc, [
    "Available - Contestant has confirmed availability and can be booked",
    "Booked - Contestant has been assigned to a seat",
    "Confirmed - Contestant has confirmed their booking via the email link",
    "Declined - Contestant has declined the booking",
    "Contacted - Availability check sent but no response yet",
    "Rescheduled - Contestant was removed from a record day and needs rebooking",
    "No Show - Contestant was booked but did not attend",
    "Early Leaver - Contestant attended but left before recording finished",
  ]);

  addHeader(doc, "Block Types", 2);
  addBulletList(doc, [
    "PB (Playing Block) - Case holder block. Contestants here hold cases and may play the game.",
    "NPB (Non-Playing Block) - Audience block. Contestants sit here as audience members but don't hold cases.",
  ]);

  addHeader(doc, "Visual Indicator Reference", 2);
  addBulletList(doc, [
    "Star Rating Colours - Rating borders on the seating chart use distinct colours for each star level (1-5)",
    "Mobility/Access Icon - Indicates the contestant has accessibility requirements noted in their profile",
    "Group Badge - Shows the contestant is attending with others",
    "Standby Badge - Contestant was seated from the standby list during RX Day",
    "Booking Status Badge - Shows whether the contestant's booking is confirmed, pending, or declined",
    "Search Highlight - Matching contestants are highlighted when using the seating chart search bar",
  ]);

  // ───────────────── Footer on all pages ─────────────────
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    if (i === 0) continue;
    doc.fill(COLORS.lightText)
      .fontSize(7.5)
      .font("Helvetica")
      .text(
        `Deal or No Deal - Contestant Management System Guide  |  Page ${i + 1} of ${pageCount}`,
        50,
        doc.page.height - 35,
        { width: doc.page.width - 100, align: "center" }
      );
  }

  doc.end();
}
