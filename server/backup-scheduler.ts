import * as fs from 'fs';
import * as path from 'path';
import xlsx from 'xlsx';
import { storage, db, dbCeleb, runWithWorkspace } from './storage';
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

const BACKUP_BASE_DIR = './storage/backups';
const DOND_BACKUP_DIR = `${BACKUP_BASE_DIR}/dond`;
const CELEB_BACKUP_DIR = `${BACKUP_BASE_DIR}/celeb`;
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function getBackupDir(workspace: 'dond' | 'celeb'): string {
  return workspace === 'celeb' ? CELEB_BACKUP_DIR : DOND_BACKUP_DIR;
}

function getBackupFilename(workspace: 'dond' | 'celeb', extension: 'json' | 'xlsx'): string {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  return `backup_${workspace}_${timestamp}.${extension}`;
}

let backupIntervalId: NodeJS.Timeout | null = null;
let schedulerInitialized = false;
const MAX_CONSECUTIVE_FAILURES = 5;

// Per-workspace state
const state: Record<'dond' | 'celeb', {
  lastBackupTime: Date | null;
  lastBackupStatus: 'success' | 'error' | null;
  lastBackupError: string | null;
  consecutiveFailures: number;
}> = {
  dond: { lastBackupTime: null, lastBackupStatus: null, lastBackupError: null, consecutiveFailures: 0 },
  celeb: { lastBackupTime: null, lastBackupStatus: null, lastBackupError: null, consecutiveFailures: 0 },
};

