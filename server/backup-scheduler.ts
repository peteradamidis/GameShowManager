import * as fs from 'fs';
import * as path from 'path';
import xlsx from 'xlsx';
import { storage, db } from './storage';
import {
  prizeWinners,
  castingCardVersions,
  systemConfig,
  noticeboardComments,
  availabilityTokens,
  bookingConfirmationTokens,
  standbyConfirmationTokens,
  systemSettings,
} from '../shared/schema';

const BACKUP_DIR = './storage/backups';
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Generate timestamped backup filename
function getBackupFilename(extension: 'json' | 'xlsx'): string {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  return `backup_${timestamp}.${extension}`;
}

let backupIntervalId: NodeJS.Timeout | null = null;
let lastBackupTime: Date | null = null;
let lastBackupStatus: 'success' | 'error' | null = null;
let lastBackupError: string | null = null;
let consecutiveFailures = 0;
let schedulerInitialized = false;
const MAX_CONSECUTIVE_FAILURES = 5;

// Ensure backup directory exists
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

// Export all data to JSON
export async function performBackup(): Promise<{ success: boolean; message: string; path?: string }> {
  try {
    ensureBackupDir();
    
    // Fetch all data via storage interface
    const [
      recordDays,
      contestants,
      groups,
      seatAssignments,
      standbys,
      canceledAssignments,
      attendanceIssues,
      rebookingHistory,
      standbyAttendanceHistory,
      castingCards,
      rxPlanningEntries,
      postRecordTracking,
      noticeboardPosts,
      movementHistory,
      contestantAvailability,
      birthdayEntries,
    ] = await Promise.all([
      storage.getRecordDays(),
      storage.getContestants(),
      storage.getGroups(),
      storage.getAllSeatAssignments(),
      storage.getStandbyAssignments(),
      storage.getCanceledAssignments(),
      storage.getAttendanceIssues(),
      storage.getAllRebookingHistory(),
      storage.getStandbyAttendanceHistory(),
      storage.getCastingCards(),
      storage.getAllRxPlanningData(),
      storage.getPostRecordEntries(),
      storage.getNoticeboardPosts(),
      storage.getMovementHistory(),
      storage.getAllAvailabilityResponses(),
      storage.getBirthdayEntries(),
    ]);
    
    // Get block types and block notes for all record days
    const [blockTypesArrays, blockNotesArrays] = await Promise.all([
      Promise.all(recordDays.map(rd => storage.getBlockTypesByRecordDay(rd.id))),
      Promise.all(recordDays.map(rd => storage.getBlockNotes(rd.id))),
    ]);
    const blockTypes = blockTypesArrays.flat();
    const blockNotes = blockNotesArrays.flat();

    // Fetch tables that only have per-record-day or per-item DB methods — query DB directly
    let prizeWinnersData: any[] = [];
    let castingCardVersionsData: any[] = [];
    let systemConfigData: any[] = [];
    let noticeboardCommentsData: any[] = [];
    let availabilityTokensData: any[] = [];
    let bookingConfirmationTokensData: any[] = [];
    let standbyConfirmationTokensData: any[] = [];
    let systemSettingsData: any[] = [];

    if (db) {
      [
        prizeWinnersData,
        castingCardVersionsData,
        systemConfigData,
        noticeboardCommentsData,
        availabilityTokensData,
        bookingConfirmationTokensData,
        standbyConfirmationTokensData,
        systemSettingsData,
      ] = await Promise.all([
        db.select().from(prizeWinners),
        db.select().from(castingCardVersions),
        db.select().from(systemConfig),
        db.select().from(noticeboardComments),
        db.select().from(availabilityTokens),
        db.select().from(bookingConfirmationTokens),
        db.select().from(standbyConfirmationTokens),
        db.select().from(systemSettings),
      ]);
    }

    const backupData = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      automatic: true,
      data: {
        // Core seating data
        recordDays,
        contestants,
        groups,
        seatAssignments,
        blockTypes,
        standbys,
        canceledAssignments,
        // History & audit trails
        attendanceIssues,
        rebookingHistory,
        standbyAttendanceHistory,
        movementHistory,
        // Booking workflow
        contestantAvailability,
        availabilityTokens: availabilityTokensData,
        bookingConfirmationTokens: bookingConfirmationTokensData,
        standbyConfirmationTokens: standbyConfirmationTokensData,
        // Content & config
        castingCards,
        castingCardVersions: castingCardVersionsData,
        rxPlanningEntries,
        blockNotes,
        postRecordTracking,
        prizeWinners: prizeWinnersData,
        birthdayEntries,
        // Noticeboard
        noticeboardPosts,
        noticeboardComments: noticeboardCommentsData,
        // System
        systemConfig: systemConfigData,
        systemSettings: systemSettingsData,
      },
      counts: {
        recordDays: recordDays.length,
        contestants: contestants.length,
        groups: groups.length,
        seatAssignments: seatAssignments.length,
        blockTypes: blockTypes.length,
        standbys: standbys.length,
        canceledAssignments: canceledAssignments.length,
        attendanceIssues: attendanceIssues.length,
        rebookingHistory: rebookingHistory.length,
        standbyAttendanceHistory: standbyAttendanceHistory.length,
        movementHistory: movementHistory.length,
        contestantAvailability: contestantAvailability.length,
        castingCards: castingCards.length,
        castingCardVersions: castingCardVersionsData.length,
        rxPlanningEntries: rxPlanningEntries.length,
        blockNotes: blockNotes.length,
        postRecordTracking: postRecordTracking.length,
        prizeWinners: prizeWinnersData.length,
        birthdayEntries: birthdayEntries.length,
        noticeboardPosts: noticeboardPosts.length,
        noticeboardComments: noticeboardCommentsData.length,
        systemConfig: systemConfigData.length,
      },
    };

    const jsonFilename = getBackupFilename('json');
    const excelFilename = getBackupFilename('xlsx');
    const backupPath = path.join(BACKUP_DIR, jsonFilename);
    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));

    // Also create Excel backup
    const excelPath = path.join(BACKUP_DIR, excelFilename);
    await createExcelBackup(backupData.data, excelPath);

    lastBackupTime = new Date();
    lastBackupStatus = 'success';
    lastBackupError = null;
    consecutiveFailures = 0;

    console.log(`[Backup] Automatic backup completed at ${lastBackupTime.toISOString()}`);
    console.log(`[Backup] Data: ${recordDays.length} record days, ${contestants.length} contestants, ${seatAssignments.length} assignments, ${attendanceIssues.length} attendance issues, ${rebookingHistory.length} rebookings, ${castingCards.length} casting cards`);
    console.log(`[Backup] Excel backup saved to ${excelPath}`);

    return { 
      success: true, 
      message: 'Backup completed successfully',
      path: backupPath 
    };
  } catch (error: any) {
    lastBackupStatus = 'error';
    lastBackupError = error.message;
    consecutiveFailures++;
    
    console.error(`[Backup] Automatic backup failed (attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, error.message);
    
    // Stop scheduler after too many consecutive failures
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && backupIntervalId) {
      console.error('[Backup] Too many consecutive failures - stopping scheduler');
      stopBackupScheduler();
    }
    
    return { 
      success: false, 
      message: `Backup failed: ${error.message}` 
    };
  }
}

// Start the automatic backup scheduler
export function startBackupScheduler() {
  if (backupIntervalId) {
    console.log('[Backup] Scheduler already running');
    return;
  }

  console.log('[Backup] Starting automatic backup scheduler (every 1 hour)');
  schedulerInitialized = true;
  consecutiveFailures = 0;
  
  // Run first backup after 1 minute to let the app settle
  setTimeout(() => {
    performBackup();
  }, 60 * 1000);

  // Then run every hour
  backupIntervalId = setInterval(() => {
    performBackup();
  }, BACKUP_INTERVAL_MS);
}

// Stop the backup scheduler
export function stopBackupScheduler() {
  if (backupIntervalId) {
    clearInterval(backupIntervalId);
    backupIntervalId = null;
    console.log('[Backup] Scheduler stopped');
  }
}

// Get list of all backup files
export function getBackupFiles(): { json: string[]; excel: string[] } {
  ensureBackupDir();
  try {
    const files = fs.readdirSync(BACKUP_DIR);
    return {
      json: files.filter(f => f.startsWith('backup_') && f.endsWith('.json')).sort().reverse(),
      excel: files.filter(f => f.startsWith('backup_') && f.endsWith('.xlsx')).sort().reverse(),
    };
  } catch (error) {
    return { json: [], excel: [] };
  }
}

// Get backup status
export function getBackupStatus() {
  const backupFiles = getBackupFiles();
  return {
    schedulerRunning: !!backupIntervalId,
    schedulerInitialized,
    lastBackupTime: lastBackupTime?.toISOString() || null,
    lastBackupStatus,
    lastBackupError,
    consecutiveFailures,
    backupInterval: '1 hour',
    backupDir: BACKUP_DIR,
    totalBackups: backupFiles.json.length,
    latestBackup: backupFiles.json[0] || null,
  };
}

// Check if backup file exists and get its info
export function getBackupFileInfo(): { exists: boolean; size?: number; modifiedAt?: string; latestFile?: string } {
  const backupFiles = getBackupFiles();
  if (backupFiles.json.length === 0) {
    return { exists: false };
  }
  const latestFile = backupFiles.json[0];
  const backupPath = path.join(BACKUP_DIR, latestFile);
  try {
    const stats = fs.statSync(backupPath);
    return {
      exists: true,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      latestFile,
    };
  } catch (error) {
    return { exists: false };
  }
}

// Read a specific backup file content (defaults to latest)
export function readBackupFile(filename?: string): string | null {
  const backupFiles = getBackupFiles();
  const targetFile = filename || backupFiles.json[0];
  if (!targetFile) return null;
  
  const backupPath = path.join(BACKUP_DIR, targetFile);
  try {
    if (fs.existsSync(backupPath)) {
      return fs.readFileSync(backupPath, 'utf-8');
    }
  } catch (error) {
    console.error('[Backup] Error reading backup file:', error);
  }
  return null;
}

// Create Excel backup with multiple sheets
async function createExcelBackup(data: any, filePath: string): Promise<void> {
  const workbook = xlsx.utils.book_new();
  
  // Record Days sheet
  if (data.recordDays && data.recordDays.length > 0) {
    const rdSheet = xlsx.utils.json_to_sheet(data.recordDays.map((rd: any) => ({
      ID: rd.id,
      Date: rd.date,
      RxNumber: rd.rxNumber,
      Status: rd.status,
      Notes: rd.notes,
      ProducerId: rd.producerId,
      ApId: rd.apId,
      IsLocked: rd.isLocked,
    })));
    xlsx.utils.book_append_sheet(workbook, rdSheet, 'Record Days');
  }
  
  // Contestants sheet
  if (data.contestants && data.contestants.length > 0) {
    const cSheet = xlsx.utils.json_to_sheet(data.contestants.map((c: any) => ({
      ID: c.id,
      Name: c.name,
      Age: c.age,
      Gender: c.gender,
      Email: c.email,
      Phone: c.phone,
      Location: c.location,
      Postcode: c.postcode,
      Rating: c.auditionRating,
      Status: c.availabilityStatus,
      AttendingWith: c.attendingWith,
      GroupID: c.groupId,
      MedicalInfo: c.medicalInfo,
      MobilityNotes: c.mobilityNotes,
      HasPhoto: c.hasPhoto,
      ImportedAt: c.importedAt,
      NoShowCount: c.noShowCount,
      EarlyLeaverCount: c.earlyLeaverCount,
    })));
    xlsx.utils.book_append_sheet(workbook, cSheet, 'Contestants');
  }
  
  // Seat Assignments sheet
  if (data.seatAssignments && data.seatAssignments.length > 0) {
    const saSheet = xlsx.utils.json_to_sheet(data.seatAssignments.map((sa: any) => ({
      ID: sa.id,
      RecordDayID: sa.recordDayId,
      ContestantID: sa.contestantId,
      Block: sa.blockNumber,
      Seat: sa.seatLabel,
      PlayerType: sa.playerType,
      SeatedAsBlockType: sa.seatedAsBlockType,
      SeatedFromStandby: sa.seatedFromStandby,
      BookingEmailSent: sa.bookingEmailSent,
      ConfirmedRSVP: sa.confirmedRsvp,
      PaperworkSent: sa.paperworkSent,
      PaperworkReceived: sa.paperworkReceived,
      SignedIn: sa.signedIn,
      OtdNotes: sa.otdNotes,
      AttendingWithOverride: sa.attendingWithOverride,
      Notes: sa.notes,
      AssignedAt: sa.assignedAt,
    })));
    xlsx.utils.book_append_sheet(workbook, saSheet, 'Seat Assignments');
  }
  
  // Standbys sheet
  if (data.standbys && data.standbys.length > 0) {
    const stSheet = xlsx.utils.json_to_sheet(data.standbys.map((st: any) => ({
      ID: st.id,
      RecordDayID: st.recordDayId,
      ContestantID: st.contestantId,
      Status: st.status,
      MovedToReschedule: st.movedToReschedule,
      Notes: st.notes,
      EmailSentAt: st.emailSentAt,
      AssignedAt: st.assignedAt,
    })));
    xlsx.utils.book_append_sheet(workbook, stSheet, 'Standbys');
  }
  
  // Canceled Assignments sheet
  if (data.canceledAssignments && data.canceledAssignments.length > 0) {
    const caSheet = xlsx.utils.json_to_sheet(data.canceledAssignments.map((ca: any) => ({
      ID: ca.id,
      RecordDayID: ca.recordDayId,
      ContestantID: ca.contestantId,
      Reason: ca.reason,
      IsFromStandby: ca.isFromStandby,
      RebookedToRecordDayId: ca.rebookedToRecordDayId,
      RebookedAt: ca.rebookedAt,
      RebookedBy: ca.rebookedBy,
      CanceledAt: ca.canceledAt,
    })));
    xlsx.utils.book_append_sheet(workbook, caSheet, 'Canceled Assignments');
  }

  // Attendance Issues sheet
  if (data.attendanceIssues && data.attendanceIssues.length > 0) {
    const aiSheet = xlsx.utils.json_to_sheet(data.attendanceIssues.map((ai: any) => ({
      ID: ai.id,
      RecordDayID: ai.recordDayId,
      ContestantID: ai.contestantId,
      IssueType: ai.issueType,
      Notes: ai.notes,
      RecordedAt: ai.recordedAt,
      RecordedBy: ai.recordedBy,
    })));
    xlsx.utils.book_append_sheet(workbook, aiSheet, 'Attendance Issues');
  }

  // Rebooking History sheet
  if (data.rebookingHistory && data.rebookingHistory.length > 0) {
    const rhSheet = xlsx.utils.json_to_sheet(data.rebookingHistory.map((rh: any) => ({
      ID: rh.id,
      ContestantID: rh.contestantId,
      FromRecordDayID: rh.fromRecordDayId,
      ToRecordDayID: rh.toRecordDayId,
      Reason: rh.reason,
      RebookedBy: rh.rebookedBy,
      RebookedAt: rh.rebookedAt,
    })));
    xlsx.utils.book_append_sheet(workbook, rhSheet, 'Rebooking History');
  }

  // Standby Attendance History sheet
  if (data.standbyAttendanceHistory && data.standbyAttendanceHistory.length > 0) {
    const sahSheet = xlsx.utils.json_to_sheet(data.standbyAttendanceHistory.map((sah: any) => ({
      ID: sah.id,
      ContestantID: sah.contestantId,
      RecordDayID: sah.recordDayId,
      AttendedAt: sah.attendedAt,
      Notes: sah.notes,
    })));
    xlsx.utils.book_append_sheet(workbook, sahSheet, 'Standby Attendance History');
  }

  // Prize Winners sheet
  if (data.prizeWinners && data.prizeWinners.length > 0) {
    const pwSheet = xlsx.utils.json_to_sheet(data.prizeWinners.map((pw: any) => ({
      ID: pw.id,
      ContestantID: pw.contestantId,
      RecordDayID: pw.recordDayId,
      Amount: pw.amount,
      Notes: pw.notes,
      RecordedAt: pw.recordedAt,
    })));
    xlsx.utils.book_append_sheet(workbook, pwSheet, 'Prize Winners');
  }

  // Casting Cards sheet
  if (data.castingCards && data.castingCards.length > 0) {
    const ccSheet = xlsx.utils.json_to_sheet(data.castingCards.map((cc: any) => ({
      ID: cc.id,
      ContestantID: cc.contestantId,
      Content: JSON.stringify(cc.content),
      UpdatedAt: cc.updatedAt,
    })));
    xlsx.utils.book_append_sheet(workbook, ccSheet, 'Casting Cards');
  }

  // Casting Card Versions sheet
  if (data.castingCardVersions && data.castingCardVersions.length > 0) {
    const ccvSheet = xlsx.utils.json_to_sheet(data.castingCardVersions.map((v: any) => ({
      ID: v.id,
      CastingCardID: v.castingCardId,
      Content: JSON.stringify(v.content),
      SavedAt: v.createdAt,
    })));
    xlsx.utils.book_append_sheet(workbook, ccvSheet, 'Casting Card Versions');
  }

  // RX Planning Entries sheet
  if (data.rxPlanningEntries && data.rxPlanningEntries.length > 0) {
    const rxSheet = xlsx.utils.json_to_sheet(data.rxPlanningEntries.map((rx: any) => ({
      ID: rx.id,
      RecordDayID: rx.recordDayId,
      ContestantID: rx.contestantId,
      EpisodeNumber: rx.episodeNumber,
      Position: rx.position,
      Notes: rx.notes,
    })));
    xlsx.utils.book_append_sheet(workbook, rxSheet, 'RX Planning');
  }

  // Block Notes sheet
  if (data.blockNotes && data.blockNotes.length > 0) {
    const bnSheet = xlsx.utils.json_to_sheet(data.blockNotes.map((bn: any) => ({
      ID: bn.id,
      RecordDayID: bn.recordDayId,
      BlockNumber: bn.blockNumber,
      Notes: bn.notes,
      UpdatedAt: bn.updatedAt,
    })));
    xlsx.utils.book_append_sheet(workbook, bnSheet, 'Block Notes');
  }

  // Post Record Tracking sheet
  if (data.postRecordTracking && data.postRecordTracking.length > 0) {
    const prtSheet = xlsx.utils.json_to_sheet(data.postRecordTracking.map((prt: any) => ({
      ID: prt.id,
      ContestantID: prt.contestantId,
      RecordDayID: prt.recordDayId,
      SeatAssignmentID: prt.seatAssignmentId,
      WonMoney: prt.wonMoney,
      Amount: prt.amount,
      Notes: prt.notes,
      UpdatedAt: prt.updatedAt,
    })));
    xlsx.utils.book_append_sheet(workbook, prtSheet, 'Post Record Tracking');
  }

  // Groups sheet
  if (data.groups && data.groups.length > 0) {
    const gSheet = xlsx.utils.json_to_sheet(data.groups.map((g: any) => ({
      ID: g.id,
      ReferenceNumber: g.referenceNumber,
    })));
    xlsx.utils.book_append_sheet(workbook, gSheet, 'Groups');
  }
  
  // Block Types sheet
  if (data.blockTypes && data.blockTypes.length > 0) {
    const btSheet = xlsx.utils.json_to_sheet(data.blockTypes.map((bt: any) => ({
      ID: bt.id,
      RecordDayID: bt.recordDayId,
      BlockNumber: bt.blockNumber,
      BlockType: bt.blockType,
    })));
    xlsx.utils.book_append_sheet(workbook, btSheet, 'Block Types');
  }

  // Movement History sheet
  if (data.movementHistory && data.movementHistory.length > 0) {
    const mhSheet = xlsx.utils.json_to_sheet(data.movementHistory.map((mh: any) => ({
      ID: mh.id,
      ContestantID: mh.contestantId,
      RecordDayID: mh.recordDayId,
      MovementType: mh.movementType,
      FromBlock: mh.fromBlockNumber,
      FromSeat: mh.fromSeatLabel,
      ToBlock: mh.toBlockNumber,
      ToSeat: mh.toSeatLabel,
      MovedBy: mh.movedBy,
      MovedAt: mh.movedAt,
      Notes: mh.notes,
    })));
    xlsx.utils.book_append_sheet(workbook, mhSheet, 'Movement History');
  }

  // Contestant Availability sheet
  if (data.contestantAvailability && data.contestantAvailability.length > 0) {
    const avSheet = xlsx.utils.json_to_sheet(data.contestantAvailability.map((av: any) => ({
      ID: av.id,
      ContestantID: av.contestantId,
      RecordDayID: av.recordDayId,
      Response: av.response,
      RespondedAt: av.respondedAt,
    })));
    xlsx.utils.book_append_sheet(workbook, avSheet, 'Contestant Availability');
  }

  // Noticeboard Posts sheet
  if (data.noticeboardPosts && data.noticeboardPosts.length > 0) {
    const npSheet = xlsx.utils.json_to_sheet(data.noticeboardPosts.map((np: any) => ({
      ID: np.id,
      Title: np.title,
      Content: np.content,
      AuthorID: np.authorId,
      IsPinned: np.isPinned,
      CreatedAt: np.createdAt,
    })));
    xlsx.utils.book_append_sheet(workbook, npSheet, 'Noticeboard Posts');
  }

  // Noticeboard Comments sheet
  if (data.noticeboardComments && data.noticeboardComments.length > 0) {
    const ncSheet = xlsx.utils.json_to_sheet(data.noticeboardComments.map((nc: any) => ({
      ID: nc.id,
      PostID: nc.postId,
      AuthorID: nc.authorId,
      Content: nc.content,
      CreatedAt: nc.createdAt,
    })));
    xlsx.utils.book_append_sheet(workbook, ncSheet, 'Noticeboard Comments');
  }

  // Birthday Entries sheet
  if (data.birthdayEntries && data.birthdayEntries.length > 0) {
    const beSheet = xlsx.utils.json_to_sheet(data.birthdayEntries.map((be: any) => ({
      ID: be.id,
      ContestantID: be.contestantId,
      RecordDayID: be.recordDayId,
      BirthDate: be.birthDate,
      Notes: be.notes,
    })));
    xlsx.utils.book_append_sheet(workbook, beSheet, 'Birthday Entries');
  }

  // System Config sheet
  if (data.systemConfig && data.systemConfig.length > 0) {
    const scSheet = xlsx.utils.json_to_sheet(data.systemConfig.map((sc: any) => ({
      Key: sc.key,
      Value: sc.value,
      UpdatedAt: sc.updatedAt,
    })));
    xlsx.utils.book_append_sheet(workbook, scSheet, 'System Config');
  }
  
  // Write the file
  xlsx.writeFile(workbook, filePath);
}

// Get latest Excel backup file path
export function getExcelBackupPath(): string | null {
  const backupFiles = getBackupFiles();
  if (backupFiles.excel.length === 0) return null;
  return path.join(BACKUP_DIR, backupFiles.excel[0]);
}

// Check if Excel backup exists
export function excelBackupExists(): boolean {
  const backupFiles = getBackupFiles();
  return backupFiles.excel.length > 0;
}