function ensureBackupDir(workspace: 'dond' | 'celeb') {
  const dir = getBackupDir(workspace);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Run backup for a single workspace
export async function performBackupForWorkspace(workspace: 'dond' | 'celeb'): Promise<{ success: boolean; message: string; path?: string }> {
  const ws = state[workspace];
  try {
    ensureBackupDir(workspace);

    // All storage method calls run inside the correct workspace context
    const rawDb = workspace === 'celeb' ? dbCeleb : db;

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
    ] = await runWithWorkspace(workspace, () => Promise.all([
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
    ]));

    // Block types and notes (also need workspace context)
    const [blockTypesArrays, blockNotesArrays] = await runWithWorkspace(workspace, () => Promise.all([
      Promise.all(recordDays.map(rd => storage.getBlockTypesByRecordDay(rd.id))),
      Promise.all(recordDays.map(rd => storage.getBlockNotes(rd.id))),
    ]));
    const blockTypes = blockTypesArrays.flat();
    const blockNotes = blockNotesArrays.flat();

    // Direct DB queries for tables without bulk storage methods
    let prizeWinnersData: any[] = [];
    let castingCardVersionsData: any[] = [];
    let systemConfigData: any[] = [];
    let noticeboardCommentsData: any[] = [];
    let availabilityTokensData: any[] = [];
    let bookingConfirmationTokensData: any[] = [];
    let standbyConfirmationTokensData: any[] = [];
    let systemSettingsData: any[] = [];

    if (rawDb) {
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
        rawDb.select().from(prizeWinners),
        rawDb.select().from(castingCardVersions),
        rawDb.select().from(systemConfig),
        rawDb.select().from(noticeboardComments),
        rawDb.select().from(availabilityTokens),
        rawDb.select().from(bookingConfirmationTokens),
        rawDb.select().from(standbyConfirmationTokens),
        rawDb.select().from(systemSettings),
      ]);
    }

    const backupData = {
      version: '2.0',
      workspace,
      exportedAt: new Date().toISOString(),
      automatic: true,
      data: {
        recordDays,
        contestants,
        groups,
        seatAssignments,
        blockTypes,
        standbys,
        canceledAssignments,
        attendanceIssues,
        rebookingHistory,
        standbyAttendanceHistory,
        movementHistory,
        contestantAvailability,
        availabilityTokens: availabilityTokensData,
        bookingConfirmationTokens: bookingConfirmationTokensData,
        standbyConfirmationTokens: standbyConfirmationTokensData,
        castingCards,
        castingCardVersions: castingCardVersionsData,
        rxPlanningEntries,
        blockNotes,
        postRecordTracking,
        prizeWinners: prizeWinnersData,
        birthdayEntries,
        noticeboardPosts,
        noticeboardComments: noticeboardCommentsData,
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

    const dir = getBackupDir(workspace);
    const jsonFilename = getBackupFilename(workspace, 'json');
    const excelFilename = getBackupFilename(workspace, 'xlsx');
    const backupPath = path.join(dir, jsonFilename);
    const excelPath = path.join(dir, excelFilename);

    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
    await createExcelBackup(backupData.data, excelPath);

    ws.lastBackupTime = new Date();
    ws.lastBackupStatus = 'success';
    ws.lastBackupError = null;
    ws.consecutiveFailures = 0;

    const label = workspace.toUpperCase();
    console.log(`[Backup:${label}] Backup completed at ${ws.lastBackupTime.toISOString()}`);
    console.log(`[Backup:${label}] Data: ${recordDays.length} record days, ${contestants.length} contestants, ${seatAssignments.length} assignments, ${attendanceIssues.length} attendance issues, ${rebookingHistory.length} rebookings, ${castingCards.length} casting cards`);
    console.log(`[Backup:${label}] Excel saved to ${excelPath}`);

    return { success: true, message: `Backup completed successfully for ${label}`, path: backupPath };
  } catch (error: any) {
    ws.lastBackupStatus = 'error';
    ws.lastBackupError = error.message;
    ws.consecutiveFailures++;
    console.error(`[Backup:${workspace.toUpperCase()}] Backup failed (attempt ${ws.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, error.message);
    return { success: false, message: `Backup failed: ${error.message}` };
  }
}

// Run backups for both workspaces (used by the scheduler)
export async function performBackup(): Promise<{ success: boolean; message: string; path?: string }> {
  const [dondResult, celebResult] = await Promise.all([
    performBackupForWorkspace('dond'),
    performBackupForWorkspace('celeb'),
  ]);
  const success = dondResult.success && celebResult.success;
  return {
    success,
    message: success
      ? 'Both workspace backups completed successfully'
      : `DOND: ${dondResult.message} | CELEB: ${celebResult.message}`,
    path: dondResult.path,
  };
}

// Start the automatic backup scheduler
export function startBackupScheduler() {
  if (backupIntervalId) {
    console.log('[Backup] Scheduler already running');
    return;
  }

  console.log('[Backup] Starting automatic backup scheduler (every 1 hour, both workspaces)');
  schedulerInitialized = true;

  // Run first backup after 1 minute to let the app settle
  setTimeout(() => {
    performBackup();
  }, 60 * 1000);

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

// Get list of backup files for a specific workspace
export function getBackupFiles(workspace: 'dond' | 'celeb' = 'dond'): { json: string[]; excel: string[] } {
  const dir = getBackupDir(workspace);
  if (!fs.existsSync(dir)) return { json: [], excel: [] };
  try {
    const files = fs.readdirSync(dir);
    const prefix = `backup_${workspace}_`;
    return {
      json: files.filter(f => f.startsWith(prefix) && f.endsWith('.json')).sort().reverse(),
      excel: files.filter(f => f.startsWith(prefix) && f.endsWith('.xlsx')).sort().reverse(),
    };
  } catch (error) {
    return { json: [], excel: [] };
  }
}

// Get backup status for both workspaces
export function getBackupStatus() {
  const dondFiles = getBackupFiles('dond');
  const celebFiles = getBackupFiles('celeb');
  return {
    schedulerRunning: !!backupIntervalId,
    schedulerInitialized,
    backupInterval: '1 hour',
    dond: {
      lastBackupTime: state.dond.lastBackupTime?.toISOString() || null,
      lastBackupStatus: state.dond.lastBackupStatus,
      lastBackupError: state.dond.lastBackupError,
      consecutiveFailures: state.dond.consecutiveFailures,
      backupDir: DOND_BACKUP_DIR,
      totalBackups: dondFiles.json.length,
      latestBackup: dondFiles.json[0] || null,
    },
    celeb: {
      lastBackupTime: state.celeb.lastBackupTime?.toISOString() || null,
      lastBackupStatus: state.celeb.lastBackupStatus,
      lastBackupError: state.celeb.lastBackupError,
      consecutiveFailures: state.celeb.consecutiveFailures,
      backupDir: CELEB_BACKUP_DIR,
      totalBackups: celebFiles.json.length,
      latestBackup: celebFiles.json[0] || null,
    },
    // Legacy flat fields (DOND, for backwards compat)
    lastBackupTime: state.dond.lastBackupTime?.toISOString() || null,
    lastBackupStatus: state.dond.lastBackupStatus,
    lastBackupError: state.dond.lastBackupError,
    consecutiveFailures: state.dond.consecutiveFailures,
    backupDir: DOND_BACKUP_DIR,
    totalBackups: dondFiles.json.length,
    latestBackup: dondFiles.json[0] || null,
  };
}

// Check if backup file exists for a workspace
export function getBackupFileInfo(workspace: 'dond' | 'celeb' = 'dond'): { exists: boolean; size?: number; modifiedAt?: string; latestFile?: string } {
  const backupFiles = getBackupFiles(workspace);
  if (backupFiles.json.length === 0) {
    return { exists: false };
  }
  const latestFile = backupFiles.json[0];
  const backupPath = path.join(getBackupDir(workspace), latestFile);
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

// Read a specific backup file (defaults to latest for given workspace)
export function readBackupFile(workspace: 'dond' | 'celeb' = 'dond', filename?: string): string | null {
  const backupFiles = getBackupFiles(workspace);
  const targetFile = filename || backupFiles.json[0];
  if (!targetFile) return null;

  const backupPath = path.join(getBackupDir(workspace), targetFile);
  try {
    if (fs.existsSync(backupPath)) {
      return fs.readFileSync(backupPath, 'utf-8');
    }
  } catch (error) {
    console.error('[Backup] Error reading backup file:', error);
  }
  return null;
}

// Get latest Excel backup path for a workspace
export function getExcelBackupPath(workspace: 'dond' | 'celeb' = 'dond'): string | null {
  const backupFiles = getBackupFiles(workspace);
  if (backupFiles.excel.length === 0) return null;
  return path.join(getBackupDir(workspace), backupFiles.excel[0]);
}

// Check if Excel backup exists for a workspace
export function excelBackupExists(workspace: 'dond' | 'celeb' = 'dond'): boolean {
  return getBackupFiles(workspace).excel.length > 0;
}

// Create Excel backup with multiple sheets
async function createExcelBackup(data: any, filePath: string): Promise<void> {
  const workbook = xlsx.utils.book_new();

  if (data.recordDays?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.recordDays.map((rd: any) => ({
      ID: rd.id, Date: rd.date, RxNumber: rd.rxNumber, Status: rd.status, Notes: rd.notes,
      ProducerId: rd.producerId, ApId: rd.apId, IsLocked: rd.isLocked,
    }))), 'Record Days');
  }

  if (data.contestants?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.contestants.map((c: any) => ({
      ID: c.id, Name: c.name, Age: c.age, Gender: c.gender, Email: c.email, Phone: c.phone,
      Location: c.location, Postcode: c.postcode, Rating: c.auditionRating, Status: c.availabilityStatus,
      AttendingWith: c.attendingWith, GroupID: c.groupId, MedicalInfo: c.medicalInfo,
      MobilityNotes: c.mobilityNotes, HasPhoto: c.hasPhoto, ImportedAt: c.importedAt,
      NoShowCount: c.noShowCount, EarlyLeaverCount: c.earlyLeaverCount,
    }))), 'Contestants');
  }

  if (data.seatAssignments?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.seatAssignments.map((sa: any) => ({
      ID: sa.id, RecordDayID: sa.recordDayId, ContestantID: sa.contestantId,
      Block: sa.blockNumber, Seat: sa.seatLabel, PlayerType: sa.playerType,
      SeatedAsBlockType: sa.seatedAsBlockType, SeatedFromStandby: sa.seatedFromStandby,
      BookingEmailSent: sa.bookingEmailSent, ConfirmedRSVP: sa.confirmedRsvp,
      PaperworkSent: sa.paperworkSent, PaperworkReceived: sa.paperworkReceived,
      SignedIn: sa.signedIn, OtdNotes: sa.otdNotes, AttendingWithOverride: sa.attendingWithOverride,
      Notes: sa.notes, AssignedAt: sa.assignedAt,
    }))), 'Seat Assignments');
  }

  if (data.standbys?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.standbys.map((st: any) => ({
      ID: st.id, RecordDayID: st.recordDayId, ContestantID: st.contestantId,
      Status: st.status, MovedToReschedule: st.movedToReschedule,
      Notes: st.notes, EmailSentAt: st.emailSentAt, AssignedAt: st.assignedAt,
    }))), 'Standbys');
  }

  if (data.canceledAssignments?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.canceledAssignments.map((ca: any) => ({
      ID: ca.id, RecordDayID: ca.recordDayId, ContestantID: ca.contestantId,
      Reason: ca.reason, IsFromStandby: ca.isFromStandby,
      RebookedToRecordDayId: ca.rebookedToRecordDayId, RebookedAt: ca.rebookedAt,
      RebookedBy: ca.rebookedBy, CanceledAt: ca.canceledAt,
    }))), 'Canceled Assignments');
  }

  if (data.attendanceIssues?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.attendanceIssues.map((ai: any) => ({
      ID: ai.id, RecordDayID: ai.recordDayId, ContestantID: ai.contestantId,
      IssueType: ai.issueType, Notes: ai.notes, RecordedAt: ai.recordedAt, RecordedBy: ai.recordedBy,
    }))), 'Attendance Issues');
  }

  if (data.rebookingHistory?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.rebookingHistory.map((rh: any) => ({
      ID: rh.id, ContestantID: rh.contestantId, FromRecordDayID: rh.fromRecordDayId,
      ToRecordDayID: rh.toRecordDayId, Reason: rh.reason, RebookedBy: rh.rebookedBy, RebookedAt: rh.rebookedAt,
    }))), 'Rebooking History');
  }

  if (data.standbyAttendanceHistory?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.standbyAttendanceHistory.map((sah: any) => ({
      ID: sah.id, ContestantID: sah.contestantId, RecordDayID: sah.recordDayId,
      AttendedAt: sah.attendedAt, Notes: sah.notes,
    }))), 'Standby Attendance History');
  }

  if (data.prizeWinners?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.prizeWinners.map((pw: any) => ({
      ID: pw.id, ContestantID: pw.contestantId, RecordDayID: pw.recordDayId,
      Amount: pw.amount, Notes: pw.notes, RecordedAt: pw.recordedAt,
    }))), 'Prize Winners');
  }

  if (data.castingCards?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.castingCards.map((cc: any) => ({
      ID: cc.id, ContestantID: cc.contestantId, Content: JSON.stringify(cc.content), UpdatedAt: cc.updatedAt,
    }))), 'Casting Cards');
  }

  if (data.castingCardVersions?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.castingCardVersions.map((v: any) => ({
      ID: v.id, CastingCardID: v.castingCardId, Content: JSON.stringify(v.content), SavedAt: v.createdAt,
    }))), 'Casting Card Versions');
  }

  if (data.rxPlanningEntries?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.rxPlanningEntries.map((rx: any) => ({
      ID: rx.id, RecordDayID: rx.recordDayId, ContestantID: rx.contestantId,
      EpisodeNumber: rx.episodeNumber, Position: rx.position, Notes: rx.notes,
    }))), 'RX Planning');
  }

  if (data.blockNotes?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.blockNotes.map((bn: any) => ({
      ID: bn.id, RecordDayID: bn.recordDayId, BlockNumber: bn.blockNumber,
      Notes: bn.notes, UpdatedAt: bn.updatedAt,
    }))), 'Block Notes');
  }

  if (data.postRecordTracking?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.postRecordTracking.map((prt: any) => ({
      ID: prt.id, ContestantID: prt.contestantId, RecordDayID: prt.recordDayId,
      SeatAssignmentID: prt.seatAssignmentId, WonMoney: prt.wonMoney,
      Amount: prt.amount, Notes: prt.notes, UpdatedAt: prt.updatedAt,
    }))), 'Post Record Tracking');
  }

  if (data.groups?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.groups.map((g: any) => ({
      ID: g.id, ReferenceNumber: g.referenceNumber,
    }))), 'Groups');
  }

  if (data.blockTypes?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.blockTypes.map((bt: any) => ({
      ID: bt.id, RecordDayID: bt.recordDayId, BlockNumber: bt.blockNumber, BlockType: bt.blockType,
    }))), 'Block Types');
  }

  if (data.movementHistory?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.movementHistory.map((mh: any) => ({
      ID: mh.id, ContestantID: mh.contestantId, RecordDayID: mh.recordDayId,
      MovementType: mh.movementType, FromBlock: mh.fromBlockNumber, FromSeat: mh.fromSeatLabel,
      ToBlock: mh.toBlockNumber, ToSeat: mh.toSeatLabel, MovedBy: mh.movedBy,
      MovedAt: mh.movedAt, Notes: mh.notes,
    }))), 'Movement History');
  }

  if (data.contestantAvailability?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.contestantAvailability.map((av: any) => ({
      ID: av.id, ContestantID: av.contestantId, RecordDayID: av.recordDayId,
      Response: av.response, RespondedAt: av.respondedAt,
    }))), 'Contestant Availability');
  }

  if (data.noticeboardPosts?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.noticeboardPosts.map((np: any) => ({
      ID: np.id, Title: np.title, Content: np.content, AuthorID: np.authorId,
      IsPinned: np.isPinned, CreatedAt: np.createdAt,
    }))), 'Noticeboard Posts');
  }

  if (data.noticeboardComments?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.noticeboardComments.map((nc: any) => ({
      ID: nc.id, PostID: nc.postId, AuthorID: nc.authorId, Content: nc.content, CreatedAt: nc.createdAt,
    }))), 'Noticeboard Comments');
  }

  if (data.birthdayEntries?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.birthdayEntries.map((be: any) => ({
      ID: be.id, ContestantID: be.contestantId, RecordDayID: be.recordDayId,
      BirthDate: be.birthDate, Notes: be.notes,
    }))), 'Birthday Entries');
  }

  if (data.systemConfig?.length > 0) {
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet(data.systemConfig.map((sc: any) => ({
      Key: sc.key, Value: sc.value, UpdatedAt: sc.updatedAt,
    }))), 'System Config');
  }

  xlsx.writeFile(workbook, filePath);
}
